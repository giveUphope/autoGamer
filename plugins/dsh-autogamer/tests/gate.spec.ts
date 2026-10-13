import { describe, expect, it } from "vitest";
import { DeviceGate, GateAbortedError } from "../src/gate.js";

describe("DeviceGate", () => {
  it("serializes acquirers on the same key in FIFO order", async () => {
    const gate = new DeviceGate();
    const order: string[] = [];

    const first = gate.acquire("serial-1");
    const second = gate.acquire("serial-1");

    const a = first.then(async (handle) => {
      order.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("a-end");
      handle.release();
    });
    const b = second.then(async (handle) => {
      order.push("b-start");
      handle.release();
    });
    await Promise.all([a, b]);

    expect(order).toEqual(["a-start", "a-end", "b-start"]);
  });

  it("does not serialize different keys", async () => {
    const gate = new DeviceGate();
    const first = gate.acquire("a");
    const second = gate.acquire("b");
    const [handleA, handleB] = await Promise.all([first, second]);
    handleA.release();
    handleB.release();
    expect(gate.busyCount("a")).toBe(0);
  });

  it("abort while waiting leaves the queue without acquiring", async () => {
    const gate = new DeviceGate();
    const holder = await gate.acquire("serial-1");
    const controller = new AbortController();

    const waiting = gate.acquire("serial-1", controller.signal);
    const waitingForever = gate.acquire("serial-1");
    controller.abort();

    await expect(waiting).rejects.toBeInstanceOf(GateAbortedError);
    holder.release();

    // The aborted waiter must not have consumed the slot: the next waiter runs.
    const next = await waitingForever;
    next.release();
    expect(gate.busyCount("serial-1")).toBe(0);
  });

  it("reports pending and busy counts", async () => {
    const gate = new DeviceGate();
    const holder = await gate.acquire("d");
    let releaseWaiting!: () => void;
    const waiting = gate.acquire("d").then((handle) => {
      releaseWaiting = handle.release;
      return handle;
    });
    await Promise.resolve();
    expect(gate.busyCount("d")).toBe(1);
    expect(gate.pendingCount("d")).toBe(1);
    holder.release();
    const handle = await waiting;
    expect(gate.pendingCount("d")).toBe(0);
    releaseWaiting();
  });
});
