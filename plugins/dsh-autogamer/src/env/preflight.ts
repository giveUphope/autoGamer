/**
 * Environment preflight for the external ARTEMIS provider (Phase 1).
 *
 * Seven checks, straight from the scheme (§6): uv, Python ≥ 3.12, the provider
 * repo path, the provider install, adb, an attached device, and the Helper.
 * Two deliberate deviations from the scheme text, both because the scheme's
 * exact commands do not exist:
 * - Helper is probed through the `artemis` binary on PATH (what `uv tool
 *   install` exposes), not `uv run artemis …` — bare `uv run` executes in the
 *   caller's directory, not the provider repo, so the scheme's command probes
 *   the wrong environment.
 * - No schemastery `.description()` calls anywhere: that builder form is
 *   unverified on the installed schemastery, and the settings auto-form works
 *   without descriptions.
 *
 * The runner never rejects (every check catches) and never spawns a visible
 * console on Windows (`windowsHide`). Results cache for 60 seconds so repeated
 * tool calls in one turn do not re-probe.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface PreflightInput {
  uvPath: string;
  artemisRepoPath: string;
}

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
  exists(path: string): boolean;
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
  exists: (path) => existsSync(path),
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

function parsePythonVersion(output: string): [number, number] | undefined {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2])];
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
  run(input: PreflightInput): Promise<PreflightResult>;
}

export function createPreflight(deps?: Partial<PreflightDeps>): PreflightRunner {
  const d: PreflightDeps = { ...defaultDeps, ...deps };
  let cached: { at: number; result: PreflightResult } | undefined;

  async function uvCheck(input: PreflightInput): Promise<PreflightCheck> {
    const result = await d.run([input.uvPath, "--version"]);
    if (result.code !== 0) {
      return fail(
        "uv",
        missingBinary(result)
          ? `no ${input.uvPath} binary (${result.errorMessage})`
          : `exit ${result.code}: ${head(result.stderr)}`,
        "Install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh` (Windows: `irm https://astral.sh/uv/install.ps1 | iex`)",
      );
    }
    return pass("uv", head(result.stdout));
  }

  async function pythonCheck(): Promise<PreflightCheck> {
    let result = await d.run(["python3", "--version"]);
    let binary = "python3";
    if (result.code !== 0 && missingBinary(result)) {
      result = await d.run(["python", "--version"]);
      binary = "python";
    }
    if (result.code !== 0) {
      return fail(
        "python",
        missingBinary(result) ? "no python3/python binary" : `exit ${result.code}: ${head(result.stderr)}`,
        "Install Python 3.12+ and put it on PATH",
      );
    }
    const version = parsePythonVersion(`${result.stdout}\n${result.stderr}`);
    if (!version) {
      return fail("python", `unparseable version output from ${binary}`, "Install Python 3.12+ and put it on PATH");
    }
    if (version[0] < 3 || (version[0] === 3 && version[1] < 12)) {
      return fail(
        "python",
        `${binary} is ${version[0]}.${version[1]}, need 3.12+`,
        "Install Python 3.12+ and put it on PATH",
      );
    }
    return pass("python", `${binary} ${version[0]}.${version[1]}`);
  }

  async function repoCheck(input: PreflightInput): Promise<PreflightCheck> {
    if (input.artemisRepoPath.trim().length === 0) {
      return fail("artemis-repo", "artemisRepoPath is not configured", "Set artemisRepoPath to the cloned ARTEMIS repository");
    }
    const manifest = join(input.artemisRepoPath, "pyproject.toml");
    if (!d.exists(manifest)) {
      return fail(
        "artemis-repo",
        `no pyproject.toml under ${input.artemisRepoPath}`,
        "Set artemisRepoPath to the cloned ARTEMIS repository",
      );
    }
    return pass("artemis-repo", input.artemisRepoPath);
  }

  async function installedCheck(input: PreflightInput): Promise<PreflightCheck> {
    const result = await d.run([input.uvPath, "tool", "list"], { timeoutMs: 30_000 });
    if (result.code !== 0) {
      return fail(
        "artemis-installed",
        missingBinary(result) ? `no ${input.uvPath} binary` : `exit ${result.code}: ${head(result.stderr)}`,
        `Install ARTEMIS: \`uv tool install -e ${input.artemisRepoPath || "<artemis-repo-path>"}\``,
      );
    }
    if (!/\bartemis\b/i.test(result.stdout)) {
      return fail(
        "artemis-installed",
        "`uv tool list` names no artemis install",
        `Install ARTEMIS: \`uv tool install -e ${input.artemisRepoPath || "<artemis-repo-path>"}\``,
      );
    }
    return pass("artemis-installed", head(result.stdout));
  }

  async function adbCheck(): Promise<PreflightCheck> {
    const result = await d.run(["adb", "version"]);
    if (result.code !== 0) {
      return fail(
        "adb",
        missingBinary(result) ? "no adb binary" : `exit ${result.code}: ${head(result.stderr)}`,
        "Install Android SDK Platform Tools and put adb on PATH",
      );
    }
    return pass("adb", head(result.stdout));
  }

  async function devicesCheck(): Promise<PreflightCheck> {
    const result = await d.run(["adb", "devices"]);
    if (result.code !== 0) {
      return fail(
        "adb-devices",
        missingBinary(result) ? "no adb binary" : `exit ${result.code}: ${head(result.stderr)}`,
        "Install Android SDK Platform Tools and put adb on PATH",
      );
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

  async function helperCheck(): Promise<PreflightCheck> {
    const result = await d.run(["artemis", "helper", "status"]);
    if (result.code !== 0) {
      return fail(
        "helper",
        missingBinary(result)
          ? "no artemis binary on PATH"
          : `exit ${result.code}: ${head(result.stdout)} ${head(result.stderr)}`.trim(),
        "Install ARTEMIS (`uv tool install -e <artemis-repo-path>`), then `artemis helper install`",
      );
    }
    return pass("helper", head(result.stdout));
  }

  return {
    async run(input: PreflightInput): Promise<PreflightResult> {
      const at = d.now();
      if (cached && at - cached.at < PREFLIGHT_CACHE_MS) return cached.result;
      const checks = [
        await uvCheck(input),
        await pythonCheck(),
        await repoCheck(input),
        await installedCheck(input),
        await adbCheck(),
        await devicesCheck(),
        await helperCheck(),
      ];
      const result: PreflightResult = {
        ok: checks.every((check) => check.ok),
        checks,
        finishedAt: new Date(at).toISOString(),
      };
      cached = { at, result };
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
