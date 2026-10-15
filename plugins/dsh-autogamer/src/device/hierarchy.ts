/**
 * UI hierarchy straight off the device (T2-b / G83).
 *
 * Three measured facts decide the shape of this file (TODO §七「前置-1」「前置-7」,
 * re-measured 2026-10-15 on `emulator-5554`, Android 15):
 *
 *   - `uiautomator dump` exits **139 even when it worked** and prints
 *     `UI hierchary dumped to: <path>` for a path that does not exist either, so
 *     neither the code nor the message is evidence of anything: the only trustable
 *     answer is the file read back with `exec-out cat`;
 *   - the wire form is an **XML tree of `<node>` elements** (19 attributes on
 *     every node, mixed self-closing and paired tags, `bounds="[l,t][r,b]"`,
 *     `rotation` on the `<hierarchy>` root). The py side flattened that tree and
 *     invented the `parsed_bounds` object this plugin used to read, so the
 *     flattening and the bounds parsing are ours now;
 *   - the node's own `index` is a per-container ordinal, which is why the
 *     addressing handle is a position in THIS list and is resolved by identity,
 *     never by taking position N again (G42 / G67 — unchanged by this slice).
 *
 * The dump writes to shared storage, so the path carries this process's id: two
 * plugin instances dumping at once must not read each other's file (the wider
 * cross-process hazard is tracked as G89).
 */
import { adbArgs, deviceReportedFailure, runAdb, runAdbBinary, type AdbOptions } from "./adb.js";

export const DUMP_TIMEOUT_MS = 30_000;

export interface HierarchyBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface HierarchyNode {
  /** Document-order depth, 0 at the root node. */
  readonly depth: number;
  readonly text: string;
  readonly contentDesc: string;
  readonly resourceId: string;
  readonly class: string;
  readonly package: string;
  readonly bounds?: HierarchyBounds;
  readonly clickable: boolean;
  readonly longClickable: boolean;
  readonly enabled: boolean;
  readonly scrollable: boolean;
  readonly focused: boolean;
  readonly selected: boolean;
  readonly checked: boolean;
  readonly password: boolean;
}

export interface HierarchyDocument {
  readonly nodes: readonly HierarchyNode[];
  /** `rotation` on the root: 0 portrait, 1 / 3 landscape, 2 inverted portrait. */
  readonly rotation?: number;
}

export function dumpPath(): string {
  return `/sdcard/dsh-autogamer-hierarchy-${process.pid}.xml`;
}

/**
 * Ask the device for a hierarchy dump and read it back.
 * `undefined` means "no usable hierarchy" - the dump failed, the file is not
 * there, or it did not come back as XML. The exit code of `dump` is deliberately
 * not consulted (measured 139 on success).
 */
export async function readHierarchyXml(
  serial: string | undefined,
  options: AdbOptions = {},
): Promise<string | undefined> {
  const path = dumpPath();
  try {
    await runAdb(adbArgs(serial, ["shell", "uiautomator", "dump", path]), {
      timeoutMs: DUMP_TIMEOUT_MS,
      ...options,
    });
    const read = await runAdbBinary(adbArgs(serial, ["exec-out", "cat", path]), {
      timeoutMs: 10_000,
      ...options,
    });
    if (read.timedOut || read.aborted || read.code !== 0) return undefined;
    const xml = read.stdout.toString("utf8");
    if (!isHierarchyXml(xml)) return undefined;
    return xml;
  } finally {
    // Best effort: a leftover dump on shared storage is nobody's business but ours.
    void runAdb(adbArgs(serial, ["shell", "rm", path]), { timeoutMs: 10_000, ...options }).catch(() => undefined);
  }
}

/** What a real dump starts with, and what a truncated or failed one does not. */
export function isHierarchyXml(text: string): boolean {
  return text.includes("<hierarchy") && text.includes("<node ");
}

/**
 * Who holds the one UiAutomation slot (能力重审-2).
 *
 * The mechanism, from AOSP: `UiAutomationConnection.connect()` throws
 * `Already connected.` while a connection is live, so **exactly one client can
 * hold the slot**; and `uiautomator dump` is itself a client —
 * `UiAutomationShellWrapper.connect()` calls the no-argument `connect()`, which
 * is the branch that suppresses accessibility services, with no flag to opt out.
 * From here a dump that answers nothing looks identical in both cases: our own
 * dump failed, or somebody else holds the slot and will keep failing every dump.
 * Naming the holder is the only thing that separates them, and today nothing
 * here asks.
 *
 * Read-only by decision. The archived upstream cleared a blocker by uninstalling
 * the user's Maestro (`pm uninstall --user 0`); this plugin never stops, kills
 * or uninstalls anything another client owns (R19 puts that call with the user).
 */
export const OCCUPANT_MARKERS = [
  { marker: "com.wetest.uia2.Main", name: "uiautomator2 server" },
  { marker: "com.github.uiautomator", name: "openatx uiautomator app" },
  { marker: "io.appium.uiautomator2", name: "Appium uiautomator2 server" },
  { marker: "androidx.test.runner.MonitoringInstrumentation", name: "instrumentation runner" },
] as const;

/** `occupied` names a holder; `free` is a positive reading; `unknown` is not one. */
export type OccupantState = "occupied" | "free" | "unknown";

export interface OccupantReadout {
  readonly state: OccupantState;
  readonly names: readonly string[];
}

/**
 * A row is a line starting with a pid — nothing else in `ps` output is a
 * candidate. Markers are matched against the whole line rather than one column
 * because the column layout of `ps -A -o PID,ARGS` is the one shape here that
 * has no measurement in this repository's ledger (§七「前置-2」recorded a plain
 * `ps -A`), so the parser must not depend on which column `ARGS` lands in.
 *
 * Zero rows answers `unknown`, never `free`: an unreadable table that reports
 * "nobody holds it" hands out a clean bill of health on no evidence, which is
 * worse than not asking.
 */
export function parseOccupants(text: string): OccupantReadout {
  const rows = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => /^\s*\d+\s+\S/.test(line));
  if (rows.length === 0) return { state: "unknown", names: [] };
  const names = OCCUPANT_MARKERS.filter((entry) =>
    rows.some((line) => line.includes(entry.marker)),
  ).map((entry) => entry.name);
  return names.length > 0 ? { state: "occupied", names } : { state: "free", names: [] };
}

export const OCCUPANT_TIMEOUT_MS = 10_000;

/**
 * Ask the device which processes hold a UiAutomation connection. Every failure
 * shape (timeout, abort, non-zero code, a device-side error printed with code
 * 0, an empty or unrecognisable table) collapses to `unknown`: the caller gets
 * one honest word instead of a stack of causes it cannot act on.
 */
export async function readUiAutomationOccupants(
  serial: string | undefined,
  options: AdbOptions = {},
): Promise<OccupantReadout> {
  const result = await runAdb(adbArgs(serial, ["shell", "ps", "-A", "-o", "PID,ARGS"]), {
    timeoutMs: OCCUPANT_TIMEOUT_MS,
    ...options,
  });
  if (result.timedOut || result.aborted || result.code !== 0) return { state: "unknown", names: [] };
  if (deviceReportedFailure(result.stdout, result.stderr)) return { state: "unknown", names: [] };
  return parseOccupants(result.stdout);
}

/** `[l,t][r,b]`, the only bounds form uiautomator prints (measured on 45/45 nodes). */
export function parseBounds(value: string | undefined): HierarchyBounds | undefined {
  const m = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value ?? "");
  if (!m) return undefined;
  const [, left, top, right, bottom] = m as unknown as [string, string, string, string, string];
  return {
    left: Number(left),
    top: Number(top),
    right: Number(right),
    bottom: Number(bottom),
  };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** uiautomator escapes attribute values; text the model reads must come back whole. */
export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * The tag boundaries of a `<node …>` element, scanning past any `>` that sits
 * inside a quoted attribute value. Android escapes it, but a parser that only
 * works when the producer escapes is a parser waiting for a surprise.
 */
function tagEnd(text: string, from: number): number {
  let inQuote = false;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ">" && !inQuote) return i;
  }
  return -1;
}

/**
 * Flatten the tree in document order. Self-closing and paired `<node>` tags
 * both appear in real dumps (measured 21 and 24 in the same 45-node tree), so
 * depth is tracked through both.
 */
export function parseHierarchyXml(xml: string): HierarchyDocument | undefined {
  const rotationMatch = /<hierarchy\b([^>]*)>/.exec(xml);
  const rotationRaw = rotationMatch ? /rotation="(-?\d+)"/.exec(rotationMatch[1] ?? "")?.[1] : undefined;
  const nodes: HierarchyNode[] = [];
  // A stack of the open (non-self-closing) ancestors: its length is the depth
  // of whatever comes next. Both tag forms occur in real dumps (21 self-closing
  // and 24 paired in the same 45-node tree), so depth has to follow both.
  const open: number[] = [];
  let cursor = 0;
  for (;;) {
    const nextOpen = xml.indexOf("<node", cursor);
    const nextClose = xml.indexOf("</node>", cursor);
    if (nextOpen < 0 && nextClose < 0) break;
    if (nextClose >= 0 && (nextOpen < 0 || nextClose < nextOpen)) {
      open.pop();
      cursor = nextClose + "</node>".length;
      continue;
    }
    if (nextOpen < 0) break;
    const end = tagEnd(xml, nextOpen);
    if (end < 0) break;
    const tag = xml.slice(nextOpen, end);
    nodes.push(nodeFrom(open.length, attributesOf(tag)));
    if (!tag.endsWith("/")) open.push(nextOpen);
    cursor = end + 1;
  }
  if (nodes.length === 0) return undefined;
  return rotationRaw === undefined ? { nodes } : { nodes, rotation: Number(rotationRaw) };
}

function attributesOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) {
    const name = m[1];
    const value = m[2];
    if (name === undefined || value === undefined) continue;
    out[name] = decodeXmlEntities(value);
  }
  return out;
}

function nodeFrom(depth: number, attrs: Record<string, string>): HierarchyNode {
  const bounds = parseBounds(attrs["bounds"]);
  return {
    depth,
    text: attrs["text"] ?? "",
    contentDesc: attrs["content-desc"] ?? "",
    resourceId: attrs["resource-id"] ?? "",
    class: attrs["class"] ?? "",
    package: attrs["package"] ?? "",
    ...(bounds === undefined ? {} : { bounds }),
    clickable: attrs["clickable"] === "true",
    longClickable: attrs["long-clickable"] === "true",
    enabled: attrs["enabled"] === "true",
    scrollable: attrs["scrollable"] === "true",
    focused: attrs["focused"] === "true",
    selected: attrs["selected"] === "true",
    checked: attrs["checked"] === "true",
    password: attrs["password"] === "true",
  };
}
