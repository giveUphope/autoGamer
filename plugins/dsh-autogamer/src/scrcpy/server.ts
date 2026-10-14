/**
 * scrcpy server lifecycle for the device mirror (Phase 4, Host side only).
 *
 * Every device-side fact below comes from scrcpy's own developer doc
 * (Genymobile/scrcpy `doc/develop.md`, first-hand, fetched 2026-10-14):
 * - push the jar to `/data/local/tmp/scrcpy-server.jar`, forward
 *   `tcp:{port}` to `localabstract:scrcpy`, then launch with
 *   `CLASSPATH=… app_process / com.genymobile.scrcpy.Server {version}`
 *   followed by `key=value` options (order irrelevant);
 * - argv[0] MUST equal the server version exactly — no backward/forward
 *   compat, mismatch refuses to run. Unknown version therefore refuses
 *   instead of guessing;
 * - verified option keys used here: `tunnel_forward`, `audio`, `control`,
 *   `cleanup`, `raw_stream`, `max_size`, `max_fps`, `video_bit_rate`;
 * - the standalone raw recipe this mirrors disables audio/control/cleanup
 *   and streams raw H.264 (`raw_stream=true`).
 *
 * Deliberate non-goals (all Phase-0 verdicts, not gaps):
 * - NO H.264 forwarding: DSH has no binary host→browser channel (Remote
 *   streams and events are JSON-only), so there is no consumer for the video
 *   socket. `stream.ts` does not exist on purpose.
 * - NO auto-download: no distribution endpoint is wired (manual install from
 *   the only official source, with signature verification, is documented in
 *   the README). Resolution searches an explicit path, then the scrcpy
 *   binary's sidecar jar.
 * - The stop path's `pkill` is best-effort and warn-only: no kill method is
 *   documented upstream. Residual-process freedom stays live-deferred.
 * - Touch injection travels the spec's downgrade route (`adb shell input …`,
 *   see `input.ts`), not the control socket — there is no socket consumer.
 *
 * The manager is lazy: constructing it never spawns anything; only start()
 * touches the machine, and dispose() on an idle manager is a no-op.
 */
import { spawn, execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import type { ExecResult } from "../env/preflight.js";

export const SCRCPY_DEVICE_JAR = "/data/local/tmp/scrcpy-server.jar";
export const SCRCPY_DEFAULT_PORT = 27183;

export interface ScrcpyDeps {
  run(command: string[], options?: { timeoutMs?: number }): Promise<ExecResult>;
  spawnDetached(command: string[]): void;
  exists(path: string): boolean;
  listDir(path: string): string[];
  /** Resolve a binary through PATH (PATHEXT-aware on Windows). */
  which(binary: string): string | undefined;
}

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

function defaultWhich(binary: string): string | undefined {
  const pathValue = process.env.PATH ?? "";
  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE").split(";") : [""];
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, binary + extension.toLowerCase());
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const defaultDeps: ScrcpyDeps = {
  run: defaultRun,
  spawnDetached: (command) => {
    const child = spawn(command[0] ?? "", command.slice(1), {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  },
  exists: (path) => existsSync(path),
  listDir: (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  which: defaultWhich,
};

export interface ScrcpyResolution {
  jarPath: string;
  /** Exact server version (argv[0]); always present — unknown refuses. */
  version: string;
  source: "explicit" | "sidecar";
}

function versionFromJarName(name: string): string | undefined {
  return /scrcpy-server-v?(\d+\.\d+(?:\.\d+)?)/i.exec(name)?.[1];
}

function versionFromBinaryOutput(output: string): string | undefined {
  return /scrcpy\s+(\d+\.\d+(?:\.\d+)?)/i.exec(output)?.[1];
}

export interface MirrorOptions {
  maxWidth: number;
  maxFps: number;
  bitrateMbps: number;
  port?: number;
}

/** `adb push <jar> /data/local/tmp/scrcpy-server.jar` (+ optional `-s`). */
export function buildPushArgs(jarPath: string, serial?: string): string[] {
  return [...serialPrefix(serial), "push", jarPath, SCRCPY_DEVICE_JAR];
}

/** `adb forward tcp:{port} localabstract:scrcpy` (+ optional `-s`). */
export function buildForwardArgs(port: number, serial?: string): string[] {
  return [...serialPrefix(serial), "forward", `tcp:${port}`, "localabstract:scrcpy"];
}

/**
 * The documented launch argv (develop.md "Execution"): CLASSPATH shell form
 * plus the exact-match version and the raw-stream option set.
 */
export function buildLaunchArgs(jarVersion: string, options: MirrorOptions): string[] {
  return [
    "shell",
    `CLASSPATH=${SCRCPY_DEVICE_JAR}`,
    "app_process",
    "/",
    "com.genymobile.scrcpy.Server",
    jarVersion,
    "tunnel_forward=true",
    "audio=false",
    "control=false",
    "cleanup=false",
    "raw_stream=true",
    `max_size=${options.maxWidth}`,
    `max_fps=${options.maxFps}`,
    `video_bit_rate=${Math.round(options.bitrateMbps * 1_000_000)}`,
  ];
}

/** `adb forward --remove tcp:{port}` (+ optional `-s`). */
export function buildUnforwardArgs(port: number, serial?: string): string[] {
  return [...serialPrefix(serial), "forward", "--remove", `tcp:${port}`];
}

function serialPrefix(serial?: string): string[] {
  return serial ? ["-s", serial] : [];
}

export interface ScrcpyManagerOptions extends MirrorOptions {
  adbPath?: string;
  serial?: string;
  /** Explicit jar path (Config scrcpyServerPath); sidecar search otherwise. */
  serverPath?: string;
}

export interface MirrorHandle {
  port: number;
  version: string;
}

const INSTALL_HINT =
  "Install scrcpy from the only official source (github.com/Genymobile/scrcpy, verify release signatures) " +
  "and put `scrcpy` on PATH, or set the plugin scrcpyServerPath to the release's scrcpy-server jar";

export class ScrcpyManager {
  private handle?: MirrorHandle;

  constructor(
    private readonly options: ScrcpyManagerOptions,
    private readonly deps: ScrcpyDeps = defaultDeps,
  ) {}

  /**
   * Locate a server jar and prove its exact version. Refuses (rather than
   * launching a mismatched server, which the server itself would reject)
   * when no versioned jar is found.
   */
  async resolve(explicitPath?: string): Promise<ScrcpyResolution> {
    const configured = explicitPath ?? this.options.serverPath;
    if (configured && configured.length > 0) {
      if (!this.deps.exists(configured)) {
        throw new Error(`environment: scrcpy server not found at ${configured}. Fix: ${INSTALL_HINT}`);
      }
      const version = versionFromJarName(configured);
      if (version === undefined) {
        throw new Error(
          `environment: cannot read the server version from ${configured} (need scrcpy-server-vX.Y in the name; exact match is mandatory). Fix: ${INSTALL_HINT}`,
        );
      }
      return { jarPath: configured, version, source: "explicit" };
    }
    const binary = this.deps.which("scrcpy");
    if (binary !== undefined) {
      const dir = dirname(binary);
      const jars = this.deps
        .listDir(dir)
        .filter((name) => /^scrcpy-server.*\.jar$/i.test(name))
        .sort()
        .reverse();
      for (const name of jars) {
        const version = versionFromJarName(name);
        if (version !== undefined) return { jarPath: join(dir, name), version, source: "sidecar" };
      }
      // A jar without a versioned name: fall back to the sibling binary's
      // own version rather than guessing (exact match is mandatory).
      if (jars.length > 0) {
        const probed = await this.deps.run([binary, "--version"]);
        if (probed.code === 0) {
          const version = versionFromBinaryOutput(`${probed.stdout}\n${probed.stderr}`);
          if (version !== undefined) {
            return { jarPath: join(dir, jars[0] as string), version, source: "sidecar" };
          }
        }
      }
    }
    throw new Error(`environment: no scrcpy server jar found. Fix: ${INSTALL_HINT}`);
  }

  /** Push, forward, and launch; records the handle for stop()/dispose(). */
  async start(): Promise<MirrorHandle> {
    if (this.handle) return this.handle;
    const adb = this.options.adbPath ?? "adb";
    const port = this.options.port ?? SCRCPY_DEFAULT_PORT;
    const { jarPath, version } = await this.resolve();
    const push = await this.deps.run([adb, ...buildPushArgs(jarPath, this.options.serial)]);
    if (push.code !== 0) {
      throw new Error(`environment: adb push of the scrcpy server failed (exit ${push.code}). Fix: check the device connection`);
    }
    const forward = await this.deps.run([adb, ...buildForwardArgs(port, this.options.serial)]);
    if (forward.code !== 0) {
      throw new Error(`environment: adb forward for the scrcpy tunnel failed (exit ${forward.code}). Fix: check the device connection`);
    }
    // The shell blocks while the server runs, so it launches detached; the
    // forward/handshake race this opens is documented, not solved — solving
    // it needs a live device (see the module header).
    this.deps.spawnDetached([adb, ...serialPrefix(this.options.serial), ...buildLaunchArgs(version, { ...this.options, port })]);
    this.handle = { port, version };
    return this.handle;
  }

  /** Best-effort teardown: remove the forward, then try to kill the server. */
  async stop(logger?: (message: string) => void): Promise<void> {
    const handle = this.handle;
    this.handle = undefined;
    if (!handle) return;
    const adb = this.options.adbPath ?? "adb";
    const unforward = await this.deps.run([adb, ...buildUnforwardArgs(handle.port, this.options.serial)]);
    if (unforward.code !== 0) {
      logger?.(`[mirror] forward --remove failed (exit ${unforward.code}); continuing to the kill step`);
    }
    // No kill method is documented upstream; pkill by the documented main
    // class is the best available guess and stays warn-only because of it.
    const kill = await this.deps.run([
      adb,
      ...serialPrefix(this.options.serial),
      "shell",
      "pkill",
      "-f",
      "com.genymobile.scrcpy.Server",
    ]);
    if (kill.code !== 0) {
      logger?.(`[mirror] server kill failed (exit ${kill.code}); check for a stayed scrcpy-server process on the device`);
    }
  }

  async dispose(): Promise<void> {
    await this.stop().catch(() => undefined);
  }
}
