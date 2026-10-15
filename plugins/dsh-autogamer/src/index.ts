/**
 * dsh-autogamer plugin entry (rectified P1-P4, docs/TODO.md §六).
 * Contracts verified through declared surfaces only (dsh --dump-config-schema,
 * dsh --help, shipped READMEs — no asar reading, user ruling 2026-10-10): a
 * cordis plugin module exports {name, inject, Config?, apply}; Config must be
 * a native Schemastery schema; tools register through ctx.tools.register.
 */
import { DeviceBreaker } from "./breaker.js";
import { DeviceGate } from "./gate.js";
import { DevicePool, type PoolDevice } from "./devicePool.js";
import { configuredScreenSize, type ScreenSize } from "./coord.js";
import { messageId, type DshAgent, type DshContext, type DshImageAttachment, type DshUserMessage } from "./dsh-types.js";
import { TaskCache } from "./task/cache.js";
import { registerTaskProjection } from "./task/projection.js";
import { REPORT_NUDGE, TurnLedger } from "./turnLedger.js";
import { HostOutcomeLedger, OUR_TOOL_NAMES, hostOutcomeOf } from "./hostOutcome.js";
import { defineReportTaskStatus } from "./tools/reportTaskStatus.js";
import { defineRunDeviceAction, deviceKeyOf, ActionIncidents } from "./tools/runDeviceAction.js";
import { defineGetDeviceState } from "./tools/getDeviceState.js";
import { defineRunTask } from "./tools/runTask.js";
import { defineManageTask } from "./tools/manageTask.js";
import { defineInspectTrace } from "./tools/inspectTrace.js";
import { defineDiagnose } from "./tools/diagnose.js";
import { createPreflight } from "./env/preflight.js";
import { createArtemisBackend } from "./artemis/adapter.js";
import { diagnoseDevice } from "./device/diagnose.js";
import { createOcrEngine, missingLanguageData, OCR_DEFAULT_LANGS } from "./ocr/recognize.js";
import { judgeEffectChanged } from "./effect/diff.js";
import { buildRoster, enumerateTransports, screenIsLocked } from "./device/roster.js";
import { createAdbProbe } from "./device/state.js";
import { runNativeAction } from "./device/act.js";
import { readHierarchyXml, readUiAutomationOccupants } from "./device/hierarchy.js";
import { LiveObservations } from "./observations.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

export const name = "dsh-autogamer";

/**
 * Declaring Config is REQUIRED for the loader to apply our patch row's
 * config: without a schema the row's config is treated as absent
 * (Config.listConfigs status=absent) and the preset-scope child mount
 * silently skips it — the root cause of the missing-tools spike finding.
 * The schema must be native Schemastery (dsh rejects foreign schema objects
 * with "Config is not a native Schemastery schema"). Typed as `object`
 * because schemastery exports no nameable Schema type from this package.
 */
export const Config: object = z.object({
  defaultDeviceKey: z.string().default("default"),
  allowedFails: z.number().default(1),
  breakerCooldownMs: z.number().default(30_000),
  actionCallTimeoutMs: z.number().default(30_000),
  screenSize: z.tuple([z.number(), z.number()]),
  /**
   * G3/G28 auto pool roster. Empty (the default) keeps the historical behaviour: every
   * device-less call shares `defaultDeviceKey`. Filling it makes auto calls park on one free
   * device each (G28) instead of queueing the whole fleet on one key.
   */
  devices: z.array(z.string()).default([]),
  /** G28 ceiling on devices admitted at once, across explicit and auto calls; 0 (default) = unlimited. */
  maxConcurrentDevices: z.number().default(0),
  /**
   * G64: ask the action surface (`list_devices`) who is attached instead of relying on `devices`.
   * Default **false** on purpose -- turning discovery on changes scheduling semantics (auto spreads
   * across machines instead of sharing one key), so it stays an explicit operator decision (#55).
   */
  discoverDevices: z.boolean().default(false),
  /**
   * dsh-autogamer rectification: the optional external ARTEMIS provider (spec
   * §一.3). Empty by default — **the plugin ships, installs and configures no
   * python and no provider**: an operator who runs one names its argv here, and
   * `autogamer_diagnose` is the only thing that will ever connect to it.
   * No `.description()` calls on purpose — that builder form is unverified on
   * the installed schemastery, and the settings auto-form works without
   * descriptions. `traceRetentionDays` and `defaultTimeoutSeconds` are
   * reserved (spec-required, no consumer yet: no retention sweeper and no
   * task-lifetime timeout policy exist).
   */
  artemisMcpCommand: z.array(z.string()).default([]),
  defaultProfile: z.union(["flash", "pro"]).default("flash"),
  defaultTimeoutSeconds: z.number().default(1800),
  defaultDeviceSerial: z.string().default(""),
  autoPreflight: z.boolean().default(true),
  traceRetentionDays: z.number().default(7),
  /** P1-a validator strictness (S11 step 5); default "final" like upstream. */
  strictness: z.union(["off", "final", "checkpoints", "strict"]).default("final"),
  /**
   * T5: built-in offline OCR. On by default — the language data ships with the
   * package, so "enabled" costs the operator nothing. It only ever answers a
   * `{text}` target the hierarchy could not answer, and a failure is a missing
   * extra answer, never a failed action.
   */
  ocrEnabled: z.boolean().default(true),
  ocrLanguages: z.string().default("eng+chi_sim"),
  ocrTimeoutMs: z.number().default(8_000),
});

/**
 * `tools` and `attachments` must BOTH be declared: cordis refuses the property
 * GET itself ("cannot get property \"attachments\" without inject", observed
 * live 2026-10-11), so an undeclared service is a runtime error, not an
 * undefined lookup. Declaring one that cannot resolve in this scope leaves the
 * row pending — the G30 shape — so this list is a live-verified claim, not an
 * aspiration.
 */
export const inject = ["tools", "attachments", "agents"];

/**
 * G90: how long a probed screen size stays trusted. A capture is ~200ms and one
 * turn asks for the space repeatedly, so it is cached; a rotation must not stay
 * invisible for the rest of the session, so the cache expires.
 */
export const SCREEN_SIZE_TTL_MS = 5_000;
// NOTE (reviewed P5 eve): the scheme also asks for 'settings' here, but that
// service is upstream-only (not installed) and an unresolvable inject in
// preset scope leaves the row pending — the G30 shape. It waits for a live
// mount proof, together with the settings section and the client settings
// card (both deferred for the same reason).

/** Makes each nudge's message id unique within this process, across agents. */
let nudgeSequence = 0;

export type PluginConfig = {
  defaultDeviceKey: string;
  allowedFails: number;
  breakerCooldownMs: number;
  actionCallTimeoutMs: number;
  screenSize?: readonly unknown[];
  strictness?: "off" | "final" | "checkpoints" | "strict";
  devices?: string[];
  maxConcurrentDevices?: number;
  discoverDevices?: boolean;
  artemisMcpCommand?: string[];
  defaultProfile?: "flash" | "pro";
  defaultTimeoutSeconds?: number;
  defaultDeviceSerial?: string;
  autoPreflight?: boolean;
  traceRetentionDays?: number;
  ocrEnabled?: boolean;
  ocrLanguages?: string;
  ocrTimeoutMs?: number;
};

export async function apply(ctx: DshContext, config: PluginConfig = {} as PluginConfig): Promise<void> {
  const gate = new DeviceGate();
  const breaker = new DeviceBreaker({
    allowedFails: config.allowedFails,
    cooldownMs: config.breakerCooldownMs,
  });
  const pool = new DevicePool({
    gate,
    defaultDeviceKey: config.defaultDeviceKey,
    devices: config.devices ?? [],
    maxConcurrentDevices: config.maxConcurrentDevices ?? 0,
    isCoolingDown: (key) => !breaker.canAdmit(key),
    rosterSource: config.discoverDevices ? () => enumerateRoster() : undefined,
  });
  const incidents = new ActionIncidents();
  // T4-c (G93): the scrcpy mirror manager is gone. It was constructed and
  // disposed with nothing ever driving it, and its server binary had to be
  // supplied by the operator - both contrary to what this plugin ships. A live
  // screen belongs in a host UI slot (R18) as its own capability.
  // dsh-autogamer rectification (Phase 1) → T2-f: the external ARTEMIS backend
  // is no longer constructed on any tool path. T4-a: the preflight asks only
  // what the native tools actually touch (adb + an attached device).
  const preflight = createPreflight();
  const checkEnv = () => preflight.run();
  if (config.autoPreflight !== false) {
    // No ctx.on('ready') exists in the typings (Phase 0): warm the cache
    // without blocking the mount instead.
    void checkEnv().catch(() => undefined);
  }
  // G67: which #N handles exist is per (agent, device) and per plugin instance - the
  // list the model was last shown, nothing more.
  const observations = new LiveObservations();
  // T2-c/d/e: the action surface runs over adb (`src/device/`). T4-b took the
  // action-server transport out with it: no `ActionClient`, no server command,
  // no environment configuration for a server that is never started.
  const probe = createAdbProbe();
  /**
   * T5: one lazily-started OCR worker for the plugin's lifetime (measured: 169ms
   * to boot, ~600ms per frame, and it reads the language data out of this
   * package). Off by config, or unreachable, the text target simply keeps the
   * answer it used to get.
   */
  const ocr =
    config.ocrEnabled === false
      ? undefined
      : createOcrEngine({
          langs: config.ocrLanguages,
          timeoutMs: config.ocrTimeoutMs,
          // Deferred: `logger` is declared below, and the engine must not see a
          // binding that has not been initialised yet.
          logger: { warn: (message: string) => logger.warn(message) },
        });

  const screenSizeCache = new Map<string, { size: ScreenSize; at: number }>();
  /**
   * G64 roster, native since T2-a: `adb devices -l`, folded by `android_id` so one
   * emulator reachable over several transports stays ONE device (G75 - counted
   * twice it would double every gate, concurrency ceiling and breaker).
   *
   * `undefined` still means "could not ask", kept distinct from "asked, nothing
   * attached" for the reason the action-server path recorded: a transient adb
   * failure must not look like an empty fleet.
   *
   * `isBusy` is reported false: the python pool's cross-process file mutex has no
   * replacement, and G89 was closed in T4 as an accepted boundary rather than
   * implemented - the execution model here is one plugin instance inside one host
   * process, where the FIFO gate and the breaker do hold. The mutex guarded a
   * competition (several python entry points grabbing one device) that this
   * branch does not have; if two hosts ever drive one device at once, that is the
   * condition to reopen it.
   */
  async function enumerateRoster(): Promise<PoolDevice[] | undefined> {
    const transports = await enumerateTransports();
    if (transports === undefined) {
      logger.warn("[pool] adb could not answer the device list; keeping the previous roster");
      return undefined;
    }
    const devices: PoolDevice[] = [];
    for (const entry of await buildRoster(transports)) {
      const aliases = entry.transports.filter((serial) => serial !== entry.serial);
      devices.push({
        serial: entry.serial,
        state: entry.state,
        isBusy: false,
        ...(aliases.length > 0 ? { aliases } : {}),
        // Only an attached device can be asked; offline / unauthorized answers "cannot
        // tell", which admission rejects (G65's distinction, not a collapse).
        isLocked: entry.state === "device" ? await screenIsLocked(entry.serial) : null,
      });
    }
    return devices;
  }

  /**
   * Which adb serial a device key addresses. Once a roster exists the pool hands
   * out real serials; without one the key is the `defaultDeviceKey` label, which
   * is not a serial - so the probe names no device and adb answers for the single
   * attached one. undefined serial means "do not name one", never "guess".
   */
  function serialOfKey(key: string): string | undefined {
    if (key.length > 0 && key !== config.defaultDeviceKey) return key;
    const configured = config.defaultDeviceSerial;
    return typeof configured === "string" && configured.length > 0 ? configured : undefined;
  }

  /**
   * G76: the size 0-1000 coordinates are converted against, taken from the
   * device frame itself (the IHDR of `exec-out screencap -p`, measured as the
   * same space the action server's own screenshots and the hierarchy bounds use).
   *
   * A hand-filled `screenSize` is trusted only after it agrees with that frame:
   * `wm size` reports 900x1600 while the frame of the same rotated emulator is
   * 1600x900, so an operator who copied the wm number would silently put every
   * tap half a screen off. The refusal is `environment:` so the breaker stops
   * hammering the device until the config is fixed.
   *
   * The probed size is cached per key for `SCREEN_SIZE_TTL_MS` (G90): a capture
   * costs ~200ms and a turn asks repeatedly, but a rotation mid-session must not
   * keep the old space forever - the TTL is what bounds that. The configured
   * value is still checked against whatever frame is current at the time.
   */
  async function resolveScreenSize(key: string, signal?: AbortSignal): Promise<ScreenSize | undefined> {
    const configured = configuredScreenSize(config.screenSize);
    const now = Date.now();
    const cached = screenSizeCache.get(key);
    let probed = cached !== undefined && now - cached.at < SCREEN_SIZE_TTL_MS ? cached.size : undefined;
    if (probed === undefined) {
      probed = await probe.frame(serialOfKey(key), { signal });
      if (probed) screenSizeCache.set(key, { size: probed, at: now });
    }
    if (configured) {
      if (probed && (probed.width !== configured.width || probed.height !== configured.height)) {
        throw new Error(
          `environment: configured screenSize ${configured.width}x${configured.height} contradicts ` +
            `the device frame ${probed.width}x${probed.height} — coordinates would land in the wrong place. ` +
            `Fix: set screenSize to ${probed.width}x${probed.height}, or leave it empty to follow the frame.`,
        );
      }
      return configured;
    }
    return probed;
  }

  const logger = {
    info: (message: string) => ctx.logger.info(message),
    warn: (message: string) => ctx.logger.warn(message),
  };

  /**
   * Screenshots go to the host attachment store so the model gets a real image
   * block and the log keeps only the content-addressed reference. Shared by the
   * action router and the device-state read: one media path, one failure rule.
   */
  async function saveDeviceScreenshot(
    bytes: Uint8Array,
    mediaType: DshImageAttachment["mediaType"],
  ): Promise<DshImageAttachment | undefined> {
    try {
      const [ref] = await ctx.attachments.saveImages([{ data: bytes, mediaType, name: "device-screenshot" }]);
      return ref;
    } catch (error) {
      // Admission can refuse one image (byte / pixel / dimension caps, or a
      // header that fails to decode). A screenshot must still report its
      // dimensions rather than fail the action.
      logger.warn(`[media] attachment admission failed: ${(error as Error)?.message ?? error}`);
      return undefined;
    }
  }

  // Raw ctx.tools.register() expects parameters to ALREADY be a full JSON
  // Schema (the official MCP path passes server schemas verbatim); a named
  // spec map goes through defineTool, whose parameterSchemaSpecToJsonSchema
  // emits the object-rooted wire schema and validates args on execute (same
  // form as the shipped tool-jobs). Registering the bare map produced
  // `parameters.type` != "object" on the wire and the LLM API rejected the
  // whole request with 400 (changelogs #10). The explicit <any, any>
  // instantiation skips const-generics inference, which exceeds TS's stack on
  // our 13-parameter literal; the official compiler still validates the whole
  // shape when this runs.
  // G44: the report tool has to be the only way a turn ends. `session/event` is
  // scope-filtered, so the listener registers with { global: true } - without it
  // a preset-scoped listener only sees tool events and turn/end never arrives
  // (packages/core/scope/README.zh.md:75; cordis EventOptions.global).
  const ledger = new TurnLedger();
  const agentIdOfCall = (): string | undefined => {
    try {
      return ctx.agents.currentInitiator?.()?.id;
    } catch (error) {
      logger.warn(`[turn] initiator lookup failed: ${(error as Error)?.message ?? error}`);
      return undefined;
    }
  };
  /** The agent this tool call belongs to; the task read model keys on its id. */
  const callingAgent = (): DshAgent | undefined => {
    try {
      return ctx.agents.currentInitiator?.();
    } catch (error) {
      logger.warn(`[task] initiator lookup failed: ${(error as Error)?.message ?? error}`);
      return undefined;
    }
  };

  ctx.on(
    "session/event",
    (session, event) => {
      if (event?.type !== "turn/end") return;
      if (!ledger.consumeTurn(session.id)) return;
      const agent = ctx.agents.get(session.id);
      if (!agent) {
        logger.warn(`[turn] ${session.id} ended without a report but no agent handle`);
        return;
      }
      logger.warn(`[turn] ${session.id} acted without reporting; nudging once`);
      const message: DshUserMessage = {
        id: messageId(`autogamer-nudge-${session.id}-${++nudgeSequence}`),
        role: "user",
        content: [{ type: "text", text: REPORT_NUDGE }],
        // A self-declared kind: the retired {kind:'plugin', plugin} wrapper is
        // rejected by session format V4 (rule R17), and dsh-llm declares
        // MessageSourceMap merge-extensible for exactly this case.
        source: { kind: "autogamer", reason: "unreported-turn" },
      };
      // Deferred out of the emit on purpose: Session.append rejects anything
      // reentered while its acceptance/publication boundary is open
      // (docs/subsystems/session.zh.md:609 "an append reentered while this
      // acceptance/publication boundary is open also rejects before the log
      // changes"), and calling followup() straight from this listener hit
      // exactly that - "session append cannot reenter while another append is
      // being published". The official round-driver never appends from its
      // turn/end handler either; it only records state.
      setTimeout(() => {
        try {
          agent.followup(message);
        } catch (error) {
          logger.warn(`[turn] followup refused: ${(error as Error)?.message ?? error}`);
        }
      }, 0);
    },
    { global: true },
  );

  // 能力重审-3: the host's own substitutions are invisible inside a tool body —
  // our body is what gets replaced. `tools/result` is the emit observer that sees
  // the final outcome the model receives, so this is where a deadline the host
  // armed, or a caller cancellation, can be counted at all.
  // Counted only, never acted on: no breaker, no incident (see src/hostOutcome.ts).
  const hostOutcomes = new HostOutcomeLedger();
  ctx.on(
    "tools/result",
    (exec, result) => {
      // The emit spans the whole registry, so another plugin's timeout is not our
      // device being slow.
      if (!OUR_TOOL_NAMES.includes(exec.name)) return;
      const outcome = hostOutcomeOf(result);
      if (outcome === undefined) return;
      hostOutcomes.record(exec.name, outcome, exec.callId);
      logger.warn(`[host-outcome] ${exec.name} (${exec.callId}): the model was told "${outcome}" instead of our own result`);
    },
    { global: true },
  );

  // S4 熔断拒绝出口（R13/G33）：冷却期的拒绝走单调同步 guard，不写进工具正文。
  // 只看 run_device_action 调用——别家工具不动，report_task_status（终态出口）永不拦。
  // plain-context 注册即全局生效；agent-less 执行同样被拒（guardReason 先读全局层）。
  ctx.tools.guard((execution) => {
    if (execution.name !== "run_device_action") return undefined;
    const args = (execution.arguments as Record<string, unknown> | null) ?? {};
    const named = args.device_serial;
    const serial = typeof named === "string" && named.length > 0 ? pool.canonicalKey(named) : undefined;
    if (serial !== undefined) {
      // Two independent py submission gates, in py's order (tasks.py:140 then :160): readiness
      // first, then cooldown. Neither reads a device here -- the guard is synchronous (R13), so it
      // consumes the roster snapshot `refreshRoster` last refreshed.
      const notReady = pool.admissibleExplicit(serial);
      if (notReady !== undefined) return `${notReady} — pick another device or report blocked`;
      if (breaker.canAdmit(serial)) return undefined;
      return `device ${serial} is cooling down after environment-level failures — report progress and continue after the next message`;
    }
    // Auto has no device until the pool assigns one, so the only honest refusal here is "nowhere
    // to go": any roster device being free of cooldown admits the call and the router re-checks.
    if (!pool.refusesAuto()) return undefined;
    return `every configured device is cooling down after environment-level failures — report progress and continue after the next message`;
  });

  ctx.tools.register(defineTool<any, any>(defineRunDeviceAction({
    pool,
    breaker,
    logger,
    defaultDeviceKey: config.defaultDeviceKey,
    strictness: config.strictness,
    incidents,
    observations,
    resolveScreenSize,
    // T2-b: the hierarchy comes off the device itself (uiautomator dump + the
    // file read back), so `get_ui_hierarchy` is no longer an action-server call.
    execute: (call, key, signal) => runNativeAction(call, serialOfKey(key), { signal }),
    capturePng: (key, signal) => probe.capture(serialOfKey(key), { signal }),
    hierarchy: (key, signal) => readHierarchyXml(serialOfKey(key), { signal }),
    // T5: OCR reads the same frame the effect judge compares, so no second
    // capture appears on the text path.
    ocr: ocr
      ? async (key, signal) => {
          const png = await probe.capture(serialOfKey(key), { signal });
          return png === undefined ? undefined : ocr.recognize(png, { signal });
        }
      : undefined,
    onAction: () => ledger.markActed(agentIdOfCall()),
    agentIdOfCall,
    // Screenshots go to the host attachment store so the model gets a real
    // image block and the log keeps only the content-addressed reference.
    // Effect observation runs entirely in-tool: the router looks at the screen
    // itself rather than trusting the model's account of what happened. Since
    // T3 the verdict is computed here from the frames themselves (G84), so the
    // action server is no longer consulted for it.
    captureFrame: async (key, signal) => {
      const png = await probe.capture(serialOfKey(key), { signal });
      return png?.toString("base64");
    },
    compareFrames: async (before, after, action, coordinates) => {
      const verdict = judgeEffectChanged(
        Buffer.from(before, "base64"),
        Buffer.from(after, "base64"),
        action,
        coordinates,
      );
      if (verdict === undefined) {
        logger.warn(`[route] effect comparison inconclusive: frames are not decodable screenshots (action=${action})`);
      }
      return verdict;
    },
    saveScreenshot: saveDeviceScreenshot,
  })));
  ctx.tools.register(
    defineTool<any, any>(defineReportTaskStatus(() => ledger.markReported(agentIdOfCall()))),
  );
  ctx.tools.register(
    defineTool<any, any>(
      defineGetDeviceState({
        probe,
        checkEnv,
        defaultDeviceSerial: config.defaultDeviceSerial ?? "",
        saveScreenshot: saveDeviceScreenshot,
      }),
    ),
  );
  // T1/G82: the task tools read the session's own projection instead of driving
  // an external engine. The cache is the derived read side - the projection
  // registry owns the fold and publishes on change; nothing here re-reads the
  // log or keeps a second copy of the truth.
  const taskCache = new TaskCache();
  if (!registerTaskProjection(ctx, taskCache)) {
    logger.warn("[task] no sessionProjections registry: the task tools will answer 'unknown'");
  }
  let taskSequence = 0;
  ctx.tools.register(
    defineTool<any, any>(
      defineRunTask({
        // A task needs a device, not the optional provider stack (T2-f).
        checkEnv,
        defaultDeviceSerial: config.defaultDeviceSerial ?? "",
        defaultProfile: config.defaultProfile ?? "flash",
        newTaskId: () => `autogamer-task-${(taskSequence += 1)}`,
        now: () => new Date(),
      }),
    ),
  );
  const taskViewerDeps = {
    store: taskCache,
    checkEnv,
    sessionKey: () => agentIdOfCall(),
  };
  ctx.tools.register(
    defineTool<any, any>(
      defineManageTask({
        ...taskViewerDeps,
        // Steering appends to the calling agent's durable context: it enters
        // the next admitted step rather than waking anything (R17), and the
        // caller is that agent, so there is nothing to wake.
        steer: (instruction) => {
          const agent = callingAgent();
          if (agent === undefined) {
            logger.warn("[task] steer refused: no agent handle for this call");
            return;
          }
          if (typeof agent.inject !== "function") {
            logger.warn("[task] steer refused: this host's agent exposes no inject (mirror is 🔶)");
            return;
          }
          try {
            agent.inject({
              content: [{ type: "text", text: instruction }],
              source: { kind: "autogamer", reason: "task-steering" },
            });
          } catch (error) {
            logger.warn(`[task] steer refused: ${(error as Error)?.message ?? error}`);
          }
        },
      }),
    ),
  );
  ctx.tools.register(defineTool<any, any>(defineInspectTrace(taskViewerDeps)));
  // T2-f: the diagnosis is assembled from local probes over adb. The provider
  // adapter (`src/artemis/`) is no longer constructed by any tool path - see
  // §七's audit note; deleting the module and its config fields is T4's call.
  ctx.tools.register(
    defineTool<any, any>(
      defineDiagnose({
        diagnose: (serial, options) => diagnoseDevice(serial, { probe, ...options }),
        checkEnv,
        defaultDeviceSerial: config.defaultDeviceSerial ?? "",
        // The tool has already resolved which device to ask (arg → config → the
        // one attached device), so no key mapping happens here.
        capturePng: (serial, signal) => probe.capture(serial, { signal }),
        saveScreenshot: saveDeviceScreenshot,
        // T5: readiness is the packaged-data fact plus, when a device answers,
        // one real frame put through the engine. Reported, never gated: a broken
        // OCR costs {text} its second source and nothing else.
        // T4-b: the optional external provider's only consumer. Nothing is
        // spawned unless an operator names a command, and a provider that does
        // not answer is a line in the report rather than a failed diagnosis.
        provider: async (serial, signal) => {
          const command = config.artemisMcpCommand ?? [];
          if (command.length === 0) return { configured: false };
          const backend = createArtemisBackend({
            command,
            callTimeoutMs: config.actionCallTimeoutMs ?? 30_000,
          });
          try {
            await backend.getDeviceState(serial === undefined ? {} : { deviceSerial: serial }, signal);
            return { configured: true, command, reachable: true };
          } catch (error) {
            return {
              configured: true,
              command,
              reachable: false,
              error: String((error as Error)?.message ?? error),
            };
          } finally {
            await backend.dispose();
          }
        },
        // 能力重审-2: name the process holding the one UiAutomation connection, so
        // a silent hierarchy failure has an owner. One `ps` read, no policy: the
        // plugin never stops or uninstalls someone else's client (R19).
        hierarchyStatus: async (serial, signal) => {
          const readout = await readUiAutomationOccupants(serial, { signal });
          return { state: readout.state, names: readout.names };
        },
        // 能力重审-3: what the host substituted for our answer, counted at the
        // observer above. Synchronous on purpose — it reads plugin state, so there
        // is no I/O to await and no serial to resolve.
        hostOutcomes: () => hostOutcomes.snapshot(),
        ocrStatus: async (serial, signal) => {
          const langs = (config.ocrLanguages ?? OCR_DEFAULT_LANGS)
            .split("+")
            .map((lang) => lang.trim())
            .filter(Boolean);
          if (ocr === undefined) {
            return { enabled: false, langs, missingData: missingLanguageData(langs) };
          }
          const status = ocr.status();
          const png = await probe.capture(serial, { signal });
          if (png === undefined) {
            return { enabled: true, langs: status.langs, missingData: status.missingData };
          }
          const page = await ocr.recognize(png, { signal });
          return {
            enabled: true,
            langs: status.langs,
            missingData: status.missingData,
            ...(page === undefined ? {} : { frame: { hits: page.hits.length, ms: page.ms } }),
          };
        },
      }),
    ),
  );

  // Tool registration ownership belongs to the tools registry itself (its
  // entries are cordis effects on this plugin's fiber, exactly like the
  // shipped tool-jobs plugin — it registers bare, with no effect wrapper).
  // The one resource needing an explicit teardown is the OCR worker (T4-c took
  // the mirror manager with it). Cordis effect() runs the callback NOW and keeps
  // its RETURNED function as the disposer; passing teardown as the callback
  // disposed our own tools during apply() (changelogs #10, the G30 root cause).
  ctx.effect?.(() => () => {
    void ocr?.dispose();
  });
}
