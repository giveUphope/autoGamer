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

## DSH plugin track (`plugins/autogamer-device`) — current mainline

项目正按 R2' 收缩成一个 DSH 插件。方案、决策和进度都在 `docs/todo.md`（活文档），**动手前先读它和守则，别从代码倒推约定**。

**文档地图（按"什么时候必须读"）**

| 文档 | 什么时候读 |
|---|---|
| `docs/todo.md` | 任何 DSH 侧改动之前。方案本体：D1-D17 决策表、S1-S11 对接语义、差距清单 G*、P0-P4 checklist 与「P0 执行状态」 |
| `docs/migration/plugin-contract-rules.md` | 改插件、preset 或任一 `*.patch.yml` 之前。守则 R1-R19，每条带出处口径与可执行判据；尤其 **R6 改 patch 必跑 `--dump-config` 自检**、**R7 复验必须开新会话**、**R9 判「生效」只认官方检查器** |
| `docs/migration/registry.md` | **要引用或新增任何编号（D/S/G/R）之前**。编号唯一权威，含 `inventory/*` 与 `todo.md` 的 G 编号撞车冲突表；`scripts/check_doc_registry.py` 机械守着 |
| `docs/migration/glossary.md` | 读方案时卡住词了：`realm`、`parking`、`PTC`、`roster`，尤其是 **`inject` 有两个意思**（服务依赖 vs 不唤醒的上下文追加） |
| `docs/migration/README.md` | 第一次接触本迁移时的入口页；也是「哪几处别当真」的清单（旧 py 智能栈 prompt 文档、旧控制台研究、docker 材料等） |
| `docs/migration/upstream-plugin-forms.md` | 需要知道官方到底怎么说插件与工具形态时。调研正文、逐条口径标注（文档/源码/实测）、出处链接，以及被撤回的错误归因 |
| `docs/migration/dsh-verification.md` | 查 rc.2 各子系统结论时。注意其中 37 处包内代码行引用属 D15 之前的 asar 口径，沿用前须按声明面重验 |
| `docs/migration/feature-inventory.md` 与 `inventory/01-05` | 担心丢 fork 现有能力时；设备与智能栈部分是上游 canonical 契约 |
| `docs/migration/upstream-rethink.md` | 要回到"为什么基线是 google/artemis"时 |
| `plugins/autogamer-device/README.md` | 安装流与 P0 状态 |

上游一手资料（声明面之外唯一允许的补充来源，公开仓库）：`github.com/deepseek-ai/deepseek-harness`
@ `master` —— 三个官方 skill 在 `packages/preset/agent-preset/skills/`（
`cordis-plugin-development` / `editing-cordis-compositions` / `cordis-composition-reference`），
加上 `packages/preset/agent-preset{,-registry}/README.zh.md`、
`packages/preset/agent-preset-registry/src/mount.ts`、`packages/bundle/web-app/presets/*.patch.yml`、
`docs/cli-help.zh.md`。**解包 `app.asar` 取证一律禁止（R1）**。

**插件侧命令**（在 `plugins/autogamer-device/` 内）

- `npm run build`（tsc，插件走 `dist/`，**改 TS 后必须重新 build 再冷重启 dsh**）/ `npm run test`（vitest）
- 声明面自检：`"D:/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd" --profile web
  --patch <abs path> --dump-config`，退出码必须为 0 且输出 grep 不到 `unmatched`（R6）；
  schema 侧用 `--dump-config-schema`
- `dsh plugin` 只是 **pnpm 转发垫片**，只证明"装了"，不证明"生效"（R9）
- spike 现场与转储在 `plugins/autogamer-device/spike/`：`web-live.patch.yml` 是 live overlay，
  `wire-tools.py` 解析 `scripts/proxy-dump.log` 数请求里的 `tools`；`dsh-dump*` / `dsh-schema*` /
  `dump-config.*` / `web-server*.log` / token 类文件全部 gitignored，**不要提交含 token 的转储**

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

## Change planning → todo ledger (habit)

Applies to any non-trivial change. The moment the user confirms a plan/spec, **before**
implementation starts, write the confirmed spec into `docs/todo.md` as a themed entry. The
entry must be self-sufficient: reading the entry alone must make clear what to do, how to do
it, how to verify it, and what counts as done — no re-deriving state from code or chat:

- **What**: scope, deliverables, explicit out-of-scope
- **How**: approach and key decisions from the confirmed plan
- **Verify**: exact commands / tests / manual checks
- **Done means**: acceptance criteria as a checklist

During implementation, after each checkpoint completes, update the entry in the same step —
tick checklist items and record deviations from the plan — proactively, without being asked.
Finished entries are deleted (docs no-old-archives rule); git history carries the narrative.

**Incidental findings are ledger entries too**: any problem noticed while working — out of
scope, in passing, even one already fixed on the spot — is written into `docs/todo.md` in the
same step it is found: open issues as gap rows (numbered per `docs/migration/registry.md`,
doc gates re-run), drive-by fixes into the status fix-log. A chat-only mention or a silent
fix does not count as recorded.

## Change wrap-up

When a unit of work is complete (tests green, behavior verified), finish it with a **local
commit right away**: `git add <touched files>` + a Conventional Commit message. Never push —
the user asks for pushes explicitly. Prefer one commit per coherent fix/feature over letting
unrelated changes pile up in the working tree.

**Test-sync review habit**: behavioral changes always ride together with their specs — every
new behavior gets a locking test, and a test of removed behavior is removed in the same
commit. After a batch of changes (or before wrapping up a longer session), dispatch review
subagent(s) over the touched test suites (backend `tests/unit/...`, frontend `*.spec.ts`) to
verify tests still match the implementation, close coverage gaps (especially regression
guards for the bugs just fixed), and refactor stale/duplicated fixtures — then land the
follow-up test commit.

## Environment notes

- Primary dev OS is Windows (Git Bash): dev scripts handle msys-vs-win32 PID quirks; don't
  assume POSIX process control
- `start.bat` / `start.sh` / `make start` are end-user launchers; prefer `uv run python -m
  artemis ui --restart` when a stale server holds port 8000
- Conventional Commits; recent history scopes frontend work as `showcase-v2`
