/**
 * G5 Tier 3: the live half of the conformance story, scripted so it stops
 * living in someone's memory. Two layers, never merged into one verdict:
 *
 *   declared — `dsh --dump-config` composes the tree with our bundle patch.
 *              This proves the patch is *well formed*, not that anything mounted
 *              (rule R6; and R25: it does not overturn a stronger live finding).
 *   live     — the session log, the only durable truth about what a session
 *              actually did (rule R24). Tool *invocation* is visible here;
 *              tool *registration* is not — that is `cordis_inspect_query` /
 *              the roster's `broken` flag (rule R9), which needs the running app.
 *
 *   node plugins/autogamer-device/scripts/conformance-live.mjs \
 *     --expect-tool run_device_action --expect-tool report_task_status
 *
 * Env: DSH_BIN overrides the launcher path; AUTOGAMER_SESSION picks a session id.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const flagList = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? [] : process.argv.slice(i + 1).filter((v) => !v.startsWith("--"));
};

const profile = arg("profile", "web");
const patch = resolve(arg("patch", join(PLUGIN_ROOT, "cordis.patch.yml")));
const dshBin = arg("dsh", process.env.DSH_BIN ?? "D:/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd");
const expectTools = flagList("expect-tool");
const cwd = resolve(arg("cwd", join(PLUGIN_ROOT, "spike")));

function declaredLayer() {
  // A .cmd launcher has to go through the shell on Windows, and the install
  // directory contains a space — quote it or the shell runs "D:/DeepSeek".
  const run = spawnSync(`"${dshBin}"`, ["--profile", profile, "--patch", patch, "--dump-config"], {
    encoding: "utf8",
    shell: true,
  });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const rows = ["preset-autogamer", "persona", "skill-filesystem", "tool-plugin-manager"];
  console.log(`[declared] dsh --profile ${profile} --dump-config exit=${run.status}`);
  console.log(`[declared] unmatched hits: ${(out.match(/unmatched/gi) ?? []).length}`);
  for (const row of rows) {
    console.log(`[declared]   row ${row}: ${out.includes(row) ? "present" : "ABSENT"}`);
  }
  return run.status === 0 && !/unmatched/i.test(out);
}

/** Workspace session logs are keyed by the sanitized cwd, wrapped in `--`. */
function sessionDir() {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  // DSH collapses runs of separators: "D:\DEV\x" → "--D-DEV-x--".
  const ws = join(dshHome, "sessions", `--${cwd.replace(/[^A-Za-z0-9]+/g, "-")}--`);
  if (!existsSync(ws)) throw new Error(`no session directory for ${ws} — run a spike first or pass --cwd`);
  const wanted = process.env.AUTOGAMER_SESSION;
  const dirs = readdirSync(ws)
    .filter((name) => name.startsWith("session-"))
    .map((name) => join(ws, name))
    .filter((p) => existsSync(join(p, "session.v4.jsonl.zstd")));
  const chosen = wanted ? dirs.find((p) => p.endsWith(wanted)) : dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!chosen) throw new Error(wanted ? `session ${wanted} not under ${ws}` : `no readable session under ${ws}`);
  return chosen;
}

/** One zstd frame per record, so the stream reader is the only correct form. */
function readSession(dir) {
  const script = `import json,sys,zstandard
with open(sys.argv[1],'rb') as fh, zstandard.ZstdDecompressor().stream_reader(fh) as r:
    raw=r.read()
print(json.dumps([json.loads(l) for l in raw.decode('utf-8').splitlines() if l.strip()]))`;
  const out = execFileSync("uv", ["run", "python", "-c", script, join(dir, "session.v4.jsonl.zstd")], {
    cwd: resolve(PLUGIN_ROOT, "../.."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out.trim());
}

function liveLayer(records) {
  const types = new Map();
  const calls = new Map();
  for (const record of records) {
    types.set(record.type, (types.get(record.type) ?? 0) + 1);
    if (record.type === "tool/call" && record.data?.name) {
      calls.set(record.data.name, (calls.get(record.data.name) ?? 0) + 1);
    }
  }
  console.log(`\n[live] ${records.length} session records`);
  console.log(`[live] event types: ${[...types].map(([t, n]) => `${t}=${n}`).sort().join(" ")}`);
  console.log(`[live] tools invoked: ${[...calls].map(([t, n]) => `${t}=${n}`).sort().join(" ") || "none"}`);
  // Turn accounting is what G41/G44 rest on: every turn must end, and the
  // plugin's own nudge only makes sense when a turn ended without a report.
  const ended = types.get("turn/end") ?? 0;
  const reported = calls.get("report_task_status") ?? 0;
  console.log(`[live] turn/end=${ended} report_task_status=${reported}${ended > reported ? " (a turn ended unreported → nudge path)" : ""}`);
  const missing = expectTools.filter((name) => !calls.has(name));
  for (const name of expectTools) {
    console.log(`[live] expected tool ${name}: ${calls.has(name) ? `called ${(calls.get(name) ?? 0)}x` : "NOT INVOKED"}`);
  }
  console.log(`[live] NOTE: registration is not observable here — verify it with cordis_inspect_query / the roster (R9).`);
  return missing.length === 0;
}

const dir = sessionDir();
console.log(`[live] session: ${basename(dir)}  (workspace cwd: ${cwd})`);
const declared = declaredLayer();
const live = liveLayer(readSession(dir));
console.log(`\nverdict: declared=${declared ? "ok" : "FAIL"} live=${live ? "ok" : "FAIL"}`);
if (!declared || !live) process.exitCode = 1;
if (!live) {
  console.error("A tool that was never invoked may simply not have been asked for; re-run the task, and check registration separately before calling this a plugin defect.");
}
