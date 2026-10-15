/**
 * run_device_action (S11): the single execution tool. The gate/breaker/
 * classification live here — code-enforced, the model cannot bypass them.
 *
 * Contract notes (since T2 every call is answered over adb by `src/device/`):
 * - this tool speaks 0-1000 normalized coordinates and converts them with the
 *   dimensions of a probe screenshot (G24); the device side is pixels
 * - the device seam answers in plain strings ("Success" / "Failed" /
 *   "Error: ..."), not structuredContent; normalizeOutcome below. Keeping that
 *   shape is a decision, not a leftover: the classifier's two failure classes
 *   and the locks around them are written against it
 * - the call names below are ours (`NativeCall.tool`), mapped to adb commands in
 *   `src/device/act.ts`: tap / long_press_on / swipe / back / launch_app /
 *   stop_app / open_link / focus_and_input_text / focus_and_clear_text /
 *   erase_one_char / press_key / take_screenshot / get_ui_hierarchy
 */
import type { DeviceBreaker } from "../breaker.js";
import type { DevicePool, PoolLease } from "../devicePool.js";
import type { NativeCall } from "../device/act.js";
import { classifyMessage } from "../classify.js";
import {
  imageMediaTypeOf,
  parseImageSize,
  toPixels,
  type ScreenSize,
} from "../coord.js";
import type { DshImageAttachment, JsonValue, ToolDefinitionInput } from "../dsh-types.js";
import {
  findNodeCenterBySubstring,
  formatVisibleElements,
  handleFromObservation,
  parseVisibleElements,
  resolveHandle,
  type VisibleElement,
} from "../hierarchy.js";
import { LiveObservations } from "../observations.js";
import { chooseHitPoint, findNeedleHits, type OcrPage } from "../ocr/recognize.js";

export interface RouterLogger {
  info(message: string): void;
  warn(message: string): void;
}

export const ACTIONS = [
  "click",
  "long_press",
  "swipe",
  "input_text",
  "press_key",
  "back",
  "erase_one_char",
  "focus_and_clear_text",
  "launch_app",
  "stop_app",
  "open_link",
  "take_screenshot",
  "get_ui_hierarchy",
  "wait",
] as const;

export type DeviceAction = (typeof ACTIONS)[number];

/** Which source answered a `{text}` target: the nodes, or the frame (T5). */
export type TargetSource = "hierarchy" | "ocr";

/**
 * Actions that should move the screen. Observation-only actions
 * (take_screenshot / get_ui_hierarchy / wait) are excluded so the router does
 * not pay two extra captures for them.
 */
const EFFECT_OBSERVED_ACTIONS: ReadonlySet<DeviceAction> = new Set([
  "click",
  "long_press",
  "swipe",
  "input_text",
  "press_key",
  "back",
  "erase_one_char",
  "focus_and_clear_text",
  "launch_app",
  "stop_app",
  "open_link",
]);

/** Model-facing budget for a hierarchy dump: ~27 rows at ~70 chars each. */
const RENDER_HIERARCHY_BUDGET = 6_000;
/** Budget for any other string field in the result envelope. */
const RENDER_TEXT_BUDGET = 200;

/** Let navigation animations finish before the after-frame is taken. */
const EFFECT_SETTLE_MS = 600;

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

const KEYCODES: Record<string, string> = {
  home: "KEYCODE_HOME",
  enter: "KEYCODE_ENTER",
  delete: "KEYCODE_DEL",
  tab: "KEYCODE_TAB",
  search: "KEYCODE_SEARCH",
  menu: "KEYCODE_MENU",
  app_switch: "KEYCODE_APP_SWITCH",
  volume_up: "KEYCODE_VOLUME_UP",
  volume_down: "KEYCODE_VOLUME_DOWN",
  power: "KEYCODE_POWER",
};

type DispatchResult =
  | { ok: true; value: unknown }
  | { ok: false; failure: "environment" | "task" | "internal" | "cancelled"; message: string };

/**
 * Breaker/gate device key (S4 矩阵：auto 端点默认键）。省略、非字符串或空串的
 * serial 一律落 configured default，保证 execute、guard、gate 三处同源——两处
 * 各写一遍曾让空串在 execute 落空键、在 guard 回 default。
 */
export function deviceKeyOf(args: Record<string, unknown>, fallback: string): string {
  const serial = (args as { device_serial?: unknown } | null)?.device_serial;
  return typeof serial === "string" && serial.length > 0 ? serial : fallback;
}

/** Stable JSON for dedup keys: sorted object keys, reason excluded by caller. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * G13 in-flight dedup key: same agent, same device, same mutating action with
 * the same arguments while one is still running. Read-only actions are
 * idempotent polls and never deduped; sequential repeats are unaffected
 * because the key clears when the first call settles.
 */
function inflightKey(agent: string, device: string, action: string, args: Record<string, unknown>): string {
  const rest = { ...args };
  delete rest.reason;
  delete rest.device_serial;
  return `${agent}::${device}::${action}::${stableStringify(rest)}`;
}

/**
 * G34: semantic input checks the wire schema cannot express. A present-but-
 * malformed coordinate is a caller bug — it must fail fast instead of
 * silently falling through to hierarchy search with a typo'd target.
 */
function isNormalizedPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= 0 &&
    value[0] <= 1000 &&
    value[1] >= 0 &&
    value[1] <= 1000
  );
}

function assertNormalizedPair(value: unknown, field: string): asserts value is [number, number] {
  if (!isNormalizedPair(value)) {
    throw new Error(`task: ${field} must be [x,y] with finite numbers in 0-1000`);
  }
}

function assertNonEmptyString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`task: ${field} must be a non-empty string`);
  }
}

function assertPositiveDuration(value: unknown, field: string): void {
  if (value === undefined) return;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`task: ${field} must be a positive number of milliseconds`);
  }
}

export type ValidatorStrictness = "off" | "final" | "checkpoints" | "strict";

/** Upstream pre-execution retry budget (max_pre_attempts = 3, total attempts). */
const RESOLVE_ATTEMPTS = 3;

/** Upstream incident threshold: consecutive failures that open an incident. */
const INCIDENT_THRESHOLD = 3;

/**
 * The deadline we declare to the host (R15: the registry never executes it, so
 * this is a claim about our own budget, not a mechanism). Named because
 * 能力重审-1 checks against it: `wait` must not be able to outlive it, or the
 * declaration says something untrue.
 */
export const RUN_DEVICE_ACTION_TIMEOUT_MS = 45_000;

/**
 * `wait` ceiling. Strictly below the declared deadline so pool admission and
 * result shaping still have budget after it — a `wait` that could consume the
 * whole deadline would make the claim above false by construction.
 */
export const WAIT_CEILING_MS = 30_000;

/**
 * An abort is charged to NEITHER side: the host's deadline and the user's stop
 * button are both outside the device and outside the model's plan. Charging the
 * breaker would open it for a whole cooldown because someone pressed stop;
 * charging the task would tell the model its goal is unclear when the stop
 * button (or the host deadline) is what ended the call. 能力重审-1.
 */
const CANCELLED_MESSAGE =
  "cancelled by the host deadline or the user's stop — nothing was charged to the device or to you; " +
  "resend a shorter call or a narrower target";

export function isLadderOn(strictness: ValidatorStrictness | undefined): boolean {
  return (strictness ?? "final") !== "off";
}

export function strictnessOf(options: RouterOptions): ValidatorStrictness {
  return options.strictness ?? "final";
}

/**
 * Consecutive task-failure counts per device (P1-a incident ledger). Health
 * state stays in the breaker; this tracks TASK progress only: environment and
 * internal outcomes never touch it. Lifetime matches gate/breaker (fresh per
 * plugin instance, i.e. restart clears — the old stop-all equivalent).
 *
 * The ledger also carries the CLOSED notice (changelogs #62; upstream
 * google/artemis calls this `last_closed_incident`): an incident the
 * model was told about stays open until a later success closes it, and that
 * success hands back a one-turn notice to settle the original intent.
 * Upstream keys it off step numbers; this device has none (the host owns
 * turn accounting), so the notice carries the consecutive-failure count
 * instead.
 */
export interface IncidentClosure {
  consecutive_failures: number;
}

export class ActionIncidents {
  private readonly counts = new Map<string, number>();
  private readonly announced = new Set<string>();
  private readonly closures = new Map<string, IncidentClosure>();

  noteFailure(key: string): number {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    if (next >= INCIDENT_THRESHOLD) this.announced.add(key);
    return next;
  }

  noteSuccess(key: string): void {
    if (this.announced.delete(key)) {
      this.closures.set(key, { consecutive_failures: this.counts.get(key) ?? INCIDENT_THRESHOLD });
    }
    this.counts.delete(key);
  }

  /**
   * Take the pending CLOSED notice for a device. Called once per model-facing
   * result, which is what makes the notice one-turn rather than sticky.
   */
  takeClosure(key: string): IncidentClosure | undefined {
    const closure = this.closures.get(key);
    if (closure === undefined) return undefined;
    this.closures.delete(key);
    return closure;
  }

  count(key: string): number {
    return this.counts.get(key) ?? 0;
  }
}

export type VerdictCategory = "disappeared" | "general";

export function incidentPrompt(failures: number, key: string, milestone: boolean): string {
  const base =
    `${failures} consecutive task failures on device ${key} — restate the goal, ` +
    `list what was tried, then adjust the plan or report blocked via report_task_status`;
  return milestone ? `Milestone audit: ${base}` : base;
}

export function closurePrompt(closure: IncidentClosure, key: string): string {
  // Kept inside RENDER_TEXT_BUDGET (G68 ①): the result envelope clips every
  // non-hierarchy string at 200 chars, and a truncated notice reads as garbage
  // exactly where it asks the model to settle an intent. The wording stays terse
  // so the longest device serial (an adb endpoint) still fits whole.
  return (
    `Execution incident CLOSED on ${key} after ${closure.consecutive_failures} failures: ` +
    `settle the original intent — already served, still pending, or no longer needed.`
  );
}

export const SELF_CHECK_PROMPT =
  "Self-check: confirm the intended visible change happened; if not, adjust and continue, " +
  "or report blocked via report_task_status.";

export const PIXEL_GUIDANCE =
  "No visible change. Take a screenshot, locate the target visually, and retry with " +
  "{coordinate:[x,y]} from pixels or a fresh {index} from a new get_ui_hierarchy.";

export interface RouterOptions {
  /** S3/G3 scheduling: per-device chains plus the auto pool and the global ceiling. */
  pool: DevicePool;
  breaker: DeviceBreaker;
  /**
   * T2-c/d/e: one action executed on the device over adb, answered in the
   * legacy string shape (`Success` / `Failed` / `Error: …`) so the classifier and
   * every existing lock keep working. Failures of the *transport* kind (adb
   * vanished, the call was cancelled) throw prefixed `environment:`.
   */
  execute(call: NativeCall, key: string, signal?: AbortSignal): Promise<string>;
  /** T2-c: a PNG frame straight off the device, for the screenshot action. */
  capturePng(key: string, signal?: AbortSignal): Promise<Buffer | undefined>;
  logger: RouterLogger;
  defaultDeviceKey: string;
  /**
   * P1-a validator strictness (S11 step 5, plugin Config, default "final" like
   * upstream `--verification-level`): "off" runs every action once with no
   * ladder and no incident tracking; the other levels run the full ladder and
   * differ only in audit prompting (final: exit path only, via persona;
   * checkpoints: incident opens carry a milestone prompt; strict: every
   * mutating action also carries a self-check prompt).
   */
  strictness?: ValidatorStrictness;
  /** Per-device consecutive task-failure counts; owned per plugin instance. */
  incidents?: ActionIncidents;
  /**
   * G67: the `#N` list each agent was last shown, per device. Owned by the
   * plugin instance so it outlives one tool call; the ladder's own internal
   * re-fetches never write it (only the model-visible result does).
   */
  observations?: LiveObservations;
  /**
   * Calling-agent identity for the G13 in-flight dedup key and the G67 handle
   * scope. Direct-drive tests leave it unset, and a host whose initiator lookup
   * throws lands here too - so "anonymous" is a real shared lane, not only a
   * test artefact (worst case those callers share one observation and one dedup
   * key, never a silent positional tap).
   */
  agentIdOfCall?(): string | undefined;
  /**
   * T2-b: the hierarchy read directly off the device (`adb shell uiautomator
   * dump` + read back), returning the raw XML. It is the ONLY hierarchy source:
   * the action server's flattened JSON left the path with it, and the flattening
   * is ours now. The `#N` handle and identity rules are unchanged (G42 / G67).
   */
  /**
   * T5: the built-in offline OCR, asked only when the hierarchy cannot answer a
   * `{text}` target. Undefined (or an engine that answers `undefined`) leaves the
   * behaviour exactly as it was: OCR may add an answer, never take one away.
   */
  ocr?(key: string, signal?: AbortSignal): Promise<OcrPage | undefined>;
  hierarchy(key: string, signal?: AbortSignal): Promise<string | undefined>;
  /**
   * Screen dimensions for 0-1000 → pixel conversion; probe result cached per
   * key. Takes the caller's signal (能力重审-1): without it this seam was the one
   * place in the pre-execution path a host deadline could not stop — the frame
   * probe kept running after the model had already given up.
   */
  resolveScreenSize(key: string, signal?: AbortSignal): Promise<ScreenSize | undefined>;
  /**
   * Commit screenshot bytes to the host attachment store and get back the
   * durable reference the model and UI can use. Absent (or returning undefined)
   * keeps the result text-only — bytes never go into the tool payload.
   */
  saveScreenshot?(
    bytes: Uint8Array,
    mediaType: DshImageAttachment["mediaType"],
  ): Promise<DshImageAttachment | undefined>;
  /**
   * Effect observation, delegated to the action server's read-only
   * `compare_ui_frames`: the verdict rules (status/nav masking, change ratio,
   * tap ROI, and the "assume changed" fallback) are the device layer's, not
   * ours to re-derive from pixels.
   */
  /** Records that this agent acted in the current turn (G44 ledger). */
  onAction?(): void;
  /** Effect frame for the before/after comparison. Signal-threaded, same reason. */
  captureFrame?(key: string, signal?: AbortSignal): Promise<string | undefined>;
  compareFrames?(
    beforeB64: string,
    afterB64: string,
    action: string,
    coordinates?: number[],
  ): Promise<boolean | undefined>;
}

interface TargetInput {
  index?: number;
  coordinate?: number[];
  text?: string;
}

export function defineRunDeviceAction(options: RouterOptions): ToolDefinitionInput {
  const { pool, breaker, logger } = options;
  const incidents = options.incidents ?? new ActionIncidents();
  const observations = options.observations ?? new LiveObservations();
  const agentOfCall = (): string => options.agentIdOfCall?.() ?? "anonymous";
  const inflight = new Set<string>();

  async function resolvePixelTarget(
    args: Record<string, unknown>,
    key: string,
    signal: AbortSignal,
  ): Promise<{ x: number; y: number; via?: TargetSource }> {
    const target = (args.target ?? {}) as TargetInput;
    if (target.coordinate !== undefined) assertNormalizedPair(target.coordinate, "target.coordinate");
    if (typeof target.coordinate?.[0] === "number" && typeof target.coordinate?.[1] === "number") {
      const size = await requireScreenSize(key, signal);
      return {
        x: toPixels(target.coordinate[0], size.width),
        y: toPixels(target.coordinate[1], size.height),
      };
    }
    // P1-a pre-execution ladder (upstream max_pre_attempts = 3): a missing
    // target may be a transient screen, so re-fetch the hierarchy and retry.
    // An UNREADABLE hierarchy is the bypass case — fail immediately instead of
    // retrying a broken observation; a missing target spec is a caller bug and
    // fails before any fetch.
    const seeksHierarchy =
      typeof target.index === "number" || (typeof target.text === "string" && target.text.length > 0);
    if (!seeksHierarchy) {
      throw new Error("task: this action needs a target — {coordinate:[x,y]} (0-1000), {index}, or {text}");
    }
    // A handle is only meaningful against the list the model was shown, so two
    // cases are caller bugs rather than a transient screen and are refused
    // before the first fetch (G67): no observation at all, and a number that was
    // never in the list. Re-fetching cannot fix either - only the identity of a
    // node the model DID see can come back.
    if (typeof target.index === "number") {
      const pre = handlePrecheck(target.index, key);
      if (pre) throw new Error(pre);
    }
    const attempts = isLadderOn(options.strictness) ? RESOLVE_ATTEMPTS : 1;
    let lastError = "";
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const fresh = await fetchHierarchy(key, signal);
      if (fresh === undefined) {
        // An abort that arrives mid-read lands here too, and it must not be
        // charged to the device - check it first (能力重审-1).
        if (signal.aborted) throw new Error(`cancelled: ${CANCELLED_MESSAGE}`);
        // Not a task failure: `uiautomator dump` exits 139 even when it claims
        // success, so unreadable XML means the dump did not deliver - a device
        // or host condition the model cannot fix by rewording its goal.
        throw new Error(
          "environment: hierarchy unreadable (not a node list) — the dump did not deliver readable XML; " +
            "check the device connection and re-run get_ui_hierarchy",
        );
      }
      const hit = resolveTarget(target, fresh, key);
      if ("center" in hit) return { ...hit.center, via: "hierarchy" };
      if (!hit.retryable) throw new Error(hit.refusal);
      lastError = hit.refusal;
      // T5: a hierarchy only shows text a widget exposes. Canvas and WebView
      // screens - the reason OCR exists - show nothing, so a `{text}` target the
      // nodes cannot answer gets one more source: the frame itself. Only for
      // {text}, and only after the nodes said "not on this screen".
      if (typeof target.text === "string" && target.text.length > 0) {
        const point = await ocrPoint(key, target.text, signal);
        if (point !== undefined) return { ...point, via: "ocr" };
      }
    }
    throw new Error(lastError);
  }

  /** Undefined means "OCR had nothing to say": no frame, no engine, no hit. */
  async function ocrPoint(
    key: string,
    needle: string,
    signal?: AbortSignal,
  ): Promise<{ x: number; y: number } | undefined> {
    if (options.ocr === undefined) return undefined;
    const page = await options.ocr(key, signal);
    if (page === undefined) return undefined;
    const point = chooseHitPoint(findNeedleHits(page, needle));
    if (point === undefined) {
      logger.warn(`[route] text "${needle}" not found in the hierarchy nor resolved by OCR (${page.hits.length} boxes)`);
      return undefined;
    }
    logger.info(`[route] text "${needle}" resolved by OCR at ${point.x},${point.y} (${page.ms}ms)`);
    return point;
  }

  /** The live observation for this agent + device, or undefined if it never looked. */
  function currentObservation(key: string): VisibleElement[] | undefined {
    return observations.get(agentOfCall(), key);
  }

  /**
   * Refusals that no amount of re-fetching can turn into a resolution: the
   * handle has no live list to belong to, or is not in it. Undefined means the
   * handle is at least addressable and worth resolving.
   */
  function handlePrecheck(index: number, key: string): string | undefined {
    const handle = handleFromObservation(currentObservation(key), index);
    if (handle.status === "unobserved") {
      return `task: no live hierarchy for device ${key} — call get_ui_hierarchy first, then use a #N handle from its output`;
    }
    if (handle.status === "unknown") {
      return (
        `task: #${index} is not in the live hierarchy for device ${key} ` +
        `(it listed ${handle.elementCount} elements) — re-run get_ui_hierarchy and pick a #N from it`
      );
    }
    return undefined;
  }

  /**
   * Resolve one target against an already-parsed hierarchy. `{index}` follows
   * the handle's identity into the new tree (G67) instead of taking array
   * position N again; `{text}` matches content as it always did. `retryable`
   * marks the ladder's own case — a node that is simply not on this screen yet.
   */
  function resolveTarget(
    target: TargetInput,
    fresh: VisibleElement[],
    key: string,
  ): { center: { x: number; y: number } } | { refusal: string; retryable: boolean } {
    if (typeof target.index === "number") {
      const pre = handlePrecheck(target.index, key);
      if (pre) return { refusal: pre, retryable: false };
      const hit = resolveHandle(currentObservation(key), fresh, target.index);
      if (hit.status === "resolved") return { center: hit.center };
      if (hit.status === "gone") {
        const label = hit.label ? ` ("${hit.label}")` : "";
        return {
          refusal:
            `task: #${target.index}${label} from the live hierarchy is no longer on device ${key} — ` +
            `re-run get_ui_hierarchy, or use {coordinate:[x,y]} and say what you saw`,
          retryable: true,
        };
      }
      // handlePrecheck rules both of these out, so reaching here is our own bug.
      return { refusal: `task: #${target.index} cannot be resolved against the live hierarchy`, retryable: false };
    }
    const center = findNodeCenterBySubstring(fresh, target.text as string);
    if (center) return { center };
    return {
      refusal: `task: no element matching text "${target.text}" in the current hierarchy`,
      retryable: true,
    };
  }

  /**
   * The current element list, read off the device. Undefined means the
   * hierarchy could not be read, which every caller treats as an unusable
   * observation rather than an empty screen (G68 ⑤).
   */
  async function fetchHierarchy(key: string, signal?: AbortSignal): Promise<VisibleElement[] | undefined> {
    let xml: string | undefined;
    try {
      xml = await options.hierarchy(key, signal);
    } catch (error) {
      // G33 again, one layer down: a failed read is the device's or the host's,
      // never the model's. An unprefixed throw here would classify internal and
      // the breaker would stay shut while every read keeps dying.
      throw new Error(
        `environment: hierarchy read failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return parseVisibleElements(xml ?? "");
  }

  async function requireScreenSize(key: string, signal?: AbortSignal): Promise<ScreenSize> {
    const size = await options.resolveScreenSize(key, signal);
    if (!size) {
      throw new Error(
        "environment: screen size unavailable (probe screenshot failed) — set the plugin `screenSize` config or check the device",
      );
    }
    return size;
  }

  return {
    name: "run_device_action",
    description:
      "Execute one action on the Android device. Actions: " +
      ACTIONS.join(", ") +
      ". Coordinates are [x,y] normalized to 0-1000 (top-left origin); targets may also " +
      "be given as {index} into the latest hierarchy or {text} to find an element. One " +
      "action per call; the call resolves after execution and effect observation.",
    parameters: {
      action: { type: "string", required: true, enum: [...ACTIONS], description: "Action to execute." },
      target: {
        type: "object",
        additionalProperties: false,
        description:
          "Where to act. {index} = the #N handle from YOUR latest get_ui_hierarchy output on this device (preferred; " +
          "it follows that same element while it can still be recognised, and is refused rather than guessed " +
          "when it cannot be — a handle you never saw does not exist); " +
          "{coordinate:[x,y]} in 0-1000 as fallback; {text} is the deterministic channel for a visible label " +
          "the nodes do not carry (it also reads the frame's own pixels). " +
          "Required by click/long_press/input_text/focus_and_clear_text.",
        properties: {
          index: { type: "number", description: "The #N handle from your latest get_ui_hierarchy output on this device." },
          coordinate: { type: "array", items: { type: "number" }, description: "[x,y] normalized to 0-1000." },
          text: {
            type: "string",
            description:
              "Visible label to locate. Matched first against the hierarchy (text/content-desc/resource-id), then " +
              "against the frame's own pixels, so it reaches labels a canvas or WebView never exposes as nodes. " +
              "This is the deterministic channel: the plugin computes the point itself and records which source " +
              "answered, unlike coordinate which you estimate from a screenshot. If nothing matches, read the " +
              "screenshot and use coordinate instead — retrying this will not help.",
          },
        },
      },
      end_coordinate: { type: "array", items: { type: "number" }, description: "Swipe end [x,y] normalized to 0-1000." },
      target_description: { type: "string", description: "Short human description of the target, recorded with the action." },
      text: { type: "string", description: "Text for input_text (supports \\n)." },
      clear_before_input: { type: "boolean", description: "input_text: clear existing text first (default append)." },
      // No `maximum` here: the official value-schema DSL accepts only `type`,
      // `enum`, `const` plus annotations on a scalar (verified in
      // @deepseek-ai/dsh-tools' own compiler, 能力重审-1) and rejects anything
      // else as an author-schema violation. So the ceiling is enforced in the
      // executor below and stated here for the model.
      duration_ms: {
        type: "number",
        description: `Hold/swipe/wait duration in milliseconds (0-${WAIT_CEILING_MS}; longer is refused).`,
      },
      key: { type: "string", description: "press_key key: home/enter/delete/tab/search/menu/app_switch/volume_up/volume_down/power, digits, or a raw KEYCODE_* name." },
      package: { type: "string", description: "Package name for launch_app/stop_app." },
      url: { type: "string", description: "URL for open_link." },
      device_serial: { type: "string", description: "Target device key; omit for the configured default." },
      reason: { type: "string", required: true, description: "One sentence on why this action moves the task forward." },
    },
    // R15: the registry never executes this — it is a claim about our budget.
    // WAIT_CEILING_MS and the signal seams are what keep the claim honest.
    timeoutMs: RUN_DEVICE_ACTION_TIMEOUT_MS,
    /**
     * S3/R14 并发声明：只读观察动作可并发，变更类独占（缺省 exclusive，fail-closed）。
     * 宿主调度只定"谁可并行"，同一设备的串行仍由工具内闸门强制。
     */
    isConcurrencySafe: (args) =>
      (args as { action?: unknown }).action === "take_screenshot" ||
      (args as { action?: unknown }).action === "get_ui_hierarchy",
    output: {
      // Payloads are action-dependent (waited_ms for wait, the MCP record for
      // device calls), so the object is explicitly OPEN (official rule:
      // openness is declared, never accidental). render formats whatever came.
      schema: {
        type: "object",
        additionalProperties: true,
      },
      // P1-b checker facts (R16): the validator verdict rides on tool/result
      // meta so milestone/exit audits replay it instead of trusting memory.
      // Soft by design — unknown shapes project to {} rather than throwing.
      presentationMeta: (_args, value) => {
        const record = (value ?? {}) as { effect?: unknown; category?: unknown; incident?: unknown; target_source?: unknown };
        const meta: { [key: string]: JsonValue } = {};
        if (typeof record.effect === "string") meta.effect = record.effect;
        if (typeof record.category === "string") meta.category = record.category;
        // T5: the trace says whether the tap landed on a node or on a box the
        // OCR read off the frame - the difference matters when reviewing a miss.
        if (record.target_source === "hierarchy" || record.target_source === "ocr") {
          meta.target_source = record.target_source;
        }
        if (typeof record.incident === "object" && record.incident !== null) {
          meta.incident = record.incident as JsonValue;
        }
        return meta;
      },
      render: (_args, value) => {
        const record = { ...(value ?? {}) } as Record<string, unknown>;
        // The attachment reference renders as an image block; it must not also
        // be flattened into the text envelope (the host shape for a tool image
        // result is [text, image]).
        const image = record.image as DshImageAttachment | undefined;
        delete record.image;
        const parts = Object.entries(record)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => {
            if (typeof v !== "string") return `${k}=${JSON.stringify(v)}`;
            // A hierarchy dump is one long numbered list; clipping it at the
            // generic budget left the model seeing 3 of 27 elements (G42).
            const budget = k === "hierarchy" ? RENDER_HIERARCHY_BUDGET : RENDER_TEXT_BUDGET;
            return `${k}=${v.length > budget ? `${v.slice(0, budget)}…` : v}`;
          });
        const text = parts.length > 0 ? parts.join("; ") : "action completed";
        return image?.attachmentId
          ? [{ type: "text", text }, { type: "image", attachment: image }]
          : [{ type: "text", text }];
      },
    },
    async execute(args, exec) {
      const action = args.action as DeviceAction;
      // Before admission the pool has not chosen a device for an auto call, so the log line and
      // the G13 dedup key use the anticipated device; breaker bookkeeping below is re-anchored to
      // the device the pool actually assigned.
      const anticipatedKey = pool.resolveKey(args);
      let key = anticipatedKey;
      const risk = action === "stop_app" ? "risky" : "normal";
      logger.info(`[route] action=${action} device=${key} risk=${risk} reason=${String(args.reason)}`);
      options.onAction?.();

      // No admission check here: cooling-down refusal lives in the registry
      // guard (S4/R13/G33). The breaker below only RECORDS the outcome.
      const throwTaskFailure = (message: string): never => {
        breaker.recordTaskFailure(key);
        logger.warn(`[route] refused (class=task): ${message}`);
        if (isLadderOn(options.strictness) && !exec.signal.aborted) {
          const failures = incidents.noteFailure(key);
          if (failures >= INCIDENT_THRESHOLD) {
            const milestone = strictnessOf(options) !== "final";
            throw new Error(`task: ${message} [incident: ${incidentPrompt(failures, key, milestone)}]`);
          }
        }
        throw new Error(`task: ${message}`);
      };
      // G13 in-flight dedup (mutating actions only): an identical call from
      // the same agent while one is still running is a double-fire, not a
      // retry — refuse it before queueing on the gate. Reads and sequential
      // repeats are unaffected.
      const dedup = EFFECT_OBSERVED_ACTIONS.has(action)
        ? inflightKey(options.agentIdOfCall?.() ?? "anonymous", key, action, args)
        : undefined;
      if (dedup !== undefined && inflight.has(dedup)) {
        throwTaskFailure(
          `duplicate of the action already running on device ${key} — wait for its result instead of resending`,
        );
      }
      if (dedup !== undefined) inflight.add(dedup);
      let lease: PoolLease;
      try {
        lease = await pool.acquire(args, exec.signal);
      } catch (error) {
        // An abort while queued never reached the device, so the in-flight mark has to go back:
        // leaving it would refuse every later identical action as a "duplicate" forever.
        if (dedup !== undefined) inflight.delete(dedup);
        throw error;
      }
      key = lease.key;
      try {
        const result = await dispatch(action, args, key, exec).catch((error) => {
          // Anything escaping dispatch is our own bug, not a device or task
          // signal (G38) — except a user abort, which keeps its meaning.
          if (exec.signal.aborted) {
            return { ok: false, failure: "cancelled", message: CANCELLED_MESSAGE } as const;
          }
          return {
            ok: false,
            failure: "internal",
            message: error instanceof Error ? error.message : String(error),
          } as const;
        });
        if (!result.ok) {
          if (result.failure === "internal") {
            logger.warn(`[route] internal (no breaker record): ${result.message}`);
            throw new Error(
              `internal: ${result.message} (plugin bug, not a device or task failure; do not retry the same call)`,
            );
          }
          if (result.failure === "environment") breaker.recordEnvironmentFailure(key);
          // `cancelled` records nothing on either side: the host deadline and the
          // user's stop button are not device faults and not model mistakes.
          else if (result.failure === "task") breaker.recordTaskFailure(key);
          logger.warn(`[route] refused (class=${result.failure}): ${result.message}`);
          if (result.failure === "task") throwTaskFailure(result.message);
          throw new Error(`${result.failure}: ${result.message}`);
        }
        breaker.recordSuccess(key);
        // Unchanged streaks count toward incident inside dispatch: resetting
        // here would wipe them before they ever reach the threshold (D1). An
        // unknown verdict is a detection failure (fail-open): it neither
        // counts nor resets.
        if (isLadderOn(options.strictness)) {
          const effect = (result.value as { effect?: unknown } | null)?.effect;
          if (effect !== "unknown" && effect !== "unchanged") incidents.noteSuccess(key);
        }
        logger.info(`[route] ok action=${action} device=${key}`);
        // This is the ONE place a result reaches the model, so it is the one place
        // a CLOSED notice can be attached - attached twice and the notice stops
        // being one-turn (#62).
        const closure = incidents.takeClosure(key);
        if (closure === undefined) return result.value;
        logger.info(`[route] incident closed device=${key} after ${closure.consecutive_failures} failures`);
        return {
          ...(result.value as Record<string, unknown>),
          incident_closed: closure,
          closure_request: closurePrompt(closure, key),
        };
      } finally {
        if (dedup !== undefined) inflight.delete(dedup);
        lease.release();
      }
    },
  };

  async function dispatch(
    action: DeviceAction,
    args: Record<string, unknown>,
    key: string,
    exec: { signal: AbortSignal },
    isRetry = false,
  ): Promise<DispatchResult> {
    // wait is client-side: no device round-trip, nothing to break.
    if (action === "wait") {
      if (args.duration_ms !== undefined) {
        const n = Number(args.duration_ms);
        if (!Number.isFinite(n) || n < 0) {
          return { ok: false, failure: "task", message: "duration_ms must be a finite number >= 0" };
        }
        // A `wait` longer than the deadline we declare could never report back:
        // the host would abort and swap in TOOL_TIMEOUT while our own ledger had
        // already recorded a success (能力重审-1).
        if (n > WAIT_CEILING_MS) {
          return {
            ok: false,
            failure: "task",
            message: `duration_ms must be <= ${WAIT_CEILING_MS} — the tool's own deadline is ${RUN_DEVICE_ACTION_TIMEOUT_MS}ms, and a longer wait could never report back`,
          };
        }
      }
      const ms = Math.min(WAIT_CEILING_MS, Math.max(0, Number(args.duration_ms ?? 1000)));
      await new Promise<void>((resolve) => {
        // The host deadline is allowed to cut a wait short (能力重审-1): without
        // this the sleep ran to its full length after the model gave up, and
        // `recordSuccess` below contradicted what the model was told.
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          exec.signal.removeEventListener("abort", onAbort);
          resolve();
        }, ms);
        exec.signal.addEventListener("abort", onAbort, { once: true });
        timer.unref?.();
      });
      if (exec.signal.aborted) return { ok: false, failure: "cancelled", message: CANCELLED_MESSAGE };
      return { ok: true, value: { waited_ms: ms } };
    }

    let tool: string;
    let payload: Record<string, unknown>;
    let value: unknown;
    let via: TargetSource | undefined;
    try {
      const call = await buildCall(action, args, key, exec.signal);
      tool = call.tool;
      payload = call.payload;
      value = call.value;
      via = call.via;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // G38: only prefixed errors carry a failure class. An unprefixed throw
      // is our own defect — it must not pollute the breaker as a task failure
      // (the old code read everything-not-environment as task, so plugin bugs
      // counted as task failures and the model retried them).
      if (message.startsWith("environment:")) {
        return { ok: false, failure: "environment", message: message.replace(/^(environment|task):\s*/, "") };
      }
      if (message.startsWith("task:")) {
        return { ok: false, failure: "task", message: message.replace(/^(environment|task):\s*/, "") };
      }
      // An abort that surfaced as a throw (the resolution ladder's unreadable
      // hierarchy) keeps its own class — without this branch it would fall to
      // `internal` and reach the model as a plugin bug (能力重审-1).
      if (message.startsWith("cancelled:")) {
        return { ok: false, failure: "cancelled", message: message.replace(/^cancelled:\s*/, "") };
      }
      return { ok: false, failure: "internal", message };
    }

    let structured: string | undefined;
    // A hierarchy read (T2-b) never reaches the device executor: its answer is
    // built below from the dump. A screenshot answered inside buildCall (T2-c)
    // is likewise already in `value` - and used to be captured twice.
    const nativeHierarchy = action === "get_ui_hierarchy";
    const precomputed = nativeHierarchy || value !== undefined;
    const observesEffect = !nativeHierarchy && EFFECT_OBSERVED_ACTIONS.has(action);
    const before = observesEffect ? await captureFrameSafe(key, exec.signal) : undefined;
    try {
      structured = precomputed ? undefined : await options.execute({ tool, payload }, key, exec.signal);
    } catch (error) {
      if (exec.signal.aborted) {
        return { ok: false, failure: "cancelled", message: CANCELLED_MESSAGE };
      }
      const message = error instanceof Error ? error.message : String(error);
      // G33's rule one layer down: a prefixed answer carries its class, and an
      // unprefixed throw is our defect - it must not be charged to the device
      // (which would open the breaker on a plugin bug) or to the model.
      if (message.startsWith("environment:")) {
        logger.warn(`[route] device call failed (${action}): ${message}`);
        return { ok: false, failure: "environment", message: message.replace(/^environment:\s*/, "") };
      }
      if (message.startsWith("task:")) {
        return { ok: false, failure: "task", message: message.replace(/^task:\s*/, "") };
      }
      logger.warn(`[route] unclassified device failure (${action}): ${message}`);
      return { ok: false, failure: "internal", message };
    }

    const outcome = nativeHierarchy
      ? { ok: true, message: "" }
      : value !== undefined
        ? { ok: true, message: "", value }
        : normalizeOutcome(structured);
    if (!outcome.ok) {
      return { ok: false, failure: classifyMessage(outcome.message), message: outcome.message };
    }
    if (action === "get_ui_hierarchy") {
      // Hand the model OUR numbering: the node's own `index` field is a
      // per-container ordinal and cannot address an element (G42). This is the
      // device dump read straight through `hierarchy`, never an action answer -
      // since T2-b there is no server text left to parse here.
      const elements = await fetchHierarchy(key, exec.signal);
      if (elements === undefined) {
        // Same rule the resolution ladder already applies (G68 ⑤): an
        // unreadable observation is the bypass case, so it must not come back
        // to the model as a successful read of the screen. It is environment,
        // not task (能力重审-1): the dump exited 139 even when it claimed
        // success, so unreadable XML is a delivery failure the model cannot fix
        // by rewording its goal — and an abort landing here is neither.
        if (exec.signal.aborted) {
          return { ok: false, failure: "cancelled", message: CANCELLED_MESSAGE };
        }
        return {
          ok: false,
          failure: "environment",
          message:
            "hierarchy unreadable (not a node list) — the dump did not deliver readable XML; " +
            "check the device connection, or take a screenshot and use {coordinate:[x,y]}",
        };
      }
      // G67: this is the ONLY place the live observation is written. What the
      // model is shown now defines which #N handles exist next turn.
      observations.record(agentOfCall(), key, elements);
      return {
        ok: true,
        value: { hierarchy: formatVisibleElements(elements), element_count: elements.length },
      };
    }
    const observed = {
      ...((value ?? outcome.value) as Record<string, unknown>),
      ...(via === undefined ? {} : { target_source: via }),
    };
    const strictness = strictnessOf(options);
    const ladderOn = isLadderOn(options.strictness);
    const finishSuccess = (val: Record<string, unknown>): DispatchResult => {
      if (isRetry) return { ok: true, value: val };
      if (ladderOn) incidents.noteSuccess(key);
      if (strictness === "strict" && EFFECT_OBSERVED_ACTIONS.has(action)) {
        return { ok: true, value: { ...val, self_check: SELF_CHECK_PROMPT } };
      }
      return { ok: true, value: val };
    };
    // P1-a unchanged verdict (outer call only): pixel guidance, category, and
    // a single incident count for the whole model call, however many device
    // attempts the ladder ran.
    const unchangedVerdict = (category: VerdictCategory): DispatchResult => {
      const val: Record<string, unknown> = {
        ...observed,
        effect: "unchanged",
        category,
        pixel_guidance: PIXEL_GUIDANCE,
      };
      const failures = incidents.noteFailure(key);
      if (failures >= INCIDENT_THRESHOLD) {
        val.incident = { consecutive_failures: failures };
        val.audit_request = incidentPrompt(failures, key, strictness !== "final");
      }
      return { ok: true, value: val };
    };
    if (!observesEffect) {
      return finishSuccess(observed);
    }

    // S11 step 3: the router observes the screen itself instead of trusting the
    // model's reading of it.
    await settle(EFFECT_SETTLE_MS);
    const after = await captureFrameSafe(key, exec.signal);
    const coordinates = Array.isArray(payload.coordinates) ? payload.coordinates : undefined;
    const changed =
      before && after ? await compareFramesSafe(before, after, tool, coordinates) : undefined;
    if (changed !== false) {
      // Changed, or unknown (no verdict: fail-open — no ladder, no incident).
      logger.info(`[route] effect=${changed ? "changed" : "unknown"} action=${action} device=${key}`);
      if (changed === undefined) return { ok: true, value: { ...observed, effect: "unknown" } };
      return finishSuccess({ ...observed, effect: "changed" });
    }
    logger.info(`[route] effect=unchanged action=${action} device=${key}`);
    if (!ladderOn || isRetry) return { ok: true, value: { ...observed, effect: "unchanged" } };

    // P1-a post-execution ladder: re-resolve an index/text target against a
    // FRESH hierarchy and run the action once more as plain coordinates.
    // Coordinate-called and target-less actions go straight to pixel guidance —
    // bursts and launch_app never retry upstream.
    //
    // A transport death here is environment (the server died between tap and
    // re-resolution), not a plugin defect: only genuinely unprefixed throws
    // keep falling through to the execute-level internal bucket (D2).
    let retry: { status: "found"; normalized: [number, number] } | { status: "missing" } | { status: "nontarget" };
    try {
      retry = await reresolveAsCoordinate((args.target ?? {}) as TargetInput, key, exec.signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("environment:")) {
        return { ok: false, failure: "environment", message: message.replace(/^(environment|task):\s*/, "") };
      }
      throw error;
    }
    if (retry.status === "found") {
      const retried = await dispatch(
        action,
        { ...args, target: { coordinate: retry.normalized } },
        key,
        exec,
        true,
      );
      if (!retried.ok) return retried;
      const retriedValue = retried.value as Record<string, unknown>;
      if (retriedValue.effect === "changed") return finishSuccess(retriedValue);
      if (retriedValue.effect === "unknown") return { ok: true, value: retriedValue };
      return unchangedVerdict("general");
    }
    return unchangedVerdict(retry.status === "missing" ? "disappeared" : "general");
  }

  /**
   * Re-resolve the ORIGINAL index/text target against a fresh hierarchy and
   * return it as normalized coordinates for one retry. "missing" means the
   * target is gone (disappeared); "nontarget" means retrying makes no sense
   * (coordinate-called, target-less, or an unreadable hierarchy).
   */
  async function reresolveAsCoordinate(
    tgt: TargetInput,
    deviceKey: string,
    signal: AbortSignal,
  ): Promise<{ status: "found"; normalized: [number, number] } | { status: "missing" } | { status: "nontarget" }> {
    const retryable =
      tgt.coordinate === undefined &&
      (typeof tgt.index === "number" || (typeof tgt.text === "string" && tgt.text.length > 0));
    if (!retryable) return { status: "nontarget" };
    const fresh = await fetchHierarchy(deviceKey, signal);
    if (fresh === undefined) return { status: "nontarget" };
    const hit = resolveTarget(tgt, fresh, deviceKey);
    if (!("center" in hit)) return { status: "missing" };
    const center = hit.center;
    const size = await requireScreenSize(deviceKey, signal);
    const nx = Math.max(0, Math.min(1000, Math.round((center.x / size.width) * 1000)));
    const ny = Math.max(0, Math.min(1000, Math.round((center.y / size.height) * 1000)));
    return { status: "found", normalized: [nx, ny] };
  }

  async function captureFrameSafe(key: string, signal?: AbortSignal): Promise<string | undefined> {
    try {
      return await options.captureFrame?.(key, signal);
    } catch (error) {
      logger.warn(`[route] effect frame failed: ${(error as Error)?.message ?? error}`);
      return undefined;
    }
  }

  async function compareFramesSafe(
    before: string,
    after: string,
    tool: string,
    coordinates?: number[],
  ): Promise<boolean | undefined> {
    try {
      return await options.compareFrames?.(before, after, tool, coordinates);
    } catch (error) {
      logger.warn(`[route] effect comparison failed: ${(error as Error)?.message ?? error}`);
      return undefined;
    }
  }

  async function buildCall(
    action: DeviceAction,
    args: Record<string, unknown>,
    key: string,
    signal: AbortSignal,
  ): Promise<{ tool: string; payload: Record<string, unknown>; value?: unknown; via?: TargetSource }> {
    switch (action) {
      case "click": {
        const { x, y, via } = await resolvePixelTarget(args, key, signal);
        return { tool: "tap", payload: { coordinates: [x, y], times: 1, delay_ms: 100 }, via };
      }
      case "long_press": {
        assertPositiveDuration(args.duration_ms, "duration_ms");
        const { x, y, via } = await resolvePixelTarget(args, key, signal);
        return { tool: "long_press_on", payload: { coordinates: [x, y], duration: Number(args.duration_ms ?? 1000) }, via };
      }
      case "swipe": {
        const size = await requireScreenSize(key, signal);
        const from = (args.target as TargetInput | undefined)?.coordinate;
        const to = args.end_coordinate as number[] | undefined;
        assertNormalizedPair(from, "target.coordinate");
        assertNormalizedPair(to, "end_coordinate");
        assertPositiveDuration(args.duration_ms, "duration_ms");
        return {
          tool: "swipe",
          payload: {
            coordinates: [
              toPixels(from[0] as number, size.width), toPixels(from[1] as number, size.height),
              toPixels(to[0] as number, size.width), toPixels(to[1] as number, size.height),
            ],
            duration: Number(args.duration_ms ?? 400),
          },
        };
      }
      case "input_text": {
        assertNonEmptyString(args.text, "text");
        const { x, y, via } = await resolvePixelTarget(args, key, signal);
        return {
          tool: "focus_and_input_text",
          payload: {
            coordinates: [x, y],
            text: String(args.text ?? ""),
            clear_before_input: args.clear_before_input === true,
          },
          via,
        };
      }
      case "focus_and_clear_text": {
        const { x, y, via } = await resolvePixelTarget(args, key, signal);
        return { tool: "focus_and_clear_text", payload: { coordinates: [x, y] }, via };
      }
      case "press_key": {
        assertNonEmptyString(args.key, "key");
        const keyName = String(args.key ?? "");
        const keycode = mapKeycode(keyName);
        if (keycode === undefined) {
          throw new Error(`task: unknown key "${keyName}" (use home/enter/delete/... or a KEYCODE_* name)`);
        }
        return { tool: "press_key", payload: { keycode } };
      }
      case "back":
        return { tool: "back", payload: {} };
      case "erase_one_char":
        return { tool: "erase_one_char", payload: {} };
      case "launch_app":
        assertNonEmptyString(args.package, "package");
        return { tool: "launch_app", payload: { package_name: String(args.package ?? "") } };
      case "stop_app":
        assertNonEmptyString(args.package, "package");
        return { tool: "stop_app", payload: { package_name: String(args.package ?? "") } };
      case "open_link":
        assertNonEmptyString(args.url, "url");
        return { tool: "open_link", payload: { url: String(args.url ?? "") } };
      case "take_screenshot": {
        // T2-c: `exec-out screencap -p` answers with the PNG itself. No base64
        // round trip through a server, and no second capture afterwards.
        const bytes = await options.capturePng(key, signal);
        if (bytes === undefined) {
          throw new Error("environment: screencap returned no frame — check the device connection (`adb devices`)");
        }
        const size = parseImageSize(bytes);
        const mediaType = imageMediaTypeOf(bytes);
        const image = mediaType ? await options.saveScreenshot?.(bytes, mediaType) : undefined;
        return {
          tool: "take_screenshot",
          payload: {},
          value: {
            screenshot: size ? `captured ${size.width}x${size.height}` : "captured",
            ...(image ? { image } : {}),
          },
        };
      }
      case "get_ui_hierarchy":
        return { tool: "get_ui_hierarchy", payload: {} };
      default:
        // `wait` never reaches buildCall (handled client-side in dispatch).
        throw new Error(`task: unsupported action "${action}"`);
    }
  }
}

function mapKeycode(keyName: string): string | undefined {
  if (/^KEYCODE_[A-Z0-9_]+$/.test(keyName)) return keyName;
  if (/^\d$/.test(keyName)) return `KEYCODE_${keyName}`;
  return KEYCODES[keyName.toLowerCase()];
}

/**
 * The device seam answers in plain strings: "Success" / "Failed" / "Error: ..."
 * (and informational text). `execute` is typed `Promise<string>`, so the shapes
 * the old server answered with - MCP content arrays, result objects - have no
 * producer left and are not handled here.
 */
function normalizeOutcome(answer: string | undefined): {
  ok: boolean;
  message: string;
  value?: unknown;
} {
  const text = (answer ?? "").trim();
  // Two observed error shapes: "Error: ..." and "Error executing tool ...".
  if (/^error\b/i.test(text)) {
    return { ok: false, message: text.replace(/^error\b:?\s*/i, "") };
  }
  if (text === "Failed") return { ok: false, message: "device reported failure" };
  return { ok: true, message: text.slice(0, 400), value: { result: text.slice(0, 4000) } };
}
