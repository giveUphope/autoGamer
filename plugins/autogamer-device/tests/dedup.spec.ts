/**
 * G13 in-flight dedup locks. An identical mutating call from the same agent
 * while one is still running is a double-fire, not a retry: the second is
 * refused before queueing on the gate. Reads are idempotent polls and never
 * deduped; sequential repeats (the first settled) always run — so legitimate
 * double-taps, volume steps, and before/after screenshots are unaffected.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DeviceBreaker } from "../src/breaker.js";
import { defaultPool } from "./support/pool.js";
import { defineRunDeviceAction } from "../src/tools/runDeviceAction.js";

function hierarchyWith(target: boolean): string {
  return JSON.stringify(
    target
      ? [
          { index: "0", text: "亮度", "content-desc": "", "resource-id": "", class: "t", package: "p", clickable: "true", parsed_bounds: { left: 40, top: 400, right: 200, bottom: 460 } },
          { index: "1", text: "显示", "content-desc": "", "resource-id": "", class: "t", package: "p", clickable: "true", parsed_bounds: { left: 40, top: 600, right: 200, bottom: 660 } },
        ]
      : [
          { index: "0", text: "亮度", "content-desc": "", "resource-id": "", class: "t", package: "p", clickable: "true", parsed_bounds: { left: 40, top: 400, right: 200, bottom: 460 } },
        ],
  );
}

const harness = {
  calls: [] as { tool: string; args: Record<string, unknown> }[],
  tapResolvers: [] as Array<(value: unknown) => void>,
};

let currentAgent = "agent-1";

function setup() {
  harness.calls.length = 0;
  harness.tapResolvers.length = 0;
  const tool = defineRunDeviceAction({
    pool: defaultPool(),
    breaker: new DeviceBreaker({ allowedFails: 99, cooldownMs: 0 }),
    client: {
      callTool: async (name: string, args: Record<string, unknown>) => {
        harness.calls.push({ tool: name, args });
        if (name === "get_ui_hierarchy") {
          return { content: [{ type: "text", text: hierarchyWith(true) }] };
        }
        if (name === "tap") {
          return new Promise<unknown>((resolve) => {
            harness.tapResolvers.push(() =>
              resolve({ content: [{ type: "text", text: "Success" }] }),
            );
          });
        }
        return { content: [{ type: "text", text: "Success" }] };
      },
    } as never,
    logger: { info: () => {}, warn: () => {} },
    defaultDeviceKey: "d0",
    agentIdOfCall: () => currentAgent,
    resolveScreenSize: async () => ({ width: 720, height: 1600 }),
    captureFrame: async () => "frame",
    compareFrames: async () => true,
  });
  return tool;
}

function exec(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

function taps(): { tool: string; args: Record<string, unknown> }[] {
  return harness.calls.filter((call) => call.tool === "tap");
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  harness.calls.length = 0;
  harness.tapResolvers.length = 0;
  currentAgent = "agent-1";
});

describe("in-flight dedup (G13)", () => {
  it("refuses an identical call while one is still running", async () => {
    const tool = setup();
    const first = tool.execute(
      { action: "click", target: { index: 1 }, reason: "first" },
      exec() as never,
    );
    await flush();
    await flush();
    expect(taps()).toHaveLength(1);
    await expect(
      tool.execute({ action: "click", target: { index: 1 }, reason: "second" }, exec() as never),
    ).rejects.toThrow(/^task: duplicate of the action already running/);
    expect(taps()).toHaveLength(1);
    harness.tapResolvers.splice(0).forEach((resolve) => resolve());
    const value = (await first) as Record<string, unknown>;
    expect(value.effect).toBe("changed");
  });

  it("admits sequential repeats once the first settles", async () => {
    const tool = setup();
    const one = tool.execute({ action: "click", target: { index: 1 }, reason: "one" }, exec() as never);
    await flush();
    await flush();
    await flush();
    expect(taps()).toHaveLength(1);
    harness.tapResolvers.splice(0).forEach((resolve) => resolve());
    await one;
    const two = tool.execute(
      { action: "click", target: { index: 1 }, reason: "two" },
      exec() as never,
    );
    await flush();
    await flush();
    expect(taps()).toHaveLength(2);
    harness.tapResolvers.splice(0).forEach((resolve) => resolve());
    const twoValue = (await two) as Record<string, unknown>;
    expect(twoValue.effect).toBe("changed");
    expect(taps()).toHaveLength(2);
  });

  it("admits the same call from another agent", async () => {
    const tool = setup();
    const first = tool.execute(
      { action: "click", target: { index: 1 }, reason: "first" },
      exec() as never,
    );
    await flush();
    await flush();
    expect(taps()).toHaveLength(1);
    currentAgent = "agent-2";
    const second = tool.execute(
      { action: "click", target: { index: 1 }, reason: "second" },
      exec() as never,
    );
    let secondRejected: unknown = null;
    second.catch((error: unknown) => {
      secondRejected = error;
    });
    await flush();
    await flush();
    // Same device serializes on the gate, but the second call passed dedup
    // (not refused as a duplicate): it is queued, not rejected.
    expect(secondRejected).toBeNull();
    expect(taps()).toHaveLength(1);
    harness.tapResolvers.splice(0).forEach((resolve) => resolve());
    expect(((await first) as Record<string, unknown>).effect).toBe("changed");
    // The gate released: the second call reaches the device now.
    await flush();
    await flush();
    expect(taps()).toHaveLength(2);
    harness.tapResolvers.splice(0).forEach((resolve) => resolve());
    expect(((await second) as Record<string, unknown>).effect).toBe("changed");
  });

  it("never dedups read-only polls", async () => {
    const tool = setup();
    const a = await tool.execute({ action: "get_ui_hierarchy", reason: "a" }, exec() as never);
    const b = await tool.execute({ action: "get_ui_hierarchy", reason: "b" }, exec() as never);
    expect((a as Record<string, unknown>).element_count).toBe(2);
    expect((b as Record<string, unknown>).element_count).toBe(2);
  });

  it("admits a different target while one runs", async () => {
    const tool = setup();
    const first = tool.execute(
      { action: "click", target: { index: 1 }, reason: "first" },
      exec() as never,
    );
    await flush();
    await flush();
    expect(taps()).toHaveLength(1);
    const second = tool.execute(
      { action: "click", target: { index: 0 }, reason: "other button" },
      exec() as never,
    );
    let secondRejected: unknown = null;
    second.catch((error: unknown) => {
      secondRejected = error;
    });
    await flush();
    await flush();
    // Same device serializes on the gate: queued behind the first, refused by nothing.
    expect(secondRejected).toBeNull();
    expect(taps()).toHaveLength(1);
    harness.tapResolvers.splice(0).forEach((resolve) => resolve());
    expect(((await first) as Record<string, unknown>).effect).toBe("changed");
    await flush();
    await flush();
    expect(taps()).toHaveLength(2);
    harness.tapResolvers.splice(0).forEach((resolve) => resolve());
    expect(((await second) as Record<string, unknown>).effect).toBe("changed");
  });
});
