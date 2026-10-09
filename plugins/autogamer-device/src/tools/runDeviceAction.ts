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
import { imageSizeFromBase64, toPixels, type ScreenSize } from "../coord.js";
import type { ToolDefinitionInput } from "../dsh-types.js";
import { findNodeCenterByIndex, findNodeCenterBySubstring } from "../hierarchy.js";
import { unwrapText } from "../mcpText.js";

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
  | { ok: false; failure: "environment" | "task"; message: string };

export interface RouterOptions {
  gate: DeviceGate;
  breaker: DeviceBreaker;
  client: ActionClient;
  logger: RouterLogger;
  defaultDeviceKey: string;
  /** Screen dimensions for 0-1000 → pixel conversion; probe result cached per key. */
  resolveScreenSize(key: string): Promise<ScreenSize | undefined>;
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
      throw new Error(`task: element index ${target.index} not found in the current hierarchy`);
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
        description:
          "Where to act. {coordinate:[x,y]} 0-1000, {index} element index, or {text} substring of text/content-desc/resource-id. Required by click/long_press/input_text/focus_and_clear_text.",
        properties: {
          index: { type: "number", description: "Element index in the latest hierarchy dump." },
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
      schema: {
        type: "object",
        properties: {
          result: { type: "string", description: "Executor output text." },
          ok: { type: "boolean" },
          code: { type: "string" },
          message: { type: "string" },
        },
      },
      render: (_args, value) => {
        const record = (value ?? {}) as Record<string, unknown>;
        const parts = Object.entries(record)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${typeof v === "string" ? v.slice(0, 200) : JSON.stringify(v)}`);
        return parts.length > 0 ? parts.join("; ") : "action completed";
      },
    },
    async execute(args, exec) {
      const action = args.action as DeviceAction;
      const key = (args.device_serial as string | undefined) ?? options.defaultDeviceKey;
      const risk = action === "stop_app" ? "risky" : "normal";
      logger.info(`[route] action=${action} device=${key} risk=${risk} reason=${String(args.reason)}`);

      if (!breaker.canAdmit(key)) {
        logger.warn(`[route] blocked by breaker: device=${key}`);
        throw new Error(
          `environment: device ${key} is cooling down after environment-level failures — report progress and continue after the next message`,
        );
      }

      const handle = await gate.acquire(key, exec.signal);
      try {
        const result = await dispatch(action, args, key, exec);
        if (!result.ok) {
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
      const failure = message.startsWith("environment:") ? "environment" : "task";
      return { ok: false, failure, message: message.replace(/^(environment|task):\s*/, "") };
    }

    let structured: unknown;
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
    return { ok: true, value: value ?? outcome.value };
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
        const { x, y } = await resolvePixelTarget(args, key);
        return { tool: "long_press_on", payload: { coordinates: [x, y], duration: Number(args.duration_ms ?? 1000) } };
      }
      case "swipe": {
        const size = await requireScreenSize(key);
        const from = (args.target as TargetInput | undefined)?.coordinate;
        const to = args.end_coordinate as number[] | undefined;
        if (!Array.isArray(from) || !Array.isArray(to)) {
          throw new Error("task: swipe needs target.coordinate=[x,y] and end_coordinate=[x,y] (0-1000)");
        }
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
        return { tool: "launch_app", payload: { package_name: String(args.package ?? "") } };
      case "stop_app":
        return { tool: "stop_app", payload: { package_name: String(args.package ?? "") } };
      case "open_link":
        return { tool: "open_link", payload: { url: String(args.url ?? "") } };
      case "take_screenshot": {
        // Screenshot bytes are withheld from the model for now (multimodal
        // tool results are a spike item); dimensions come back instead.
        const base64 = unwrapText(await client.callTool("take_screenshot", {}));
        const size = imageSizeFromBase64(base64);
        if (/^errorb/i.test(base64)) {
          throw new Error(`environment: ${base64.replace(/^errorb:?s*/i, "").trim()}`);
        }
        return {
          tool: "take_screenshot",
          payload: {},
          value: {
            screenshot: size
              ? `captured ${size.width}x${size.height} (base64 withheld; visual inspection via UI pending)`
              : "captured (base64 withheld)",
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
