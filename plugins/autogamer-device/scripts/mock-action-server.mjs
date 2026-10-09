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

/**
 * take_screenshot answers a real PNG header (1080x2400 IHDR) so the plugin's
 * screenshot probe resolves dimensions and the 0-1000 → pixel path is
 * testable live without a device. Everything else keeps the legacy text.
 */
const SCREENSHOT_PNG = (() => {
  const bytes = Buffer.alloc(33);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((b, i) => {
    bytes[i] = b;
  });
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1080, 16);
  bytes.writeUInt32BE(2400, 20);
  return bytes.toString("base64");
})();

function mockText(toolName) {
  return toolName === "take_screenshot" ? SCREENSHOT_PNG : "Success";
}

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
        return { id, result: { content: [{ type: "text", text: mockText(name) }] } };
      }
      // Async reply after the delay: exercises gate blocking and concurrent
      // turns (S10-③) without a real device.
      setTimeout(() => {
        write({ id, result: { content: [{ type: "text", text: mockText(name) }] } });
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
