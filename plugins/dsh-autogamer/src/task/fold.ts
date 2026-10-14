/**
 * Task-state fold over the session log (T1 / G82).
 *
 * The py task engine used to own the task record and its step trace behind
 * `autogamer_run_task` / `manage_task` / `inspect_trace`. Under the single
 * execution route (S11) the DSH agent loop is the executor, so what those
 * three tools need is no longer an engine's private state but a *read model
 * over the log we already own*.
 *
 * Two rules shape this file:
 *  - The log is the only source of truth; plugin memory is a derived cache
 *    (official `practices.md`, principle 1). So the unit below is a pure fold
 *    over committed events - replaying the same log always rebuilds the same
 *    value, and nothing here writes events (R16: no self-invented event types).
 *  - Every fact is read from `tool/result`'s `meta`, i.e. this plugin's own
 *    `presentationMeta` payloads (R16/P1-b), never from model-facing text.
 *    Model-facing text is prose; `meta` is the declared, JSON-validated card
 *    that survives replay - parsing rendered text would make the read model
 *    depend on wording.
 *
 * Event shapes are the host's, taken from `docs/subsystems/session.zh.md` and
 * the installed `@deepseek-ai/dsh-llm` declarations: a `tool/result` carries
 * `message.toolCallId` (ToolResultMessage) which pairs it with the
 * `tool/call`'s `callId`. Reading is deliberately tolerant - a malformed or
 * absent payload folds to "no change" rather than throwing, because a fold runs
 * inside the host's drive over *every* committed event (one bad event must not
 * take the session down).
 */

export const RUN_TASK = "autogamer_run_task";
export const MANAGE_TASK = "autogamer_manage_task";
export const INSPECT_TRACE = "autogamer_inspect_trace";
export const DEVICE_ACTION = "run_device_action";
export const REPORT_STATUS = "report_task_status";

/** Terminal and live states of one task record. */
export type TaskStateName = "running" | "stopped" | "completed" | "blocked";

/** The three verdicts a device action can carry (`run_device_action` effect). */
export type ActionEffect = "changed" | "unchanged" | "unknown";

export interface TaskStep {
  callId: string;
  /** The device action (`tap`, `swipe`, ...); `unknown` when the call carried none. */
  action: string;
  effect: ActionEffect;
  category?: string;
  /** Three straight failures on one device; the detail rides in the log's meta. */
  incident: boolean;
  /** Epoch ms of the committing event. */
  at: number;
}

export interface TaskRecord {
  taskId: string;
  instruction: string;
  profile: string;
  deviceSerial: string;
  startedAt: number;
  state: TaskStateName;
  stepCount: number;
  lastAction?: string;
  testsFailed: number;
}

/** One in-flight tool call, keyed by callId, carrying only what a step needs. */
export interface PendingCall {
  name: string;
  /** Device action for a step row; task actions carry their verb instead. */
  action: string;
  taskId: string;
  /** What `run_task` recorded, so the record survives the result card. */
  instruction: string;
  profile: string;
  deviceSerial: string;
}

export interface TaskFoldState {
  tasks: Record<string, TaskRecord>;
  /** Steps per task, in commit order. */
  steps: Record<string, TaskStep[]>;
  /** The task new device actions are attributed to; null when none is live. */
  activeTaskId: string | null;
  pending: Record<string, PendingCall>;
}

/** Structural view of one committed session event (host-owned, read-only). */
export interface FoldEvent {
  type: string;
  time: number;
  data: unknown;
}

/** Bump when the serialized fields or the fold semantics change. */
export const TASK_STATE_VERSION = 1;

const EFFECTS: readonly string[] = ["changed", "unchanged", "unknown"];
const TASK_STATES: readonly string[] = ["running", "stopped", "completed", "blocked"];

export function initTaskState(): TaskFoldState {
  return { tasks: {}, steps: {}, activeTaskId: null, pending: {} };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The model's raw `arguments` string, parsed defensively (never throws). */
function callArgs(data: Record<string, unknown>): Record<string, unknown> {
  const raw = data.arguments;
  if (typeof raw !== "string") return record(data.args);
  try {
    return record(JSON.parse(raw));
  } catch {
    return {};
  }
}

function resultMeta(data: Record<string, unknown>): Record<string, unknown> {
  return record(data.meta);
}

function effectOf(meta: Record<string, unknown>): ActionEffect {
  const value = meta.effect;
  return typeof value === "string" && EFFECTS.includes(value) ? (value as ActionEffect) : "unknown";
}

function stateOf(value: unknown, fallback: TaskStateName): TaskStateName {
  return typeof value === "string" && TASK_STATES.includes(value) ? (value as TaskStateName) : fallback;
}

/** Device actions that carry an effect verdict; other tools are not steps. */
function stepAction(call: PendingCall): string {
  return call.action.length > 0 ? call.action : "unknown";
}

function appendStep(state: TaskFoldState, callId: string, call: PendingCall, meta: Record<string, unknown>, at: number): TaskFoldState {
  const taskId = state.activeTaskId;
  if (taskId === null) return state;
  const task = state.tasks[taskId];
  if (task === undefined || task.state !== "running") return state;
  const category = text(meta.category);
  const step: TaskStep = {
    callId,
    action: stepAction(call),
    effect: effectOf(meta),
    ...(category.length > 0 ? { category } : {}),
    incident: record(meta.incident).consecutive_failures !== undefined,
    at,
  };
  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskId]: { ...task, stepCount: task.stepCount + 1, lastAction: step.action },
    },
    steps: { ...state.steps, [taskId]: [...(state.steps[taskId] ?? []), step] },
  };
}

function startTask(state: TaskFoldState, call: PendingCall, meta: Record<string, unknown>, at: number): TaskFoldState {
  const taskId = text(meta.taskId);
  if (taskId.length === 0) return state;
  const record_: TaskRecord = {
    taskId,
    instruction: call.instruction,
    profile: call.profile,
    deviceSerial: call.deviceSerial,
    startedAt: at,
    state: "running",
    stepCount: 0,
    testsFailed: 0,
  };
  return {
    ...state,
    tasks: { ...state.tasks, [taskId]: record_ },
    steps: { ...state.steps, [taskId]: [] },
    activeTaskId: taskId,
  };
}

function closeTask(state: TaskFoldState, taskId: string, next: TaskStateName, testsFailed?: number): TaskFoldState {
  const task = state.tasks[taskId];
  if (task === undefined) return state;
  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskId]: { ...task, state: next, ...(testsFailed !== undefined ? { testsFailed } : {}) },
    },
  };
}

/**
 * Pure transition. Returns the SAME reference when the event is not ours - the
 * host's registry treats an unchanged reference as zero downstream work, and
 * that contract is only real if unrelated events (most of a session's log)
 * fold to nothing at all.
 */
export function applyTaskState(state: TaskFoldState, event: FoldEvent): TaskFoldState {
  const data = record(event.data);

  if (event.type === "tool/call") {
    const callId = text(data.callId);
    const name = text(data.name);
    const ours = name === RUN_TASK || name === MANAGE_TASK || name === INSPECT_TRACE || name === DEVICE_ACTION || name === REPORT_STATUS;
    if (callId.length === 0 || !ours) return state;
    const args = callArgs(data);
    const pending: PendingCall = {
      name,
      action: text(args.action),
      taskId: text(args.task_id),
      instruction: text(args.instruction),
      profile: text(args.profile),
      deviceSerial: text(args.device_serial),
    };
    return { ...state, pending: { ...state.pending, [callId]: pending } };
  }

  if (event.type !== "tool/result") return state;
  const callId = text(record(data.message).toolCallId);
  if (callId.length === 0) return state;
  const call = state.pending[callId];
  if (call === undefined) return state;

  // The pending row is consumed either way: a result always retires its call.
  const base: TaskFoldState = { ...state, pending: omit(state.pending, callId) };
  const meta = resultMeta(data);

  switch (call.name) {
    case RUN_TASK:
      return startTask(base, call, meta, event.time);
    case DEVICE_ACTION:
      return appendStep(base, callId, call, meta, event.time);
    case REPORT_STATUS: {
      if (base.activeTaskId === null) return base;
      const testsFailed = typeof meta.tests_failed === "number" ? meta.tests_failed : 0;
      const closed = closeTask(base, base.activeTaskId, stateOf(meta.status, "completed"), testsFailed);
      // The report concludes the turn, so nothing after it belongs to this task.
      return { ...closed, activeTaskId: null };
    }
    case MANAGE_TASK: {
      if (text(call.taskId).length === 0) return base;
      if (call.action !== "stop") return base;
      return closeTask(base, call.taskId, "stopped");
    }
    default:
      return base;
  }
}

/** Fold a whole log; the shape a cold read and the live drive both use. */
export function foldTaskEvents(events: readonly FoldEvent[]): TaskFoldState {
  return events.reduce(applyTaskState, initTaskState());
}

function omit<T>(source: Record<string, T>, key: string): Record<string, T> {
  if (!(key in source)) return source;
  const next = { ...source };
  delete next[key];
  return next;
}