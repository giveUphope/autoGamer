/**
 * adb double for the native device layer (T2-a).
 *
 * `src/device/adb.ts` is the single place the plugin spawns adb, so mocking that
 * one module covers the roster, the device-state probes and the screen-size
 * probe at once — and, unlike mocking the higher-level modules, the parsing of
 * real `adb` output stays under test. Rules are matched against the joined argv
 * (so a spec can say "this is the dumpsys window call") and an unmatched call
 * answers the way adb does when it cannot find the device: exit 1, empty stdout.
 *
 * Usage in a spec file (vitest requires the mock call at the file's top level,
 * and the factory is the only place that may build the double — `vi.hoisted`
 * bodies run before any import):
 *
 *   const adb = vi.hoisted(() => ({ state: null as FakeAdbRuntime | null }));
 *   vi.mock("../src/device/adb.js", async () => {
 *     const { createFakeAdbRuntime } = await import("../support/fakeAdb.js");
 *     adb.state = createFakeAdbRuntime();
 *     return adb.state.module;
 *   });
 *   const A = () => adb.state as FakeAdbRuntime;
 */
import { vi } from "vitest";
import type { AdbBinaryResult } from "../../src/device/adb.js";

export interface AdbReply {
  code?: number;
  stdout?: string | Buffer;
  stderr?: string;
  /** Set when the rule should answer "this module killed the child". */
  timedOut?: boolean;
}

/**
 * The answer when a spec asked nothing: the shape adb really produces for a
 * serial it cannot find (measured: exit 1 + `error: device 'x' not found` on
 * stderr). An empty stderr with a non-zero code is not a real shape, and it
 * would let the classifier read a dead device as a model mistake.
 */
const UNANSWERED: AdbReply = { code: 1, stderr: "error: device not found" };

export interface FakeAdbRuntime {  readonly calls: string[][];
  /**
   * What each spawn was handed about cancellation (能力重审-1). `calls` alone
   * cannot tell "no signal was passed at all" from "the call's own live signal
   * was passed" — and that difference is the entire content of the two probe
   * seams, whose signatures take `signal?` so dropping one still compiles.
   * The signal itself is kept (not just a boolean) so a lock can check identity.
   */
  readonly signalSeen: { args: string[]; signal?: AbortSignal }[];
  readonly rules: { readonly match: RegExp; readonly reply: () => AdbReply }[];
  on(match: RegExp, reply: AdbReply | (() => AdbReply)): void;
  reset(): void;
  answer(args: readonly string[], options?: { signal?: AbortSignal }): AdbBinaryResult;
  /** Replaces `runAdb` / `runAdbBinary` and re-exports everything else real. */
  readonly module: () => Promise<Record<string, unknown>>;
}

export function createFakeAdbRuntime(): FakeAdbRuntime {
  const calls: string[][] = [];
  const signalSeen: { args: string[]; signal?: AbortSignal }[] = [];
  const rules: { match: RegExp; reply: () => AdbReply }[] = [];
  const runtime: FakeAdbRuntime = {
    calls,
    signalSeen,
    rules,
    on(match, reply) {
      rules.push({ match, reply: typeof reply === "function" ? reply : () => reply });
    },
    reset() {
      calls.length = 0;
      signalSeen.length = 0;
      rules.length = 0;
    },
    answer(args, options) {
      const argv = args.join(" ");
      calls.push([...args]);
      signalSeen.push({ args: [...args], signal: options?.signal });
      // Last registered rule wins, so a test can override the defaults that
      // beforeEach installed.
      let hit: { match: RegExp; reply: () => AdbReply } | undefined;
      for (let i = rules.length - 1; i >= 0; i -= 1) {
        if (rules[i]!.match.test(argv)) {
          hit = rules[i];
          break;
        }
      }
      const reply = hit ? hit.reply() : UNANSWERED;
      // An already-aborted call answers the way the real spawn does: the child
      // was killed, so there is no exit code and nothing to read.
      const aborted = options?.signal?.aborted === true;
      return {
        code: aborted ? -1 : reply.code ?? 1,
        stdout: Buffer.isBuffer(reply.stdout) ? reply.stdout : Buffer.from(reply.stdout ?? "", "utf8"),
        stderr: aborted ? "" : reply.stderr ?? "",
        timedOut: reply.timedOut === true,
        aborted,
      };
    },
    module: async () => {
      const actual = (await vi.importActual<Record<string, unknown>>("../../src/device/adb.js")) ?? {};
      return {
        ...actual,
        runAdb: async (args: readonly string[], options?: { signal?: AbortSignal }) => {
          const result = runtime.answer(args, options);
          return { ...result, stdout: result.stdout.toString("utf8") };
        },
        runAdbBinary: async (args: readonly string[], options?: { signal?: AbortSignal }) =>
          runtime.answer(args, options),
      };
    },
  };
  return runtime;
}

/**
 * The one double per test file. vitest isolates the module graph per file, so
 * every suite gets its own instance; `tests/support/adbMock.ts` installs it as
 * the mock for `src/device/adb.js` globally, and suites that need answers
 * register rules on this object.
 */
export const adbRuntime = createFakeAdbRuntime();

/** Rules for one healthy emulator: unlocked, focused, 720x1600 frame. */
export function adbHealthyDevice(serial = "emulator-5554"): void {
  adbRuntime.on(getSerialnoArgv, { code: 0, stdout: `${serial}\n` });
  adbRuntime.on(getStateArgv, { code: 0, stdout: "device\n" });
  adbRuntime.on(screencapArgv, { code: 0, stdout: pngHeaderOnly(720, 1600) });
  adbRuntime.on(windowArgv, {
    code: 0,
    stdout: windowDump({ screenState: "ON", focus: "com.example/.Main" }),
  });
  adbRuntime.on(packagesArgv, { code: 0, stdout: "" });
}

/** argv matchers for the calls the device layer makes. */
export const devicesArgv = /^devices -l$/;
export const identityArgv = /shell settings get secure android_id$/;
export const windowArgv = /shell dumpsys window$/;
export const screencapArgv = /exec-out screencap -p$/;
export const getStateArgv = /get-state$/;
export const getSerialnoArgv = /^get-serialno$/;
export const packagesArgv = /shell pm list packages/;
export const dumpArgv = /shell uiautomator dump /;
export const catArgv = /exec-out cat \/sdcard\/dsh-autogamer-hierarchy-/;
export const rmArgv = /shell rm \/sdcard\/dsh-autogamer-hierarchy-/;
export const tapArgv = /shell input tap /;
export const swipeArgv = /shell input swipe /;
export const keyeventArgv = /shell input keyevent/;
export const textArgv = /shell input text /;
export const amArgv = /shell (am|monkey|cmd package)/;
/** Any of the mutating device commands an action can turn into. */
export const actionArgv = /shell (input|am|monkey|cmd package)/;

/** The `input tap x y` calls adb was asked to run, as coordinate pairs. */
export function tapsOf(calls: readonly string[][]): [number, number][] {
  return calls
    .filter((args) => tapArgv.test(args.join(" ")))
    .map((args) => [Number(args[args.length - 2]), Number(args[args.length - 1])]) as [number, number][];
}

/** The text an `input text <value>` carried, with the device-shell quotes off. */
export function textArgsOf(calls: readonly string[][]): string[] {
  return calls
    .filter((args) => textArgv.test(args.join(" ")))
    .map((args) => String(args[args.length - 1]).replace(/^'|'$/g, "").replace(/'\\''/g, "'"));
}

/** A `dumpsys window` body carrying the two lines the probes read. */
export function windowDump(input: { screenState?: string; focus?: string; keyguard?: string }): string {
  const lines = ["WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)"];
  if (input.screenState !== undefined) lines.push(`  screenState=SCREEN_STATE_${input.screenState}`);
  if (input.keyguard !== undefined) lines.push(`  mKeyguardShowing=${input.keyguard}`);
  if (input.focus !== undefined) lines.push(`  mCurrentFocus=Window{7cc5aaf u0 ${input.focus}}`);
  return `${lines.join("\n")}\n`;
}

/**
 * A PNG carrying only what a size probe reads: the signature and an IHDR with
 * these dimensions. `parseImageSize` looks at bytes 16/20 and nothing else, so
 * an encoded frame would only make the suite slower.
 */
export function pngHeaderOnly(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

