/**
 * The host-side projection unit for task state (T1 / G82).
 *
 * Registration is the host's sanctioned carrier for per-session state derived
 * from the log: the registry holds the single `session/event` subscription and
 * drives `apply` over every committed event, while this plugin keeps no
 * subscription of its own and folds nothing twice. The alternative the docs
 * warn about - subscribing to `session/event` and rescanning `session.events` -
 * is exactly the machinery this seam exists to replace.
 *
 * Why the unit is client-visible: the change feed only publishes client-visible
 * units (`onChanged` is documented as firing "once per client-visible unit
 * whose raw view changed by `Object.is`", and its key is typed against
 * `SessionProjectionMap`). A host-only unit would fold correctly and then never
 * publish, leaving the task tools with no read path. Shipping `wire.view` also
 * hands the Web client a finished value instead of asking it to fold our
 * events, which is the division of labour the seam documents.
 *
 * Registration is optional by design: `ctx.inject(['sessionProjections'], …)`
 * keeps the plugin mountable in a profile assembled without the registry, and
 * the task tools then read `undefined` and answer `unknown` (fail-open).
 *
 * 🔶 The registry's real signature, the acceptance of a plugin-declared key, and
 * the `onChanged` payload are read from the official subsystem docs and the
 * installed `@deepseek-ai/dsh-llm` declarations, NOT verified on a live host -
 * per R21 they stay marked until `cordis_inspect_query` confirms them (R9).
 */
import { z } from "zod";
import type { DshContext, DshSessionProjectionRegistry } from "../dsh-types.js";
import type { TaskCache } from "./cache.js";
import { applyTaskState, initTaskState, TASK_STATE_VERSION, type FoldEvent, type TaskFoldState } from "./fold.js";

/** Plugin-declared projection key. Host maps are merge-extensible by design. */
export const TASK_PROJECTION_KEY = "autogamerTasks";

const EFFECT_VALUES = ["changed", "unchanged", "unknown"] as const;
const TASK_STATE_VALUES = ["running", "stopped", "completed", "blocked"] as const;

const stepSchema = z.object({
  callId: z.string(),
  action: z.string(),
  effect: z.enum(EFFECT_VALUES),
  category: z.string().optional(),
  incident: z.boolean(),
  at: z.number(),
});

const taskRecordSchema = z.object({
  taskId: z.string(),
  instruction: z.string(),
  profile: z.string(),
  deviceSerial: z.string(),
  startedAt: z.number(),
  state: z.enum(TASK_STATE_VALUES),
  stepCount: z.number(),
  lastAction: z.string().optional(),
  testsFailed: z.number(),
});

const pendingCallSchema = z.object({
  name: z.string(),
  action: z.string(),
  taskId: z.string(),
  instruction: z.string(),
  profile: z.string(),
  deviceSerial: z.string(),
});

/** The unit's persisted state is plain JSON; this is the shape that guarantees it. */
export const taskStateSchema = z.object({
  tasks: z.record(z.string(), taskRecordSchema),
  steps: z.record(z.string(), z.array(stepSchema)),
  activeTaskId: z.string().nullable(),
  pending: z.record(z.string(), pendingCallSchema),
});

/**
 * The unit. `init` seeds the empty log, `apply` is the pure fold, and `view`
 * hands the state back unchanged so publication only fires on a real fold.
 */
export const taskProjectionDefinition = {
  key: TASK_PROJECTION_KEY,
  stateSchema: taskStateSchema,
  init: (): TaskFoldState => initTaskState(),
  apply: (state: TaskFoldState, event: FoldEvent): TaskFoldState => applyTaskState(state, event),
  wire: {
    viewSchema: taskStateSchema,
    view: (state: TaskFoldState): TaskFoldState => state,
  },
  stateVersion: TASK_STATE_VERSION,
};

/**
 * Register the unit and feed the cache from the change feed. Returns whether the
 * registry was present: without it the plugin still mounts and the task tools
 * read `undefined` (R9 forbids inferring anything else from a missing log line).
 */
export function registerTaskProjection(ctx: DshContext, cache: TaskCache): boolean {
  let registered = false;
  ctx.inject?.(["sessionProjections"], (scoped) => {
    const registry = scoped.sessionProjections as DshSessionProjectionRegistry | undefined;
    if (registry === undefined) return;
    // The registration is an effect on the calling fiber: disposing this scope
    // unregisters the key, and the disposer comes from `inject`, not from us.
    registry.register(taskProjectionDefinition);
    registry.onChanged((session, key, value) => {
      if (key !== TASK_PROJECTION_KEY) return;
      cache.publish(session.id, value as TaskFoldState);
    });
    registered = true;
  });
  return registered;
}