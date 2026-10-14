/**
 * Read-model shaping for the two task viewers (T1 / G82).
 *
 * `manage_task` shows the tail and `inspect_trace` shows the edges plus the
 * failures, so the shaping lives here rather than in either tool: the budget
 * that keeps a long task from flooding the context is one decision, and two
 * copies of it would drift the moment the step shape changes.
 */
import type { TaskRecord, TaskStep } from "./fold.js";

/** The context budget: at most this many recent steps ever reach the model. */
export const RECENT_ACTIONS_LIMIT = 5;

/** The trace view keeps this many steps at each end. */
export const SUMMARY_EDGE = 3;

export function renderRecent(steps: readonly TaskStep[]): Array<Record<string, unknown>> {
  return steps.map((step, position) => ({
    index: position + 1,
    action: step.action,
    effect: step.effect,
    ...(step.category === undefined ? {} : { category: step.category }),
    ...(step.incident ? { incident: true } : {}),
    timestamp: new Date(step.at).toISOString(),
  }));
}

/**
 * Wall time from the task's start to its last committed step. Undefined until
 * something has actually run — a task that only exists has no elapsed time to
 * report, and reporting 0 would read as "it ran and did nothing".
 */
export function secondsSince(record: TaskRecord, steps: readonly TaskStep[]): number | undefined {
  const last = steps[steps.length - 1];
  if (last === undefined) return undefined;
  return Math.max(0, Math.round((last.at - record.startedAt) / 1000));
}

/**
 * A step is a failure when the screen did not change under it, or when the
 * device-level incident counter opened. Both come from the tool's own result
 * card, so this is a read, not a guess at provider wording.
 */
export function isFailedStep(step: TaskStep): boolean {
  return step.effect === "unchanged" || step.incident;
}

/** First N, last N, plus any failed step the edges did not already cover. */
export function summarizeSteps(steps: readonly TaskStep[], edge: number = SUMMARY_EDGE): TaskStep[] {
  if (steps.length <= edge * 2) return [...steps];
  const head = steps.slice(0, edge);
  const tail = steps.slice(-edge);
  const covered = new Set<number>();
  head.forEach((_, position) => covered.add(position));
  tail.forEach((_, position) => covered.add(steps.length - edge + position));
  const failed = steps.filter((step, position) => isFailedStep(step) && !covered.has(position));
  return [...head, ...failed, ...tail];
}