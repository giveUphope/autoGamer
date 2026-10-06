# ARTEMIS Showcase UI v2（Vue 3 + Arco Design Vue）

ARTEMIS Web 前端从 Angular 22 向 **Vue 3 + Arco Design Vue** 重构的新工程。
当前状态为 **M2 详情/轨迹**：Angular 版（`apps/showcase_ui`）仍在主路径服务，
新旧切换发生在 **M6**。迁移方案与决策见
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
npm install        # 安装依赖
npm run dev        # 开发服务器（http://localhost:5173，API 代理到 127.0.0.1:8000）
npm run build      # 类型检查 + 产物构建，输出到 dist/browser/
npm run preview    # 本地预览构建产物
npm run test       # Vitest 单次运行
npm run test:watch # Vitest watch 模式
npm run typecheck  # 仅 vue-tsc 类型检查
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
  回退目录，切换上线时需将 Vue 产物同步进去（M6 checklist，报告 §4.2）。

## 路由

| 路径 | 视图 | 对应 Angular |
| --- | --- | --- |
| `/` | `views/LauncherView.vue` | `HomeComponent`（诊断向导 + 任务启动器） |
| `/workspace` | `views/WorkspaceView.vue` | `WorkspaceComponent`（时间线 + 队列 + 播放器） |
| `/check` | 重定向到 `/workspace` | 旧版流视图，已淘汰 |
| 其余 | 重定向到 `/` | catch-all |

## 目录结构（M0）

```
src/
  main.ts          入口：Pinia / Router / i18n / Arco 注册，body 暗色属性
  App.vue          a-config-provider（Arco zh-CN locale + theme="dark"）+ router-view
  router/          路由表
  stores/          Pinia 实例注册（M1 起按 session/stream/player/system 拆分）
  locales/         vue-i18n（zh-CN 默认，en-US 键集由测试锁定）
  styles/          全局样式入口（Arco 暗色基调）
  types/           从 Angular core/models 原样平移的 5 个类型契约文件
  views/           LauncherView / WorkspaceView（M0 占位）
  test/            Vitest 环境垫片
```

## 里程碑

M0 脚手架 → M1 会话列表/队列 → M2 详情/轨迹（当前）→ M3 SSE 实时流 →
M4 回放/投屏 → M5 系统诊断 → M6 i18n/主题/打包收尾与切换。

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
| 命令条 | `src/components/CommandDock.vue` | Ctrl+K / ⌘K 唤起，`a-input` 回车提交 `/api/run`，flash/pro profile 持久化，错误 5s 自动消失 |
| 顶部导航 | `src/components/AppNav.vue` | 页面入口 + 连接小圆点 + 运行器状态 tag |
| 启动器 | `src/views/LauncherView.vue` | `a-textarea` 任务提交（复用同一 store 提交路径）+ 会话数摘要（`a-statistic`）；诊断向导不做（M5） |
| i18n | `src/locales/{zh-CN,en-US}.ts` | 状态 / 连接 / 队列 / 命令条 / 启动器 key 全量补齐，键集一致性由 `locales.spec.ts` 锁定 |

### 与后端的端点契约（与 Angular 版实际调用一致）

- `GET /api/status`（2s 轮询）、`GET /api/sessions`（6s 轮询）
- `POST /api/run`（`{goal, profile}`，可选 `expected_output` / `enable_outputter` / `verification_level` / `explorer_mode`）
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

- 无实时流（SSE/打字机/暂停重试卡片/planning loader）——`stores/timeline.ts` 的日志
  合并规则已按 live 到达的形态实现，M3 接入 `llm_stream` 时复用。
- 录像按钮 / step 帧回放 / canvas 坐标叠加在 M4（`extractStepReplayFrames` 等纯函数已平移）。
- 工具行 / 动作卡内由 util 生成的描述文案（如 "Tapping Element"）暂保持英文，
  深度 i18n 随 M6 收尾统一处理；组件级界面文案已全部走 i18n（zh-CN/en-US 键集一致）。
