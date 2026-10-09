/**
 * Dependency-free MCP stdio action server returning canned success for
 * every tool (S10 spike: isolates model-dispatch behavior from device
 * availability). Line-delimited JSON-RPC over stdio.
 */
import { createInterface } from "node:readline";

const TOOLS = [
  "tap", "long_press_on", "swipe", "back", "launch_app", "stop_app",
  "open_link", "focus_and_input_text", "focus_and_clear_text",
  "erase_one_char", "press_key", "take_screenshot", "get_ui_hierarchy",
];

function handle(message) {
  if (message === undefined || typeof message !== "object") return undefined;
  const { id, method, params } = message;
  if (id === undefined) return undefined; // notification
  switch (method) {
    case "initialize":
      return {
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "mock-action-server", version: "0.1.0" },
        },
      };
    case "tools/list":
      return {
        id,
        result: {
          tools: TOOLS.map((name) => ({
            name,
            description: `mock ${name}`,
            inputSchema: { type: "object", properties: {} },
          })),
        },
      };
    case "tools/call": {
      const name = params?.name ?? "unknown";
      console.error(`[mock] tools/call ${name} ${JSON.stringify(params?.arguments ?? {})}`);
      const delay = Number(process.env.MOCK_DELAY_MS ?? 0);
      if (delay <= 0) {
        return { id, result: { content: [{ type: "text", text: "Success" }] } };
      }
      // Async reply after the delay: exercises gate blocking and concurrent
      // turns (S10-③) without a real device.
      setTimeout(() => {
        write({ id, result: { content: [{ type: "text", text: "Success" }] } });
      }, delay);
      return undefined;
    }
    case "ping":
      return { id, result: {} };
    default:
      return { id, error: { code: -32601, message: `method not found: ${method}` } };
  }
}

const write = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
const lineReader = createInterface({ input: process.stdin });
lineReader.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  try {
    const response = handle(JSON.parse(trimmed));
    if (response !== undefined) write(response);
  } catch (error) {
    console.error(`[mock] bad line: ${error.message}`);
  }
});
console.error("[mock] action server ready");
