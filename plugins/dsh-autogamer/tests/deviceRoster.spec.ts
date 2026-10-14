/**
 * Device roster over adb (T2-a / G75). The parses are locked against the shapes
 * measured on the live emulator, including the two traps that cost the design:
 * `screenState` is NOT in `dumpsys window displays`, and one emulator answers on
 * three transports while its serial properties are empty strings.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildRoster,
  canonicalSerial,
  enumerateTransports,
  parseDeviceList,
  readScreenState,
  screenIsLocked,
} from "../src/device/roster.js";
import { adbRuntime, devicesArgv, getStateArgv, identityArgv, windowArgv } from "./support/fakeAdb.js";

const A = adbRuntime;

const THREE_TRANSPORTS = `List of devices attached
emulator-5554          device product:aurora model:24031PN0DC device:aurora transport_id:1
127.0.0.1:7555         device product:aurora model:24031PN0DC device:aurora transport_id:2
127.0.0.1:16384        device product:aurora model:24031PN0DC device:aurora transport_id:3
`;

beforeEach(() => {
  A.reset();
});

describe("parseDeviceList", () => {
  it("keeps the serial and state of every device line", () => {
    expect(parseDeviceList(THREE_TRANSPORTS)).toEqual([
      { serial: "emulator-5554", state: "device" },
      { serial: "127.0.0.1:7555", state: "device" },
      { serial: "127.0.0.1:16384", state: "device" },
    ]);
  });

  it("skips the header and the daemon chatter", () => {
    expect(
      parseDeviceList(
        "* daemon not running; starting now at tcp:5037\n" +
          "* daemon started successfully\n" +
          "List of devices attached\n" +
          "\n" +
          "emulator-5554  unauthorized transport_id:1\n",
      ),
    ).toEqual([{ serial: "emulator-5554", state: "unauthorized" }]);
  });

  it("answers an empty list for an empty fleet (not the same as not answering)", () => {
    expect(parseDeviceList("List of devices attached\n")).toEqual([]);
  });
});

describe("enumerateTransports", () => {
  it("parses the device lines", async () => {
    A.on(devicesArgv, { code: 0, stdout: THREE_TRANSPORTS });
    expect(await enumerateTransports()).toHaveLength(3);
    expect(A.calls[0]).toEqual(["devices", "-l"]);
  });

  it("returns undefined when adb could not answer, so an outage is never an empty fleet", async () => {
    A.on(devicesArgv, { code: 1, stderr: "error: could not install *smartsocket* listener" });
    expect(await enumerateTransports()).toBeUndefined();

    A.reset();
    A.on(devicesArgv, { code: 0, stdout: "List of devices attached\n" });
    expect(await enumerateTransports()).toEqual([]);
  });
});

describe("buildRoster (G75)", () => {
  it("folds transports that share an android_id into ONE device", async () => {
    const roster = await buildRoster(
      parseDeviceList(THREE_TRANSPORTS),
      async () => "1ca26c4e90b0b571",
    );
    expect(roster).toHaveLength(1);
    expect(roster[0]?.serial).toBe("emulator-5554");
    expect(roster[0]?.transports).toEqual(["127.0.0.1:16384", "127.0.0.1:7555", "emulator-5554"]);
  });

  it("keeps devices that answer with different ids apart", async () => {
    const roster = await buildRoster(
      [
        { serial: "a", state: "device" },
        { serial: "b", state: "device" },
      ],
      async (serial) => (serial === "a" ? "id-a" : "id-b"),
    );
    expect(roster.map((entry) => entry.serial)).toEqual(["a", "b"]);
  });

  it("never merges a transport that cannot answer: offline and unauthorized keep their own entry", async () => {
    const roster = await buildRoster(
      [
        { serial: "emulator-5554", state: "device" },
        { serial: "127.0.0.1:7555", state: "offline" },
        { serial: "127.0.0.1:5555", state: "unauthorized" },
      ],
      async () => "1ca26c4e90b0b571",
    );
    expect(roster.map((entry) => `${entry.serial}:${entry.state}`).sort()).toEqual([
      "127.0.0.1:5555:unauthorized",
      "127.0.0.1:7555:offline",
      "emulator-5554:device",
    ]);
  });

  it("falls back to the serial when the identity probe does not answer", async () => {
    const roster = await buildRoster(
      [
        { serial: "a", state: "device" },
        { serial: "b", state: "device" },
      ],
      async () => undefined,
    );
    expect(roster.map((entry) => entry.serial)).toEqual(["a", "b"]);
  });

  it("prefers the emulator transport, which survives an adb restart", async () => {
    expect(canonicalSerial(["127.0.0.1:7555", "emulator-5554", "127.0.0.1:5555"])).toBe("emulator-5554");
    expect(canonicalSerial(["127.0.0.1:7555", "127.0.0.1:5555"])).toBe("127.0.0.1:5555");
  });
});

describe("screen state (G65)", () => {
  /**
   * Measured on Android 15: the unfiltered `dumpsys window` carries
   * `screenState=`; `dumpsys window displays` does not, and asking it would make
   * every device look "cannot tell" - which admission rejects.
   */
  it("asks the dump that actually carries screenState", async () => {
    A.on(windowArgv, { code: 0, stdout: "  screenState=SCREEN_STATE_ON\n" });
    expect(await screenIsLocked("emulator-5554")).toBe(false);
    expect(A.calls[0]).toEqual(["-s", "emulator-5554", "shell", "dumpsys", "window"]);
  });

  it("reads off/dozing as locked", () => {
    expect(readScreenState("  screenState=SCREEN_STATE_OFF\n")).toBe(true);
    expect(readScreenState("  screenState=SCREEN_STATE_DOZE\n")).toBe(true);
  });

  it("honours a keyguard flag on builds that print one", () => {
    expect(readScreenState("screenState=SCREEN_STATE_ON\nmKeyguardShowing=true\n")).toBe(true);
    expect(readScreenState("screenState=SCREEN_STATE_ON\nmKeyguardShowing=false\n")).toBe(false);
  });

  /** null and undefined are different answers: "asked, cannot tell" must reject,
   * "not asked" must not (G65). */
  it("answers null, never false, when the dump says nothing", () => {
    expect(readScreenState("WINDOW MANAGER DISPLAY CONTENTS\nmCurrentFocus=Window{1 u0 a/.B}\n")).toBeNull();
    expect(readScreenState("")).toBeNull();
  });

  it("reports null for a transport that did not answer at all", async () => {
    A.on(windowArgv, { code: 1, stderr: "error: device 'nope' not found" });
    expect(await screenIsLocked("nope")).toBeNull();
  });
});

describe("roster wiring into the pool shape", () => {
  it("asks the identity over the named serial", async () => {
    A.on(identityArgv, { code: 0, stdout: "1ca26c4e90b0b571\n" });
    A.on(getStateArgv, { code: 0, stdout: "device\n" });
    const { deviceIdentity } = await import("../src/device/roster.js");
    expect(await deviceIdentity("emulator-5554")).toBe("1ca26c4e90b0b571");
    expect(A.calls[0]).toEqual([
      "-s",
      "emulator-5554",
      "shell",
      "settings",
      "get",
      "secure",
      "android_id",
    ]);

    A.reset();
    A.on(identityArgv, { code: 0, stdout: "null\n" });
    expect(await deviceIdentity("emulator-5554")).toBeUndefined();
  });
});
