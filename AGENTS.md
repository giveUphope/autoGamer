# AGENTS.md

Instructions for ZCode agents working in this repository.

## What this is

ARTEMIS — an autonomous Android mobile agent. Python backend (uv-managed, py312) that drives
real/mock Android devices through task workers, plus a web console (FastAPI + Vue 3).

## Layout

- `artemis/` — core package: `data_engine/` (session/step persistence, SQLite), `drivers/`
  (ADB + `drivers/mock/mock_driver.py`), `runtime/` (daemon, device locks, server lifecycle),
  `interfaces/cli/`, `sdk/`
- `apps/admin_console/` — FastAPI server: `routers/tasks.py` (`/api/run`, `/api/status`,
  `/api/sessions`), `services/task_queue_service.py` (queue worker spawning task subprocesses),
  `core/state.py` (in-process server state + submission registry)
- `apps/showcase_ui_v2/` — Vue 3 + Arco Design Vue + Pinia console (Vite 7, TS strict)
- `mcp_server/`, `packages/artemis-client/`, `tests/unit|integration|e2e/`, `docs/research/`
  (design docs worth reading before touching sensitive areas)

## Commands

- Backend tests (deterministic, no device needed): `make test` or
  `uv run python -m pytest tests/unit/admin_console tests/unit/data_engine -q`
- Frontend: run inside `apps/showcase_ui_v2/` — `npm run test` (vitest), `npm run typecheck`
  (vue-tsc), `npm run dev` (or `make dev` / `scripts/dev.sh`: backend :8000 + Vite :5180 with
  linked teardown)
- Run the app: `uv run python -m artemis ui` serves API + built console on
  `http://localhost:8000` (auto-rebuilds the Vue bundle at startup when sources changed);
  `ARTEMIS_MOCK_DRIVER=1` forces the offline mock device driver (no real device required);
  `make mock-ui` is the packaged shortcut for exactly that. The server **never auto-opens a
  browser** (`--open` is opt-in; end-user launchers pass it explicitly)
- Dev-environment startup habit: start the server in the background with
  `ARTEMIS_MOCK_DRIVER=1 uv run python -m artemis ui --no-open`, then open
  `http://localhost:8000` in the **agent's in-app browser** (browser-use IAB tab) — never
  wait for or trigger the system browser, and don't pass `--open`
- Lint: `uv run ruff check` / `uv run ruff format --check` (line length 100); pre-commit also
  runs `scripts/quality_ratchet.py` — don't regress baselines in `.quality-baseline.json`

## Task lifecycle & session representations (high-regression area)

A submission flows: `POST /api/run` → `TaskQueueService.enqueue_tasks` (assigns
`conversation_id` when absent, records submission metadata in `state.submission_meta`
registry) → worker subprocess (env `ARTEMIS_CONVERSATION_ID`, `ARTEMIS_SUBMITTED_AT`,
`ARTEMIS_SESSION_ID`) → `DataEngine.start_session` persists the session row (SQLite at
`traces/data_engine.db`; columns auto-migrate in `storage.py` init).

While a task is queued/running it has no DB row; `/api/status` shows it via the queue payload
(task items + DeviceExecutionLock ticket views) and `active_tasks`. Rules learned the hard way:

- Registry values (thread id, enqueue wall-clock, **raw goal**) must win over lock data: the
  ticket view's `created_at` is the lock-file mtime (pick-up time, not submission time) and
  lock `description` is formatted as `"frontend task: <goal>"` — never let either reach round
  titles or ordering
- The engine persists `submitted_at`; chat rounds order by it, never `start_time` (which
  drifts to the device-turn moment and reshuffles the queue as rounds launch)

## Frontend console rules (`apps/showcase_ui_v2/src`)

- `stores/session.ts` + `utils/session-merge.ts` implement a 4-step merge (DB rows → pending
  queue → active tasks → tracking-map bridge). The non-reactive `tracking` map bridges the
  queue→running gap; don't create fallback entries that shadow it
- `conversationThreadKey` falls back to a synthetic `round:<session_id>` key — it is for
  timeline/group **filtering only**; submissions must use `submitConversationId` (real
  `conversation_id` or null), never a synthetic key
- Order/display anchors use `sessionChronoKey` (`submitted_at ?? start_time`); store
  conversation grouping and `AgentTimeline` must share these helpers
- Pending/active session representations must carry `conversation_id` / `submitted_at`
  (`mapPendingQueue`, merge step 3) or rounds flash as separate "ghost" conversations
- Specs are co-located `*.spec.ts` (vitest + jsdom); `en-US` locale keys are locked by tests —
  add new keys to both `zh-CN` and `en-US`
- The Vite dev proxy strips the `Origin` header on `/api` — required by the backend's
  `SameOriginBoundaryMiddleware` (otherwise 403). Keep this when editing `vite.config.ts`
- Built bundle goes to `dist/browser/` and is served by FastAPI (SPA fallback built in);
  `npm run sync:resources` publishes it into the wheel fallback `artemis/resources/showcase_ui`

## Change wrap-up

When a unit of work is complete (tests green, behavior verified), finish it with a **local
commit right away**: `git add <touched files>` + a Conventional Commit message. Never push —
the user asks for pushes explicitly. Prefer one commit per coherent fix/feature over letting
unrelated changes pile up in the working tree.

## Environment notes

- Primary dev OS is Windows (Git Bash): dev scripts handle msys-vs-win32 PID quirks; don't
  assume POSIX process control
- `start.bat` / `start.sh` / `make start` are end-user launchers; prefer `uv run python -m
  artemis ui --restart` when a stale server holds port 8000
- Conventional Commits; recent history scopes frontend work as `showcase-v2`
