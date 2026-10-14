/**
 * `autogamer_manage_task` unit locks (T1 / G82).
 *
 * Every answer here is a read over the session's folded task record, so the
 * locks are about behaviour under a missing read model (fail-open to
 * `unknown`, never a throw), about the shape the model reads, and about the
 * two writes: `stop` must leave a card the fold can act on, and `steer` must
 * hand the instruction to the calling agent exactly once.
 */
import { describe, expect, it } from "vitest";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { PreflightResult } from "../src/env/preflight.js";
import type { TaskStore } from "../src/task/cache.js";
import {
  initTaskState,
  applyTaskState,
  DEVICE_ACTION,
  REPORT_STATUS,
  RUN_TASK,
  type TaskFoldState,
} from "../src/task/fold.js";
import { RECENT_ACTIONS_LIMIT } from "../src/task/readModel.js";
import { defineManageTask } from "../src/tools/manageTask.js";

const HEALTHY: PreflightResult = { ok: true, checks: [], finishedAt: "t" };

function storeOf(state: TaskFoldState | undefined): TaskStore {
  return { read: () => state };
}

/** A session with one task that took `effects.length` device actions. */
function sessionWith(effects: string[]): TaskFoldState {
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
    state = applyTaskState(state, {
      type: "tool/result",
      time: 2_000 + position * 1_000,
      data: { message: { toolCallId: callId }, meta: { effect } },
    });
  });
  return state;
}

function defineWith(options?: { store?: TaskStore; env?: PreflightResult }) {
  const steered: string[] = [];
  const tool = defineManageTask({
    store: options?.store ?? storeOf(sessionWith(["changed", "unchanged"])),
    checkEnv: async () => options?.env ?? HEALTHY,
    sessionKey: () => "s-1",
    steer: (instruction) => steered.push(instruction),
  });
  return { tool, steered };
}

function exec(): ToolRunContext {
  // The host type carries more than a signal (agent, session, ...); a tool body
  // under test must not depend on any of it, so the double is the minimum.
  return { signal: new AbortController().signal } as unknown as ToolRunContext;
}

describe("manage_task: definition and refusals", () => {
  it("registers under the autogamer_ prefix", () => {
    const { tool } = defineWith();
    expect(tool.name).toBe("autogamer_manage_task");
    expect(String(tool.description)).not.toMatch(/ARTEMIS|backend/i);
  });

  it("refuses a missing task_id, an unknown action, and inject without an instruction", async () => {
    const { tool, steered } = defineWith();
    await expect(tool.execute({ action: "status" }, exec())).rejects.toThrow(/task_id/);
    await expect(tool.execute({ task_id: "t-1", action: "explode" }, exec())).rejects.toThrow(
      /one of status\/stop\/inject_instruction/,
    );
    await expect(tool.execute({ task_id: "t-1", action: "inject_instruction" }, exec())).rejects.toThrow(
      /instruction is required/,
    );
    expect(steered).toHaveLength(0);
  });
});

describe("manage_task: status is a read over the fold", () => {
  it("answers unknown instead of throwing when no projection has been published", async () => {
    const { tool } = defineWith({ store: storeOf(undefined) });
    const value = (await tool.execute({ task_id: "t-1", action: "status" }, exec())) as Record<string, unknown>;
    expect(value).toMatchObject({ task_id: "t-1", state: "unknown", recent_actions: [] });
  });

  it("answers unknown for a task this session never registered", async () => {
    const { tool } = defineWith();
    const value = (await tool.execute({ task_id: "t-other", action: "status" }, exec())) as Record<string, unknown>;
    expect(value.state).toBe("unknown");
  });

  it("reports the folded step count, the last action and the recent tail", async () => {
    const { tool } = defineWith();
    const value = (await tool.execute({ task_id: "t-1", action: "status" }, exec())) as Record<string, unknown>;
    expect(value).toMatchObject({ state: "running", current_step: 2, last_action: "tap" });
    const recent = value.recent_actions as Array<Record<string, unknown>>;
    expect(recent).toHaveLength(2);
    expect(recent[1]).toMatchObject({ index: 2, action: "tap", effect: "unchanged" });
    // No engine means no wall clock unless something actually ran.
    expect(typeof value.elapsed_seconds).toBe("number");
  });

  it("keeps the context budget: at most the recent limit reaches the model", async () => {
    const { tool } = defineWith({ store: storeOf(sessionWith(Array<string>(RECENT_ACTIONS_LIMIT + 2).fill("changed"))) });
    const value = (await tool.execute({ task_id: "t-1", action: "status" }, exec())) as Record<string, unknown>;
    expect(value.current_step).toBe(RECENT_ACTIONS_LIMIT + 2);
    expect((value.recent_actions as unknown[]).length).toBe(RECENT_ACTIONS_LIMIT);
  });

  it("reports the terminal state the report tool committed", async () => {
    let state = sessionWith(["changed"]);
    state = applyTaskState(state, { type: "tool/call", time: 9_000, data: { callId: "r", name: REPORT_STATUS, arguments: "{}" } });
    state = applyTaskState(state, {
      type: "tool/result",
      time: 9_000,
      data: { message: { toolCallId: "r" }, meta: { status: "completed", tests_failed: 1 } },
    });
    const { tool } = defineWith({ store: storeOf(state) });
    const value = (await tool.execute({ task_id: "t-1", action: "status" }, exec())) as Record<string, unknown>;
    expect(value.state).toBe("completed");
  });
});

describe("manage_task: the two writes", () => {
  it("stop answers stopped and leaves a card the fold can record", async () => {
    const { tool } = defineWith();
    const value = (await tool.execute({ task_id: "t-1", action: "stop" }, exec())) as Record<string, unknown>;
    expect(value).toMatchObject({ task_id: "t-1", state: "stopped" });
    const meta = tool.output?.presentationMeta?.({}, value) as Record<string, unknown>;
    expect(meta).toMatchObject({ taskId: "t-1", state: "stopped" });
  });

  it("steer hands the instruction to the calling agent and reports it", async () => {
    const { tool, steered } = defineWith();
    const value = (await tool.execute(
      { task_id: "t-1", action: "inject_instruction", instruction: "go back" },
      exec(),
    )) as Record<string, unknown>;
    expect(steered).toEqual(["go back"]);
    expect(value).toMatchObject({ task_id: "t-1", state: "running", steered: true });
  });

  it("steering an unknown task still delivers the instruction (fail-open)", async () => {
    const { tool, steered } = defineWith();
    const value = (await tool.execute(
      { task_id: "t-nope", action: "inject_instruction", instruction: "look around" },
      exec(),
    )) as Record<string, unknown>;
    expect(steered).toEqual(["look around"]);
    expect(value.state).toBe("unknown");
  });
});