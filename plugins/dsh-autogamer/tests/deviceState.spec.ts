/**
 * The device-state probes (T2-a). Two things are locked here: the parses of
 * output measured on the live emulator (Android 15, `emulator-5554` aurora), and
 * the argv the probes use - because the same question asked with a different
 * argument gives a different answer (`dumpsys window displays` prints no
 * screenState at all), and a wrong argv reads as an honest "unknown".
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  HELPER_PACKAGE,
  createAdbProbe,
  parseForeground,
  parseGetState,
  parsePackageList,
  parseWindowState,
} from "../src/device/state.js";
import {
  adbRuntime,
  getStateArgv,
  getSerialnoArgv,
  packagesArgv,
  pngHeaderOnly,
  screencapArgv,
  windowArgv,
  windowDump,
} from "./support/fakeAdb.js";

const A = adbRuntime;

/** The real line from the emulator, hash and all. */
const FOCUS = "  mCurrentFocus=Window{7cc5aaf u0 com.android.chromium/org.chromium.chrome.browser.ChromeTabbedActivity}";

beforeEach(() => {
  A.reset();
});

describe("parseGetState", () => {
  it("accepts the three words adb prints", () => {
    expect(parseGetState("device\n")).toBe("device");
    expect(parseGetState("offline")).toBe("offline");
    expect(parseGetState("unauthorized\n")).toBe("unauthorized");
  });

  it("calls anything else 'did not answer', including adb's error line", () => {
    expect(parseGetState("")).toBeUndefined();
    expect(parseGetState("error: device 'nope-9' not found")).toBeUndefined();
    expect(parseGetState("emulator-5554")).toBeUndefined();
  });
});

describe("parseForeground", () => {
  it("splits the focused window into package and activity", () => {
    expect(parseForeground(FOCUS)).toEqual({
      package: "com.android.chromium",
      activity: "org.chromium.chrome.browser.ChromeTabbedActivity",
    });
  });

  it("keeps Android's leading-dot activity form as printed", () => {
    expect(parseForeground("mCurrentFocus=Window{1f4c u0 com.x/.Main}")).toEqual({
      package: "com.x",
      activity: ".Main",
    });
  });

  it("falls back to the resumed activity when no window has focus", () => {
    expect(
      parseForeground("  mFocusedApp=ActivityRecord{24877 u0 com.example/.Home t113}"),
    ).toEqual({ package: "com.example", activity: ".Home" });
  });

  it("answers nothing for a focus that names no activity", () => {
    expect(parseForeground("  mCurrentFocus=Window{0 u0 (null)}")).toBeUndefined();
    expect(parseForeground("")).toBeUndefined();
  });
});

describe("parsePackageList", () => {
  it("reads the `package:` lines adb prints", () => {
    expect(parsePackageList(`package:${HELPER_PACKAGE}\npackage:com.taptap\n`)).toBe(true);
    expect(parsePackageList("package:com.taptap\n")).toBe(false);
    expect(parsePackageList("")).toBe(false);
  });
});

describe("parseWindowState", () => {
  it("answers the screen and the focus from one dump", () => {
    expect(parseWindowState(windowDump({ screenState: "ON", focus: "com.x/.Main" }))).toEqual({
      screenLocked: false,
      foreground: { package: "com.x", activity: ".Main" },
    });
  });

  it("keeps the two answers independent when only one is there", () => {
    expect(parseWindowState(windowDump({ screenState: "OFF" }))).toEqual({ screenLocked: true });
    expect(parseWindowState(windowDump({ focus: "com.x/.Main" }))).toEqual({
      screenLocked: null,
      foreground: { package: "com.x", activity: ".Main" },
    });
  });
});

describe("createAdbProbe", () => {
  const probe = createAdbProbe();

  it("asks get-serialno without naming a device, and reads the answer", async () => {
    A.on(getSerialnoArgv, { code: 0, stdout: "emulator-5554\r\n" });
    expect(await probe.serial()).toBe("emulator-5554");
    expect(A.calls[0]).toEqual(["get-serialno"]);

    A.reset();
    A.on(getSerialnoArgv, { code: 1, stderr: "error: device 'nope-1' not found" });
    expect(await probe.serial()).toBeUndefined();
  });

  it("names the serial with -s when one is given, and omits it when none is", async () => {
    A.on(getStateArgv, { code: 0, stdout: "device\n" });
    await probe.connection("emulator-5554");
    expect(A.calls[0]).toEqual(["-s", "emulator-5554", "get-state"]);

    A.reset();
    A.on(getStateArgv, { code: 0, stdout: "device\n" });
    await probe.connection(undefined);
    expect(A.calls[0]).toEqual(["get-state"]);
  });

  /** The argv that makes this a lock: `dumpsys window displays` (the argument an
   * earlier version used) prints no screenState line at all on Android 15. */
  it("asks the unfiltered dumpsys window for the screen state", async () => {
    A.on(windowArgv, { code: 0, stdout: windowDump({ screenState: "ON", focus: "com.x/.Main" }) });
    expect(await probe.window("emulator-5554")).toEqual({
      screenLocked: false,
      foreground: { package: "com.x", activity: ".Main" },
    });
    expect(A.calls[0]).toEqual(["-s", "emulator-5554", "shell", "dumpsys", "window"]);
  });

  it("captures through exec-out, which keeps the PNG bytes intact", async () => {
    const png = pngHeaderOnly(1600, 900);
    A.on(screencapArgv, { code: 0, stdout: png });
    const captured = await probe.capture("emulator-5554");
    expect(A.calls[0]).toEqual(["-s", "emulator-5554", "exec-out", "screencap", "-p"]);
    expect(captured?.readUInt32BE(16)).toBe(1600);
    expect((await probe.frame("emulator-5554"))?.height).toBe(900);
  });

  it("treats an empty or failed capture as no frame, not as a zero-sized one", async () => {
    A.on(screencapArgv, { code: 0, stdout: Buffer.alloc(0) });
    expect(await probe.capture("emulator-5554")).toBeUndefined();
    expect(await probe.frame("emulator-5554")).toBeUndefined();

    A.reset();
    A.on(screencapArgv, { code: 1, stderr: "error: device offline" });
    expect(await probe.capture("emulator-5554")).toBeUndefined();
  });

  it("asks the package list for the helper and reports the answer", async () => {
    A.on(packagesArgv, { code: 0, stdout: `package:${HELPER_PACKAGE}\n` });
    expect(await probe.helperInstalled("emulator-5554")).toBe(true);
    expect(A.calls[0]).toEqual([
      "-s",
      "emulator-5554",
      "shell",
      "pm",
      "list",
      "packages",
      HELPER_PACKAGE,
    ]);

    A.reset();
    A.on(packagesArgv, { code: 1, stderr: "error: device 'nope' not found" });
    expect(await probe.helperInstalled("nope")).toBeUndefined();
  });

  it("reads an aborted call as no answer, never as an unlocked screen", async () => {
    A.on(windowArgv, { code: 0, stdout: windowDump({ screenState: "ON" }) });
    const controller = new AbortController();
    controller.abort();
    expect(await probe.window("emulator-5554", { signal: controller.signal })).toEqual({ screenLocked: null });
    expect(await probe.connection("emulator-5554", { signal: controller.signal })).toBeUndefined();
    expect(await probe.capture("emulator-5554", { signal: controller.signal })).toBeUndefined();
  });
});
