/**
 * G3/G28 device scheduling locks. The rules under test are quoted where they come from:
 * parking ("auto 占住一台空闲设备", glossary G28), the claimed-only rule from
 * `runtime/device_lock.py:332` (an unclaimed ticket must not be counted into every device's
 * queue), and the "do not clean this up in the TS rewrite" warning at `inventory/02:236`.
 */
import { describe, expect, it } from "vitest";
import { DeviceGate } from "../src/gate.js";
import { DevicePool, type PoolDevice } from "../src/devicePool.js";

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

  it("schedules auto work on a discovered roster (G64)", async () => {
    let calls = 0;
    const gate = new DeviceGate();
    const pool = new DevicePool({
      gate,
      defaultDeviceKey: "default",
      rosterSource: async () => {
        calls += 1;
        return [{ serial: "emulator-5554", state: "device" }, { serial: "emulator-5556", state: "device" }];
      },
    });
    const first = await pool.acquire({ action: "tap" });
    const second = await pool.acquire({ action: "tap" });
    expect([first.key, second.key].sort()).toEqual(["emulator-5554", "emulator-5556"]);
    expect(calls).toBe(1); // throttled: one enumeration for the burst, not one per call
    first.release();
    second.release();
  });

  it("keeps the last good roster when enumeration cannot be answered (fail-open)", async () => {
    // device_pool.py:354-356 -- "could not ask adb" must stay distinct from "no devices attached".
    let answer: PoolDevice[] | undefined = [{ serial: "A", state: "device" }];
    let clock = 0;
    const gate = new DeviceGate();
    const pool = new DevicePool({
      gate,
      defaultDeviceKey: "default",
      rosterSource: async () => answer,
      rosterTtlMs: 1_000,
      now: () => clock,
    });
    const first = await pool.acquire({ action: "tap" });
    expect(first.key).toBe("A");
    first.release();

    answer = undefined; // the question failed this time
    clock += 2_000; // past the throttle window, so it really asks again
    const second = await pool.acquire({ action: "tap" });
    expect(second.key).toBe("A"); // not "default": the fleet did not vanish
    second.release();
    expect(pool.poolDevices).toEqual(["A"]);
  });

  it("prefers a configured roster over the discovered one", async () => {
    const gate = new DeviceGate();
    let asked = 0;
    const pool = new DevicePool({
      gate,
      defaultDeviceKey: "default",
      devices: ["pinned-1"],
      rosterSource: async () => {
        asked += 1;
        return [{ serial: "discovered-1", state: "device" }];
      },
      now: () => 0,
      rosterTtlMs: 0,
    });
    const lease = await pool.acquire({ action: "tap" });
    expect(lease.key).toBe("pinned-1");
    lease.release();
    expect(asked).toBe(0); // no RPC at all when the operator pinned a roster
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

  describe("submission admission (P2 A 片)", () => {
    // Ported from runtime/device_pool.py:366-385 (_explicit_serial_error), which is the first of
    // py's two submission gates (apps/admin_console/routers/tasks.py:140 runs it before the
    // readiness probe at :160). Lock-screen verdicts are G65 and deliberately absent here.
    async function discovered(...devices: PoolDevice[]) {
      const gate = new DeviceGate();
      const pool = new DevicePool({
        gate,
        defaultDeviceKey: "default",
        rosterSource: async () => devices,
      });
      // Refresh directly rather than "acquire once to force it": with every device locked or
      // unknown there is nothing to acquire, and an auto call would legitimately never resolve.
      await pool.refreshRoster();
      return pool;
    }

    it("rejects an explicit serial that is not attached, only when enumeration answered", async () => {
      const pool = await discovered({ serial: "A", state: "device" });
      expect(pool.admissibleExplicit("B")).toBe("device B is not connected");
      expect(pool.admissibleExplicit("A")).toBeUndefined();
    });

    it("rejects an attached-but-not-ready serial and names the state", async () => {
      const pool = await discovered({ serial: "A", state: "unauthorized" });
      expect(pool.admissibleExplicit("A")).toBe("device A is attached but not ready (state: unauthorized)");
    });

    it("fails open when the question could not be answered", async () => {
      // device_pool.py:370-373 -- an indeterminate or empty enumeration must not hard-reject.
      const gate = new DeviceGate();
      let answer: PoolDevice[] | undefined = [{ serial: "A", state: "offline" }];
      const pool = new DevicePool({
        gate,
        defaultDeviceKey: "default",
        rosterSource: async () => answer,
        rosterTtlMs: 0,
      });
      const lease = await pool.acquire({ action: "tap" });
      lease.release();
      expect(pool.admissibleExplicit("A")).toContain("not ready");

      answer = undefined; // next refresh cannot answer
      const again = await pool.acquire({ action: "tap" });
      again.release();
      expect(pool.admissibleExplicit("A")).toBeUndefined();
    });

    it("fails open on an empty enumeration instead of rejecting every serial", async () => {
      const pool = await discovered(); // enumerated=true, roster=[]
      expect(pool.admissibleExplicit("anything")).toBeUndefined();
    });

    it("never rejects on a pinned config roster, which carries no state", async () => {
      const gate = new DeviceGate();
      const pool = new DevicePool({ gate, defaultDeviceKey: "default", devices: ["pinned-1"] });
      expect(pool.admissibleExplicit("pinned-1")).toBeUndefined();
      expect(pool.admissibleExplicit("other")).toBeUndefined();
    });

    it("prefers a ready and idle device over a ready but busy one (device_pool.py:461-472)", async () => {
      const gate = new DeviceGate();
      const pool = new DevicePool({
        gate,
        defaultDeviceKey: "default",
        rosterSource: async () => [
          { serial: "busy-one", state: "device", isBusy: true },
          { serial: "idle-one", state: "device", isBusy: false },
        ],
      });
      const lease = await pool.acquire({ action: "tap" });
      expect(lease.key).toBe("idle-one");
      lease.release();
    });

    it("rejects an explicit serial that is locked", async () => {
      const pool = await discovered({ serial: "A", state: "device", isLocked: true });
      expect(pool.admissibleExplicit("A")).toBe("device A is locked");
    });

    it("fails closed on an asked-but-unknown lock state, and that is NOT the same as not asking", async () => {
      // adb_probe.py:452 treats "Lock State Unknown" exactly like "Device Locked"; the router then
      // 409s (tasks.py:174). A device nobody asked about must not fall into that branch.
      const asked = await discovered({ serial: "A", state: "device", isLocked: null });
      expect(asked.admissibleExplicit("A")).toBe("device A lock state is unknown");

      const notAsked = await discovered({ serial: "A", state: "device" });
      expect(notAsked.admissibleExplicit("A")).toBeUndefined();
    });

    it("auto skips locked and unknown devices (adb_probe.py:427-446 switches instead of dispatching)", async () => {
      const pool = await discovered(
        { serial: "locked-one", state: "device", isLocked: true },
        { serial: "unknown-one", state: "device", isLocked: null },
        { serial: "open-one", state: "device", isLocked: false },
      );
      const lease = await pool.acquire({ action: "tap" });
      expect(lease.key).toBe("open-one");
      lease.release();
    });
  });
});
