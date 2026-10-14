/**
 * Global adb double (T2-a). `src/device/adb.ts` is the plugin's only adb spawn,
 * and since the device roster, the device-state probes and the screen-size probe
 * all go through it, a suite that let those calls reach the machine's real adb
 * would pass or fail depending on what happens to be plugged in here. Every
 * therefore gets "adb answered nothing" by default and registers the answers a
 * test needs on `adbRuntime`.
 */
import { beforeEach, vi } from "vitest";
import { adbRuntime } from "./fakeAdb.js";

vi.mock("../../src/device/adb.js", async () => await adbRuntime.module());

beforeEach(() => {
  adbRuntime.reset();
});
