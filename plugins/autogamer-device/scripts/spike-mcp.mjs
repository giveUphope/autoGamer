/**
 * P0 MCP direct-connect spike: ActionClient ↔ upstream py action server.
 * Run from the repo root so `uv run` resolves the project env:
 *   ARTEMIS_MOCK_DRIVER=1 node plugins/autogamer-device/scripts/spike-mcp.mjs
 *
 * Verifies: the pipe (list + call round-trip), the real 13-tool surface,
 * and result normalization. Actions may fail with adb-down messages when no
 * device/server is available — that still exercises the environment path.
 */
import { ActionClient } from "../dist/actionClient.js";
import { unwrapText } from "../dist/mcpText.js";

const REAL_TOOLS = [
  "tap", "long_press_on", "swipe", "back", "launch_app", "stop_app",
  "open_link", "focus_and_input_text", "focus_and_clear_text",
  "erase_one_char", "press_key", "take_screenshot", "get_ui_hierarchy",
];

const command = (process.env.SPIKE_COMMAND ?? "uv run artemis mcp --type adb").split(" ");
const client = new ActionClient({
  command,
  env: { ...process.env, ARTEMIS_MOCK_DRIVER: process.env.ARTEMIS_MOCK_DRIVER ?? "1" },
  callTimeoutMs: 120_000,
});

const tools = await client.listTools();
console.log(`[spike] tools (${tools.length}):`, tools.join(", "));
const missing = REAL_TOOLS.filter((name) => !tools.includes(name));
if (missing.length > 0) throw new Error(`missing expected tools: ${missing.join(", ")}`);

const calls = [
  ["take_screenshot", {}],
  ["get_ui_hierarchy", {}],
];
for (const [name, args] of calls) {
  const raw = await client.callTool(name, args);
  const text = unwrapText(raw);
  if (text.startsWith("Error:")) {
    console.log(`[spike] ${name} → environment error (expected when adb/device is down):`);
    console.log("        ", text.slice(0, 140));
  } else {
    console.log(`[spike] ${name} → OK:`, text.slice(0, 100), text.length > 100 ? "…" : "");
  }
}

await client.dispose();
console.log("[spike] OK — pipe, tool surface, and normalization verified");
