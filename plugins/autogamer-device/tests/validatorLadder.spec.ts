/**
 * P1-a validator ladder locks. Direct-drives defineRunDeviceAction with a
 * scripted stub client (hierarchy payloads, tap outcomes, and effect verdicts
 * consumed in order), so every rung is observable without a device:
 * pre-execution retries, the bypass fast path, the post-execution coordinate
 * retry, pixel guidance + category, the incident counter, and the four
 * strictness levels.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DeviceBreaker } from "../src/breaker.js";
import { DeviceGate } from "../src/gate.js";
import {
  ActionIncidents,
  defineRunDeviceAction,
  type ValidatorStrictness,
} from "../src/tools/runDeviceAction.js";

function node(text: string, left: number, top: number, right: number, bottom: number) {
  return {
    index: "0",
    text,
    "content-desc": "",
    "resource-id": "",
    class: "android.widget.TextView",
    package: "com.android.settings",
    clickable: "true",
    parsed_bounds: { left, top, right, bottom },
  };
}

const WITH_TARGET = JSON.stringify([
  node("亮度", 40, 400, 200, 460),
  node("显示", 40, 600, 200, 660),
]);
const WITHOUT_TARGET = JSON.stringify([node("亮度", 40, 400, 200, 460)]);
const MOVED_TARGET = JSON.stringify([
  node("亮度", 40, 400, 200, 460),
  node("显示", 400, 800, 560, 860),
]);

const harness = {
  calls: [] as { tool: string; args: Record<string, unknown> }[],
  hierarchies: [] as string[],
  taps: [] as string[],
  compares: [] as (boolean | undefined)[],
};

function setup(strictness?: ValidatorStrictness) {
  harness.calls.length = 0;
  harness.hierarchies.length = 0;
  harness.taps.length = 0;
  harness.compares.length = 0;
  const tool = defineRunDeviceAction({
    gate: new DeviceGate(),
    breaker: new DeviceBreaker({ allowedFails: 99, cooldownMs: 0 }),
    client: {
      callTool: async (name: string, args: Record<string, unknown>) => {
        harness.calls.push({ tool: name, args });
        if (name === "get_ui_hierarchy") {
          const text = harness.hierarchies.length > 0 ? harness.hierarchies.shift()! : WITH_TARGET;
          return { content: [{ type: "text", text }] };
        }
        if (name === "take_screenshot") {
          throw new Error("no screenshots in ladder tests (frames come from captureFrame)");
        }
        return { content: [{ type: "text", text: harness.taps.length > 0 ? harness.taps.shift()! : "Success" }] };
      },
    } as never,
    logger: { info: () => {}, warn: () => {} },
    defaultDeviceKey: "d0",
    strictness,
    incidents: new ActionIncidents(),
    resolveScreenSize: async () => ({ width: 720, height: 1600 }),
    captureFrame: async () => "frame",
    compareFrames: async () => (harness.compares.length > 0 ? harness.compares.shift() : true),
  });
  return tool;
}

function exec(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

function hierarchyCalls(): number {
  return harness.calls.filter((call) => call.tool === "get_ui_hierarchy").length;
}

function tapCalls(): { tool: string; args: Record<string, unknown> }[] {
  return harness.calls.filter((call) => call.tool === "tap");
}

beforeEach(() => {
  harness.calls.length = 0;
  harness.hierarchies.length = 0;
  harness.taps.length = 0;
  harness.compares.length = 0;
});

describe("validator ladder: pre-execution retries", () => {
  it("finds a late-appearing target within 3 fetches", async () => {
    const tool = setup();
    harness.hierarchies.push(WITHOUT_TARGET, WITH_TARGET);
    harness.compares.push(true);
    const value = (await tool.execute(
      { action: "click", target: { index: 1 }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(value.effect).toBe("changed");
    expect(hierarchyCalls()).toBe(2);
  });

  it("fails after exactly 3 fetches when the target never appears", async () => {
    const tool = setup();
    harness.hierarchies.push(WITHOUT_TARGET, WITHOUT_TARGET, WITHOUT_TARGET, WITH_TARGET);
    await expect(
      tool.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: no element #1/);
    expect(hierarchyCalls()).toBe(3);
  });

  it("resolves once with strictness off", async () => {
    const tool = setup("off");
    harness.hierarchies.push(WITHOUT_TARGET, WITH_TARGET);
    await expect(
      tool.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: no element #1/);
    expect(hierarchyCalls()).toBe(1);
  });

  it("fails fast on an unreadable hierarchy without retrying", async () => {
    const tool = setup();
    harness.hierarchies.push("not-json{{{", WITH_TARGET, WITH_TARGET);
    await expect(
      tool.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: hierarchy unreadable/);
    expect(hierarchyCalls()).toBe(1);
  });

  it("fails fast without fetching when no target was given", async () => {
    const tool = setup();
    await expect(
      tool.execute({ action: "click", target: {}, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: this action needs a target/);
    expect(hierarchyCalls()).toBe(0);
  });
});

describe("validator ladder: post-execution retry", () => {
  it("reruns once with fresh coordinates after an unchanged effect", async () => {
    const tool = setup();
    harness.hierarchies.push(WITH_TARGET);
    harness.compares.push(false, true);
    // Re-resolution sees the target at its moved bounds.
    harness.hierarchies.push(MOVED_TARGET);
    const value = (await tool.execute(
      { action: "click", target: { index: 1 }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(value.effect).toBe("changed");
    const taps = tapCalls();
    expect(taps).toHaveLength(2);
    expect(taps[0].args.coordinates).toEqual([120, 630]);
    expect(taps[1].args.coordinates).toEqual([480, 830]);
    expect(value).not.toHaveProperty("incident");
  });

  it("reports disappeared with guidance when the target is gone", async () => {
    const tool = setup();
    harness.hierarchies.push(WITH_TARGET);
    harness.compares.push(false);
    harness.hierarchies.push(WITHOUT_TARGET);
    const value = (await tool.execute(
      { action: "click", target: { index: 1 }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(value.effect).toBe("unchanged");
    expect(value.category).toBe("disappeared");
    expect(value.pixel_guidance).toContain("Take a screenshot");
    expect(tapCalls()).toHaveLength(1);
  });

  it("does not retry target-less actions", async () => {
    const tool = setup();
    harness.compares.push(false);
    const value = (await tool.execute(
      { action: "launch_app", package: "com.example", reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(value.effect).toBe("unchanged");
    expect(value.category).toBe("general");
    expect(value.pixel_guidance).toContain("Take a screenshot");
    expect(harness.calls.filter((call) => call.tool === "launch_app")).toHaveLength(1);
  });

  it("does not retry coordinate-called actions", async () => {
    const tool = setup();
    harness.compares.push(false);
    const value = (await tool.execute(
      { action: "click", target: { coordinate: [500, 500] }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(value.effect).toBe("unchanged");
    expect(tapCalls()).toHaveLength(1);
  });

  it("returns a bare unchanged with strictness off", async () => {
    const tool = setup("off");
    harness.hierarchies.push(WITH_TARGET);
    harness.compares.push(false);
    const value = (await tool.execute(
      { action: "click", target: { index: 1 }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(value.effect).toBe("unchanged");
    expect(tapCalls()).toHaveLength(1);
    expect(value).not.toHaveProperty("pixel_guidance");
    expect(value).not.toHaveProperty("incident");
  });

  it("leaves unknown verdicts alone (fail-open: no ladder, no count)", async () => {
    const tool = setup();
    harness.hierarchies.push(WITH_TARGET);
    harness.compares.push(undefined);
    const value = (await tool.execute(
      { action: "click", target: { index: 1 }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(value.effect).toBe("unknown");
    expect(tapCalls()).toHaveLength(1);
    expect(value).not.toHaveProperty("pixel_guidance");
  });
});

describe("validator ladder: incident ledger", () => {
  async function failThrice(strictness?: ValidatorStrictness): Promise<string[]> {
    const tool = setup(strictness);
    const messages: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      try {
        await tool.execute({ action: "press_key", key: "frob", reason: "t" }, exec() as never);
      } catch (error) {
        messages.push((error as Error).message);
      }
    }
    return messages;
  }

  it("attaches an incident on the third consecutive task failure", async () => {
    const messages = await failThrice();
    expect(messages[0]).not.toContain("incident");
    expect(messages[1]).not.toContain("incident");
    expect(messages[2]).toMatch(/^task:.*3 consecutive task failures/);
    expect(messages[2]).toContain("report_task_status");
  });

  it("uses milestone wording above final", async () => {
    const messages = await failThrice("checkpoints");
    expect(messages[0]).not.toContain("Milestone");
    expect(messages[2]).toContain("Milestone audit");
    const strict = await failThrice("strict");
    expect(strict[2]).toContain("Milestone audit");
    const fin = await failThrice("final");
    expect(fin[2]).not.toContain("Milestone");
  });

  it("never attaches an incident with strictness off", async () => {
    const messages = await failThrice("off");
    expect(messages.join("")).not.toContain("incident");
  });

  it("resets the count on success", async () => {
    const tool = setup();
    for (let i = 0; i < 2; i += 1) {
      await expect(
        tool.execute({ action: "press_key", key: "frob", reason: "t" }, exec() as never),
      ).rejects.toThrow(/^task: unknown key/);
    }
    await tool.execute({ action: "wait", duration_ms: 1, reason: "t" }, exec() as never);
    await expect(
      tool.execute({ action: "press_key", key: "frob", reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: unknown key "(?!.*incident)/);
  });

  it("an unknown verdict neither counts nor resets", async () => {
    const tool = setup();
    for (let i = 0; i < 2; i += 1) {
      await expect(
        tool.execute({ action: "press_key", key: "frob", reason: "t" }, exec() as never),
      ).rejects.toThrow(/^task: unknown key/);
    }
    harness.hierarchies.push(WITH_TARGET);
    harness.compares.push(undefined);
    await tool.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never);
    await expect(
      tool.execute({ action: "press_key", key: "frob", reason: "t" }, exec() as never),
    ).rejects.toThrow(/3 consecutive task failures/);
  });
});

describe("validator ladder: strictness prompts", () => {
  it("adds a self-check to mutating successes only under strict", async () => {
    const strict = setup("strict");
    harness.hierarchies.push(WITH_TARGET);
    harness.compares.push(true);
    const strictValue = (await strict.execute(
      { action: "click", target: { index: 1 }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(strictValue.self_check).toContain("Self-check");

    const fin = setup("final");
    harness.hierarchies.push(WITH_TARGET);
    harness.compares.push(true);
    const finalValue = (await fin.execute(
      { action: "click", target: { index: 1 }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(finalValue).not.toHaveProperty("self_check");
  });
});

describe("validator ladder: unchanged streaks and mid-ladder transport death", () => {
  it("accumulates unchanged streaks to an incident", async () => {
    const tool = setup("checkpoints");
    for (let i = 0; i < 3; i += 1) {
      harness.hierarchies.push(WITH_TARGET, WITH_TARGET);
      harness.compares.push(false, false);
      const value = (await tool.execute(
        { action: "click", target: { index: 1 }, reason: "t" },
        exec() as never,
      )) as Record<string, unknown>;
      if (i < 2) {
        expect(value).not.toHaveProperty("incident");
      } else {
        expect(value.incident).toEqual({ consecutive_failures: 3 });
        expect(value.audit_request).toContain("Milestone audit");
      }
    }
  });

  it("classifies a transport death mid-ladder as environment", async () => {
    let hierarchies = 0;
    const failing = defineRunDeviceAction({
      gate: new DeviceGate(),
      breaker: new DeviceBreaker({ allowedFails: 99, cooldownMs: 0 }),
      client: {
        callTool: async (name: string) => {
          if (name === "get_ui_hierarchy") {
            hierarchies += 1;
            if (hierarchies >= 2) throw new Error("Connection closed");
            return { content: [{ type: "text", text: WITH_TARGET }] };
          }
          return { content: [{ type: "text", text: "Success" }] };
        },
      } as never,
      logger: { info: () => {}, warn: () => {} },
      defaultDeviceKey: "d0",
      incidents: new ActionIncidents(),
      resolveScreenSize: async () => ({ width: 720, height: 1600 }),
      captureFrame: async () => "frame",
      compareFrames: async () => false,
    });
    await expect(
      failing.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^environment: action transport failed/);
  });

  it("classifies a screenshot-branch transport death as environment", async () => {
    const failing = defineRunDeviceAction({
      gate: new DeviceGate(),
      breaker: new DeviceBreaker({ allowedFails: 99, cooldownMs: 0 }),
      client: {
        callTool: async () => {
          throw new Error("Connection closed");
        },
      } as never,
      logger: { info: () => {}, warn: () => {} },
      defaultDeviceKey: "d0",
      incidents: new ActionIncidents(),
      resolveScreenSize: async () => ({ width: 720, height: 1600 }),
    });
    await expect(
      failing.execute({ action: "take_screenshot", reason: "t" }, exec() as never),
    ).rejects.toThrow(/^environment: action transport failed/);
  });
});
