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

自建盘点结论（为什么换）：`task_queue_service` 2027 行 + `device_lock` 1028 行全部自建；通用状态机层（持久化/FIFO/重试/stalled 检测）是 bug 高发区（PID 复用、全局 FIFO 竞态、session_ended 误提升均有前科）。核实后：会话独立/积压/排队消息恢复均为 DSH 原生能力，无需队列库；自建只剩真正的差异化——设备资源调度语义（锁 + 熔断 + worker 监管）。

### DSH 原生能力对照（防重复自建，依据官方 core/jobs 子系统文档）

| 关注点 | DSH 原生实现 | 结论 |
|---|---|---|
| 会话独立 | jobs **owner-fenced**：job 属于发起它的 agent session，互相不可见；`list/get/read/kill/wait` 均按调用方 SessionId 围栏。Agent **Inbox**：每 agent 两条有序 pending 列表（nextTurn/nextStep），按 agent 隔离 | ✅ 原生——每会话一个 agent，Inbox 即会话队列，**不自建队列容器** |
| 熔断 | `JobStatus` 仅 running/stopping/completed/killed/failed；无失败计数/冷却/半开；工具管线仅 approval 守卫，无资源维度熔断 | ❌ 无——**自建**（设备维度，autogamer-queue 内，量级百行） |
| 积压 | Inbox 无上限、无 maxLength；append/prepend/replace/remove/splice 均为管理操作 | ✅ 原生——**零自建** |
| 重启恢复 | Inbox 是 durable projection（`resume()` 重放 pending）；`jobs-local` 进程内存储不持久 | ⚠️ 一半——排队消息原生恢复；运行中任务死亡即 failed（领域语义：设备任务不重入），启动时对账孤儿 worker |

## 主题一 · 队列派发重构与 DSH 引入

> **迁移前全量盘点（2026-10-09，五路并行审计）**：[docs/migration/feature-inventory.md](migration/feature-inventory.md) + `inventory/01–05`——本主题所有 G/S 条目的证据（file:line）与契约细节以盘点为准；S2/S5 已按审计修正、新增 S9，六条硬矛盾的消化记录见盘点「硬矛盾」节。

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
- 生命周期映射（G8/G10 审计修正）：**py 退出码不编码任务结果**（blocked/flash-failed 也退 0；协作取消退 130）——**终态以 DataEngine DB 行为权威**（success→completed 归一），退出码仅兜底；`kill` 必须先写 cancel marker、宽限（默认 45s）后再硬杀（Windows 下 worker 收不到信号，G10）；`exit 130` → cancelled；`detail` = stdout 末行（末 4096B 取最后非空行、截 300 字符）；settled 事件 → 会话内完成通知（免轮询）
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
- 入口：`artemis` CLI 不变；env **全集**见盘点 inventory/02 §2.1（G9）——必设 `ARTEMIS_TASK_WORKER=1`（缺失时 `artemis run` 反向自提交旧 daemon）；`ARTEMIS_CONVERSATION_ID`/`ARTEMIS_SESSION_ID`/`ARTEMIS_SUBMITTED_AT`（轮次排序锚）/`ARTEMIS_TASK_INGRESS`/`ARTEMIS_DEVICE_QUEUE_TICKET`/`ARTEMIS_ADB_ENDPOINT_ID`/`ARTEMIS_IPC_PORT` + driver 组（`ADB_*`/`ARTEMIS_MOCK_DRIVER`/`ARTEMIS_HIERARCHY_BACKEND` 等）+ 凭证组；stderr→stdout 合并、Windows `CREATE_NO_WINDOW`
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

**S9 任务中途指导注入（盘点新增，G29，需 spike）**
- `<trace_dir>/injected_instruction.json` `{instruction, release_loop}` 读后即删——运行中唯一指导注入通道；`release_loop` 是 `[Loop:continuous]` 里程碑唯一合法结束信号（自然语言「停下」不触发停止）
- DSH 侧对应物（followup + control 标志？）待 spike

### 落地差距核查（G1–G29，按此方案实际落地还须调整；G8+ 来自 2026-10-09 盘点审计）

| # | 差距 | 调整 |
|---|---|---|
| G1 | **Agent 驱动模式未决（最关键）**：S2（bash job 黑盒跑 py worker）与 P2（device_* 重写为 DSH 插件工具）隐含矛盾——黑盒模式下 DSH agent 不需要设备工具，P2 重写了也没有调用方；反之 agent 驱动模式意味着 ARTEMIS langgraph 执行逻辑整体废弃重写 | **分期拆解**：一期 = 模式 b（黑盒 worker，DSH 只做宿主/Inbox 队列/闸门/熔断/UI），P2 整体移出一期范围；二期 = 模式 a（agent 驱动设备工具，ARTEMIS 执行逻辑渐进搬入 DSH agent+skills），启动条件 = 一期双跑稳定后评估 |
| G2 | **UI 步骤时间线降级**：旧控制台有结构化 thinking/toolcall 卡片；一期 py worker 输出在 DSH 侧只是 job 文本流 | 一期明确接受输出环展示；可选小件：py worker 打 JSONL 结构化事件 + DSH 侧自定义 toolview 渲染（dsh-data-agent 已实证 toolview 注册可行，量级百行） |
| G3 | **auto-serial 闸门缺口**：未指定设备的任务在 acquire 时没有 lockKey，「先到先得」退化 | 闸门升级为小调度器：显式 serial → per-device 队列；auto → 空闲设备池 + 全局 auto 队列（仍百行级） |
| G4 | half-open「单探测」探测体未定义 | 探测 = Inbox 队头**真实消息**（不合成探测任务，符合 LiteLLM 半开语义）；环境级判定一期实现 = exit code + 错误特征扫描（沿用 ENVIRONMENT_ERROR_MARKERS） |
| G5 | conformance 测试需要真实 DSH runtime | CI 基建：npx 起 DSH（web/headless + jobs-local）跑契约测试——P0 纳入，工作量勿低估 |
| G6 | Windows 落地细节 | S2 spike 增加 Windows 子进程树 kill 验证；插件工具需验证**绕过 Docker sandbox 本机直执**的 provider 配置（DSH sandbox seam） |
| G7 | 过渡与迁移边界未划 | 旧 DB 历史**不迁移**（旧控制台只读共存）；双跑 = 灰度开关（新提交全走 DSH）；外部接入方（artemis-client/MCP 用户）改走 webhookRuntime/SDK——迁移清单纳入 P4 |
| G8 | **退出码/终态契约矛盾（S2 已改）**：py 退出码不编码任务结果（blocked/flash-failed 退 0、取消退 130）；终态权威=DataEngine DB 行，退出码仅兜底 | DSH job outcome 降为 UI 层展示、以 DB/trace 为准；`exit 130`→cancelled；kill 先写 cancel marker 再宽限硬杀（联动 G10）；S2 spike 验证（盘点 01 §1.5、04 §1.4） |
| G9 | **worker env/CLI 全量契约（S5 是子集）**：漏 `ARTEMIS_TASK_WORKER=1`（缺失→反向自提交旧 daemon）、`SUBMITTED_AT`（漏则轮次重排）、`TASK_INGRESS`/`DEVICE_QUEUE_TICKET`/`ADB_ENDPOINT_ID`/`IPC_PORT`/driver 组/凭证组 | S5 改指向盘点 inventory/02 §2.1 全表；P0 spike 断言 env 透传集合 |
| G10 | **优雅取消通道被标「✅ 删除」与一期黑盒矛盾**：Windows 下硬杀无信号，录屏 remux/trace 编译/锁释放/cancelled 终态全靠 cancel marker（PID+created_at 防复用）+45s 宽限 | 映射表改「一期保留」；DSH kill=先 marker 后硬杀；S2 spike 增 kill→marker 联动验证（盘点 02 §1.5） |
| G11 | **终态/环境级判定信号来源未定**：零步骤一票挂 + 18 个 ENVIRONMENT_ERROR_MARKERS 需查 DB；fail-open/fail-safe 不对称；auto 挂端点默认键 | 决策：读同一 SQLite（推荐）或 stdout 特征扫描；allowed_fails 默认值拍板（建议 1=现行为）（盘点 01 §1.2） |
| G12 | **LLM 暂停协议未记录**：重试耗尽写 `.artemis_paused` 后静默挂 900s，DSH 侧像假死 job | 运维成文：删文件=resume；或一期显式调小 `LLM_PAUSE_TIMEOUT_SECONDS`（盘点 04 §2.3.3） |
| G13 | **幂等/去抖提交语义**（session 短路、1s 防抖、重试跳过就绪探测、409/400/rejected/unknown）仅存于代码与测试 | webhookRuntime/SDK 接入验收项——防重复操作设备（盘点 01 §1.1、05 §3.1） |
| G14 | **状态词汇表映射**：现网 vocabulary（success→completed 归一、raw 留对账）↔ DSH JobStatus | manual stop=cancelled↔killed 等映射显式定义（盘点 01 §4） |
| G15 | **双跑共享 temp 目录**：`<temp>/device-locks/` 是 py↔TS 真实 IPC | 双跑期共用目录与格式，或按任务二选一线路保证设备不相交（盘点 02 §2.2） |
| G16 | **会话延续 notes 记忆**：同 conversation 下一提交读 `traces/<sid>/notes/*.md`（≤8000 chars）注入 planner | 切换按 conversation 边界（进行中线程不切）或一期保留 py 写 notes（盘点 02 §1.2、04 §2.6.4） |
| G17 | **共存期鉴权面**：SameOrigin（无 Origin 直通）、lifecycle token、loopback-only 管理面、vite Origin 剥离含 SSE | P4 共存期不可回退项；DSH 认证等价性验证（盘点 01 §1.7、05 §3.5） |
| G18 | **SSE 死信道与事件契约**：`queue_held/paused/resumed` 广播无人订阅，队列 UI 信源=2s 轮询字段；`recording_ready` 双形状 | P0 契约测试基线=盘点 05 §1.2；形状收敛+信源决策（盘点 05 §1.2、01 §1.4） |
| G19 | **线程聚合不变量只活在将删的 Vue spec**：submitted_at 锚、幽灵防护、自动跟随准入、草稿豁免、排队不提升 | DSH roster/toolview 验收清单=盘点 05 §2.1/2.2/2.4；断言先移植 |
| G20 | **晚订阅 catch-up**：SSE 订阅即回放（合成 started+progress+已落库步骤） | DSH session/event 等价物验证；不支持则 toolview 补偿（P3 验证点） |
| G21 | **对外通知契约**：`conversation_id 或 ingress=mcp` 才通知+两类判死；webhook payload schema 是外部网关既有契约 | jobs settled 适配薄层承诺清单；迁移前调研外部启用通道（盘点 05 §3.3） |
| G22 | **外部 SDK/MCP 基线**：artemis-client 公开面无成文；`/api/v1/capabilities` 假端点；MCP docstring 即协议（兜底轮询/release_loop/unknown） | P4 迁移清单输入=盘点 05 §3.2/3.4；capabilities 落实或删除 |
| G23 | **录像产物与媒体契约**：manifest v2、`recording{,_NNN}.(mkv|mp4)`、首帧锚定、`_PASS/_FAIL/_TESTFAIL` 改名、`image://{sha256}`、媒体 HTTP=根约束+白名单 | autogamer-media 验收规格=盘点 03 §1.4–1.6；P4 前确认终态目录无外部消费 |
| G24 | **坐标与结果契约**：0-1000 归一域、索引 client 端解析、target_description 不上 wire、ActionResult 拒绝≠异常、动作名归一 | autogamer-device 契约=盘点 03 §1.8；换坐标体系=历史回放与 prompt 全失配 |
| G25 | **层级后端互斥**：helper/u2 UiAutomation 单例互斥、30s 降级窗、u2 用后 stop_server、离线快判 | 不复刻 helper=显式放弃 Mobly/Appium 共存；互斥不变量进 autogamer-device spec（盘点 03 §1.9） |
| G26 | **PID-liveness 协议**：`(pid, process_created_at)`±1s、不确定=默认存活，五处共用 | S7 孤儿对账 kill 必须用此协议（PID 复用前科）（盘点 02 §1.1） |
| G27 | **智能栈暗规则零记录**：plan 写入机器规则六条、checker 三不变量、run_outcome 双轴、memory 梯级、transcript 回滚开关 | 二期逐 agent 搬迁验收基线=盘点 04 §2.4–2.6 |
| G28 | **parking + 全局并发上限 N**：单 ticket park 一台空闲设备（历史 bug 不变量）；`ARTEMIS_MAX_CONCURRENT_TASKS>1` 是 D3 未涵盖的第三语义 | parking 回归测试进 P1；全局上限 TS 闸门承接或声明不支持（盘点 02 §1.1） |
| G29 | **中途指导注入通道**：`injected_instruction.json {instruction, release_loop}` 读后即删 | 已立 S9；DSH 对应物待 spike（盘点 04 §2.5） |

### 全模块映射：DSH 原生 vs 保留自建（防重复建设清单）

| ARTEMIS 模块 | 职责 | DSH 原生对应 | 结论 |
|---|---|---|---|
| `data_engine` + repositories + SQLite | 会话/步骤持久化 | session log（append-only JSONL、generation 迁移链、resume/fork/replay） | ⚠️ **一期保留**（worker 终态权威 G8 + notes 跨任务记忆 G16 + 双跑期幂等补列/只读零副作用），二期删除 |
| showcase_ui_v2 会话/轮次/工具展示 + 前端 4-step merge | 控制台 UI | DSH Web UI + 轨迹回放 + `session/event` 流（单一事实源，无四源合并） | ✅ 删除自建 |
| 队列/任务状态展示 | 队列可视化 | jobs 浏览器 roster（`job.list`/`job.follow` Remote streams）+ toolview 槽 | ✅ 原生 |
| `ipc_service` + `/api/stream` SSE（实为 `apps/admin_console/services/ipc_service.py`，无 artemis/ 包目录） | 事件广播 | `session/event` + `agent/assistant-stream` 原生事件 | ⚠️ server 侧删除；worker→daemon IPC 桥（`ARTEMIS_IPC_PORT`+port file 双源）一期黑盒保留；事件消费基线=盘点 05 §1.2（G18） |
| `/api/run` 外部提交 | 编程接入 | webhookRuntime（认证投递 + 建 Session）/ SDK / ACP | ✅ 原生 |
| `/api/status` 四源合并 | 状态查询 | session log 单一事实源（问题本身消失） | ✅ 删除 |
| `/api/stop`、queue pause/resume | 停止/暂停 | stop=`JobRegistry.kill`+cancel marker 联动（G8/G10）；pause/resume 是**调度器闸门**（保留 pending、不碰运行中），非 agent.cancel | 🔧 stop 原生+联动；pause/resume 归 autogamer-queue 闸门（自建百行）；现行为手动 resume 同时清熔断挂起，半开自动恢复落地后需写明差异 |
| `model_service`（endpoint 库/固定端点/profile 反推） | 模型路由 | LLM seam + per-agent `AgentOptions(provider/model/reasoningEffort/maxTokens)` + profiles | ⚠️ 原生；pin fail-loud（未知端点名 RuntimeError 拒启）+ ENDPOINT_OWNED_KEYS 覆盖 + 12 agent 节点继承规则是 AgentOptions 输入；注：py **无 [vlm] 路由键**，多模态按节点配置 |
| `worker_process_io` | 子进程输出转发 | jobs output ring + `JobOutputSource`（registry 定档泵取 + spill 完整流文件） | ✅ 删除自建 |
| `state.py`（active_runs/submission_meta/startup_progress） | 运行态登记 | owner 围栏 + session log 原生 + jobs progress | ✅ 大部分删除 |
| runtime daemon/server lifecycle | 进程托管 | DSH launcher/profiles（web/headless/desktop） | ✅ 大部分删除 |
| `device_lock.py` 1028 行 | 设备互斥 | 跨进程场景消失（单宿主进程） | 🔧 收缩为进程内闸门 + 熔断（百行）；parking/全局并发上限 N/PID-liveness 语义须继承（G26/G28） |
| task_queue_service 的 spawn/kill/输出转发（execa 监管层） | 长时子进程监管 | DSH 自带 `bash` job kind + subprocess `readFrom` pull source：output ring、`JobRegistry.kill`、退出码→`JobOutcome.detail`、settled 完成通知 | ⚠️ 原生但有前提：kill 须联动 cancel marker（G10）、env 透传集合断言（G9）、终态以 DB 为权威（G8）——py worker 注册为 job，不自建监管层 |
| HITL 审批 | 安全审批 | DSH approval policy（ask/never + allowed-once，fail-closed） | ⚠️ 原生；但破坏性面**全部集中**在 `run_adb_command`（任意 adb shell 零过滤，盘点 04 §3）——ask 实操=对它做参数审查或整工具 ask；helper APK 安装/Chrome 强制标志是无审批点的隐式设备变更 |
| `mcp_server` 通知/外部接入 | MCP 集成 | webhookRuntime + jobs `settled` 事件通知 | ⚠️ 大部分原生，留适配薄层 |
| `packages/artemis-client` | SDK | DSH 官方 SDK（TS + Python） | ✅ 删除自建 |
| `task_preset_catalog` 514 行 | 任务预设/推荐 | DSH skills/命令承载 | 🔧 转化为 skills（非自建服务）；打分逻辑（包匹配+100/-40、priority 基分）与 APP_REGISTRY 22 包是转化基线（盘点 04 §2.8） |
| `drivers/`（ADB/uiautomator2/mock） | 设备执行 | 无原生对应 | 🔧 保留——重写为 autogamer-device（差异化核心）；能力基线=盘点 03 §1.1–1.2（mock 复刻契约+驱动能力清单），坐标契约 G24、互斥 G25 |
| `media_service` 623 行（录屏/孤儿恢复/图片服务） | 媒体管线 | output ring 仅 UTF-8 文本（二进制 mp4 不适配）；`JobOutputSource.spillPath` 可作完整流文件交接点；mp4 托管/HTTP 服务无原生 | 🔧 拆分：录屏转换/孤儿恢复留 py（D8 例外）；托管/路由转 autogamer-media TS 插件（`ctx.connection.fetch`，dsh-data-agent 已实证）——产物契约 manifest v2/命名/首帧锚定/安全模型是其验收规格（G23） |

**Grep 真实清点补全（artemis/ 150+ 文件，此前映射遗漏 ~8000 行智能栈）**：

**A. artemis/agents/* + graph/*（智能栈，一期黑盒保留 / 二期重写）**
| py 模块 | 职责 | DSH 承接物 | 结论 |
|---|---|---|---|
| planner/operator/checker/validator/explorer/diagnoser/flash/video_analyzer（~40 文件） | 多 agent 执行智能（规划/操作/校验/探索/诊断/视频分析） | DSH agent loop + subagent providers + skills：operator→设备操作 agent；checker/validator→LLM seam 结构化校验；explorer→探索 skills；video_analyzer→多模态 LLM | 二期重写（模式 a）；一期黑盒保留 py；逐角色职责/输入输出/失败行为验收基线=盘点 04 §2.4，暗规则 G27 |
| graph/（langgraph 编排 + checkpoints） | 流程编排；**无断点续跑**（无 langgraph checkpointer；checkpoint=计划校验账本 check_ledger.jsonl，非执行断点） | DSH agent loop 原生 | 二期替换（勿按 resume 语义设计，与 D5 一致） |
| llm/（router/reliability/structured/google）+ services/llm.py 977 | LLM 路由/重试/结构化输出 | DSH LLM seam + provider adapters + per-agent `AgentOptions` | 一期保留；二期原生 |
| memory/（chunking/context_policy/step_memory/transcript） | 上下文管理 | DSH session log 投影 + context 管理（KV cache/compact 原生） | 二期大部分原生；chunking 策略专项评估 |

**B. artemis/tools/*（worker 内 agent 工具 ~25 文件）**
| 通用工具（command_tool/scratchpad/wait_tool/log_tool 等） | 通用执行/暂存 | DSH 原生 bash + scratchpad + skills | 二期原生承接，**不自建** |
| 设备工具（mobile/：launch_app/ocr/read_hierarchy/read_logs/search_logs） | 设备感知/操作 | autogamer-device 工具 | 二期 TS 重写 |
| 高级工具（explorer_tool/committee_tool/diagnostic_tool/history/*） | 探索/委员会/诊断/历史 | DSH skills + autogamer-device 部分 | 二期拆分映射 |

**C. artemis/runtime/* 补全（此前表已列 5 项，补 4 项）**
| helper_manager.py 931 | 设备辅助栈安装管理 | autogamer-device 内 | 二期 TS |
| awake_service + awake_lease | 屏幕常亮 | autogamer-device 内 | 二期 TS |
| cancel_requests（取消标记文件） | 跨进程取消 | `JobRegistry.kill` / `agent.cancel` 原生 | ⚠️ **一期保留**（Windows 下唯一优雅取消通道：marker+45s 宽限+PID 防复用，G10——DSH kill 硬杀收不到信号）；二期随 worker 退役 |
| trace_store（status.json/trace 目录/原子写） | 外部状态文件 | session log 原生 | ✅ 删除 |

**D. artemis/mcp/* + controllers/ + clients/（worker 内执行层 ~3000 行）**
| mcp/action_server/executor/session + adb_server + actuators | 进程内动作执行服务 | autogamer-device 工具执行管线 | 一期保留（worker 内），二期替代 |
| controllers/unified_controller + clients/accessibility + screen_client | 设备控制抽象 | autogamer-device | 二期 TS |

**E. artemis/core/diagnostics/*（probes/engine/device_smoke/emulator_manager/adb_keys ~4400 行）**
| 就绪诊断/模拟器管理 | 提交前就绪检查 | 一期保留 py doctor（worker 内）；二期部分转 autogamer-queue admission 探测 | 一期保留；admission 必须继承：锁屏 fail-closed 确认探测+多设备自动切换+显式 serial fail-open（盘点 03 §1.7） |

**F. artemis/config/ + services/token_meter + telemetry/ + toolchain/**
| config/（agent.py 993/endpoint_library/llm） | 配置/端点库 | DSH profiles + provider adapters | ✅ 删除 |
| telemetry + toolchain + token_meter | 遥测/工具链解析 | DSH telemetry 原生 + worker 内小件保留 | 大部分删除 |

**G. mcp_server/notifiers/*（webhook/script/file/desktop/composite/agentapi 7 通道）** | 任务完成通知 | jobs `settled` 事件 + DSH 通知插件 | ⚠️ 薄层适配

**剩余自建清单（全部 TS，D8）**：① autogamer-device（设备工具 TS 重写，差异化核心）；② autogamer-queue（设备锁闸门 + 熔断 + 孤儿对账，百行级；worker 监管由 DSH job 原生承接，不自建 execa 层）；③ autogamer-media（TS 插件路由：录屏经 spillPath 交接，`ctx.connection.fetch` 挂图片/静态路由——dsh-data-agent 已实证此模式）；④ 任务预设转 skills；⑤ mock driver 转 TS 插件。**py 保留例外**：uiautomator2/adbutils 设备驱动、录屏栈、langgraph worker 本体（一期黑盒保留，二期随模式 a 退役）。其余约 5000+ 行服务层 + 整个 Vue 控制台 + data_engine + SDK/MCP 均由 DSH 原生能力承接。**死代码（无消费方，直接删除不迁移）**：`drivers/android/recorder.py`、`drivers/android/input_ime.py`、`drivers/cloud/cloud_driver.py`（grep 全仓无引用，盘点 03 §1.2）。

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

**artemis/core/diagnostics/*（就绪探测/engine/device_smoke/emulator_manager/adb_keys ~4400 行，两处旧计数不一已订正）**
- 提交前置检查 → autogamer-queue admission 钩子（TS 轻量版）或保留 py doctor CLI 调用；emulator_manager 留设备侧

**artemis/clients/* + controllers/*（accessibility/screen client、unified_controller 581）**
- 二期进 autogamer-device（TS 重写或 CLI 间接调用）；一期保留

**artemis/runtime/helper_manager.py（931：accessibility helper 安装管理）**
- 二期进 autogamer-device；一期保留

**apps/admin_console/replay_manager.py（2276）+ routers/replay.py**
- 回放 → DSH trajectory replay（session log fork/replay）原生承接大头；录屏产物经 spillPath → ✅ 一期后删除（replay outputs 归档/切块校验启动钩子与沙箱 DB 优先查询随控制台删除，无需迁移；能力边界=盘点 01 §1.6）

**apps/admin_console/routers/system.py（1280，原误挂在 replay 行下——与回放无关）**
- readiness/emulator 归诊断线（一期保留 py）；credentials/model-config/endpoints 归 DSH profiles+provider adapters；server-status/restart/shutdown 归 launcher——⚠️ 共存期这套管理面仍活着（loopback + lifecycle token，G17）

**apps/admin_console/routers/sessions|steps|media.py + core/security.py（146）+ services/device_stream_service.py（137）**
- 查询 API → session log 原生查询；鉴权 → DSH 认证原生；设备流 → toolview/output ring 承载 → ✅ 删除/收缩

**packages/artemis-client/（注意：实为 Python client——transport/models/errors，非 TS）**
- DSH 官方 SDK（TS + Python）替代 → ✅ 删除；外部调用方迁移清单纳入 P4（G7）；公开 API 基线（task_id 幂等重试/get_task 兜底/错误分层/capabilities 假端点处置）=盘点 05 §3.4（G22）

**tests/**（unit/admin_console + data_engine）
- 随被删模块同步删除；conformance 契约测试替代（G5：CI 起真实 DSH runtime）

### Checklist

- [ ] P0 骨架：插件包骨架（`autogamer-queue`/`autogamer-device` 独立包，自带 `cordis.patch.yml` 声明 `dsh.bundle.patch`）+ peerDependencies range 声明 + `dsh plugin --profile web add` 安装流 + `--dump-config` 验证 layer + conformance 测试骨架 + **S1 spike（外部 SessionId 指定性）** + **S2 spike（bash job 跑 artemis CLI：输出环/kill/退出码/完成通知）**；开发流 = build + `dsh plugin add .`（link 模式；无热重载，改码需重启 profile 进程）；**盘点增补**：S2 spike 增 kill→cancel marker 联动验证（Windows）/env 透传集合断言（G9）/worker 内自取锁与 TS 闸门叠加验证（G8/G10）+ SSE 事件名全集快照测试（基线=盘点 05 §1.2，G18）
- [ ] P1 队列插件：设备锁闸门 + 设备维度熔断（半开恢复）+ 孤儿对账；**先 spike 验证 DSH bash job 承载 artemis CLI worker**（输出环/kill/退出码/完成通知/session-stop 联动）；验证 Inbox 原生会话队列覆盖原需求（不引 GroupMQ/BullMQ/Redis）；**盘点增补**：熔断解除矩阵（4 条路径）+ fail-open/fail-safe 不对称 + auto 端点默认键 + allowed_fails 决策（G11）；never-started failed 补插 + stdout 尾行 + 终态双写规则（G8/G14）；parking 与 ticket 时间戳回归测试（G28）；孤儿对账 kill 用 PID-liveness 协议（G26）
- [ ] P2 设备插件（**二期·模式 a，一期不做**——见 G1）：device_* 工具重写（ADB/uiautomator2 → TS；UIA koffi；隐藏桌面）+ ARTEMIS 执行逻辑搬入 DSH agent+skills；**盘点增补**：验收基线=盘点 03 §1.1–1.2 能力清单 + G24 坐标契约 + G25 互斥不变量 + G27 智能栈暗规则（koffi/隐藏桌面之外并入 Windows MKV 文件锁、CTRL_BREAK flush 经验）
- [ ] P3 UI 接入：web profile + 队列状态展示（toolview 槽）+ 审批策略映射（HITL：敏感操作 ask/never + allowed-once）；**盘点增补**：dock/roster 交互验收对照盘点 05 §2.2（chips scoped/暂停收敛/停止多态，G19）+ catch-up 与队列信源决策（G18/G20）
- [ ] P4 过渡：py worker **零改动**接入（env 契约不变，D8）+ 双跑灰度验证（G7）+ 旧控制台（showcase_ui_v2/admin_console）只读共存与下线决策；**盘点增补**：mcp_server 对账回退（trace/status.json 双写）改造先行 + notes 记忆断档防护（G16）+ 通知矩阵调研（G21）+ capabilities 处置 + quality_ratchet/locale 锁显式声明 + SameOrigin/dev.sh PID 方案等共存期事项（G17）+ 外部接入方清单具体化（mcp_server/artemis-client/`artemis run` 非 worker 分支/`artemis trace`/`batch` CLI）

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
