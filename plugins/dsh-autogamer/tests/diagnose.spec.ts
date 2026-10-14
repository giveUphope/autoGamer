/**
 * `autogamer_diagnose` unit locks (T2-f: assembled from local adb probes; the
 * provider report is gone). The merge is still the point — a broken environment
 * is REPORTED with its fixes appended, not thrown, because this tool doubles as
 * the manual preflight entry. Only a report that could not be produced on top of
 * a broken environment throws, and then the preflight text wins.
 */
import { describe, expect, it } from "vitest";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { DeviceDiagnosis } from "../src/device/diagnose.js";
import { diagnoseDevice, parseCrashLogcat, parseVersionName } from "../src/device/diagnose.js";
import type { PreflightResult } from "../src/env/preflight.js";
import type { DshImageAttachment } from "../src/dsh-types.js";
import { defineDiagnose } from "../src/tools/diagnose.js";
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

const HEALTHY: PreflightResult = { ok: true, checks: [], finishedAt: "t" };
const BROKEN: PreflightResult = {
  ok: false,
  checks: [{ id: "adb-devices", ok: false, detail: "none attached", fix: "plug it in" }],
  finishedAt: "t",
};

const REPORT: DeviceDiagnosis = {
  deviceSerial: "em-1",
  adbConnected: true,
  helperInstalled: true,
  helperVersion: "1.2.0",
  recentCrashes: [{ package: "uiautomator", timestamp: "2026-10-15 03:09:46", stackExcerpt: "Cmdline: uiautomator" }],
  recommendations: ["restart adb"],
  screenLocked: false,
  frame: { width: 1600, height: 900 },
};

/** The measured `logcat -b crash -v brief` shapes, including a tombstone block. */
const CRASH_LOG = [
  "--------- beginning of crash",
  "F/DEBUG   ( 8852): Timestamp: 2026-10-15 03:09:46.516729893+0800",
  "F/DEBUG   ( 8852): Process uptime: 3s",
  "F/DEBUG   ( 8852): Cmdline: uiautomator",
  "F/DEBUG   ( 8852): pid: 8852, tid: 8852, name: uiautomator  >>> uiautomator <<<",
  "F/DEBUG   ( 8852): signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0",
  "10-15 01:18:38.225  4319  4319 F libc    : Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x7dc844ecfbe0 in tid 4319 (Shutdown thread), pid 4319 (Shutdown thread)",
  "10-15 01:18:38.348  4334  4334 F DEBUG   : Build fingerprint: 'Xiaomi/aurora/aurora:15/V417IR/1100:user/release-keys'",
].join("\n");

function defineWith(options?: {
  report?: DeviceDiagnosis;
  env?: PreflightResult;
  defaultDeviceSerial?: string;
  failing?: boolean;
  noFrame?: boolean;
  noStore?: boolean;
}) {
  const asked: (string | undefined)[] = [];
  const saved: Buffer[] = [];
  const tool = defineDiagnose({
    diagnose: async (serial) => {
      asked.push(serial);
      if (options?.failing === true) throw new Error("adb did not answer");
      return options?.report ?? REPORT;
    },
    checkEnv: async () => options?.env ?? HEALTHY,
    defaultDeviceSerial: options?.defaultDeviceSerial ?? "",
    ...(options?.noFrame
      ? { capturePng: async () => undefined }
      : {
          capturePng: async () => pngHeaderOnly(1600, 900),
        }),
    ...(options?.noStore
      ? {}
      : {
          saveScreenshot: async (bytes: Uint8Array) => {
            saved.push(Buffer.from(bytes));
            return {
              attachmentId: "diag-shot" as DshImageAttachment["attachmentId"],
              mediaType: "image/png" as const,
              bytes: 33,
              width: 1600,
              height: 900,
            };
          },
        }),
  });
  return { tool, asked, saved };
}

describe("diagnose: definition", () => {
  it("names adb in its own description, not a provider", () => {
    const { tool } = defineWith();
    expect(tool.name).toBe("autogamer_diagnose");
    expect(tool.description).toContain("adb");
    expect(tool.description).not.toMatch(/ARTEMIS/i);
  });
});

describe("diagnose: execute", () => {
  it("reports the local diagnosis on a healthy environment", async () => {
    const { tool, asked } = defineWith();
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(asked).toEqual([undefined]);
    expect(value).toMatchObject({
      device_serial: "em-1",
      adb_connected: true,
      helper_installed: true,
      helper_version: "1.2.0",
      recommendations: ["restart adb"],
    });
    expect(value.recent_crashes).toEqual([
      { package: "uiautomator", timestamp: "2026-10-15 03:09:46", stack_excerpt: "Cmdline: uiautomator" },
    ]);
  });

  it("prefers the call arg, then the configured default", async () => {
    const byArg = defineWith({ defaultDeviceSerial: "em-default" });
    await byArg.tool.execute({ device_serial: "em-arg" }, exec());
    expect(byArg.asked).toEqual(["em-arg"]);

    const byConfig = defineWith({ defaultDeviceSerial: "em-default" });
    await byConfig.tool.execute({}, exec());
    expect(byConfig.asked).toEqual(["em-default"]);
  });

  it("appends the preflight fixes instead of throwing on a broken environment", async () => {
    const { tool } = defineWith({ env: BROKEN });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value.recommendations).toEqual(["restart adb", "plug it in"]);
    expect(value.adb_connected).toBe(true);
  });

  it("does not duplicate a fix both sides already name", async () => {
    const { tool } = defineWith({
      env: { ok: false, checks: [{ id: "x", ok: false, fix: "restart adb" }], finishedAt: "t" },
    });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value.recommendations).toEqual(["restart adb"]);
  });

  it("a failed report over a broken environment throws the preflight text", async () => {
    const { tool } = defineWith({ env: BROKEN, failing: true });
    await expect(tool.execute({}, exec())).rejects.toThrow(/preflight failed at adb-devices.*plug it in/);
  });

  it("a failed report over a healthy environment rethrows what the probe said", async () => {
    const { tool } = defineWith({ failing: true });
    await expect(tool.execute({}, exec())).rejects.toThrow(/^adb did not answer$/);
  });

  it("attaches a frame only when asked, and renders it as an image block", async () => {
    const asked = defineWith();
    const value = (await asked.tool.execute({ include_screenshot: true }, exec())) as Record<string, unknown>;
    expect(value.screenshot_path).toBe("diag-shot");
    expect(asked.saved).toHaveLength(1);
    const blocks = tool_output(asked).render({}, value) as { type: string; attachment?: unknown }[];
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ type: "image", attachment: { attachmentId: "diag-shot" } });

    const plain = defineWith();
    const without = (await plain.tool.execute({}, exec())) as Record<string, unknown>;
    expect(without.screenshot_path).toBeUndefined();
    expect(plain.saved).toHaveLength(0);
  });

  it("survives a missing frame or a missing store without failing the report", async () => {
    const noFrame = defineWith({ noFrame: true });
    const value = (await noFrame.tool.execute({ include_screenshot: true }, exec())) as Record<string, unknown>;
    expect(value.screenshot_path).toBeUndefined();
    expect(value.adb_connected).toBe(true);

    const noStore = defineWith({ noStore: true });
    const second = (await noStore.tool.execute({ include_screenshot: true }, exec())) as Record<string, unknown>;
    expect(second.screenshot_path).toBeUndefined();
  });

  it("renders one line that carries the counts a triage needs", async () => {
    const { tool } = defineWith();
    const rendered = tool.output?.render({}, { device_serial: "em-1", adb_connected: true, recent_crashes: [{}], recommendations: ["a", "b"] }) as {
      type: string;
      text?: string;
    }[];
    expect(rendered[0]?.text).toBe("device_serial=em-1; adb_connected=true; helper_installed=false; recent_crashes=1; recommendations=2");
  });
});

describe("crash log parsing (measured shapes)", () => {
  it("reads the version out of a package dump", () => {
    expect(parseVersionName("Packages:\n  versionName=1.2.0\n")).toBe("1.2.0");
    expect(parseVersionName("no version here")).toBeUndefined();
  });

  it("groups the crash buffer into entries named by their process", () => {
    const entries = parseCrashLogcat(CRASH_LOG);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.package).toBe("uiautomator");
    expect(entries[0]?.timestamp).toContain("2026-10-15 03:09:46");
    expect(entries[0]?.stackExcerpt).toContain("signal 11");
    expect(entries[1]?.package).toBe("Shutdown thread");
    expect(entries[1]?.timestamp).toBe("10-15 01:18:38.225");
  });

  it("returns nothing for an empty or unreadable buffer", () => {
    expect(parseCrashLogcat("")).toEqual([]);
    expect(parseCrashLogcat("--------- beginning of main\n10-15 01:18:38.225 1 I/activity: hello\n")).toEqual([]);
  });
});

/** The probe assembly behind the tool: what each adb answer turns into. */
describe("diagnoseDevice (the probes and the recommendations they earn)", () => {
  const A = adbRuntime;

  function healthyDevice() {
    A.reset();
    A.on(getStateArgv, { code: 0, stdout: "device\n" });
    A.on(windowArgv, { code: 0, stdout: windowDump({ screenState: "ON", focus: "com.x/.Main" }) });
    A.on(packagesArgv, { code: 0, stdout: "package:com.artemis.helper\n" });
    A.on(screencapArgv, { code: 0, stdout: pngHeaderOnly(1600, 900) });
    A.on(/shell dumpsys package com\.artemis\.helper/, { code: 0, stdout: "Packages:\n  versionName=1.2.0\n" });
    A.on(/logcat -d -b crash/, { code: 0, stdout: CRASH_LOG });
  }

  it("assembles the report from the answers it got", async () => {
    healthyDevice();
    const report = await diagnoseDevice("emulator-5554");
    expect(report).toMatchObject({
      deviceSerial: "emulator-5554",
      adbConnected: true,
      helperInstalled: true,
      helperVersion: "1.2.0",
      screenLocked: false,
      frame: { width: 1600, height: 900 },
    });
    expect(report.recentCrashes).toHaveLength(2);
    expect(report.recommendations.join("\n")).toContain("crash block(s)");
  });

  it("says the device is not ready in its own words, and does not invent a version", async () => {
    healthyDevice();
    A.reset();
    A.on(getStateArgv, { code: 0, stdout: "offline\n" });
    A.on(windowArgv, { code: 0, stdout: "" });
    A.on(packagesArgv, { code: 1, stderr: "error: device offline" });
    A.on(screencapArgv, { code: 1, stderr: "error: device offline" });
    A.on(/logcat/, { code: 1, stderr: "error: device offline" });
    const report = await diagnoseDevice("emulator-5554");
    expect(report.adbConnected).toBe(false);
    expect(report.helperInstalled, "an unanswered probe is not `false`").toBeUndefined();
    expect(report.helperVersion).toBeUndefined();
    expect(report.recentCrashes).toEqual([]);
    expect(report.recommendations.join("\n")).toContain('"offline"');
  });

  it("calls the helper optional instead of failing the device over it", async () => {
    healthyDevice();
    A.on(packagesArgv, { code: 0, stdout: "" });
    const report = await diagnoseDevice("emulator-5554");
    expect(report.helperInstalled).toBe(false);
    expect(report.helperVersion, "no version probe for an APK that is not there").toBeUndefined();
    expect(A.calls.some((args) => /dumpsys package/.test(args.join(" ")))).toBe(false);
    expect(report.recommendations.join("\n")).toContain("optional");
  });

  it("tells the operator when the screen state cannot be read", async () => {
    healthyDevice();
    A.on(windowArgv, { code: 0, stdout: "WINDOW MANAGER STATE (no screenState here)\n" });
    const report = await diagnoseDevice("emulator-5554");
    expect(report.screenLocked).toBeNull();
    expect(report.recommendations.join("\n")).toContain("screenState");
  });

  it("resolves the serial it actually answered for when none was named", async () => {
    healthyDevice();
    A.on(getSerialnoArgv, { code: 0, stdout: "emulator-5554\n" });
    const report = await diagnoseDevice(undefined);
    expect(report.deviceSerial).toBe("emulator-5554");
  });
});

/** The `output` seam is typed by the host; the spec only needs to call render. */
function tool_output(with_: { tool: ReturnType<typeof defineDiagnose> }) {
  return (with_.tool.output ?? {}) as { render: (args: unknown, value: unknown) => unknown[] };
}

function exec(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext;
}
