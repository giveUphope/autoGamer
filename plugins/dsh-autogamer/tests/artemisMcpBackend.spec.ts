/**
 * MCP backend unit locks (Phase 2). A fake connection stands in for the SDK
 * transport, so no test here spawns a provider: request mapping, error
 * vocabulary, laziness, timeouts, and disposal are all asserted against
 * scripted answers. Request shapes are locked against the fork's old face
 * (`pre-contraction:mcp_server/tools/*.py`), not the scheme text.
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

function textResult(text: string): unknown {
  return { content: [{ type: "text", text }] };
}

function backendWith(
  fake: ReturnType<typeof fakeConnection>,
  timeoutMs = 1000,
): McpArtemisBackend {
  return new McpArtemisBackend({ command: ["python", "-m", "mcp_server"], callTimeoutMs: timeoutMs }, fake.connect);
}

describe("mcp backend: device state uses the text face, not JSON", () => {
  it("asks for the hierarchy view by default and keeps the dump as the summary", async () => {
    const fake = fakeConnection(textResult("<node index=0>ok</node>"));
    const state = await backendWith(fake).getDeviceState({});
    expect(fake.calls[0]).toMatchObject({
      name: "mobile_get_device_state",
      args: { view_type: "hierarchy" },
    });
    expect(state).toMatchObject({ deviceSerial: "", connected: true, screenSummary: "<node index=0>ok</node>" });
  });

  it("asks for the screenshot view on request and passes the file path through", async () => {
    const fake = fakeConnection(textResult("file:///tmp/shot.png"));
    const state = await backendWith(fake).getDeviceState({ deviceSerial: "em-1", includeScreenshot: true });
    expect(fake.calls[0]?.args).toEqual({ view_type: "screenshot", device_serial: "em-1" });
    expect(state).toMatchObject({ deviceSerial: "em-1", connected: true, screenshotPath: "file:///tmp/shot.png" });
  });

  it("an Error: refusal is environment:, never a state", async () => {
    const fake = fakeConnection(textResult("Error: Failed to initialize/lock Android device controller: gone"));
    await expect(backendWith(fake).getDeviceState({})).rejects.toThrow(/^environment: provider refused device state/);
  });

  it("a dead transport is environment:, safe to report and retry later", async () => {
    const fake = fakeConnection(undefined, new Error("spawn python ENOENT"));
    await expect(backendWith(fake).getDeviceState({})).rejects.toThrow(/^environment: /);
  });
});

describe("mcp backend: task methods speak the old face", () => {
  it("startTask sends task_desc/model and reads trace_id back as the task", async () => {
    const fake = fakeConnection(textResult(JSON.stringify({ trace_id: "t-1", status: "running" })));
    const backend = backendWith(fake);
    const info = await backend.startTask({ instruction: "open settings", profile: "Pro", deviceSerial: "em-1" });
    expect(fake.calls[0]).toMatchObject({
      name: "mobile_run_task",
      args: { task_desc: "open settings", model: "Pro", device_serial: "em-1" },
    });
    expect(info.taskId).toBe("t-1");
  });

  it("startTask without a trace_id is our mapping failure (internal:)", async () => {
    const fake = fakeConnection(textResult(JSON.stringify({ status: "running" })));
    await expect(
      backendWith(fake).startTask({ instruction: "x", profile: "Flash" }),
    ).rejects.toThrow(/^internal: /);
  });

  it("manageTask forwards action over trace_id", async () => {
    const fake = fakeConnection(textResult(JSON.stringify({ state: "running", current_step: 3 })));
    const status = await backendWith(fake).manageTask({ taskId: "t-1", action: "status" });
    expect(fake.calls[0]).toMatchObject({
      name: "mobile_manage_task",
      args: { action: "status", trace_id: "t-1" },
    });
    expect(status).toMatchObject({ taskId: "t-1", state: "running", currentStep: 3 });
  });

  it("inspectTrace always opens view_summary over the trace", async () => {
    const fake = fakeConnection(
      textResult(JSON.stringify({ final_status: "succeeded", steps: [{ index: 0, action: "tap" }] })),
    );
    const view = await backendWith(fake).inspectTrace({ traceId: "t-1" });
    expect(fake.calls[0]).toMatchObject({
      name: "mobile_inspect_trace",
      args: { action: "view_summary", trace_id: "t-1" },
    });
    expect(view.finalStatus).toBe("succeeded");
    expect(view.steps).toHaveLength(1);
  });

  it("diagnose forwards only the serial; the old face takes no logcat/screenshot flags", async () => {
    const fake = fakeConnection(
      textResult(JSON.stringify({ adb_connected: true, helper_installed: true, recommendations: ["x"] })),
    );
    const diagnosis = await backendWith(fake).diagnose({ deviceSerial: "em-1" });
    expect(fake.calls[0]).toMatchObject({ name: "mobile_diagnose", args: { device_serial: "em-1" } });
    expect(diagnosis).toMatchObject({ adbConnected: true, recommendations: ["x"] });
  });

  it("non-JSON text from a dict tool is internal:, not the device", async () => {
    const fake = fakeConnection(textResult("definitely not json"));
    await expect(backendWith(fake).manageTask({ taskId: "t", action: "status" })).rejects.toThrow(
      /^internal: /,
    );
  });

  it("a non-object structured result is internal: too", async () => {
    const fake = fakeConnection({ structuredContent: "just a string" });
    await expect(backendWith(fake).manageTask({ taskId: "t", action: "status" })).rejects.toThrow(
      /^internal: /,
    );
  });

  it("a dict answer with no text block at all is internal:", async () => {
    const fake = fakeConnection({ content: [{ type: "image" }] });
    await expect(backendWith(fake).manageTask({ taskId: "t", action: "status" })).rejects.toThrow(
      /^internal: /,
    );
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
          callTool: async () => ({ content: [{ type: "text", text: "<node/>" }] }),
          close: async () => undefined,
        };
      },
    );
    await expect(backend.getDeviceState({})).rejects.toThrow(/^environment: /);
    const state = await backend.getDeviceState({});
    expect(state.screenSummary).toBe("<node/>");
    expect(attempts).toBe(2);
  });
});
