/**
 * run_device_action (S11): the single execution tool. The gate/breaker/
 * classification live here — code-enforced, the model cannot bypass them.
 *
 * Contract notes (verified against artemis/mcp/adb_server.py):
 * - the py action server keeps the legacy PIXEL contract; this tool speaks
 *   0-1000 normalized and converts using probe-screenshot dimensions (G24)
 * - results are plain strings ("Success" / "Failed" / "Error: ..."), not
 *   structuredContent; normalizeOutcome below
 * - real tool names: tap / long_press_on / swipe / back / launch_app /
 *   stop_app / open_link / focus_and_input_text / focus_and_clear_text /
 *   erase_one_char / press_key / take_screenshot / get_ui_hierarchy
 */
import type { ActionClient } from "../actionClient.js";
import type { DeviceBreaker } from "../breaker.js";
import type { DeviceGate } from "../gate.js";
import { classifyMessage } from "../classify.js";
import {
  decodeImageBase64,
  imageMediaTypeOf,
  parseImageSize,
  toPixels,
  type ScreenSize,
} from "../coord.js";
import type { DshImageAttachment, ToolDefinitionInput } from "../dsh-types.js";
import { findNodeCenterByIndex, findNodeCenterBySubstring, formatVisibleElements, parseVisibleElements } from "../hierarchy.js";
import { unwrapText } from "../mcpText.js";

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

/**
 * Contract table: agent action → upstream py action-server tool name
 * (legacy stdio contract; conformance test locks this against the live
 * surface fixture). `wait` is client-side and maps to null.
 */
export const ACTION_TO_PY_TOOL: Record<DeviceAction, string | null> = {
  click: "tap",
  long_press: "long_press_on",
  swipe: "swipe",
  input_text: "focus_and_input_text",
  press_key: "press_key",
  back: "back",
  erase_one_char: "erase_one_char",
  focus_and_clear_text: "focus_and_clear_text",
  launch_app: "launch_app",
  stop_app: "stop_app",
  open_link: "open_link",
  take_screenshot: "take_screenshot",
  get_ui_hierarchy: "get_ui_hierarchy",
  wait: null,
};

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
  | { ok: false; failure: "environment" | "task" | "internal"; message: string };

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

export interface RouterOptions {
  gate: DeviceGate;
  breaker: DeviceBreaker;
  client: ActionClient;
  logger: RouterLogger;
  defaultDeviceKey: string;
  /** Screen dimensions for 0-1000 → pixel conversion; probe result cached per key. */
  resolveScreenSize(key: string): Promise<ScreenSize | undefined>;
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
  captureFrame?(): Promise<string | undefined>;
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
  const { gate, breaker, client, logger } = options;

  async function resolvePixelTarget(
    args: Record<string, unknown>,
    key: string,
  ): Promise<{ x: number; y: number }> {
    const target = (args.target ?? {}) as TargetInput;
    if (target.coordinate !== undefined) assertNormalizedPair(target.coordinate, "target.coordinate");
    if (typeof target.coordinate?.[0] === "number" && typeof target.coordinate?.[1] === "number") {
      const size = await requireScreenSize(key);
      return {
        x: toPixels(target.coordinate[0], size.width),
        y: toPixels(target.coordinate[1], size.height),
      };
    }
    const xml = unwrapText(await client.callTool("get_ui_hierarchy", {}));
    if (typeof target.index === "number") {
      const center = findNodeCenterByIndex(xml, target.index);
      if (center) return center;
      throw new Error(`task: no element #${target.index} in the current hierarchy (re-run get_ui_hierarchy and use a #N handle)`);
    }
    if (typeof target.text === "string" && target.text.length > 0) {
      const center = findNodeCenterBySubstring(xml, target.text);
      if (center) return center;
      throw new Error(`task: no element matching text "${target.text}" in the current hierarchy`);
    }
    throw new Error(
      "task: this action needs a target — {coordinate:[x,y]} (0-1000), {index}, or {text}",
    );
  }

  async function requireScreenSize(key: string): Promise<ScreenSize> {
    const size = await options.resolveScreenSize(key);
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
          "Where to act. {index} = the #N handle from the latest get_ui_hierarchy output (preferred); {coordinate:[x,y]} in 0-1000 as fallback; {text} matches text/content-desc/resource-id. Required by click/long_press/input_text/focus_and_clear_text.",
        properties: {
          index: { type: "number", description: "The #N handle from the latest get_ui_hierarchy output." },
          coordinate: { type: "array", items: { type: "number" }, description: "[x,y] normalized to 0-1000." },
          text: { type: "string", description: "Substring to locate the element." },
        },
      },
      end_coordinate: { type: "array", items: { type: "number" }, description: "Swipe end [x,y] normalized to 0-1000." },
      target_description: { type: "string", description: "Short human description of the target, recorded with the action." },
      text: { type: "string", description: "Text for input_text (supports \\n)." },
      clear_before_input: { type: "boolean", description: "input_text: clear existing text first (default append)." },
      duration_ms: { type: "number", description: "Hold/swipe/wait duration in milliseconds." },
      key: { type: "string", description: "press_key key: home/enter/delete/tab/search/menu/app_switch/volume_up/volume_down/power, digits, or a raw KEYCODE_* name." },
      package: { type: "string", description: "Package name for launch_app/stop_app." },
      url: { type: "string", description: "URL for open_link." },
      device_serial: { type: "string", description: "Target device key; omit for the configured default." },
      reason: { type: "string", required: true, description: "One sentence on why this action moves the task forward." },
    },
    timeoutMs: 45_000,
    output: {
      // Payloads are action-dependent (waited_ms for wait, the MCP record for
      // device calls), so the object is explicitly OPEN (official rule:
      // openness is declared, never accidental). render formats whatever came.
      schema: {
        type: "object",
        additionalProperties: true,
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
      const key = (args.device_serial as string | undefined) ?? options.defaultDeviceKey;
      const risk = action === "stop_app" ? "risky" : "normal";
      logger.info(`[route] action=${action} device=${key} risk=${risk} reason=${String(args.reason)}`);
      options.onAction?.();

      if (!breaker.canAdmit(key)) {
        logger.warn(`[route] blocked by breaker: device=${key}`);
        throw new Error(
          `environment: device ${key} is cooling down after environment-level failures — report progress and continue after the next message`,
        );
      }

      const handle = await gate.acquire(key, exec.signal);
      try {
        const result = await dispatch(action, args, key, exec).catch((error) => {
          // Anything escaping dispatch is our own bug, not a device or task
          // signal (G38) — except a user abort, which keeps its meaning.
          if (exec.signal.aborted) {
            return { ok: false, failure: "task", message: "action cancelled by the user" } as const;
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
          else breaker.recordTaskFailure(key);
          logger.warn(`[route] refused (class=${result.failure}): ${result.message}`);
          throw new Error(`${result.failure}: ${result.message}`);
        }
        breaker.recordSuccess(key);
        logger.info(`[route] ok action=${action} device=${key}`);
        return result.value;
      } finally {
        handle.release();
      }
    },
  };

  async function dispatch(
    action: DeviceAction,
    args: Record<string, unknown>,
    key: string,
    exec: { signal: AbortSignal },
  ): Promise<DispatchResult> {
    // wait is client-side: no device round-trip, nothing to break.
    if (action === "wait") {
      if (args.duration_ms !== undefined) {
        const n = Number(args.duration_ms);
        if (!Number.isFinite(n) || n < 0) {
          return { ok: false, failure: "task", message: "duration_ms must be a finite number >= 0" };
        }
      }
      const ms = Math.min(60_000, Math.max(0, Number(args.duration_ms ?? 1000)));
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
      });
      return { ok: true, value: { waited_ms: ms } };
    }

    let tool: string;
    let payload: Record<string, unknown>;
    let value: unknown;
    try {
      const call = await buildCall(action, args, key);
      tool = call.tool;
      payload = call.payload;
      value = call.value;
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
      return { ok: false, failure: "internal", message };
    }

    let structured: unknown;
    const observesEffect = EFFECT_OBSERVED_ACTIONS.has(action);
    const before = observesEffect ? await captureFrameSafe() : undefined;
    try {
      structured = await client.callTool(tool, payload);
    } catch (error) {
      if (exec.signal.aborted) {
        return { ok: false, failure: "task", message: "action cancelled by the user" };
      }
      const message = `action transport failed: ${String(error)}`;
      logger.warn(`[route] ${message}`);
      return { ok: false, failure: "environment", message };
    }

    const outcome = normalizeOutcome(structured);
    if (!outcome.ok) {
      return { ok: false, failure: classifyMessage(outcome.message), message: outcome.message };
    }
    if (action === "get_ui_hierarchy") {
      // Hand the model OUR numbering: the server's own `index` field is a
      // per-container ordinal and cannot address an element (G42). Read the
      // untruncated text — normalizeOutcome clips at 4000 chars, which would
      // cut a real hierarchy dump mid-JSON and make it unparseable.
      const elements = parseVisibleElements(unwrapText(structured));
      if (elements) {
        return {
          ok: true,
          value: { hierarchy: formatVisibleElements(elements), element_count: elements.length },
        };
      }
    }
    const observed = (value ?? outcome.value) as Record<string, unknown>;
    if (!observesEffect) {
      return { ok: true, value: observed };
    }

    // S11 step 3: the router observes the screen itself instead of trusting the
    // model's reading of it. `unchanged` after a mutating action is the signal
    // the P1 validator ladder escalates on; for now it is reported verbatim.
    await settle(EFFECT_SETTLE_MS);
    const after = await captureFrameSafe();
    const coordinates = Array.isArray(payload.coordinates) ? payload.coordinates : undefined;
    const changed =
      before && after ? await compareFramesSafe(before, after, tool, coordinates) : undefined;
    const effect = changed === undefined ? "unknown" : changed ? "changed" : "unchanged";
    logger.info(`[route] effect=${effect} action=${action} device=${key}`);
    return { ok: true, value: { ...observed, effect } };
  }

  async function captureFrameSafe(): Promise<string | undefined> {
    try {
      return await options.captureFrame?.();
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
  ): Promise<{ tool: string; payload: Record<string, unknown>; value?: unknown }> {
    switch (action) {
      case "click": {
        const { x, y } = await resolvePixelTarget(args, key);
        return { tool: "tap", payload: { coordinates: [x, y], times: 1, delay_ms: 100 } };
      }
      case "long_press": {
        assertPositiveDuration(args.duration_ms, "duration_ms");
        const { x, y } = await resolvePixelTarget(args, key);
        return { tool: "long_press_on", payload: { coordinates: [x, y], duration: Number(args.duration_ms ?? 1000) } };
      }
      case "swipe": {
        const size = await requireScreenSize(key);
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
        const { x, y } = await resolvePixelTarget(args, key);
        return {
          tool: "focus_and_input_text",
          payload: {
            coordinates: [x, y],
            text: String(args.text ?? ""),
            clear_before_input: args.clear_before_input === true,
          },
        };
      }
      case "focus_and_clear_text": {
        const { x, y } = await resolvePixelTarget(args, key);
        return { tool: "focus_and_clear_text", payload: { coordinates: [x, y] } };
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
        const base64 = unwrapText(await client.callTool("take_screenshot", {}));
        if (/^errorb/i.test(base64)) {
          throw new Error(`environment: ${base64.replace(/^errorb:?s*/i, "").trim()}`);
        }
        const bytes = decodeImageBase64(base64);
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
 * The legacy server answers in plain strings: "Success" / "Failed" /
 * "Error: ..." (and informational text). Normalize to one shape.
 */
function normalizeOutcome(structured: unknown): {
  ok: boolean;
  message: string;
  value?: unknown;
} {
  if (typeof structured === "string") {
    const text = structured.trim();
    // Two observed error shapes: "Error: ..." and "Error executing tool ...".
    if (/^error\b/i.test(text)) {
      return { ok: false, message: text.replace(/^error\b:?\s*/i, "") };
    }
    if (text === "Failed") return { ok: false, message: "device reported failure" };
    return { ok: true, message: text.slice(0, 400), value: { result: text.slice(0, 4000) } };
  }
  const record = (structured ?? {}) as Record<string, unknown>;
  if (record.ok === true) return { ok: true, message: "", value: record };
  if (record.ok === false) {
    return { ok: false, message: typeof record.message === "string" ? record.message : "device refused" };
  }
  if (Array.isArray(record.content)) {
    return normalizeOutcome(unwrapText(record));
  }
  if (typeof record.result === "string") return normalizeOutcome(record.result);
  return { ok: true, message: "", value: record };
}
