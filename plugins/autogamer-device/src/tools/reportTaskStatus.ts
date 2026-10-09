/**
 * report_task_status (S2): the structured end-of-task signal. Run-outcome
 * dual-axis semantics preserved: `blocked` means the goal was not met,
 * `tests_failed` counts assertion failures recorded along the way without
 * flipping the task to failed by itself.
 */
import type { ToolDefinitionInput } from "../dsh-types.js";

export function defineReportTaskStatus(): ToolDefinitionInput {
  return {
    name: "report_task_status",
    description:
      "Report the final outcome of the device task. Call exactly once, when nothing else remains to do.",
    parameters: {
      status: {
        type: "string",
        required: true,
        enum: ["completed", "blocked"],
        description: "completed = goal met; blocked = goal not met and options are exhausted.",
      },
      summary: { type: "string", required: true, description: "One paragraph: what was done and what the end state is." },
      tests_failed: { type: "number", description: "Count of assertion failures observed during the task." },
    },
    timeoutMs: 5_000,
    async execute(args) {
      const status = args.status as string;
      const testsFailed = typeof args.tests_failed === "number" ? args.tests_failed : 0;
      return {
        status,
        tests_failed: testsFailed,
        outcome:
          status === "completed"
            ? testsFailed > 0
              ? "completed (with assertion failures on record)"
              : "completed"
            : "blocked",
      };
    },
  };
}
