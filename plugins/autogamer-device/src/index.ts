/**
 * autogamer-device plugin entry (P0 skeleton, docs/todo.md R2').
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
import type { DshContext } from "./dsh-types.js";
import { defineReportTaskStatus } from "./tools/reportTaskStatus.js";
import { defineRunDeviceAction } from "./tools/runDeviceAction.js";
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

/** ctx.tools is the only hard dependency; everything else is ours. */
export const inject = ["tools"];

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

  const disposers = [
    ctx.tools.register(defineRunDeviceAction({
      gate,
      breaker,
      client,
      logger,
      defaultDeviceKey: config.defaultDeviceKey,
      resolveScreenSize,
    })),
    ctx.tools.register(defineReportTaskStatus()),
  ];

  ctx.effect?.(() => {
    for (const dispose of disposers) dispose();
    void client.dispose();
  });
}
