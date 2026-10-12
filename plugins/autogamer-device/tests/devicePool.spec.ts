/**
 * G3/G28 device scheduling locks. The rules under test are quoted where they come from:
 * parking ("auto 占住一台空闲设备", glossary G28), the claimed-only rule from
 * `runtime/device_lock.py:332` (an unclaimed ticket must not be counted into every device's
 * queue), and the "do not clean this up in the TS rewrite" warning at `inventory/02:236`.
 */
import { describe, expect, it } from "vitest";
import { DeviceGate } from "../src/gate.js";
import { DevicePool } from "../src/devicePool.js";

const hold = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function build(options: { devices?: string[]; max?: number; cooling?: string[] } = {}) {
  const gate = new DeviceGate();
  const pool = new DevicePool({
    gate,
    defaultDeviceKey: "default",
    devices: options.devices ?? [],
    maxConcurrentDevices: options.max ?? 0,
    isCoolingDown: (key) => (options.cooling ?? []).includes(key),
  });
  return { gate, pool };
}

describe("DevicePool (G3/G28)", () => {
  it("keeps the historical single-key behaviour when no roster is configured", async () => {
    const { pool } = build();
    const lease = await pool.acquire({ action: "tap" });
    expect(lease.key).toBe("default"); // default: no devices configured -> old shared key
    lease.release();
    const named = await pool.acquire({ action: "tap", device_serial: "emulator-5554" });
    expect(named.key).toBe("emulator-5554");
    named.release();
  });

  it("parks an auto request on exactly one free device (G28)", async () => {
    const { pool } = build({ devices: ["A", "B"] });
    const first = await pool.acquire({ action: "tap" });
    const second = await pool.acquire({ action: "tap" });
    expect([first.key, second.key].sort()).toEqual(["A", "B"]);
    expect(pool.busyDevices).toBe(2);
    first.release();
    second.release();
  });

  it("does not let a waiting auto ticket idle out the rest of the fleet", async () => {
    // device_lock.py:332 -- the parked ticket used to be counted into every device's queue, so a
    // single unclaimed message blocked machines that were sitting idle. Here every pool device is
    // busy, so the auto ticket must wait *without* holding anything: a later request for a device
    // outside the pool still runs immediately.
    const { gate, pool } = build({ devices: ["A", "B"] });
    const a = await pool.acquire({ action: "tap", device_serial: "A" });
    const b = await pool.acquire({ action: "tap", device_serial: "B" });
    const pendingAuto = pool.acquire({ action: "tap" });
    await hold(5);
    expect(gate.busyCount("A")).toBe(1);
    expect(pool.busyDevices).toBe(2); // the parked ticket has claimed nothing

    const outside = await pool.acquire({ action: "tap", device_serial: "emulator-5556" });
    expect(outside.key).toBe("emulator-5556");
    outside.release();

    a.release();
    const auto = await pendingAuto;
    expect(auto.key).toBe("A");
    auto.release();
    b.release();
  });

  it("honours the global concurrency ceiling", async () => {
    const { pool } = build({ devices: ["A", "B", "C"], max: 2 });
    const a = await pool.acquire({ action: "tap" });
    const b = await pool.acquire({ action: "tap" });
    expect(pool.busyDevices).toBe(2);
    let thirdSettled = false;
    const third = pool.acquire({ action: "tap" }).then((lease) => {
      thirdSettled = true;
      return lease;
    });
    await hold(10);
    expect(thirdSettled).toBe(false);
    a.release();
    const c = await third;
    expect(thirdSettled).toBe(true);
    expect(["A", "B", "C"]).toContain(c.key);
    b.release();
    c.release();
  });

  it("skips devices in breaker cooldown when assigning auto work (S4)", async () => {
    const { pool } = build({ devices: ["A", "B"], cooling: ["A"] });
    const lease = await pool.acquire({ action: "tap" });
    expect(lease.key).toBe("B");
    lease.release();
  });

  it("gives a freed device to the earliest queued auto ticket, not to whoever scans first", async () => {
    // The claimed-only half of inventory/02:236: after a device frees, the ticket that asked first
    // keeps its place. Written because the first version of this lock could not tell a reversed
    // scan order from the correct one -- mutation check said "green", so the lock was vacuous.
    const { pool } = build({ devices: ["A", "B"] });
    const first = await pool.acquire({ action: "tap" });
    const second = await pool.acquire({ action: "tap" });
    const early = pool.acquire({ action: "tap" });
    const late = pool.acquire({ action: "tap" });
    await hold(5);

    const settled: string[] = [];
    const trackedEarly = early.then((lease) => {
      settled.push(`early:${lease.key}`);
      return lease;
    });
    const trackedLate = late.then((lease) => {
      settled.push(`late:${lease.key}`);
      return lease;
    });

    first.release(); // exactly one device becomes available
    const winner = await trackedEarly;
    expect(settled).toEqual([`early:${first.key}`]); // the earlier ticket got it
    second.release();
    const loser = await trackedLate;
    expect(settled[1]).toBe(`late:${second.key}`);
    winner.release();
    loser.release();
  });
});
