/**
 * Device state straight off `adb` (T2-a / G83).
 *
 * `autogamer_get_device_state` used to answer these questions by asking the
 * external ARTEMIS provider, which meant the read-only tool needed the whole
 * provider stack installed. Every shape here is the measured `adb` output
 * (TODO §七「前置-7」and the device-state probe this file was written from):
 *
 *   - `get-state`            -> `device\n`, exit 0; an unknown serial gives
 *                               exit 1 with `error: device 'x' not found`;
 *   - `dumpsys window`       -> carries BOTH `screenState=SCREEN_STATE_ON` and
 *                               `mCurrentFocus=Window{<hash> u0 <pkg>/<act>}`
 *                               (the `displays` argument does not print
 *                               screenState at all, so one call, no argument);
 *   - `exec-out screencap -p` -> a PNG whose IHDR is the frame space the model's
 *                               0-1000 coordinates are converted against (G76);
 *   - `pm list packages -3`  -> `package:<name>` lines, one per installed APK;
 *   - `get-serialno`         -> `emulator-5554\n`, exit 0 when a device is
 *                               addressed; an unknown serial exits 1 with empty
 *                               stdout, so this also answers "which device are
 *                               we talking to when none was named".
 *
 * "Could not ask" stays distinct from "asked and it is not": a probe that did
 * not answer returns undefined / null, and the caller decides what that means.
 */
import { parseImageSize, type ScreenSize } from "../coord.js";
import { adbArgs, runAdb, runAdbBinary, type AdbOptions } from "./adb.js";
import { readScreenState } from "./roster.js";

/** Package the accessibility helper installs as (measured on the test emulator). */
export const HELPER_PACKAGE = "com.artemis.helper";

export type ConnectionState = "device" | "offline" | "unauthorized";

export interface ForegroundComponent {
  readonly package: string;
  readonly activity: string;
}

export interface WindowState {
  /** true locked, false unlocked, null asked-but-cannot-tell. */
  readonly screenLocked: boolean | null;
  readonly foreground?: ForegroundComponent;
}

export interface DeviceSnapshot extends WindowState {
  readonly connection?: ConnectionState;
  readonly frame?: ScreenSize;
  readonly helperInstalled?: boolean;
}

/** `adb get-state` -> the state word, undefined when adb did not answer with one. */
export function parseGetState(stdout: string): ConnectionState | undefined {
  const value = stdout.trim();
  return value === "device" || value === "offline" || value === "unauthorized" ? value : undefined;
}

/**
 * The focused window out of a `dumpsys window` dump. `mCurrentFocus` is tried
 * first, `mFocusedApp` second: the first names whatever window actually has
 * input (including non-activity windows), the second is the resumed activity.
 * Tokens are returned exactly as printed - Android prints some activities with a
 * leading dot, which `am start` also accepts, so nothing here rewrites them.
 */
export function parseForeground(text: string): ForegroundComponent | undefined {
  // The token is `package/activity`; a window that names no activity (a toast,
  // `(null)` when nothing has focus) carries no slash, so it does not match and
  // the resumed activity below is tried instead.
  for (const re of [
    /mCurrentFocus=Window\{[^{}]*?(\S+\/[^\s}]+)/,
    /mFocusedApp=ActivityRecord\{[^{}]*?(\S+\/[^\s}]+)/,
  ]) {
    const token = re.exec(text)?.[1];
    if (token === undefined) continue;
    const slash = token.indexOf("/");
    const pkg = token.slice(0, slash);
    const activity = token.slice(slash + 1);
    if (pkg.length === 0 || activity.length === 0) continue;
    return { package: pkg, activity };
  }
  return undefined;
}

/** Does `pm list packages` output name this package? */
export function parsePackageList(text: string, wanted: string = HELPER_PACKAGE): boolean {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^package:/, ""))
    .includes(wanted);
}

/** One `dumpsys window` call answers the screen state and the focused app. */
export function parseWindowState(text: string): WindowState {
  const state: WindowState = { screenLocked: readScreenState(text) };
  const foreground = parseForeground(text);
  return foreground === undefined ? state : { ...state, foreground };
}

export interface DeviceStateProbe {
  /** Which device adb addresses when none is named; undefined when it cannot say. */
  serial(options?: AdbOptions): Promise<string | undefined>;
  connection(serial: string | undefined, options?: AdbOptions): Promise<ConnectionState | undefined>;
  window(serial: string | undefined, options?: AdbOptions): Promise<WindowState>;
  frame(serial: string | undefined, options?: AdbOptions): Promise<ScreenSize | undefined>;
  helperInstalled(serial: string | undefined, options?: AdbOptions): Promise<boolean | undefined>;
  capture(serial: string | undefined, options?: AdbOptions): Promise<Buffer | undefined>;
}

/**
 * The `adb`-backed probe. A serial of `undefined` deliberately drops `-s`, which
 * is how a single-device setup works without the operator naming anything
 * (measured: `adb get-state` with one device answers; with several it errors,
 * and erroring is the honest answer - we would be guessing a device).
 */
export function createAdbProbe(): DeviceStateProbe {
  const shell = (serial: string | undefined, args: string[], options?: AdbOptions) =>
    runAdb(adbArgs(serial, ["shell", ...args]), options);

  return {
    async serial(options) {
      const result = await runAdb(["get-serialno"], { timeoutMs: 10_000, ...options });
      if (result.code !== 0 || result.timedOut || result.aborted) return undefined;
      const value = result.stdout.trim();
      return value.length === 0 || value.startsWith("error:") || value === "<unknown>" ? undefined : value;
    },

    async connection(serial, options) {
      const result = await runAdb(adbArgs(serial, ["get-state"]), { timeoutMs: 10_000, ...options });
      if (result.code !== 0 || result.timedOut || result.aborted) return undefined;
      return parseGetState(result.stdout);
    },

    async window(serial, options) {
      const result = await shell(serial, ["dumpsys", "window"], { timeoutMs: 10_000, ...options });
      if (result.timedOut || result.aborted) return { screenLocked: null };
      return parseWindowState(`${result.stdout}\n${result.stderr}`);
    },

    async frame(serial, options) {
      const png = await this.capture(serial, options);
      return png === undefined ? undefined : parseImageSize(png);
    },

    async helperInstalled(serial, options) {
      const result = await shell(serial, ["pm", "list", "packages", HELPER_PACKAGE], {
        timeoutMs: 10_000,
        ...options,
      });
      if (result.code !== 0 || result.timedOut || result.aborted) return undefined;
      return parsePackageList(result.stdout);
    },

    async capture(serial, options) {
      // exec-out, not shell: `shell` folds CRLF into the binary stream.
      const result = await runAdbBinary(adbArgs(serial, ["exec-out", "screencap", "-p"]), {
        timeoutMs: 20_000,
        ...options,
      });
      if (result.code !== 0 || result.timedOut || result.aborted) return undefined;
      return result.stdout.length === 0 ? undefined : result.stdout;
    },
  };
}
