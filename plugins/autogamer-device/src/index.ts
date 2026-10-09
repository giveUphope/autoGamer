/**
 * autogamer-device plugin entry (P0 skeleton, docs/todo.md R2').
 * Contracts verified against DSH 0.2.0-rc.2 source: a cordis plugin module
 * exports {name, inject, Config?, apply}; tools register through
 * ctx.tools.register(defineTool(...)) from @deepseek-ai/dsh-tools.
 */
import { ActionClient } from "./actionClient.js";
import { DeviceBreaker } from "./breaker.js";
import { DeviceGate } from "./gate.js";
import { imageSizeFromBase64, type ScreenSize } from "./coord.js";
import { unwrapText } from "./mcpText.js";
import type { DshContext } from "./dsh-types.js";
import { defineReportTaskStatus } from "./tools/reportTaskStatus.js";
import { defineRunDeviceAction } from "./tools/runDeviceAction.js";

export const name = "autogamer-device";

/** ctx.tools is the only hard dependency; everything else is ours. */
export const inject = ["tools"];

export interface PluginConfig {
  /** argv of the upstream py action server (spike-adjustable). */
  actionServerCommand: string[];
  actionServerEnv: Record<string, string>;
  defaultDeviceKey: string;
  allowedFails: number;
  breakerCooldownMs: number;
  actionCallTimeoutMs: number;
  /** Optional static override; probed from a screenshot when absent. */
  screenSize: [number, number] | undefined;
}

const DEFAULTS: PluginConfig = {
  // `--type adb` is the real flag name (verified via `artemis mcp --help`;
  // earlier notes said `--server`).
  actionServerCommand: ["python", "-m", "artemis.interfaces.cli.main", "mcp", "--type", "adb"],
  actionServerEnv: {},
  defaultDeviceKey: "default",
  allowedFails: 1,
  breakerCooldownMs: 30_000,
  actionCallTimeoutMs: 30_000,
  screenSize: undefined,
};

export function mergeConfig(input?: Partial<PluginConfig>): PluginConfig {
  return { ...DEFAULTS, ...(input ?? {}) };
}

export async function apply(ctx: DshContext, input?: Partial<PluginConfig>): Promise<void> {
  const config = mergeConfig(input);
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
    if (config.screenSize) {
      return { width: config.screenSize[0], height: config.screenSize[1] };
    }
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
