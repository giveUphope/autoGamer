/**
 * Environment preflight (T4-a): the two facts every tool of this plugin actually
 * depends on - an `adb` on PATH, and a device attached to it.
 *
 * This used to be seven checks (uv, python, the provider repo, the provider
 * install, adb, devices, helper) because the plugin answered everything through
 * an external python provider. Since T2 that is not true of any tool: the device
 * surface, the hierarchy, the frames, the effect verdict and the diagnosis are
 * all answered over adb, and OCR runs inside the package. A check that refuses a
 * working native tool because `uv` is not installed is the preflight lying about
 * what the tool touches, so those five checks are gone rather than "skipped" -
 * skipped would still leave `ok` meaning something different per scope.
 *
 * The runner never rejects (every check catches) and never spawns a visible
 * console on Windows (`windowsHide`). Results cache for 60 seconds so repeated
 * tool calls in one turn do not re-probe.
 */
import { execFile } from "node:child_process";

export interface ExecResult {
  /** Process exit code, or 1 when the process never started. */
  code: number;
  stdout: string;
  stderr: string;
  /** Spawn-level detail (e.g. ENOENT) when the process never started. */
  errorMessage?: string;
}

export interface PreflightDeps {
  run(command: string[], options?: { timeoutMs?: number }): Promise<ExecResult>;
  now(): number;
}

export interface PreflightCheck {
  id: string;
  ok: boolean;
  detail?: string;
  fix?: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
  finishedAt: string;
}

export const PREFLIGHT_CACHE_MS = 60_000;

/** The gate's whole vocabulary. `contracts.spec` locks this list. */
export const PREFLIGHT_CHECK_IDS = ["adb", "adb-devices"] as const;

const ADB_FIX = "Install Android SDK Platform Tools and put adb on PATH";

function defaultRun(command: string[], options?: { timeoutMs?: number }): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      command[0] ?? "",
      command.slice(1),
      { timeout: options?.timeoutMs ?? 15_000, windowsHide: true },
      (error, stdout, stderr) => {
        const out = String(stdout ?? "");
        const err = String(stderr ?? "");
        if (!error) {
          resolve({ code: 0, stdout: out, stderr: err });
          return;
        }
        const errno = (error as NodeJS.ErrnoException).code;
        resolve({
          code: typeof errno === "number" ? errno : 1,
          stdout: out,
          stderr: err,
          errorMessage: typeof errno === "string" ? `${errno}: ${error.message}` : error.message,
        });
      },
    );
  });
}

const defaultDeps: PreflightDeps = {
  run: defaultRun,
  now: () => Date.now(),
};

function fail(id: string, detail: string, fix: string): PreflightCheck {
  return { id, ok: false, detail, fix };
}

function pass(id: string, detail?: string): PreflightCheck {
  return { id, ok: true, detail };
}

function missingBinary(result: ExecResult): boolean {
  return /ENOENT/i.test(result.errorMessage ?? "");
}

function parseAdbDevices(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\S+\s+device$/.test(line))
    .map((line) => line.split(/\s+/)[0] as string);
}

/** First line of output, for compact details. */
function head(text: string): string {
  return text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
}

export interface PreflightRunner {
  run(): Promise<PreflightResult>;
}

export function createPreflight(deps?: Partial<PreflightDeps>): PreflightRunner {
  const d: PreflightDeps = { ...defaultDeps, ...deps };
  let cache: { at: number; result: PreflightResult } | undefined;

  async function adbCheck(): Promise<PreflightCheck> {
    const result = await d.run(["adb", "version"]);
    if (result.code !== 0) {
      return fail(
        "adb",
        missingBinary(result) ? "no adb binary" : `exit ${result.code}: ${head(result.stderr)}`,
        ADB_FIX,
      );
    }
    return pass("adb", head(result.stdout));
  }

  async function devicesCheck(): Promise<PreflightCheck> {
    const result = await d.run(["adb", "devices"]);
    if (result.code !== 0) {
      return fail("adb-devices", missingBinary(result) ? "no adb binary" : `exit ${result.code}: ${head(result.stderr)}`, ADB_FIX);
    }
    const serials = parseAdbDevices(result.stdout);
    if (serials.length === 0) {
      return fail(
        "adb-devices",
        "no attached device in `adb devices`",
        "Connect a phone or start an emulator, then `adb devices` must list it as `device`",
      );
    }
    return pass("adb-devices", serials.join(", "));
  }

  return {
    async run() {
      const at = d.now();
      if (cache !== undefined && at - cache.at < PREFLIGHT_CACHE_MS) return cache.result;
      const checks = [await adbCheck(), await devicesCheck()];
      const result: PreflightResult = {
        ok: checks.every((check) => check.ok),
        checks,
        finishedAt: new Date(at).toISOString(),
      };
      cache = { at, result };
      return result;
    },
  };
}

/** Single-line gate message for tool execute paths: reason plus the fix. */
export function preflightErrorText(result: PreflightResult): string {
  const first = result.checks.find((check) => !check.ok);
  if (!first) return "environment: preflight reports failure with no failing check (plugin bug; do not retry)";
  return `environment: preflight failed at ${first.id} (${first.detail ?? "no detail"}). Fix: ${first.fix ?? "see the plugin README"}`;
}
