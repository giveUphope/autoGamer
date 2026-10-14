/**
 * Device roster over `adb` (T2-a / G75).
 *
 * Two measured facts shape this file:
 *   - one emulator can be attached over several transports at once
 *     (`emulator-5554`, `127.0.0.1:7555`, `127.0.0.1:16384`), and `adb devices -l`
 *     lists each as its own line. Counting them as separate devices would double
 *     every gate, concurrency limit and breaker count (G75);
 *   - `ro.serialno` / `ro.boot.serialno` are **empty strings** on that device, so
 *     the classic dedup key is unavailable. `settings get secure android_id` was
 *     measured identical across all three transports, which makes it the key.
 *
 * The "could not ask" answer is kept distinct from "asked, nothing attached":
 * a transient adb failure must not look like an empty fleet (the same distinction
 * the previous action-server path made with `enumerated`).
 */
import { runAdb } from "./adb.js";

export interface AdbTransport {
  readonly serial: string;
  readonly state: string;
}

export interface RosterEntry {
  readonly serial: string;
  readonly state: string;
  /** Every transport that was folded into this entry; length > 1 is the G75 case. */
  readonly transports: readonly string[];
}

/** `adb devices -l` output -> transports. Undefined only when adb itself failed. */
export async function enumerateTransports(): Promise<AdbTransport[] | undefined> {
  const result = await runAdb(["devices", "-l"], { timeoutMs: 10_000 });
  if (result.code !== 0 || result.timedOut || result.aborted) return undefined;
  if (/error:|cannot connect|failed to start daemon/.test(result.stderr)) return undefined;
  return parseDeviceList(result.stdout);
}

export function parseDeviceList(stdout: string): AdbTransport[] {
  const out: AdbTransport[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("List of devices")) continue;
    if (trimmed.startsWith("*")) continue; // daemon chatter, e.g. "* daemon not running"
    const [serial, state] = trimmed.split(/\s+/);
    if (serial === undefined || state === undefined) continue;
    out.push({ serial, state });
  }
  return out;
}

/** Stable per-device identity across transports of the same device; undefined when unaskable. */
export async function deviceIdentity(serial: string): Promise<string | undefined> {
  const result = await runAdb(["-s", serial, "shell", "settings", "get", "secure", "android_id"], {
    timeoutMs: 10_000,
  });
  const value = result.stdout.trim();
  if (result.code !== 0 || value.length === 0 || value === "null") return undefined;
  return value;
}

/**
 * Which transport of a group represents it. `emulator-*` is preferred because it
 * survives an adb restart the way a port does not; otherwise the lexicographically
 * first serial keeps the choice deterministic.
 */
export function canonicalSerial(transports: readonly string[]): string {
  const emulator = transports.find((serial) => serial.startsWith("emulator-"));
  if (emulator !== undefined) return emulator;
  return [...transports].sort()[0] ?? "";
}

/**
 * Transports folded into devices. Transports that cannot answer the identity probe
 * (offline, unauthorized) are never merged with anything: their state is theirs.
 */
export async function buildRoster(
  transports: readonly AdbTransport[],
  identify: (serial: string) => Promise<string | undefined> = deviceIdentity,
): Promise<RosterEntry[]> {
  const groups = new Map<string, AdbTransport[]>();
  for (const transport of transports) {
    const key = transport.state === "device" ? (await identify(transport.serial)) ?? `serial:${transport.serial}` : `serial:${transport.serial}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [transport]);
    else bucket.push(transport);
  }
  const entries: RosterEntry[] = [];
  for (const bucket of groups.values()) {
    const chosen = canonicalSerial(bucket.map((t) => t.serial));
    const winner = bucket.find((t) => t.serial === chosen) ?? bucket[0]!;
    entries.push({ serial: winner.serial, state: winner.state, transports: bucket.map((t) => t.serial).sort() });
  }
  return entries.sort((a, b) => a.serial.localeCompare(b.serial));
}

/**
 * Is the screen unusable for interaction right now?
 *   true  - asked and the screen is off / dozing, or the keyguard says it is up;
 *   false - asked and the screen is on and not keyguarded;
 *   null  - asked and cannot tell (G65: "asked, unknown" must reject, "not asked" must not).
 *
 * Measured on Android 15: `dumpsys keyguard` reports "Can't find service" and no
 * `mKeyguardShowing` line exists anywhere, while `screenState=` tracks sleep and
 * wake reliably. The argument matters and was measured too: `dumpsys window`
 * prints `screenState=SCREEN_STATE_ON` (1 of 671 lines), `dumpsys window displays`
 * does NOT print it at all (0 of 258) - so the state comes from the unfiltered
 * `window` dump, and asking the wrong one would answer "cannot tell" for every
 * device, which admission rejects. A keyguard flag is honoured only on builds
 * that actually print one.
 */
export async function screenIsLocked(serial: string): Promise<boolean | null> {
  const result = await runAdb(["-s", serial, "shell", "dumpsys", "window"], { timeoutMs: 10_000 });
  return readScreenState(`${result.stdout}\n${result.stderr}`);
}

/** Split out so the dump shape, not the subprocess, is what the tests pin. */
export function readScreenState(text: string): boolean | null {
  const screenState = /screenState=SCREEN_STATE_(\w+)/.exec(text)?.[1];
  const keyguard = /mKeyguardShowing=(true|false)/.exec(text)?.[1];
  if (keyguard === "true") return true;
  if (screenState === undefined) return null;
  if (screenState !== "ON") return true;
  return keyguard === undefined ? false : keyguard === "true";
}
