/**
 * Preflight unit locks (T4-a). The gate asks two questions and nothing else:
 * is there an `adb`, and is a device attached to it.
 *
 * It used to ask seven (uv, python, the provider repo, the provider install,
 * adb, devices, helper) because every answer came from an external python
 * provider. Since T2 nothing does: the device surface, the hierarchy, the
 * frames, the effect verdict and the diagnosis are answered over adb, and the
 * OCR runs inside the package. Those five checks are **gone rather than
 * skipped** — a gate that "skips" still leaves `ok` meaning something different
 * per caller, and refusing a native hierarchy read because `uv` is missing is
 * the preflight lying about what the tool touches. (The G77 two-form install
 * probe and the G79 `--serial` rule died with the checks that needed them.)
 *
 * The runner takes injected process/clock doubles, so no test here spawns
 * anything: subprocess behaviour is asserted through scripted `run` answers and
 * the cache through a manual clock.
 */
import { describe, expect, it } from "vitest";
import {
  createPreflight,
  PREFLIGHT_CACHE_MS,
  PREFLIGHT_CHECK_IDS,
  preflightErrorText,
  type ExecResult,
  type PreflightDeps,
} from "../src/env/preflight.js";

const ADB_VERSION = { code: 0, stdout: "Android Debug Bridge version 1.0.41" };
const ONE_DEVICE = { code: 0, stdout: "List of devices attached\nemulator-5554\tdevice\n" };

function scripted(
  answers: Record<string, Partial<ExecResult>>,
  options?: { now?: number },
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
      now: () => now,
    },
  };
}

function healthy(): Record<string, Partial<ExecResult>> {
  return { "adb version": ADB_VERSION, "adb devices": ONE_DEVICE };
}

function failedId(result: { checks: { id: string; ok: boolean }[] }): string[] {
  return result.checks.filter((check) => !check.ok).map((check) => check.id);
}

function asked(calls: string[][]): string[] {
  return calls.map((command) => command.join(" "));
}

describe("preflight: the two questions every tool actually asks", () => {
  it("passes a healthy device environment, and asks nothing else", async () => {
    const { deps, calls } = scripted(healthy());
    const result = await createPreflight(deps).run();
    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.id)).toEqual([...PREFLIGHT_CHECK_IDS]);
    expect(result.checks.map((check) => check.ok)).toEqual([true, true]);
    expect(result.finishedAt).toBe(new Date(1_000_000).toISOString());
    // The whole vocabulary of the gate: a reintroduced provider probe shows up
    // here as a third command, which is exactly what this line locks out.
    expect(asked(calls)).toEqual(["adb version", "adb devices"]);
  });

  it("a missing adb fails both checks and the fix names platform tools", async () => {
    const gone = { code: 1, errorMessage: "ENOENT: no such file or directory, 'adb'" };
    const { deps } = scripted({ "adb version": gone, "adb devices": gone });
    const result = await createPreflight(deps).run();
    expect(failedId(result)).toEqual(["adb", "adb-devices"]);
    expect(result.checks[0]?.detail).toBe("no adb binary");
    expect(preflightErrorText(result)).toMatch(
      /^environment: preflight failed at adb \(no adb binary\)\. Fix: .*Platform Tools/,
    );
  });

  it("an adb with nothing attached fails only the device check", async () => {
    const { deps } = scripted({
      "adb version": ADB_VERSION,
      "adb devices": { code: 0, stdout: "List of devices attached\n" },
    });
    const result = await createPreflight(deps).run();
    expect(failedId(result)).toEqual(["adb-devices"]);
    expect(preflightErrorText(result)).toContain("no attached device");
    expect(result.checks[1]?.fix).toContain("adb devices");
  });

  it("counts only `device` lines, so offline/unauthorized noise is not a fleet", async () => {
    const { deps } = scripted({
      "adb version": ADB_VERSION,
      "adb devices": {
        code: 0,
        stdout: "List of devices attached\nemulator-5554\toffline\n1c1a0e05\tunauthorized\n",
      },
    });
    const result = await createPreflight(deps).run();
    expect(failedId(result)).toEqual(["adb-devices"]);
  });

  it("names every ready serial when the fleet is more than one device", async () => {
    const { deps } = scripted({
      "adb version": ADB_VERSION,
      "adb devices": {
        code: 0,
        stdout: "List of devices attached\nemulator-5554\tdevice\n1c1a0e05\tdevice\n",
      },
    });
    const result = await createPreflight(deps).run();
    expect(result.ok).toBe(true);
    expect(result.checks[1]?.detail).toBe("emulator-5554, 1c1a0e05");
  });

  it("carries adb's own refusal line when the daemon will not answer", async () => {
    const { deps } = scripted({
      "adb version": ADB_VERSION,
      "adb devices": { code: 1, stderr: "adb: cannot connect to daemon" },
    });
    const result = await createPreflight(deps).run();
    expect(result.checks[1]?.detail).toContain("cannot connect to daemon");
  });
});

describe("preflight: the cache", () => {
  it("reuses the first result within the window and re-probes after it", async () => {
    const { calls, setNow, deps } = scripted(healthy());
    const runner = createPreflight(deps);
    expect((await runner.run()).ok).toBe(true);
    expect(calls).toHaveLength(2);
    await runner.run();
    expect(calls).toHaveLength(2);
    setNow(1_000_000 + PREFLIGHT_CACHE_MS + 1);
    await runner.run();
    expect(calls).toHaveLength(4);
  });
});
