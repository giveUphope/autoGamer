/**
 * G67 locks: a `#N` handle names the node the model was SHOWN at that position,
 * so resolving it follows that node's identity into the next hierarchy — and a
 * handle nobody observed can never turn into a tap. The resolver this replaces
 * (changelogs #40) re-read array position N off a fresh tree, which silently
 * acts on "whatever sits at N now" — the hazard
 * `docs/migration/inventory/04-agent-stack-config.md:203` lists as a safety
 * defect, not a nicety.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DeviceBreaker } from "../src/breaker.js";
import { LiveObservations } from "../src/observations.js";
import { harness } from "./support/pool.js";
import { ActionIncidents, defineRunDeviceAction } from "../src/tools/runDeviceAction.js";

function node(label: string, cx: number, cy: number): Record<string, unknown> {
  return {
    index: "0",
    text: label,
    "content-desc": "",
    "resource-id": "",
    class: "android.widget.TextView",
    package: "com.example",
    clickable: "true",
    parsed_bounds: { left: cx - 80, top: cy - 30, right: cx + 80, bottom: cy + 30 },
  };
}

const OBSERVED = JSON.stringify([node("亮度", 120, 430), node("显示", 120, 630)]);
// The same two targets with three new rows inserted in front: every array
// position below them moved, neither identity did.
const INSERTED = JSON.stringify([
  node("新1", 400, 40),
  node("新2", 400, 90),
  node("新3", 400, 140),
  node("亮度", 120, 430),
  node("显示", 120, 630),
]);
const WITHOUT_DISPLAY = JSON.stringify([node("亮度", 120, 430)]);
// #0 changed personality (a new 丙 took the first row) while 显示 stayed put.
const REPLACED_FIRST = JSON.stringify([node("丙", 999, 999), node("显示", 120, 630)]);

const log: { tool: string; args: Record<string, unknown> }[] = [];
let hierarchies: string[] = [];
let verdicts: (boolean | undefined)[] = [];
let agent = "agent-1";

function setup(options: { devices?: string[]; observations?: LiveObservations } = {}) {
  log.length = 0;
  hierarchies = [];
  verdicts = [];
  agent = "agent-1";
  const pool = harness(options.devices ?? []).pool;
  const tool = defineRunDeviceAction({
    pool,
    breaker: new DeviceBreaker({ allowedFails: 99, cooldownMs: 0 }),
    client: {
      callTool: async (name: string, args: Record<string, unknown>) => {
        log.push({ tool: name, args });
        if (name === "get_ui_hierarchy") {
          return { content: [{ type: "text", text: hierarchies.length > 0 ? hierarchies.shift()! : OBSERVED }] };
        }
        return { content: [{ type: "text", text: "Success" }] };
      },
    } as never,
    logger: { info: () => {}, warn: () => {} },
    defaultDeviceKey: "default",
    incidents: new ActionIncidents(),
    observations: options.observations ?? new LiveObservations(),
    agentIdOfCall: () => agent,
    resolveScreenSize: async () => ({ width: 720, height: 1600 }),
    captureFrame: async () => "frame",
    compareFrames: async () => (verdicts.length > 0 ? verdicts.shift() : true),
  });
  return tool;
}

function exec(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

async function observe(tool: ReturnType<typeof setup>, device?: string): Promise<void> {
  await tool.execute({ action: "get_ui_hierarchy", ...(device ? { device_serial: device } : {}), reason: "t" }, exec() as never);
  log.length = 0;
}

function taps(): Record<string, unknown>[] {
  return log.filter((call) => call.tool === "tap").map((call) => call.args);
}

function hierarchyCalls(): number {
  return log.filter((call) => call.tool === "get_ui_hierarchy").length;
}

beforeEach(() => {
  log.length = 0;
});

describe("live observation: an unobserved handle is not a target", () => {
  it("refuses before fetching anything, and never reaches the device", async () => {
    const tool = setup();
    await expect(
      tool.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: no live hierarchy for device/);
    expect(taps()).toHaveLength(0);
    expect(hierarchyCalls()).toBe(0);
  });

  it("still resolves a {text} target with no observation at all", async () => {
    const tool = setup();
    await tool.execute({ action: "click", target: { text: "显示" }, reason: "t" }, exec() as never);
    expect(taps()).toHaveLength(1);
    expect(taps()[0].coordinates).toEqual([120, 630]);
  });
});

describe("live observation: resolution follows identity, not array position", () => {
  it("keeps the tap on the observed node when the tree grows in front of it", async () => {
    const tool = setup();
    await observe(tool);
    hierarchies.push(INSERTED);
    await tool.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never);
    // Positional resolution would hit 新2 here.
    expect(taps()).toHaveLength(1);
    expect(taps()[0].coordinates).toEqual([120, 630]);
  });

  it("refuses a handle that is in the fresh tree but never was in the observation", async () => {
    const tool = setup();
    await observe(tool);
    hierarchies.push(INSERTED);
    await expect(
      tool.execute({ action: "click", target: { index: 4 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: #4 is not in the live hierarchy for device/);
    expect(taps()).toHaveLength(0);
    // Re-fetching cannot put a number into a list the model already saw, so the
    // ladder burns no attempts on it.
    expect(hierarchyCalls()).toBe(0);
  });

  it("refuses when the observed node is gone, and says which one", async () => {
    const tool = setup();
    await observe(tool);
    hierarchies.push(WITHOUT_DISPLAY, WITHOUT_DISPLAY, WITHOUT_DISPLAY);
    await expect(
      tool.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: #1 \("显示"\) from the live hierarchy is no longer on device/);
    expect(taps()).toHaveLength(0);
    expect(hierarchyCalls()).toBe(3);
  });
});

describe("live observation: only what the model was shown renews a handle", () => {
  it("does not let the ladder's own re-fetch extend the observation", async () => {
    const tool = setup();
    await observe(tool);
    // First click resolves through a tree whose #0 is 新1 — and that tree must
    // not become the model's live observation.
    hierarchies.push(INSERTED);
    await tool.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never);
    log.length = 0;
    hierarchies.push(INSERTED);
    await tool.execute({ action: "click", target: { index: 0 }, reason: "t" }, exec() as never);
    // #0 is still 亮度 from the OBSERVED list; had the ladder replaced it, this
    // would tap 新1 at [400,40].
    expect(taps()[0].coordinates).toEqual([120, 430]);
  });

  it("replaces the observation with the next one the model asks for", async () => {
    const tool = setup();
    await observe(tool);
    hierarchies.push(INSERTED);
    await tool.execute({ action: "get_ui_hierarchy", reason: "t" }, exec() as never);
    log.length = 0;
    hierarchies.push(INSERTED);
    await tool.execute({ action: "click", target: { index: 0 }, reason: "t" }, exec() as never);
    expect(taps()[0].coordinates).toEqual([400, 40]);
  });
});

describe("live observation: what the ladder reads privately is not a new look", () => {
  it("does not let the post-execution re-resolution claim a fresh observation", async () => {
    const tool = setup();
    await observe(tool); // live list = OBSERVED: #0 亮度, #1 显示
    // Pre-execution read, then the re-resolution after the effect came back empty.
    hierarchies.push(OBSERVED, REPLACED_FIRST);
    verdicts.push(false, false);
    const first = (await tool.execute(
      { action: "click", target: { index: 1 }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(first.effect).toBe("unchanged");
    expect(taps()).toHaveLength(2); // the retry stayed on 显示, which is still there
    log.length = 0;
    // #0 still means 亮度 from OBSERVED. Were the ladder's private read treated as
    // a new look, #0 would now be 丙 and this would tap it.
    hierarchies.push(REPLACED_FIRST, REPLACED_FIRST, REPLACED_FIRST);
    await expect(
      tool.execute({ action: "click", target: { index: 0 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: #0 \("亮度"\) from the live hierarchy is no longer on device/);
    expect(taps()).toHaveLength(0);
  });

  it("refuses a model-visible hierarchy read that is not a node list", async () => {
    const tool = setup();
    hierarchies.push("not-json{{{");
    await expect(
      tool.execute({ action: "get_ui_hierarchy", reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: hierarchy unreadable/);
    // Nothing was observed, so no handle can be claimed either.
    await expect(
      tool.execute({ action: "click", target: { index: 0 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: no live hierarchy for device/);
    expect(taps()).toHaveLength(0);
  });
});

describe("live observation: scoped to the agent and the device that looked", () => {
  it("gives a second agent no handles at all", async () => {
    const tool = setup();
    await observe(tool);
    agent = "agent-2";
    await expect(
      tool.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: no live hierarchy for device/);
    expect(taps()).toHaveLength(0);
  });

  it("does not serve another device the same handles", async () => {
    const tool = setup({ devices: ["A", "B"] });
    await observe(tool, "A");
    await expect(
      tool.execute({ action: "click", device_serial: "B", target: { index: 1 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: no live hierarchy for device B/);
    expect(taps()).toHaveLength(0);
    await tool.execute({ action: "click", device_serial: "A", target: { index: 1 }, reason: "t" }, exec() as never);
    expect(taps()).toHaveLength(1);
  });
});
