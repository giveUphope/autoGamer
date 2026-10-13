/**
 * `autogamer_manage_task` unit locks (Phase 2). The three branches, the
 * inject-instruction requirement, the 5-step context budget, and tolerant
 * field mapping live here; the backend double answers fixed dicts.
 */
import { describe, expect, it } from "vitest";
import type { ArtemisBackend, ManageArgs } from "../src/artemis/types.js";
import type { PreflightResult } from "../src/env/preflight.js";
import { defineManageTask, RECENT_ACTIONS_LIMIT } from "../src/tools/manageTask.js";

const HEALTHY: PreflightResult = { ok: true, checks: [], finishedAt: "t" };

function defineWith(answer: Record<string, unknown>): {
  tool: ReturnType<typeof defineManageTask>;
  calls: ManageArgs[];
} {
  const calls: ManageArgs[] = [];
  const backend: ArtemisBackend = {
    getDeviceState: async () => ({ deviceSerial: "", connected: false }),
    startTask: async (args) => ({ taskId: "t", profile: args.profile, startedAt: "t" }),
    manageTask: async (args) => {
      calls.push(args);
      return {
        taskId: args.taskId,
        state: answer.state as string | undefined,
        currentStep: answer.current_step as number | undefined,
        totalSteps: answer.total_steps as number | undefined,
        lastAction: answer.last_action as string | undefined,
        recentSteps: (answer.steps as { index?: number }[] | undefined) ?? [],
        elapsedSeconds: answer.elapsed as number | undefined,
        finalSummary: answer.summary as string | undefined,
      };
    },
    inspectTrace: async (args) => ({ taskId: args.traceId, steps: [], artifactPaths: [] }),
    diagnose: async () => ({ recentCrashes: [], recommendations: [] }),
    dispose: async () => undefined,
  };
  return { tool: defineManageTask({ backend, checkEnv: async () => HEALTHY }), calls };
}

function exec(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

describe("manage_task: branches", () => {
  it("status forwards task_id over trace_id and maps the answer", async () => {
    const { tool, calls } = defineWith({ state: "running", current_step: 4, total_steps: 9 });
    const value = (await tool.execute({ task_id: "t-1", action: "status" }, exec())) as Record<string, unknown>;
    expect(calls).toEqual([{ taskId: "t-1", action: "status" }]);
    expect(value).toMatchObject({ task_id: "t-1", state: "running", current_step: 4, total_steps: 9 });
  });

  it("inject without an instruction is a caller bug, refused before the backend", async () => {
    const { tool, calls } = defineWith({});
    await expect(tool.execute({ task_id: "t-1", action: "inject_instruction" }, exec())).rejects.toThrow(
      /instruction is required/,
    );
    expect(calls).toHaveLength(0);
  });

  it("inject forwards the instruction", async () => {
    const { tool, calls } = defineWith({ state: "running" });
    await tool.execute({ task_id: "t-1", action: "inject_instruction", instruction: "go back" }, exec());
    expect(calls).toEqual([{ taskId: "t-1", action: "inject_instruction", instruction: "go back" }]);
  });

  it("an unknown action is refused without calling the backend", async () => {
    const { tool, calls } = defineWith({});
    await expect(tool.execute({ task_id: "t-1", action: "explode" }, exec())).rejects.toThrow(
      /one of status\/stop\/inject_instruction/,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("manage_task: the 5-step context budget", () => {
  it("never hands the model more than the newest 5 steps", async () => {
    expect(RECENT_ACTIONS_LIMIT).toBe(5);
    const steps = Array.from({ length: 8 }, (_, index) => ({ index, action: `tap ${index}` }));
    const { tool } = defineWith({ state: "running", steps });
    const value = (await tool.execute({ task_id: "t-1", action: "status" }, exec())) as {
      recent_actions: { index?: number }[];
    };
    expect(value.recent_actions.map((step) => step.index)).toEqual([3, 4, 5, 6, 7]);
  });
});
