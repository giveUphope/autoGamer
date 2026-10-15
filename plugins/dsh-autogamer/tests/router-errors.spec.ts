/**
 * G34/G38 locks. These drive defineRunDeviceAction directly (not through
 * apply()'s defineTool wrapper) on purpose: the DSL validates shapes before
 * our code runs, so semantic checks (non-empty, positive, in-range) and the
 * internal/task failure split need their own harness with a real gate and
 * breaker plus a recording stub client.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { DeviceBreaker } from "../src/breaker.js";
import { defaultPool } from "./support/pool.js";
import { defineRunDeviceAction, RUN_DEVICE_ACTION_TIMEOUT_MS, WAIT_CEILING_MS } from "../src/tools/runDeviceAction.js";
import { TWO_ROWS_XML } from "./support/hierarchyXml.js";
import { pngHeaderOnly } from "./support/fakeAdb.js";

const calls: { tool: string; args: Record<string, unknown> }[] = [];

function setup(resolveScreenSize?: () => Promise<{ width: number; height: number } | undefined>) {
  calls.length = 0;
  const breaker = new DeviceBreaker({ allowedFails: 1, cooldownMs: 30_000 });
  const tool = defineRunDeviceAction({
    pool: defaultPool(),
    breaker,
    // T2-c/d/e: the device seam is two functions now, and the log keeps the
    // legacy `{tool, args}` shape because that is what these locks read.
    execute: async (call) => {
      calls.push({ tool: call.tool, args: call.payload });
      return "Success";
    },
    capturePng: async () => pngHeaderOnly(720, 1600),
    logger: { info: () => {}, warn: () => {} },
    defaultDeviceKey: "d0",
    resolveScreenSize: resolveScreenSize ?? (async () => ({ width: 720, height: 1600 })),
    hierarchy: async () => TWO_ROWS_XML,
  });
  return { tool, breaker };
}

function exec(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext;
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

  it("reports host cancellation without waiting out the call", async () => {
    // 能力重审-1 changed the class this lock asserts, and the old class was the
    // bug: it locked `task:`, which charged the model for a stop it did not ask
    // for and told it its goal was unclear. An abort belongs to neither side -
    // see the comment on CANCELLED_MESSAGE. The "does not hang" half of the old
    // lock is unchanged and still the point of this test.
    const tool = defineRunDeviceAction({
      pool: defaultPool(),
      breaker: new DeviceBreaker({ allowedFails: 1, cooldownMs: 30_000 }),
      execute: (_call, _key, signal) =>
        new Promise<string>((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("stub device aborted")), {
            once: true,
          });
        }),
      capturePng: async () => pngHeaderOnly(720, 1600),
      logger: { info: () => {}, warn: () => {} },
      defaultDeviceKey: "d0",
      resolveScreenSize: async () => ({ width: 720, height: 1600 }),
      hierarchy: async () => TWO_ROWS_XML,
    });
    const controller = new AbortController();
    const pending = tool.execute({ action: "back", reason: "t" }, {
      signal: controller.signal,
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    // Without signal forwarding this would hang until the client timeout
    // (and trip the 5 s vitest timeout); the abort settles it at once.
    await expect(pending).rejects.toThrow(/^cancelled: /);
  });

  it("charges a cancellation to neither the device nor the model", async () => {
    // The regression this whole change exists for. `allowedFails: 1` means one
    // environment failure opens the breaker for the full cooldown, so a user
    // pressing stop would have locked the device out of every later action; and
    // a `task` class would have counted toward the incident streak and told the
    // model to restate a goal that was never the problem. Mutation: put either
    // `task` or `environment` back in the two abort branches and this goes red.
    const breaker = new DeviceBreaker({ allowedFails: 1, cooldownMs: 30_000 });
    const tool = defineRunDeviceAction({
      pool: defaultPool(),
      breaker,
      execute: (_call, _key, signal) =>
        new Promise<string>((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("stub device aborted")), {
            once: true,
          });
        }),
      capturePng: async () => pngHeaderOnly(720, 1600),
      logger: { info: () => {}, warn: () => {} },
      defaultDeviceKey: "d0",
      resolveScreenSize: async () => ({ width: 720, height: 1600 }),
      hierarchy: async () => TWO_ROWS_XML,
    });
    const controller = new AbortController();
    const pending = tool.execute({ action: "back", reason: "t" }, {
      signal: controller.signal,
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).rejects.toThrow(/^cancelled: /);
    // Neither side charged: breaker still closed, no incident streak.
    expect(breaker.stateOf("d0")).toBe("closed");
    expect(breaker.canAdmit("d0")).toBe(true);
  });

  it("threads the call signal into both probe seams", async () => {
    // 能力重审-1: `resolveScreenSize` and `captureFrame` used to take no signal,
    // so a host deadline could abort the action and still leave a 20 s frame
    // probe running — the model had been told to stop while we kept working.
    // Mutation: drop the second argument at either index.ts seam and this red.
    const seen: Record<string, AbortSignal | undefined> = {};
    const controller = new AbortController();
    const tool = defineRunDeviceAction({
      pool: defaultPool(),
      breaker: new DeviceBreaker({ allowedFails: 1, cooldownMs: 30_000 }),
      execute: async () => JSON.stringify({ ok: true }),
      capturePng: async () => pngHeaderOnly(720, 1600),
      logger: { info: () => {}, warn: () => {} },
      defaultDeviceKey: "d0",
      resolveScreenSize: async (_key, signal) => {
        seen.size = signal;
        return { width: 720, height: 1600 };
      },
      captureFrame: async (_key, signal) => {
        seen.frame = signal;
        return pngHeaderOnly(720, 1600).toString("base64");
      },
      hierarchy: async () => TWO_ROWS_XML,
    });
    await tool.execute(
      { action: "click", target: { coordinate: [500, 500] }, reason: "t" },
      { signal: controller.signal } as never,
    );
    expect(seen.size).toBe(controller.signal);
    // The effect frame is only captured for mutating actions; `back` is one.
    await tool.execute({ action: "back", reason: "t" }, { signal: controller.signal } as never);
    expect(seen.frame).toBe(controller.signal);
  });

  it("still dispatches a fully valid call", async () => {
    const { tool } = setup();
    const value = (await tool.execute({ action: "wait", duration_ms: 1, reason: "t" }, exec() as never)) as Record<
      string,
      unknown
    >;
    expect(value).toEqual({ waited_ms: 1 });
  });

  it("keeps wait inside the deadline the tool declares", async () => {
    // 能力重审-1. The defect was deterministic and needed no device: `wait` slept
    // up to 60 s while the tool declares 45 s to the host, so a
    // `duration_ms: 50000` call was aborted at 45 s, its successful
    // `{waited_ms}` swapped for TOOL_TIMEOUT — while our own ledger had already
    // recorded a success. Two halves, one lock: the ceiling must be below the
    // declared deadline, and a call above it is refused rather than clamped
    // (silently waiting less than asked is its own lie).
    // Mutation: raise WAIT_CEILING_MS to 60_000, or drop the refusal branch, and
    // this goes red.
    expect(WAIT_CEILING_MS).toBeLessThan(RUN_DEVICE_ACTION_TIMEOUT_MS);
    const { tool } = setup();
    const declared = (tool as unknown as { timeoutMs?: number }).timeoutMs;
    expect(declared).toBe(RUN_DEVICE_ACTION_TIMEOUT_MS);
    // The schema cannot carry the cap (the official scalar vocabulary is
    // type/enum/const + annotations), so the executor is the enforcement point
    // and the description is the only place the model can learn it.
    const described = (tool as unknown as { parameters: { duration_ms: { description: string } } }).parameters
      .duration_ms.description;
    expect(described).toContain(String(WAIT_CEILING_MS));
    await expect(
      tool.execute({ action: "wait", duration_ms: WAIT_CEILING_MS + 1, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: duration_ms must be <= /);
  });

  it("stops a wait when the host deadline fires mid-sleep", async () => {
    // The other half of the same conflict: before this, the sleep ignored the
    // signal and ran to its full length after the model had given up.
    const { tool } = setup();
    const controller = new AbortController();
    const started = Date.now();
    const pending = tool.execute({ action: "wait", duration_ms: WAIT_CEILING_MS, reason: "t" }, {
      signal: controller.signal,
    } as never);
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toThrow(/^cancelled: /);
    // It really returned early rather than sleeping out the ceiling.
    expect(Date.now() - started).toBeLessThan(5_000);
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
