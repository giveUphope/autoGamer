/**
 * dsh-autogamer plugin entry (rectified P1-P4, docs/TODO.md §六).
 * Contracts verified through declared surfaces only (dsh --dump-config-schema,
 * dsh --help, shipped READMEs — no asar reading, user ruling 2026-10-10): a
 * cordis plugin module exports {name, inject, Config?, apply}; Config must be
 * a native Schemastery schema; tools register through ctx.tools.register.
 */
import { ActionClient } from "./actionClient.js";
import { DeviceBreaker } from "./breaker.js";
import { DeviceGate } from "./gate.js";
import { DevicePool, type PoolDevice } from "./devicePool.js";
import { configuredScreenSize, type ScreenSize } from "./coord.js";
import { unwrapText } from "./mcpText.js";
import { messageId, type DshAgent, type DshContext, type DshImageAttachment, type DshUserMessage } from "./dsh-types.js";
import { TaskCache } from "./task/cache.js";
import { registerTaskProjection } from "./task/projection.js";
import { REPORT_NUDGE, TurnLedger } from "./turnLedger.js";
import { defineReportTaskStatus } from "./tools/reportTaskStatus.js";
import { defineRunDeviceAction, deviceKeyOf, ActionIncidents } from "./tools/runDeviceAction.js";
import { defineGetDeviceState } from "./tools/getDeviceState.js";
import { defineRunTask } from "./tools/runTask.js";
import { defineManageTask } from "./tools/manageTask.js";
import { defineInspectTrace } from "./tools/inspectTrace.js";
import { defineDiagnose } from "./tools/diagnose.js";
import { createArtemisBackend } from "./artemis/adapter.js";
import { createPreflight } from "./env/preflight.js";
import { judgeEffectChanged } from "./effect/diff.js";
import { buildRoster, enumerateTransports, screenIsLocked } from "./device/roster.js";
import { createAdbProbe } from "./device/state.js";
import { readHierarchyXml } from "./device/hierarchy.js";
import { ScrcpyManager } from "./scrcpy/server.js";
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
  actionServerCommand: z
    .array(z.string())
    .default(["python", "-m", "artemis.interfaces.cli.main", "mcp", "--type", "adb"]),
  actionServerEnv: z.dict(z.string()).default({}),
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
   * dsh-autogamer rectification: external ARTEMIS provider wiring.
   * No `.description()` calls on purpose — that builder form is unverified on
   * the installed schemastery, and the settings auto-form works without
   * descriptions. `traceRetentionDays` and `defaultTimeoutSeconds` are
   * reserved (spec-required, no consumer yet: no retention sweeper and no
   * task-lifetime timeout policy exist).
   */
  artemisRepoPath: z.string().default(""),
  artemisMcpCommand: z.array(z.string()).default(["python", "-m", "mcp_server"]),
  uvPath: z.string().default("uv"),
  defaultProfile: z.union(["flash", "pro"]).default("flash"),
  defaultTimeoutSeconds: z.number().default(1800),
  defaultDeviceSerial: z.string().default(""),
  autoPreflight: z.boolean().default(true),
  scrcpyEnabled: z.boolean().default(true),
  scrcpyServerPath: z.string().default(""),
  scrcpyMaxFps: z.number().default(30),
  scrcpyMaxWidth: z.number().default(1080),
  scrcpyBitrateMbps: z.number().default(4),
  traceRetentionDays: z.number().default(7),
  /** P1-a validator strictness (S11 step 5); default "final" like upstream. */
  strictness: z.union(["off", "final", "checkpoints", "strict"]).default("final"),
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
// NOTE (reviewed P5 eve): the scheme also asks for 'settings' here, but that
// service is upstream-only (not installed) and an unresolvable inject in
// preset scope leaves the row pending — the G30 shape. It waits for a live
// mount proof, together with the settings section and the client settings
// card (both deferred for the same reason).

/** Makes each nudge's message id unique within this process, across agents. */
let nudgeSequence = 0;

export type PluginConfig = {
  actionServerCommand: string[];
  actionServerEnv: Record<string, string>;
  defaultDeviceKey: string;
  allowedFails: number;
  breakerCooldownMs: number;
  actionCallTimeoutMs: number;
  screenSize?: readonly unknown[];
  strictness?: "off" | "final" | "checkpoints" | "strict";
  devices?: string[];
  maxConcurrentDevices?: number;
  discoverDevices?: boolean;
  artemisRepoPath?: string;
  artemisMcpCommand?: string[];
  uvPath?: string;
  defaultProfile?: "flash" | "pro";
  defaultTimeoutSeconds?: number;
  defaultDeviceSerial?: string;
  autoPreflight?: boolean;
  scrcpyEnabled?: boolean;
  scrcpyServerPath?: string;
  scrcpyMaxFps?: number;
  scrcpyMaxWidth?: number;
  scrcpyBitrateMbps?: number;
  traceRetentionDays?: number;
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
  // dsh-autogamer rectification (Phase 4): the mirror manager is constructed
  // (lazily — no spawn) and disposed with everything else, but no tool drives
  // it yet: without a DSH binary channel there is no consumer for the video
  // socket (Phase 0 verdict), so start() waits for a transport that exists.
  // Disabled by config: no manager at all (this finally gives scrcpyEnabled
  // a consumer — review item 13).
  const scrcpy =
    config.scrcpyEnabled !== false
      ? new ScrcpyManager({
          maxWidth: config.scrcpyMaxWidth ?? 1080,
          maxFps: config.scrcpyMaxFps ?? 30,
          bitrateMbps: config.scrcpyBitrateMbps ?? 4,
          ...(typeof config.defaultDeviceSerial === "string" && config.defaultDeviceSerial.length > 0
            ? { serial: config.defaultDeviceSerial }
            : {}),
          ...(typeof config.scrcpyServerPath === "string" && config.scrcpyServerPath.length > 0
            ? { serverPath: config.scrcpyServerPath }
            : {}),
        })
      : undefined;
  // dsh-autogamer rectification (Phase 1): the external ARTEMIS backend and
  // the shared preflight runner. The backend connects lazily on first use, so
  // constructing it here spawns nothing; the preflight warm-up below only
  // fills the 60s cache and never rejects.
  const artemisBackend = createArtemisBackend({
    command: config.artemisMcpCommand ?? ["python", "-m", "mcp_server"],
    cwd:
      typeof config.artemisRepoPath === "string" && config.artemisRepoPath.length > 0
        ? config.artemisRepoPath
        : undefined,
    callTimeoutMs: config.actionCallTimeoutMs,
  });
  const preflight = createPreflight();
  const preflightInput = {
    uvPath: config.uvPath ?? "uv",
    artemisRepoPath: config.artemisRepoPath ?? "",
    defaultDeviceSerial: config.defaultDeviceSerial ?? "",
  };
  const checkEnv = () => preflight.run(preflightInput);
  // T2-a: the adb-backed tools gate on the device half only. Refusing a native
  // read because uv is not installed would be the preflight lying about what
  // the tool actually touches.
  const checkDeviceEnv = () => preflight.run(preflightInput, "device");
  if (config.autoPreflight !== false) {
    // No ctx.on('ready') exists in the typings (Phase 0): warm the cache
    // without blocking the mount instead.
    void checkEnv().catch(() => undefined);
    void checkDeviceEnv().catch(() => undefined);
  }
  // G67: which #N handles exist is per (agent, device) and per plugin instance - the
  // list the model was last shown, nothing more.
  const observations = new LiveObservations();
  const client = new ActionClient({
    command: config.actionServerCommand,
    env: config.actionServerEnv,
    callTimeoutMs: config.actionCallTimeoutMs,
  });

  const screenSizeCache = new Map<string, ScreenSize>();
  /**
   * G64 roster, native since T2-a: `adb devices -l`, folded by `android_id` so one
   * emulator reachable over several transports stays ONE device (G75 - counted
   * twice it would double every gate, concurrency ceiling and breaker).
   *
   * `undefined` still means "could not ask", kept distinct from "asked, nothing
   * attached" for the reason the action-server path recorded: a transient adb
   * failure must not look like an empty fleet.
   *
   * `isBusy` is reported false because the python pool's cross-process file mutex
   * has no replacement yet - a known gap, tracked as G89, not a silent one.
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

  const probe = createAdbProbe();

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
   * The probed size is cached per key (it was cached before too), which means a
   * rotation mid-session keeps the old space until the plugin restarts - the
   * remaining half of G76, recorded in the ledger rather than fixed silently.
   */
  async function resolveScreenSize(key: string): Promise<ScreenSize | undefined> {
    const configured = configuredScreenSize(config.screenSize);
    let probed = screenSizeCache.get(key);
    if (probed === undefined) {
      probed = await probe.frame(serialOfKey(key));
      if (probed) screenSizeCache.set(key, probed);
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
    client,
    logger,
    defaultDeviceKey: config.defaultDeviceKey,
    strictness: config.strictness,
    incidents,
    observations,
    resolveScreenSize,
    // T2-b: the hierarchy comes off the device itself (uiautomator dump + the
    // file read back), so `get_ui_hierarchy` is no longer an action-server call.
    hierarchy: (key, signal) => readHierarchyXml(serialOfKey(key), { signal }),
    onAction: () => ledger.markActed(agentIdOfCall()),
    agentIdOfCall,
    // Screenshots go to the host attachment store so the model gets a real
    // image block and the log keeps only the content-addressed reference.
    // Effect observation runs entirely in-tool: the router looks at the screen
    // itself rather than trusting the model's account of what happened. Since
    // T3 the verdict is computed here from the frames themselves (G84), so the
    // action server is no longer consulted for it.
    captureFrame: async () => {
      const base64 = unwrapText(await client.callTool("take_screenshot", {}));
      return base64.startsWith("Error:") ? undefined : base64;
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
        checkEnv: checkDeviceEnv,
        defaultDeviceSerial: config.defaultDeviceSerial ?? "",
        saveScreenshot: saveDeviceScreenshot,
      }),
    ),
  );
  const autogamerDeps = {
    backend: artemisBackend,
    checkEnv,
    defaultDeviceSerial: config.defaultDeviceSerial ?? "",
  };
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
  ctx.tools.register(
    defineTool<any, any>(
      defineDiagnose({
        ...autogamerDeps,
      }),
    ),
  );

  // Tool registration ownership belongs to the tools registry itself (its
  // entries are cordis effects on this plugin's fiber, exactly like the
  // shipped tool-jobs plugin — it registers bare, with no effect wrapper).
  // The resources needing an explicit teardown are the two MCP clients. Cordis
  // effect() runs the callback NOW and keeps its RETURNED function as the
  // disposer; passing teardown as the callback disposed our own tools during
  // apply() (changelogs #10, the G30 root cause).
  ctx.effect?.(() => () => {
    void client.dispose();
    void artemisBackend.dispose();
    void scrcpy?.dispose();
  });
}
