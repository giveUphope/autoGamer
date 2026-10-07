# ARTEMIS Showcase UI v2（Vue 3 + Arco Design Vue）

ARTEMIS Web 前端从 Angular 22 向 **Vue 3 + Arco Design Vue** 重构的新工程。
当前状态为 **M6 收尾完成（迁移完成）**，M0–M6 里程碑全部交付。
迁移方案与决策见
[`docs/research/vue3-arco-migration-research.md`](../../../docs/research/vue3-arco-migration-research.md)。

## 技术栈（决策 D4 / 报告 §3.1）

| 层 | 选型 |
| --- | --- |
| 构建 | Vite 7 |
| 框架 | Vue ^3.5（`<script setup>` Composition API） |
| 语言 | TypeScript ~5.9 |
| 状态 | Pinia ^3 |
| 路由 | Vue Router ^4.5（history 模式） |
| UI | @arco-design/web-vue ~2.58.0（暗色主题 + zh-CN locale） |
| i18n | vue-i18n ^11（默认 locale：zh-CN） |
| 测试 | Vitest + @vue/test-utils + jsdom |

## 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 开发服务器（http://localhost:5173，API 代理到 127.0.0.1:8000）
npm run build        # 类型检查 + 产物构建，输出到 dist/browser/
npm run sync:resources # 把 dist/browser/ 同步到 wheel 回退目录 artemis/resources/showcase_ui（发布动作，手动执行）
npm run preview      # 本地预览构建产物
npm run test         # Vitest 单次运行
npm run test:watch   # Vitest watch 模式
npm run typecheck    # 仅 vue-tsc 类型检查
```

## 与 FastAPI 的集成

- **开发期**：`npm run dev` 后访问 `http://localhost:5173`。`vite.config.ts` 将
  `/api`、`/images`、`/videos`、`/local_file` 代理到本机 FastAPI
  （默认 `http://127.0.0.1:8000`）。其中 `/api` 代理会移除浏览器
  `Origin` 头，绕过 `SameOriginBoundaryMiddleware` 的同源校验（否则 403），
  SSE（`/api/stream`）同样经此代理透传（报告 §4.3）。
- **托管期**：`npm run build` 输出到 `dist/browser/`（含内容 hash）。
  FastAPI `server.py:_get_showcase_dist()` 的探测候选列表已包含
  `dist/browser`，SPA history 回退由 catch-all 路由 `serve_showcase_spa`
  的 index.html 兜底天然支持，**后端零改动**（报告 §4.1）。
- **wheel 回退产物**：`artemis/resources/showcase_ui` 是 wheel 安装态的
  回退目录，已随 M6 用 `npm run sync:resources` 同步为 Vue 产物（脚本机制与
  回退手段见下文「M6 完成范围」，报告 §4.2）。

## 路由

| 路径 | 视图 | 对应 Angular |
| --- | --- | --- |
| `/` | `views/LauncherView.vue` | `HomeComponent`（诊断向导 + 任务启动器） |
| `/workspace` | `views/WorkspaceView.vue` | `WorkspaceComponent`（时间线 + 队列 + 播放器） |
| `/check` | 重定向到 `/workspace` | 旧版流视图，已淘汰 |
| 其余 | 重定向到 `/` | catch-all |

## 目录结构（M6 终态）

```
src/
  main.ts               入口：Pinia / Router / i18n / Arco 注册，body 暗色属性
  App.vue               a-config-provider（Arco locale 随 vue-i18n 切换）+ router-view
  router/               路由表
  stores/               session / stream / player / system / timeline
  services/             api.ts（fetch 封装）
  utils/                会话合并 / 流聚合 / markdown / 录像时间轴 / 坐标叠加等纯函数
  locales/              vue-i18n（zh-CN 默认，en-US 键集由测试锁定）
  styles/               全局样式入口（Arco 暗色基调）
  types/                自 Angular core/models 原样平移的类型契约文件
  components/           AppNav / TaskQueuePanel / CommandDock / ModelSelect / FloatingPlayer
    timeline/           AgentTimeline / StepCard / CheckerPanel / NotesPanel 等
    diagnostics/        DiagnosticsWizard 三步向导（环境 / 凭据 / 设备）
  views/                LauncherView / WorkspaceView
  test/                 Vitest 环境垫片
scripts/
  sync-wheel-resources.mjs       dist/browser → wheel 回退目录同步脚本（Node ESM，零依赖）
  sync-wheel-resources.spec.mjs  脚本 CLI 行为测试（--src/--dest 注入临时目录）
public/                 favicon.ico / logo.png / logo.svg（构建时拷入 dist/browser/）
```

## 里程碑

M0 脚手架 → M1 会话列表/队列 → M2 详情/轨迹 → M3 SSE 实时流 →
M4 回放/投屏 → M5 系统诊断 → **M6 i18n/主题/打包收尾与切换（全部完成）**。

## M1 完成范围（骨架 + 会话列表/队列/任务提交）

> 对应调研报告 §5.3 的 M1 行与 §3.3 运行时语义条款 3 / 4 / 6。

### 交付内容

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| fetch 封装 | `src/services/api.ts` | `apiGet` / `apiPost`，JSON 解析与错误透传（`ApiError.detail` 对应 Angular `err.error?.detail`） |
| 会话合并纯函数 | `src/utils/session-merge.ts` | 4 步合并算法 `mergeSessions`、queue 映射 `mapPendingQueue`、状态推导 `getTaskStatus`、设备序列号 `resolveDeviceSerial`、轮询签名 `statusSignature`（框架无关，配 vitest 单测） |
| 会话 store | `src/stores/session.ts` | 从 Angular `AgentService` 逻辑平移：合并算法 + **2s/6s 双频轮询** + **轮询签名去重** + **停止/删除/清空乐观更新与签名失效** + **localStorage 会话缓存**（key 与 Angular 版一致）+ pin 语义的会话选择 + **页面隐藏暂停轮询 / visibilitychange 立即刷新** |
| 系统 store（最小） | `src/stores/system.ts` | 仅 `/api/status` 连通性轮询（5s）与顶栏小圆点；完整诊断功能留给 M5 |
| 工作台 | `src/views/WorkspaceView.vue` | `a-layout` + 可拖拽分栏（rAF 合帧）+ 时间线 M2 占位 |
| 任务队列面板 | `src/components/TaskQueuePanel.vue` | 队列/历史两个 tab（`a-badge` 计数），`a-list` + `a-tag` 状态色，运行中停止、历史 `a-popconfirm` 删除、`a-popconfirm` 清空历史，点击选中会话（pin 语义） |
| 命令条 | `src/components/CommandDock.vue` | 常驻输入行（早期是悬停/聚焦才展开的胶囊，现按要求改为始终展开，Ctrl+K / ⌘K 仍聚焦输入框），`a-input` 回车提交 `/api/run`，flash/pro profile 持久化，模型选择器与启动器、诊断向导共用 `ModelSelect.vue` 的同一份 system store 状态，错误 5s 自动消失 |
| 顶部导航 | `src/components/AppNav.vue` | 页面入口 + 连接小圆点 + 运行器状态 tag |
| 启动器 | `src/views/LauncherView.vue` | `a-textarea` 任务提交（复用同一 store 提交路径）+ 会话数摘要（`a-statistic`）；诊断向导不做（M5） |
| i18n | `src/locales/{zh-CN,en-US}.ts` | 状态 / 连接 / 队列 / 命令条 / 启动器 key 全量补齐，键集一致性由 `locales.spec.ts` 锁定 |

### 与后端的端点契约（与 Angular 版实际调用一致）

- `GET /api/status`（2s 轮询）、`GET /api/sessions`（6s 轮询）
- `POST /api/run`（`{goal, profile}`，可选 `expected_output` / `enable_outputter` / `verification_level` / `explorer_mode` / `model_endpoint`；`model_endpoint` 为端点库记录名，提交时把选择器当前生效的那条 pin 给本次任务——后端校验名字存在后由队列 worker 导出 `ARTEMIS_MODEL_ENDPOINT`，此后全局默认再切换也不影响该任务，会话列表/运行信息气泡按 `model_info.endpoint` 显示这条运行用的端点；名字不在库里后端直接 400，未存入库的当前端点不发该字段）
- `POST /api/stop?all=&session_id=`（query + body 双通道）、`POST /api/resume`
- `POST /api/sessions/{id}/delete`、`POST /api/cleanup`

### 测试

- `src/utils/session-merge.spec.ts`：合并 4 步算法逐条覆盖（含 §3.3 条款 3 的
  「队列→运行不闪烁」桥接用例）、queue 映射、状态推导、签名去重。
- `src/stores/session.spec.ts`：平移自 `agent.service.spec.ts` 的停止/恢复/提交用例 +
  签名去重（payload 不变时响应式引用稳定）、签名失效（乐观更新后强制重新应用）、
  轮询节奏（2s/6s）、visibilitychange 立即刷新（§3.3 条款 6）、localStorage 缓存恢复。

```
src/
  ...（M0 部分不变）
  services/        api.ts（fetch 封装）
  utils/           session-merge.ts（会话合并纯函数）+ spec
  stores/          session.ts / system.ts（M1）
  components/      AppNav / TaskQueuePanel / CommandDock（M1）
```

## M2 完成范围（会话时间线详情 / Notes / Checker / Usage）

> 对应调研报告 §5.3 的 M2 行、§3.2 组件族映射表与 §3.3 运行时语义条款 2。

### 交付内容

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| Markdown 封装 | `src/utils/markdown.ts` | **markdown-it + DOMPurify 安全渲染**（调研报告 §3.1 的两个新增依赖）；结构化笔记解析 `parseNote`/`parseNoteLines`/`parseMarkdownSegments` 与 `extractCheckerResult` 自 Angular `markdown-parser.util.ts` 原样平移——**milestone / verify / assert / finding 语义保留**；流文本渲染保留 agent XML 标签剥离与检查行徽标语义，原始 HTML 一律转义/白名单过滤 |
| 时间线聚合 | `src/utils/stream-aggregator.ts` | 自 Angular 原样平移：日志 → 去重排序时间线块（`consolidateLogsToBlocks`）、阶段分组（`groupBlocksToPhases`）、token 提取（`extractBlockTokens`）、事件交错排序（`getSortedStepEvents`）、Checker 账本 transcript 重建（`persistedStreamToSegments`） |
| 动作/工具格式化 | `src/utils/action-formatter.ts`、`src/utils/tool-formatter.ts`、`src/utils/image-coords.ts` | 自 Angular 原样平移（仅 import 路径调整）；动作卡/工具行的字段取值与 Angular 实际字段一一对应 |
| Run 信息 | `src/utils/run-info.ts` | 耗时 / token 紧凑格式 / 上下文占比 / Pro 调优标签（自 Angular 原样平移） |
| 启动进度 | `src/utils/startup-progress.ts` | `buildStartupWorkItems`：进程级事件折叠为三条设备准备操作 |
| 时间线 store | `src/stores/timeline.ts` | steps/notes/checks/usage/startup_progress 的获取与聚合；**§3.3 条款 2：`history_snapshot` 永远排在 live 之前（快照可整体替换、live append-only）、`checks_snapshot` 可重复拉取不产生重复块（先剔除旧快照再追加）**；会话切换世代守卫（过期响应不落库）。M3 实时流直接复用该合并规则 |
| 时间线容器 | `src/components/timeline/AgentTimeline.vue` | 容器 + 阶段分组（`Worked/Checked for Xs · tokens`）+ 启动准备块 + 任务报告卡（output.md）+ 顶部工具条；选中会话变化时重新拉取渲染 |
| 步骤卡片 | `src/components/timeline/StepCard.vue` | 单步动作卡片：步骤号 / 耗时 / token、思考（Thought）与执行（Work）markdown 流、任务报告卡、Android 动作卡（目标/输入/坐标/边界/前后截图 `a-image` 预览）、工具行与工具卡（note 工具 pill 点击跳转笔记）、LLM 重试与失败卡 |
| Checker 面板 | `src/components/timeline/CheckerPanel.vue` | checker attempt 折叠面板（`a-collapse`）：阶段标签 / 声明检查项 / Thought-Work 交错流 / 逐项结论与附注 |
| 笔记面板 | `src/components/timeline/NotesPanel.vue` | `a-tabs`（一个 note 文件一个 tab）+ 结构化 markdown 渲染（milestone 勾选树 + verify/assert/finding 校验卡） |
| Run 信息气泡 | `src/components/timeline/RunInfoPopover.vue` | `a-popover` + usage/token 数据（对照 `/api/sessions/{id}/usage` 真实字段：total/prompt/completion tokens、上下文占比 `a-progress`、Pro 调优标签）；打开或会话变化时拉取、运行中每 3s 刷新 |
| 笔记文档渲染 | `src/components/timeline/NoteDocument.vue` | ParsedNote 结构化渲染（NotesPanel 与任务报告卡共用） |
| 接线 | `src/views/WorkspaceView.vue` | M1 占位替换为 `AgentTimeline`；TaskQueuePanel 点击历史条目 → session store 选中（pin 语义）→ timeline store 拉取渲染，选中状态双向联动 |

### 端点契约（与 Angular `agent.service.ts` 实际调用一致）

- `GET /api/sessions/{id}/steps` → 快照回填（`history_snapshot` 语义，幂等）
- `GET /api/sessions/{id}/notes` → `{notes: Record<key, markdown>}`，默认选中 `task_plan.md`
- `GET /api/sessions/{id}/checks` → `{records[], streams[], run_outcome}` 重建为合成 checker 日志（`checks_snapshot` 语义，幂等）
- `GET /api/sessions/{id}/usage` → RunInfo 气泡数据
- `GET /api/sessions/{id}/startup_progress` → 启动准备块（按 stage 幂等合并）
- `/api/sessions/{id}/tree` 按决策不接入（D3 增强排除）

### 测试

- `src/utils/markdown.spec.ts`：平移自 `markdown-parser.util.spec.ts` 的 milestone 语义断言
  （verify/assert@end/finding 行解析、parseNote 分组、徽标 HTML）+ markdown-it 封装的
  安全渲染用例（原始 HTML 转义、agent 标签剥离、代码块）。
- `src/utils/stream-aggregator.spec.ts`：平移 checker 车道 / 步骤归属关键用例 +
  **回填幂等用例**（重复回填 steps/checks 快照不产生重复块、history_snapshot 永远在 live 之前）。
- `src/utils/run-info.spec.ts`：平移耗时 / token / 上下文占比 / 调优标签断言。
- `src/stores/timeline.spec.ts`：store 层回填语义（steps 快照替换 + live append-only、
  checks 重复拉取幂等、streams → stream_segments 重建、notes 默认 tab、startup_progress
  按 stage 幂等、世代守卫丢弃过期响应、会话清除重置、usage 过期丢弃）。

### 已知边界（M3/M4 接入）

- ~~无实时流（SSE/打字机/暂停重试卡片/planning loader）~~ —— SSE/暂停重试卡片/planning loader
  已随 **M3** 接入（见下节）；逐字符打字机动画见 M3 已知边界。
- 录像按钮 / step 帧回放 / canvas 坐标叠加在 M4（`extractStepReplayFrames` 等纯函数已平移）。
- 工具行 / 动作卡内由 util 生成的描述文案（如 "Tapping Element"）保持英文——
  M6 终审确认其为长期边界（见下文 M6 已知边界）；组件级界面文案已全部走 i18n
  （zh-CN/en-US 键集一致）。

## M3 完成范围（SSE 实时流）

> 对应调研报告 §5.3 的 M3 行与 §3.3 运行时语义条款 1 / 2 / 5。
> 验收标准：实时流逐事件对照无缺帧；停止/暂停恢复/`llm_retrying` 卡片正确；
> 断线重连后快照 + live 合并无重复。

### 交付内容

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| SSE store | `src/stores/stream.ts` | 单通道 `EventSource('/api/stream')`（幂等 `start()` / `stop()`；断线依赖浏览器原生重连）；**17 种事件逐条平移**（自 Angular `agent.service.ts` L762-1436）：`llm_stream` 合批（可见 80ms / 页面隐藏 500ms，按 `execution_id` + `stream_type` 键）、**非流事件先 flush 再落库**（§3.3 条款 1）、新 execution 关闭同泳道（stream_type + parent_trace_id）未完成流、`trace_recorded` 按 trace_id 就地去重、note 工具 trace 触发 `fetchNotes`、`llm_stream_reset` 丢弃缓冲并标记 `isReset/resetMessage`、`llm_retrying` 合成重试 trace（request_id + scheduled_at 去重）、`task_paused/task_resumed` 状态机与暂停卡合成（session+error 去重）、`session_ended` 终态映射（cancelled/failed/completed）与全局状态推导、`session_started` / `startup_progress` **自动跟随（pin 语义）**、`info` 事件触发当前会话快照对账（断线重连后 §3.3 条款 2 幂等回填）、其余事件按 session_id（trim+lowercase）过滤 |
| store 接线 | `src/stores/session.ts`、`src/stores/timeline.ts` | session 导出 `setSessionStatus` / `invalidateStatusSignatures`；`fetchStatus` paused 分支接暂停卡兜底（轮询补偿）、非 paused 清卡片键；`stopTask` 接 `resetRetryState` + `markStoppedSessionStreamsCompleted`（平移自 Angular stopTask L529-549）；`selectSession` 切换时重置暂停态；timeline 新增 `appendStartupEvent`（按 stage 幂等合入会话桶） |
| 时间线 UI | `src/components/timeline/AgentTimeline.vue` | planning loader（`checkPlanningLoader` 三态，运行中等待下一步时显示）、LLM 重试警示条（由 `retryInfo` 经 i18n 组装，attempt/max 为 0 时省略）、任务暂停卡（`isViewingPausedTask` 条件 + pausedError 文本 + 恢复按钮 `resumeTask()`）、自动滚动（150px 接近底部阈值 + 50ms 合批，流文本盒钉底） |
| 断流提示 | `src/components/timeline/StepCard.vue` | 流文本块 `data.isReset` 时显示 `resetMessage`（缺省 `DEFAULT_STREAM_RESET_MESSAGE`） |
| i18n | `src/locales/{zh-CN,en-US}.ts` | 新增 `workspace.timeline.planning / retrying / retryAttempt / retryDelay / pausedTitle`（键集一致性由 `locales.spec.ts` 锁定） |
| App 启动 | `src/App.vue` | `streamStore.start()` / `stop()` 随根组件生命周期启停 |

### 端点契约（与 Angular `agent.service.ts` 实际行为一致）

- `GET /api/stream`（SSE 单通道；订阅 all/active 时服务端重放 `session_started` +
  `startup_progress` + 已落库 `step_recorded`；5s keep-alive 心跳；浏览器 EventSource 原生重连，
  重连成功后的 `info` 事件触发 `backfillSessionSteps` 快照对账）

### 测试

- `src/stores/stream.spec.ts`（新增 22 用例）：合批与 hidden 500ms、泳道关闭、
  flush-before-append 顺序、reset 语义、重试 trace 去重、暂停卡去重、
  session_started/ended 状态机与自动跟随（pin 生效时不跟随）、会话过滤、
  trace_recorded 去重、startup_progress 幂等合并、stop 收尾。
- `src/components/timeline/AgentTimeline.spec.ts`：追加 planning loader 三态、
  暂停可见条件、重试文案组装、断流提示渲染 6 用例。
- `src/stores/session.spec.ts`：适配 stream store 接线（夹具补选中会话）。

### 已知边界（M4/M6 接入）

- ~~`recording_ready` / `recording_failed` 事件分支已预留~~ —— 播放器联动已随 **M4** 接入（见下节）。
- ~~逐字符打字机动画与流重置 rewind~~ —— 已随**迁移后增量**补齐（见文末"迁移后增量迭代"）。
- 重试延时文案保留 1 位小数（Angular 为 2 位）；~~planning loader 未平移 Angular 的
  轮换短语~~ —— 16 条轮换短语已随**迁移后增量**补齐。

## M4 完成范围（回放 / 投屏）

> 对应调研报告 §5.3 的 M4 行与 §3.3 运行时语义条款 5。
> 验收标准：从 step 卡片/工具行点击打开回放并定位到对应帧/时刻；分段录像跨
> scrcpy 重启无缝播放；live 模式投屏可用。

### 交付内容

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| 播放器状态机 | `src/stores/player.ts` | 自 Angular `agent.service.ts` L236-278 / L1776-2011 平移：`openVideoPlayer`（running/paused 会话直接 live 态；seek/stepIndex 预置）、`requestSessionVideo` 四态轮询（generation 守卫 + `retry_after_ms` 500~3000ms 钳制退避 + 120s 超时，§3.3 条款 5）、`beginRecordingFinalization` / `refreshActiveRecording` / `retryVideoRecording`、`videoSeekRequest` / `stepSeekRequest`（requestId 递增）、`consumeVideoAutoplay`、ready 时回写 `rawSessions.video_url/recording_status`；`currentSessionStepFrames` 保留 Angular `stepLogsForReplay` 引用稳定语义（llm_stream 更新不触发帧重提取） |
| 双时间轴 util | `src/utils/recording-timeline.ts` | 自 Angular `recording-timeline.util.ts` 全文平移：`hasSessionOffsets` / `locateTimelineTime` / `locateSessionTime` / `sessionTimeToTimelineTime`（跨 scrcpy 重启分段的时间换算）；spec 全部用例平移 |
| 坐标叠加 util | `src/utils/image-overlay.ts` | 自 Angular `image-overlay.util.ts` 平移绘制部分：`drawActionCoordinatesOnOverlay`（非触控动作过滤、sequence 多点连线）+ DOM/SVG marker（`createPointMarker` / `createSequenceConnector` / `createLineMarker`；与 Angular 母本同为 DOM marker 机制，非 canvas 2D） |
| 类型契约 | `src/types/session.model.ts` | 补 `VideoSegment` / `SessionVideoResponse` / `RecordingPlaybackStatus` |
| 浮动播放器 | `src/components/FloatingPlayer.vue` | 自 Angular `FloatingVideoPlayerComponent` 平移交互语义、视觉按 Arco token 重做：可拖拽浮窗（最小化/还原/关闭）；**video 模式**分段 `<video>` 顺序无缝续播 + 段内/整场双时间轴 seek + `videoSeekRequest` 消费；**steps 模式**帧回放（pre/post 切换、帧导航、幻灯片播放、`stepSeekRequest` 跳帧、hover/pin 详情卡、图 onload 后坐标叠加）；**live 模式** MJPEG 投屏（`/api/stream/device-live` 时间戳破缓存 + LIVE 徽标）；processing/failed/unavailable 状态条（后端透传 message 优先，固定文案 i18n）+ 重试按钮 |
| 入口接线 | `src/views/WorkspaceView.vue`、`src/components/timeline/AgentTimeline.vue`、`src/components/timeline/StepCard.vue` | 工作台挂载播放器；时间线工具条"屏幕录像"开关（title 按运行中/准备中/可播放/帧回放四态 i18n）；video_analysis 工具行区间 pill 点击 → `openVideoPlayer(session, undefined, undefined, requestedRange.start)`（平移自 `onVideoToolClick`） |
| SSE / 会话联动 | `src/stores/stream.ts`、`src/stores/session.ts` | `recording_ready` → `refreshActiveRecording(true)`、`recording_failed` → `notifyRecordingFailed`（会话过滤之前）；`session_ended` 与 fetchStatus active→idle 时 live → `beginRecordingFinalization`；deleteSession 关闭播放器；selectSession 时视频窗口随切换刷新 |
| i18n | `src/locales/{zh-CN,en-US}.ts` | 新增 `workspace.player.*` 59 键（键集一致性由 `locales.spec.ts` 锁定） |

### 端点契约（与 Angular `agent.service.ts` 实际行为一致）

- `GET /api/sessions/{id}/video` → `{status, has_video, video_url, video_segments, retry_after_ms?, message?}`
  （processing 时按 `retry_after_ms` 退避轮询，500ms~3s 钳制，120s 超时）
- `GET /api/stream/device-live`（MJPEG `multipart/x-mixed-replace` 实时投屏）
- `/videos/{path}` / `/images/{name}`（分段录像与 step 前后截图）

### 测试

- `src/stores/player.spec.ts`（14 用例）：live 分支不请求、四态轮询与退避钳制边界、
  120s 超时、两代 generation 守卫、finalization 非 active 直接 return、autoplay 消费、
  帧提取引用稳定。
- `src/utils/recording-timeline.spec.ts`（9 例，Angular spec 全量平移）、
  `src/utils/image-overlay.spec.ts`（5 例）。
- `src/components/FloatingPlayer.spec.ts`（10 例）：live/processing/failed 渲染、
  后端文案透传优先、帧导航与 stepSeekRequest/videoSeekRequest 消费、跨段续播、
  StepCard pill 点击 → `openVideoPlayer(..., 12)`。
- 既有 session / stream / timeline spec 无回归。

### 已知边界（M5/M6 接入）

- `recordingPlaybackMessage` 仅存后端透传文案；Loading/Finalizing/超时等固定文案由 UI
  按 status 走 i18n（Angular 为 service 内英文硬编码）——与 Angular 的有意偏差。
- 双时间轴的模式切换在 unavailable 有帧时也引导切 steps（任务要求的新增，Angular 无）；
  steps 模式的幻灯片播放/倍速为平移范围内的增强。
- ~~诊断向导（readiness 三步引导 / ADB 管理 / emulator / 凭据）随 M5 接入~~ —— 已随
  **M5** 交付（见下节）。

## M5 完成范围（系统 / 诊断）

> 对应调研报告 §5.3 的 M5 行与 §3.2 的 SystemService / HomeComponent 映射。
> 验收标准：空环境跑通引导到就绪；远程 ADB / emulator launch 的 1s 轮询进度正确。

### 交付内容

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| 系统 store | `src/stores/system.ts` | 自 Angular `SystemService`（610 行）完整平移：`fetchReadiness`（silent/force 两参、**共享 in-flight 请求**防慢探针排队、**timestamp 单调守卫** + **内容签名去重**——3s 轮询零响应式抖动）、3s 自动轮询（页面隐藏暂停 + visibilitychange 静默刷新）；emulator 生命周期（`launchEmulator` 乐观初始态、**1s 状态轮询**、ready/failed/stopped/idle 停轮询并联动 readiness 刷新、失败合成态）；ADB 管理（`restartAdb` / Wi-Fi `connectWirelessAdb` / 远程 server `fetchAdbServerStatus`·`probeAdbServer`·`connectAdbServer`·`useLocalAdbServer` / `selectDevice`，返回 report 幂等应用）；凭据（`testApiKey` 不落库验证、`updateApiKey` 应用 report 并刷新 model-config-env、`skipCredentialsCheck` 旁路）；端点配置（`saveModelConfig` / `useEndpoint` / `updateApiKey` 成功后**同时刷新 `model-config-env` 与 `credentials/entries`**——两处读的都是 artemis.jsonc 的 `default` 块，漏刷其一就会出现「保存成功但页面没变」；`deleteEndpointRecord(row)` 按行来源分流：库记录走 `/endpoints/{name}`（名字过 `encodeURIComponent`，否则 `/` 会多切一段路径），只存在于 default 块的那行走 `/model-config`）；三步引导 computed（`isEnvironmentReady` 四条件、`isCredentialsReady`、`isDeviceReady`、`passedStepCount` 等）与 probe lookups（llm/ocr 双 id 兼容）；M1 的 `online` 连通性行为兼容保留并与 readiness 联动 |
| 类型契约 | `src/types/system.model.ts` | 补 `ModelConfigEnvResponse`（自 Angular `system.service.ts` L581-609） |
| 诊断向导 | `src/components/diagnostics/` | `DiagnosticsWizard.vue` 容器（三步完成度 + 手动重新检测 + 跳过凭据 + 就绪横幅；模拟器启动期 watch 驱动 1s 状态轮询）；`EnvironmentStep.vue`（python/adb/config/toolchain 四探针卡 + `probe.actions` 三类动作 + 一键安装条 + 设备列表）；`CredentialsStep.vue`（三张卡：`EndpointConfigForm.vue` 端点信息录入 —— 提供商自由命名 + API 格式下拉 + 端点地址 + 模型 + 可选 Key，保存即写 `default` 块并存成一条端点库记录；当前模型配置卡 —— 逐项显示 `default` 块的真实端点名 / 协议 / 端点地址 / 模型 / 思考等级 / 回退，缺项标「未配置」而不用兜底常量冒充，卡内切换行改用共用组件 `ModelSelect.vue`（候选只来自端点库 —— 配置文件里的厂商预设已随响应契约一起删除；当前生效的那条就是选中值，未存入端点库的当前端点以只读条目占位、选中它不发请求；选中即生效，切换失败时单向绑定让下拉弹回原值）与 JSONC 折叠查看器（`api_key` 已在后端掩码）；`CredentialsManager.vue` 端点库表格 —— 一行一条记录、生效的那条带「当前」徽标、`table-layout: fixed` + 不换行 + 省略号让行高一致，编辑回填表单、删除按行来源分流）；`DeviceStep.vue`（四态互斥：就绪+多设备切换 / 启动中进度跟踪（35%/65% 阈值 + 日志流 + 停止）/ 失败诊断卡（重试[远程 ADB 禁用]+重启 ADB+关闭）/ 连接引导（Emulator AVD 列表 · USB · Wi-Fi 表单 · 远程 ADB Server 面板），其开合由 `showConnectionMethods` 单独决定：「无可用设备」只作为**初始**展开条件（watch 跟随），用户亲手开合一次后就不再被自动条件改回去 —— 以前写成「手动开 或 自动开」，无设备时自动项恒真，「收起连接方式」点了没有任何变化）；「未检测到 AVD」这类**检测结论**放在折叠块外面（`.avd-empty-notice`，条件为「未就绪 且 adb 未失败 且 已安装 AVD 数为 0」），收起连接方式也不会连带藏掉，面板内的模拟器页签只留一行指向它的说明（`.avd-empty-inline`），不重复出第二份告警）；`useCopy.ts` / `errors.ts` 辅助 |
| 契约视图 | `src/components/diagnostics/contract.ts` | 组件侧窄契约 `SystemStoreContract` + **编译期结构断言**（真实 store 必须逐字段兼容，数据层漂移即编译报错） |
| 启动器集成 | `src/views/LauncherView.vue` | 顶部 diagnostics/launcher 双 tab 切换（就绪时 diagnostics tab 打勾，对齐 Angular 首页）；launcher tab 保留 M1 任务提交与摘要 |
| i18n | `src/locales/{zh-CN,en-US}.ts` | 新增 `launcher.tabs.*` / `launcher.diagnostics.*` 约 130 键（键集一致性由 `locales.spec.ts` 锁定）；probe 的 title/summary 等后端字段原样透传不 i18n；例外：`launcher.presets.items.<id>.title/goal` 只登记在 zh-CN，en-US 故意不复制（英文以 `task_preset_catalog.py` 为权威，复制即漂移），该不对称由 spec 断言钉住 |

### 端点契约（与 Angular `system.service.ts` 实际调用一致）

- `GET /api/system/readiness?force=`（3s 静默轮询 + 手动强制刷新）
- `GET/POST /api/system/adb/server`、`POST /adb/server/probe|connect|local`、`POST /adb/restart`、`POST /adb/connect`、`POST /devices/select`
- `GET /api/system/emulator/status`（1s 轮询）、`POST /emulator/launch|stop|dismiss`
- `POST /api/system/credentials/test`、`POST /api/system/credentials`（provider 沿用母本 `'google'` / `'ocr'`）
- `GET /api/system/credentials/entries`（端点库一行一条记录，Key 仅掩码回显；`is_active` 标出
  运行时正在用的那条，`source` 说明它来自库记录还是只存在于 `default` 块）
- `GET /api/system/model-config-env`（`default_model` 剥掉 `api_key`，`config_content` 里的
  `api_key` 值同样按掩码规则改写，密钥不过网络；不再返回 `presets`）
- `POST /api/system/model-config`（写 `default` 块与 `.env`，填了提供商名再存成一条端点库记录）
- `POST /api/system/endpoints/use`（**端点库是可选端点的唯一来源**：按名字取记录写入 `default` 块，
  并清掉该记录未声明的端点自有字段 `api_base` / `api_key` / `fallback`——jsonc 的 `api_base` 优先于
  `OPENAI_BASE_URL`，残留会把请求继续指向上一个端点，旧 `fallback` 会指着上一家的模型；
  `thinking_level` 这类推理旋钮不清）
- `DELETE /api/system/endpoints/{name}`（只移除库记录，不动运行时配置）、
  `DELETE /api/system/model-config`（移除 `default` 块，回到出厂配置）
- 端点库落盘在 `.env` 同级的 `endpoint_library.json`（gitignore，与 `credential_bindings.json`
  同一族）：它是 UI 的记录存储，运行时读的仍是 artemis.jsonc 的 `default` 块，库里不存密钥

### 测试

- `src/stores/system.spec.ts`（30 用例）：silent/force、共享 in-flight、单调守卫、
  签名去重（引用稳定断言）、3s 轮询 + hidden 跳过 + visibilitychange、emulator 乐观态/
  1s 轮询四态/失败合成、ADB connect 失败不更新/local query persist/probe 无副作用、
  凭据 report+modelConfigEnv 刷新/skip 旁路、**保存与切换端点后配置卡与端点库同时刷新**、
  **删除按行来源分流且名字过 URL 编码**、三步 computed 四条件、stop 清全部定时器。
- `src/components/diagnostics/DiagnosticsWizard.spec.ts`（19 用例）：三步完成度、
  emulator 进度阈值与停止、远程 ADB 禁用重试、Wi-Fi 提交、凭据测试/保存、
  多设备切换、JSONC 折叠查看器、端点库表格与编辑回填/删除（含「当前」徽标）、
  **切换行在配置卡内、候选只来自端点库（「用了但没存」的 default 行不进候选）**、
  **当前项不可重复选用**、**选中的记录被删后选择自动作废**、
  **default 块为空时标「未配置」而非兜底常量**。
- `src/views/LauncherView.spec.ts`：补双 tab 用例。

### 与 Angular 的偏差

- 环境安装命令改为后端 `probe.actions` 驱动（移除 OS 选择 pills）；多设备切换用
  `a-select` 替代手写 chips；空 AVD 教程压缩为一条引导提示；window focus 重检与
  CLI/Android Studio 图文教程未平移。
- `useLocalAdbServer` 的 `persist` 经 URL query 传递（v2 `apiPost` 无 params 支持，
  与 `/api/stop?all=` 惯例一致）。
- `fetchReadiness` 成功/失败顺带联动 M1 的 `online` 连通性小圆点（增强）。
- 收尾集成：并行开发的桥接层已由 cast 改为编译期结构断言，镜像类型收敛到真实契约。

## M6 完成范围（i18n/主题终审 + wheel 产物同步 + 托管切换收尾）

> 对应调研报告 §5.3 的 M6 行与 §4.2 的"容易遗漏的一步"。迁移至此完成。

### wheel 内置产物同步（脚本机制）

- 脚本：`scripts/sync-wheel-resources.mjs`（Node ESM，零依赖，仅 `node:fs`/`node:path`；
  CLI 行为由 `scripts/sync-wheel-resources.spec.mjs` 覆盖，支持 `--src <dir>` /
  `--dest <dir>` 注入路径参数便于测试）。
- 行为：校验 `dist/browser/index.html` 存在（缺失时报错退出并提示先 `npm run build`）→
  **清空**目标目录 `artemis/resources/showcase_ui` 全部内容（移除旧 Angular 平铺产物
  `main-*.js` / `polyfills-*.js` / `styles-*.css`）→ 复制 `dist/browser` 全部内容
  （含 `assets/` 子目录与 `public/` 拷入的 favicon/logo）→ 打印同步文件清单摘要。
- 用法：发布流程为 `npm run build && npm run sync:resources`。`sync:resources`
  是**发布动作，手动执行**，有意不挂进 `build`（避免日常构建误改 wheel 回退目录）。
  也可在仓库根目录用 `make release-ui` 一键完成构建 + 同步。
- 目标目录判定：`artemis/resources/showcase_ui` 是 wheel 安装态的回退产物
  （`artemis/resources/__init__.py::get_bundled_showcase_dist` 以 `index.html`
  存在为准）。同步后旧 Angular 平铺文件在 git 状态中显示为 deleted，属预期变更。

### 托管切换（决策 D2：一次性替换）

- 切换后：FastAPI `server.py:_get_showcase_dist()` 的探测候选已指向本工程
  `dist/browser`（源码树托管），SPA history 回退由 catch-all 路由的 index.html
  兜底天然支持；wheel 安装态经 `sync:resources` 同步后由 `artemis/resources/showcase_ui`
  提供同一份 Vue 产物。开发期仍用 `npm run dev` + 代理（报告 §4.3）。
- **回退手段**：从 git 历史恢复旧 Angular dist 并重挂——
  `git checkout <切换前提交> -- apps/showcase_ui/dist artemis/resources/showcase_ui`
  （或直接恢复 `apps/showcase_ui` 工程 `npm run build` 后重挂托管候选）。
  切换是一次性替换，无 /v2 并行子路径（决策 D2）。

### i18n / 主题终审结论

- **i18n**：grep 审计 `src/components/**`、`src/views/**`、`src/App.vue` 的模板
  属性（`title=` / `placeholder=` / `aria-label=`）与裸文本节点，发现并修复
  `StepCard.vue` 中 3 处硬编码英文（ADB 动作卡的 `Cwd:`、`Terminal ID:` ×2）
  → 统一走 `workspace.timeline.workingDir`（既有键）与新增键
  `workspace.timeline.terminalId`；键集一致性仍由 `locales.spec.ts` 锁定。
  其余保留项均为专有名词 / 协议标识：`ARTEMIS` 品牌名、`Ctrl + K` 快捷键、
  `Flash`/`Pro` profile 标识、`verify`/`@end` 笔记协议关键词、`Android` 系统名、
  probe/model 等后端字段透传值。
- **主题**：组件样式全部走 Arco token（`var(--color-*)` / `rgb(var(--*-N))`）。
  白名单保留：`FloatingPlayer.vue` 中视频视口纯黑底（`#000`）与红底白字 LIVE
  徽标（`#fff`）、纯黑遮罩/阴影（`rgb(0 0 0 / x%)`）——与主题无关的视觉常量；
  `utils/image-overlay.ts` 截图坐标叠加的红/白标记色（平移自 Angular，绘制在
  截图像素之上，需对任意截图保持可读，不做主题化）。
  `main.ts` 的 `body[arco-theme='dark']` 暗色机制与 `src/styles/index.css`
  token 覆盖核对无缺失。

### 已知边界（长期）

- ~~`src/utils/**` 生成的语义文案不 i18n~~ —— **已完成深度 i18n**（迁移后增量）：
  tool-formatter/action-formatter 共 89 处用户可见文案迁入 `tools.*` / `actions.*`
  键（157 键 ×2 locale，经 `utils/i18n.ts` 的 `tUtil` 走 vue-i18n 全局实例，
  en-US 输出与迁移前逐字节一致，util spec 以 en-US 断言锁定）。仅保留非 i18n
  对象：后端字段透传（probe title/summary 等）、协议 token、专有名词。
- ~~逐字符打字机动画与流重置 rewind 未平移~~ —— 已补齐（迁移后增量）。
- 主 bundle 超过 Vite 500 kB 分包提示（Arco 全量注册所致），gzip 后约 327 kB，
  保持全量引入以对齐 Angular 版能力，不做按需拆分优化。

## 迁移后增量迭代

M0–M6 之外的挂起项收尾（对应各里程碑已知边界与调研报告 §2.2 的"未消费端点"）。

| 项 | 内容 |
| --- | --- |
| 工程收尾 | `ipc_service.py` 删除 Angular 时代遗留别名 `filter_event_for_angular`；`package.json` 补 `engines: node>=20.19.0`（对齐 Vite 7 要求与 start.sh 校验）；`make release-ui` 一键构建 + 同步 wheel 回退资源；`changelogs.md` 补迁移完成记录 |
| 深度 i18n | 见上文 M6 已知边界的修订说明 |
| 打字机与轮换短语 | `useTypewriter` composable（双泳道 text/thought、母本节奏 667 chars/s 等价移植、live 判定零常驻定时器、`isReset` 单次 rewind）；planning loader 16 条轮换短语（2800ms，loader 可见才轮转） |
| 未消费端点接入 | `GET /api/tasks/presets` → 启动器推荐任务 chips（点击填入不直接提交，失败静默；chip 文案与填入的目标文本按 preset id 取 zh-CN 覆盖，无覆盖时退回后端英文目录原文）；`GET /api/sessions/{id}/tree` → 时间线工具条"轨迹树"抽屉（a-tree，按 trace 树节点归一渲染）；回放调试组（`/api/replay/tools 与 /api/replay/config`、`replay_steps`、`steps/{n}/replay`、`replay_traces`）→ 时间线工具条"步骤回放"抽屉（设备/工具选择 + **真实执行二次确认** + 结果折叠展示） |
