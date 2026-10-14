/**
 * Conformance contracts (P0/G5). Each section names the runtime or source it
 * reads its truth from, and none of them is a hand-typed list any more:
 *   - action surface  : the frozen 2026-10-13 capture, partitioned against what
 *                       answers each name today (T4 - the live server is gone)
 *   - DSH generation  : the @deepseek-ai/* packages actually installed
 *   - session events  : KNOWN_SESSION_EVENT_TYPES exported by @deepseek-ai/dsh-session
 * The in-process real-runtime assertions live in runtimeBoot.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Schema from "@deepseek-ai/schemastery";
import { KNOWN_SESSION_EVENT_TYPES, SESSION_FORMAT_VERSION } from "@deepseek-ai/dsh-session";
import { Config } from "../../src/index.js";
import { configOf } from "../support/config.js";
import { runNativeAction } from "../../src/device/act.js";
import { typescriptFiles } from "../support/srcFiles.js";

/** Minimal view of a Schemastery object node (the package exports no type name). */
type SchemaObject = {
  type: string;
  dict: Record<string, { type: string }>;
};

const fixtureRoot = fileURLToPath(new URL("../fixtures", import.meta.url));

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${fixtureRoot}/${name}`, "utf8"));
}

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { peerDependencies?: Record<string, string> };

/**
 * The surface this plugin took over, partitioned against its frozen record.
 *
 * `py-action-tools.json` is the 2026-10-13 live listing of the external
 * provider's action server - the set of answers the plugin used to have to get.
 * The live comparison went with the provider (D19: this branch has no python to
 * spawn), so the lock is now the partition below: every recorded name is either
 * answered natively over adb, answered locally by the router, or dropped with a
 * recorded reason. A name added to the fixture without landing in one of the
 * three groups is red, and so is a group that stops matching the record.
 */
describe("conformance: the action surface we took over", () => {
  const fixture = readFixture("py-action-tools.json");
  const recorded = fixture.pyActionServerTools as string[];

  /** Answered by `src/device/act.ts` over adb. */
  const NATIVE = [
    "tap",
    "long_press_on",
    "swipe",
    "press_key",
    "back",
    "erase_one_char",
    "focus_and_input_text",
    "focus_and_clear_text",
    "launch_app",
    "stop_app",
    "open_link",
  ];
  /** Answered inside the router, without a device call. */
  const LOCAL = ["take_screenshot", "get_ui_hierarchy"];
  /** Deliberately not answered any more, each with the slice that decided it. */
  const DROPPED: Record<string, string> = {
    list_devices: "T2-a: the roster is `adb devices -l` folded by android_id (G75)",
    compare_ui_frames: "T3 (G84): the verdict is computed from the two frames locally",
  };

  it("the three groups cover the recorded surface exactly, once each", () => {
    const partition = [...NATIVE, ...LOCAL, ...Object.keys(DROPPED)];
    expect(partition.sort()).toEqual([...recorded].sort());
    expect(new Set(partition).size, "a name cannot be both kept and dropped").toBe(partition.length);
    for (const [name, reason] of Object.entries(DROPPED)) {
      expect(reason, `${name} needs a recorded reason`).toMatch(/^T\d/);
    }
  });

  it("every native name has a case in the device seam", async () => {
    for (const name of NATIVE) {
      // The empty payload is deliberate: the case must be REACHED (its own
      // "needs coordinates" refusal), which is what proves the seam implements
      // the name. The fake adb answers nothing here.
      const answer = await runNativeAction({ tool: name, payload: {} }, "emulator-5554", {});
      expect(answer, `${name} is not implemented in src/device/act.ts`).not.toMatch(/unsupported action/);
    }
  });

  it("and a name outside the record really is refused, so the check above has teeth", async () => {
    const answer = await runNativeAction({ tool: "no_such_call", payload: {} }, "emulator-5554", {});
    expect(answer).toContain("unsupported action no_such_call");
  });

  it("the record is a dated capture, not a list someone maintains by hand", () => {
    expect(/^\d{4}-\d{2}-\d{2}$/.test(String(fixture.captured)), "captured must be a date stamp").toBe(true);
    expect(String(fixture.source)).toContain("live MCP stdio listing");
    expect(recorded, "the capture is a sorted, deduplicated list").toEqual([...new Set(recorded)].sort());
    expect(recorded.length, "the recorded surface should never shrink silently").toBeGreaterThanOrEqual(15);
  });

  it("src contains no call site left for the provider's transport", () => {    // T2-c/d/e closed the last of them: gestures, text, apps, the screenshot and
    // the hierarchy all run over adb (`src/device/`), and the effect verdict has
    // been local since T3. The lock is a BAN: reintroducing a direct call turns
    // it red. The G33 rule about classifying a dead transport now lives on the
    // adb seam, where a vanished device still says so.
    const direct = new Set<string>();
    for (const file of typescriptFiles(fileURLToPath(new URL("../../src", import.meta.url)))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/client\.callTool\(\s*"([a-z_]+)"/g)) { if (match[1]) direct.add(match[1]); }
      for (const match of text.matchAll(/callTransport\(\s*client\s*,\s*"([a-z_]+)"/g)) { if (match[1]) direct.add(match[1]); }
    }
    expect([...direct].sort(), "src must contain no direct action-server call sites").toEqual([]);
  });

  /**
   * The deletion half of T4, locked so it stays deleted: the action-server
   * client, its text unwrapper, the mirror surface and the python-provider
   * config fields. A resurrected import fails the name scan; a resurrected file
   * fails the path scan.
   */
  it("the surfaces T4 removed stay removed", () => {
    const srcRoot = fileURLToPath(new URL("../../src", import.meta.url));
    const gone = ["scrcpy/server.ts", "scrcpy/input.ts", "actionClient.ts", "mcpText.ts"];
    for (const file of gone) {
      expect(existsSync(join(srcRoot, file)), `src/${file} was removed in T4`).toBe(false);
    }
    const banned = /ScrcpyManager|ACTION_TO_PY_TOOL|unwrapText|uvPath|artemisRepoPath|scrcpyEnabled/;
    const hits: string[] = [];
    for (const file of typescriptFiles(srcRoot)) {
      const text = readFileSync(file, "utf8");
      for (const [index, line] of text.split(/\r?\n/).entries()) {
        if (banned.test(line)) hits.push(`${file.slice(srcRoot.length + 1)}:${index + 1}`);
      }
    }
    expect(hits, "no source line may name a removed surface").toEqual([]);
  });
});


describe("conformance: DSH peer version pin", () => {
  const scopeDir = fileURLToPath(new URL("../../node_modules/@deepseek-ai", import.meta.url));

  it("pins every installed harness package to one verified generation", () => {
    const peers = Object.entries(manifest.peerDependencies ?? {});
    expect(peers.length, "peerDependencies must state the verified generation").toBeGreaterThan(0);
    const pinned = peers[0]?.[1];
    expect(pinned, "no peer dependency is declared").toBeTypeOf("string");
    for (const [pkg, range] of peers) {
      expect(pkg, "peer dependency should target @deepseek-ai scope").toMatch(/^@deepseek-ai\//);
      expect(range, `${pkg} must pin the same generation`).toBe(pinned);
    }

    const installed = readdirSync(scopeDir)
      .filter((name) => name.startsWith("dsh-"))
      .map((name) => [name, JSON.parse(readFileSync(join(scopeDir, name, "package.json"), "utf8")).version as string]);
    expect(installed.length, "no @deepseek-ai/dsh-* packages installed").toBeGreaterThan(0);
    for (const [name, version] of installed) {
      expect(version, `${name} is not the pinned generation`).toBe(pinned);
    }
    // The pin must be carried by something the test graph actually boots, or it
    // could drift away from the runtime it claims to describe.
    const peerNames = peers.map(([pkg]) => pkg.replace("@deepseek-ai/", ""));
    expect(installed.map(([name]) => name ?? "").filter((name) => peerNames.includes(name))).toContain("dsh-tools");
  });

  it("cross-checks the pin against a locally installed DSH runtime when there is one", () => {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
    const runtimes = join(dshHome, "dsh-runtimes");
    const candidates = existsSync(runtimes) ? readdirSync(runtimes) : [];
    const found = candidates
      .map((dir) => join(runtimes, dir, "runtime.json"))
      .filter((path) => existsSync(path))
      .map((path) => JSON.parse(readFileSync(path, "utf8")).desktopVersion as string);
    if (found.length === 0) {
      // No desktop install in this environment (CI is one): the pin still has
      // to name a released generation, which the check above already enforced.
      return;
    }
    const pin = manifest.peerDependencies?.["@deepseek-ai/dsh-agent-preset"] ?? "";
    for (const version of found) {
      expect(version.split(".").slice(0, 2).join("."), "pinned generation vs installed runtime").toBe(
        pin.split(".").slice(0, 2).join("."),
      );
    }
  });
});

/**
 * G44 keys the turn-end enforcement off `turn/end`, and R17 off session format
 * V4. Both were claims copied out of docs; the packages now say it directly.
 */
describe("conformance: real DSH session vocabulary", () => {
  const known = KNOWN_SESSION_EVENT_TYPES as ReadonlySet<string>;

  it("the session event types this plugin relies on are real", () => {
    for (const type of ["turn/end", "turn/start", "tool/call", "tool/result", "user/message"]) {
      expect(known.has(type), `${type} is not in KNOWN_SESSION_EVENT_TYPES (${known.size} entries)`).toBe(true);
    }
  });

  it("the session log is still the format the plugin's message shape assumes", () => {
    expect(SESSION_FORMAT_VERSION).toBe(4);
  });
});

/**
 * The loader rejects foreign schema objects ("Config is not a native
 * Schemastery schema"), and a plugin row whose Config is missing is reported
 * as status=absent — which silently skips the preset-scope child mount, i.e.
 * the tools never register. Both failure modes are locked here; runtimeBoot.spec
 * proves the loader side of the second one by refusing a bad config.
 */
describe("conformance: plugin Config is a native Schemastery schema", () => {
  const schemaSymbols = new Set(Object.getOwnPropertySymbols(Schema.prototype).map(String));

  it("carries the Schemastery brand symbol on the prototype", () => {
    // Guards the discriminator itself: if instanceof ever stops meaning
    // "native", the assertions below would pass vacuously.
    expect(schemaSymbols).toContain("Symbol(schemastery)");
    expect(({} as object) instanceof Schema).toBe(false);
    expect((null as unknown) instanceof Schema).toBe(false);
  });

  it("exports a native object schema at the top level", () => {
    expect(Config instanceof Schema, "Config must be a native Schemastery schema").toBe(true);
    expect((Config as SchemaObject).type).toBe("object");
  });

  it("declares every field natively — a mixed zod/Schemastery schema is a half migration", () => {
    const fields = (Config as SchemaObject).dict;
    expect(Object.keys(fields).sort()).toEqual(
      [
        "actionCallTimeoutMs",
        "allowedFails",
        "artemisMcpCommand",
        "autoPreflight",
        "breakerCooldownMs",
        "defaultDeviceKey",
        "defaultDeviceSerial",
        "defaultProfile",
        "defaultTimeoutSeconds",
        "devices",
        "discoverDevices",
        "maxConcurrentDevices",
        "ocrEnabled",
        "ocrLanguages",
        "ocrTimeoutMs",
        "screenSize",
        "strictness",
        "traceRetentionDays",
      ].sort(),
    );
    for (const [name, sub] of Object.entries(fields)) {
      expect(sub instanceof Schema, `${name} must be a native Schemastery schema`).toBe(true);
    }
    // T2-c/d/e took the action-server command/env fields away; T4-a/c took the
    // python-provider ones (uvPath, artemisRepoPath) and the whole mirror surface
    // (scrcpy*) away with them. A lock that kept any of them in the declared
    // surface would be locking a capability the plugin no longer has — and
    // `artemisMcpCommand` is the one provider field that stays, because spec §一.3
    // keeps the optional external provider (see its default below: empty).
    expect(fields.screenSize?.type).toBe("tuple");
    // G3/G28: the roster is an array of serials and the ceiling a plain number.
    expect(fields.devices?.type).toBe("array");
    expect(fields.maxConcurrentDevices?.type).toBe("number");
    expect(fields.discoverDevices?.type).toBe("boolean");
  });

  it("applies declared defaults and leaves the un-defaulted tuple null-filled", () => {
    const resolved = configOf();
    expect(resolved.defaultDeviceKey).toBe("default");
    expect(resolved.allowedFails).toBe(1);
    expect(resolved.breakerCooldownMs).toBe(30_000);
    expect(resolved.strictness).toBe("final");
    expect(resolved.actionCallTimeoutMs).toBe(30_000);
    // G3/G28 defaults must equal the historical behaviour: no roster, no ceiling.
    expect(resolved.devices).toEqual([]);
    expect(resolved.maxConcurrentDevices).toBe(0);
    // G64 discovery stays off by default: turning it on spreads auto calls across machines,
    // which is a scheduling-semantics change and therefore an explicit operator decision.
    expect(resolved.discoverDevices).toBe(false);
    // T4: the optional external provider defaults to **nothing configured** -
    // an empty argv means the plugin never spawns anything for it (spec §一.3
    // keeps the capability, D19 forbids shipping or assuming a python stack).
    expect(resolved.artemisMcpCommand).toEqual([]);
    expect(resolved.defaultProfile).toBe("flash");
    expect(resolved.defaultTimeoutSeconds).toBe(1800);
    expect(resolved.defaultDeviceSerial).toBe("");
    expect(resolved.autoPreflight).toBe(true);
    expect(resolved.traceRetentionDays).toBe(7);
    // T5: OCR is on with both packaged languages and its own timeout.
    expect(resolved.ocrEnabled).toBe(true);
    expect(resolved.ocrLanguages).toBe("eng+chi_sim");
    expect(resolved.ocrTimeoutMs).toBe(8_000);
    // The trap `configuredScreenSize()` exists to survive: an unset optional
    // tuple comes back as a truthy `[undefined, undefined]` array, never
    // undefined, so `if (config.screenSize)` always looks "configured".
    expect(Array.isArray(resolved.screenSize)).toBe(true);
    expect(Boolean(resolved.screenSize), "unset tuple is still a truthy array").toBe(true);
    expect(resolved.screenSize).toEqual([undefined, undefined]);
  });

  it("rejects a malformed value rather than coercing it silently", () => {
    expect(() => configOf({ allowedFails: "many" })).toThrow();
    expect(() => configOf({ screenSize: "720x1600" })).toThrow();
  });
});
