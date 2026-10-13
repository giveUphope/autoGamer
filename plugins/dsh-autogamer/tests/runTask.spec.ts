/**
 * `autogamer_run_task` unit locks (Phase 2). Backend and preflight are
 * doubles: instruction validation, profile mapping, serial fallback, and the
 * immediate (non-blocking) return shape live here.
 */
import { describe, expect, it } from "vitest";
import type { ArtemisBackend, TaskStartArgs } from "../src/artemis/types.js";
import type { PreflightResult } from "../src/env/preflight.js";
import { defineRunTask } from "../src/tools/runTask.js";

const HEALTHY: PreflightResult = { ok: true, checks: [], finishedAt: "t" };
const BROKEN: PreflightResult = {
  ok: false,
  checks: [{ id: "uv", ok: false, detail: "missing", fix: "install uv" }],
  finishedAt: "t",
};

function defineWith(overrides?: {
  calls?: TaskStartArgs[];
  env?: PreflightResult;
  defaultProfile?: "flash" | "pro";
  defaultDeviceSerial?: string;
}): { tool: ReturnType<typeof defineRunTask>; calls: TaskStartArgs[] } {
  const calls: TaskStartArgs[] = overrides?.calls ?? [];
  const backend: ArtemisBackend = {
    getDeviceState: async () => ({ deviceSerial: "", connected: false }),
    startTask: async (args) => {
      calls.push(args);
      return { taskId: "t-9", profile: args.profile, startedAt: "2026-10-14T00:00:00.000Z" };
    },
    manageTask: async (args) => ({ taskId: args.taskId }),
    inspectTrace: async (args) => ({ taskId: args.traceId, steps: [], artifactPaths: [] }),
    diagnose: async () => ({ recentCrashes: [], recommendations: [] }),
    dispose: async () => undefined,
  };
  const tool = defineRunTask({
    backend,
    checkEnv: async () => overrides?.env ?? HEALTHY,
    defaultProfile: overrides?.defaultProfile ?? "flash",
    defaultDeviceSerial: overrides?.defaultDeviceSerial ?? "",
  });
  return { tool, calls };
}

function exec(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

describe("run_task: definition", () => {
  it("registers under the autogamer_ prefix with the instruction contract", () => {
    const { tool } = defineWith();
    expect(tool.name).toBe("autogamer_run_task");
    const parameters = tool.parameters as Record<string, { type?: string; required?: boolean }>;
    expect(parameters.instruction?.required).toBe(true);
    expect(typeof tool.description).toBe("string");
  });
});

describe("run_task: execute", () => {
  it("refuses an empty or over-long instruction before touching anything", async () => {
    const { tool, calls } = defineWith();
    await expect(tool.execute({ instruction: "  " }, exec())).rejects.toThrow(/non-empty/);
    await expect(tool.execute({ instruction: "x".repeat(2000) }, exec())).rejects.toThrow(/2000/);
    expect(calls).toHaveLength(0);
  });

  it("refuses on a failed preflight with the fix attached", async () => {
    const { tool, calls } = defineWith({ env: BROKEN });
    await expect(tool.execute({ instruction: "open settings" }, exec())).rejects.toThrow(
      /preflight failed at uv.*install uv/,
    );
    expect(calls).toHaveLength(0);
  });

  it("maps flash/pro onto the provider models and returns without blocking", async () => {
    const { tool, calls } = defineWith({ defaultDeviceSerial: "em-d" });
    const value = (await tool.execute({ instruction: "open settings", profile: "pro" }, exec())) as Record<
      string,
      unknown
    >;
    expect(calls).toEqual([{ instruction: "open settings", profile: "Pro", deviceSerial: "em-d" }]);
    expect(value).toMatchObject({ task_id: "t-9", status: "running", profile: "pro" });
    expect(typeof value.started_at).toBe("string");
  });

  it("falls back to the configured default profile and omits an empty serial", async () => {
    const { tool, calls } = defineWith({ defaultProfile: "pro", defaultDeviceSerial: "" });
    await tool.execute({ instruction: "x" }, exec());
    expect(calls).toEqual([{ instruction: "x", profile: "Pro" }]);
  });
});
