# 迁移盘点 · 前端控制台与外部集成面

> 范围：`apps/showcase_ui_v2/src/**`（stores / utils / components / locales / co-located specs / vite.config）、`mcp_server/**`（工具面 + 7 通知通道）、`packages/artemis-client/**`（Python SDK）、SSE `/api/stream` 的服务端桥（`apps/admin_console/services/ipc_service.py` + `routers/tasks.py` 的 stream 端点，注意：仓库中**不存在** `artemis/ipc_service` 目录）、`tests/integration|e2e`、`scripts/`（dev.sh、quality_ratchet.py）、Makefile、start.sh/start.bat、pyproject/pre-commit 根配置；基线：cc6b20c；日期：2026-10-09
> 目的：记录 docs/todo.md **未写明、迁移中若无人记录即会丢失**的行为、不变量与契约。todo.md / 草稿 01–03 已覆盖的只标注出处、不展开。本文是 P4（外部接入方迁移清单）/ G7（过渡边界）/ P0（契约测试）的输入。
> 与既有草稿的分工：**01** 已覆盖后端 `/api/run` 准入管线、`/api/status` 四源、SSE 服务端事件名全集（含 `queue_held`/`queue_paused`/`queue_resumed`/`server_shutdown`）与订阅回放；**02** 已覆盖 worker env 全集；**03** 已覆盖媒体路由与诊断。本文从**前端消费方与外部调用方**视角补齐：每个事件前端怎么消费/忽略、控制台交互不变量、MCP 工具协议承诺、通知通道矩阵、SDK 公开面、开发/构建链。

---

## 1. SSE 事件契约（前端消费视角的对照基线）

### 1.1 传输与连接语义

- **单通道** `/api/stream`（可选 `/api/stream/{session_id}`），`text/event-stream`；前端幂等 `start()`，`onerror` 只告警，**依赖浏览器 EventSource 原生自动重连，不手动重建**（stores/stream.ts:679-706；stream.spec.ts:587-604 锁定 URL 与单例）。
- 服务端每连接一个 `asyncio.Queue` + 订阅回调，5s 无事件发 `keep-alive`，`state.shutdown_event` 触发即断流（routers/tasks.py:486-614）。订阅确认事件 `info`（tasks.py:520）。
- **断线重连对账**：前端收到 `info` 即对当前会话触发 steps 快照回填 `backfillSessionSteps`（stream.ts:686-691；stream.spec.ts:523-530）。服务端补发：`all/active` 订阅合成一条 `session_started` + 该会话全部 `startup_progress` + 已落库步骤逐条 `step_recorded`（tasks.py:522-566；草稿 01 §1.4 已覆盖服务端面）。
- **事件桥（worker→UI）**：worker 经 DataEngine 把 `{event_type, data}` JSON 行写到 127.0.0.1 TCP IPC（端口来自 env `ARTEMIS_IPC_PORT` + 端口文件**双候选**，env 因 UI 服务器重启永久陈旧而文件恒新，engine.py:445-524）；UI 侧 `ipc_service` 接收、按事件清洗后广播给 SSE 订阅者（ipc_service.py:136-228）。`session_started` 对 `cancelled_session_ids` 里的会话**静默丢弃**（ipc_service.py:150-158）；`startup_progress` 按 (session_id, stage) 幂等留档最近 16 条供晚订阅重放（state.py:257-278）。IPC 发送线程安全（锁内一次完整帧 + 单次重连，engine.py:499-524）。
- payload 清洗（ipc_service.py:32-134）：`trace_recorded` 的 tool/action payload 压成 `{args}`、llm_call 压成 `{error}`；`step_recorded/step_updated` **剥 `pre/post_screenshot_bytes`**（客户端经图片 URL 取图）并 `normalize_step_actions`；一切 "object at 0x…" / `<artemis.` 形态的值置 null。

### 1.2 事件名全集 × 前端消费矩阵

前端订阅面 = `STREAM_EVENT_TYPES`（stream.ts:47-63，15 种）+ `info` + `keep-alive`。**服务端广播但前端不订阅的事件会被浏览器 EventSource 静默丢弃**——这是迁移时最易漏的差异点。

| 事件 | payload 字段（发出方实证） | 前端消费（file:line） | todo.md 覆盖 | 处置建议 |
|---|---|---|---|---|
| `info` | `{message}` | 触发当前会话 steps 快照回填（断线对账），stream.ts:686-691 | 缺失（01 覆盖服务端面） | DSH `session/event` 需等价 catch-up 信号 |
| `keep-alive` | `{}` | 忽略（流保活），stream.ts:694 | 缺失 | DSH 原生心跳即可 |
| `session_started` | worker 桥：`session.model_dump()`（engine.py:664）；队列广播：`{session_id, initial_goal, profile, device_serial}`（task_queue_service.py:567-576）；服务端重放合成：无 `device_serial`（tasks.py:543-546） | 置 `agentStatus=running`、记 runningSessionId/Goal、`fetchSessions`；**自动跟随须经 `mayAutoFollowSession` 准入（绝不跨线程）**，stream.ts:403-425 | 缺失（跟随语义 todo 完全没写） | DSH toolview 重写时按 §2.4 复刻准入 |
| `session_ended` | `{session_id, status, was_stopped_manually}`（task_queue_service.py:933-941, 1448-1455, 1785；engine.py:721 发 model_dump） | 终态三态映射 cancelled/failed/completed（`success`→completed，未知不映射）；剔 activeTasks；**撤 tracking 桥接**；按剩余 activeTasks 推导全局态——**无剩余时回 idle，排队轮绝不提升为 running**；回查 sessions/status/notes/checks；live 投屏转录像 finalization 轮询，stream.ts:344-366, 427-471 | 缺失（9739f32 修复 + 测试锁定 stream.spec.ts:408-489） | 同上；「排队≠运行」是队列语义的一部分，进入 autogamer-queue 契约 |
| `startup_progress` | `{session_id, stage, message, timestamp, **details}`（artemis/utils/startup_progress.py:24-49；stage 集合见草稿 01 §2.3） | 按 stage 幂等并入会话桶（timeline store）；异会话且未 pin 且准入通过 → 自动跟随并置 running，stream.ts:474-492 | 缺失 | DSH jobs progress 原生；跟随准入照 §2.4 |
| `step_recorded` / `step_updated` | 步骤字典（清洗后：无截图字节，generic_tools 内 payload 归一） | 非流事件先 flush 流缓冲再落库；会话过滤（他session不入）；同轮就地更新，stream.ts:377-380, 494-651 | 缺失 | G2 toolview 渲染的输入格式以此为准 |
| `trace_recorded` | trace 字典（payload 已归一）；note 类工具名（save_note/read_note/update_note/append_note/list_notes/outputter）触发 fetchNotes | **同 trace_id 原位替换不新增**（重试/进度 trace 重复推送），stream.ts:638-661 | 缺失 | 去重键语义进 toolview 契约 |
| `llm_stream` | `{execution_id, session_id, parent_trace_id, step_id, chunk, stream_type('text'|'thinking'), is_thinking}`（engine.py:1150-1173） | **合批**：按 `${execution_id}|${stream_type}` 缓冲，80ms（前台）/500ms（document.hidden）定时落库；任何非流事件先 flush（顺序保证）；**泳道**：新 execution_id 只关闭同 `stream_type + parent_trace_id` 的未完成流（Operator/Checker 并发互不关闭），stream.ts:80-199 | 缺失 | 一期输出环展示（G2）可忽略；若做结构化 toolview 需复刻泳道，否则 Checker 流会截断 Operator 流 |
| `llm_stream_reset` | `{stream_exec_id（或 stream_execution_id）, action:'discard', reason:'mid_stream_failure', error, category, message, retry_attempt}`（llm.py:713-731） | 清缓冲；同 execution_id 日志就地标 `isReset/resetMessage`，完全没有则合成重置日志；置 `streamResetEvent`，stream.ts:553-608 | 缺失 | 「流中断部分输出不入历史」语义随 LLM 栈保留在 py worker，事件面随 G2 |
| `llm_retrying` | retry payload + `{step_id, trace_id, timestamp}`（llm.py:182-192）；payload 含 error/delay/attempt/max_retries/provider/source/recoverable/request_id/scheduled_at | 置 isRetrying/retryInfo（结构化，文案由 i18n 组装）；合成与历史 API 同形状的 retry trace，**同 trace_id 或同 request_id+scheduled_at 原位替换**，stream.ts:208-262, 504-515 | 缺失 | 同上 |
| `task_paused` | failure_payload + `{step_id, timestamp}`（llm.py:344-353） | 置 paused 态 + 合成暂停失败卡；**同 session+同错误去重**；已有同错误 failed trace 不重复，stream.ts:269-334, 517-535 | 缺失 | 暂停卡片是 HITL 可见性；DSH 侧审批/暂停展示需等价物 |
| `task_resumed` | `{}`（llm.py:507） | 复位暂停态/暂停卡键；runningSessionId 匹配才置回 running，stream.ts:537-547 | 缺失 | 同上 |
| `recording_ready` | **双形状**：engine 发 `{session_id, video_id, local_video_path, end_time}`（engine.py:765-775）；队列兜底发 `{session_id, video_url}`（task_queue_service.py:910-914） | 仅当视频窗口打开且属于正在回放的会话时驱动 player 状态机（refreshActiveRecording），stream.ts:382-395 | 缺失 | autogamer-media 插件须收敛为单一形状并保留 `video_url` 语义（media_service 的 URL 路由，见草稿 03） |
| `recording_failed` | engine：`{session_id, video_id, error}`；队列兜底：`{session_id, error}`（engine.py:799-808；task_queue_service.py:916-921） | notifyRecordingFailed，stream.ts:382-395 | 缺失 | 同上 |
| `checker_event` | attempt_started / attempt_finished / run_outcome（graph/checkpoints.py:72,158-210） | 走通用日志分支入 sessionLogs，由 stream-aggregator 聚合为 checker 块（stream-aggregator.ts:131-224, 274），AgentTimeline.spec.ts:274-292 锁定 | 缺失 | 二期 Checker 重写时是事件基线（G1 模式 a） |
| `background_tasks_updated` | `get_all_background_tasks()` 列表（engine.py:1611,1632） | **不直接用 payload**，仅触发 `fetchStatus()` 拉全量，stream.ts:398-401 | 缺失 | 通知型事件，DSH 原生 |
| **不订阅**：`queue_held` / `queue_paused` / `queue_resumed` | 草稿 01 §2.3 已列 | **前端无监听**——队列挂起/暂停状态靠 2s 轮询 `/api/status` 的 `queue_paused`/`queue_holds` 字段感知（session.ts:320-325；CommandDock.vue:37-42）。SSE 广播对控制台实际是死信道 | **矛盾**：01 建议把「队列级生命周期事件」作为 DSH 事件模型验证点，但现 UI 根本不消费它们；真正被依赖的是轮询字段 | 决策：DSH 侧若提供事件推送，需同时保留轮询等价字段，或 toolview 改为事件驱动（二选一要写明） |
| **不订阅**：`note_saved` | `{key, content}`（artemis/utils/notes.py:178） | 前端无监听；notes 面板靠 `trace_recorded` 的工具名触发 fetchNotes（stream.ts:653-661） | 缺失 | 删除（死事件）；或 DSH 通知层收编 |
| **不订阅**：`llm_stream_downgrade`（及 `_record_llm_event` 的其他降级名） | `{endpoint, error}`（llm.py:736-741） | 前端无监听；降级可见性靠 `trace_recorded`（record_trace 已持久化并另行广播） | 缺失 | 保留为 trace，事件本身可去 |

**覆盖状态小结**：事件名全集与订阅回放，草稿 01 §1.4/§2.3 已从服务端覆盖；**每个事件的前端消费语义、合批/泳道/去重规则、不订阅死信道清单为缺失**（todo 映射表只有一行「ipc_service + /api/stream ✅ 删除自建」）。
**处置建议**：本表即 P0 契约测试的对照基线（G5）；`session_ended` 的「排队轮不提升」与自动跟随准入应提升为 autogamer-queue/UI 契约测试项，不能只活在即将删除的 Vue spec 里。

---

## 2. 前端行为与不变量（按主题分节）

### 2.1 4-step merge 不变量（utils/session-merge.ts:96-270 + stores/session.ts）

映射表（todo L100/L104）只写了「4-step merge ✅ 删除自建，session log 单一事实源，无四源合并」。**四个源各自合并什么、为什么非有不可，todo 未写**。DSH 侧把「Inbox pending + running job + 历史轮」聚合成会话线程视图时，会重遇同一类问题：

1. **Step 1 — raw DB 行**：终态行（completed/failed/cancelled；`success` 归一 completed）从 tracking 表移除；非终态行状态由轮询覆盖（active→running/paused、在 pending 队列→pending）；pin 过端点的会话保留自己的 model_info，不被全局 activeModel 改写；tracking 收录 running/paused/pending（session-merge.ts:119-164；session-merge.spec.ts:38-137 逐条锁定）。
2. **Step 2 — pending 队列**：补齐 DB 行未落库的排队轮；**必须携带 `conversation_id` 与 `submitted_at`**（`mapPendingQueue`，session-merge.ts:276-303；spec:315-334）。否则新轮以 `round:<sid>` 合成键成「幽灵会话」，且连续提交拿不到线程 id 另起新线程（AGENTS.md 已载规则，其机制细节 todo 未载）。
3. **Step 3 — active_tasks**：外部入口/多设备运行、且列表中尚无表示的任务**新建为 running**（conversation_id/submitted_at 依次取 active 行→tracking 桥接→null，session-merge.ts:183-215；spec:152-181）；pending 表示被 active_tasks 升级为 running 时**只补缺不覆盖**（session-merge.ts:204-214）。activeList 为空但轮询报 running 的取走→持锁间隙：tracking 已有则复用其锚点复活（**绝不 now 现造遮蔽正确 submitted_at**），dismissed 的不现造（session-merge.ts:216-241；spec:183-199, 224-257）。
4. **Step 4 — tracking 桥接**：跨轮询持久的非响应式 `Map`（session.ts:97）桥接「队列消费→DB 落库」的窗口防闪烁；载荷仍提及→照常桥接并重置宽限；载荷不再提及且无 DB 行→**60s 宽限（GHOST_TRACKING_TTL_MS）后清除**，防外部误报永久驻留 running 幽灵（session-merge.ts:70-84, 243-267；spec:200-222, 258-295）。
- **dismissedNoRowSessions**：已停止且从未落库的会话 id 集合——停止后的补偿轮询旧载荷会短暂把它们写回 active/tracking，合并器按集合跳过；DB 行一旦出现即移出（session.ts:99-104, 370-376；session.spec.ts:489-517）。
- **sessionChronoKey**：轮次排序/展示锚点 = `submitted_at ?? start_time`；`start_time` 随生命周期漂移（入队时刻→获得设备时刻），用它排序会让发射的轮「上顶」乱序（session-merge.ts:27-37；spec:400-407；AGENTS.md 已载一句话，机制未载）。
- **conversationThreadKey vs submitConversationId**：合成 `round:<sid>` 键**只用于时间线/分组过滤**（session-merge.ts:375-380）；提交参数走 `submitConversationId`，它**拒绝暴露合成键**（session.ts:140-146；session.spec.ts:277-297）。selectSession 的线程联动依次取 raw 行/pending/active 的 conversation_id，全无线索才退化合成键（session.ts:704-723；spec:519-561）。
- **isDraftConversation**：「新建会话」已指派线程但无任何轮次落库的草稿态**豁免一切自动跟随**，否则 2s/6s 轮询把视图拽去别处、下一条消息误入他线程（session.ts:148-158；session.spec.ts:298-360；SessionListPanel.spec.ts:25-50）。
- **轮询签名去重**：`statusSignature`（JSON.stringify）内容不变则跳过响应式赋值；乐观更新（stop/delete/clear）先 `invalidateStatusSignatures` 防旧状态回写（session.ts:209-221, 308-325；session-merge.ts:364-370；spec:598-670）。
- **轮询节奏**：2s `/api/status` + 每 3 周期（6s）`/api/sessions`；`document.hidden` 暂停、visibilitychange 恢复即刷（session.ts:37-40, 258-271；spec:788-853）。localStorage 缓存 key `artemis.sessions.v1`（session.ts:37, 779-815）。
- **conversationGroups**：轮按 conversationThreadKey 聚合；线程内按 sessionChronoKey 提交序；线程名 = 最早一轮 goal；线程态取 running>paused>pending 的最高秩；活跃线程置顶其余按最近活动倒序（session.ts:841-877）。
- **runTask 回写**：以 `/api/run` 响应里的 `conversation_id` 回写当前线程（请求未带时后端新建），必须赶在下一轮 6s 轮询回填前，否则 selectSession 用合成键覆盖导致断线程（session.ts:465-471；spec:240-276）。`model_endpoint` pin 取提交时刻 system store 的端点名，未入库端点不编造（session.ts:426-432；spec:166-229）。

**处置建议**：映射表「问题本身消失」的判断对**数据源**成立，但对**展示聚合**不成立——DSH jobs roster / toolview 把 pending + running + 历史聚合成线程时，submitted_at 锚点、幽灵防护、草稿豁免、跨线程竞态这四类坑会原样重现。建议把本节作为 P3 UI 接入的验收清单输入。

### 2.2 CommandDock：队列 chip / 暂停 / 继续 / 停止多态（components/CommandDock.vue）

- **排队 chips**：数据源 `threadPendingRounds`（**按当前线程过滤**，session.ts:164-168）；纵向 FIFO 列表、最新在最下、可单独移除（移除 = 对该 session 走单任务 stop 路径，session.ts:495-497；CommandDock.vue:170-204；CommandDock.spec.ts:178-213）。
- **scoped 到线程**：`threadHasQueueStake` = 本线程有排队消息或有运行/暂停轮；暂停/继续控件只在「在场」时出现——新会话/历史线程**不得**显示或操作他线程的队列状态（CommandDock.vue:43-59；spec:242-275；提交 138695c）。
- **收敛动作**：手动暂停（`queue_paused`）与环境熔断挂起（`queue_holds`）收敛为同一个「继续队列」按钮（调 `/api/queue/resume` 双解除），原因只进悬浮提示，无说明文案（CommandDock.vue:52-59, 190-204；spec:214-241；对应 138695c「drop the state blurb」）。暂停入口只在有任务在场且无挂起时出现（只停新派发不影响运行中）。
- **提交/停止多态**：`currentConversationRunningTaskId` 非空 → 按钮变「停止」，停的是**当前线程内**运行中的轮（session.ts:198-207；CommandDock.vue:33, 231-238；spec:128-152）；停止后 400ms 防抖防按钮抖回（149-163）。
- **输入语义**：Enter 提交（续 `submitConversationId` 线程）、Shift+Enter 换行、IME 组词中 Enter 不提交；Ctrl/Cmd+K 聚焦；profile（flash/pro）持久化 localStorage `artemis_selected_profile`；提交失败经 `ApiError.detail` 展示 5s 自动消失（CommandDock.vue:81-147；spec:63-166）。

**覆盖状态**：todo 完全未提（前端行为整体只在映射表一行）。最近 6 提交中 46e59b2（纵向堆叠+never-started 持久化）、138695c（scoped+去文案）锁定于本 spec。
**处置建议**：队列 chips + scoped 交互是「Agent Inbox 可视化」的现成验收标准——P3 toolview 应对照本清单；删除 Vue 控制台时这些 spec 随之消失，需先把断言移植为 DSH 侧测试或本文件级清单。

### 2.3 AgentTimeline：时间线展示不变量（components/timeline/AgentTimeline.vue + spec）

- **排队轮不进时间线**：pending 轮只留在 dock 队列列表，时间线不渲染；发射后按原轮序出现（AgentTimeline.vue:76, 108；spec:639-679；提交 3a1facc）。
- **失败原因透出**：会话级 `error_message` 解释「轮次失败但无执行记录」的断点（AgentTimeline.vue:121, 901；spec:243-257）；SessionTreeDrawer 同样把无 trace 失败轮的会话错误作为断点（SessionTreeDrawer.spec.ts:124-148）。对应 46e59b2 的 never-started failed 行（后端补插最小失败行含 stdout 尾行，草稿 01 §3 风险 4 已覆盖后端面）。
- **回合级折叠**：历史会话（全部块完成）默认收起、头部显示步骤数；有未完成 live 块的回合自动展开、完毕后收起；轮级开合与动作卡手风琴语义（spec:422-638）。
- **运行指示**：planning loader（运行中且无日志；有未完成 llm_stream 块即隐藏；session_ended 后隐藏）、retrying banner（retryInfo 组装）、stream reset notice、暂停卡 + resume 动作（spec:293-420）。
- **媒体/回放入口**：replay 按钮与「重跑步骤」下拉 → ReplayDrawer（`GET /api/sessions/{id}/replay_steps`、确认模态后才 POST 回放、无设备禁用、回放中心双图/灯箱键盘操作，ReplayDrawer.spec.ts:145-292）；录像/投屏 → FloatingPlayer + player store（running/paused→live 不轮询；历史无 video_url→processing 轮询、retry_after_ms 钳制 [500,3000]ms、120s 超时、generation 守卫、llm_stream 到达不触发帧重提取，player.spec.ts:67-377）；设备实时投屏走 MJPEG `/api/stream/device-live`（routers/stream.py:31-56）。
- **快照回填（timeline store）**：切会话清空重拉、世代守卫丢弃过期响应；steps 快照幂等（history_snapshot 恒在 live 前）；checks 幂等且带 streams 时重建 Thought/Work 交错；notes 默认选中 task_plan.md；startup_progress 按 stage 幂等（timeline.spec.ts:30-244）。

**覆盖状态**：G2 只写了「一期接受输出环文本流、可选 JSONL+toolview」。**结构化卡片的信息骨架**（步骤/动作/截图配对/检查面板/笔记/失败断点）没有基线记录——二期把 ARTEMIS 执行逻辑搬入 DSH agent 时（G1 模式 a），这份 UI 语义就是 toolview 的渲染规格。
**处置建议**：本节 + §1.2 的 llm_stream/checker_event 语义合并作为 G2「可选小件」的实现规格；`StepEvent`/`CheckerBlockData`/`StreamSegment` 等类型契约见 types/stream.model.ts（前端删除前是唯一成文处）。

### 2.4 自动跟随与跨线程竞态防护（stores/session.ts + stores/stream.ts）

- **准入函数 `mayAutoFollowSession`**：目标会话属于当前查看线程（或当前无线程视图）才允许切换；目标线程暂不可解析（合并表示未到位）同样拒绝——SSE（stream.ts:417-424, 479-489）与状态轮询（session.ts:345-358）**共用同一准入**（session.ts:740-754）。理由：跨线程自动跟随会换走用户正在对话的线程，下一条消息借 `submitConversationId` 误入他线程队列（三个文件注释同文，提交 8a0108c）。
- **pin 语义**：用户显式点选非运行会话即 pin；点当前运行中的任务取消 pin 恢复跟随（session.ts:683-696）；runTask 提交成功即清 pin（session.ts:445）。已 pin 时 session_started/startup_progress/轮询都不抢视图。
- **fetchSessions 兜底选中**：仅初次（无选中、未 pin、非草稿、非 running）触发，优先**当前线程**最新轮；线程尚有在场（排队/运行）表示时不抢——等发射时由轮询跟随（session.ts:378-406；spec:443-487）。
- **session_ended 不提升排队轮**：全局 running 态只由剩余 activeTasks 推导（stream.ts:436-449；spec:461-489；提交 9739f32）。
- **轮询抢跑 /api/run 响应**：状态轮询先观察到新 runner 时那仍是刚提交任务而非应保持的旧任务（session.ts:452-464）。

**覆盖状态**：todo 仅在背景段提「前端侧已修：9739f32 等 5 个提交」，未写不变量本体。测试锁定完整（stream.spec.ts:323-406、session.spec.ts:361-487）。
**处置建议**：这是**队列×多会话 UI 的通用竞态经验**，与具体框架无关；autogamer-queue 的 toolview/roster 复刻线程视图时必须继承（见 §5 G11 建议）。

### 2.5 locale 键锁定机制（locales/locales.spec.ts）

- **键集合对齐**：zh-CN 与 en-US 递归叶子键集合必须相等，唯一豁免前缀 `launcher.presets.items.`（推荐任务 id 键，**只登记 zh-CN**，英文以后端目录为准；且每个 id 必须同时有 title+goal 非空）（locales.spec.ts:18-52）。`DEFAULT_LOCALE === 'zh-CN'` 亦被锁定（:22-24）。
- **机制性质**：这是纯前端测试锁，随 showcase_ui_v2 删除而消失；DSH Web UI 的文案无此约束。
- **覆盖状态**：AGENTS.md 已载（「en-US locale keys are locked by tests」）；todo 未提。
- **处置建议**：删除（随控制台）；若 DSH toolview 需要 i18n，preset id 键「单一事实源在 zh-CN/后端」的原则值得保留一句话。

---

## 3. 外部集成面（MCP / SDK / 脚本）

### 3.1 REST API 消费方总表（前端 + artemis-client + mcp_server 共用）

请求/响应字段级契约草稿 01 §2.1 已覆盖；此处补**消费方×端点**矩阵与前端侧语义：

| 端点 | 消费方 | 前端侧语义要点 |
|---|---|---|
| `POST /api/run` | UI、SDK（ingress=python_sdk）、MCP（经 daemon，ingress=mcp）、webhook（未来） | 幂等短路/409/400/rejected 管线见草稿 01 §1.1；UI 依赖响应 `tasks[0].session_id` 选中 + `tasks[0].conversation_id` 回写线程（session.ts:449-471） |
| `GET /api/status` | UI 2s 轮询、SDK health/get_task 兜底、dev.sh 就绪探测（`curl /api/status` 200 即 ready，dev.sh:83,91） | `queue_paused`/`queue_holds` 是队列状态的**唯一**前端信源（SSE 死信道，见 §1.2） |
| `POST /api/stop`（all/session_id/device_id，body 或 query 双通道） | UI stopTask、SDK stop、MCP stop（经 daemon） | UI 乐观更新 + 签名失效（session.ts:499-592） |
| `POST /api/resume` | UI resumeTask | 后端 `not_paused` 时**不乐观改状态**（session.ts:594-612） |
| `POST /api/queue/pause|resume` | UI dock | resume 同时解除手动暂停与熔断挂起（tasks.py:267-278） |
| `GET /api/sessions`、`GET /api/sessions/{id}` | UI 6s 轮询、SDK get_task | 行携带 conversation_id/submitted_at（SQLite 列，session_repository.py:536-566）；列表期对 running 行做存活校验、死→failed + 录屏 auto-harvest（草稿 01 §1.5 已覆盖） |
| `POST /api/sessions/{id}/delete`、`/api/sessions/delete-batch`、`/api/cleanup` | UI | delete-batch 一次请求删整线程（session.ts:879-923） |
| `GET /api/sessions/{id}/usage|tree|background_tasks|startup_progress` | UI（RunInfoPopover/SessionTreeDrawer/timeline store） | tree 是轨迹树数据源 |
| `GET /api/sessions/{id}/replay_steps` + replay POST | UI ReplayDrawer | 确认模态后才执行 |
| `GET /api/devices` | UI、SDK list_devices、e2e | `{devices:[d.to_dict()]}` |
| `GET /api/tasks/presets|catalog`、`GET /api/run/defaults` | UI 启动器/dock | defaults 回 verification_level+explorer_mode（tasks.py:201-214） |
| `GET /api/system/readiness`、`/api/system/*`（emulator/adb/model-config/credentials/endpoints 等 ~20 个） | UI system store + 诊断向导 | 草稿 03 §1.7 已覆盖后端；消费方在 system.ts:232-573 |
| `GET /api/stream(/{session_id})` | UI | §1 |
| `/images`、`/videos`、`/local_file` | UI（截图/录像/本地文件代理） | SameOrigin 鉴权语义见草稿 01 §1.7 |
| `GET /api/v1/capabilities` | **SDK capabilities()** | **服务端从未实现**——恒 404 → 客户端回退 legacy 假基线 `tasks.submit/get/stop, devices.list, system.readiness`（client.py:151-157, 62-70） |

**覆盖状态**：去留已覆盖（映射表 L103-105）；消费方矩阵与「capabilities 是假端点」缺失。
**处置建议**：迁移清单（P4）按本表逐行给 webhookRuntime/SDK 找等价物；capabilities 端点要么在 DSH 侧落实要么从 SDK 删除，不留隐性假基线。

### 3.2 mcp_server 工具面（stdio/sse 双传输，server.py:93-102；启动附带 awake_service）

| 工具 | 关键参数 | 外部承诺（docstring 即协议） | todo 覆盖 |
|---|---|---|---|
| `mobile_run_task`（tools/task_runner.py:204-549） | task_desc, conversation_id, model(Flash/Pro), locked_app_package, app_path, expected_output_desc, device_serial, verification_level(off/final/checkpoints/strict), explorer_mode(flash/pro/ultra) | 非阻塞返回 trace_id/stdout_log/stderr_log/notes_dir(Pro)；完成唤醒**仅在给了 conversation_id 时**；否则调用方必须自设 **1 分钟兜底轮询**；显式 serial 未接→拒绝（防跑错设备）；daemon 不可达时**禁止 standalone 兜底**防 runner 冲突；enqueue 无确认且队列不可查→返回 `unknown` 防重复提交（:361-414）；spawn 看门狗 60s 无日志即杀+标 failed+通知（:44-129） | 映射表 L113 一行 ⚠️；工具协议承诺**缺失** |
| `mobile_manage_task`（tools/task_manager.py:218-627） | action=status/stop/inject_instruction; trace_id; instruction; release_loop | status 返回 device_serial/test_summary(run_outcome.json 机读)/progress(Flash=turn+thought+action，Pro=task_plan)；**对账规则**：DB 终态>status.json；死亡判定需 pid 无 + 锁不可追踪 + 非宽限期(45s)；「不确定=存活」；`success`→completed 归一；stop 先 daemon 后取消票据再杀进程树；**inject_instruction 是运行中引导通道，release_loop 是连续监控任务的唯一优雅停止信号**（自然语言「停下」不被解释为停止） | 缺失 |
| `mobile_get_device_state`（tools/device_state.py:34） | view_type, device_serial | 设备状态/层级快照 | 缺失 |
| `mobile_inspect_trace`（tools/inspect_trace.py:53） | trace 检索 + 截图标注 overlay | — | 缺失 |
| `mobile_diagnose`（tools/diagnose.py） | 系统就绪诊断（探测聚合 + 凭据步骤 + 任务忙态） | — | 缺失 |

### 3.3 通知通道矩阵（mcp_server/notifiers/*；todo L151 只有一行 ⚠️）

触发入口（谁调 `notify`）：① 任务终态——`conversation_id` 存在 **或 ingress=mcp** 时由队列 worker 派发，payload `{trace_id, session_id, status, goal}`，event_type=终态（task_queue_service.py:943-962）；② 存活对账判死（task_manager.py:191-215）；③ spawn 看门狗判死（task_runner.py:112-128）。后两者 event_type=failed。

| 通道 | 可用条件（env） | 行为要点 |
|---|---|---|
| composite（默认聚合） | 任一子通道可用 | 顺序 File→AgentApi→Webhook→Script→Desktop（composite.py:27-34） |
| file | 恒可用 | 追加 `traces/<id>/notifications.jsonl`（file.py:54） |
| agentapi | `ANTIGRAVITY_LS_ADDRESS`+`ANTIGRAVITY_CSRF_TOKEN` | env 恢复三级：当前 env → 共享文件（`~/.gemini/jetski/.jetski_env`、`~/.artemis/.artemis_env`、父目录 `.jetski_env`）→ psutil 扫描其他进程环境（Linux 再扫 `/proc/*/environ`），命中即回写 env 与共享文件（agentapi.py:32-252） |
| webhook | `OPENCLAW_WEBHOOK_URL` / `MCP_NOTIFICATION_WEBHOOK` / `ARTEMIS_WEBHOOK_URL`（首个 http(s) 值） | POST JSON `{event, title, conversation_id, message, timestamp, payload}`，UA `Artemis-MCP/3.0`，5s 超时（webhook.py:81）——**这是外部网关的 payload 契约** |
| script | `ARTEMIS_NOTIFY_CMD` / `MCP_NOTIFY_COMMAND` | 命令模板占位符 `{title}{message}{conversation_id}{event_type}{trace_id}` 替换后执行（script.py:30-60） |
| desktop | `ARTEMIS_DESKTOP_NOTIFY` 真值；CI 环境默认关 | 系统通知（desktop.py:36-55） |

**处置建议**：DSH `jobs settled` 事件承接终态通知时，webhook payload schema 与「ingress=mcp 无 conversation_id 也通知」的触发矩阵是必须保留的外部承诺；agentapi 的 env 恢复属客户端黑科技，可随通道一并删除或原样移植（建议：迁移清单中列为「外部用户实际在用哪些通道」调研项）。

### 3.4 packages/artemis-client（Python SDK 公开面 —— P4 迁移清单基线）

- **入口** `artemis_client.__init__`：`ArtemisClient` + errors + models（`__all__`）。
- **ArtemisClient**（client.py:55-401）：`health()`→GET /api/status；`readiness()`→GET /api/system/readiness；`capabilities()`（见 §3.1 假端点）；`list_devices()`；`submit(goal, *, profile, device_serial, expected_output, enable_outputter, locked_app_package, app_path, conversation_id, task_id, verification_level, explorer_mode, options)`——**task_id 客户端生成 UUID、作为 legacy `session_id` 发送，复用即幂等重试**（:208-214），ingress 固定 `python_sdk`（:221），rejected/空 tasks→`TaskRejectedError`；`get_task(id)`——GET /api/sessions/{id}，404 则扫 /api/status 的 queue+active_tasks，仍无→合成 `status=launching`（:253-269）；`wait_for_task(timeout=1800, poll_interval)`；`run()`=submit+wait；`run_task(task_obj)`（鸭子类型 goal/profile/device_serial）；`stop(id)`→POST /api/stop，返回 `status=='stopped'`；`set_device`/`set_concurrency_mode`（后者仅留迁移兼容）。
- **models**（models.py）：`TaskHandle`（task_id/session_id 别名）、`TaskResult`（done=`TERMINAL_TASK_STATUSES`{completed,failed,cancelled}；succeeded=`SUCCESS_TASK_STATUSES`{completed,success}）、`Device`、`Capabilities`、常量 `TERMINAL_TASK_STATUSES`/`SUCCESS_TASK_STATUSES`/`VERIFICATION_LEVELS`/`EXPLORER_MODES`。
- **errors**（errors.py）：`ArtemisClientError` ← `NetworkError`/`ProtocolError`/`TaskRejectedError`/`TaskTimeoutError`/`ApiError`（← AuthenticationError/NotFoundError/ConflictError，带 status/body/detail）。
- **transport**（transport.py）：`JsonTransport`——同步 urllib、token header、30s 默认超时、HTTPError body 解析出 detail；client 经 `asyncio.to_thread` 包成 async（client.py:360-372）。
- **base_url 解析**：参数 > `ARTEMIS_BASE_URL` > `ARTEMIS_DAEMON_HOST:ARTEMIS_DAEMON_PORT`（默认 127.0.0.1:8000）（:90-94）。
- **测试基线**：`packages/artemis-client/tests/`（transport/client 单测）+ `tests/integration/test_thin_sdk_live.py`（opt-in，需 `ARTEMIS_TEST_DEVICE_SERIAL`）+ `tests/e2e/test_multi_port_end_to_end.py`（7 面：配置/daemon API/多设备/MCP 工具/SDK/CLI/锁隔离）。

**覆盖状态**：映射表 L195-196「DSH 官方 SDK 替代 ✅ 删除」已覆盖去留；**公开面清单与幂等重试承诺缺失**——P4 要求的「外部接入方迁移清单」没有可对照的输入。
**处置建议**：本节原样进 P4 迁移清单；「task_id 幂等」与 get_task 的 queue/active 兜底语义在 DSH SDK 中需验证等价物。

### 3.5 dev / 启动脚本 · 构建产物链

| 项 | 行为 | 证据 | todo 覆盖 |
|---|---|---|---|
| `scripts/dev.sh` | 后端 :8000（可 `BACKEND_PORT` 覆盖）+ Vite :5180（`FRONTEND_PORT`）；linked teardown（任一侧退出即全停，Ctrl+C 落在 wait -n）；后端已运行则复用（curl /api/status 探测，**复用路径不登记 LISTEN pid，teardown 不会杀它**）；后端启动 30s 超时 | dev.sh:22-133 | 缺失 |
| **msys/win32 PID quirk** | bash `$!` 是 msys PID 而 npm/vite/python 是原生 win32 进程，msys `ps` 看不见、plain kill 只杀 wrapper 留孤儿占端口；解法 = 起来后用 `netstat -ano` 记录真正 LISTEN 的 win32 pid，退出 `taskkill //PID //T //F`；POSIX 走 plain kill；`listen_pid` 恒返回成功防 `set -e` 误杀（grep 无监听者时非零） | dev.sh:38-71 注释 | 缺失（G6 只覆盖 Windows kill 验证，未记这个现成方案） |
| `make` 目标全集 | dev/start/ui/mock-ui/restart/stop/status/build-ui/release-ui/doctor/test/test-integration/test-device/test-all/install/install-deps/setup/lint/format/typecheck(pre-commit 走 pyright)/quality-ratchet/precommit-install/precommit/clean/help；`mock-ui`=`ARTEMIS_MOCK_DRIVER=1 … --no-open`；`release-ui`=build-ui+sync:resources | Makefile:16-137 | mock-ui/端口在 AGENTS.md；目标全集缺失 |
| quality_ratchet | 基线文件 `.quality-baseline.json`；三指标 `broad_exception_handlers`/`silent_broad_exception_handlers`/`type_ignore_comments` 按计数棘轮（超基线 fail，低于基线提示下调）；源根 artemis/mcp_server/apps.admin_console/third_party | scripts/quality_ratchet.py:19-24 | AGENTS.md 一句话；机制缺失——**过渡期 py 侧冻结时它防劣化，DSH TS 侧无对应物** |
| pre-commit | 3 个 local hook：ruff-check / ruff-format --check / quality-ratchet（全 `uv run` system language） | .pre-commit-config.yaml | 缺失 |
| vite.config.ts | `build.outDir: dist/browser`；dev proxy `/api`（**changeOrigin + proxyReq.removeHeader('origin')**，否则 SameOriginBoundaryMiddleware 403——SSE EventSource 同源请求也带 Origin，必须同规则）、`/images` `/videos` `/local_file` → 127.0.0.1:8000；vitest jsdom 配置 | vite.config.ts:18-54 | AGENTS.md 已载 Origin 规则；SSE 也受影响这点缺失 |
| 构建产物链 | `npm run build`(vue-tsc+vite) → `dist/browser/` → FastAPI `_get_showcase_dist()` 候选托管（SPA fallback）→ `npm run sync:resources`（**先清空后复制**到 `artemis/resources/showcase_ui/` wheel 回退目录，以 `index.html` 存在为准）→ **手动执行不挂进 build**（漏跑则 wheel 态 UI 陈旧）；`uv run artemis ui` 启动时源码有变自动重建 | sync-wheel-resources.mjs:1-30；server.py:245-247；Makefile:60-68 | AGENTS.md 已载两行；「先清空」「手动链易漏」缺失 |
| start.sh/start.bat | 终端用户启动器（PATH 补全/依赖检查/构建/`--open` 显式开浏览器）；服务端**永不自动开浏览器** | start.sh:15-40；AGENTS.md | 已覆盖（AGENTS.md） |
| pyproject | `[project.scripts] artemis = artemis.interfaces.cli.main:cli`（worker 子进程入口即此 CLI，S5 依赖） | pyproject.toml:90-91 | S5 已隐含 |

**处置建议**：DSH 侧开发流（P0「build + dsh plugin add（link 模式）」）重建时，dev.sh 的 linked-teardown + win32 PID 方案可直接参考或复用；quality_ratchet 在 py 冻结期继续生效，TS 侧建议对等物（lint 计数棘轮）或显式声明不做。

---

## 4. 漂移风险 Top 10（按风险降序）

1. **SSE 事件的前端消费语义与死信道清单**（§1.2）：合批/泳道/原位去重/`session_ended` 不提升排队轮——todo 只有一行「删除自建」；G5 契约测试没有这份对照表就无法断言 DSH `session/event` 等价。`recording_ready` 双形状（engine vs 队列兜底）是现成分叉。
2. **队列状态前端靠轮询不靠 SSE**：`queue_held/paused/resumed` 广播无人订阅，`/api/status` 的 `queue_paused/queue_holds` 才是信源。DSH 侧若只做事件推送、丢掉轮询等价字段，dock 的「继续队列」入口会失明（§1.2 末两行）。
3. **跨线程竞态五件套**（§2.4）：自动跟随准入、草稿豁免、fetchSessions 兜底优先当前线程、submitted_at 排序锚、stop 后幽灵清除——五个提交刚修完、测试全在即将删除的 Vue spec 里；DSH roster/toolview 聚合线程视图时**必然重遇**，丢了就是「会话消息被移除/消息误入他线程」类 bug 重演。
4. **4-step merge 的幽灵防护机制**（§2.1 step4 + dismissedNoRowSessions + 60s TTL）：「为什么四源合并会闪烁」的全部经验只存在于代码注释与 spec；todo 写了「问题本身消失」，但 pending+running+历史的聚合展示在 DSH 侧仍是新问题。
5. **/api/run 幂等 + 准入语义的对外承诺**：session_id 幂等重试、409 设备锁、400 端点校验、rejected 透传——SDK 重试与 webhookRuntime 接入都踩在这上面（草稿 01 已列后端规则、本文补消费方视角；两处合起来才是完整契约）。
6. **artemis-client 公开面 + capabilities 假基线**（§3.4/§3.1）：P4 要求迁移清单，但公开方法/payload/错误分层此前无成文处；`/api/v1/capabilities` 从未实现，features 集合是客户端编的。
7. **MCP 工具 docstring 协议承诺**（§3.2）：1 分钟兜底轮询、release_loop 唯一停止信号、unknown 防重复提交、对账「不确定=存活」——这些写给外部 LLM 调用方的行为承诺随工具面保留，删 mcp_server 前必须先确认 webhookRuntime 侧有等价语义。
8. **通知触发矩阵与 webhook payload schema**（§3.3）：`conversation_id 或 ingress=mcp` 才通知、失败双触发点、payload 字段——外部网关（OpenClaw/CI）的既有集成靠它。
9. **vite 代理 Origin 剥离覆盖 SSE + wheel 资源手动链**（§3.5）：双跑/共存期（G7）任何人改 dev 代理或漏跑 sync:resources，都是「页面能开但 SSE 403」「打包版是旧 UI」类无声故障。
10. **quality_ratchet 与 locale 锁测试的消亡**（§3.5/§2.5）：py 冻结期的防劣化棘轮与 en-US 键对齐测试都随删除消失；TS 侧无对等物时应在 todo 记一句「显式不做」，否则是静默的防线撤除。

---

## 5. 对 docs/todo.md 的修订建议

### 新增差距

- **G8 · SSE/事件契约对照基线**：本文 §1.2 表格作为 P0 契约测试（G5）与 G2 toolview 的输入；须包含：前端订阅面 vs 服务端广播面的差集（`queue_held/paused/resumed`、`note_saved`、`llm_stream_downgrade` 为死信道）、`recording_ready` 双形状收敛决策、llm_stream 合批/泳道语义是否需要复刻。
- **G9 · /api/run 准入语义在 webhookRuntime 的等价物**：session_id 幂等重试、409 设备锁定、400 端点校验、rejected 与 `unknown`（MCP 防重复提交）语义 → autogamer-queue admission 钩子的验收项（与草稿 01 §1.1 合读）。
- **G10 · 对外通知契约**：`notify` 触发矩阵（终态 + 两类判死；`conversation_id 或 ingress=mcp`）+ webhook payload schema → jobs `settled` 适配薄层的承诺清单；迁移前调研外部用户实际启用的通道。
- **G11 · 会话线程聚合视图的不变量**：submitted_at 排序锚、pending 不渲染/不提升、幽灵防护（TTL+dismissed）、自动跟随绝不跨线程、草稿豁免——DSH roster/toolview 聚合 Inbox+jobs+历史时的验收清单（§2.1/§2.4），作为 P3 的补充验收项。
- **G12 · 外部 SDK/MCP 基线**：artemis-client 公开面清单（§3.4）+ `/api/v1/capabilities` 假端点处置 + MCP 工具 docstring 承诺（§3.2）纳入 P4 迁移清单；DSH SDK 需验证 task_id 幂等与任务查询兜底等价物。

### 映射表修正

- 「`ipc_service` + `/api/stream` ✅ 删除自建」行补注：事件消费语义与死信道清单见 drafts/05 §1.2（仓库无 `artemis/ipc_service` 目录，实际在 `apps/admin_console/services/ipc_service.py`）。
- 「mcp_server 通知/外部接入 ⚠️ 薄层适配」行补注：触发矩阵与 payload schema 见 drafts/05 §3.3。
- 「packages/artemis-client ✅ 删除」行补注：公开 API 基线见 drafts/05 §3.4，作为 P4 输入。

### 新增 checklist 项

- [ ] P0 补：SSE 事件名全集快照测试（以 drafts/05 §1.2 为基线，防 DSH 侧事件模型漂移时无人察觉）。
- [ ] P3 补：队列 dock/roster 交互验收对照 drafts/05 §2.2（chips scoped、暂停/继续收敛、停止多态）。
- [ ] P4 补：SameOriginBoundaryMiddleware 与 Vite 代理 Origin 剥离在**过渡共存期**的行为说明（SSE 受影响）；`npm run sync:resources` 手动链在发布流程中的位置（漏跑 = wheel 态旧 UI）；dev.sh linked-teardown + win32 PID 方案作为 DSH 开发流参考。

### 附：最近 6 提交（46e59b2..cc6b20c）的测试锁定核对

| 提交 | 行为 | 锁定测试 |
|---|---|---|
| 46e59b2 | never-started 失败轮补插最小 DB 行（含 stdout 尾行）；排队消息纵向堆叠 | tests/unit/admin_console/test_task_queue_service.py（+161 行）；CommandDock.spec.ts |
| 552a63c | `/api/status` 路由误接 pause handler 修复 + 路由注册守卫 | test_task_queue_service.py:1769 `test_queue_router_registers_expected_routes` |
| 138695c | dock 队列控件 scoped 到线程、去状态文案 | CommandDock.spec.ts:242-275 |
| 3a1facc | 排队轮不进时间线、发射后按原轮序入列 | AgentTimeline.spec.ts:639-679 |
| 8a0108c | 自动跟随绝不跨线程 + fetchSessions 兜底优先当前线程 | session.spec.ts:361-487；stream.spec.ts:350-406 |
| 9739f32 | session_ended 不把排队轮提升为运行态 | stream.spec.ts:461-489 |

六条均有测试锁定，但**全部位于随迁移删除的仓库区**（Vue spec + py 队列单测）；py 队列单测由 conformance 测试接棒（草稿 01 附表），**五条前端行为断言没有既定接棒者**——这是 §5 G11 的直接依据。
