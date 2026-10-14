/**
 * Projection + cache locks (T1 / G82).
 *
 * Two properties carry the design and are locked here:
 *  - `view` must hand back the SAME reference when the fold did not change,
 *    because the change feed publishes on `Object.is` - a view that rebuilt its
 *    value would republish on every unrelated event of the session.
 *  - a session with no published value must read as `undefined`, not as an
 *    empty state, so "no read model yet" stays distinguishable from "a task ran
 *    and did nothing" (both of which the tools answer, differently).
 */
import { describe, expect, it, vi } from "vitest";
import type { DshContext, DshSessionProjectionRegistry } from "../src/dsh-types.js";
import { TaskCache } from "../src/task/cache.js";
import {
  DEVICE_ACTION,
  RUN_TASK,
  applyTaskState,
  initTaskState,
  type TaskFoldState,
} from "../src/task/fold.js";
import {
  TASK_PROJECTION_KEY,
  registerTaskProjection,
  taskProjectionDefinition,
  taskStateSchema,
} from "../src/task/projection.js";

function seed(): TaskFoldState {
  let state = applyTaskState(
    applyTaskState(initTaskState(), {
      type: "tool/call",
      time: 1,
      data: { callId: "c1", name: RUN_TASK, arguments: JSON.stringify({ instruction: "x" }) },
    }),
    { type: "tool/result", time: 2, data: { message: { toolCallId: "c1" }, meta: { taskId: "t-1" } } },
  );
  state = applyTaskState(state, { type: "tool/call", time: 3, data: { callId: "c2", name: DEVICE_ACTION, arguments: "{}" } });
  return applyTaskState(state, { type: "tool/result", time: 4, data: { message: { toolCallId: "c2" }, meta: { effect: "changed" } } });
}

/** A registry double that records what the plugin registered and fed. */
function registryDouble() {
  const register = vi.fn();
  const onChanged = vi.fn();
  const registry = { register, onChanged } as unknown as DshSessionProjectionRegistry;
  return { registry, register, onChanged };
}

describe("projection unit: the shape the host validates", () => {
  it("declares a key, a schema, a version and both wire halves", () => {
    expect(taskProjectionDefinition.key).toBe(TASK_PROJECTION_KEY);
    expect(taskProjectionDefinition.stateVersion).toBeGreaterThanOrEqual(0);
    expect(typeof taskProjectionDefinition.init).toBe("function");
    expect(typeof taskProjectionDefinition.apply).toBe("function");
    expect(typeof taskProjectionDefinition.wire.view).toBe("function");
  });

  it("its schema accepts the folded state and rejects a drifted one", () => {
    expect(taskStateSchema.safeParse(seed()).success).toBe(true);
    const drifted = { ...seed(), activeTaskId: 7 };
    expect(taskStateSchema.safeParse(drifted).success).toBe(false);
  });

  it("init seeds the empty log and the fold stays inside the schema", () => {
    const state = taskProjectionDefinition.init();
    expect(taskStateSchema.safeParse(state).success).toBe(true);
    expect(taskProjectionDefinition.wire.view(state)).toBe(state);
  });

  it("view reuses the reference when the fold ignored the event", () => {
    const state = seed();
    const same = taskProjectionDefinition.apply(state, { type: "user/message", time: 9, data: {} });
    expect(same).toBe(state);
    expect(taskProjectionDefinition.wire.view(same)).toBe(state);
  });

  it("view hands over a new reference only when the fold moved", () => {
    const state = seed();
    const next = taskProjectionDefinition.apply(state, {
      type: "tool/call",
      time: 10,
      data: { callId: "c3", name: DEVICE_ACTION, arguments: "{}" },
    });
    expect(next).not.toBe(state);
    expect(taskProjectionDefinition.wire.view(next)).toBe(next);
  });
});

describe("task cache: derived, not a source of truth", () => {
  it("reads undefined until something is published for that session", () => {
    const cache = new TaskCache();
    expect(cache.read("s1")).toBeUndefined();
    expect(cache.read(undefined)).toBeUndefined();
    cache.publish("s1", seed());
    expect(cache.read("s1")).toMatchObject({ activeTaskId: "t-1" });
    expect(cache.read("s2")).toBeUndefined();
  });

  it("forget drops one session without touching another", () => {
    const cache = new TaskCache();
    cache.publish("s1", seed());
    cache.publish("s2", seed());
    cache.forget("s1");
    expect(cache.read("s1")).toBeUndefined();
    expect(cache.sessions).toBe(1);
  });
});

describe("registration: optional, effect-scoped, change-feed driven", () => {
  it("registers the unit and bridges the change feed into the cache", () => {
    const { registry, register, onChanged } = registryDouble();
    const cache = new TaskCache();
    const ctx = {
      inject: (_names: readonly string[], setup: (scoped: unknown) => void) => setup({ sessionProjections: registry }),
    } as unknown as DshContext;

    expect(registerTaskProjection(ctx, cache)).toBe(true);
    expect(register).toHaveBeenCalledWith(taskProjectionDefinition);
    const listener = onChanged.mock.calls[0]?.[0] as (
      session: { id: string },
      key: string,
      value: unknown,
    ) => void;

    listener({ id: "s1" }, TASK_PROJECTION_KEY, seed());
    expect(cache.read("s1")).toMatchObject({ activeTaskId: "t-1" });

    // Another unit's publication is not ours to cache.
    listener({ id: "s2" }, "someoneElse", seed());
    expect(cache.read("s2")).toBeUndefined();
  });

  it("mounts without the registry instead of throwing (optional service)", () => {
    const cache = new TaskCache();
    let ran = false;
    const ctx = {
      inject: (_names: readonly string[], _setup: (scoped: unknown) => void) => {
        ran = false;
      },
    } as unknown as DshContext;
    expect(registerTaskProjection(ctx, cache)).toBe(false);
    expect(ran).toBe(false);
    expect(cache.read("s1")).toBeUndefined();
  });
});