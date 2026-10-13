/**
 * MCP backend unit locks (Phase 1). A fake connection stands in for the SDK
 * transport, so no test here spawns a provider: mapping, error vocabulary,
 * laziness, timeouts, and disposal are all asserted against scripted answers.
 */
import { describe, expect, it } from "vitest";
import { McpArtemisBackend, type McpConnection } from "../src/artemis/mcpBackend.js";

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function fakeConnection(answer?: unknown, error?: unknown): {
  calls: Call[];
  closed: number;
  connectCalls: number;
  connect: () => Promise<McpConnection>;
} {
  const calls: Call[] = [];
  let closed = 0;
  let connectCalls = 0;
  return {
    calls,
    get closed() {
      return closed;
    },
    get connectCalls() {
      return connectCalls;
    },
    connect: async () => {
      connectCalls += 1;
      return {
        callTool: async (params: { name: string; arguments: Record<string, unknown> }) => {
          calls.push({ name: params.name, args: params.arguments });
          if (error !== undefined) throw error;
          return answer;
        },
        close: async () => {
          closed += 1;
        },
      };
    },
  };
}

function backendWith(
  fake: ReturnType<typeof fakeConnection>,
  timeoutMs = 1000,
): McpArtemisBackend {
  return new McpArtemisBackend({ command: ["python", "-m", "mcp_server"], callTimeoutMs: timeoutMs }, fake.connect);
}

describe("mcp backend: device-state mapping", () => {
  it("prefers a structured result when the SDK hands one over", async () => {
    const fake = fakeConnection({
      structuredContent: { device_serial: "em-1", connected: true, current_package: "com.x" },
    });
    const state = await backendWith(fake).getDeviceState({ deviceSerial: "em-1" });
    expect(state).toMatchObject({ deviceSerial: "em-1", connected: true, currentPackage: "com.x" });
    expect(fake.calls[0]).toMatchObject({ name: "mobile_get_device_state" });
  });

  it("parses the provider's stringified JSON, including alternate key spellings", async () => {
    const fake = fakeConnection({
      content: [
        {
          type: "text",
          text: JSON.stringify({ serial: "em-2", adb_connected: true, helper_installed: false }),
        },
      ],
    });
    const state = await backendWith(fake).getDeviceState({});
    expect(state).toMatchObject({ deviceSerial: "em-2", connected: true, helperInstalled: false });
  });

  it("forwards the requested serial and screenshot flag as provider params", async () => {
    const fake = fakeConnection({ structuredContent: { connected: true } });
    await backendWith(fake).getDeviceState({ deviceSerial: "em-9", includeScreenshot: true });
    expect(fake.calls[0]?.args).toEqual({ device_serial: "em-9", include_screenshot: true });
  });

  it("omits unset params instead of sending empty ones", async () => {
    const fake = fakeConnection({ structuredContent: { connected: false } });
    await backendWith(fake).getDeviceState({});
    expect(fake.calls[0]?.args).toEqual({});
  });
});

describe("mcp backend: error vocabulary", () => {
  it("non-JSON text is our mapping failure, not the device (internal:)", async () => {
    const fake = fakeConnection({ content: [{ type: "text", text: "definitely not json" }] });
    await expect(backendWith(fake).getDeviceState({})).rejects.toThrow(/^internal: /);
  });

  it("a non-object JSON payload is internal: too", async () => {
    const fake = fakeConnection({ content: [{ type: "text", text: "[1,2]" }] });
    await expect(backendWith(fake).getDeviceState({})).rejects.toThrow(/^internal: /);
  });

  it("a dead transport is environment:, safe to report and retry later", async () => {
    const fake = fakeConnection(undefined, new Error("spawn python ENOENT"));
    await expect(backendWith(fake).getDeviceState({})).rejects.toThrow(/^environment: /);
  });
});

describe("mcp backend: lifecycle", () => {
  it("constructing and disposing never connects", async () => {
    const fake = fakeConnection({ structuredContent: { connected: true } });
    const backend = backendWith(fake);
    await backend.dispose();
    expect(fake.connectCalls).toBe(0);
    expect(fake.closed).toBe(0);
  });

  it("a hung provider call times out and drops the poisoned session", async () => {
    const fake = fakeConnection(new Promise(() => undefined));
    const backend = backendWith(fake, 20);
    await expect(backend.getDeviceState({})).rejects.toThrow(/within 20ms/);
    expect(fake.closed).toBe(1);
  });

  it("a failed connect does not poison the next call", async () => {
    let attempts = 0;
    const backend = new McpArtemisBackend(
      { command: ["python", "-m", "mcp_server"], callTimeoutMs: 1000 },
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("spawn python ENOENT");
        return {
          callTool: async () => ({ structuredContent: { connected: true } }),
          close: async () => undefined,
        };
      },
    );
    await expect(backend.getDeviceState({})).rejects.toThrow(/^environment: /);
    const state = await backend.getDeviceState({});
    expect(state.connected).toBe(true);
    expect(attempts).toBe(2);
  });
});
