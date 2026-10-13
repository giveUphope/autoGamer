/**
 * Shared router harness assembly (the "four copies of the same assembly" debt noted in
 * `docs/TODO.md` §零): every spec that drives `run_device_action` needs a gate plus a pool over it.
 */
import { DeviceGate } from "../../src/gate.js";
import { DevicePool } from "../../src/devicePool.js";

export interface Harness {
  gate: DeviceGate;
  pool: DevicePool;
}

/**
 * A pool over a fresh gate with an empty roster -- byte-for-byte the historical single-key
 * behaviour, which is what these specs assume unless they are testing scheduling itself.
 */
export function harness(devices: string[] = [], maxConcurrentDevices = 0): Harness {
  const gate = new DeviceGate();
  const pool = new DevicePool({
    gate,
    defaultDeviceKey: "default",
    devices,
    maxConcurrentDevices,
  });
  return { gate, pool };
}

/** Just the pool, for specs that never look at the gate. */
export function defaultPool(): DevicePool {
  return harness().pool;
}
