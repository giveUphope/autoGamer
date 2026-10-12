/**
 * G34/G38 locks. These drive defineRunDeviceAction directly (not through
 * apply()'s defineTool wrapper) on purpose: the DSL validates shapes before
 * our code runs, so semantic checks (non-empty, positive, in-range) and the
 * internal/task failure split need their own harness with a real gate and
 * breaker plus a recording stub client.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DeviceBreaker } from "../src/breaker.js";
import { DeviceGate } from "../src/gate.js";
import { defineRunDeviceAction } from "../src/tools/runDeviceAction.js";

const calls: { tool: string; args: Record<string, unknown> }[] = [];

function setup(resolveScreenSize?: () => Promise<{ width: number; height: number } | undefined>) {
  calls.length = 0;
  const breaker = new DeviceBreaker({ allowedFails: 1, cooldownMs: 30_000 });
  const tool = defineRunDeviceAction({
    gate: new DeviceGate(),
    breaker,
    client: {
      callTool: async (name: string, args: Record<string, unknown>) => {
        calls.push({ tool: name, args });
        return "Success";
      },
    } as never,
    logger: { info: () => {}, warn: () => {} },
    defaultDeviceKey: "d0",
    resolveScreenSize: resolveScreenSize ?? (async () => ({ width: 720, height: 1600 })),
  });
  return { tool, breaker };
}

function exec(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

beforeEach(() => {
  calls.length = 0;
});

describe("router input validation (G34)", () => {
  it("rejects empty input_text without touching the device", async () => {
    const { tool } = setup();
    await expect(
      tool.execute({ action: "input_text", target: { index: 0 }, text: "", reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: text must be a non-empty string/);
    expect(calls).toHaveLength(0);
  });

  it("rejects empty and unknown press_key values", async () => {
    const { tool } = setup();
    await expect(
      tool.execute({ action: "press_key", key: "", reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: key must be a non-empty string/);
    await expect(
      tool.execute({ action: "press_key", key: "frob", reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: unknown key/);
    expect(calls).toHaveLength(0);
  });

  it("rejects out-of-range and non-finite coordinates", async () => {
    const { tool } = setup();
    await expect(
      tool.execute({ action: "click", target: { coordinate: [2000, 10] }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: target\.coordinate must be \[x,y\] with finite numbers in 0-1000/);
    await expect(
      tool.execute({ action: "click", target: { coordinate: [Number.NaN, 10] }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: target\.coordinate/);
    expect(calls).toHaveLength(0);
  });

  it("does not fall back to hierarchy search on a malformed coordinate", async () => {
    const { tool } = setup();
    await expect(
      tool.execute({ action: "click", target: { index: 1, coordinate: [500] }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: target\.coordinate/);
    expect(calls).toHaveLength(0);
  });

  it("rejects swipe without a full end_coordinate pair", async () => {
    const { tool } = setup();
    await expect(
      tool.execute(
        { action: "swipe", target: { coordinate: [100, 100] }, reason: "t" },
        exec() as never,
      ),
    ).rejects.toThrow(/^task: end_coordinate/);
    expect(calls).toHaveLength(0);
  });

  it("rejects non-positive durations", async () => {
    const { tool } = setup();
    await expect(
      tool.execute(
        { action: "long_press", target: { coordinate: [100, 100] }, duration_ms: 0, reason: "t" },
        exec() as never,
      ),
    ).rejects.toThrow(/^task: duration_ms must be a positive number/);
    await expect(
      tool.execute({ action: "wait", duration_ms: -1, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: duration_ms must be a finite number >= 0/);
    expect(calls).toHaveLength(0);
  });

  it("rejects empty package and url", async () => {
    const { tool } = setup();
    await expect(
      tool.execute({ action: "launch_app", package: "", reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: package must be a non-empty string/);
    await expect(
      tool.execute({ action: "stop_app", package: "", reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: package must be a non-empty string/);
    await expect(
      tool.execute({ action: "open_link", url: "", reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: url must be a non-empty string/);
    expect(calls).toHaveLength(0);
  });

  it("rejects a swipe without a starting target", async () => {
    const { tool } = setup();
    await expect(
      tool.execute(
        { action: "swipe", end_coordinate: [100, 100], reason: "t" },
        exec() as never,
      ),
    ).rejects.toThrow(/^task: target\.coordinate/);
    expect(calls).toHaveLength(0);
  });

  it("rejects an unknown action without touching the device", async () => {
    const { tool } = setup();
    await expect(
      tool.execute({ action: "fly", reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: unsupported action/);
    expect(calls).toHaveLength(0);
  });

  it("dispatches known press_key mappings", async () => {
    const { tool } = setup();
    await tool.execute({ action: "press_key", key: "home", reason: "t" }, exec() as never);
    await tool.execute({ action: "press_key", key: "5", reason: "t" }, exec() as never);
    await tool.execute({ action: "press_key", key: "KEYCODE_ENTER", reason: "t" }, exec() as never);
    expect(calls.map((call) => (call.args as { keycode: string }).keycode)).toEqual([
      "KEYCODE_HOME",
      "KEYCODE_5",
      "KEYCODE_ENTER",
    ]);
  });

  it("still dispatches a fully valid call", async () => {
    const { tool } = setup();
    const value = (await tool.execute({ action: "wait", duration_ms: 1, reason: "t" }, exec() as never)) as Record<
      string,
      unknown
    >;
    expect(value).toEqual({ waited_ms: 1 });
  });
});

describe("router internal errors (G38)", () => {
  it("reports an unprefixed plugin defect as internal with a do-not-retry signal", async () => {
    const { tool } = setup(async () => {
      throw new Error("boom (simulated resolver bug)");
    });
    await expect(
      tool.execute({ action: "click", target: { coordinate: [500, 500] }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^internal: boom \(simulated resolver bug\).*do not retry/);
    expect(calls).toHaveLength(0);
  });

  it("records nothing on the breaker for internal failures", async () => {
    const { tool, breaker } = setup(async () => {
      throw new Error("boom (simulated resolver bug)");
    });
    await expect(
      tool.execute({ action: "click", target: { coordinate: [500, 500] }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^internal:/);
    expect(breaker.stateOf("d0")).toBe("closed");
    // The device is not cooling down: the next action still runs.
    const value = (await tool.execute({ action: "wait", duration_ms: 1, reason: "t" }, exec() as never)) as Record<
      string,
      unknown
    >;
    expect(value).toEqual({ waited_ms: 1 });
  });

  it("keeps task failures as task (not internal) without opening the breaker", async () => {
    const { tool, breaker } = setup();
    await expect(
      tool.execute({ action: "press_key", key: "frob", reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: unknown key/);
    expect(breaker.stateOf("d0")).toBe("closed");
  });
});
