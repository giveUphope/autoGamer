/**
 * `autogamer_inspect_trace` unit locks (Phase 2). Summary slicing (first 3 +
 * last 3 + uncovered failures, deduped by step index), the full passthrough,
 * and the failure heuristic live here — including the pure `summarizeSteps`
 * export, which is where the edge arithmetic is cheapest to pin down.
 */
import { describe, expect, it } from "vitest";
import type { ArtemisBackend } from "../src/artemis/types.js";
import type { PreflightResult } from "../src/env/preflight.js";
import { defineInspectTrace, summarizeSteps } from "../src/tools/inspectTrace.js";
import type { TaskStep } from "../src/artemis/types.js";

const HEALTHY: PreflightResult = { ok: true, checks: [], finishedAt: "t" };

function steps(count: number, failedAt?: number[]): TaskStep[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    action: `tap ${index}`,
    ...(failedAt?.includes(index) ? { status: "failed" } : {}),
  }));
}

function defineWith(all: TaskStep[]): {
  tool: ReturnType<typeof defineInspectTrace>;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  const backend: ArtemisBackend = {
    getDeviceState: async () => ({ deviceSerial: "", connected: false }),
    startTask: async (args) => ({ taskId: "t", profile: args.profile, startedAt: "t" }),
    manageTask: async (args) => ({ taskId: args.taskId }),
    inspectTrace: async (args) => {
      calls.push(args);
      return { taskId: args.traceId, finalStatus: "failed", totalSteps: all.length, steps: all, artifactPaths: ["/t"] };
    },
    diagnose: async () => ({ recentCrashes: [], recommendations: [] }),
    dispose: async () => undefined,
  };
  return { tool: defineInspectTrace({ backend, checkEnv: async () => HEALTHY }), calls };
}

function exec(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

describe("summarizeSteps: edges plus uncovered failures", () => {
  it("passes short traces through untouched", () => {
    expect(summarizeSteps(steps(6))).toHaveLength(6);
  });

  it("returns head 3 plus tail 3 on a clean long trace", () => {
    const out = summarizeSteps(steps(10));
    expect(out.map((step) => step.index)).toEqual([0, 1, 2, 7, 8, 9]);
  });

  it("pulls a failed middle step into the summary exactly once", () => {
    const out = summarizeSteps(steps(10, [5]));
    expect(out.map((step) => step.index)).toEqual([0, 1, 2, 5, 7, 8, 9]);
  });

  it("does not duplicate a failed step already on an edge", () => {
    const out = summarizeSteps(steps(10, [8]));
    expect(out.map((step) => step.index)).toEqual([0, 1, 2, 7, 8, 9]);
  });

  it("treats an explicit false flag as failed too", () => {
    const all = steps(10);
    all[4] = { index: 4, action: "tap", ok: false };
    expect(summarizeSteps(all).map((step) => step.index)).toEqual([0, 1, 2, 4, 7, 8, 9]);
  });
});

describe("inspect_trace: execute", () => {
  it("defaults to summary and always opens view_summary over the trace", async () => {
    const { tool, calls } = defineWith(steps(10, [5]));
    const value = (await tool.execute({ task_id: "t-1" }, exec())) as {
      steps: { index?: number }[];
      total_steps: number;
      artifact_paths: string[];
    };
    expect(calls).toEqual([{ traceId: "t-1" }]);
    expect(value.total_steps).toBe(10);
    expect(value.steps.map((step) => step.index)).toEqual([0, 1, 2, 5, 7, 8, 9]);
    expect(value.artifact_paths).toEqual(["/t"]);
  });

  it("full returns every step unsliced", async () => {
    const { tool } = defineWith(steps(10, [5]));
    const value = (await tool.execute({ task_id: "t-1", format: "full" }, exec())) as {
      steps: unknown[];
    };
    expect(value.steps).toHaveLength(10);
  });

  it("refuses an empty task_id before the backend", async () => {
    const { tool } = defineWith([]);
    await expect(tool.execute({ task_id: "" }, exec())).rejects.toThrow(/task_id must be a non-empty string/);
  });
});
