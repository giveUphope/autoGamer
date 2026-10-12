/**
 * Conformance contracts (P0/G5). Each section names the runtime or source it
 * reads its truth from, and none of them is a hand-typed list any more:
 *   - py action tools : live MCP server (scripts/spike-mcp.mjs) / its fixture
 *   - legacy SSE names: extracted from the emitters and subscriptions in this repo
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
import { ACTION_TO_PY_TOOL, ACTIONS } from "../../src/tools/runDeviceAction.js";
import { buildFixture, mappedPyTools } from "../../scripts/spike-mcp.mjs";
import { extractLegacySseEvents, findUnreviewedEmitters, namesByEmitter } from "../../scripts/gen-sse-events.mjs";
import { typescriptFiles } from "../support/srcFiles.js";

/** Minimal view of a Schemastery object node (the package exports no type name). */
type SchemaObject = {
  type: string;
  dict: Record<string, { type: string }>;
};
type ConfigCallable = (data?: unknown) => Record<string, unknown>;

const fixtureRoot = fileURLToPath(new URL("../fixtures", import.meta.url));

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${fixtureRoot}/${name}`, "utf8"));
}

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { peerDependencies?: Record<string, string> };

describe("conformance: py action server surface", () => {
  const fixture = readFixture("py-action-tools.json");
  const realTools = fixture.pyActionServerTools as string[];

  it("every mapped py tool exists in the action server surface", () => {
    const unknown = mappedPyTools().filter((tool: string) => !realTools.includes(tool));
    expect(unknown).toEqual([]);
  });

  it("covers every agent action with a py mapping", () => {
    expect(Object.keys(ACTION_TO_PY_TOOL).sort()).toEqual([...ACTIONS].sort());
  });

  it("the fixture is a generated record, not a list someone maintains by hand", () => {
    // Same builder the --write path uses, so a hand-typed name or a name added
    // out of order fails here even without a live server (the live drift check
    // is `node scripts/spike-mcp.mjs`, which CI runs).
    const generated = buildFixture(realTools);
    expect(String(fixture.source)).toContain("spike-mcp.mjs");
    expect(fixture.source).toBe(generated.source);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(String(fixture.captured)), "captured must be a date stamp").toBe(true);
    expect(realTools, "the generator emits a sorted, deduplicated list").toEqual(
      [...new Set(realTools)].sort(),
    );
  });

  it("covers every py tool this plugin calls, including the ones outside the mapping", () => {
    // `compare_ui_frames` (G39 route A) is called directly from index.ts, so a
    // mapping-only check would not notice the server renaming it. Build-phase
    // transport calls go through the `callTransport` wrapper (G33: a dead
    // server must classify environment, never task/internal), which the
    // extractor reads with the same spelling.
    // `list_devices` (G64) joins for the same reason: the pool asks the server who is attached,
    // and that call is not a device action, so no action mapping would ever cover it.
    const direct = new Set<string>();
    for (const file of typescriptFiles(fileURLToPath(new URL("../../src", import.meta.url)))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/client\.callTool\(\s*"([a-z_]+)"/g)) direct.add(match[1]);
      for (const match of text.matchAll(/callTransport\(\s*client\s*,\s*"([a-z_]+)"/g)) direct.add(match[1]);
    }
    expect([...direct].sort(), "src should still contain direct call sites").toEqual([
      "compare_ui_frames",
      "get_ui_hierarchy",
      "list_devices",
      "take_screenshot",
    ]);
    const unreachable = [...direct].filter((tool) => !realTools.includes(tool));
    expect(unreachable, "the plugin calls py tools the server does not expose").toEqual([]);
    expect(realTools.length, "the recorded surface should never shrink silently").toBeGreaterThanOrEqual(14);
  });

  // Opt-in, because it costs a real server spawn: `AUTOGAMER_CONFORMANCE_PY=live`.
  // CI keeps `npm test` timing-independent; run the same comparison locally with
  // `node scripts/spike-mcp.mjs`, which exits non-zero on drift.
  it.skipIf(process.env.AUTOGAMER_CONFORMANCE_PY !== "live")(
    "the live action server still exposes the recorded surface",
    async () => {
      const { liveActionSurface } = await import("../../scripts/spike-mcp.mjs");
      const spawned = (await import("../../scripts/spike-mcp.mjs")).actionClient();
      try {
        const { tools } = await liveActionSurface(spawned);
        expect(tools).toEqual(realTools);
        for (const tool of mappedPyTools()) expect(tools).toContain(tool);
      } finally {
        await spawned.dispose();
      }
    },
  );
});

describe("conformance: legacy web-console SSE event names (G18 baseline)", () => {
  const fixture = readFixture("sse-events.json");

  it("matches the events the backend actually emits and the console actually subscribes to", () => {
    const fresh = extractLegacySseEvents();
    for (const key of [
      "serverEventNames",
      "frontendSubscribedEventNames",
      "serverBroadcastButFrontendNeverSubscribed",
      "frontendSubscribesButServerNeverEmits",
    ] as const) {
      expect(fixture[key], `${key} drifted from the sources; re-run gen-sse-events.mjs --write`).toEqual(fresh[key]);
    }
  });

  it("keeps a floor and per-funnel coverage so the extractor cannot rot quietly", () => {
    // The test above compares the fixture against the same generator, so a
    // generator that lost an emitter would move both sides together. These are
    // the independent bounds: enough names, and every reviewed funnel speaking.
    const server = fixture.serverEventNames as string[];
    expect(server.length, "server-side emissions should never shrink silently").toBeGreaterThanOrEqual(20);
    const byFunnel = namesByEmitter();
    expect(Object.keys(byFunnel).sort()).toEqual(["_broadcast_event", "_publish", "_record_llm_event"]);
    for (const [funnel, names] of Object.entries(byFunnel)) {
      expect(names.length, `${funnel} contributes no names - the extractor stopped seeing it`).toBeGreaterThan(0);
      for (const name of names) expect(server, `${name} from ${funnel} is missing`).toContain(name);
    }
    // Nothing emitter-shaped may be left unreviewed, or the vocabulary is a subset.
    expect(findUnreviewedEmitters(), "unreviewed emitter-shaped calls exist").toEqual([]);
  });

  it("keeps the events the DSH plugin must replace in view", () => {
    const serverEvents = fixture.serverEventNames as string[];
    for (const required of [
      "session_started",
      "session_ended",
      "step_recorded",
      "startup_progress",
      "recording_ready",
      "queue_held",
      "server_shutdown",
    ]) {
      expect(serverEvents).toContain(required);
    }
  });
});

describe("conformance: DSH peer version pin", () => {
  const scopeDir = fileURLToPath(new URL("../../node_modules/@deepseek-ai", import.meta.url));

  it("pins every installed harness package to one verified generation", () => {
    const peers = Object.entries(manifest.peerDependencies ?? {});
    expect(peers.length, "peerDependencies must state the verified generation").toBeGreaterThan(0);
    for (const [pkg, range] of peers) {
      expect(pkg, "peer dependency should target @deepseek-ai scope").toMatch(/^@deepseek-ai\//);
      expect(range, `${pkg} must pin the same generation`).toBe(peers[0][1]);
    }

    const installed = readdirSync(scopeDir)
      .filter((name) => name.startsWith("dsh-"))
      .map((name) => [name, JSON.parse(readFileSync(join(scopeDir, name, "package.json"), "utf8")).version as string]);
    expect(installed.length, "no @deepseek-ai/dsh-* packages installed").toBeGreaterThan(0);
    for (const [name, version] of installed) {
      expect(version, `${name} is not the pinned generation`).toBe(peers[0][1]);
    }
    // The pin must be carried by something the test graph actually boots, or it
    // could drift away from the runtime it claims to describe.
    const peerNames = peers.map(([pkg]) => pkg.replace("@deepseek-ai/", ""));
    expect(installed.map(([name]) => name).filter((name) => peerNames.includes(name))).toContain("dsh-tools");
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
    expect({} instanceof Schema).toBe(false);
    expect(null instanceof Schema).toBe(false);
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
        "actionServerCommand",
        "actionServerEnv",
        "allowedFails",
        "breakerCooldownMs",
        "defaultDeviceKey",
        "devices",
        "discoverDevices",
        "maxConcurrentDevices",
        "screenSize",
        "strictness",
      ].sort(),
    );
    for (const [name, sub] of Object.entries(fields)) {
      expect(sub instanceof Schema, `${name} must be a native Schemastery schema`).toBe(true);
    }
    expect(fields.actionServerCommand.type).toBe("array");
    expect(fields.actionServerEnv.type).toBe("dict");
    expect(fields.screenSize.type).toBe("tuple");
    // G3/G28: the roster is an array of serials and the ceiling a plain number.
    expect(fields.devices.type).toBe("array");
    expect(fields.maxConcurrentDevices.type).toBe("number");
    expect(fields.discoverDevices.type).toBe("boolean");
  });

  it("applies declared defaults and leaves the un-defaulted tuple null-filled", () => {
    const resolved = (Config as ConfigCallable)();
    expect(resolved.actionServerCommand).toEqual([
      "python",
      "-m",
      "artemis.interfaces.cli.main",
      "mcp",
      "--type",
      "adb",
    ]);
    expect(resolved.actionServerEnv).toEqual({});
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
    // The trap `configuredScreenSize()` exists to survive: an unset optional
    // tuple comes back as a truthy `[undefined, undefined]` array, never
    // undefined, so `if (config.screenSize)` always looks "configured".
    expect(Array.isArray(resolved.screenSize)).toBe(true);
    expect(Boolean(resolved.screenSize), "unset tuple is still a truthy array").toBe(true);
    expect(resolved.screenSize).toEqual([undefined, undefined]);
  });

  it("rejects a malformed value rather than coercing it silently", () => {
    expect(() => (Config as ConfigCallable)({ actionServerCommand: "not-an-array" })).toThrow();
  });
});
