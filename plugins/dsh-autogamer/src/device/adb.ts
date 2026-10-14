/**
 * The single place this plugin reaches `adb`.
 *
 * Every choice below comes from the measured behaviour of the tool (TODO §七
 * "前置-7 实测结论"), not from assumption:
 *   - the `input` family prints nothing on success and exits 0;
 *   - `uiautomator dump` exits **139 even when it worked**, and echoes a success
 *     line for a path that does not exist, so no caller may treat the exit code
 *     or the message as proof of anything - the payload has to be read back;
 *   - failures can also arrive on **stdout with code 0** (`Unknown command: ...`),
 *     so text is checked independently of the code;
 *   - `adb shell <args>` hands its arguments to the *device* shell, which splits
 *     them again (measured: monkey echoing each argument back), so an argv array
 *     on this side is not enough - model-supplied text must be quoted.
 *
 * Timeout is enforced here because the host never applies a tool's declared
 * `timeoutMs` (R15), and the AbortSignal is observed so a cancelled call does
 * not leave a live child behind.
 */
import { spawn } from "node:child_process";

export interface AdbTextResult extends AdbOutput {
  readonly stdout: string;
}

export interface AdbBinaryResult extends AdbOutput {
  readonly stdout: Buffer;
}

interface AdbOutput {
  readonly code: number;
  readonly stderr: string;
  /** True when this module killed the child after `timeoutMs`. */
  readonly timedOut: boolean;
  /** True when the caller's signal aborted the call. */
  readonly aborted: boolean;
}

export interface AdbOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export const ADB_DEFAULT_TIMEOUT_MS = 15_000;

/** A serial of `undefined` means "do not name one": adb answers for the only attached device. */
export function adbArgs(serial: string | undefined, args: readonly string[]): string[] {
  return serial === undefined ? [...args] : ["-s", serial, ...args];
}

export function quoteForDeviceShell(value: string): string {
  // The device side is a POSIX shell; the standard single-quote escape is to end
  // the quote, insert an escaped quote, and reopen.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function runAdb(
  args: readonly string[],
  options: AdbOptions = {},
): Promise<AdbTextResult> {
  const binary = await spawnAdb(args, options);
  return { ...binary, stdout: binary.stdout.toString("utf8") };
}

/**
 * Binary-safe form: `exec-out screencap -p` returns a PNG, and decoding it as
 * UTF-8 would corrupt it. Everything else about the call is the same.
 */
export async function runAdbBinary(
  args: readonly string[],
  options: AdbOptions = {},
): Promise<AdbBinaryResult> {
  return await spawnAdb(args, options);
}

async function spawnAdb(
  args: readonly string[],
  options: AdbOptions,
): Promise<AdbBinaryResult> {
  const timeoutMs = options.timeoutMs ?? ADB_DEFAULT_TIMEOUT_MS;
  return await new Promise<AdbBinaryResult>((resolve) => {
    const child = spawn("adb", [...args], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const onAbort = () => {
      aborted = true;
      child.kill("SIGKILL");
    };
    if (options.signal !== undefined) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.signal !== undefined) options.signal.removeEventListener("abort", onAbort);
      resolve({
        code,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString("utf8"),
        timedOut,
        aborted,
      });
    };

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", () => finish(-1));
    // A killed child reports null; -1 keeps "did not exit normally" distinct from any real code.
    child.on("close", (code) => finish(code ?? -1));
  });
}

/** Does this output mean the device-side command failed, whatever the code said? */
export function deviceReportedFailure(stdout: string, stderr: string): boolean {
  const combined = `${stdout}\n${stderr}`;
  return /Exception occurred while executing|Unknown command:|Error: |INSTRUMENTATION_STATUS: Error|SecurityException|Segmentation fault/.test(
    combined,
  );
}
