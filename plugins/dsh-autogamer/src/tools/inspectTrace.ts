/**
 * `autogamer_inspect_trace` — read a task's execution trace (Phase 2).
 *
 * Backend mapping is locked against the fork's old face: we call
 * `view_summary` over the `trace_id` and shape the answer client-side.
 * `summary` returns the first 3 steps, the last 3, plus any failed step not
 * already covered (deduped by step index); `full` returns everything.
 * `include_screenshots` is accepted for contract stability but has no provider
 * counterpart on this action — screenshots ride inside the step records when
 * the provider includes them. Failure detection is heuristic (a `fail`/`error`
 * status, or an explicit false flag) because the provider never promised a
 * failure vocabulary.
 */
import type { ArtemisBackend, TaskStep } from "../artemis/types.js";
import type { PreflightResult } from "../env/preflight.js";
import type { ToolDefinitionInput } from "../dsh-types.js";
import { requireEnv } from "./envGate.js";

export interface InspectTraceDeps {
  backend: ArtemisBackend;
  checkEnv: () => Promise<PreflightResult>;
}

const SUMMARY_EDGE = 3;

function stepKey(step: TaskStep, position: number): string {
  return step.index !== undefined ? `n:${step.index}` : `p:${position}`;
}

function isFailed(step: TaskStep): boolean {
  if (step.ok === false) return true;
  return typeof step.status === "string" && /fail|error/i.test(step.status);
}

export function summarizeSteps(steps: TaskStep[]): TaskStep[] {
  if (steps.length <= SUMMARY_EDGE * 2) return steps;
  const head = steps.slice(0, SUMMARY_EDGE);
  const tail = steps.slice(-SUMMARY_EDGE);
  const covered = new Set<string>();
  head.forEach((step, position) => covered.add(stepKey(step, position)));
  tail.forEach((step, position) => covered.add(stepKey(step, steps.length - SUMMARY_EDGE + position)));
  const failed = steps.filter(
    (step, position) => isFailed(step) && !covered.has(stepKey(step, position)),
  );
  return [...head, ...failed, ...tail];
}

function renderStep(step: TaskStep): Record<string, unknown> {
  return {
    ...(step.index !== undefined ? { index: step.index } : {}),
    ...(step.action !== undefined ? { action: step.action } : {}),
    ...(step.reasoning !== undefined ? { reasoning: step.reasoning } : {}),
    ...(step.screenshotPath !== undefined ? { screenshot_path: step.screenshotPath } : {}),
    ...(step.timestamp !== undefined ? { timestamp: step.timestamp } : {}),
    ...(step.durationMs !== undefined ? { duration_ms: step.durationMs } : {}),
  };
}

export function defineInspectTrace(deps: InspectTraceDeps): ToolDefinitionInput {
  return {
    name: "autogamer_inspect_trace",
    description:
      "Read an Android automation task's execution trace (driven by Google ARTEMIS). " +
      "summary returns the first/last 3 steps plus any failed step; full returns everything.",
    parameters: {
      task_id: { type: "string", required: true, description: "The task_id from autogamer_run_task." },
      format: {
        type: "string",
        enum: ["summary", "full"],
        description: "summary (default): edges plus failures; full: every step.",
      },
      include_screenshots: {
        type: "boolean",
        description: "Accepted; screenshots ride inside step records when the provider includes them.",
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
    async execute(args, exec) {
      const taskId = args.task_id;
      if (typeof taskId !== "string" || taskId.length === 0) {
        throw new Error("task: task_id must be a non-empty string");
      }
      await requireEnv(deps.checkEnv);
      const view = await deps.backend.inspectTrace({ traceId: taskId }, exec?.signal);
      const full = args.format === "full";
      const steps = full ? view.steps : summarizeSteps(view.steps);
      return {
        task_id: view.taskId,
        final_status: view.finalStatus ?? "unknown",
        total_steps: view.totalSteps ?? view.steps.length,
        steps: steps.map(renderStep),
        artifact_paths: view.artifactPaths,
      };
    },
  };
}
