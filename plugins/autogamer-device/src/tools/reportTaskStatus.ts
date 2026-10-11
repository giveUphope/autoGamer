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
      "Report the final outcome of the device task. Call exactly once, when nothing else remains to do; " +
      "reporting concludes the turn, so no further tool call is possible afterwards.",
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
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", required: true },
          tests_failed: { type: "number" },
          outcome: { type: "string", required: true },
        },
      },
      render: (_args, value) => {
        const record = (value ?? {}) as Record<string, unknown>;
        const text = `task outcome recorded: ${String(record.outcome ?? record.status ?? "unknown")}`;
        return [{ type: "text", text }];
      },
    },
    async execute(args, exec) {
      const status = args.status as string;
      const testsFailed = typeof args.tests_failed === "number" ? args.tests_failed : 0;
      // S2 defines the terminal state as this tool's result, which needs an
      // enforcement point rather than a prompt convention: without concluding the
      // turn the model kept acting (and re-reporting) after it had already
      // reported `blocked` — see G41.
      exec.concludeTurn?.();
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
