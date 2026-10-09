/**
 * Conformance contract skeleton (P0/G5). These tests lock the externally
 * observable contracts this plugin depends on, using fixtures recorded from
 * live verification. Re-capture the fixtures whenever the DSH runtime or the
 * py action server upgrades:
 *   - py action tools:  ARTEMIS_MOCK_DRIVER=1 node scripts/spike-mcp.mjs
 *   - DSH peer version: read DSH desktop release notes / installed runtime.json
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ACTION_TO_PY_TOOL, ACTIONS } from "../../src/tools/runDeviceAction.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures", import.meta.url));

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${fixtureRoot}/${name}`, "utf8"));
}

describe("conformance: py action server surface", () => {
  const fixture = readFixture("py-action-tools.json");
  const realTools = fixture.pyActionServerTools as string[];

  it("every mapped py tool exists in the live action server surface", () => {
    const mapped = Object.values(ACTION_TO_PY_TOOL).filter((t): t is string => t !== null);
    const unknown = mapped.filter((tool) => !realTools.includes(tool));
    expect(unknown).toEqual([]);
  });

  it("covers every agent action with a py mapping", () => {
    expect(Object.keys(ACTION_TO_PY_TOOL).sort()).toEqual([...ACTIONS].sort());
  });

  it("fixture records the 13-tool legacy contract", () => {
    expect(realTools).toHaveLength(13);
    expect(realTools).toContain("tap");
    expect(realTools).toContain("focus_and_input_text");
    expect(realTools).not.toContain("click"); // real name is `tap`
    expect(realTools).not.toContain("input_text"); // real name is `focus_and_input_text`
  });
});

describe("conformance: legacy web-console SSE event names (G18 baseline)", () => {
  const fixture = readFixture("sse-events.json");
  const serverEvents = fixture.serverEventNames as string[];

  it("locks the 15 documented server event names", () => {
    expect(serverEvents).toHaveLength(15);
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

  it("records which events the old frontend never subscribed to (dead channels)", () => {
    const dead = fixture.serverBroadcastButFrontendNeverSubscribed as string[];
    expect(dead).toEqual(["queue_held", "queue_paused", "queue_resumed", "note_saved", "llm_stream_downgrade"]);
  });
});

describe("conformance: DSH peer version pin", () => {
  it("pins the verified runtime generation", () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
    ) as { peerDependencies?: Record<string, string> };
    const peers = manifest.peerDependencies ?? {};
    for (const [pkg, range] of Object.entries(peers)) {
      expect(pkg, "peer dependency should target @deepseek-ai scope").toMatch(/^@deepseek-ai\//);
      expect(range, `${pkg} must pin the verified generation`).toBe("0.2.0-rc.2");
    }
    expect(Object.keys(peers).length).toBeGreaterThan(0);
  });
});
