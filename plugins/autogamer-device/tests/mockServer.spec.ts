/**
 * G56 locks: the mock action server speaks full JSON-RPC framing so the real
 * MCP SDK client can complete the handshake. Drove `SdkError: Request timed
 * out` before the `jsonrpc: "2.0"` marker was added, because the SDK parses
 * every line with JSONRPCMessageSchema and only skips SyntaxErrors.
 *
 * This file uses the REAL ActionClient (real SDK transport over stdio), not
 * the per-file ActionClient mock in apply.spec.ts (vitest module mocks are
 * scoped to their own file, so that mock does not apply here).
 */
import { afterEach, describe, expect, it } from "vitest";
import { ActionClient } from "../src/actionClient.js";
import { decodeImageBase64, parseImageSize } from "../src/coord.js";
import { unwrapText } from "../src/mcpText.js";

const clients: ActionClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.dispose();
});

function mockClient(): ActionClient {
  const client = new ActionClient({
    command: [process.execPath, "scripts/mock-action-server.mjs"],
    callTimeoutMs: 10_000,
  });
  clients.push(client);
  return client;
}

describe("mock action server handshake (G56)", () => {
  it("completes the SDK handshake and lists the mock tools", async () => {
    const tools = await mockClient().listTools();
    expect(tools.slice().sort()).toEqual(
      [
        "tap",
        "long_press_on",
        "swipe",
        "back",
        "launch_app",
        "stop_app",
        "open_link",
        "focus_and_input_text",
        "focus_and_clear_text",
        "erase_one_char",
        "press_key",
        "take_screenshot",
        "get_ui_hierarchy",
      ].sort(),
    );
  });

  it("answers take_screenshot with a decodable 1080x2400 PNG", async () => {
    const result = await mockClient().callTool("take_screenshot", {});
    const size = parseImageSize(decodeImageBase64(unwrapText(result)));
    expect(size).toEqual({ width: 1080, height: 2400 });
  });

  it("answers tap with the legacy success text", async () => {
    const result = await mockClient().callTool("tap", { coordinates: [100, 100] });
    expect(unwrapText(result)).toBe("Success");
  });
});
