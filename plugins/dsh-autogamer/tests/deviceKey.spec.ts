/**
 * deviceKeyOf matrix lock (S4 auto 端点默认键): an omitted, non-string, or
 * empty serial falls back to the configured default, so execute, guard, and
 * gate key the same device. The two call sites used to diverge on "".
 */
import { describe, expect, it } from "vitest";
import { deviceKeyOf } from "../src/tools/runDeviceAction.js";

describe("deviceKeyOf", () => {
  it("falls back when the serial is omitted", () => {
    expect(deviceKeyOf({ action: "back" }, "default")).toBe("default");
  });

  it("falls back on empty or non-string serials", () => {
    expect(deviceKeyOf({ device_serial: "" }, "default")).toBe("default");
    expect(deviceKeyOf({ device_serial: 42 }, "default")).toBe("default");
    expect(deviceKeyOf({ device_serial: null }, "default")).toBe("default");
  });

  it("keeps an explicit serial", () => {
    expect(deviceKeyOf({ device_serial: "emulator-5554" }, "default")).toBe("emulator-5554");
  });
});
