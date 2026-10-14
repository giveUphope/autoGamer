/**
 * Task-fold locks (T1 / G82).
 *
 * The fold is what replaces the py task engine's private state, so these locks
 * pin the properties the host's projection registry depends on rather than the
 * row layout: unrelated events fold to *the same reference* (that is what makes
 * the registry's "unchanged reference = zero downstream work" claim true),
 * a step needs its `tool/call` to pair with, and every read is fail-open - a
 * malformed payload must fold to "no change", never throw, because `apply` runs
 * inside the host's drive over every committed event of the session.
 */
import { describe, expect, it } from "vitest";
import {
  DEVICE_ACTION,
  MANAGE_TASK,
  REPORT_STATUS,
  RUN_TASK,
  applyTaskState,
  foldTaskEvents,
  initTaskState,
  type FoldEvent,
  type TaskFoldState,
  type TaskRecord,
  type TaskStep,
} from "../src/task/fold.js";

let clock = 1_700_000_000_000;

function call(name: string, args: Record<string, unknown>, callId: string): FoldEvent {
  return { type: "tool/call", time: (clock += 5), data: { callId, name, arguments: JSON.stringify(args) } };
}

function result(callId: string, meta: Record<string, unknown> | undefined): FoldEvent {
  return {
    type: "tool/result",
    time: (clock += 5),
    data: { message: { role: "tool", toolCallId: callId }, ...(meta === undefined ? {} : { meta }) },
  };
}

function unrelated(): FoldEvent {
  return { type: "user/message", time: (clock += 5), data: { role: "user", content: [] } };
}

/** A task the fold must have produced; a miss is the failure under test. */
function task(state: TaskFoldState, id = "t-1"): TaskRecord {
  const found = state.tasks[id];
  if (found === undefined) throw new Error(`expected task ${id}, got ${JSON.stringify(Object.keys(state.tasks))}`);
  return found;
}

/** Steps of one task - always an array, so "none" and "absent" read the same. */
function steps(state: TaskFoldState, id = "t-1"): TaskStep[] {
  return state.steps[id] ?? [];
}

function step(state: TaskFoldState, position: number, id = "t-1"): TaskStep {
  const found = steps(state, id)[position];
  if (found === undefined) throw new Error(`expected step ${position}, got ${steps(state, id).length}`);
  return found;
}

function startTask(state: TaskFoldState, callId = "c1"): TaskFoldState {
  return applyTaskState(
    applyTaskState(
      state,
      call(RUN_TASK, { instruction: "open settings and enable wifi", profile: "flash", device_serial: "em-1" }, callId),
    ),
    result(callId, { taskId: "t-1", status: "running" }),
  );
}

describe("task fold: the session log is the only source of truth", () => {
  it("records a task from run_task's call card and its result meta", () => {
    const state = startTask(initTaskState());
    expect(state.activeTaskId).toBe("t-1");
    expect(task(state)).toMatchObject({
      taskId: "t-1",
      instruction: "open settings and enable wifi",
      profile: "flash",
      deviceSerial: "em-1",
      state: "running",
      stepCount: 0,
    });
    expect(task(state).startedAt).toBeGreaterThan(0);
  });

  it("an unrecognised result card leaves the session without a task (fail-open, no throw)", () => {
    const called = applyTaskState(initTaskState(), call(RUN_TASK, { instruction: "x" }, "c1"));
    const state = applyTaskState(called, result("c1", { /* no taskId */ }));
    expect(state.tasks).toEqual({});
    expect(state.activeTaskId).toBeNull();
    expect(state.pending).toEqual({});
  });

  it("appends one step per device action, in commit order", () => {
    let state = startTask(initTaskState());
    for (const [id, effect] of [["c2", "changed"], ["c3", "unchanged"]] as const) {
      state = applyTaskState(state, call(DEVICE_ACTION, { action: "tap" }, id));
      state = applyTaskState(state, result(id, { effect, category: "target" }));
    }
    expect(steps(state).map((row) => [row.action, row.effect])).toEqual([
      ["tap", "changed"],
      ["tap", "unchanged"],
    ]);
    expect(task(state).stepCount).toBe(2);
    expect(task(state).lastAction).toBe("tap");
  });

  it("keeps an effect the model never resolved as 'unknown', never as 'changed'", () => {
    let state = startTask(initTaskState());
    state = applyTaskState(state, call(DEVICE_ACTION, { action: "swipe" }, "c2"));
    state = applyTaskState(state, result("c2", undefined));
    expect(step(state, 0).effect).toBe("unknown");
    state = applyTaskState(state, call(DEVICE_ACTION, { action: "tap" }, "c3"));
    state = applyTaskState(state, result("c3", { effect: "bogus" }));
    expect(step(state, 1).effect).toBe("unknown");
  });

  it("a step needs its tool/call: an orphan result folds to nothing", () => {
    const state = applyTaskState(startTask(initTaskState()), result("never-called", { effect: "changed" }));
    expect(steps(state)).toEqual([]);
    expect(task(state).stepCount).toBe(0);
  });

  it("marks an incident from the meta the ladder already writes", () => {
    let state = startTask(initTaskState());
    state = applyTaskState(state, call(DEVICE_ACTION, { action: "tap" }, "c2"));
    state = applyTaskState(state, result("c2", { effect: "unchanged", incident: { consecutive_failures: 3 } }));
    expect(step(state, 0).incident).toBe(true);
  });

  it("a stopped task stops accruing steps", () => {
    let state = startTask(initTaskState());
    state = applyTaskState(state, call(MANAGE_TASK, { action: "stop", task_id: "t-1" }, "c2"));
    state = applyTaskState(state, result("c2", { state: "stopped" }));
    state = applyTaskState(state, call(DEVICE_ACTION, { action: "tap" }, "c3"));
    state = applyTaskState(state, result("c3", { effect: "changed" }));
    expect(task(state).state).toBe("stopped");
    expect(steps(state)).toEqual([]);
    expect(task(state).stepCount).toBe(0);
  });

  it("the report closes the task on both axes and detaches it from later actions", () => {
    let state = startTask(initTaskState());
    state = applyTaskState(state, call(DEVICE_ACTION, { action: "tap" }, "c2"));
    state = applyTaskState(state, result("c2", { effect: "changed" }));
    state = applyTaskState(state, call(REPORT_STATUS, { status: "completed" }, "c3"));
    state = applyTaskState(state, result("c3", { status: "completed", tests_failed: 2 }));
    expect(task(state)).toMatchObject({ state: "completed", testsFailed: 2, stepCount: 1 });
    expect(state.activeTaskId).toBeNull();
    // Post-report device work is not attributed to a finished task.
    state = applyTaskState(state, call(DEVICE_ACTION, { action: "tap" }, "c4"));
    state = applyTaskState(state, result("c4", { effect: "changed" }));
    expect(steps(state)).toHaveLength(1);
  });
});

describe("task fold: the registry's unchanged-reference contract", () => {
  it("an event of another type folds to the SAME reference", () => {
    const state = startTask(initTaskState());
    expect(applyTaskState(state, unrelated())).toBe(state);
  });

  it("another plugin's tool call folds to the SAME reference", () => {
    const state = startTask(initTaskState());
    expect(applyTaskState(state, call("read_file", { path: "a" }, "c9"))).toBe(state);
  });

  it("a consumed call retires its pending row exactly once", () => {
    const state = startTask(initTaskState());
    expect(state.pending).toEqual({});
    const orphan = applyTaskState(state, result("c1", { effect: "changed" }));
    expect(orphan).toBe(state);
  });
});

describe("task fold: replay is a pure function of the log", () => {
  it("folding the same events twice yields the same value", () => {
    const events: FoldEvent[] = [
      call(RUN_TASK, { instruction: "tap wifi", profile: "pro" }, "c1"),
      result("c1", { taskId: "t-9" }),
      call(DEVICE_ACTION, { action: "tap" }, "c2"),
      result("c2", { effect: "changed" }),
      unrelated(),
    ];
    expect(foldTaskEvents(events)).toEqual(foldTaskEvents(events));
    expect(task(foldTaskEvents(events), "t-9").stepCount).toBe(1);
  });

  it("malformed arguments fold to no step rather than throwing", () => {
    let state = startTask(initTaskState());
    state = applyTaskState(state, {
      type: "tool/call",
      time: clock,
      data: { callId: "c2", name: DEVICE_ACTION, arguments: "{not json" },
    });
    state = applyTaskState(state, result("c2", { effect: "changed" }));
    expect(step(state, 0).action).toBe("unknown");
    expect(step(state, 0).effect).toBe("changed");
  });
});