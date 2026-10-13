/**
 * `autogamer_manage_task` — status / stop / steer a running task (Phase 2).
 *
 * Backend mapping is locked against the fork's old face: our `task_id` goes
 * out as `trace_id`, and the three actions (status/stop/inject_instruction)
 * are verbatim provider actions. The answer is a free-form dict, so every
 * field is read tolerantly (see the backend's alias lists); the only hard
 * rule enforced HERE is the scheme's context budget: at most 5 recent steps
 * ever reach the model, sliced off the tail.
 */
import type { ArtemisBackend, ManageAction } from "../artemis/types.js";
import type { PreflightResult } from "../env/preflight.js";
import type { ToolDefinitionInput } from "../dsh-types.js";
import { requireEnv } from "./envGate.js";

export interface ManageTaskDeps {
  backend: ArtemisBackend;
  checkEnv: () => Promise<PreflightResult>;
}

export const RECENT_ACTIONS_LIMIT = 5;

const ACTIONS: ManageAction[] = ["status", "stop", "inject_instruction"];

export function defineManageTask(deps: ManageTaskDeps): ToolDefinitionInput {
  return {
    name: "autogamer_manage_task",
    description:
      "Query, stop, or steer a running Android automation task (driven by Google ARTEMIS). " +
      "status returns the latest state with the last 5 steps; stop asks for termination; " +
      "inject_instruction forwards a new instruction into the running task.",
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
    async execute(args, exec) {
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
      const status = await deps.backend.manageTask(
        {
          taskId,
          action,
          ...(typeof args.instruction === "string" && args.instruction.length > 0
            ? { instruction: args.instruction }
            : {}),
        },
        exec?.signal,
      );
      const recent = (status.recentSteps ?? []).slice(-RECENT_ACTIONS_LIMIT).map((step) => ({
        ...(step.index !== undefined ? { index: step.index } : {}),
        ...(step.action !== undefined ? { action: step.action } : {}),
        ...(step.reasoning !== undefined ? { reasoning: step.reasoning } : {}),
        ...(step.screenshotPath !== undefined ? { screenshot_path: step.screenshotPath } : {}),
        ...(step.timestamp !== undefined ? { timestamp: step.timestamp } : {}),
      }));
      return {
        task_id: status.taskId,
        state: status.state ?? "unknown",
        ...(status.currentStep !== undefined ? { current_step: status.currentStep } : {}),
        ...(status.totalSteps !== undefined ? { total_steps: status.totalSteps } : {}),
        ...(status.lastAction !== undefined ? { last_action: status.lastAction } : {}),
        recent_actions: recent,
        ...(status.elapsedSeconds !== undefined ? { elapsed_seconds: status.elapsedSeconds } : {}),
        ...(status.finalSummary !== undefined ? { final_summary: status.finalSummary } : {}),
      };
    },
  };
}
