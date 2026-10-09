/**
 * autogamer-device plugin entry (P0 skeleton, docs/todo.md R2').
 * Contracts verified against DSH 0.2.0-rc.2 source: a cordis plugin module
 * exports {name, inject, Config?, apply}; tools register through
 * ctx.tools.register(defineTool(...)) from @deepseek-ai/dsh-tools.
 */
import { ActionClient } from "./actionClient.js";
import { DeviceBreaker } from "./breaker.js";
import { DeviceGate } from "./gate.js";
import type { DshContext } from "./dsh-types.js";
import { defineReportTaskStatus } from "./tools/reportTaskStatus.js";
import { defineRunDeviceAction } from "./tools/runDeviceAction.js";

export const name = "autogamer-device";

/** ctx.tools is the only hard dependency; everything else is ours. */
export const inject = ["tools"];

export interface PluginConfig {
  actionServerCommand: string[];
  actionServerEnv: Record<string, string>;
  defaultDeviceKey: string;
  allowedFails: number;
  breakerCooldownMs: number;
  actionCallTimeoutMs: number;
}

const DEFAULTS: PluginConfig = {
  // Resolved inside the profile environment; adjust via the patch entry
  // config when the py runtime is elsewhere (P0 spike item).
  actionServerCommand: ["python", "-m", "artemis.interfaces.cli.main", "mcp", "--server", "adb"],
  actionServerEnv: {},
  defaultDeviceKey: "default",
  allowedFails: 1,
  breakerCooldownMs: 30_000,
  actionCallTimeoutMs: 30_000,
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
    })),
    ctx.tools.register(defineReportTaskStatus()),
  ];

  ctx.effect?.(() => {
    for (const dispose of disposers) dispose();
    void client.dispose();
  });
}
