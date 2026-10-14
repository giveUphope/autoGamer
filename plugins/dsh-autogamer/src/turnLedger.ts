/**
 * Per-agent turn bookkeeping (G44).
 *
 * S2 defines the terminal state as `report_task_status`'s result, but a local
 * model was observed repeatedly finishing a turn with plain text after doing the
 * device work - no report, so the dual-axis outcome simply did not exist. A
 * prompt-level obligation is disproven as the only measure, so the plugin tracks
 * who acted and who reported, and nudges once when a turn ends without one.
 *
 * Keyed by agent id, which is the session id (the official round-driver looks
 * agents up as `ctx.agents.get(session.id)`).
 */
export interface TurnState {
  acted: number;
  reported: boolean;
  /** Followups already issued - the bound that keeps this from looping. */
  nudged: number;
}

export const MAX_REPORT_NUDGES = 1;

export class TurnLedger {
  private readonly states = new Map<string, TurnState>();

  private state(agentId: string): TurnState {
    let state = this.states.get(agentId);
    if (!state) {
      state = { acted: 0, reported: false, nudged: 0 };
      this.states.set(agentId, state);
    }
    return state;
  }

  markActed(agentId: string | undefined): void {
    if (!agentId) return;
    this.state(agentId).acted += 1;
  }

  markReported(agentId: string | undefined): void {
    if (!agentId) return;
    this.state(agentId).reported = true;
  }

  /** Consumes the turn: true when the agent must be asked to report. */
  consumeTurn(agentId: string | undefined): boolean {
    if (!agentId) return false;
    const state = this.state(agentId);
    const needs = state.acted > 0 && !state.reported && state.nudged < MAX_REPORT_NUDGES;
    if (needs) state.nudged += 1;
    else this.states.delete(agentId);
    return needs;
  }
}

/** The nudge text: ask for the report, forbid further device work. */
export const REPORT_NUDGE =
  "The previous turn ended after device actions without calling report_task_status. " +
  "Report the outcome now with report_task_status (completed or blocked) and its summary. " +
  "Do not call run_device_action or any other tool in this turn.";
