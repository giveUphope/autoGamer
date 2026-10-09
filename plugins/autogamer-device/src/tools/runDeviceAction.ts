/**
 * run_device_action (S11): the single execution tool. The gate/breaker/
 * classification live here — code-enforced, the model cannot bypass them.
 * Route-decision logging goes to ctx.logger for threshold tuning (P1).
 */
import type { ActionClient } from "../actionClient.js";
import type { DeviceBreaker } from "../breaker.js";
import type { DeviceGate } from "../gate.js";
import {
  classifyActionFailure,
  classifyTransportError,
  type ActionResultLike,
} from "../classify.js";
import type { ToolDefinitionInput } from "../dsh-types.js";

export interface RouterLogger {
  info(message: string): void;
  warn(message: string): void;
}

const ACTIONS = [
  "click",
  "long_press",
  "swipe",
  "input_text",
  "press_key",
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

/** Mapping into the upstream py action-server tool names (盘点 03 §1.8). */
const PY_TOOL: Record<DeviceAction, string> = {
  click: "click",
  long_press: "long_press",
  swipe: "swipe",
  input_text: "input_text",
  press_key: "press_key",
  erase_one_char: "erase_one_char",
  focus_and_clear_text: "focus_and_clear_text",
  launch_app: "launch_app",
  stop_app: "stop_app",
  open_link: "open_link",
  take_screenshot: "take_screenshot",
  get_ui_hierarchy: "get_ui_hierarchy",
  wait: "wait_for_delay",
};

/** Actions whose py arguments need device context (target/text/package/url/key). */
const ACTION_PARAMS: Record<DeviceAction, string[]> = {
  click: ["target", "duration_ms"],
  long_press: ["target", "duration_ms"],
  swipe: ["target", "end_coordinate", "duration_ms"],
  input_text: ["text", "target"],
  press_key: ["key"],
  erase_one_char: [],
  focus_and_clear_text: ["target"],
  launch_app: ["package"],
  stop_app: ["package"],
  open_link: ["url"],
  take_screenshot: [],
  get_ui_hierarchy: [],
  wait: ["duration_ms"],
};

export interface RouterOptions {
  gate: DeviceGate;
  breaker: DeviceBreaker;
  client: ActionClient;
  logger: RouterLogger;
  defaultDeviceKey: string;
}

export function defineRunDeviceAction(options: RouterOptions): ToolDefinitionInput {
  const { gate, breaker, client, logger } = options;
  return {
    name: "run_device_action",
    description:
      "Execute one action on the Android device. Actions: " +
      ACTIONS.join(", ") +
      ". Targets are an element index from the latest hierarchy, an [x,y] pair " +
      "normalized to 0-1000, or omitted for whole-screen actions. One action " +
      "per call; the call resolves after the action was executed and its " +
      "effect was observed.",
    parameters: {
      action: { type: "string", required: true, enum: [...ACTIONS], description: "Action to execute." },
      target: {
        type: "object",
        description:
          "Where to act: {index} from the visible UI elements, or {coordinate:[x,y]} in 0-1000 space. Required for click/long_press/input_text/focus_and_clear_text unless the action takes text only.",
        properties: {
          index: { type: "number", description: "Element index from the latest visible UI elements list." },
          coordinate: { type: "array", items: { type: "number" }, description: "[x,y] normalized to 0-1000." },
          text: { type: "string", description: "Text to locate the element by (substring match)." },
        },
      },
      target_description: { type: "string", description: "Short human description of the target, recorded with the action." },
      text: { type: "string", description: "Text for input_text." },
      duration_ms: { type: "number", description: "Hold/swipe/wait duration in milliseconds." },
      end_coordinate: { type: "array", items: { type: "number" }, description: "Swipe end [x,y] in 0-1000 space." },
      key: { type: "string", description: "Key name for press_key (home/back/enter/delete/...)." },
      package: { type: "string", description: "Package name for launch_app/stop_app." },
      url: { type: "string", description: "URL for open_link." },
      device_serial: { type: "string", description: "Target device serial; omit for the configured default." },
      reason: { type: "string", required: true, description: "One sentence on why this action moves the task forward." },
    },
    timeoutMs: 45_000,
    async execute(args, exec) {
      const action = args.action as DeviceAction;
      const serial = (args.device_serial as string | undefined) ?? options.defaultDeviceKey;
      const risk = action === "stop_app" ? "risky" : "normal";
      logger.info(`[route] action=${action} device=${serial} risk=${risk} reason=${String(args.reason)}`);

      if (!breaker.canAdmit(serial)) {
        const error = new Error(
          `device ${serial} is cooling down after environment-level failures; report progress and retry after the next user message`,
        );
        logger.warn(`[route] blocked by breaker: device=${serial}`);
        throw error;
      }

      const handle = await gate.acquire(serial, exec.signal);
      try {
        const payload = collectPayload(action, args);
        let structured: unknown;
        try {
          structured = await client.callTool(PY_TOOL[action], payload);
        } catch (error) {
          if (exec.signal.aborted) throw error;
          const failure = classifyTransportError(error);
          breaker.recordEnvironmentFailure(serial);
          logger.warn(`[route] transport failure (environment): ${String(error)}`);
          throw new Error(`action transport failed (environment): ${String(error)}`);
        }

        const result = normalizeResult(structured);
        if (!result.ok) {
          const failure = classifyActionFailure(result);
          if (failure === "environment") breaker.recordEnvironmentFailure(serial);
          else breaker.recordTaskFailure(serial);
          logger.warn(`[route] device refused (risk=${risk}, class=${failure}): ${result.message ?? ""}`);
          throw new Error(
            `device refused ${action} (${failure}): ${result.code ?? "DEVICE_ERROR"} ${result.message ?? ""}`.trim(),
          );
        }

        breaker.recordSuccess(serial);
        // Effect verification (S11 step 3): P0 keeps the ActionResult ok flag
        // as the signal; screenshot-diff confirmation is a spike item wired
        // through the same classification path.
        logger.info(`[route] ok action=${action} device=${serial}`);
        return result;
      } finally {
        handle.release();
      }
    },
  };
}

function normalizeResult(structured: unknown): ActionResultLike {
  const record = (structured ?? {}) as Record<string, unknown>;
  const ok = record.ok === true;
  return {
    ok,
    code: typeof record.code === "string" ? record.code : ok ? "OK" : "DEVICE_ERROR",
    message: typeof record.message === "string" ? record.message : undefined,
  };
}

function collectPayload(action: DeviceAction, args: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of ACTION_PARAMS[action]) {
    const value = args[key];
    if (value !== undefined) payload[key] = value;
  }
  if (args.target_description !== undefined) payload.target_description = args.target_description;
  // The py executor accepts both spellings for the hold duration; send the
  // wire name the adb actuator expects (盘点 03 §1.8: agent=duration, wire=duration_ms).
  if (action === "long_press" && args.duration_ms !== undefined) payload.duration = args.duration_ms;
  return payload;
}
