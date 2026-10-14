/**
 * Task read model over the host's session projection (T1 / G82).
 *
 * The projection registry owns the fold; this cache is the read side the three
 * task tools use. It exists because of one documented limit: `stateOf(session,
 * key)` needs the `Session` object, and a tool call does not obviously carry
 * one (`ToolExec` mirrors only `signal` / `concludeTurn`, while R17 says
 * `exec.agent` exists - neither verified against an installed host, R21 🔶).
 * The change feed hands the session object to the *host side*, so the cache is
 * filled there and the tools read it by the session identity they already have
 * (the agent id, which the host documents as the session-backed identity).
 *
 * Two facts constrain the unit, both from the official projection docs:
 *  - the change feed fires only for CLIENT-VISIBLE units (`onChanged`: "called
 *    once per client-visible unit whose raw view changed by `Object.is`"; the
 *    listener's key is typed against `SessionProjectionMap`). A host-only unit
 *    would never publish, so the unit ships a `wire.view` - which also gives the
 *    Web client a finished read model instead of making it fold our events.
 *  - the unit's `view` must reuse its reference when the value did not change,
 *    or publication fires on every unrelated event. Returning the folded state
 *    itself gets this for free: `applyTaskState` already returns the same
 *    reference for events that are not ours.
 *
 * This map is a derived cache, never a source of truth: a cold read replays the
 * log through the same `apply` and lands on the same value.
 */
import type { TaskFoldState } from "./fold.js";

/** What the task tools depend on; a test doubles this with a plain object. */
export interface TaskStore {
  /**
   * The folded state for one session, or undefined when the projection has not
   * published for it yet. Callers fail open on undefined - a missing read model
   * is "unknown", never an error (same direction as the effect verdict).
   */
  read(sessionKey: string | undefined): TaskFoldState | undefined;
}

export class TaskCache implements TaskStore {
  private readonly states = new Map<string, TaskFoldState>();

  read(sessionKey: string | undefined): TaskFoldState | undefined {
    if (sessionKey === undefined) return undefined;
    return this.states.get(sessionKey);
  }

  /** Feed point for the projection change feed (one value per changed session). */
  publish(sessionId: string, state: TaskFoldState): void {
    this.states.set(sessionId, state);
  }

  /** Drop a session's derived view (agent disposal / plugin unload). */
  forget(sessionId: string): void {
    this.states.delete(sessionId);
  }

  get sessions(): number {
    return this.states.size;
  }
}