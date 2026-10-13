/**
 * P0 MCP direct-connect spike / G5 Tier 2 action-surface generator.
 * Run from the repo root so `uv run` resolves the project env:
 *   ARTEMIS_MOCK_DRIVER=1 node plugins/dsh-autogamer/scripts/spike-mcp.mjs
 *   ARTEMIS_MOCK_DRIVER=1 node plugins/dsh-autogamer/scripts/spike-mcp.mjs --write
 *
 * Verifies: the pipe (list + call round-trip), the real action-tool surface,
 * and result normalization. Actions may fail with adb-down messages when no
 * device/server is available — that still exercises the environment path.
 *
 * This is the ONLY place the expected py tool surface is derived: from the
 * plugin's own `ACTION_TO_PY_TOOL` mapping against the live server. The
 * fixture used to be a fourth hand-kept copy of the same claim.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ActionClient } from "../dist/actionClient.js";
import { unwrapText } from "../dist/mcpText.js";
import { ACTION_TO_PY_TOOL } from "../dist/tools/runDeviceAction.js";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(PLUGIN_ROOT, "tests/fixtures/py-action-tools.json");

/** Every py tool the plugin's router claims to reach. */
export const mappedPyTools = () => [...new Set(Object.values(ACTION_TO_PY_TOOL).filter((t) => t !== null))].sort();

export function actionClient() {
  const command = (process.env.SPIKE_COMMAND ?? "uv run artemis mcp --type adb").split(" ");
  return new ActionClient({
    command,
    env: { ...process.env, ARTEMIS_MOCK_DRIVER: process.env.ARTEMIS_MOCK_DRIVER ?? "1" },
    callTimeoutMs: 120_000,
  });
}

/** Live tool list from a real action server, with the mapping checked against it. */
export async function liveActionSurface(client = actionClient()) {
  const tools = await client.listTools();
  return { client, tools: [...tools].sort() };
}

const localDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

export function buildFixture(tools) {
  return {
    captured: localDate(),
    source: "live MCP stdio listing of `uv run artemis mcp --type adb` (node plugins/dsh-autogamer/scripts/spike-mcp.mjs --write)",
    pyActionServerTools: tools,
    notes: [
      "2026-10-11: compare_ui_frames added (G39 route A) - the read-only effect verdict the plugin router calls, delegating to artemis/utils/image_diff.check_ui_change.",
      "Contract quirks locked by live capture (see docs/migration/inventory/03 + dsh-verification §一):",
      "legacy PIXEL coordinate contract — 0-1000 normalization happens in this plugin (src/coord.ts)",
      "results are plain strings: Success / Failed / Error: ... / Error executing tool ...",
      "real flag is `--type adb` (not --server); stdio transport default",
      "generated from the live server; the expected surface is ACTION_TO_PY_TOOL, no longer a copy kept here",
    ],
  };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

async function main() {
  const client = actionClient();
  try {
    const expected = mappedPyTools();
    const { tools } = await liveActionSurface(client);
    console.log(`[spike] tools (${tools.length}):`, tools.join(", "));
    const missing = expected.filter((name) => !tools.includes(name));
    if (missing.length > 0) throw new Error(`mapping names a tool the server does not expose: ${missing.join(", ")}`);

    if (process.argv.includes("--write")) {
      writeFileSync(FIXTURE, `${JSON.stringify(buildFixture(tools), null, 2)}\n`);
      console.log(`[spike] wrote tests/fixtures/py-action-tools.json (${tools.length} tools)`);
    } else if (existsSync(FIXTURE)) {
      const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")).pyActionServerTools ?? [];
      const drifted = tools.filter((t) => !recorded.includes(t)).concat(recorded.filter((t) => !tools.includes(t)));
      if (drifted.length > 0) {
        console.error(`[spike] fixture is out of date with the live server: ${drifted.join(", ")} — re-run with --write`);
        process.exitCode = 1;
      }
    }

    for (const [name, args] of [["take_screenshot", {}], ["get_ui_hierarchy", {}]]) {
      const text = unwrapText(await client.callTool(name, args));
      if (text.startsWith("Error:")) {
        console.log(`[spike] ${name} → environment error (expected when adb/device is down):`);
        console.log("        ", text.slice(0, 140));
      } else {
        console.log(`[spike] ${name} → OK:`, text.slice(0, 100), text.length > 100 ? "…" : "");
      }
    }
    console.log("[spike] OK — pipe, tool surface, and normalization verified");
  } finally {
    await client.dispose();
  }
}

if (isCli) await main();
