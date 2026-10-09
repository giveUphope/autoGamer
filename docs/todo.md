# TODO · DSH 插件化迁移方案（R2' 定稿）

> 活文档：已完成条目直接删除，演进依据查 git 历史。
> 本方案于 2026-10-09 经七轮源码核实与两次方向重构后定稿：**基线 = google/artemis 上游实现**（本仓库为其 fork，智能栈基本未动；领先提交数**别写死**，复测：`gh api repos/giveUphope/autoGamer/compare/google:artemis:main...main --jq .ahead_by`，2026-10-10 实测 83，另有本会话未推送的提交），路径 = **直通插件**。论证过程与历史版本：git log + [upstream-rethink](migration/upstream-rethink.md) + [dsh-verification](migration/dsh-verification.md) + [feature-inventory](migration/feature-inventory.md)（含 inventory/01-05 明细）。

## 零、当前状态（先读这一页，细节在后面的节）

| 项 | 现状 |
|---|---|
| 阶段 | **P0 未完**（骨架、离线 spike、安装流、conformance 已过；live 复验未过） |
| 唯一阻塞 | **G30**：`run_device_action` / `report_task_status` 注册成功却不进 agent 工具面。形态特征已定性——会话请求里**连 `tools` 键都不存在** = 按 R8 整个 preset 被拒挂，而不是少一个工具 |
| 头号候选 | `inject: ["tools"]` 里的服务在该 realm 未必可解析。practices 原文要求可选服务走 `ctx.inject([...])`，让插件「不激活而不是抛错」 |
| 下一步（按序） | ① `inject` 改可选注入 → ② preset 挂 `tool-plugin-manager`（D17）→ ③ 用 roster 诊断与 `cordis_inspect_query` 的 `Tool` 分流 → ④ 若 `leakedServices` 非空则按 R8 包 `cordis:group` + `isolate` |
| 每步的前置 | R6（`--dump-config` exit 0 且无 unmatched）＋ R7（**开新会话**再验，旧会话不重读声明） |
| 已顺手修掉 | `coord.ts` 的 `byteAt` 无限递归（截图取尺寸整条路死）；`screenSize` 的真值 `[undefined, undefined]` 陷阱（默认配置会把 `NaN` 坐标发给 action server 还报成功）。都有锁死测试＋删除实验 |
| 测试面 | vitest 36/36；文档门禁 `scripts/check_doc_tables.py`、`scripts/check_doc_registry.py` |
| 读不动时 | 编号查 [registry](migration/registry.md)，词查 [glossary](migration/glossary.md)，进哪份查 [导航](migration/README.md)，动手前查 [守则](migration/plugin-contract-rules.md) |

## 一、最终形态

整个项目收缩为**一个 DSH 插件 `autogamer-device` + 若干 skills**：

- **DSH 宿主提供**（原生，禁止自建）：会话队列（Inbox/QueueDock）、调度（agent loop）、Web UI、jobs 监管、审批、凭据、超时、沙箱、媒体展示（present）、会话记忆
- **插件提供内容**：`run_device_action` 执行工具（内含单层路由器，S11）+ 设备资源管理（闸门/熔断/准入，工具内部）+ autogamer preset（instructions/白名单/approval）+ validator/checker 两个只读 subagent
- **py 复用**（零重写）：`mcp_server` 动作面（13 工具）+ 驱动栈（adb/uiautomator2）+ 诊断栈 + clients/controllers + utils CV；录屏后补（D12）
- **不迁移**：py 智能栈（langgraph 多 agent——由 S11 单层替代）、旧控制台（原地只读保留）、artemis-client（无外部调用方）

## 二、决策记录（现行有效，D1-D17）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 战略路线 | 项目以 **DSH 插件形态重生**；方案基线 = google/artemis 上游（upstream-rethink） |
| D2 | 队列底座 | 会话队列 = **DSH Inbox**（durable + QueueDock）；禁止自建队列容器/引 Redis；「autogamer-queue」插件概念已取消 |
| D3 | 设备模型 | **共享真机 + 完整闸门**（用户已决）：闸门/熔断/准入 = run_device_action 工具内部逻辑；每会话专属模拟器（上游 playground 模型）= 二期演进项 |
| D4 | 积压策略 | Inbox 无上限原生，零自建 |
| D5 | 重启恢复 | Inbox pending 原生恢复待派 + 插件启动显式 kick（已核实的唯一缺口）；动作无断点续跑（与上游一致） |
| D6 | 版本管控 | peerDependencies 声明 + runtime 强制校验 + conformance 契约测试；自研包精确 pin |
| D7 | 引入形态 | **三层分开**（守则 R2）：① 禁——手写 profile 目录内的 `package.json` / `cordis.patch.yml` 或在 profile 目录跑 pnpm；② 允许且为开发期主路径——`dsh --patch <path>`（`dsh --help` 明列的官方 overlay，可重复）；③ 交付形态——`plugin_manager install_bundle` 或 Web 侧边栏「插件」面板（面板具备 install/enable/disable/retry/compose 能力）。preset 声明由 bundle 补丁承载（注册表不扫目录、不接受路径）；**配置层热重载、代码层冷重启**（`patchReload` 字段 rc.2 无实现）；**声明只影响之后创建的 Agent**，复验必须开新会话（守则 R7） |
| D8 | 技术栈 | 插件 TS；py 复用动作面/驱动/诊断/helper/录屏(后补)；**langgraph 智能栈不迁移**（由 S11 单层替代） |
| D9 | 迁移路径 | **R2' 直通插件**（P0 即插件形态，质量 spike 把关；不过→回退三段式双跑，历史方案见 git）；一期红线=旧控制台**原地只读保留**（不删除） |
| D10 | 产品形态 | 项目=DSH 插件，**无独立外部 HTTP API 面**：不建 HTTP→SDK 桥、artemis-client 直接删、webhook 通知按需再建 |
| D11 | 审批 | 常规动作 never；**run_adb_command 整工具 ask**（allowed-once，唯一授权粒度）起步；headless 需显式 `policy: never` |
| D12 | 录屏 | 后续补齐（一期无录像） |
| D13 | helper | 二期 TS 复刻（保留与 Mobly/Appium 共存差异化能力） |
| D14 | 智能层 | **单层执行路由（S11）**：单 agent + 代码强制路由器 + validator/checker 只读 subagent；pro 一期内实现、调用逻辑保真；不做反思式自检（业界 SOTA 立场） |
| D15 | 契约核实口径 | **只用声明面**：`dsh --dump-config-schema` / `--help` / 随包 README / 已安装 npm 包产物；**禁止解包 app.asar** 去读宿主内部代码（2026-10-10 用户裁定）。既有 [dsh-verification](migration/dsh-verification.md) 里 37 处包内代码行引用属旧口径，沿用前须按声明面重验；README 与 CLI 旗标类证据（28 处）本已合规 |
| D16 | 插件分层与 realm | 官方口径（[upstream-plugin-forms](migration/upstream-plugin-forms.md) 二.6）：Host 插件提供共享服务（tools registry、agent loop、sessions 等），**preset 插件只向这些 registry 贡献 scoped tools / persona / prompt 片段 / policy**；preset 内提供服务的插件**必须与其全部消费方同处一个 `cordis:group` + `isolate` realm**，条目局部隔离不沿 Agent 注册 scope 传播；注册表 `mountRevision` 对「行激活失败」与「服务泄漏进 root realm」都是**直接拒绝整个 preset 挂载**（源码口径 `mount.ts:193,212-213`） |
| D17 | 自举引入 | 给 `preset-autogamer` 挂 `@deepseek-ai/dsh-plugin-manager/tools`（官方 shipped preset 里该行的 disabled 写作 `!!js '!ctx.get('profileContext')'`，即 UI 会话中可用），让 AutoGamer agent 能对自己执行 `install_bundle`。这是上游「让 Agent 给自己造插件」的现成路径，也是把引入流从手工迁到自动的落点；执行细节与红线见 [守则 R2 / R9](migration/plugin-contract-rules.md) |

## 三、对接语义（S1-S11，R2' 最终版）

**S1 会话映射**
- ARTEMIS `conversation_id` ≡ DSH `SessionId`（✅ 核实：外部指定 + 幂等 create-or-adopt；id 会转义为磁盘目录名）
- 用户消息 = `followup` 进 Inbox（原生会话 FIFO + QueueDock 排队 UI）；会话记忆 = DSH 原生对话延续（py notes 继承机制消失）

**S2 任务 = turn 内动作序列（R2' 修订，取代「任务=job」）**
- 不再 spawn py worker job（R1 遗产）：设备动作 = `run_device_action` 工具调用，内部转发 py action server
- 长任务 = 单 turn 内多动作（工具内 await）；kill = `agent.cancel`（工具经 exec.signal 取消转发、释放闸门）
- 终态 = 汇报工具的 `completed/blocked + tests.failed`（run_outcome 双轴语义，盘点 04）

**S3 设备闸门（工具内的执行机制；策略出工具）**
- 闸门 = per-device 弱表 promise 链（官方样板 tool-bash-persistent：WeakMap<owner,Promise> + tracked pending 支持取消）+ `dsh-deque`；lockKey = endpoint+serial
- 阻塞获取（排队以 turn 进行中呈现）；parking（auto 单 ticket park 一台空闲设备）与全局并发上限（G28）内部化
- **与宿主并发约定对齐（守则 R14）**：官方已经规定「独立只读调用可并发，变更类调用独占执行并按提交顺序」，所以我们只补「同一设备跨会话串行」这半边；`take_screenshot` / `get_ui_hierarchy` 应声明为可并发。属性字段名官方文本没给，必须先 `cordis_inspect_query` 取真名（R14 判据），取到之前不许按英文字面猜着写

**S4 设备熔断（状态在插件，拒绝出口用 guard）**
- closed →open（连续环境级失败 ≥ allowed_fails，工程默认 1）→ half-open（下一条真实消息动作即探测）→ 成功 closed
- 环境级判定（R2' 改写）：**工具层错误分类**——action server 连接失败/adb 不可达/设备离线/锁屏 = 环境级；模型语义失败 = 任务级；枚举不确定→继续熔断（fail-safe）、探测失败→不挂（fail-open）不对称保留
- **冷却期的拒绝走 `ctx.tools.guard()`**（守则 R13：它是加在 `tools/pre-execute` waterfall 之后的单调同步守卫，后续监听器无法把拒绝翻回允许，且不受注册顺序影响）；只有需要 await 的决策才在 `tools/pre-execute` 返回 `ask`。官方原文「尽量不要把部署策略内建到工具中」，所以熔断**状态**归插件、**拒绝出口**归 guard
- 挂起期间新消息保留在 Inbox（QueueDock 可见）；解除 = 设备恢复探测 / 新提交 / 显式 resume（唤醒语义按 R17 区分 `followup` 与 `inject`）

**S5 执行层契约（py action server，原样复用）**
- 载体：`artemis mcp --server adb` 动作面（13 工具：tap/long_press/swipe/back/launch_app/stop_app/open_link/focus_and_input_text/focus_and_clear_text/erase_one_char/press_key/take_screenshot/get_ui_hierarchy）
- autogamer TS 工具内部作 MCP client 转发（**不裸用 dsh-mcp-client patch**——会绕过闸门）；进程由插件生命周期管理
- env 极简（对齐上游容器契约）：`ADB_DEVICE_SERIAL`/`ADB_HOST/PORT/SERVER_SOCKET`/`ARTEMIS_HIERARCHY_BACKEND` + helper 相关
- 返回契约：ActionResult（`isError=False + ok=False` = 设备拒绝，观察非异常）；0-1000 归一坐标（G24）；**超时不许指望 `timeoutMs`**——注册表绝不强制执行定义里的它（守则 R15），现状是由 `ActionClient` 的 `Promise.race` 自实现并观测 `exec.signal`（主体前取消 = `ABORTED_BEFORE_DISPATCH`，主体后取消只能把成功换成 `ABORTED`，超时为 `TOOL_TIMEOUT`）；要交给宿主执行须挂 `dsh-tool-call-timeout-policy` 包装层，其入参官方文本未列（守则待补 2）
- **裸 schema 注册是合法形态**（守则 R12/R13 补正）：`ctx.tools.register()` 直接收 schema 定义，官方自己就这么接 MCP——「MCP 服务器发现工具后，用服务器的 schema 调用 `ctx.tools.register()`」；`defineTool` 只是类型化 DSL 糖。但代价明确：**直接注册的原始 JSON Schema 工具自己负责输入校验**，且显式对象节点要声明 `additionalProperties: true / false`，schema DSL 表达不了的约束（非空字符串、正数、跨字段）也得自己查——我们现在的 `target` / `text` / `key` 校验就是这部分
- **注册可见性（G30）**：`ctx.tools.register()` 返回 disposer **不等于 Agent 能看见该工具**——插件注册继承 preset scope，由 Agent scope 的父链接决定可见性，而组外的普通 Context 查找仍选 Host realm。判据改用官方检查器（`cordis_inspect_query` 的 `Tool` 项 = 「本 Agent 可调用哪些工具」、roster 的 `enabled`/`fiberPhase`/诊断文本、`inspectCompositions()` 的 leakedServices），不再靠 LLM wire 反推

**S6 审批映射**
- 常规动作 never；破坏性面全部集中在 run_adb_command → **整工具 ask**（D11）；helper APK 安装/Chrome 强制标志 = 任务前置隐式授权（ARTEMIS_HELPER_AUTO_INSTALL 可关）；fail-closed 默认
- **授权红线（守则 R19）**：批准工具调用、回答 agent 提问、放宽策略这类「授予或确认权限」的动作**永远 user-only**，不得做成 agent 可调的工具，也不许由插件代答；同一操作只在 Host service 方法里实现一次，UI 动作与 agent 工具共用它（官方「one operation, two callers」），不许两边各写一份逻辑
- 附带观测口径：普通工具失败要收敛成结果返回，**不能中止本轮**（`UNKNOWN_TOOL` 等都是结构化错误而非 throw 出轮次）

**S7 重启对账**
- 插件启动：拉起/校验 action server → 扫 pending inbox 非空会话显式 kick（D5）→ 无孤儿 worker 概念（R1 遗产消失）

**S8 版本门禁**：conformance 契约测试锁事件/工具面/session 格式，接 `dsh plugin` 升级流。**版本差要盯住**：spike 全程跑 `0.2.0-rc.2`（2026-09-29），上游已发 `dsh-v0.2.1-alpha.1`（10-03）与 `dsh-v0.2.1-alpha.2`（10-09），alpha.1 的主题就是「让 Agent 给自己造插件」（即本次调研引用的两个 skill）；升级前 conformance fixture 视为过期

**S9 中途指导注入**：py 机制消失；DSH 侧 = `steer`/`followup` 原生（已核实）。按守则 R17 分两种唤醒语义：`agent.inject({content, source:{kind}})` 追加持久上下文但**不唤醒**（空闲 agent 保持空闲，下一次准入的 step 才看到），定时器要驱动工作必须调 `agent.followup()`；`source.kind` 要在插件里经 `MessageSourceMap` 声明——session format V4 在消息准入处**拒绝**已退役的 `{kind:'plugin', plugin:'<name>'}` 包装；对已 dispose 的 agent 要 try/catch。另注意 `whenIdle()` 不等于一个 followup 结束（多个输入可共享同一次运行区间），S3/S4 的等待判据要按此写

**S10 turn 执行（已裁定乙）**：用户消息 → Inbox → agent turn → 工具直调。R2' 下无 shim 需求（无 job、无 py worker 分支）；已核实的通用前提仍然有效：composition 挂 `dsh-tool-jobs`、`maxConcurrentJobsPerOwner`（默认 10）、创建 agent 不强制 model

**S11 单层执行路由（D14）**
- 结构：单 agent loop + `run_device_action` 路由工具 + validator/checker 只读 subagent + goal 工具（可选计划脚手架）
- 路由器按序判定（**代码强制，模型不可绕过**）：
  1. 目标置信：元素索引可解析且无歧义 → 短路径直执行（3-5s/步保持）
  2. 风险等级：破坏性/不可逆 → validator 前置 + approval ask
  3. 执行后效果确认（✅ 业界采纳 action-effect verification）：屏幕差分/dHash 确认生效 → 未生效 → validator 自愈梯（XML→坐标→pixel）→ 连败达阈值 → checker 审计通过才许重试
  4. 计划检查点：有 plan（goal 工具）→ 里程碑 checker 审计；无 plan = 仅出口审计
  5. 严格度梯级 off/final/checkpoints/strict = 路由器配置（run_device_task 入参）
- 保真对照（盘点 04 = 验收清单）：validator 升级梯原样；checker 三不变量按守则 R16 落地——**「判定 append-only 落 session log」不许用自写事件类型实现**（带新 `type` 的 append 会让 Session 拒开，`appendPluginRecord()` 虽写 ignorable 记录但 reserved for DSH 实验包），改走 `output.presentationMeta(args, value)` 把判定持久化进 `tool/result` 的 `meta`（可回放、且 `presentResult` 能重建卡片）或 storage service；只读与「释放与判定分离」两条不变；run_outcome 双轴；预算 = goal `maxGoalRounds` + checker 重试上限
- **PTC 让三期能力提前到一期可选**（守则 R14/R18 的 `mode: ptc`）：每个可见已注册工具都能 `await tools.<name>(args)` 直接调用并重入正常执行流水线，成功返回**策略处理后的规范 JSON 值**而非渲染文本，失败以 `ToolCallError` reject（只能读 `name` / `toolName` / `message`）→ validator 的确定性升级梯与 checker 的结构化复核都有现成载体；但呈现方式**按 agent 而非按工具**，同一 agent 内不能让一个工具只用 Native、另一个只用 PTC，且 PTC 中间值不落日志、无法回放
- 业界对齐（dsh-verification §八）：单 agent + 外部确定性控制是收敛方向，反对反思式自检；DSH workflow/PTC = 三期确定性 burst 现成机制

## 四、差距清单（现行有效；已关闭项随定稿移除，见 git 历史）

| # | 差距 | 状态/调整 |
|---|---|---|
| G3 | auto-serial 闸门缺口 | 保留：工具内调度——显式 serial 队列 + auto 空闲池（含 parking 语义 G28） |
| G4 | 熔断探测体 | 保留：S4 已定（下一条真实消息动作 = 探测；不对称策略保留） |
| G5 | conformance 需真实 DSH runtime | 保留：CI 起 DSH（web/headless）跑契约测试 |
| G8 | 终态权威 | 收缩：汇报工具语义（S2）；exit code 映射随 py worker 消失 |
| G10 | 动作中断语义 | 收缩：exec.signal → 取消 MCP 请求/释放闸门；录屏后补时补 graceful stop |
| G11 | 熔断判定信号 | 保留：工具层错误分类（S4，不再查 DB has_steps） |
| G13 | 幂等/去抖 | 收缩：工具内可选同会话同 goal 短防抖（几十行） |
| G14 | 状态词汇 | 收缩：汇报工具 completed/blocked + tests.failed |
| G17 | 共存鉴权 | 收缩：旧控制台只读（SameOrigin 原样即可）；DSH 认证（一次性 token→签名 cookie）为插件轨道 |
| G23 | 录像产物契约 | 保留（录屏接回时的验收规格：manifest v2/命名/首帧锚定/`image://{sha256}`/安全模型=根约束+白名单） |
| G24 | 坐标契约 | 保留：0-1000 归一域/索引 client 端解析/target_description 不上 wire/ActionResult 语义/动作名归一（py action server 原样继承；TS 包装不得破坏） |
| G25 | 层级后端互斥 | 保留：helper 复刻基线（D13）——u2 UiAutomation 单例互斥/30s 降级窗/用后 stop_server/离线快判 |
| G26 | PID-liveness 协议 | 收缩：仅 action server 进程管理用（(pid, created_at)±1s、不确定=存活） |
| G27 | 智能栈暗规则 | 保留：pro 保真清单 = 盘点 04 §2.4-2.6（plan 写入规则/checker 不变量/run_outcome/记忆预算） |
| G28 | parking + 全局并发 N | 保留：闸门工具内部语义 |
| G30 | preset 工具可见性（P0 当前阻塞点） | 新开：两个工具在 `register()` 成功之后仍不进 Agent 工具面。按守则 R8 的形态特征先分流——「连 `tools` 键都没有」= preset 整体被拒绝挂载（`mount.ts:193,212-213` 的 fail-fast），而「面上少我们两个」= 单个子项问题；定性次序按官方诊断（R9）：roster 的 `enabled`/`fiberPhase`/诊断文本 → `cordis_inspect_query` 的 `Tool` → `inspectCompositions()` 的 leakedServices。**每轮复验前必须先证会话晚于本次生效（R7），否则该轮不作数**。**已否证的候选**：「裸 schema 定义必须经 `defineTool` 包装才可见」——官方原文是「MCP 服务器发现工具后，用服务器的 schema 调用 `ctx.tools.register()`」，所以裸注册合法。**剩下的头号候选**：`inject` 里写了宿主在该 realm 未必存在的服务 ⇒ 按 practices 应当放进可选注入（`ctx.inject([...])`），否则行激活失败并连坐整个 preset |
| G32 | bundle 展示元信息缺失 | 新开（守则 R19）：`package.json` 没有 `locale/en.json` 与 `locale/zh.json` 的 `meta.title`/`meta.description`，也没有 icon 与对应 `exports`/`files` 条目。官方口径是 Host-only 与 configuration-only bundle **也有可见 inventory 条目，不构成豁免**，缺字段回退包名、缺图用面板默认插画。后果：插件面板里我们的行显示成技术名与通用插画（本轮已亲眼看到描述回退到 `package.json.description`） |
| G33 | 策略内建在工具正文里 | 新开（守则 R13）：熔断冷却拒绝、审批与超时判断现在都写在 `run_device_action` 正文内，与官方「尽量不要把部署策略内建到工具中」相反。迁移方向：单调拒绝改 `ctx.tools.guard()`、需要 await 的改 `tools/pre-execute` 返回 `ask`、结果观测改 `tools/result`，并显式声明并发安全属性（字段名待 `cordis_inspect_query` 取，见守则待补 4） |
| G34 | 裸 schema 的输入自校验缺口 | 新开（守则 R12 补正项）：直接注册的原始 JSON Schema 工具**自己负责输入校验**，且显式对象节点要声明 `additionalProperties: true / false`，非空字符串、正数、跨字段规则也要自查。现状：`target.coordinate` 只判了元素是否为 number，`text` 未判空、`duration_ms` 未判正、`key` 未判枚举成员 |
| G31 | 引入流仍靠手工 | 新开：现在用 `dsh plugin add file:`（= pnpm 转发，只证明装了没证明生效）+ `--patch` overlay 起步。交付形态要迁到 `install_bundle`，落点见 D17（让 agent 自己装）；`dsh-plugin-manager` 自称 shared by dsh CLI 但本机 `dsh --help` 只列 `dsh` 与 `dsh plugin` 两种用法，**这条尚未定论**（守则待补 2） |
| 已关闭 | G1（模式矛盾）/G2（UI 降级）/G6（Windows 沙箱）/G7（双跑）/G9（worker env）/G12（LLM 暂停）/G15（共享锁）/G16（notes）/G18（SSE）/G19（轮次视图）/G20（catch-up）/G21（通知→按需）/G22（SDK）/G29（注入） | 随 R2' 与裁定消失，逐条证据见 git 历史与三份研究文档 |

## 五、Checklist（R2' 里程碑）

- [ ] **P0 骨架与 spike**：`autogamer-device` 包骨架（run_device_action 工具骨架 + 闸门 + preset；`cordis.patch.yml`/peerDependencies/`dsh plugin add`/`--dump-config`）+ **S10 四点 spike**（模型稳定性/效果验证/闸门阻塞/Inbox 连发）+ **MCP 直连质量 spike**（flash skill + py action server 跑 2-3 个真实设备任务，对比上游 flash 质量——spike 过=直通，不过=回退三段式）+ conformance 测试骨架
- [ ] **P1 设备工具与路由**：13 动作工具 TS 包装全量（闸门/熔断/效果验证/路由决策日志）+ **pro subagent**（checker/validator 保真，盘点 04 清单验收）+ skills（flash prompts 转化 + plan/goal 脚手架 + 严格度梯级）+ 熔断矩阵（4 解除路径/fail-open-safe 不对称/auto 端点默认键/allowed_fails=1）
- [ ] **P2 设备层补全**：helper TS 复刻（D13/G25）+ 录屏接回（D12/G23 契约 + graceful stop）+ mock driver + 诊断 admission（锁屏 fail-closed/多设备切换/emulator_manager 对接）+ 模拟器专属演进评估
- [ ] **P3 UI 收尾**：roster/QueueDock 验收对照 + toolview + goal 轮徽标（按需）。toolview 只能走 client 插件（守则 R18）：在 keyed slot `tool.call.toolview` 按 **wire 工具名**注册组件，Web Client **不消费** `presentCall`/`presentResult`，只定义 Host 展示方法不会增加专用卡片；factory 无副作用、样式只用 `--dsh-alias-*` token、**禁止 import 宿主 Client 包**（要像就拷贝 markup/CSS/行为并加自己的类名前缀），不许另建 presenter registry
- [ ] **P4 旧线归档**：旧控制台原地只读 + py 遗留退役清单（artemis-client 删/replay_manager 删/CLI `artemis run` 非 worker 分支与 `trace`/`batch` 退役/webhook 按需）+ quality_ratchet/locale 锁**显式不做**（记录为有意撤除）
- [ ] **一期改造登记**（对既有模块的任何修改先登记）：① py 侧零改动为默认（mcp_server/驱动原样）；② 如需触碰（如录屏工具），逐项登记并说明豁免理由

### P0 执行状态（2026-10-09 动工，plugins/autogamer-device）

- ✅ **骨架**：run_device_action 路由工具（闸门→MCP 转发→效果分类→路由日志）+ 闸门/熔断 + report_task_status + autogamer preset + flash skill；19 个 vitest 用例全绿（含 conformance 契约 6 项）
- ✅ **安装流 spike（live）**：三处修正固化——`dsh.bundle.patch` 必须声明、bundle patch 是 `- insert:` 列表、Windows 路径+remove/add 重评估；层合成 dump-config exit 0。**2026-10-10 调研修正**：`dsh plugin add` 加手写 profile `cordis.patch.yml` 这条流程本身落在官方明令禁止的一侧（正道是 `plugin_manager install_bundle`），已固化下来的三条机制结论仍有效，但流程要按 D7 改写
- ✅ **MCP 直连 spike（离线）**：ActionClient ↔ `artemis mcp --type adb` 全链路；真实契约接线（13 工具名/像素坐标 0-1000 换算/字符串结果归一化含 `Error executing tool` 变体/`--type` 旗标）
- ✅ **S1**：外部 SessionId 源码核实（幂等 adopt）+ live 组合验证（preset 注册、新任务默认标记、选择器可见）
- ✅ **S10 前置定论**：headless 无 preset registry、root 工具不进 headless agent（4 轮实测+代理抓包）→ S10 转 web；pi-ai baseURL 需 `/v1` 前缀（日志代理实锤）
- ✅ **conformance 骨架（G5/G18）**：tests/conformance/contracts.spec.ts——py 动作面 13 工具快照（fixture=live 抓取）、旧控制台 SSE 事件名 15 项快照含死信道清单（G18）、DSH peer 精确 pin
- 🔴 **S10 四点 live 复验（2026-10-10 执行，① 未通过）**：同实例配对差分给出定位——AutoGamer 会话发给模型的请求体里**根本没有 `tools` 键**（wire 实录两次：本地 01:33:43、01:41:11），模型转而幻觉出一个 `os` 工具并把调用写成文本 JSON；而**标准模式在同实例、同模型、同 provider 下 `tools=26` 且真跑了 pwsh**（1 轮 2 步列出目录）。所以不是宿主、不是 LM Studio、不是模型能力，是我们 preset 的工具面没组装起来。
  - 01:51 二分实验留下的**事实**：新会话里 `tools=16`，16 个全是内置工具，`run_device_action` 与 `report_task_status` 都不在。
  - **上一轮记在这条下面的两条归因，同日撤回**（依据 [upstream-plugin-forms](migration/upstream-plugin-forms.md) 三）：①「内置 `@deepseek-ai/dsh-*` 名作为 preset 子项能解析、profile link 的外部插件名不能」——那一次**同时变了两个量**（plugins 集合 + 旧会话换成新会话），而官方口径是「声明只影响之后创建的 Agent；现有会话保留其启动时的 plugin revision；改动要在新会话里验」，单是「换新会话」这一项就足以解释此前连 `tools` 键都不存在；②「裸 `- name:`（无 id）子项产不出工具、子项必须带自己的 id」——与 `@deepseek-ai/dsh-agent-preset` README「子插件可省略行 ID，由 Loader 分配」直接冲突，差异原因未定性。**阻塞点重登记为 G30**，判据改用官方给的活门禁（roster 的 `enabled`/`fiberPhase`/诊断文本、`cordis_inspect_query` 的 `Tool` 项、`inspectCompositions()` 的 leakedServices），不再靠 LLM wire 反推。
  - 插件自身侧全部就绪（临时探针实测后已撤）：`apply()` 会被调用、注册到 2 个 tool disposer、Config 七个键全生效（含 preset inline 的 `actionServerCommand`）、`dsh plugin --profile web list` 显示 link 已装、`dsh --dump-config` 合成形态正确（`--dump-config` exit 0、无 unmatched-patch 警告）。
  - 声明面否掉两个猜测：`dsh --dump-config-schema` 的 `$defs/config97`（`@deepseek-ai/dsh-agent-preset` 的 config）**确实声明了 `plugins`**，且 `required: [id, plugins]` —— 我们的子挂载形态合法，不是「字段不认识」。
  - **取证方法（下次直接用）**：web UI 那个输入框是 Lexical，`fill` 无效；真实 click 建立选区后 `execCommand('insertText')` 才写入，且**不要在写入的同一次调用里回读 textContent**（会误判成没写进而重复注入）。发送用 `evaluate_script` 里按 aria-label 找按钮 `.click()` 最可靠——`click(uid)` 的 uid 会被同批改 DOM 的操作弄过期，我们因此白丢过两次发送。
  - 顺带证实：D5 重启后会话从磁盘恢复可用；`agent-preset-registry default: autogamer` 生效（新会话预设自动是 AutoGamer）；mock action server 的 PNG 截图被插件解析成 1080x2400（坐标修复的 live 证据）。
  - ②效果验证 / ③闸门阻塞 / ④Inbox 连发 **仍未测**——它们都以「我们的工具真在面上」为前提，被上面这条外部插件解析缺口挡住。
- ✅ **本轮 live 连带的两个缺陷修复**（都先实测再修，配锁死测试）：`coord.ts` 的 `byteAt` 自己调自己，`parseImageSize` 对任何输入都栈溢出，截图取尺寸这条路本来就是死的；`apply()` 里 `if (config.screenSize)` 被判据骗过——Schemastery 把未配置的可选 tuple 归一化成**真值 `[undefined, undefined]`**，于是默认配置下的坐标一路 `NaN` 发给 action server 还报成功。修法是把判定导出成 `configuredScreenSize()` 纯函数并在 `tests/apply.spec.ts` 里断言 action server 真收到的坐标（删除实验：退回旧判据 ⇒ 2 条红，实测打出 `[null,null]` 形态的 payload）。
- ✅ **联网调研上游插件形态（2026-10-10，正文见 [upstream-plugin-forms](migration/upstream-plugin-forms.md)）**：逐字读了 `editing-cordis-compositions` / `cordis-plugin-development` / `cordis-composition-reference` 三个官方 skill、`agent-preset` 与 `agent-preset-registry` 的 README、`core/scope` README、`mount.ts` 源码，以及 shipped `presets/minimal.patch.yml` 与 `standard.patch.yml`。对本方案有决定作用的三条：①preset 只能由 **bundle 补丁**承载且要经 `plugin_manager install_bundle`（官方明令禁止手写 profile 的 package.json / cordis.patch.yml）；②**声明只影响之后创建的 Agent**，现有会话保留其启动时的 revision；③`mountRevision` 对「行激活失败」与「服务泄漏进 root realm」都是**拒绝整个 preset 挂载**（源码 `mount.ts:193,212-213`）。据此修订 D7、新增 D16 与 G30，补 S5 注册可见性与 S8 版本差。
- ✅ **守则已成文（[plugin-contract-rules](migration/plugin-contract-rules.md) R1-R19）**：把这次调研与踩坑换成「每条都带出处口径和可执行判据」的红线。其中三条专门防我再次自伤——R6 每次改 patch 必须 `--dump-config` exit 0 且 grep 不到 unmatched；R7 复验前必须证明会话创建时刻晚于本次生效，否则该轮不作数；R9 判「生效」只认官方检查器（install 的 `application`/`warnings`、`list_plugins` 的 `enabled`/`fiberPhase`、roster 诊断、`cordis_inspect_query`、`inspectCompositions`），**不认**日志、进程列表、`dsh plugin list`、也不认 wire 反推。据此把 D7 重写为三层（并纠正上一轮两处误判：`--patch` 其实是 `dsh --help` 明列的官方 overlay；侧边栏「插件」面板能 install/enable/disable/retry，不是只读页），另加 D17 与 G31
- ✅ **未读清单已读完并回填（2026-10-10 第二轮，守则 R13-R19 成文）**：逐字读完 `references/practices.md`（官方列为「选扩展点前必读」）、`host-plugin.md`、`ui-plugin.md`、`user-actions.md`、`verification.md`、`docs/cookbook/adding-a-tool.zh.md` 与 `packages/core/tools/README.zh.md`。据此新增七条硬约束并改写 S3/S4/S5/S6/S9/S11/P3：扩展点按「够用即最弱」（R13）、宿主已有「只读并发 / 变更独占按提交序」的调度约定（R14）、**`timeoutMs` 只是声明、注册表绝不强制执行**（R15）、不许自写会话事件类型而要走 `presentationMeta`/投影（R16）、`inject` 不唤醒而 `followup` 唤醒（R17）、UI 只能进 slot 且禁止 import 宿主 Client 包（R18）、展示元信息与图标是义务且授权类动作永远 user-only（R19）。同时**否证了我自己的一条假设**（「裸 schema 注册必须经 `defineTool` 包装」——官方 MCP 路径就是拿 server schema 直接 `register()`）。新开 G32/G33/G34 三条实现差集，G31 按 CLI 证据收口
- 🔶 **G30 定性的下一步（全程按守则，不再碰浏览器输入框）**：① 先把 `inject: ["tools"]` 改成可选注入（practices 第 20 行原话：可选服务放进 `inject` 或 `ctx.inject([...])`，让插件在缺该服务的 profile 里**不激活而不是抛错**）——按 R8 的 fail-fast，一次抛错会连坐整个 preset，这是当前头号候选；② 在 `preset-autogamer` 的 plugins 里加 `tool-plugin-manager`（照官方 shipped 写法 `disabled: !!js '!ctx.get('profileContext')'`），让 agent 能自装、能自查；③ 用 roster 诊断与 `cordis_inspect_query` 的 `Tool` 分流「preset 整体被拒」还是「inner 单项问题」；④ 若 `inspectCompositions()` 的 leakedServices 非空，按 R8 把插件包进 `cordis:group` + `isolate`。每步前置都是 R6 的 dump-config 自检 + R7 的新会话
- 📌 **S2 spike 处置（R2' 决定）**：artemis-worker producer spike **移入 R1 回退件**——R2' 主路径不 spawn py worker job（「任务=job」映射由「turn 内动作序列 + MCP 直连」取代，已由 MCP 直连 spike 覆盖）；仅当直通质量 spike 失败、回退三段式双跑时才执行原 S2 spike
- ✅ **host/client 双端定论**：一期纯 host 插件（安装流已验证）；client 侧 spike 推迟到 P3 需要自定义 toolview 时

## 六、文档索引

| 文档 | 内容 |
|---|---|
| [README](migration/README.md) | **入口页**：按「你要做什么」给阅读顺序，并列出哪几处文档别当真 |
| [registry](migration/registry.md) | **编号唯一权威**：D1-D17 / S1-S11 / G1-G34（含 14 条已关闭）/ R1-R19 一览，外加 `inventory/*` 与本文的 **G 编号撞车冲突表**。新增编号先登记到这里，`scripts/check_doc_registry.py` 守着 |
| [glossary](migration/glossary.md) | 术语翻译表：宿主黑话、Cordis 概念、本项目自造词，以及 **`inject` 的两个意思** |
| [upstream-rethink](migration/upstream-rethink.md) | 上游 google/artemis 三张调用面研究 + R2' 基线论证 |
| [dsh-verification](migration/dsh-verification.md) | DSH 0.2.0-rc.2 源码核实（48 假设/12 修正 + 19 项防重复自建 + turn shim + 主流范式 + 业界约束模式，§一~八） |
| [feature-inventory](migration/feature-inventory.md) | fork 现状防丢失盘点（inventory/01-05 明细；队列控制台部分已随 R2' 降级为 fork 场景遗产，设备/智能栈部分为上游 canonical 契约） |
| [upstream-plugin-forms](migration/upstream-plugin-forms.md) | 上游公开文档与源码调研第一轮：插件 / preset / 工具形态的官方口径（D7 改写、D16、G30 的依据），含本轮收回的两条错误归因与官方活门禁判据清单 |
| [plugin-contract-rules](migration/plugin-contract-rules.md) | **插件契约守则 R1-R19**：每条带出处口径与可执行判据，动手改插件 / preset / patch 前先对照；R2 分三层看改配置、R7 复验必须新会话、R8 realm 与 fail-fast、R9 只认官方检查器、R13 扩展点按「够用即最弱」、R15 `timeoutMs` 不执行、R16 会话写入边界、R18 UI 走 slot、R19 图标与授权红线；并记录了三处对本文档早期判断的自我纠正 |
