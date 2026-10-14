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
import pyActionTools from "./fixtures/py-action-tools.json" with { type: "json" };
import { ActionClient } from "../src/actionClient.js";
import { decodeImageBase64, parseImageSize } from "../src/coord.js";
import { unwrapText } from "../src/mcpText.js";

const fixtureTools: string[] = pyActionTools.pyActionServerTools;

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

/** Same server with one verdict knob set, mirroring how the router calls it. */
async function withEffect(mode: string, use: (client: ActionClient) => Promise<unknown>) {
  const client = new ActionClient({
    command: [process.execPath, "scripts/mock-action-server.mjs"],
    env: { MOCK_EFFECT: mode },
    callTimeoutMs: 10_000,
  });
  try {
    return await use(client);
  } finally {
    await client.dispose();
  }
}

describe("mock action server handshake (G56)", () => {
  it("lists the same action surface as the live py server", async () => {
    const tools = await mockClient().listTools();
    // The fixture is generated from the real `artemis mcp --type adb` listing
    // (spike-mcp.mjs --write). Comparing against it, instead of a second
    // hand-typed list, is what catches drift: this mock kept serving 13 tools
    // for a day after `compare_ui_frames` made the py surface 14 (changelogs #12),
    // so the offline path silently lacked effect verification.
    expect(tools.slice().sort()).toEqual([...fixtureTools].sort());
  });

  it("answers compare_ui_frames in the py contract shape (G39 route A)", async () => {
    const result = await mockClient().callTool("compare_ui_frames", {
      before_b64: "aaa",
      after_b64: "bbb",
      action: "back",
    });
    // Locked to the exact key set of the py server's `json.dumps({"changed": changed})`.
    // An earlier version of this stub added `ratio` and asserted it, which pinned a contract
    // the real action surface never emitted (changelogs #51).
    expect(JSON.parse(unwrapText(result))).toEqual({ changed: true });
  });

  it("can serve the unchanged verdict and a refusal, both offline", async () => {
    // ActionClient replaces the child env with what it is given (that is why
    // MOCK_DELAY_MS is passed the same way below), so the verdict knob has to
    // come through the constructor, not through process.env of this test.
    const verdict = await withEffect("unchanged", (client) => client.callTool("compare_ui_frames", {}));
    expect(JSON.parse(unwrapText(verdict)).changed).toBe(false);

    const refused = await withEffect("error", (client) => client.callTool("compare_ui_frames", {}));
    expect(unwrapText(refused).startsWith("Error:")).toBe(true);
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

  it("answers list_devices with the py key set, and adds is_locked only when asked", async () => {
    const plain = JSON.parse(unwrapText(await mockClient().callTool("list_devices", {}))) as {
      enumerated: boolean;
      devices: Record<string, unknown>[];
    };
    expect(plain.enumerated).toBe(true);
    expect(Object.keys(plain.devices[0]).sort()).toEqual(
      [
        "serial",
        "state",
        "model",
        "product",
        "is_emulator",
        "is_busy",
        "active_pid",
        "active_task_desc",
        "active_session_id",
        "acquired_at",
      ].sort(),
    );
    // "not asked" must not be representable as null: admission treats unknown as fail-closed (G65).
    expect("is_locked" in plain.devices[0]).toBe(false);

    const asked = JSON.parse(
      unwrapText(await mockClient().callTool("list_devices", { include_lock_state: true })),
    ) as { devices: { is_locked?: boolean | null }[] };
    expect(asked.devices[0].is_locked).toBe(false);
  });

  it("forwards host cancellation into the request instead of waiting it out", async () => {
    const client = new ActionClient({
      command: [process.execPath, "scripts/mock-action-server.mjs"],
      env: { MOCK_DELAY_MS: "8000" },
      callTimeoutMs: 30_000,
    });
    clients.push(client);
    const controller = new AbortController();
    const pending = client.callTool("back", {}, controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    controller.abort();
    // Settles on abort, far ahead of the 5 s mock delay and the 30 s timeout
    // (the vitest 5 s test timeout is the backstop: without forwarding this
    // test would time out instead of failing on an assertion).
    await rejected;
  });
});
