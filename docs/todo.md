# TODO

> 通用 TODO 活文档，不针对单一任务。已完成条目直接删除（遵循 docs「不留旧档」规则）；演进依据查 git 历史。

## 决策记录（持续追加）

### 2026-10-09 · 队列派发重构与 DSH 引入路线

背景：`admin_console` 全局 FIFO 队列 + 设备级熔断导致新会话消息被其他会话积压、状态跨会话污染（前端侧已修：9739f32 等 5 个提交）。经四轮调研（自建盘点 → py/ts 库对比 → DSH 官方文档核实 → 主流产品语义对标）后拍板：

| # | 决策点 | 结论 | 依据 |
|---|---|---|---|
| D1 | 战略路线 | **中期迁 DSH（DeepSeek Harness）；队列按 TS 插件设计，py 侧仅最小修补** | DSH 官方能力核实：通用 agent 宿主（Cordis 插件内核）+ jobs/webhook/scheduling/SDK 原语齐全；旧 DSH 线设备插件已实证可行；py 线队列痛点不被 DSH 直接解决但整体架构收益大 |
| D2 | 队列底座 | **不自建队列库、不引 Redis**：会话队列容器由 DSH Agent Inbox 原生承担（durable pending 列表，重启可恢复）；设备锁为 DSH 宿主进程内闸门（p-queue 或手写 promise 链，单机够用）；Redis/GroupMQ/BullMQ 降级为远期多进程/多机扩展项，一期不引入 | DSH jobs owner-fenced + Agent Inbox durable projection（官方 core/jobs 子系统文档）；DSH 单宿主进程内无跨进程竞争，分布式队列属过度设计 |
| D3 | 队列语义 | a. 每 conversation_id 独立 FIFO、会话间并行——**由 DSH Agent Inbox 原生实现**（不自建队列容器）；b. 同设备多会话先到先得拿设备锁，其余在工具层排队等待（自建，进程内）；c. **熔断为资源维度：挂设备 + 冷却窗后半开单探测自动恢复**（自建——DSH 无熔断原语） | DSH Inbox 每会话 durable pending 列表（core 子系统文档）；LiteLLM `allowed_fails`/`cooldown_time` 半开单探测是资源熔断标准语义 |
| D4 | 单会话积压策略 | 无上限全部排队——**Inbox 原生无界，零自建**（有界化远期用 inbox.splice 上层实现） | DSH Inbox 无 maxLength，append/splice 仅为管理操作（官方文档） |
| D5 | 重启恢复语义 | **排队消息原生自动恢复**（Inbox 是 durable projection，重启后 pending 原生续派——零自建）；**运行中任务死亡 → 标记 failed 不重新入队**（设备任务是有状态长交互，重入会重复操作设备，BullMQ stalled 重入语义不适用）；启动时对账孤儿 py worker | DSH 官方：Inbox durable projection + `resume()` 加载持久会话；`jobs-local` 进程内存储不持久；设备任务重入不安全是领域约束 |
| D6 | DSH 版本管控 | **peerDependencies range 声明兼容窗**（DSH runtime 拒载旧版，dsh-data-agent 实证）+ conformance 契约测试守升级；`upgrade:dsh` pin 门禁**降级为可选**（仅 repo 级复现 runtime 时需要） | 社区无 workspace-host 先例：插件均以 peer range 对 dsh 声明兼容；Harness Ultimate 用 commit-SHA pin 是 profile 安装器场景 |
| D7 | 引入形态 | **社区主流 out-of-tree 插件模式**：DSH 为独立 runtime（`npm i -g @deepseek-ai/dsh` / npx），自建插件为独立包（自带 `cordis.patch.yml` 声明 `dsh.bundle.patch`），经 `dsh plugin --profile web add` 安装（支持 npm/git:`github:owner/repo#ref`/file:/link:）；`--dump-config` 验证生效 layer；**不自建宿主、零源码 fork** | 社区实证：dsh-data-agent（plugin add + dsh-market + Settings→Plugins 面板）、harness-relay（pnpm pack + `plugin add .`）、awesome-deepseek-harness（1.1k stars，安装约定即此）；`dsh plugin` 转发 pnpm |
| D8 | 技术栈约束 | **TS 优先**：能 TS 实现的一律 TS（插件/闸门/熔断/孤儿对账/媒体路由/toolview 渲染）；py 仅保留强依赖 py 成熟生态的例外——Android 驱动（uiautomator2/adbutils）、录屏栈（opencv/imageio-ffmpeg）、langgraph worker 本体（一期黑盒保留，二期随模式 a 退役）；**py 侧一期零新增代码** | 用户约束（2026-10-09）：方便开发、收敛单语言维护面；Windows UIA 走 koffi 已是 TS；Android UI 自动化无 uiautomator2 等价 TS 库，故留 py |

自建盘点结论（为什么换）：`task_queue_service` 1880 行 + `device_lock` 946 行全部自建；通用状态机层（持久化/FIFO/重试/stalled 检测）是 bug 高发区（PID 复用、全局 FIFO 竞态、session_ended 误提升均有前科）。核实后：会话独立/积压/排队消息恢复均为 DSH 原生能力，无需队列库；自建只剩真正的差异化——设备资源调度语义（锁 + 熔断 + worker 监管）。

### DSH 原生能力对照（防重复自建，依据官方 core/jobs 子系统文档）

| 关注点 | DSH 原生实现 | 结论 |
|---|---|---|
| 会话独立 | jobs **owner-fenced**：job 属于发起它的 agent session，互相不可见；`list/get/read/kill/wait` 均按调用方 SessionId 围栏。Agent **Inbox**：每 agent 两条有序 pending 列表（nextTurn/nextStep），按 agent 隔离 | ✅ 原生——每会话一个 agent，Inbox 即会话队列，**不自建队列容器** |
| 熔断 | `JobStatus` 仅 running/stopping/completed/killed/failed；无失败计数/冷却/半开；工具管线仅 approval 守卫，无资源维度熔断 | ❌ 无——**自建**（设备维度，autogamer-queue 内，量级百行） |
| 积压 | Inbox 无上限、无 maxLength；append/prepend/replace/remove/splice 均为管理操作 | ✅ 原生——**零自建** |
| 重启恢复 | Inbox 是 durable projection（`resume()` 重放 pending）；`jobs-local` 进程内存储不持久 | ⚠️ 一半——排队消息原生恢复；运行中任务死亡即 failed（领域语义：设备任务不重入），启动时对账孤儿 worker |

## 主题一 · 队列派发重构与 DSH 引入

### 方案骨架（浅迁移主线）

- **DSH runtime**：官方独立安装（`npm i -g @deepseek-ai/dsh` 或 npx），`web` profile 起步（官方 UI + 轨迹回放）；**不自建宿主 workspace**——自建能力以 out-of-tree 插件包交付（社区主流，见 D7）
- **队列插件 `autogamer-queue`**：**不自建会话队列容器**（DSH Inbox 原生）、**不自建子进程监管层**（py worker 注册为 DSH job——DSH 自带 `bash` job kind + subprocess `readFrom` pull source，output ring/`JobRegistry.kill`/退出码→`JobOutcome.detail`/settled 完成通知全原生）；职责收缩为——设备锁闸门（先到先得，进程内）+ 设备维度熔断（冷却窗半开单探测）+ 启动时孤儿 worker 对账（`jobs-local` 不持久，死亡任务标 failed）
- **设备插件 `autogamer-device`**：device_list/use/screenshot/uia/desktop 工具重写（koffi 绑 UIA；注意 `koffi.decode 'string16'` 崩溃陷阱改手动 utf16le；隐藏桌面键盘免前台不可达等边界经验见项目记忆）
- **py 侧零新增**（D8）：artemis CLI 原样作为 worker 子进程入口；FastAPI 控制台过渡期只读共存；原 py 计划项（孤儿对账/媒体路由）全部移入 TS 插件
- **契约测试**：锁定依赖的 DSH 行为（turn/step 事件、插件注册 API、session JSONL 格式、approval 语义），接入升级门禁

### 对接语义（py worker ⇆ DSH 宿主契约，S1–S8）

**S1 会话映射**
- ARTEMIS `conversation_id` ≡ DSH `SessionId`（1:1；`ctx.agents.create()` 显式传入）；一个会话 = 一个 agent，多轮 = 同 agent 多 turn
- 用户消息 = `agent.followup(msg)` 进 Inbox——原生会话 FIFO + durable，即「按会话独立队列」本体
- ⚠️ 验证点（P0 spike）：create() 是否接受外部指定 SessionId；若不接受，则以 DSH SessionId 为准、conversation_id 存 session meta

**S2 任务 = Job**
- 一个设备任务 = 一个 job：初版直接用自带 `bash` kind 跑 artemis CLI，稳定后换自定义 kind `autogamer-task`（label = goal[:120]）
- `JobSpec.owner = SessionId`（会话围栏原生：其他会话不可见/不可杀）；`output` = worker stdout pull source
- 生命周期映射：退出码 0 → `completed`；非 0 → `failed`（`detail` = stdout 错误尾行）；`kill` → `killed`（reason 透传）；settled 事件 → 会话内完成通知（免轮询）
- 按会话停止全部任务：`workspace/session-stop`（archive admission）原生杀该 session 名下全部 job——对应旧 `/api/stop` by session

**S3 设备锁闸门（自建，进程内）**
- 闸门 = 插件内 `Map<lockKey, Promise 链>`；lockKey 沿用 ARTEMIS 语义（endpoint + serial）；serial 未定（auto）时由 worker 首次枚举回填
- 时序：job `run()` **同步**返回 hooks（契约要求）→ 内部异步流 `await gate.acquire(lockKey, signal)`（`updateProgress("queued: waiting for device X")` 让排队可见；kill 的 cancel 中断等待）→ spawn worker → settle 后 `finally` 释放
- 先到先得 = Promise 链 FIFO；同设备多 job 天然串行

**S4 熔断状态机（设备维度，自建）**
- `closed` →（连续环境级失败 ≥ allowed_fails）→ `open`：该 lockKey 的新任务不 acquire（进度行 `device cooling down`），Inbox 消息原地等待 →（cooldown_time 到期）→ `half-open` 放行单探测 → 探测成功 → `closed` 清零；失败 → `open` 重置冷却
- 环境级判定沿用现有分类：零步骤失败 OR `ENVIRONMENT_ERROR_MARKERS` 命中
- 恢复全自动（半开单探测），无需人工/新提交解锁——替代旧「挂起 + 5s 设备探测 + 新提交解除」

**S5 worker 契约（py 侧零新增，D8）**
- 入口：`artemis` CLI 不变；env 沿用现有契约（`ARTEMIS_CONVERSATION_ID`/`ARTEMIS_SESSION_ID`/goal/profile/model_endpoint）
- 输出：stdout → job output ring（stdout/stderr 模型可读；进度/心跳标 `log` channel 仅观察者可见）；录像文件走 `spillPath` 交接（ring 仅 UTF-8，二进制不入环）
- 终态留痕：DB/trace 仍由 DataEngine 写入（job outcome 只作 UI/通知层，不承载持久化）
- 孤儿对账由 autogamer-queue（TS）承担：插件启动时扫孤儿 worker 进程 → 标 failed——**py 侧一期零新增代码**

**S6 审批映射（HITL）**
- 敏感分级 → DSH approval policy：常规设备操作 `never`；破坏性操作（卸载/清数据/支付类）`ask` + `allowed-once`；fail-closed
- headless/自动化 profile 全 `never`（自动拒绝，等价旧 guardrail 语义）

**S7 重启对账**
- Inbox pending：原生恢复续派（durable projection，零自建）
- 运行中 job：进程死即失联 → 启动对账（进程存活但无 registry 记录 → kill + 标 failed `orphaned by restart`）；**不重入**（设备任务不重试，D5 语义）
- 远期多机：官方明示 durable backend 需自行实现 JobRegistry 契约（与 D2「Redis 降级远期」呼应，一期不做）

**S8 版本门禁**：见下文「DSH 版本管控附录」（pin/门禁/契约测试即对接语义的防回归部分）

### 落地差距核查（G1–G7，按此方案实际落地还须调整）

| # | 差距 | 调整 |
|---|---|---|
| G1 | **Agent 驱动模式未决（最关键）**：S2（bash job 黑盒跑 py worker）与 P2（device_* 重写为 DSH 插件工具）隐含矛盾——黑盒模式下 DSH agent 不需要设备工具，P2 重写了也没有调用方；反之 agent 驱动模式意味着 ARTEMIS langgraph 执行逻辑整体废弃重写 | **分期拆解**：一期 = 模式 b（黑盒 worker，DSH 只做宿主/Inbox 队列/闸门/熔断/UI），P2 整体移出一期范围；二期 = 模式 a（agent 驱动设备工具，ARTEMIS 执行逻辑渐进搬入 DSH agent+skills），启动条件 = 一期双跑稳定后评估 |
| G2 | **UI 步骤时间线降级**：旧控制台有结构化 thinking/toolcall 卡片；一期 py worker 输出在 DSH 侧只是 job 文本流 | 一期明确接受输出环展示；可选小件：py worker 打 JSONL 结构化事件 + DSH 侧自定义 toolview 渲染（dsh-data-agent 已实证 toolview 注册可行，量级百行） |
| G3 | **auto-serial 闸门缺口**：未指定设备的任务在 acquire 时没有 lockKey，「先到先得」退化 | 闸门升级为小调度器：显式 serial → per-device 队列；auto → 空闲设备池 + 全局 auto 队列（仍百行级） |
| G4 | half-open「单探测」探测体未定义 | 探测 = Inbox 队头**真实消息**（不合成探测任务，符合 LiteLLM 半开语义）；环境级判定一期实现 = exit code + 错误特征扫描（沿用 ENVIRONMENT_ERROR_MARKERS） |
| G5 | conformance 测试需要真实 DSH runtime | CI 基建：npx 起 DSH（web/headless + jobs-local）跑契约测试——P0 纳入，工作量勿低估 |
| G6 | Windows 落地细节 | S2 spike 增加 Windows 子进程树 kill 验证；插件工具需验证**绕过 Docker sandbox 本机直执**的 provider 配置（DSH sandbox seam） |
| G7 | 过渡与迁移边界未划 | 旧 DB 历史**不迁移**（旧控制台只读共存）；双跑 = 灰度开关（新提交全走 DSH）；外部接入方（artemis-client/MCP 用户）改走 webhookRuntime/SDK——迁移清单纳入 P4 |

### 全模块映射：DSH 原生 vs 保留自建（防重复建设清单）

| ARTEMIS 模块 | 职责 | DSH 原生对应 | 结论 |
|---|---|---|---|
| `data_engine` + repositories + SQLite | 会话/步骤持久化 | session log（append-only JSONL、generation 迁移链、resume/fork/replay） | ✅ 删除自建 |
| showcase_ui_v2 会话/轮次/工具展示 + 前端 4-step merge | 控制台 UI | DSH Web UI + 轨迹回放 + `session/event` 流（单一事实源，无四源合并） | ✅ 删除自建 |
| 队列/任务状态展示 | 队列可视化 | jobs 浏览器 roster（`job.list`/`job.follow` Remote streams）+ toolview 槽 | ✅ 原生 |
| `ipc_service` + `/api/stream` SSE | 事件广播 | `session/event` + `agent/assistant-stream` 原生事件 | ✅ 删除自建 |
| `/api/run` 外部提交 | 编程接入 | webhookRuntime（认证投递 + 建 Session）/ SDK / ACP | ✅ 原生 |
| `/api/status` 四源合并 | 状态查询 | session log 单一事实源（问题本身消失） | ✅ 删除 |
| `/api/stop`、queue pause/resume | 停止/暂停 | `agent.cancel(cause, {keepInbox})` + `JobRegistry.kill` + inbox splice | ✅ 原生 |
| `model_service`（endpoint 库/固定端点/profile 反推） | 模型路由 | LLM seam + per-agent `AgentOptions(provider/model/reasoningEffort/maxTokens)` + profiles | ✅ 原生（旧线 [vlm] 路由已验证） |
| `worker_process_io` | 子进程输出转发 | jobs output ring + `JobOutputSource`（registry 定档泵取 + spill 完整流文件） | ✅ 删除自建 |
| `state.py`（active_runs/submission_meta/startup_progress） | 运行态登记 | owner 围栏 + session log 原生 + jobs progress | ✅ 大部分删除 |
| runtime daemon/server lifecycle | 进程托管 | DSH launcher/profiles（web/headless/desktop） | ✅ 大部分删除 |
| `device_lock.py` 946 行 | 设备互斥 | 跨进程场景消失（单宿主进程） | 🔧 收缩为进程内闸门 + 熔断（百行） |
| task_queue_service 的 spawn/kill/输出转发（execa 监管层） | 长时子进程监管 | DSH 自带 `bash` job kind + subprocess `readFrom` pull source：output ring、`JobRegistry.kill`、退出码→`JobOutcome.detail`、settled 完成通知 | ✅ 原生——py worker 注册为 job，不自建监管层 |
| HITL 审批 | 安全审批 | DSH approval policy（ask/never + allowed-once，fail-closed） | ✅ 原生（旧线已验证） |
| `mcp_server` 通知/外部接入 | MCP 集成 | webhookRuntime + jobs `settled` 事件通知 | ⚠️ 大部分原生，留适配薄层 |
| `packages/artemis-client` | SDK | DSH 官方 SDK（TS + Python） | ✅ 删除自建 |
| `task_preset_catalog` 483 行 | 任务预设/推荐 | DSH skills/命令承载 | 🔧 转化为 skills（非自建服务） |
| `drivers/`（ADB/uiautomator2/mock） | 设备执行 | 无原生对应 | 🔧 保留——重写为 autogamer-device（差异化核心） |
| `media_service` 568 行（录屏/孤儿恢复/图片服务） | 媒体管线 | output ring 仅 UTF-8 文本（二进制 mp4 不适配）；`JobOutputSource.spillPath` 可作完整流文件交接点；mp4 托管/HTTP 服务无原生 | 🔧 拆分：录屏栈留 py（D8 例外）；托管/路由转 autogamer-media TS 插件（`ctx.connection.fetch`，dsh-data-agent 已实证） |

**Grep 真实清点补全（artemis/ 150+ 文件，此前映射遗漏 ~8000 行智能栈）**：

**A. artemis/agents/* + graph/*（智能栈，一期黑盒保留 / 二期重写）**
| py 模块 | 职责 | DSH 承接物 | 结论 |
|---|---|---|---|
| planner/operator/checker/validator/explorer/diagnoser/flash/video_analyzer（~40 文件） | 多 agent 执行智能（规划/操作/校验/探索/诊断/视频分析） | DSH agent loop + subagent providers + skills：operator→设备操作 agent；checker/validator→LLM seam 结构化校验；explorer→探索 skills；video_analyzer→多模态 LLM | 二期重写（模式 a）；一期黑盒保留 py |
| graph/（langgraph 编排 + checkpoints） | 流程编排/断点续跑 | DSH agent loop 原生 + session log checkpoint 语义 | 二期替换 |
| llm/（router/reliability/structured/google）+ services/llm.py 977 | LLM 路由/重试/结构化输出 | DSH LLM seam + provider adapters + per-agent `AgentOptions` | 一期保留；二期原生 |
| memory/（chunking/context_policy/step_memory/transcript） | 上下文管理 | DSH session log 投影 + context 管理（KV cache/compact 原生） | 二期大部分原生；chunking 策略专项评估 |

**B. artemis/tools/*（worker 内 agent 工具 ~25 文件）**
| 通用工具（command_tool/scratchpad/wait_tool/log_tool 等） | 通用执行/暂存 | DSH 原生 bash + scratchpad + skills | 二期原生承接，**不自建** |
| 设备工具（mobile/：launch_app/ocr/read_hierarchy/read_logs/search_logs） | 设备感知/操作 | autogamer-device 工具 | 二期 TS 重写 |
| 高级工具（explorer_tool/committee_tool/diagnostic_tool/history/*） | 探索/委员会/诊断/历史 | DSH skills + autogamer-device 部分 | 二期拆分映射 |

**C. artemis/runtime/* 补全（此前表已列 5 项，补 4 项）**
| helper_manager.py 931 | 设备辅助栈安装管理 | autogamer-device 内 | 二期 TS |
| awake_service + awake_lease | 屏幕常亮 | autogamer-device 内 | 二期 TS |
| cancel_requests（取消标记文件） | 跨进程取消 | `JobRegistry.kill` / `agent.cancel` 原生 | ✅ 删除 |
| trace_store（status.json/trace 目录/原子写） | 外部状态文件 | session log 原生 | ✅ 删除 |

**D. artemis/mcp/* + controllers/ + clients/（worker 内执行层 ~3000 行）**
| mcp/action_server/executor/session + adb_server + actuators | 进程内动作执行服务 | autogamer-device 工具执行管线 | 一期保留（worker 内），二期替代 |
| controllers/unified_controller + clients/accessibility + screen_client | 设备控制抽象 | autogamer-device | 二期 TS |

**E. artemis/core/diagnostics/*（probes/engine/device_smoke/emulator_manager/adb_keys ~3000 行）**
| 就绪诊断/模拟器管理 | 提交前就绪检查 | 一期保留 py doctor（worker 内）；二期部分转 autogamer-queue admission 探测 | 一期保留 |

**F. artemis/config/ + services/token_meter + telemetry/ + toolchain/**
| config/（agent.py 993/endpoint_library/llm） | 配置/端点库 | DSH profiles + provider adapters | ✅ 删除 |
| telemetry + toolchain + token_meter | 遥测/工具链解析 | DSH telemetry 原生 + worker 内小件保留 | 大部分删除 |

**G. mcp_server/notifiers/*（webhook/script/file/desktop/composite/agentapi 7 通道）** | 任务完成通知 | jobs `settled` 事件 + DSH 通知插件 | ⚠️ 薄层适配

**剩余自建清单（全部 TS，D8）**：① autogamer-device（设备工具 TS 重写，差异化核心）；② autogamer-queue（设备锁闸门 + 熔断 + 孤儿对账，百行级；worker 监管由 DSH job 原生承接，不自建 execa 层）；③ autogamer-media（TS 插件路由：录屏经 spillPath 交接，`ctx.connection.fetch` 挂图片/静态路由——dsh-data-agent 已实证此模式）；④ 任务预设转 skills；⑤ mock driver 转 TS 插件。**py 保留例外**：uiautomator2/adbutils 设备驱动、录屏栈、langgraph worker 本体（一期黑盒保留，二期随模式 a 退役）。其余约 5000+ 行服务层 + 整个 Vue 控制台 + data_engine + SDK/MCP 均由 DSH 原生能力承接。

### 全模块映射·续：核心包与外围逐模块对照（真实清点补全，防自建盲区）

> 清点方法：Grep 真实枚举（artemis/ 命中 150 py 文件）+ 本会话已核实文件；此前 Shell/Glob 枚举因环境返回污染已弃用。一期（模式 b）原则：以下内容凡未标注「一期删除」的，一律原样留在 py worker 内黑盒运行，二期（模式 a）才逐个处置。

**artemis/agents/*（多 agent 执行智能，~45 文件：planner/operator/checker/validator/explorer/diagnoser/flash/outputter/summarizer/log_analyzer/image_processor/object_detector/history_analyzer/video_analyzer）**
- 一期保留（D8 例外：langgraph/langchain/opencv 强依赖）；二期对应物：多 agent 流水线 → DSH agent loop + subagent providers + skills；结构化校验 → LLM seam structured output。**逐 agent 渐进搬迁，非一次性重写**

**artemis/graph/*（langgraph 编排：checkpoints/graph/perception/state/visibility）**
- 一期保留；二期 → DSH agent loop 原生替代，checkpoint 语义由 session log 承接

**artemis/llm/* + services/llm.py（977：router/reliability/structured/google provider）**
- 一期保留；二期 → DSH LLM seam + provider adapters 原生（与 model_service 同源，D3 已核）

**artemis/memory/*（chunking 1624/transcript 693/step_memory/context_policy）**
- 一期保留；二期 → DSH session log 投影 + context 管理承接大头，chunking 策略专项评估后定去留

**artemis/tools/*（工具套件：command_tool 1063/scratchpad 693/mobile 套件/history 套件/video_tool/committee 等）**
- 一期保留；二期：设备类（mobile/*、adb_shell）进 autogamer-device；通用类（bash/scratchpad/wait）→ DSH 原生 tools/skills 承接

**artemis/utils/*（CV/OCR/坐标/UI 过滤 ~4500 行：coordinates 531/ui_filter 552/task_tree 1015/video 613/visualization 692/plan_grammar 417 等）**
- D8 例外整区保留（opencv/scipy 强依赖），被 agents/tools 调用，不随迁移删除

**artemis/mcp/*（进程内动作服务：action_server/action_executor 677/action_specs 774/adb_server/actuators）**
- 一期保留（worker 内部执行层）；二期 → autogamer-device 工具执行管线承接

**artemis/core/diagnostics/*（就绪探测/engine/device_smoke/emulator_manager/adb_keys ~2400 行）**
- 提交前置检查 → autogamer-queue admission 钩子（TS 轻量版）或保留 py doctor CLI 调用；emulator_manager 留设备侧

**artemis/clients/* + controllers/*（accessibility/screen client、unified_controller 581）**
- 二期进 autogamer-device（TS 重写或 CLI 间接调用）；一期保留

**artemis/runtime/helper_manager.py（931：accessibility helper 安装管理）**
- 二期进 autogamer-device；一期保留

**apps/admin_console/replay_manager.py（2276）+ routers/replay.py + routers/system.py（1071）**
- 回放 → DSH trajectory replay（session log fork/replay）原生承接大头；录屏产物经 spillPath → ✅ 一期后删除

**apps/admin_console/routers/sessions|steps|media.py + core/security.py（146）+ services/device_stream_service.py（120）**
- 查询 API → session log 原生查询；鉴权 → DSH 认证原生；设备流 → toolview/output ring 承载 → ✅ 删除/收缩

**packages/artemis-client/（注意：实为 Python client——transport/models/errors，非 TS）**
- DSH 官方 SDK（TS + Python）替代 → ✅ 删除；外部调用方迁移清单纳入 P4（G7）

**tests/**（unit/admin_console + data_engine）
- 随被删模块同步删除；conformance 契约测试替代（G5：CI 起真实 DSH runtime）

### Checklist

- [ ] P0 骨架：插件包骨架（`autogamer-queue`/`autogamer-device` 独立包，自带 `cordis.patch.yml` 声明 `dsh.bundle.patch`）+ peerDependencies range 声明 + `dsh plugin --profile web add` 安装流 + `--dump-config` 验证 layer + conformance 测试骨架 + **S1 spike（外部 SessionId 指定性）** + **S2 spike（bash job 跑 artemis CLI：输出环/kill/退出码/完成通知）**；开发流 = build + `dsh plugin add .`（link 模式；无热重载，改码需重启 profile 进程）
- [ ] P1 队列插件：设备锁闸门 + 设备维度熔断（半开恢复）+ 孤儿对账；**先 spike 验证 DSH bash job 承载 artemis CLI worker**（输出环/kill/退出码/完成通知/session-stop 联动）；验证 Inbox 原生会话队列覆盖原需求（不引 GroupMQ/BullMQ/Redis）
- [ ] P2 设备插件（**二期·模式 a，一期不做**——见 G1）：device_* 工具重写（ADB/uiautomator2 → TS；UIA koffi；隐藏桌面）+ ARTEMIS 执行逻辑搬入 DSH agent+skills
- [ ] P3 UI 接入：web profile + 队列状态展示（toolview 槽）+ 审批策略映射（HITL：敏感操作 ask/never + allowed-once）
- [ ] P4 过渡：py worker **零改动**接入（env 契约不变，D8）+ 双跑灰度验证（G7）+ 旧控制台（showcase_ui_v2/admin_console）只读共存与下线决策

### DSH 版本管控附录

> 2026-10-09 社区调研后降级为**可选**：插件模式下 DSH runtime 非本 repo 依赖，主防线 = peerDependencies range + conformance 契约测试。仅当未来 repo 级复现 runtime（远期多机 durable backend）时恢复本门禁。

```text
pnpm upgrade:dsh          # 全量门禁，任一环节失败即中断
  1. pin 回写（全部 @deepseek-ai/dsh-* 子包同步到同一精确版本）
  2. install（失败自动回滚 pin）
  3. supply-chain 排除清单重生成（minimumReleaseAgeExclude，保持 LF）
  4. build
  5. conformance 契约测试（锁事件/插件 API/session 格式）
  6. dump-config 冒烟（对比插件生效树）
pnpm upgrade:dsh:check    # 只读检测新版差量，有更新 exit 1（固定周期跑，不追 next）
```

## 跟踪项

- （空——后续主题追加于此）
