/**
 * Device diagnosis over `adb` (T2-f), replacing the provider's `mobile_diagnose`.
 *
 * Everything here is a shape measured on the live emulator (Android 15,
 * 2026-10-15): `logcat -d -b crash -v brief` answers code 0 with blocks that
 * carry `Timestamp:`, `Cmdline:` and `pid (name)` lines, `dumpsys package <pkg>`
 * carries `versionName=`, and a device that is not attached answers through
 * stderr instead. The crash buffer is read from the `crash` ring buffer rather
 * than main because that is where the useful lines are - the main buffer holds
 * thousands of unrelated lines and would only add noise.
 */
import { adbArgs, runAdb, type AdbOptions } from "./adb.js";
import { createAdbProbe, type DeviceStateProbe } from "./state.js";

export const LOGCAT_TAIL_LINES = 400;

export interface CrashEntry {
  readonly package?: string;
  readonly timestamp?: string;
  readonly stackExcerpt?: string;
}

export interface DeviceDiagnosis {
  readonly deviceSerial: string;
  readonly adbConnected: boolean;
  readonly helperInstalled?: boolean;
  readonly helperVersion?: string;
  readonly recentCrashes: readonly CrashEntry[];
  readonly recommendations: readonly string[];
  readonly screenLocked: boolean | null;
  readonly frame?: { width: number; height: number };
}

/** `versionName=1.2.0` out of a `dumpsys package` body. */
export function parseVersionName(text: string): string | undefined {
  return /versionName=(\S+)/.exec(text)?.[1];
}

/**
 * The `crash` buffer into entries. A tombstone is ONE block, but the brief
 * format repeats its own `F/DEBUG (pid):` tag on every line, so a block starts
 * only at the lines that actually open one (measured: `Timestamp:` in `-v brief`,
 * `F libc : Fatal signal …` and the `*** ***` divider in threadtime) and every
 * later crash line belongs to it. The excerpt is capped because a native
 * tombstone runs to hundreds of lines and the model only needs the head.
 */
export function parseCrashLogcat(text: string): CrashEntry[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: CrashEntry[] = [];
  let current: { timestamp?: string; process?: string; excerpt: string[] } | undefined;
  const flush = () => {
    if (current === undefined) return;
    out.push({
      ...(current.process !== undefined ? { package: current.process } : {}),
      ...(current.timestamp !== undefined ? { timestamp: current.timestamp } : {}),
      stackExcerpt: current.excerpt.join("\n").slice(0, 2000),
    });
    current = undefined;
  };
  const opens = (line: string) =>
    /F\/DEBUG\s*\(\s*\d+\):\s*Timestamp:/.test(line) || /\bF\s+(libc|DEBUG|art)\s*:\s*(Fatal signal|\*\*\*)/.test(line);
  for (const line of lines) {
    if (/^\s*$/.test(line) || line.startsWith("---------")) continue;
    if (opens(line)) {
      flush();
      current = { excerpt: [line.trim()] };
      const time = /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/.exec(line)?.[1];
      if (time !== undefined) current.timestamp = time;
      // The brief-format opener carries its own `Timestamp:` value, so read it
      // here too - the line is consumed as a block start and never revisited.
      const stamp = /Timestamp:\s*(.+)$/.exec(line)?.[1];
      if (stamp !== undefined) current.timestamp = stamp.trim();
      const pidName = /pid \d+ \(([^)]+)\)/.exec(line);
      if (pidName?.[1] !== undefined) current.process = pidName[1];
      const cmdline = /Cmdline:\s*(\S+)/.exec(line)?.[1];
      if (cmdline !== undefined) current.process ??= cmdline.split("/").pop();
      continue;
    }
    if (current === undefined) continue;
    const timestamp = /^\S[^:]*:\s*Timestamp:\s*(.+)$/.exec(line)?.[1] ?? /Timestamp:\s*(.+)$/.exec(line)?.[1];
    if (timestamp !== undefined) {
      current.timestamp = timestamp.trim();
      continue;
    }
    const cmdline = /Cmdline:\s*(\S+)/.exec(line)?.[1];
    if (cmdline !== undefined) current.process ??= cmdline.split("/").pop();
    const process = /Process:\s*(.+)$/.exec(line)?.[1]?.trim();
    if (process !== undefined && process.length > 0) current.process ??= process;
    if (current.excerpt.length < 12) current.excerpt.push(line.trim());
  }
  flush();
  return out;
}

export interface DiagnoserOptions extends AdbOptions {
  readonly probe?: DeviceStateProbe;
  readonly logcatLines?: number;
}

/** The report the tool turns into its output record. */
export async function diagnoseDevice(
  serial: string | undefined,
  options: DiagnoserOptions = {},
): Promise<DeviceDiagnosis> {
  const probe = options.probe ?? createAdbProbe();
  const tail = options.logcatLines ?? LOGCAT_TAIL_LINES;
  const [connection, state, helperInstalled, frame] = await Promise.all([
    probe.connection(serial, options),
    probe.window(serial, options),
    probe.helperInstalled(serial, options),
    probe.frame(serial, options),
  ]);
  const adbConnected = connection === "device";

  let helperVersion: string | undefined;
  if (helperInstalled === true) {
    const dump = await runAdb(adbArgs(serial, ["shell", "dumpsys", "package", "com.artemis.helper"]), options);
    helperVersion = dump.code === 0 ? parseVersionName(dump.stdout) : undefined;
  }

  const crash = await runAdb(
    adbArgs(serial, ["shell", "logcat", "-d", "-b", "crash", "-v", "brief", "-t", String(tail)]),
    options,
  );
  const recentCrashes = crash.code === 0 ? parseCrashLogcat(crash.stdout) : [];

  const recommendations: string[] = [];
  if (!adbConnected) {
    recommendations.push(
      connection === undefined
        ? "adb did not answer for this device: check `adb devices` and the USB/TCP connection"
        : `adb reports the device as "${connection}": accept the RSA prompt on the device or reconnect it`,
    );
  }
  if (state.screenLocked === true) recommendations.push("the screen is off or locked: wake and unlock the device before acting");
  if (state.screenLocked === null) recommendations.push("the screen state could not be read: `adb shell dumpsys window` must print a screenState line");
  if (frame === undefined && adbConnected) recommendations.push("no frame could be captured: `adb exec-out screencap -p` is the source of the coordinate space");
  if (helperInstalled === false) {
    recommendations.push("the accessibility helper APK is not installed - it is optional: the plugin drives the device over adb and needs no helper");
  }
  if (recentCrashes.length > 0) {
    recommendations.push(
      `${recentCrashes.length} crash block(s) in the device logcat crash buffer - check whether the app under test died and relaunch it`,
    );
  }

  return {
    deviceSerial: serial ?? (await probe.serial(options)) ?? "",
    adbConnected,
    ...(helperInstalled !== undefined ? { helperInstalled } : {}),
    ...(helperVersion !== undefined ? { helperVersion } : {}),
    recentCrashes,
    recommendations,
    screenLocked: state.screenLocked,
    ...(frame !== undefined ? { frame } : {}),
  };
}
