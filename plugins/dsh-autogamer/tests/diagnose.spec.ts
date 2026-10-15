/**
 * `autogamer_diagnose` unit locks (T2-f: assembled from local adb probes; the
 * provider report is gone). The merge is still the point — a broken environment
 * is REPORTED with its fixes appended, not thrown, because this tool doubles as
 * the manual preflight entry. Only a report that could not be produced on top of
 * a broken environment throws, and then the preflight text wins.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { DeviceDiagnosis } from "../src/device/diagnose.js";
import { diagnoseDevice, parseCrashLogcat, parseVersionName } from "../src/device/diagnose.js";
import type { PreflightResult } from "../src/env/preflight.js";
import type { DshImageAttachment } from "../src/dsh-types.js";
import {
  defineDiagnose,
  hierarchyRecommendations,
  ocrRecommendations,
  providerRecommendations,
  type HierarchyReadout,
  type OcrReadout,
  type ProviderReadout,
} from "../src/tools/diagnose.js";
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
  ocr?: OcrReadout | "throws";
  provider?: ProviderReadout | "throws";
  hierarchy?: HierarchyReadout | "throws";
}) {
  const asked: (string | undefined)[] = [];
  const saved: Buffer[] = [];
  const ocrAsked: (string | undefined)[] = [];
  const providerAsked: (string | undefined)[] = [];
  const hierarchyAsked: (string | undefined)[] = [];
  const ocrReadout = options?.ocr;
  const providerReadout = options?.provider;
  const hierarchyReadout = options?.hierarchy;
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
    ...(ocrReadout === undefined
      ? {}
      : {
          ocrStatus: async (serial: string | undefined) => {
            ocrAsked.push(serial);
            if (ocrReadout === "throws") throw new Error("ocr engine absent");
            return ocrReadout;
          },
        }),
    ...(providerReadout === undefined
      ? {}
      : {
          provider: async (serial: string | undefined) => {
            providerAsked.push(serial);
            if (providerReadout === "throws") throw new Error("provider would not spawn");
            return providerReadout;
          },
        }),
    ...(hierarchyReadout === undefined
      ? {}
      : {
          hierarchyStatus: async (serial: string | undefined) => {
            hierarchyAsked.push(serial);
            if (hierarchyReadout === "throws") throw new Error("adb did not answer the ps read");
            return hierarchyReadout;
          },
        }),
  });
  return { tool, asked, saved, ocrAsked, providerAsked, hierarchyAsked };
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

describe("diagnose: the built-in OCR is reported, never gated (T5)", () => {
  const READY: OcrReadout = { enabled: true, langs: ["eng", "chi_sim"], missingData: [], frame: { hits: 83, ms: 601 } };

  it("reports a ready engine without adding a recommendation", async () => {
    const { tool, ocrAsked } = defineWith({ ocr: READY });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(ocrAsked).toEqual([undefined]);
    expect(value.ocr_ready).toBe(true);
    expect(value.ocr).toEqual({
      enabled: true,
      langs: ["eng", "chi_sim"],
      missing_data: [],
      frame: { hits: 83, ms: 601 },
    });
    expect(value.recommendations).toEqual(["restart adb"]);
    const rendered = tool.output!.render({}, value) as { text?: string }[];
    expect(rendered[0]?.text).toContain("ocr_ready=true");
  });

  it("names the packaged language data that is missing, and keeps the report", async () => {
    const { tool } = defineWith({ ocr: { enabled: true, langs: ["eng", "chi_sim"], missingData: ["chi_sim"] } });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value.ocr_ready).toBe(false);
    const note = (value.recommendations as string[])[1];
    expect(note).toContain("chi_sim");
    expect(note).toContain("{text} targets fall back to the hierarchy alone");
  });

  it("treats a disabled engine as a choice, not a fault", async () => {
    const { tool } = defineWith({ ocr: { enabled: false, langs: ["eng"], missingData: [] } });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value.ocr_ready).toBe(false);
    expect(value.recommendations).toEqual(["restart adb"]);
  });

  it("turns a check that throws into a line of the report, not a failed diagnosis", async () => {
    const { tool } = defineWith({ ocr: "throws" });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value.adb_connected).toBe(true);
    expect(value.ocr_ready).toBe(false);
    expect((value.ocr as { error?: string }).error).toBe("ocr engine absent");
    expect((value.recommendations as string[]).join("\n")).toContain("could not be checked");
  });

  it("asks about the device the report is about", async () => {
    const { tool, ocrAsked } = defineWith({ defaultDeviceSerial: "em-default", ocr: READY });
    await tool.execute({ device_serial: "em-arg" }, exec());
    expect(ocrAsked).toEqual(["em-arg"]);
  });

  it("has nothing to say about a frame it could not capture", async () => {
    const { tool } = defineWith({ ocr: { enabled: true, langs: ["eng"], missingData: [] } });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value.ocr_ready).toBe(true);
    expect(value.ocr).not.toHaveProperty("frame");
    expect(value.recommendations).toEqual(["restart adb"]);
  });

  it("prefers the missing-data note over the error note, and both over silence", () => {
    expect(ocrRecommendations(READY)).toEqual([]);
    expect(ocrRecommendations({ enabled: true, langs: ["eng"], missingData: ["eng"], error: "boom" })).toHaveLength(1);
    expect(ocrRecommendations({ enabled: true, langs: ["eng"], missingData: [], error: "boom" })[0]).toContain("boom");
  });

  it("does not mention OCR in a render that never asked", () => {
    const { tool } = defineWith();
    const rendered = tool.output!.render({}, { device_serial: "em-1", adb_connected: true }) as { text?: string }[];
    expect(rendered[0]?.text).not.toContain("ocr_ready");
  });
});

describe("diagnose: who holds the UiAutomation slot is reported, never gated (能力重审-2)", () => {
  it("names the holder and says what it costs", async () => {
    const { tool, hierarchyAsked } = defineWith({ hierarchy: { state: "occupied", names: ["uiautomator2 server"] } });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(hierarchyAsked).toEqual([undefined]);
    expect(value.hierarchy).toEqual({ occupants: "occupied", holders: ["uiautomator2 server"] });
    const note = (value.recommendations as string[])[1];
    expect(note).toContain("uiautomator2 server");
    expect(note).toContain("`uiautomator dump` returns nothing");
    const rendered = tool.output!.render({}, value) as { text?: string }[];
    expect(rendered[0]?.text).toContain("hierarchy=occupied");
  });

  // The report is a fact even when there is nothing to fix: `free` must still be
  // answerable, but it must not manufacture advice.
  it("reports a slot it found free without adding a recommendation", async () => {
    const { tool } = defineWith({ hierarchy: { state: "free", names: [] } });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value.hierarchy).toEqual({ occupants: "free", holders: [] });
    expect(value.recommendations).toEqual(["restart adb"]);
  });

  // `unknown` is the branch that keeps the read honest: an unreadable process
  // table must never be reported as an empty one.
  it("keeps an unreadable table separate from a free slot", async () => {
    const { tool } = defineWith({ hierarchy: { state: "unknown", names: [] } });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value.hierarchy).toEqual({ occupants: "unknown", holders: [] });
    const note = (value.recommendations as string[])[1];
    expect(note).toContain("could not be read");
    expect(note).toContain("not a finding that the slot is free");
  });

  it("turns a read that throws into a line of the report, not a failed diagnosis", async () => {
    const { tool } = defineWith({ hierarchy: "throws" });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value.adb_connected).toBe(true);
    expect((value.hierarchy as { occupants?: string }).occupants).toBe("unknown");
    expect((value.hierarchy as { error?: string }).error).toBe("adb did not answer the ps read");
    expect((value.recommendations as string[]).join("\n")).toContain("adb did not answer the ps read");
  });

  it("asks about the device the report is about, and never about one it was not given", async () => {
    const { tool, hierarchyAsked } = defineWith({ defaultDeviceSerial: "em-default", hierarchy: { state: "free", names: [] } });
    await tool.execute({ device_serial: "em-arg" }, exec());
    expect(hierarchyAsked).toEqual(["em-arg"]);
  });

  it("has nothing to say about a holder it never asked about", async () => {
    const { tool } = defineWith();
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value).not.toHaveProperty("hierarchy");
    const rendered = tool.output!.render({}, value) as { text?: string }[];
    expect(rendered[0]?.text).not.toContain("hierarchy=");
  });

  it("prefers silence for a free slot over both findings", () => {
    expect(hierarchyRecommendations({ state: "free", names: [] })).toEqual([]);
    expect(hierarchyRecommendations({ state: "occupied", names: ["a", "b"] })[0]).toContain("a, b");
    expect(hierarchyRecommendations({ state: "unknown", names: [], error: "boom" })[0]).toContain("boom");
  });

  // Structural lock (能力重审-2): the diagnosis reads the preflight for its report
  // and does NOT run it as a gate. An unused `requireEnv` import used to sit here
  // and tell every reader the opposite; tsconfig has no `noUnusedLocals`, so the
  // compiler never complained and only the source shape can say this is true.
  it("is not environment-gated, and says so in its own source", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/tools/diagnose.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toContain("requireEnv");
  });
});

describe("diagnose: the optional external provider is reported, never required (T4-b)", () => {
  it("says nothing about a provider nobody configured, and asks once", async () => {
    const { tool, providerAsked } = defineWith({ provider: { configured: false } });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(providerAsked).toEqual([undefined]);
    expect(value.provider).toEqual({ configured: false });
    expect(value.recommendations).toEqual(["restart adb"]);
    const rendered = tool.output!.render({}, value) as { text?: string }[];
    expect(rendered[0]?.text).toContain("provider=not-configured");
  });

  it("reports a provider that answers, with the command it was asked to run", async () => {
    const { tool } = defineWith({
      provider: { configured: true, command: ["artemis-mcp", "--type", "adb"], reachable: true },
    });
    const value = (await tool.execute({ device_serial: "em-9" }, exec())) as Record<string, unknown>;
    expect(value.provider).toEqual({
      configured: true,
      command: ["artemis-mcp", "--type", "adb"],
      reachable: true,
    });
    expect(value.recommendations).toEqual(["restart adb"]);
    const rendered = tool.output!.render({}, value) as { text?: string }[];
    expect(rendered[0]?.text).toContain("provider=reachable");
  });

  it("names an unreachable provider and says the native path does not need it", async () => {
    const { tool } = defineWith({
      provider: { configured: true, command: ["python", "-m", "mcp_server"], reachable: false, error: "spawn ENOENT" },
    });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value.provider).toMatchObject({ reachable: false, error: "spawn ENOENT" });
    const note = (value.recommendations as string[])[1];
    expect(note).toContain("`python -m mcp_server`");
    expect(note).toContain("spawn ENOENT");
    expect(note).toContain("does not need it");
    expect(value.adb_connected, "the device report is unaffected").toBe(true);
  });

  it("a provider check that throws is still only a line in the report", async () => {
    const { tool } = defineWith({ provider: "throws" });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value.adb_connected).toBe(true);
    expect((value.provider as { error?: string }).error).toBe("provider would not spawn");
    expect((value.recommendations as string[]).join("\n")).toContain("did not answer");
  });

  it("recommends nothing for a reachable or unconfigured provider, and something for the rest", () => {
    expect(providerRecommendations({ configured: false })).toEqual([]);
    expect(providerRecommendations({ configured: true, reachable: true })).toEqual([]);
    expect(providerRecommendations({ configured: true, reachable: false, error: "x" })[0]).toContain("x");
    // `reachable` undefined means the check never got an answer either way.
    expect(providerRecommendations({ configured: true })).toHaveLength(1);
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
