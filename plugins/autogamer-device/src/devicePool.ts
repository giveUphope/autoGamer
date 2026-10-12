/**
 * Device scheduling (S3/G3/G28) on top of the per-device FIFO gate.
 *
 * Two addressing modes, per the glossary: an explicit `device_serial` queues on that device's
 * chain, while an `auto` request is served from the free pool and *parked on at most one device*
 * (G28). The parking rule is the upstream lesson quoted in `runtime/device_lock.py:332` -- an
 * unclaimed ticket used to be counted into every device's queue, so one waiting message blocked
 * machines that were sitting idle. `inventory/02:236` lists exactly this as something a TS rewrite
 * tends to "clean up" and must not.
 *
 * So a waiting ticket never holds a global slot and never blocks another device: `pump()` walks
 * the arrival queue and admits every ticket whose own conditions are met right now, rather than
 * stopping at the first unsatisfiable head.
 */
import type { GateHandle } from "./gate.js";
import { DeviceGate, GateAbortedError } from "./gate.js";
import { deviceKeyOf } from "./tools/runDeviceAction.js";

export interface PoolOptions {
  gate: DeviceGate;
  defaultDeviceKey: string;
  /** Roster for the auto pool. Empty (the default) means: behave exactly like the old single key. */
  devices?: string[];
  /** Concurrent device ceiling across the whole plugin; 0 (default) means unlimited. */
  maxConcurrentDevices?: number;
  /** Devices refused by the breaker (S4 cooldown) are not eligible for auto assignment. */
  isCoolingDown?: (key: string) => boolean;
  /**
   * G64: asks the action surface which devices exist. `undefined` means "could not ask" and must
   * never be read as "no devices". Only consulted when `devices` is empty.
   */
  rosterSource?: () => Promise<PoolDevice[] | undefined>;
  /** Throttle for `rosterSource`; the py pool caches its own snapshot underneath. */
  rosterTtlMs?: number;
  logger?: { info: (message: string) => void; warn: (message: string) => void };
  /** Injectable clock so the throttle is testable without sleeping. */
  now?: () => number;
}

export interface PoolLease extends GateHandle {
  /** The device this call actually ran on -- explicit serial, or the auto assignment. */
  readonly key: string;
}

/**
 * One roster entry. `state` is adb's own device state ("device" / "offline" / "unauthorized",
 * `device_pool.py:38`); it is `undefined` when the operator pinned the roster in config, because
 * a name on its own carries no state. Unknown state must never read as "not ready" -- that is the
 * fail-open half of `_explicit_serial_error` (`device_pool.py:370-373`).
 */
export interface PoolDevice {
  readonly serial: string;
  readonly state?: string;
  readonly isBusy?: boolean;
}

interface Ticket {
  readonly want: string | undefined;
  readonly signal?: AbortSignal;
  settle: (lease: PoolLease) => void;
  fail: (error: unknown) => void;
  queued: boolean;
}

export class DevicePool {
  private readonly gate: DeviceGate;
  private readonly defaultDeviceKey: string;
  private readonly devices: string[];
  private readonly maxConcurrent: number;
  private readonly isCoolingDown: (key: string) => boolean;
  private readonly queue: Ticket[] = [];
  private readonly assigned = new Set<string>();
  private admitted = 0;
  private discovered: PoolDevice[] = [];
  private enumerated = false;
  private nextRefreshAt = 0;
  private refreshing?: Promise<void>;
  private readonly rosterSource?: () => Promise<PoolDevice[] | undefined>;
  private readonly rosterTtlMs: number;
  private readonly logger: { info: (message: string) => void; warn: (message: string) => void };
  private readonly clock: () => number;

  constructor(options: PoolOptions) {
    this.gate = options.gate;
    this.defaultDeviceKey = options.defaultDeviceKey;
    // A serial listed twice would be two pool entries for one device.
    this.devices = [...new Set(options.devices ?? [])];
    this.maxConcurrent = options.maxConcurrentDevices ?? 0;
    this.isCoolingDown = options.isCoolingDown ?? (() => false);
    this.rosterSource = options.rosterSource;
    this.rosterTtlMs = options.rosterTtlMs ?? 5_000;
    this.logger = options.logger ?? { info: () => {}, warn: () => {} };
    this.clock = options.now ?? Date.now;
  }

  /** Devices admitted right now (explicit and auto alike), for diagnostics and cap tests. */
  get busyDevices(): number {
    return this.admitted;
  }

  /**
   * True when the auto pool has a roster; without one, auto keeps the historical single key.
   * A configured roster wins over the discovered one.
   */
  get hasPool(): boolean {
    return this.poolDevices.length > 0;
  }

  /** The roster the pool actually schedules against (G3/G64), as serials. */
  get poolDevices(): string[] {
    return this.entries().map((device) => device.serial);
  }

  /**
   * Entries with state when we have it: a pinned config roster carries names only, and the
   * readiness probe's answer (with state) wins when discovery is on.
   */
  private entries(): PoolDevice[] {
    if (this.devices.length > 0) {
      return this.devices.map((serial) => ({ serial }));
    }
    return this.discovered;
  }

  /**
   * The explicit-serial half of the py submission gate, ported line for line from
   * `_explicit_serial_error` (runtime/device_pool.py:366-385): reject *only* when enumeration was
   * actually answered and the roster is non-empty. An unanswered question or an empty roster means
   * "don't know", and knowing-not is fail-open there by design -- a transient adb blip must not
   * become a hard reject. Returns the refusal reason, or undefined when admissible.
   * Lock-screen verdicts are deliberately absent: adb state cannot carry them (G65).
   */
  admissibleExplicit(serial: string): string | undefined {
    if (!this.enumerated) return undefined;
    const roster = this.entries();
    if (roster.length === 0) return undefined;
    const found = roster.find((device) => device.serial === serial);
    if (found === undefined) return `device ${serial} is not connected`;
    if (found.state !== undefined && found.state !== "device") {
      return `device ${serial} is attached but not ready (state: ${found.state})`;
    }
    return undefined;
  }

  /**
   * Refresh the discovered roster, throttled to one call per `rosterTtlMs`.
   * Resolving to `undefined` means "could not ask" and keeps the previous roster: collapsing that
   * into an empty list would make a transient adb blip look like an empty fleet -- the distinction
   * `try_list_devices_async` exists to make upstream.
   */
  async refreshRoster(): Promise<void> {
    if (!this.rosterSource) return;
    // An operator-pinned roster makes discovery pointless: skip the RPC entirely.
    if (this.devices.length > 0) return;
    const now = this.clock();
    if (now < this.nextRefreshAt) return;
    this.nextRefreshAt = now + this.rosterTtlMs;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const roster = await this.rosterSource?.();
        if (roster !== undefined) {
          const seen = new Map<string, PoolDevice>();
          for (const device of roster) {
            if (device.serial.length > 0) seen.set(device.serial, device);
          }
          this.discovered = [...seen.values()];
          this.enumerated = true;
        } else {
          this.enumerated = false;
        }
      } catch (error) {
        this.logger.warn(`[pool] roster enumeration failed, keeping ${this.poolDevices.length} device(s): ${String(error)}`);
      } finally {
        this.refreshing = undefined;
      }
    })();
    return this.refreshing;
  }

  /**
   * The lock key used *before* acquiring, for breaker/guard decisions. An explicit serial is
   * known immediately; an auto request without a roster still resolves to the default key, and an
   * auto request with a roster resolves to the default key only as a fallback -- the guard must
   * treat that as "any device" (see `refusesAuto`).
   */
  resolveKey(args: Record<string, unknown>): string {
    const serial = this.explicitSerial(args);
    if (serial !== undefined) return serial;
    if (this.hasPool) return this.poolDevices[0] ?? this.defaultDeviceKey;
    return this.defaultDeviceKey;
  }

  /** Every pool device is in cooldown, so an auto call cannot be admitted anywhere. */
  refusesAuto(): boolean {
    if (!this.hasPool) return this.isCoolingDown(this.defaultDeviceKey);
    return this.poolDevices.every((device) => this.isCoolingDown(device));
  }

  /** Queue for the device an auto call would be parked on, or undefined when the pool decides. */
  pendingCount(key: string): number {
    return this.queue.filter((ticket) => ticket.want === key).length;
  }

  async acquire(args: Record<string, unknown>, signal?: AbortSignal): Promise<PoolLease> {
    await this.refreshRoster();
    const ticket: Ticket = {
      want: this.explicitSerial(args),
      signal,
      settle: () => {},
      fail: () => {},
      queued: true,
    };
    const granted = new Promise<PoolLease>((resolve, reject) => {
      ticket.settle = resolve;
      ticket.fail = reject;
    });
    this.queue.push(ticket);
    this.pump();

    if (signal?.aborted) {
      this.drop(ticket);
      throw new GateAbortedError(ticket.want ?? this.defaultDeviceKey);
    }
    return await granted;
  }

  /**
   * Admit whatever can be admitted right now, in arrival order. Scanning past a ticket whose
   * device is busy (instead of stopping at the head) is what keeps one unclaimed message from
   * idling out the rest of the fleet.
   */
  private pump(): void {
    for (const ticket of [...this.queue]) {
      if (!ticket.queued) continue;
      const device = this.eligibleDevice(ticket.want);
      if (device === undefined) continue;
      ticket.queued = false;
      this.admitted += 1;
      this.assigned.add(device);
      void this.gate
        .acquire(device, ticket.signal)
        .then((handle) => {
          ticket.settle({
            key: device,
            release: () => {
              if (handle === undefined) return;
              handle.release();
              this.admitted -= 1;
              this.assigned.delete(device);
              this.pump();
            },
          });
        })
        .catch((error) => {
          // The waiter bailed (abort) or the chain rejected: give the slot back and let the
          // next queued ticket take this device.
          this.admitted -= 1;
          this.assigned.delete(device);
          this.pump();
          if (!(error instanceof GateAbortedError)) throw error;
        });
    }
  }

  /** The device this ticket may take now, or undefined when it must keep waiting. */
  private eligibleDevice(want: string | undefined): string | undefined {
    if (this.maxConcurrent > 0 && this.admitted >= this.maxConcurrent) return undefined;
    if (want !== undefined) {
      if (this.assigned.has(want)) return undefined;
      if (this.gate.busyCount(want) > 0) return undefined;
      return want;
    }
    if (!this.hasPool) {
      // No roster: auto keeps the historical shared key, so behaviour is byte-for-byte the old one.
      return this.assigned.has(this.defaultDeviceKey) || this.gate.busyCount(this.defaultDeviceKey) > 0
        ? undefined
        : this.defaultDeviceKey;
    }
    // Cooldown-skipping is the pool's own job for auto: the guard refuses a *known* cooling device,
    // but an auto request has no device until this line picks one (S4/G33).
    // The ladder mirrors device_pool.py:461-472 -- ready and idle first, then ready, then any
    // attached device; the last rung is what keeps a single-device fleet working when adb reports
    // it busy (py's own "fallback to any attached device").
    const free = this.entries().filter(
      (device) => !this.assigned.has(device.serial) && !this.isCoolingDown(device.serial),
    );
    const ready = free.filter((device) => device.state === undefined || device.state === "device");
    return (
      ready.find((device) => !device.isBusy && this.gate.busyCount(device.serial) === 0)?.serial ??
      ready.find((device) => this.gate.busyCount(device.serial) === 0)?.serial ??
      ready[0]?.serial ??
      free.find((device) => this.gate.busyCount(device.serial) === 0)?.serial
    );
  }

  private explicitSerial(args: Record<string, unknown>): string | undefined {
    const serial = (args as { device_serial?: unknown } | null)?.device_serial;
    if (typeof serial !== "string" || serial.length === 0) return undefined;
    return deviceKeyOf(args, this.defaultDeviceKey);
  }

  private drop(ticket: Ticket): void {
    const at = this.queue.indexOf(ticket);
    if (at >= 0) this.queue.splice(at, 1);
  }
}
