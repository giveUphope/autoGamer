/**
 * Device actions over `adb` (T2-c / T2-d / T2-e).
 *
 * The contract this returns is the one the router and its classifier already
 * understand — the legacy action server answered with plain strings
 * (`Success` / `Failed` / `Error: …`), and `classify.ts` reads those shapes. What
 * changed is who produces them, so every decision below comes from the measured
 * behaviour of the `input` / `am` / `monkey` families (TODO §七「前置-7」「前置-9」):
 *
 *   - **success is silent**: `input tap|swipe|keyevent|text` exits 0 with an
 *     empty stdout, so an empty answer is the pass condition, not a missing one;
 *   - **failure can arrive on stdout with code 0** (`Unknown command: …`,
 *     `No activity found`), and can also arrive as code 255 with an
 *     `Exception occurred while executing` on stderr, so the text is checked
 *     independently of the code;
 *   - **the device shell re-splits what we hand it** (monkey echoed every
 *     argument back as `bash arg: -p`), so anything the model supplied — text,
 *     URL, package name — is quoted or shape-checked before it reaches argv;
 *   - `am force-stop` on a package that never existed exits 0, so stop_app is
 *     idempotent by construction and needs no existence probe.
 */
import { adbArgs, deviceReportedFailure, quoteForDeviceShell, runAdb, type AdbOptions } from "./adb.js";
import { parseHierarchyXml, readHierarchyXml } from "./hierarchy.js";

export const ACTION_TIMEOUT_MS = 15_000;

/** What the device-side text field holds right now, as read from a dump. */
export type FieldTextReader = (serial: string | undefined, options?: AdbOptions) => Promise<string | undefined>;

/**
 * The longest `EditText` text in a fresh dump, or "" when a field is focused and
 * empty. `undefined` means the dump could not be read. Measured alternative that
 * does NOT work: `dumpsys input_method` stopped printing `mText:` on Android 15.
 */
export const readFieldText: FieldTextReader = async (serial, options) => {
  const xml = await readHierarchyXml(serial, options);
  if (xml === undefined) return undefined;
  const nodes = parseHierarchyXml(xml)?.nodes ?? [];
  const fields = nodes.filter((node) => node.class.includes("EditText"));
  if (fields.length === 0) return undefined;
  const texts = fields.map((node) => node.text).filter((text) => text.length > 0);
  return texts.length === 0 ? "" : texts.sort((a, b) => b.length - a.length)[0]!;
};

const SUCCESS = "Success";
const FAILED = "Failed";

export interface NativeCall {
  readonly tool: string;
  readonly payload: Record<string, unknown>;
}

/** Packages are `a.b.c` shaped; anything else is refused rather than shell-quoted. */
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** Only web links: a `javascript:` or `file:` URL handed to VIEW is not our business. */
const URL_RE = /^https?:\/\/[^\s]+$/i;

function numbers(value: unknown, count: number): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map((item) => (typeof item === "number" && Number.isFinite(item) ? Math.round(item) : NaN));
  return out.length === count && out.every((n) => Number.isFinite(n)) ? out : undefined;
}

/**
 * One action, answered in the legacy string shape. Throws only for what the
 * router must classify as `environment:` (an aborted or vanished adb); every
 * device-side refusal is an `Error: …` string, because that is how the action
 * server reported them and the classifier's vocabulary is built on it.
 */
export async function runNativeAction(
  call: NativeCall,
  serial: string | undefined,
  options: { signal?: AbortSignal; readFieldText?: FieldTextReader } = {},
): Promise<string> {
  const readText = options.readFieldText ?? readFieldText;
  const clearOptions = { signal: options.signal, readFieldText: readText };
  const shell = async (args: string[], timeoutMs = ACTION_TIMEOUT_MS) => {
    const result = await runAdb(adbArgs(serial, ["shell", ...args]), { timeoutMs, signal: options.signal });
    if (result.aborted) throw new Error("environment: action cancelled by the user");
    if (result.timedOut) throw new Error(`environment: adb ${args[0]} ${args[1] ?? ""} timed out after ${timeoutMs}ms`);
    if (result.code === -1) throw new Error("environment: adb did not run");
    return result;
  };

  /** Silence means success (measured); anything else is judged on its text. */
  const gesture = async (args: string[]) => {
    const result = await shell(args);
    if (deviceReportedFailure(result.stdout, result.stderr)) {
      return `Error: ${failureLine(result.stdout, result.stderr)}`;
    }
    if (result.code !== 0) return `Error: ${failureLine(result.stdout, result.stderr) || `exit ${result.code}`}`;
    return SUCCESS;
  };

  switch (call.tool) {
    case "tap": {
      const [x, y] = numbers(call.payload.coordinates, 2) ?? [];
      if (x === undefined || y === undefined) return "Error: tap needs coordinates [x,y]";
      return gesture(["input", "tap", String(x), String(y)]);
    }
    case "long_press_on": {
      const [x, y] = numbers(call.payload.coordinates, 2) ?? [];
      const duration = Math.max(1, Math.round(Number(call.payload.duration ?? 1000)));
      if (x === undefined || y === undefined) return "Error: long_press_on needs coordinates [x,y]";
      // A press that does not move: same point, held for `duration`. Whether the
      // app treats it as a long press could not be proven on the test device
      // (every affordance probe answered identically for a plain tap, so the
      // experiment was inconclusive, not negative) - tracked as G91.
      return gesture(["input", "swipe", String(x), String(y), String(x), String(y), String(duration)]);
    }
    case "swipe": {
      const [x1, y1, x2, y2] = numbers(call.payload.coordinates, 4) ?? [];
      const duration = Math.max(1, Math.round(Number(call.payload.duration ?? 400)));
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
        return "Error: swipe needs coordinates [x1,y1,x2,y2]";
      }
      return gesture(["input", "swipe", String(x1), String(y1), String(x2), String(y2), String(duration)]);
    }
    case "press_key": {
      const keycode = String(call.payload.keycode ?? "");
      if (!/^KEYCODE_[A-Z0-9_]+$/.test(keycode)) return `Error: unknown key ${keycode}`;
      return gesture(["input", "keyevent", keycode]);
    }
    case "back":
      return gesture(["input", "keyevent", "KEYCODE_BACK"]);
    case "erase_one_char":
      return gesture(["input", "keyevent", "KEYCODE_DEL"]);
    case "focus_and_input_text": {
      const [x, y] = numbers(call.payload.coordinates, 2) ?? [];
      if (x === undefined || y === undefined) return "Error: focus_and_input_text needs coordinates [x,y]";
      const text = String(call.payload.text ?? "");
      if (text.length === 0) return "Error: focus_and_input_text needs text";
      const tapped = await gesture(["input", "tap", String(x), String(y)]);
      if (tapped !== SUCCESS) return tapped;
      if (call.payload.clear_before_input === true) {
        const cleared = await clearField(serial, clearOptions);
        if (cleared !== SUCCESS) return cleared;
      }
      // Measured: `input text` carries non-ASCII straight through (both `ZONEE`
      // and `你好` landed in the field), so the clipboard route the upstream used
      // is not needed here. Quoting is mandatory though: the device shell splits.
      return gesture(["input", "text", quoteForDeviceShell(text)]);
    }
    case "focus_and_clear_text": {
      const [x, y] = numbers(call.payload.coordinates, 2) ?? [];
      if (x === undefined || y === undefined) return "Error: focus_and_clear_text needs coordinates [x,y]";
      const tapped = await gesture(["input", "tap", String(x), String(y)]);
      if (tapped !== SUCCESS) return tapped;
      return clearField(serial, clearOptions);
    }
    case "launch_app": {
      const pkg = String(call.payload.package_name ?? "");
      if (!PACKAGE_RE.test(pkg)) return `Error: invalid package name ${pkg}`;
      const resolved = await shell([
        "cmd",
        "package",
        "resolve-activity",
        "--brief",
        "-c",
        "android.intent.category.LAUNCHER",
        pkg,
      ]);
      // Measured: a package with no launcher activity answers code 0 with
      // `No activity found` on stdout - the exit code would have called that a
      // success. Failing early here is also what makes the refusal name the
      // package instead of the screen going quiet.
      if (deviceReportedFailure(resolved.stdout, resolved.stderr) || /No activity found/i.test(resolved.stdout)) {
        return `Error: no launcher activity for package ${pkg}`;
      }
      const started = await shell(["monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
      if (deviceReportedFailure(started.stdout, started.stderr) || started.code !== 0) {
        return `Error: ${failureLine(started.stdout, started.stderr) || `monkey exited ${started.code}`}`;
      }
      return SUCCESS;
    }
    case "stop_app": {
      const pkg = String(call.payload.package_name ?? "");
      if (!PACKAGE_RE.test(pkg)) return `Error: invalid package name ${pkg}`;
      return gesture(["am", "force-stop", pkg]);
    }
    case "open_link": {
      const url = String(call.payload.url ?? "");
      if (!URL_RE.test(url)) return `Error: unsupported url (only http/https links are opened): ${url.slice(0, 80)}`;
      const result = await shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", quoteForDeviceShell(url)]);
      const text = `${result.stdout}\n${result.stderr}`;
      if (/Error: Activity class|does not exist|Error type 3|Exception occurred/i.test(text)) {
        return `Error: ${failureLine(result.stdout, result.stderr)}`;
      }
      // Measured: success prints `Starting: Intent { act=android.intent.action.VIEW … }`.
      if (!/Starting: Intent/.test(result.stdout)) {
        return result.code === 0 ? SUCCESS : `Error: ${failureLine(result.stdout, result.stderr) || `exit ${result.code}`}`;
      }
      return SUCCESS;
    }
    default:
      return `Error: unsupported action ${call.tool}`;
  }
}

/**
 * Empty the focused field. Measured on the omnibox: `input text` lands at the
 * caret, and `KEYCODE_MOVE_END` did not always move it, so a single pass cannot
 * be trusted - delete backwards from wherever the caret is, then forwards from
 * the start, and check the field afterwards instead of assuming.
 */
async function clearField(serial: string | undefined, options: { signal?: AbortSignal; readFieldText?: FieldTextReader }): Promise<string> {
  const reader = options.readFieldText;
  const length = reader === undefined ? 40 : Math.max(0, ((await reader(serial, { signal: options.signal })) ?? "").length);
  const count = Math.min(200, length + 5);
  for (const direction of ["67", "112"]) {
    // One `input keyevent` call carries the repeats (measured: three DELs in one
    // call removed exactly three characters).
    const result = await runAdb(adbArgs(serial, ["shell", "input", "keyevent", ...Array.from({ length: count }, () => direction)]), {
      timeoutMs: ACTION_TIMEOUT_MS,
      signal: options.signal,
    });
    if (result.aborted) throw new Error("environment: action cancelled by the user");
    if (deviceReportedFailure(result.stdout, result.stderr)) return `Error: ${failureLine(result.stdout, result.stderr)}`;
  }
  if (reader !== undefined) {
    const left = ((await reader(serial, { signal: options.signal })) ?? "").trim();
    if (left.length > 0) return `Error: field still holds ${left.slice(0, 40)}`;
  }
  return SUCCESS;
}

function failureLine(stdout: string, stderr: string): string {
  const text = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return (text ?? "").slice(0, 200);
}
