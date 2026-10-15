/**
 * What the host substituted for our answer (能力重审-3).
 *
 * `tools/result` is the registry's `@mode emit` observer, and the value it
 * carries is the one returned to the caller: `notifyResult` has a single call
 * site, inside `finishScheduledExecution`, after dispatch, projection and
 * post-execute have all run (`@deepseek-ai/dsh-tools` lib/index.js:3362-3395).
 * So this is where a deadline the host armed — and any caller cancellation that
 * replaced a result we had already produced — becomes visible. Nothing inside a
 * tool body can see either one: our body is what gets replaced.
 *
 * Two of the three codes are exported constants in the package we compile
 * against, so they are compared as constants. `TOOL_TIMEOUT` is not: the host's
 * own timeout policy owns that string (`packages/guard/timeout-policy/src/index.ts:25`),
 * and it is not in this plugin's dependency surface, so it is a literal with a
 * citation here. If upstream renames one, the two paths fail differently, which
 * is exactly why the difference is written down instead of being smoothed over.
 *
 * Reading this is not policy. The counts never reach the breaker or the incident
 * ledger: `allowedFails` defaults to 1, so one account of "the device was slow"
 * would open the gate for the whole cooldown, and no duration distribution has
 * ever been measured here (#111 refused the same reasoning for a user abort).
 */
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from "@deepseek-ai/dsh-tools";
import type { ToolExecutionResult } from "@deepseek-ai/dsh-tools";

/** Owned by the host's timeout policy, not by `@deepseek-ai/dsh-tools`. */
export const TOOL_TIMEOUT = "TOOL_TIMEOUT";

export type HostOutcome = "timeout" | "aborted" | "aborted-before-dispatch";

/**
 * The tools whose calls this ledger counts. The authority is what `apply`
 * registers, not this list — `tests/hostOutcome.spec.ts` compares the two, so
 * adding a tool without adding its name here goes red instead of going unnoticed.
 */
export const OUR_TOOL_NAMES: readonly string[] = [
  "run_device_action",
  "report_task_status",
  "autogamer_diagnose",
  "autogamer_get_device_state",
  "autogamer_run_task",
  "autogamer_manage_task",
  "autogamer_inspect_trace",
];

/**
 * Classify the outcome a host component minted, or `undefined` when the result
 * is the tool's own. Position matters: the structured code lives at
 * `error.info.code` (`lib/types/index.d.ts:378-386`), and a failure whose error
 * carries no `info` is a tool failure, not a host one — reading `error.code`
 * would silently never match (the same field-location trap R15 records).
 */
export function hostOutcomeOf(result: ToolExecutionResult): HostOutcome | undefined {
  if (!result.isError) return undefined;
  const code = result.error?.info?.code;
  if (code === undefined) return undefined;
  if (code === TOOL_TIMEOUT) return "timeout";
  if (code === TOOL_ABORTED) return "aborted";
  if (code === TOOL_ABORTED_BEFORE_DISPATCH) return "aborted-before-dispatch";
  return undefined;
}

export interface HostOutcomeEntry {
  readonly outcome: HostOutcome;
  readonly tool: string;
  readonly callId: string;
  readonly at: string;
}

/** The raw name of the most recent arrival, whatever it was — the only thing that
 * tells `no emissions` apart from `emissions under a name we do not match`. */
export interface HostArrivalEntry {
  readonly tool: string;
  readonly ours: boolean;
  readonly at: string;
}

export interface HostOutcomeSnapshot {
  /** Emissions the observer was handed at all (any tool name). */
  readonly seenAll: number;
  /** ...of which carry one of our names. */
  readonly seenOurs: number;
  /** ...of which the host had replaced our answer (the original `total`). */
  readonly total: number;
  readonly byOutcome: Readonly<Record<HostOutcome, number>>;
  readonly last?: HostOutcomeEntry;
  readonly lastArrival?: HostArrivalEntry;
}

/**
 * Counts and the most recent entry, nothing else. Bounded by construction: a few
 * integers plus two records, so an observation point that fires for every tool
 * call in a long session cannot grow.
 *
 * `seenAll` exists because `total` alone cannot answer the question 能力重审-3 left
 * open: a session where the host never emits, and a session where it emits under a
 * name our filter drops, both read `total=0`.
 */
export class HostOutcomeLedger {
  private readonly counts: Record<HostOutcome, number> = {
    timeout: 0,
    aborted: 0,
    "aborted-before-dispatch": 0,
  };
  private last: HostOutcomeEntry | undefined;
  private lastArrival: HostArrivalEntry | undefined;
  private seenAll = 0;
  private seenOurs = 0;
  private total = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Called for every emission, before any name or outcome filtering. */
  arrive(tool: string, ours: boolean): void {
    this.seenAll += 1;
    if (ours) this.seenOurs += 1;
    this.lastArrival = { tool, ours, at: new Date(this.now()).toISOString() };
  }

  record(tool: string, outcome: HostOutcome, callId: string): void {
    this.counts[outcome] += 1;
    this.total += 1;
    this.last = { outcome, tool, callId, at: new Date(this.now()).toISOString() };
  }

  snapshot(): HostOutcomeSnapshot {
    return {
      seenAll: this.seenAll,
      seenOurs: this.seenOurs,
      total: this.total,
      byOutcome: { ...this.counts },
      ...(this.last === undefined ? {} : { last: this.last }),
      ...(this.lastArrival === undefined ? {} : { lastArrival: this.lastArrival }),
    };
  }
}
