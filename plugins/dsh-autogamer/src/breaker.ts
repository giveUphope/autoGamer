/**
 * Device-dimension circuit breaker (S4): closed → open after
 * `allowedFails` consecutive environment-level failures → half-open after
 * `cooldownMs` → a single probe message decides. Task-level failures never
 * count (upstream semantics preserved from the py queue service).
 */

export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerOptions {
  allowedFails: number;
  cooldownMs: number;
  now?: () => number;
}

interface KeyState {
  envFailures: number;
  openedAt?: number;
  probeInFlight: boolean;
}

export class DeviceBreaker {
  private readonly states = new Map<string, KeyState>();
  private readonly allowedFails: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(options: BreakerOptions) {
    this.allowedFails = Math.max(1, options.allowedFails);
    this.cooldownMs = Math.max(0, options.cooldownMs);
    this.now = options.now ?? Date.now;
  }

  stateOf(key: string): BreakerState {
    const state = this.states.get(key);
    if (!state || state.openedAt === undefined) return "closed";
    if (this.now() - state.openedAt >= this.cooldownMs) return "half-open";
    return "open";
  }

  /**
   * Whether an action may proceed now. Admitting a half-open probe marks it
   * in flight so only one probe passes per cooldown window.
   */
  canAdmit(key: string): boolean {
    const state = this.stateOf(key);
    if (state === "closed") return true;
    if (state === "open") return false;
    const record = this.states.get(key);
    if (record?.probeInFlight) return false;
    if (record) record.probeInFlight = true;
    return true;
  }

  /** Env failure at probe time re-opens with a fresh cooldown. */
  recordEnvironmentFailure(key: string): void {
    const record = this.ensure(key);
    record.envFailures += 1;
    if (record.envFailures >= this.allowedFails || record.openedAt !== undefined) {
      record.openedAt = this.now();
      record.probeInFlight = false;
    }
  }

  recordTaskFailure(key: string): void {
    // Task-level failures say nothing about the device; keep the breaker as is.
    this.ensure(key);
  }

  recordSuccess(key: string): void {
    this.states.delete(key);
  }

  reset(key: string): void {
    this.states.delete(key);
  }

  private ensure(key: string): KeyState {
    let record = this.states.get(key);
    if (!record) {
      record = { envFailures: 0, probeInFlight: false };
      this.states.set(key, record);
    }
    return record;
  }
}
