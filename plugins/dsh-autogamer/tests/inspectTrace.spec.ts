/**
 * `autogamer_inspect_trace` unit locks (T1 / G82).
 *
 * The trace is now the session's own folded step list, so these locks are about
 * two things: that the viewer degrades to an empty, `unknown` trace instead of
 * failing when no projection has been published, and that `summary` keeps the
 * promise its name makes — the edges plus every failed step the edges did not
 * already cover, each exactly once. "Failed" is read off the step's own effect
 * verdict and incident flag, not off provider wording that no longer exists.
 */
import { describe, expect, it } from "vitest";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { PreflightResult } from "../src/env/preflight.js";
import type { TaskStore } from "../src/task/cache.js";
import { applyTaskState, initTaskState, DEVICE_ACTION, RUN_TASK, type TaskFoldState } from "../src/task/fold.js";
import { isFailedStep, summarizeSteps, SUMMARY_EDGE } from "../src/task/readModel.js";
import { defineInspectTrace } from "../src/tools/inspectTrace.js";

const HEALTHY: PreflightResult = { ok: true, checks: [], finishedAt: "t" };

/** `effects` are read in order; "" means an incident rather than a bad verdict. */
function sessionWith(effects: readonly string[]): TaskFoldState {
  let state = applyTaskState(
    applyTaskState(initTaskState(), {
      type: "tool/call",
      time: 1_000,
      data: { callId: "c0", name: RUN_TASK, arguments: JSON.stringify({ instruction: "x" }) },
    }),
    { type: "tool/result", time: 1_000, data: { message: { toolCallId: "c0" }, meta: { taskId: "t-1" } } },
  );
  effects.forEach((effect, position) => {
    const callId = `a${position}`;
    state = applyTaskState(state, {
      type: "tool/call",
      time: 2_000 + position * 1_000,
      data: { callId, name: DEVICE_ACTION, arguments: JSON.stringify({ action: "tap" }) },
    });
    const meta =
      effect === "" ? { effect: "unchanged", incident: { consecutive_failures: 3 } } : { effect };
    state = applyTaskState(state, {
      type: "tool/result",
      time: 2_000 + position * 1_000,
      data: { message: { toolCallId: callId }, meta },
    });
  });
  return state;
}

function defineWith(state?: TaskFoldState) {
  const store: TaskStore = { read: () => state };
  const tool = defineInspectTrace({
    store,
    checkEnv: async () => HEALTHY,
    sessionKey: () => "s-1",
  });
  return tool;
}

function exec(): ToolRunContext {
  // The host type carries more than a signal (agent, session, ...); a tool body
  // under test must not depend on any of it, so the double is the minimum.
  return { signal: new AbortController().signal } as unknown as ToolRunContext;
}

describe("inspect_trace: definition and refusals", () => {
  it("registers under the autogamer_ prefix", () => {
    const tool = defineWith(sessionWith([]));
    expect(tool.name).toBe("autogamer_inspect_trace");
    expect(String(tool.description)).not.toMatch(/ARTEMIS|backend/i);
  });

  it("refuses a missing task_id", async () => {
    await expect(defineWith().execute({}, exec())).rejects.toThrow(/task_id/);
  });
});

describe("inspect_trace: reading the folded steps", () => {
  it("degrades to an empty unknown trace with no published projection", async () => {
    const value = (await defineWith().execute({ task_id: "t-1" }, exec())) as Record<string, unknown>;
    expect(value).toMatchObject({ final_status: "unknown", total_steps: 0, steps: [], artifact_paths: [] });
  });

  it("summary returns the edges plus failures; full returns everything", async () => {
    const effects = Array<string>(10).fill("changed");
    effects[4] = "unchanged";
    const tool = defineWith(sessionWith(effects));
    const summary = (await tool.execute({ task_id: "t-1" }, exec())) as Record<string, unknown>;
    const full = (await tool.execute({ task_id: "t-1", format: "full" }, exec())) as Record<string, unknown>;
    expect(summary.total_steps).toBe(10);
    expect((summary.steps as unknown[]).length).toBe(SUMMARY_EDGE * 2 + 1);
    expect((full.steps as unknown[]).length).toBe(10);
    const rendered = summary.steps as Array<Record<string, unknown>>;
    expect(rendered.filter((row) => row.effect === "unchanged")).toHaveLength(1);
  });

  it("renders each step's verdict and incident flag, and lists no artifacts", async () => {
    const tool = defineWith(sessionWith(["changed", ""]));
    const value = (await tool.execute({ task_id: "t-1", format: "full" }, exec())) as Record<string, unknown>;
    expect(value.steps).toEqual([
      { action: "tap", effect: "changed", timestamp: new Date(2_000).toISOString() },
      { action: "tap", effect: "unchanged", incident: true, timestamp: new Date(3_000).toISOString() },
    ]);
    expect(value.artifact_paths).toEqual([]);
  });
});

describe("summarizeSteps: edges plus uncovered failures", () => {
  const step = (effect: string, incident = false, at = 0) => ({
    callId: `c${at}`,
    action: "tap",
    effect: effect as "changed" | "unchanged" | "unknown",
    incident,
    at,
  });

  it("returns everything when the trace is short", () => {
    expect(summarizeSteps([step("changed", false, 1), step("changed", false, 2)])).toHaveLength(2);
  });

  it("pulls a failed middle step into the summary exactly once", () => {
    const steps = Array.from({ length: 10 }, (_, position) => step("changed", false, position));
    steps[5] = step("unchanged", false, 5);
    const out = summarizeSteps(steps);
    expect(out).toHaveLength(7);
    expect(out.filter((row) => row.at === 5)).toHaveLength(1);
  });

  it("counts an incident as a failure even when the verdict is unknown", () => {
    expect(isFailedStep(step("unknown", true))).toBe(true);
    expect(isFailedStep(step("unknown", false))).toBe(false);
    expect(isFailedStep(step("changed", false))).toBe(false);
  });

  it("does not duplicate a failure the edges already show", () => {
    const steps = Array.from({ length: 10 }, (_, position) => step("changed", false, position));
    steps[0] = step("unchanged", false, 0);
    steps[9] = step("unchanged", false, 9);
    expect(summarizeSteps(steps)).toHaveLength(SUMMARY_EDGE * 2);
  });
});