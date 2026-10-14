/**
 * `autogamer_manage_task` — status / stop / steer a task (T1 / G82).
 *
 * The answer is now a read over the session's own task projection, not a call
 * into an engine: status resolves the folded record and its last steps, stop
 * marks the record terminal, and steer hands the instruction to the agent that
 * is asking (there is no second runner to forward it to).
 *
 * Two behaviours are deliberate and pinned by the specs:
 *  - **fail-open on a missing read model.** No published projection means the
 *    answer is `state: "unknown"`, never an error - the same direction the
 *    effect verdict takes when the device layer cannot decide.
 *  - **steering is `agent.inject()`, not `followup()`.** The caller is the
 *    agent itself and is already awake; `inject` appends durable context that
 *    enters its next admitted step, while `followup` would wake an idle agent
 *    (R17). The host wiring lives in `apply`, which owns the agent handle.
 */
import type { PreflightResult } from "../env/preflight.js";
import type { JsonValue, ToolDefinitionInput } from "../dsh-types.js";
import type { TaskStore } from "../task/cache.js";
import type { TaskFoldState } from "../task/fold.js";
import { RECENT_ACTIONS_LIMIT, renderRecent, secondsSince } from "../task/readModel.js";
import { requireEnv } from "./envGate.js";

export interface ManageTaskDeps {
  store: TaskStore;
  checkEnv: () => Promise<PreflightResult>;
  /** Session identity of this call; the store is keyed by it. */
  sessionKey: () => string | undefined;
  /** Append the instruction to the calling agent's durable context. */
  steer: (instruction: string) => void;
}

const ACTIONS = ["status", "stop", "inject_instruction"] as const;
export type ManageAction = (typeof ACTIONS)[number];

export function defineManageTask(deps: ManageTaskDeps): ToolDefinitionInput {
  return {
    name: "autogamer_manage_task",
    description:
      "Query, stop, or steer a task registered by autogamer_run_task. status returns the folded " +
      "state with the last 5 steps; stop marks the task terminal (further device actions are not " +
      "attributed to it); inject_instruction appends a new instruction to this agent's context.",
    parameters: {
      task_id: { type: "string", required: true, description: "The task_id from autogamer_run_task." },
      action: {
        type: "string",
        required: true,
        enum: ["status", "stop", "inject_instruction"],
        description: "status: read state; stop: terminate; inject_instruction: steer with `instruction`.",
      },
      instruction: {
        type: "string",
        description: "Required when action is inject_instruction.",
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          task_id: { type: "string", required: true },
          state: { type: "string", required: true },
          current_step: { type: "number" },
          total_steps: { type: "number" },
          last_action: { type: "string" },
          recent_actions: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          elapsed_seconds: { type: "number" },
          final_summary: { type: "string" },
        },
        additionalProperties: true,
      },
      // `stop` has to leave a durable trace or the fold cannot stop
      // attributing steps to a task the model already ended.
      presentationMeta: (_args, value) => {
        const record = (value ?? {}) as { task_id?: unknown; state?: unknown; steered?: unknown };
        const meta: { [key: string]: JsonValue } = {};
        if (typeof record.task_id === "string") meta.taskId = record.task_id;
        if (typeof record.state === "string") meta.state = record.state;
        if (record.steered === true) meta.steered = true;
        return meta;
      },
      render: (_args, value) => {
        const record = (value ?? {}) as Record<string, unknown>;
        const steps = Array.isArray(record.recent_actions) ? (record.recent_actions as unknown[]).length : 0;
        return [
          {
            type: "text",
            text:
              `task_id=${String(record.task_id ?? "")}; state=${String(record.state ?? "")}; ` +
              `steps=${String(record.current_step ?? "?")}/${String(record.total_steps ?? "?")} (${steps} recent); ` +
              `last=${String(record.last_action ?? "")}`,
          },
        ];
      },
    },
    async execute(args, _exec) {
      const taskId = args.task_id;
      if (typeof taskId !== "string" || taskId.length === 0) {
        throw new Error("task: task_id must be a non-empty string");
      }
      const action = args.action as ManageAction;
      if (!ACTIONS.includes(action)) {
        throw new Error(`task: action must be one of ${ACTIONS.join("/")}`);
      }
      if (action === "inject_instruction") {
        const instruction = args.instruction;
        if (typeof instruction !== "string" || instruction.trim().length === 0) {
          throw new Error("task: instruction is required when action is inject_instruction");
        }
      }
      await requireEnv(deps.checkEnv);

      const state = deps.store.read(deps.sessionKey());
      const record = state?.tasks[taskId];

      if (action === "inject_instruction") {
        // The append happens here, in a tool body - not from an event callback,
        // so no boundary deferral is needed (R23 is about reentering a publish).
        deps.steer(args.instruction as string);
        return {
          task_id: taskId,
          state: record?.state ?? "unknown",
          steered: true,
          ...(state === undefined || record === undefined ? {} : statusFields(state, taskId)),
        };
      }

      if (action === "stop") {
        return { task_id: taskId, state: "stopped" };
      }

      if (record === undefined || state === undefined) {
        return { task_id: taskId, state: "unknown", recent_actions: [] };
      }
      return { task_id: taskId, state: record.state, ...statusFields(state, taskId) };
    },
  };
}

function statusFields(state: TaskFoldState, taskId: string): Record<string, unknown> {
  const record = state.tasks[taskId];
  if (record === undefined) return {};
  const steps = state.steps[taskId] ?? [];
  const elapsed = secondsSince(record, steps);
  return {
    current_step: record.stepCount,
    ...(record.lastAction === undefined ? {} : { last_action: record.lastAction }),
    recent_actions: renderRecent(steps.slice(-RECENT_ACTIONS_LIMIT)),
    ...(elapsed === undefined ? {} : { elapsed_seconds: elapsed }),
  };
}