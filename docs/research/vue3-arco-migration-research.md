# ARTEMIS Web 前端重构调研报告：Angular → Vue 3 + Arco Design Vue

> 调研日期：2026-10-06
> 调研范围：`apps/showcase_ui`（Angular 源码）、`artemis/resources/showcase_ui`（编译产物）、`apps/admin_console`（FastAPI 后端）
> 性质：探索性调研，本轮不修改任何现有代码。

---

## 1. 现状盘点

### 1.1 目录与托管关系澄清

| 路径 | 性质 | 说明 |
| --- | --- | --- |
| `D:\DEV\autoGamer\apps\showcase_ui` | **Angular 源码（真正的源）** | 含 `src/`、`package.json`、`angular.json`、`node_modules`、`.angular` 缓存 |
| `D:\DEV\autoGamer\artemis\resources\showcase_ui` | **仅编译产物** | 6 个文件：`index.html`、`main-BGAFACUZ.js`、`polyfills-5CFQRCPP.js`、`styles-CDJM3XQS.css`、`logo.png/svg`、`favicon.ico`。由 `artemis/resources/__init__.py` 的 `get_bundled_showcase_dist()` 在 wheel 安装态回退使用 |
| `D:\DEV\autoGamer\apps\admin_console\index.html` | 独立的 Admin Debug Console | 3787 行单文件 vanilla HTML/JS（无构建），挂在 `/admin`、`/debug` 路径，**不在本次重构范围** |

### 1.2 技术栈与依赖（`apps/showcase_ui/package.json`）

- Angular **22.1.4**（`@angular/core` 等 `^22.1.4`），`@angular/cdk ^22.1.5`，`@angular/build ^22.1.6`（esbuild 应用构建器），TypeScript `~6.0.3`，`zone.js ~0.15.0`，`rxjs ~7.8.0`
- **没有引入任何第三方 UI 组件库、图表库或播放器库**：界面全部手写（Material Symbols 图标走 Google Fonts CDN），Angular CDK 只用到 `overlay-prebuilt.css`（见 `src/styles.scss`）
- 测试：Karma + Jasmine，6 个 spec 文件（`agent.service.spec.ts` 418 行、`stream-aggregator.util.spec.ts` 640 行等）
- 构建：`@angular/build:application`，输出 `dist/frontend/browser`，`outputHashing: all`，预算 initial 2MB 警告 / 4MB 报错

### 1.3 代码规模（非测试源码共 31,030 行）

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `src/app/services/agent.service.ts` | 2012 | 全局状态中枢：sessions 合并、状态轮询、SSE 流、视频回放状态机 |
| `src/app/utils/tool-formatter.util.ts` | 1419 | 工具调用卡片格式化 |
| `src/app/utils/stream-aggregator.util.ts` | 1021 | 步骤/流事件聚合为时间线块 |
| `src/app/utils/action-formatter.util.ts` | 1015 | 动作解析/文案 |
| `src/app/utils/image-overlay.util.ts` | 662 | 截图 canvas 坐标叠加 |
| `src/app/components/agent-stream/` | TS 2234 + HTML 1436 + SCSS 3973 | 核心时间线视图：任务下拉、notes、usage、阶段折叠、LLM 流打字机、暂停/重试卡片、Checker 面板 |
| `src/app/pages/home/` | TS 1111 + HTML 2103 + SCSS 5168 | 首页：诊断向导（readiness 三步引导）+ 任务启动器（flash/pro、Pro 调优滑杆、outputter 抽屉、智能任务推荐） |
| `src/app/components/floating-video-player/` | TS 631 + HTML 433 + SCSS 987 | 浮动播放器：视频分段播放、step 帧回放（pre/post）、canvas 坐标叠加、MJPEG 实时投屏、双时间轴 seek |
| `src/app/components/chat-interface/` | TS 269 + HTML 380 + SCSS 1171 | 任务队列/历史列表 + 输入框 |
| `src/app/pages/workspace/` | TS 323 + HTML 201 + SCSS 885 | 工作台：左时间线/右队列分栏（可拖拽）、浮动命令条（Ctrl+K） |
| `src/app/pages/legacy-workspace/` + `legacy-agent-stream/` | ~600 行 | `/check` 路由的旧版流视图（淘汰候选） |
| `src/app/core/models/` | 5 文件 ~560 行 | session / stream / system / pro-tuning / markdown 类型契约 |

### 1.4 路由与页面清单（`src/app/app.routes.ts`）

| 路由 | 组件 | 功能 |
| --- | --- | --- |
| `/` | `HomeComponent` | 双 Tab：System Setup（readiness 三步诊断、ADB/emulator/凭据配置）与 Task Launcher（任务提交、Pro 调优、智能推荐） |
| `/workspace` | `WorkspaceComponent` | 主工作台：AgentStream 时间线 + ChatInterface 队列 + FloatingVideoPlayer 浮层 |
| `/check` | `LegacyWorkspaceComponent` | 旧版流视图（legacy，仅维护） |

全局导航为 `NavSwitcherComponent` 浮动切换按钮（`app.component.ts` 仅 30 行）。

### 1.5 状态管理与通信方式

- **状态管理**：无 NgRx/其他状态库。`AgentService`（`providedIn: 'root'`）与 `SystemService` 直接使用 **Angular Signals + computed** 作为全局状态；`sessionLogs`、`rawSessions`、`pendingQueue`、`activeTasks` 等信号承载全部数据。
- **通信方式共 4 类**（`proxy.conf.json` 代理 `/api`、`/images`、`/videos`、`/local_file` 到 `:8000`）：
  1. **REST 轮询**：`/api/status` 每 2s、`/api/sessions` 每 6s（`pollCounter % 3`）、`/api/system/readiness` 每 3s、emulator 启动期每 1s；均带签名去重（payload JSON 相同则跳过 setState）与 `visibilitychange` 暂停/恢复。
  2. **SSE**：`new EventSource('/api/stream')` 单通道持久连接，在 `NgZone` 外注册，消费 17 种事件类型（见 §2.3）。`llm_stream` chunk 按 `execution_id|stream_type` 键合批（可见时 80ms / 后台 500ms flush），非流事件前强制 flush 保证顺序。
  3. **MJPEG 流**：`<img src="/api/stream/device-live">` 实时投屏（video player 的 live 模式）。
  4. **静态媒体**：`/images/{name}.jpg`（截图）、`/videos/{path}`（录像分段）、`/local_file?path=`。
- **本地缓存**：`localStorage` 键 `artemis.sessions.v1`（会话列表冷启动快照）与 `artemis_selected_profile`。
- **性能细节**（迁移时必须保留的语义）：SSE 合批与事件顺序保证、快照（`/steps`）与 live 事件的 append-only 合并（`history_snapshot` 标记）、checks 快照幂等回填（`checks_snapshot`）、乐观更新 + 签名失效（`invalidateStatusSignatures`）、`WeakMap` 模板缓存。

### 1.6 构建产物如何被 FastAPI 托管

`apps/admin_console/server.py`：

- `_get_showcase_dist()`（L245-260）：依次探测 `apps/showcase_ui/dist/{frontend/browser, browser, frontend}` 下是否存在 `index.html`；否则回退 `artemis/resources/showcase_ui`（wheel 内置）。
- Catch-all 路由 `serve_showcase_spa`（L281-390）：拦截所有非 `api/`、`images/`、`videos/`、`local_file`、`docs`、`openapi.json`、`redoc` 前缀的路径 —— 静态文件精确命中 → `public/` 图标回退 → SPA `index.html` 回退。**天然适配任何 SPA（含 Vite）的 history 路由**。
- `SameOriginBoundaryMiddleware`（`core/security.py`）：校验 `Host`（防 DNS rebinding）与 `Origin`（防 CSRF），**无任何 CORS 放行**。非浏览器客户端（无 Origin 头）直接放行。
- 自动构建链路：`artemis ui` CLI（`artemis/interfaces/cli/commands/ui.py` 的 `ensure_showcase_built()`，L192-229）按源码 mtime 判断是否需要 `npm install && npm run build`；`start.sh`（L264-365）与 `Makefile`（L40）有同样逻辑（含 Node 22 自动安装）。

---

## 2. API 契约梳理（以路由代码为准）

### 2.1 前端实际消费的端点

来源：`agent.service.ts`、`system.service.ts` 中的全部 `http.get/post` 与 `EventSource` 调用。

**任务与会话**（`routers/tasks.py`、`routers/sessions.py`）：

| 端点 | 方法 | 前端用法 | 响应/请求形状 |
| --- | --- | --- | --- |
| `/api/sessions` | GET | 每 6s 轮询 | `Session[]`：`{session_id, initial_goal, start_time, end_time?, status?, video_url?, recording_status?, model_info?, device_serial?, device_info?}`（后端动态补齐 `device_id/device_serial/model_info/recording_status/video_url`，见 `sessions.py` L53-167） |
| `/api/sessions/{id}` | GET | 未被前端消费 | 单会话行 |
| `/api/sessions/{id}/usage` | GET | RunInfo 面板 | `SessionUsage`：`{llm_calls, prompt_tokens, completion_tokens, total_tokens, cached_tokens, operator_context_tokens, operator_context_window_tokens, profile?, run_tuning?}` |
| `/api/sessions/{id}/steps` | GET | 选中会话时回填快照 | `StepItemData[]`：`{step_id, step_number, timestamp, operator_native_thinking?, operator_raw_thinking?, action_taken?, generic_tools?, last_execution_result?, pre_image_name?, post_image_name?, token_usage?, duration?}` |
| `/api/sessions/{id}/startup_progress` | GET | 选中/提交时 | `StartupProgressEvent[]`：`{session_id?, stage, message, timestamp}` |
| `/api/sessions/{id}/notes` | GET | Notes 面板 | `{notes: Record<string, string>}`（键为 `task_plan.md` 等） |
| `/api/sessions/{id}/checks` | GET | Checker 面板回填 | `{records[], streams: PersistedCheckerStream[], run_outcome}` |
| `/api/sessions/{id}/video` | GET | 打开播放器，轮询直到 ready | `{status: 'processing'|'ready'|'failed'|'unavailable', has_video, video_url, video_segments: [{url, start, duration, width, height, offset_ms?, duration_ms?}], retry_after_ms?, message?}`（`media.py` L110-176） |
| `/api/sessions/{id}/tree`、`/background_tasks` | GET | **前端当前未消费** | 轨迹树 / 后台任务 |
| `/api/sessions/{id}/delete` | POST | 单条删除 | `{status, message}` |
| `/api/cleanup` | POST | 清空全部历史 | `{status, message}` |
| `/api/status` | GET | 每 2s 轮询 | `{status: 'idle'|'running'|'paused', session_id, goal, pid, paused_error?, queue: (TaskQueueItem|string)[], background_tasks[], active_tasks: [{device_id, session_id, goal, pid, ingress, acquired_at}], model_info, ipc_port}`（`tasks.py` L250-383） |
| `/api/run` | POST | 提交任务 | `RunRequest`：`{goal | goals[], profile='flash', expected_output?, enable_outputter?, verification_level?, explorer_mode?, locked_app_package?, app_path?, device_serial?, ingress='frontend', session_id?, conversation_id?}` → `{status, tasks[], enqueued_count, total_queued}` |
| `/api/run/defaults` | GET | 启动器滑杆默认值 | `{verification_level, explorer_mode}` |
| `/api/stop` | POST | 停止（支持 query + body 双通道） | `{all: bool, session_id?, device_id?}` → `{status: 'stopped'|'no_running_task'}` |
| `/api/resume` | POST | 恢复暂停 | → `{status: 'resumed'|'not_paused'}` |
| `/api/tasks/presets`、`/api/tasks/catalog`、`/api/devices` | GET | **前端当前未消费**（Home 用的是本地 `smart-tasks.data.ts` 静态推荐） | — |

**系统诊断**（`routers/system.py`，prefix `/api/system`，`system.service.ts` 消费）：

- `GET /api/system/readiness?force=` → `SystemReadinessReport`（`probes: ProbeResult[]`、`active_device`、`os_type`、`timestamp`）
- `GET /api/system/adb/server`、`POST /adb/server/probe|connect|local`（ADB server 端点切换）
- `POST /devices/select`、`POST /adb/restart`、`POST /adb/connect`（Wi-Fi ADB）
- `GET /emulator/status`、`POST /emulator/launch|stop|dismiss`（`EmulatorLaunchState`：`{avd_name, status, stage_message, progress_percent, logs[], can_retry}`）
- `GET /credentials`、`POST /credentials/test`、`POST /credentials`（LLM/OCR key）
- `GET /model-config-env`（`ModelConfigEnvResponse`：config 内容、presets、env_vars）
- 未消费：`/server-status`、`/restart`、`/shutdown`、`/adb/heal-keys`

**流与媒体**（`routers/stream.py`、`routers/media.py`）：

- `GET /api/stream`（SSE，见下）、`GET /api/stream/device-live`（MJPEG `multipart/x-mixed-replace`）、`GET /api/stream/device-state`
- `GET /images/{name}`（截图 jpg）、`GET /videos/{path}`（mp4/webm/mkv，白名单后缀 + 路径越界防护）、`GET /local_file?path=`
- `GET /api/sessions/{id}/plan`（未消费）

### 2.2 前端未消费、但 Vue 版可考虑接入的端点

`/api/sessions/{id}/tree`（轨迹树）、`/api/sessions/{id}/background_tasks`、`/api/tasks/presets|catalog`（服务端智能推荐，替代前端硬编码的 `smart-tasks.data.ts` 334 行）、`/api/steps/{step_id}/traces`、`/api/traces/{trace_id}` 以及 replay 组（`/api/replay/tools|config`、`replay_steps`、`steps/{n}/replay`）—— replay 组目前只被 `/admin` vanilla 控制台使用。

### 2.3 SSE 事件契约（`tasks.py` `stream_events` L386-517 与 `agent.service.ts` L786-802）

单通道 `GET /api/stream`（支持 `/api/stream/{session_id}` 过滤），事件类型：

`info`、`keep-alive`（5s 心跳）、`session_started`、`session_ended`、`startup_progress`、`step_recorded`、`step_updated`、`trace_recorded`、`llm_stream`、`llm_stream_reset`、`llm_retrying`、`task_paused`、`task_resumed`、`background_tasks_updated`、`recording_ready`、`recording_failed`、`checker_event`。

服务端还会在订阅 `all/active` 时重放当前会话的 `session_started` + `startup_progress` + 已落库 `step_recorded`（幂等快照语义）。前端按 `session_id` 过滤事件、按 trace_id 去重 `trace_recorded`。

---

## 3. Vue 3 + Arco Design Vue 技术映射

### 3.1 推荐技术栈

| 层 | 选型 | 版本建议 | 说明 |
| --- | --- | --- | --- |
| 构建 | Vite | 7.x | esbuild/rollup，产物 hash 与 Angular 对齐（`outputHashing` 等价于 Vite 默认） |
| 框架 | Vue | ^3.5 | `<script setup>` Composition API；不需要 zone 类机制（Vue 细粒度响应式天然等价 Angular signals + zoneless） |
| 语言 | TypeScript | ~5.9 | 现有 `core/models/*.ts` 的 interface 可**原样复制**（Angular 版已用 TS，类型契约零成本迁移） |
| 状态 | Pinia | ^3 | 替代两个 root service 的 signal 状态；setup-store 写法与现有 signal/computed 心智一致 |
| 路由 | Vue Router | ^4.5 | 3 条路由 + catch-all 重定向 |
| UI 库 | **@arco-design/web-vue** | **^2.58.0（2.x 最新，2026-04 前后发布；要求 Vue ≥ 3.2）** | 60+ 组件、内置暗色主题 token、i18n locale 包、MIT。维护中但节奏放缓（近期以 bugfix 为主），2.x 稳定、API 变动风险低 |
| HTTP | 原生 fetch 封装（或 ofetch） | — | 现有代码只需 GET/POST + 错误透传，无需 axios 全家桶 |
| SSE | 原生 `EventSource` 照搬 + composable | — | 现有重连语义（浏览器自动重连）依赖 EventSource 原生行为，**不建议**换 @microsoft/fetch-event-source，除非需要自定义 header |
| 图表 | 暂无硬需求；如需则 ECharts 6 + vue-echarts | — | 现状 UI 无图表：token 用量/上下文窗口用 `a-progress`/数字即可。轨迹树可视化（`/tree` 接入时）再考虑 ECharts tree/甘特 |
| 播放器 | **不引入 xgplayer/artplayer，保留原生 `<video>`**（首版） | — | 核心复杂度在"分段播放列表 + session/timeline 双时间轴 + step 帧回放 + canvas 叠加"，这些是纯 TS 逻辑（`recording-timeline.util.ts`、`image-overlay.util.ts` 可原样移植），播放器库反而碍事。后续如需完整 UI（弹幕/热区/倍捷盘）再评估 artplayer 5 |
| 虚拟滚动 | `virtua`（推荐）或 `vue-virtual-scroller` | — | 长会话时间线（数百 step 块 + 打字机流）是主要性能风险；Arco 的 `a-list` 无虚拟滚动、`a-table` 的 `virtual-list-props` 只适用于表格场景 |
| Markdown | markdown-it + 安全渲染（DOMPurify） | — | 现有 `markdown-parser.util.ts`（383 行）仅支持 bold/code/行结构，迁 Vue 时建议直接升级为 markdown-it，保留 milestone 解析逻辑 |
| 图标 | Arco Icon + `@iconify/vue`（Material Symbols 子集） | — | 现 UI 依赖 Google Fonts CDN 的 Material Symbols；离线场景建议 iconify 本地打包 |
| i18n | vue-i18n ^11 + Arco `ConfigProvider :locale` | — | 现状 UI 全英文硬编码；建议 M5 前置埋 key（按模块渐进），Arco 自带 zh-CN locale |
| 主题 | Arco `ConfigProvider theme="dark"` + CSS var token | — | 现 UI 为手写深色（`styles.scss` + 各组件 SCSS）。Arco dark 模式开箱即用；品牌色 token（`--primary-6` 等）可调成 ARTEMIS 蓝青色系 |
| 测试 | Vitest + @vue/test-utils | — | 替代 Karma/Jasmine；`*.util.spec.ts` 与 `agent.service.spec.ts` 的用例基本可平移 |

### 3.2 Angular 模块 → Vue 组件 / Store 映射表

| Angular 现有 | Vue 目标 | 迁移策略 |
| --- | --- | --- |
| `AgentService`（2012 行，signal 状态 + HTTP + SSE + 视频状态机） | **拆分为 3 个 Pinia store + 1 个纯 TS 服务**：`stores/session.ts`（sessions 合并算法、轮询、乐观更新）、`stores/stream.ts`（SSE 连接、sessionLogs、合批 flush、重置/暂停卡片）、`stores/player.ts`（视频/step 回放状态机）；`services/api.ts`（fetch 封装） | **逻辑平移**。合并/合批/去重算法是纯函数，建议连同 spec 一起搬，框架适配层只保留信号读写 |
| `SystemService`（610 行） | `stores/system.ts` | 逻辑平移（轮询、共享 inflight 请求、emulator 1s 轮询） |
| `TaskRecommendationService` + `smart-tasks.data.ts`（457 行） | `composables/useTaskRecommendations.ts` + 后端 `/api/tasks/presets` | 顺手替换为服务端推荐（可保留本地数据做 fallback） |
| `core/models/*.ts`（5 文件） | `src/types/*.ts` | **原样复制** |
| `utils/*.ts`（7 文件 ~4700 行 + 1870 行 spec） | `src/utils/` 原样平移 | **零框架依赖，直接复制**（仅 `image-overlay.util`/`recording-timeline.util` 需确认无 Angular 引用） |
| `HomeComponent`（页面 + 5168 行 SCSS） | `views/LauncherView.vue` + 子组件 `DiagnosticsWizard.vue`（`a-steps`/`a-collapse`/`a-form`/`a-alert`/`a-select`）、`TaskLauncher.vue`（`a-input-textarea`/`a-slider`/`a-drawer`/`a-button`） | **重写 UI**：诊断向导用 Arco 表单组件替代手写卡片；调优滑杆用 `a-slider` + 自定义 tooltip；视觉按 Arco token 重建（不逐像素复刻） |
| `WorkspaceComponent` | `views/WorkspaceView.vue`（`a-layout` + 自写 rAF 拖拽分栏或 `a-split`… Arco 无 Split 组件，保留现有 30 行拖拽逻辑即可）+ `CommandDock.vue`（Ctrl+K 浮动命令条，`a-input` + `a-trigger`） | UI 重写，交互逻辑平移 |
| `AgentStreamComponent`（2234 行 TS） | 拆为 `AgentTimeline.vue`（容器 + 阶段分组）、`StepCard.vue`（动作卡片 + 工具行）、`StreamTextBlock.vue`（打字机流 + reset 通知）、`CheckerPanel.vue`（attempt 折叠面板 `a-collapse`）、`NotesPanel.vue`（`a-tabs` + markdown 渲染）、`RunInfoPopover.vue`（`a-popover` + usage）、`SessionSwitcher.vue`（`a-select` 或 `a-dropdown`） | **这是最大的单体重写面**（~7600 行含样式），必须先做组件边界设计再动手 |
| `ChatInterfaceComponent` | `TaskQueuePanel.vue`（`a-list` + `a-badge`/`a-tag` 状态色 + `a-popconfirm` 删除） | UI 重写，逻辑平移 |
| `FloatingVideoPlayerComponent`（631 行） | `FloatingPlayer.vue`（可拖拽浮窗 + `a-progress`/自定义时间轴 + `<video>` + `<canvas>` 叠加 + live MJPEG `<img>`） | UI 重写 + 逻辑平移；双时间轴 seek 逻辑依赖 `recording-timeline.util` |
| `LegacyAgentStreamComponent` + `LegacyWorkspaceComponent`（`/check` 路由） | 不迁移，Vue 版上线后删除 | 淘汰 |
| `NavSwitcherComponent` | `AppNav.vue`（`a-float-button` 组或保留浮动胶囊样式） | UI 重写 |
| Angular CDK overlay-prebuilt.css | 不需要（Arco Teleport/Popup 自带） | 删除 |
| zone.js / NgZone 外运行 | 不需要（Vue 无此概念；`runOutsideAngular` 的性能语义由 Vue 调度器自然覆盖） | 删除 |

### 3.3 需要刻意保留的运行时语义（迁移验收的隐藏条款）

1. SSE `llm_stream` 合批（80ms/500ms）与非流事件的顺序保证（flush-before-append）。
2. 快照回填与 live 流的合并规则：`history_snapshot` 永远排在 live 之前、`checks_snapshot` 幂等可重复拉取。
3. 会话合并的 4 步算法（raw → pending → active_tasks → tracking 桥接），保证队列→运行切换无闪烁。
4. 停止/删除的乐观更新 + 签名失效（防止 2s 轮询回写旧状态）。
5. 视频 `retry_after_ms` 轮询（500ms~3s 退避、120s 超时）与 `recording_ready/failed` SSE 事件的联动。
6. 页面隐藏时暂停轮询、`visibilitychange` 立即刷新。

---

## 4. 构建与托管集成

### 4.1 Vue 项目落点与产物路径（最小改动方案）

- 新前端源码建议放 `apps/showcase_ui_v2`（并行期）或最终替换 `apps/showcase_ui`。
- **关键发现：`server.py:_get_showcase_dist()` 的候选列表已包含 `dist/browser`**，且 `start.sh`（`SHOWCASE_INDEX_ALT1`）与 `ui.py:_showcase_build_required()`（候选 `base_dist/browser/index.html`）同样兼容。因此 **Vite 输出 `outDir: 'dist/browser'` 时，FastAPI/CLI/start.sh 三处零改动即可托管**；若输出到 `dist/frontend/browser` 也已兼容（首选候选）。
- `vite.config.ts` 建议：`base: '/'`、`build.outDir: 'dist/browser'`、`build.rollupOptions` 默认（Vite 默认带内容 hash）；SPA history 回退由 `serve_showcase_spa` 的 index.html 兜底天然支持（路由建议用 history 模式，与现 Angular 一致）。

### 4.2 打包进 wheel 的链路

`artemis/resources/showcase_ui` 是 wheel 安装态的回退产物（`artemis/resources/__init__.py::get_bundled_showcase_dist`）。发布前需把 Vue 产物同步拷贝到该目录（或调整打包脚本指向新 dist）。**这是容易遗漏的一步**：源码树托管正常但 wheel 安装仍跑旧 Angular。

### 4.3 开发期代理

`vite.config.ts` 的 `server.proxy`：

```ts
proxy: {
  '/api':        { target: 'http://127.0.0.1:8000', changeOrigin: true,
                   configure(p) { p.on('proxyReq', r => r.removeHeader('origin')); } },
  '/images':     { target: 'http://127.0.0.1:8000' },
  '/videos':     { target: 'http://127.0.0.1:8000' },
  '/local_file': { target: 'http://127.0.0.1:8000' },
}
```

两点必须注意：

1. **同源边界**：`SameOriginBoundaryMiddleware` 要求浏览器请求的 `Origin` 与 `Host` 一致。Vite 代理（`changeOrigin: true` 改写 Host 后）转发的 POST 会带 `Origin: http://localhost:5173` 而被 403。解法即上例的 `removeHeader('origin')`（代理请求蜕变为"非浏览器客户端"，放行）或在 `ARTEMIS_ALLOWED_HOSTS` 中放行（仅 tunneled host 场景，不适用）。Angular `proxy.conf.json` 之所以现在能工作，是因为 Angular dev-server 代理默认不改写 Origin 且其 proxy 行为与 http-proxy 有差异——**迁移时必须实测**。
2. **SSE**：`http-proxy` 默认支持 `text/event-stream` 透传，但需关闭压缩干扰（Vite dev server 不代理压缩响应，一般无碍）；`/api/stream` 走 GET，无 Origin 问题（GET 浏览器通常不带 Origin，但 EventSource 同源策略下会带，同样建议移除）。

### 4.4 自动构建链路适配

`ui.py:ensure_showcase_built()` 用 "dist index.html 的 mtime vs `src/**` + `package.json` + `angular.json` 的 mtime" 判断是否重建，并硬编码 `npm run build`（Angular）。接入 Vue 后最小改动：把该函数的工程目录与 manifest 列表参数化（`angular.json` → `vite.config.ts`），`npm run build` 命令本身不变。`start.sh` 只检查产物存在性，无需改。

---

## 5. 风险与分阶段迁移计划

### 5.1 风险清单

| # | 风险 | 等级 | 缓解 |
| --- | --- | --- | --- |
| R1 | `agent.service.ts`（2012 行）承载全部状态机：会话合并、SSE 合批、乐观更新、视频重试。**漏掉任何一条时序语义都会产生 UI 状态闪烁或丢事件** | 高 | 逻辑平移为框架无关纯 TS 模块，先迁 unit tests（现有 6 个 spec 覆盖核心 util 与 service），Vue store 只做薄壳 |
| R2 | `AgentStreamComponent` ~7600 行（含样式）巨型组件，功能密度极高（12+ 个 computed 视图模型、打字机、折叠、嵌套下拉） | 高 | M2 阶段先做组件边界设计文档再动手；用 vitest 快照锁住聚合器行为 |
| R3 | 手写视觉 12,500+ 行 SCSS，Arco 组件无法逐像素复刻，**"视觉还原度"与"组件库统一"必然取舍** | 中 | 决策点：接受 Arco 视觉体系重做 UI（推荐，报告按此估算）；保像素级复刻则 Arco 仅用于表单/弹层，工期 +50% |
| R4 | dev 代理与 `SameOriginBoundaryMiddleware` 的 Origin 冲突 | 中 | §4.3 的 removeHeader 方案，M0 首日验证 |
| R5 | 视频双时间轴 + 分段播放 + scrcpy 重启 gap 的边界 case（`recording-timeline.util` 注释明确 "gaps between segments are not represented"） | 中 | util 原样迁移 + 保留全部 spec；播放器交互不引入新库 |
| R6 | 现网 Angular 22 很新、功能正常，重构期间 Angular 侧仍在演进 → 双端漂移 | 中 | 增量共存（§5.2）+ 冻结 Angular 端新功能（仅修 bug），迁移期用同一后端验收清单对照 |
| R7 | wheel 内置产物链路（`artemis/resources/showcase_ui`）与打包脚本遗漏更新 | 低 | 发布 checklist 增加该项 |
| R8 | Arco Design Vue 维护节奏放缓（2.58.0 为近期最后版本，以 bugfix 为主） | 低 | 锁定 `~2.58.0`；样式层用 Arco token + 自有组件隔离，降低将来替换成本 |
| R9 | SSE 在 Vite 代理下的缓冲/断线重连差异 | 低 | M3 验收专门覆盖"断网 30s 重连后快照回填 + live 续流" |

### 5.2 增量共存策略

FastAPI 端 catch-all 是"先匹配 API → 再 admin/debug → 再静态文件 → 最后 SPA index"的结构，加一条 **`/v2/` 前缀路由**（优先于 catch-all，指向 Vue 产物目录）即可让两套前端并行：

- `http://localhost:8000/` → Angular（不动）
- `http://localhost:8000/v2/` → Vue 3（`vite base: '/v2/'`，产物独立目录）
- 后端 API 完全共用，无 CORS 问题（同源）
- 切换验收通过后，把 Vue 产物挪到主 dist、删除 `/v2` 挂载与 Angular 工程（或保留一个版本期）

该方案后端改动约为 `server.py` 新增 ~20 行 + 一条路由，完全可逆。

### 5.3 里程碑与验收标准

| 里程碑 | 内容 | 验收标准 |
| --- | --- | --- |
| **M0 脚手架**（0.5~1d） | Vite + Vue3 + Pinia + Arco + Router + Vitest + 代理；`/v2` 共存挂载 | `npm run dev` 可经代理调通 `/api/status`；`/v2` 打开空白骨架页；Origin 403 问题已解决 |
| **M1 骨架 + 会话列表**（3~4d） | 三路由布局、`stores/session.ts`（合并算法 + 2s/6s 轮询 + localStorage 缓存）、`TaskQueuePanel`（队列/历史/删除/清空）、命令条提交 `/api/run`、stop/resume | 任务提交→排队→运行→完成全程列表状态无闪烁；删除/清空乐观更新与后端一致；轮询签名去重生效（Network 面板 payload 不变时 UI 不抖） |
| **M2 详情 / 轨迹**（5~7d） | `AgentTimeline` 组件族（StepCard/工具行/Notes/RunInfo/usage）、`/steps` 快照回填、`/notes`、`/checks` 回填、markdown 渲染、`/api/sessions/{id}/tree`（可选增强） | 打开历史会话完整还原步骤时间线（与 Angular 版对照截图验收）；notes/checks 幂等回填无重复块 |
| **M3 实时流**（6~8d） | `stores/stream.ts`：SSE 17 事件全接入、合批、重置/重试/暂停卡片、startup_progress、自动跟随运行会话（pin 语义）、断线重连 | 提交任务后实时流与 Angular 版逐事件对照无缺帧；Ctrl+C 停止、暂停恢复、llm_retrying 卡片正确；断网 30s 重连后快照+live 合并无重复 |
| **M4 回放 / 投屏**（5~7d） | `FloatingPlayer`：分段视频播放、session↔timeline seek、step 帧回放（pre/post + canvas 坐标叠加）、MJPEG live、`recording_ready/failed` 联动 | 从 step 卡片点击打开回放并定位到对应帧/时刻；分段录像跨 scrcpy 重启无缝播放；live 模式投屏可用 |
| **M5 系统 / 诊断**（3~4d） | `DiagnosticsWizard`：readiness 三步引导、ADB 管理（本地/远程/Wi-Fi）、emulator 生命周期、凭据配置与测试、model-config-env | 空环境跑通引导到就绪；远程 ADB / emulator launch 的 1s 轮询进度正确 |
| **M6 收尾**（2~3d） | i18n 框架 + 中文包、Arco 暗色主题统一、Vitest 全量迁绿、产物接入 wheel 资源、`ensure_showcase_built` 参数化、删除 Angular 端 | `npm run build` 产物由 FastAPI 主路径直接托管；`artemis ui` 自动重建生效；单测通过率 ≥ 现状 |

### 5.4 工作量估算（按模块，1 人全职）

| 模块 | 人日 |
| --- | --- |
| M0 脚手架 + 共存挂载 | 0.5–1 |
| 会话列表/队列/提交（M1） | 3–4 |
| 时间线详情 + Notes + Checker + Usage（M2） | 5–7 |
| SSE 实时流全语义（M3） | 6–8 |
| 视频回放 + step 帧 + 投屏（M4） | 5–7 |
| 系统诊断向导（M5） | 3–4 |
| i18n / 主题 / 测试 / 打包收尾（M6） | 2–3 |
| 缓冲（20%） | 5–6.5 |
| **合计** | **29.5–40.5 人日（约 6–8 自然周）** |

其中 M2+M3+M4 占总量的 55%，且高度依赖 R1/R2 的"逻辑先行平移 + 测试护航"策略。若砍掉 i18n（M6 部分）与 `/check` 旧路由，可省 2–3 人日。

---

## 6. 结论

- 现前端是**零第三方 UI 依赖、全手写**的 Angular 22 信号式应用，规模约 3.1 万行，核心复杂度集中在 `agent.service.ts`（状态机）与 `agent-stream`（时间线渲染），而非组件数量（5 个页面级/组件级单元）。
- 后端契约清晰且已文档化于路由层，前端未消费的 `/tree`、`/tasks/presets`、replay 组是 Vue 版的低成本增强点。
- FastAPI 的 SPA catch-all 与 `_get_showcase_dist()` 候选路径**天然兼容 Vite 产物**，托管集成成本极低；真正的集成坑只有两个：dev 代理的 Origin 边界与 wheel 内置产物同步。
- 推荐路径：**/v2 共存 + 逻辑层（utils/models/合并算法/时间轴）原样平移 + 视觉层按 Arco token 重做**，按 M0–M6 六个里程碑推进，总投入约 30–40 人日。
