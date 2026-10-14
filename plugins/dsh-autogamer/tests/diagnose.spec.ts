/**
 * `autogamer_diagnose` unit locks (Phase 2). The merge of provider report and
 * local preflight is the whole point: a broken environment is REPORTED (with
 * its fixes appended), not thrown — only a dead provider on top of a broken
 * environment throws, and then the preflight text wins.
 */
import { describe, expect, it } from "vitest";
import type { ArtemisBackend, Diagnosis } from "../src/artemis/types.js";
import type { PreflightResult } from "../src/env/preflight.js";
import { defineDiagnose } from "../src/tools/diagnose.js";
import type { RulesInjectionOutcome } from "../src/prompt/rulesInjector.js";

const HEALTHY: PreflightResult = { ok: true, checks: [], finishedAt: "t" };
const BROKEN: PreflightResult = {
  ok: false,
  checks: [{ id: "adb-devices", ok: false, detail: "none attached", fix: "plug it in" }],
  finishedAt: "t",
};

const REPORT: Diagnosis = {
  deviceSerial: "em-1",
  adbConnected: true,
  helperInstalled: true,
  helperVersion: "v3",
  recentCrashes: [{ package: "com.x", timestamp: "t", stackExcerpt: "boom" }],
  recommendations: ["restart adb"],
};

function defineWith(options?: {
  report?: Diagnosis;
  env?: PreflightResult;
  failBackend?: Error;
  rulesStatus?: RulesInjectionOutcome;
}): {
  tool: ReturnType<typeof defineDiagnose>;
  serials: (string | undefined)[];
} {
  const serials: (string | undefined)[] = [];
  const backend: ArtemisBackend = {
    getDeviceState: async () => ({ deviceSerial: "", connected: false }),
    diagnose: async (args) => {
      serials.push(args.deviceSerial);
      if (options?.failBackend) throw options.failBackend;
      return options?.report ?? REPORT;
    },
    dispose: async () => undefined,
  };
  const tool = defineDiagnose({
    backend,
    checkEnv: async () => options?.env ?? HEALTHY,
    defaultDeviceSerial: "",
    rulesStatus: () => options?.rulesStatus ?? "injected",
    artemisRepoPath: "/repo",
  });
  return { tool, serials };
}

function exec(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

describe("diagnose: the merge", () => {
  it("passes the provider report through on a healthy environment", async () => {
    const { tool, serials } = defineWith();
    const value = (await tool.execute({ device_serial: "em-1" }, exec())) as Record<string, unknown>;
    expect(serials).toEqual(["em-1"]);
    expect(value).toMatchObject({
      device_serial: "em-1",
      adb_connected: true,
      helper_installed: true,
      helper_version: "v3",
      recommendations: ["restart adb"],
    });
    expect((value.recent_crashes as { package?: string }[])[0]?.package).toBe("com.x");
  });

  it("surfaces a missing provider rules file instead of skipping it silently (G80)", async () => {
    const { tool } = defineWith({ rulesStatus: "missing-file" });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    const recos = value.recommendations as string[];
    const warning = recos.find((entry) => entry.includes("rules are NOT in the model's context"));
    expect(warning).toBeDefined();
    expect(warning).toContain("reason: missing-file");
    expect(warning).toContain("mcp_server/rules.md");
    // the provider's own recommendation must survive the append
    expect(recos).toContain("restart adb");
  });

  it("stays quiet when the operator turned rules injection off on purpose", async () => {
    const { tool } = defineWith({ rulesStatus: "disabled" });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect((value.recommendations as string[]).some((entry) => entry.includes("rules are NOT"))).toBe(false);
  });

  it("appends local preflight fixes instead of throwing on a broken environment", async () => {
    const { tool } = defineWith({ env: BROKEN });
    const value = (await tool.execute({}, exec())) as { recommendations: string[] };
    expect(value.recommendations).toEqual(["restart adb", "plug it in"]);
  });

  it("does not duplicate a fix both sides already name", async () => {
    const { tool } = defineWith({
      env: BROKEN,
      report: { ...REPORT, recommendations: ["plug it in"] },
    });
    const value = (await tool.execute({}, exec())) as { recommendations: string[] };
    expect(value.recommendations).toEqual(["plug it in"]);
  });

  it("a dead provider over a broken environment throws the preflight text", async () => {
    const { tool } = defineWith({ env: BROKEN, failBackend: new Error("environment: gone") });
    await expect(tool.execute({}, exec())).rejects.toThrow(/preflight failed at adb-devices/);
  });

  it("a dead provider over a healthy environment rethrows the transport error", async () => {
    const { tool } = defineWith({ failBackend: new Error("environment: gone") });
    await expect(tool.execute({}, exec())).rejects.toThrow(/^environment: gone/);
  });
});
