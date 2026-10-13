/**
 * Preflight unit locks (Phase 1). The runner takes injected process/fs/clock
 * doubles, so no test here spawns anything: subprocess behaviour is asserted
 * through scripted `run` answers, and the 60s cache through a manual clock.
 */
import { describe, expect, it } from "vitest";
import {
  createPreflight,
  preflightErrorText,
  type ExecResult,
  type PreflightDeps,
} from "../src/env/preflight.js";

const INPUT = { uvPath: "uv", artemisRepoPath: "/repo" };

function scripted(
  answers: Record<string, Partial<ExecResult>>,
  options?: { exists?: (path: string) => boolean; now?: number },
): { calls: string[][]; setNow: (value: number) => void; deps: PreflightDeps } {
  const calls: string[][] = [];
  let now = options?.now ?? 1_000_000;
  return {
    calls,
    setNow: (value: number) => {
      now = value;
    },
    deps: {
      run: async (command: string[]) => {
        calls.push(command);
        const hit = answers[command.join(" ")] ?? answers[command[0] as string] ?? { code: 0 };
        return {
          code: hit.code ?? 0,
          stdout: hit.stdout ?? "",
          stderr: hit.stderr ?? "",
          ...(hit.errorMessage ? { errorMessage: hit.errorMessage } : {}),
        };
      },
      exists: options?.exists ?? (() => true),
      now: () => now,
    },
  };
}

function healthy(): Record<string, Partial<ExecResult>> {
  return {
    "uv --version": { code: 0, stdout: "uv 0.8.0" },
    "python3 --version": { code: 0, stdout: "Python 3.13.2" },
    "uv tool list": { code: 0, stdout: "artemis v1.0\nsometool v2" },
    "adb version": { code: 0, stdout: "Android Debug Bridge version 1.0.41" },
    "adb devices": { code: 0, stdout: "List of devices attached\nemulator-5554\tdevice\n" },
    "artemis helper status": { code: 0, stdout: "helper: installed (v3)" },
  };
}

function failedId(result: { ok: boolean; checks: { id: string; ok: boolean }[] }): string[] {
  return result.checks.filter((check) => !check.ok).map((check) => check.id);
}

describe("preflight: the seven checks", () => {
  it("passes a healthy environment with all seven checks", async () => {
    const { deps } = scripted(healthy());
    const result = await createPreflight(deps).run(INPUT);
    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.id)).toEqual([
      "uv",
      "python",
      "artemis-repo",
      "artemis-installed",
      "adb",
      "adb-devices",
      "helper",
    ]);
    expect(result.finishedAt).toBe(new Date(1_000_000).toISOString());
  });

  it("a missing uv binary fails with the install fix", async () => {
    const { deps } = scripted({
      ...healthy(),
      "uv --version": { code: 1, errorMessage: "ENOENT: spawn uv ENOENT" },
    });
    const result = await createPreflight(deps).run(INPUT);
    expect(result.ok).toBe(false);
    expect(failedId(result)).toContain("uv");
    expect(preflightErrorText(result)).toMatch(/^environment: preflight failed at uv/);
    expect(preflightErrorText(result)).toContain("astral.sh/uv");
  });

  it("falls back from python3 to python, and fails only when both are gone", async () => {
    const first = scripted({
      ...healthy(),
      "python3 --version": { code: 1, errorMessage: "ENOENT: spawn python3 ENOENT" },
      python: { code: 0, stdout: "Python 3.12.8" },
    });
    const ok = await createPreflight(first.deps).run(INPUT);
    expect(ok.ok).toBe(true);
    expect(first.calls.map((call) => call[0])).toContain("python");

    const second = scripted({
      ...healthy(),
      "python3 --version": { code: 1, errorMessage: "ENOENT: spawn python3 ENOENT" },
      python: { code: 1, errorMessage: "ENOENT: spawn python ENOENT" },
    });
    const bad = await createPreflight(second.deps).run(INPUT);
    expect(failedId(bad)).toContain("python");
  });

  it("refuses Python below 3.12 and unparseable version output", async () => {
    const old = scripted({ ...healthy(), "python3 --version": { code: 0, stdout: "Python 3.11.9" } });
    expect(failedId(await createPreflight(old.deps).run(INPUT))).toContain("python");
    const weird = scripted({ ...healthy(), "python3 --version": { code: 0, stdout: "no version here" } });
    expect(failedId(await createPreflight(weird.deps).run(INPUT))).toContain("python");
  });

  it("fails the repo check on an empty path or a missing manifest", async () => {
    const { deps } = scripted(healthy());
    const empty = await createPreflight(deps).run({ uvPath: "uv", artemisRepoPath: "  " });
    expect(failedId(empty)).toContain("artemis-repo");
    const missing = scripted(healthy(), { exists: () => false });
    const gone = await createPreflight(missing.deps).run(INPUT);
    expect(failedId(gone)).toContain("artemis-repo");
  });

  it("fails the install check when uv tool list names no artemis", async () => {
    const { deps } = scripted({ ...healthy(), "uv tool list": { code: 0, stdout: "sometool v2" } });
    const result = await createPreflight(deps).run(INPUT);
    expect(failedId(result)).toEqual(["artemis-installed"]);
    expect(preflightErrorText(result)).toContain("uv tool install -e");
  });

  it("counts only `device` lines, so offline/emulator noise is not a fleet", async () => {
    const { deps } = scripted({
      ...healthy(),
      "adb devices": { code: 0, stdout: "List of devices attached\nemulator-5554\toffline\n" },
    });
    const result = await createPreflight(deps).run(INPUT);
    expect(failedId(result)).toEqual(["adb-devices"]);
  });

  it("fails the helper check with its own fix, not the adb one", async () => {
    const { deps } = scripted({
      ...healthy(),
      "artemis helper status": { code: 1, stdout: "", stderr: "helper apk missing" },
    });
    const result = await createPreflight(deps).run(INPUT);
    expect(failedId(result)).toEqual(["helper"]);
    expect(preflightErrorText(result)).toContain("artemis helper install");
  });
});

describe("preflight: the 60s cache", () => {
  it("reuses the first result within the window and re-probes after it", async () => {
    const { calls, setNow, deps } = scripted(healthy());
    const runner = createPreflight(deps);
    const first = await runner.run(INPUT);
    expect(first.ok).toBe(true);
    expect(calls).toHaveLength(6);
    await runner.run(INPUT);
    expect(calls).toHaveLength(6);
    setNow(1_000_000 + 60_001);
    await runner.run(INPUT);
    expect(calls).toHaveLength(12);
  });
});
