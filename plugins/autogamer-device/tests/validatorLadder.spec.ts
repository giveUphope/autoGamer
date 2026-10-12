/**
 * P1-a validator ladder locks. Direct-drives defineRunDeviceAction with a
 * scripted stub client (hierarchy payloads, tap outcomes, and effect verdicts
 * consumed in order), so every rung is observable without a device. Since G67 a
 * `{index}` handle only means something against what the model was last shown,
 * so every index-target case observes a hierarchy first (see `observe()`):
 * that call is the model's own observation, and the log is cleared after it so
 * `hierarchyCalls()` still counts only the ladder's re-fetches:
 * pre-execution retries, the bypass fast path, the post-execution coordinate
 * retry, pixel guidance + category, the incident counter, and the four
 * strictness levels.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DeviceBreaker } from "../src/breaker.js";
import { defaultPool } from "./support/pool.js";
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
// 显示 slid 80px down: inside the reach a text label may claim (MAX_HANDLE_SHIFT).
const MOVED_TARGET = JSON.stringify([
  node("亮度", 40, 400, 200, 460),
  node("显示", 40, 680, 200, 740),
]);
// Same label 411px away: no text label can claim that is the node it saw, so the
// ladder reports it missing rather than chasing it (G68 ③, upstream
// "prefer disappeared over shifted", precondition_xml.py:392-395).
const MOVED_FAR = JSON.stringify([
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
    pool: defaultPool(),
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

/**
 * G67: give the model its live observation of `payload`, then reset the call
 * log so the assertions below count only what the action itself fetched.
 */
async function observe(tool: ReturnType<typeof setup>, payload = WITH_TARGET): Promise<void> {
  harness.hierarchies.push(payload);
  await tool.execute({ action: "get_ui_hierarchy", reason: "t" }, exec() as never);
  harness.calls.length = 0;
}

const GONE = /^task: #1 \("显示"\) from the live hierarchy is no longer on device/;

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
    await observe(tool);
    harness.hierarchies.push(WITHOUT_TARGET, WITH_TARGET);
    harness.compares.push(true);
    const value = (await tool.execute(
      { action: "click", target: { index: 1 }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(value.effect).toBe("changed");
    expect(hierarchyCalls()).toBe(2);
  });

  it("fails after exactly 3 fetches when the observed target never comes back", async () => {
    const tool = setup();
    await observe(tool);
    harness.hierarchies.push(WITHOUT_TARGET, WITHOUT_TARGET, WITHOUT_TARGET, WITH_TARGET);
    await expect(
      tool.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(GONE);
    expect(hierarchyCalls()).toBe(3);
  });

  it("resolves once with strictness off", async () => {
    const tool = setup("off");
    await observe(tool);
    harness.hierarchies.push(WITHOUT_TARGET, WITH_TARGET);
    await expect(
      tool.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(GONE);
    expect(hierarchyCalls()).toBe(1);
  });

  it("fails fast on an unreadable hierarchy without retrying", async () => {
    const tool = setup();
    await observe(tool);
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
    await observe(tool);
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
    expect(taps[1].args.coordinates).toEqual([120, 710]);
    expect(value).not.toHaveProperty("incident");
  });

  it("does not chase a same-labelled node that moved further than the label can claim", async () => {
    const tool = setup();
    await observe(tool);
    harness.hierarchies.push(WITH_TARGET);
    harness.compares.push(false);
    harness.hierarchies.push(MOVED_FAR);
    const value = (await tool.execute(
      { action: "click", target: { index: 1 }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(value.effect).toBe("unchanged");
    expect(value.category).toBe("disappeared");
    expect(tapCalls()).toHaveLength(1);
  });

  it("reports disappeared with guidance when the target is gone", async () => {
    const tool = setup();
    await observe(tool);
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
    await observe(tool);
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
    await observe(tool);
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
    // Observed before the streak: a successful look is a success like any other.
    await observe(tool);
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


describe("validator ladder: incident CLOSED notice (changelogs #62)", () => {
  // Upstream keeps an incident open until a LATER success closes it, then renders
  // a one-turn notice to settle the original intent (`graph/state.py:136-141`,
  // `validator/execution_loop.py:477-488`, `operator/prompts.py:576-592`).
  async function announce(tool: ReturnType<typeof setup>): Promise<void> {
    for (let i = 0; i < 3; i += 1) {
      await expect(
        tool.execute({ action: "press_key", key: "frob", reason: "t" }, exec() as never),
      ).rejects.toThrow(/^task: unknown key/);
    }
  }

  it("announces the closure exactly once, on the success that ends an open incident", async () => {
    const tool = setup();
    await announce(tool);
    const closed = (await tool.execute(
      { action: "wait", duration_ms: 1, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(closed.incident_closed).toEqual({ consecutive_failures: 3 });
    expect(String(closed.closure_request)).toContain("CLOSED");
    expect(String(closed.closure_request)).toContain("already served, still pending, or no longer needed");
    const next = (await tool.execute(
      { action: "wait", duration_ms: 1, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(next).not.toHaveProperty("incident_closed");
    expect(next).not.toHaveProperty("closure_request");
  });

  it("says nothing on a success when no incident was ever announced", async () => {
    const tool = setup();
    await expect(
      tool.execute({ action: "press_key", key: "frob", reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: unknown key/);
    const value = (await tool.execute(
      { action: "wait", duration_ms: 1, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(value).not.toHaveProperty("incident_closed");
  });

  it("closes on a ladder retry that finally moved the screen", async () => {
    const tool = setup();
    await observe(tool);
    await announce(tool);
    harness.hierarchies.push(WITH_TARGET, MOVED_TARGET);
    harness.compares.push(false, true);
    const value = (await tool.execute(
      { action: "click", target: { index: 1 }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(value.effect).toBe("changed");
    expect(value.incident_closed).toEqual({ consecutive_failures: 3 });
    expect(tapCalls()).toHaveLength(2);
  });
});

describe("validator ladder: strictness prompts", () => {
  it("adds a self-check to mutating successes only under strict", async () => {
    const strict = setup("strict");
    await observe(strict);
    harness.hierarchies.push(WITH_TARGET);
    harness.compares.push(true);
    const strictValue = (await strict.execute(
      { action: "click", target: { index: 1 }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(strictValue.self_check).toContain("Self-check");

    const fin = setup("final");
    await observe(fin);
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
    await observe(tool);
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
      pool: defaultPool(),
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
    // The first fetch is the model's observation; the ladder's re-fetch dies.
    await failing.execute({ action: "get_ui_hierarchy", reason: "t" }, exec() as never);
    await expect(
      failing.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^environment: action transport failed/);
  });

  it("classifies a screenshot-branch transport death as environment", async () => {
    const failing = defineRunDeviceAction({
      pool: defaultPool(),
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
