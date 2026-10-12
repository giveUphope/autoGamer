/**
 * autogamer-device plugin entry (P0 skeleton, docs/TODO.md R2').
 * Contracts verified through declared surfaces only (dsh --dump-config-schema,
 * dsh --help, shipped READMEs — no asar reading, user ruling 2026-10-10): a
 * cordis plugin module exports {name, inject, Config?, apply}; Config must be
 * a native Schemastery schema; tools register through ctx.tools.register.
 */
import { ActionClient } from "./actionClient.js";
import { DeviceBreaker } from "./breaker.js";
import { DeviceGate } from "./gate.js";
import { DevicePool, type PoolDevice } from "./devicePool.js";
import { configuredScreenSize, imageSizeFromBase64, type ScreenSize } from "./coord.js";
import { unwrapText } from "./mcpText.js";
import { messageId, type DshContext, type DshUserMessage } from "./dsh-types.js";
import { REPORT_NUDGE, TurnLedger } from "./turnLedger.js";
import { defineReportTaskStatus } from "./tools/reportTaskStatus.js";
import { defineRunDeviceAction, deviceKeyOf, ActionIncidents } from "./tools/runDeviceAction.js";
import { LiveObservations } from "./observations.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

export const name = "autogamer-device";

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
   * G64 roster source: ask the action surface which devices exist (read-only `list_devices`).
   * Returns `undefined` when the question itself could not be answered -- the py server keeps
   * "could not ask adb" separate from "adb answered: no devices" exactly so a transient blip does
   * not look like an empty fleet, and this side must honour that by reporting "don't know".
   */
  async function enumerateRoster(): Promise<PoolDevice[] | undefined> {
    let answer: string;
    try {
      // Discovery exists to feed admission, so it asks for Keyguard too: one RPC for the whole
      // fleet. Per-serial probing would need a second throttle layer right here.
      answer = unwrapText(await client.callTool("list_devices", { include_lock_state: true }));
    } catch (error) {
      logger.warn(`[pool] list_devices transport failed: ${(error as Error)?.message ?? error}`);
      return undefined;
    }
    if (answer.startsWith("Error:")) {
      logger.warn(`[pool] list_devices refused: ${answer.slice(0, 120)}`);
      return undefined;
    }
    let parsed: { enumerated?: unknown; devices?: unknown };
    try {
      parsed = JSON.parse(answer) as typeof parsed;
    } catch (error) {
      logger.warn(`[pool] list_devices returned non-JSON: ${String(error)}`);
      return undefined;
    }
    if (parsed.enumerated !== true || !Array.isArray(parsed.devices)) return undefined;
    return parsed.devices.flatMap((device) => {
      const entry = device as {
        serial?: unknown;
        state?: unknown;
        is_busy?: unknown;
        is_locked?: unknown;
      };
      if (typeof entry.serial !== "string" || entry.serial.length === 0) return [];
      return [
        {
          serial: entry.serial,
          state: typeof entry.state === "string" ? entry.state : undefined,
          isBusy: entry.is_busy === true,
          // A missing key means "not asked"; an explicit JSON null means "asked, cannot tell".
          // The two must not collapse: one must not reject, the other must (G65).
          isLocked:
            entry.is_locked === true ||
            entry.is_locked === false ||
            entry.is_locked === null
              ? (entry.is_locked as boolean | null)
              : undefined,
        } satisfies PoolDevice,
      ];
    });
  }

  async function resolveScreenSize(key: string): Promise<ScreenSize | undefined> {
    const configured = configuredScreenSize(config.screenSize);
    if (configured) return configured;
    const cached = screenSizeCache.get(key);
    if (cached) return cached;
    // A dead server here is a transport failure, not a plugin defect (D3):
    // report the probe as missed and let requireScreenSize classify it as
    // environment, so the breaker opens instead of staying closed on internal.
    let base64: string;
    try {
      base64 = unwrapText(await client.callTool("take_screenshot", {}));
    } catch {
      return undefined;
    }
    if (base64.startsWith("Error:")) return undefined;
    const size = imageSizeFromBase64(base64);
    if (size) screenSizeCache.set(key, size);
    return size;
  }

  const logger = {
    info: (message: string) => ctx.logger.info(message),
    warn: (message: string) => ctx.logger.warn(message),
  };

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
    const serial = args.device_serial;
    if (typeof serial === "string" && serial.length > 0) {
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
    onAction: () => ledger.markActed(agentIdOfCall()),
    agentIdOfCall,
    // Screenshots go to the host attachment store so the model gets a real
    // image block and the log keeps only the content-addressed reference.
    // Effect observation runs entirely in-tool: the router looks at the screen
    // itself rather than trusting the model's account of what happened. The
    // verdict itself is the action server's (G39 route A).
    captureFrame: async () => {
      const base64 = unwrapText(await client.callTool("take_screenshot", {}));
      return base64.startsWith("Error:") ? undefined : base64;
    },
    compareFrames: async (before, after, action, coordinates) => {
      const args: Record<string, unknown> = { before_b64: before, after_b64: after, action };
      if (coordinates) args.coordinates = coordinates;
      const answer = unwrapText(await client.callTool("compare_ui_frames", args));
      if (answer.startsWith("Error:")) {
        logger.warn(`[route] effect comparison refused: ${answer}`);
        return undefined;
      }
      const parsed = JSON.parse(answer) as { changed?: unknown };
      return typeof parsed.changed === "boolean" ? parsed.changed : undefined;
    },
    saveScreenshot: async (bytes, mediaType) => {
      try {
        const [ref] = await ctx.attachments.saveImages([
          { data: bytes, mediaType, name: "device-screenshot" },
        ]);
        return ref;
      } catch (error) {
        // Admission can refuse one image (byte / pixel / dimension caps, or a
        // header that fails to decode). A screenshot must still report its
        // dimensions rather than fail the action.
        logger.warn(`[media] attachment admission failed: ${(error as Error)?.message ?? error}`);
        return undefined;
      }
    },
  })));
  ctx.tools.register(
    defineTool<any, any>(defineReportTaskStatus(() => ledger.markReported(agentIdOfCall()))),
  );

  // Tool registration ownership belongs to the tools registry itself (its
  // entries are cordis effects on this plugin's fiber, exactly like the
  // shipped tool-jobs plugin — it registers bare, with no effect wrapper).
  // The only resource needing an explicit teardown is the MCP client. Cordis
  // effect() runs the callback NOW and keeps its RETURNED function as the
  // disposer; passing teardown as the callback disposed our own tools during
  // apply() (changelogs #10, the G30 root cause).
  ctx.effect?.(() => () => {
    void client.dispose();
  });
}
