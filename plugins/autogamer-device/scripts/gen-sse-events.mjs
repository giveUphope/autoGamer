/**
 * G5 Tier 2: generate the legacy web-console SSE contract fixture from the
 * code that actually emits and subscribes, instead of a hand-typed list that
 * rots the moment either side changes.
 *
 *   node plugins/autogamer-device/scripts/gen-sse-events.mjs          # check for drift
 *   node plugins/autogamer-device/scripts/gen-sse-events.mjs --write  # regenerate fixture
 *
 * What it resolves: a literal name at the call site (`_publish("x"`), a module
 * constant (`publish(CHECKER_EVENT` with `CHECKER_EVENT = "checker_event"`), and
 * an alias bound to a funnel (`publish = getattr(engine, "_publish", None)`).
 * A name computed at runtime is still invisible — that is a real limit of
 * reading source instead of running it; the guard is that any *other*
 * emitter-shaped call is reported (`findUnreviewedEmitters`), so a new funnel or
 * an indirect call has to be looked at rather than silently dropped.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PLUGIN_ROOT, "../..");
const FIXTURE = join(PLUGIN_ROOT, "tests/fixtures/sse-events.json");

const SERVER_ROOTS = ["artemis", "apps/admin_console"];
const FRONTEND_FILE = "apps/showcase_ui_v2/src/stores/stream.ts";

/**
 * The three verified `/api/stream` funnels, each checked by reading its body:
 *   `_publish`            — DataEngine._publish (artemis/data_engine/engine.py:541)
 *   `_broadcast_event`    — TaskQueueService._broadcast_event (…/task_queue_service.py:256)
 *   `_record_llm_event`   — forwards to engine._publish (artemis/services/llm.py:231)
 */
const EMITTERS = ["_publish", "_broadcast_event", "_record_llm_event"];

/** Callee names reviewed and deliberately kept out of the event vocabulary. */
const REVIEWED_EXCLUSIONS = [
  "publish_startup_progress", // first arg is a stage label, not an event name
  "_event", // artemis/graph — the langgraph stack, not the console stream
  "_final_event",
  "emit", // artemis/runtime/helper_manager.py:685 — a device-provisioning callback
];

/** Names may contain hyphens (`keep-alive`); the router writes those frames by hand. */
const RAW_SSE_PATTERN = /["']event:\s*([a-z][a-z0-9_-]*)/g;

/** `publish = getattr(engine, "_publish", None)` — the funnel reached by another name. */
const aliasPattern = (funnel) =>
  new RegExp(`\\b([a-z_][a-z0-9_]*)\\s*=\\s*getattr\\([^,]+,\\s*["']${funnel}["']`, "g");

/** Module-level `CHECKER_EVENT = "checker_event"`. */
const CONSTANT_PATTERN = /^([A-Z][A-Z0-9_]{2,})\s*=\s*f?["']([a-z][a-z0-9_-]*)["']/gm;

/** One call: a callee plus either a literal name or an all-caps constant. */
const CALL_PATTERN = /\b([a-z_][a-z0-9_]*)\(\s*(?:f?(["'])([a-z][a-z0-9_-]*)\2|([A-Z][A-Z0-9_]{2,}))\s*[,)]/g;

const FRONTEND_PATTERNS = [
  /\beventSource\??\.addEventListener\(\s*["']([a-z][a-z0-9_-]*)["']/g,
  /\bconst STREAM_EVENT_TYPES = \[([^\]]*)\]/g,
];

function* pythonFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name === ".venv") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* pythonFiles(full);
    else if (entry.name.endsWith(".py")) yield full;
  }
}

function collect(text, patterns) {
  const names = new Set();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      // The array-literal pattern captures the whole body; the others a name.
      if (!match[1]) continue;
      if (match[0].includes("STREAM_EVENT_TYPES")) {
        for (const literal of match[1].matchAll(/["']([a-z][a-z0-9_-]*)["']/g)) names.add(literal[1]);
      } else names.add(match[1]);
    }
  }
  return names;
}

/** Repository-wide, because a constant is routinely defined in one module and published from another. */
function readConstants(sources) {
  const constants = new Map();
  for (const text of sources.values()) {
    for (const match of text.matchAll(CONSTANT_PATTERN)) constants.set(match[1], match[2]);
  }
  return constants;
}

/** Per-file: local name → the funnel it is bound to. */
function readAliases(text) {
  const aliases = new Map();
  for (const funnel of EMITTERS) {
    for (const match of text.matchAll(aliasPattern(funnel))) aliases.set(match[1], funnel);
  }
  return aliases;
}

/** Event names one file publishes, resolved to the funnel each came from. */
function emissionsFrom(text, constants) {
  const out = [];
  const aliases = readAliases(text);
  for (const match of text.matchAll(CALL_PATTERN)) {
    const [, callee, , literal, constant] = match;
    const funnel = EMITTERS.includes(callee) ? callee : aliases.get(callee);
    if (!funnel) continue;
    const name = literal ?? constants.get(constant);
    if (name) out.push({ funnel, name });
  }
  return out;
}

/** Per-funnel contributions — the guard against an extractor that quietly
 *  stops seeing one funnel while still producing a self-consistent fixture. */
export function namesByEmitter(repoRoot = REPO_ROOT) {
  const sources = readServerSources(repoRoot);
  const constants = readConstants(sources);
  const byFunnel = Object.fromEntries(EMITTERS.map((funnel) => [funnel, new Set()]));
  for (const text of sources.values()) {
    for (const { funnel, name } of emissionsFrom(text, constants)) byFunnel[funnel].add(name);
  }
  return Object.fromEntries(Object.entries(byFunnel).map(([funnel, names]) => [funnel, [...names].sort()]));
}

/** Local calendar date, matching the dates used throughout docs/. */
const localDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

function readServerSources(repoRoot) {
  const sources = new Map();
  for (const root of SERVER_ROOTS) {
    for (const file of pythonFiles(join(repoRoot, root))) sources.set(file, readFileSync(file, "utf8"));
  }
  return sources;
}

export function extractLegacySseEvents(repoRoot = REPO_ROOT) {
  const sources = readServerSources(repoRoot);
  const constants = readConstants(sources);
  const server = new Set();
  for (const text of sources.values()) {
    for (const { name } of emissionsFrom(text, constants)) server.add(name);
    for (const name of collect(text, [RAW_SSE_PATTERN])) server.add(name);
  }
  const frontend = collect(readFileSync(join(repoRoot, FRONTEND_FILE), "utf8"), FRONTEND_PATTERNS);
  const sorted = (set) => [...set].sort();
  return {
    captured: localDate(),
    source: `generated by scripts/gen-sse-events.mjs from ${SERVER_ROOTS.join(", ")} emitters and ${FRONTEND_FILE} subscriptions`,
    serverEventNames: sorted(server),
    frontendSubscribedEventNames: sorted(frontend),
    serverBroadcastButFrontendNeverSubscribed: sorted(new Set([...server].filter((n) => !frontend.has(n)))),
    frontendSubscribesButServerNeverEmits: sorted(new Set([...frontend].filter((n) => !server.has(n)))),
  };
}

/** The fixture body, in the canonical key order both writer and reader use. */
export function buildFixture() {
  return {
    ...extractLegacySseEvents(),
    notes: [
      "队列 UI 信源是 /api/status 的 queue_paused/queue_holds 轮询字段，不是 SSE（G18）",
      "DSH 侧对应物为 session/event + readSessionState catch-up（已核实原生支持，G20）",
      "两份差集都由抽取算出。旧手抄只记了服务端→前端那一半；本轮算得前端订阅的 17 项全部有真实发射方（反向死信道为空）",
      "checker_event 走 `publish = getattr(engine, '_publish')` 别名 + 模块常量发射（graph/checkpoints.py:72,166,174）——抽取器解析别名与常量，手抄清单曾把它误判成死信道",
    ],
  };
}

/** Callee names reviewed and deliberately kept out of the event vocabulary;
 *  anything else that looks like an emitter is reported instead of dropped. */
export function findUnreviewedEmitters(repoRoot = REPO_ROOT) {
  const sources = readServerSources(repoRoot);
  const constants = readConstants(sources);
  const found = new Set();
  for (const [file, text] of sources) {
    const aliases = readAliases(text);
    for (const match of text.matchAll(CALL_PATTERN)) {
      const [, callee, , literal, constant] = match;
      if (EMITTERS.includes(callee) || aliases.has(callee)) continue;
      if (REVIEWED_EXCLUSIONS.includes(callee)) continue;
      if (!/(?:^|_)(?:publish|broadcast|emit)(?:_|$)|(?:_|^)event$/.test(callee)) continue;
      found.add(`${callee}(${literal ?? constants.get(constant) ?? constant}) ${relative(repoRoot, file)}`);
    }
  }
  return [...found].sort();
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/** The keys that carry the contract; `captured` is a date stamp and must not count as drift. */
const CONTRACT_KEYS = [
  "serverEventNames",
  "frontendSubscribedEventNames",
  "serverBroadcastButFrontendNeverSubscribed",
  "frontendSubscribesButServerNeverEmits",
];

const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.join("\n") === b.join("\n");

function main() {
  const fresh = buildFixture();
  const unreviewed = findUnreviewedEmitters();
  for (const line of unreviewed) {
    console.warn(`[sse] unreviewed emitter-shaped call: ${line}`);
  }
  if (process.argv.includes("--write")) {
    writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 2)}\n`);
    console.log(`[sse] wrote ${relative(REPO_ROOT, FIXTURE)}`);
    return;
  }
  const current = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;
  const drifted = CONTRACT_KEYS.filter((key) => !same(current?.[key], fresh[key]));
  if (drifted.length === 0) {
    console.log(`[sse] fixture matches the sources (${fresh.serverEventNames.length} server / ${fresh.frontendSubscribedEventNames.length} frontend names)`);
    return;
  }
  console.error("[sse] fixture is out of date with the sources; regenerate with --write");
  const only = (a, b) => (a ?? []).filter((n) => !(b ?? []).includes(n));
  for (const key of drifted) {
    console.error(`  ${key}: ${(fresh[key] ?? []).length} (was ${(current?.[key] ?? []).length})`);
    for (const name of only(fresh[key], current?.[key])) console.error(`    + ${name}`);
    for (const name of only(current?.[key], fresh[key])) console.error(`    - ${name}`);
  }
  process.exit(1);
}

if (isCli) main();
