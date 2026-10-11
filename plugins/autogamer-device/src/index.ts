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
import { configuredScreenSize, imageSizeFromBase64, type ScreenSize } from "./coord.js";
import { unwrapText } from "./mcpText.js";
import type { DshContext, DshUserMessage } from "./dsh-types.js";
import { REPORT_NUDGE, TurnLedger } from "./turnLedger.js";
import { defineReportTaskStatus } from "./tools/reportTaskStatus.js";
import { defineRunDeviceAction } from "./tools/runDeviceAction.js";
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

export type PluginConfig = {
  actionServerCommand: string[];
  actionServerEnv: Record<string, string>;
  defaultDeviceKey: string;
  allowedFails: number;
  breakerCooldownMs: number;
  actionCallTimeoutMs: number;
  screenSize?: readonly unknown[];
};

export async function apply(ctx: DshContext, config: PluginConfig = {} as PluginConfig): Promise<void> {
  const gate = new DeviceGate();
  const breaker = new DeviceBreaker({
    allowedFails: config.allowedFails,
    cooldownMs: config.breakerCooldownMs,
  });
  const client = new ActionClient({
    command: config.actionServerCommand,
    env: config.actionServerEnv,
    callTimeoutMs: config.actionCallTimeoutMs,
  });

  const screenSizeCache = new Map<string, ScreenSize>();
  async function resolveScreenSize(key: string): Promise<ScreenSize | undefined> {
    const configured = configuredScreenSize(config.screenSize);
    if (configured) return configured;
    const cached = screenSizeCache.get(key);
    if (cached) return cached;
    const base64 = unwrapText(await client.callTool("take_screenshot", {}));
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
        role: "user",
        content: [{ type: "text", text: REPORT_NUDGE }],
        // A self-declared kind: the retired {kind:'plugin', plugin} wrapper is
        // rejected by session format V4 (rule R17).
        source: { kind: "autogamer", reason: "unreported-turn" },
      };
      try {
        agent.followup(message);
      } catch (error) {
        logger.warn(`[turn] followup refused: ${(error as Error)?.message ?? error}`);
      }
    },
    { global: true },
  );

  ctx.tools.register(defineTool<any, any>(defineRunDeviceAction({
    gate,
    breaker,
    client,
    logger,
    defaultDeviceKey: config.defaultDeviceKey,
    resolveScreenSize,
    onAction: () => ledger.markActed(agentIdOfCall()),
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
