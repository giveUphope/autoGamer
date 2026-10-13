/**
 * Per-device FIFO gate (S3): the only self-built synchronization in the
 * plugin. One wait-chain per lock key, with tracked pending so a cancelled
 * waiter never blocks later ones. Deliberately no library dependency —
 * DSH ships no semaphore/mutex (verified against 0.2.0-rc.2 source).
 */

export interface GateHandle {
  readonly key: string;
  release(): void;
}

export class DeviceGate {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly holders = new Map<string, number>();

  /** Holders that have been admitted but not yet released. */
  busyCount(key: string): number {
    return this.holders.get(key) ?? 0;
  }

  /** Waiters blocked on this key right now. */
  pendingCount(key: string): number {
    return this.waiters.get(key)?.size ?? 0;
  }

  /**
   * Acquire the device. Resolves once the caller owns the device; the
   * returned handle must be released (use try/finally). Abort to leave the
   * queue without acquiring — the abort listener is attached synchronously
   * so a queued waiter can bail out before its turn comes.
   */
  async acquire(key: string, signal?: AbortSignal): Promise<GateHandle> {
    if (signal?.aborted) throw new GateAbortedError(key);

    const tail = this.tails.get(key) ?? Promise.resolve();
    let releaseTail!: () => void;
    const chain = new Promise<void>((resolve) => {
      releaseTail = resolve;
    });
    // The tail entry intentionally stays after release (bounded by device
    // count); busy-ness is tracked separately in `holders`.
    this.tails.set(key, chain);

    const waiter: Waiter = { resolve: () => {}, reject: () => {} };
    const pending = this.waiters.get(key) ?? new Set<Waiter>();
    pending.add(waiter);
    this.waiters.set(key, pending);

    let aborted = false;
    let released = false;
    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      signal?.removeEventListener("abort", onAbort);
      this.removeWaiter(key, waiter);
      waiter.reject(new GateAbortedError(key));
      releaseTail();
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const acquired = new Promise<void>((resolve, reject) => {
      waiter.resolve = resolve;
      waiter.reject = reject;
    });

    const previous = tail.then(
      () => undefined,
      () => undefined,
    );
    void previous.then(() => {
      if (aborted) return; // cancelled while queued — slot already passed on
      if (signal?.aborted) {
        onAbort();
        return;
      }
      this.removeWaiter(key, waiter);
      this.holders.set(key, (this.holders.get(key) ?? 0) + 1);
      waiter.resolve();
    });

    await acquired;
    return {
      key,
      release: () => {
        if (aborted || released) return;
        released = true;
        signal?.removeEventListener("abort", onAbort);
        const count = (this.holders.get(key) ?? 1) - 1;
        if (count <= 0) this.holders.delete(key);
        else this.holders.set(key, count);
        releaseTail();
      },
    };
  }

  private removeWaiter(key: string, waiter: Waiter): void {
    const pending = this.waiters.get(key);
    if (!pending) return;
    pending.delete(waiter);
    if (pending.size === 0) this.waiters.delete(key);
  }
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

export class GateAbortedError extends Error {
  constructor(readonly key: string) {
    super(`device gate aborted while waiting for "${key}"`);
    this.name = "GateAbortedError";
  }
}
