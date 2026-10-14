/**
 * `autogamer_inspect_trace` — read a task's execution trace (T1 / G82).
 *
 * The trace is the session's own device history, folded from the tool result
 * cards `run_device_action` already writes: one step per committed action, with
 * the effect verdict, category and incident flag that card carries. Nothing is
 * fetched from a provider, and nothing is reconstructed from memory.
 *
 * `summary` keeps the edges plus the failures, `full` returns everything, and
 * `include_screenshots` stays accepted for contract stability: screenshots are
 * durable attachment references inside the log's result cards, so a step has one
 * when the host admitted it and none when it did not — there is no separate
 * artifact store to list, which is why `artifact_paths` comes back empty.
 */
import type { PreflightResult } from "../env/preflight.js";
import type { ToolDefinitionInput } from "../dsh-types.js";
import type { TaskStore } from "../task/cache.js";
import type { TaskStep } from "../task/fold.js";
import { summarizeSteps } from "../task/readModel.js";
import { requireEnv } from "./envGate.js";

export interface InspectTraceDeps {
  store: TaskStore;
  checkEnv: () => Promise<PreflightResult>;
  /** Session identity of this call; the store is keyed by it. */
  sessionKey: () => string | undefined;
}

export { summarizeSteps };

function renderStep(step: TaskStep): Record<string, unknown> {
  return {
    action: step.action,
    effect: step.effect,
    ...(step.category === undefined ? {} : { category: step.category }),
    ...(step.incident ? { incident: true } : {}),
    timestamp: new Date(step.at).toISOString(),
  };
}

export function defineInspectTrace(deps: InspectTraceDeps): ToolDefinitionInput {
  return {
    name: "autogamer_inspect_trace",
    description:
      "Read a task's execution trace as recorded in this session. summary returns the first/last 3 " +
      "steps plus any failed step; full returns every step.",
    parameters: {
      task_id: { type: "string", required: true, description: "The task_id from autogamer_run_task." },
      format: {
        type: "string",
        enum: ["summary", "full"],
        description: "summary (default): edges plus failures; full: every step.",
      },
      include_screenshots: {
        type: "boolean",
        description: "Accepted; screenshots ride inside the log's result cards when admitted.",
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          task_id: { type: "string", required: true },
          final_status: { type: "string", required: true },
          total_steps: { type: "number", required: true },
          steps: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          artifact_paths: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: true,
      },
      render: (_args, value) => {
        const record = (value ?? {}) as Record<string, unknown>;
        const steps = Array.isArray(record.steps) ? (record.steps as unknown[]).length : 0;
        return [
          {
            type: "text",
            text:
              `task_id=${String(record.task_id ?? "")}; final_status=${String(record.final_status ?? "")}; ` +
              `total_steps=${String(record.total_steps ?? steps)} (showing ${steps})`,
          },
        ];
      },
    },
    async execute(args, _exec) {
      const taskId = args.task_id;
      if (typeof taskId !== "string" || taskId.length === 0) {
        throw new Error("task: task_id must be a non-empty string");
      }
      await requireEnv(deps.checkEnv);
      const state = deps.store.read(deps.sessionKey());
      const record = state?.tasks[taskId];
      if (state === undefined || record === undefined) {
        return { task_id: taskId, final_status: "unknown", total_steps: 0, steps: [], artifact_paths: [] };
      }
      const all = state.steps[taskId] ?? [];
      const steps = args.format === "full" ? all : summarizeSteps(all);
      return {
        task_id: taskId,
        final_status: record.state,
        total_steps: all.length,
        steps: steps.map(renderStep),
        artifact_paths: [],
      };
    },
  };
}