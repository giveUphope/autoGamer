# TODO · 待办（2026-10-14 已清空，待新方案）

> 2026-10-14 起旧待办一次结清：已完成的 P4 物理收缩阶段 A/B 归档为 CHANGELOGS **#71**，
> 未完成的 10 个差距与 P4 阶段 C/D 直接放弃（去向同见 **#71**）。
> 新方案待用户提供；收到后按守则 R22（查文档 → 写方案 → 才写码）先落自足条目再实现。
> 编号查 [registry](migration/registry.md)，词查 [glossary](migration/glossary.md)，
> 导航查 [导航](migration/README.md)。

## 零、当前状态（2026-10-14 清空，待新方案）

- 当前无未关闭差距、无进行中里程碑。本节是状态唯一权威；编号范围只查 `migration/registry.md`，不另抄。
- 旧账去向：P4 A/B 归档与放弃清单见 CHANGELOGS **#71**；分支 `dsh-plugin-contraction` 未推送，
  `pre-contraction` 为收缩前基线（`3fab0ee`）。
- 下一步：等新方案文本到达，按 R22 落条目。

## 一、最终形态

已清空，见「零、当前状态」。产品方向暂以第二节与第三节的冻结基线为准，新方案到达后改写本节。

## 二、决策记录（冻结基线，D1-D18）

2026-10-14 冻结：清空时保留作基线，新方案到达后按 R22 修订。

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
| D17 | 自举引入 | 给 `preset-autogamer` 挂 `@deepseek-ai/dsh-plugin-manager/tools`（官方 shipped preset 里该行的 disabled 写作 `!!js '!ctx.get('profileContext')'`，即 UI 会话中可用），让 AutoGamer agent 能对自己执行 `install_bundle`。这是上游「让 Agent 给自己造插件」的现成路径，也是把引入流从手工迁到自动的落点；执行细节与红线见 [守则 R2 / R9](migration/plugin-contract-rules.md)。**2026-10-12 已落地**：preset 的 plugins 加 `- id: tool-plugin-manager`，`disabled: !!js "!ctx.get('profileContext')"`（**先写成 `false` 是错的，见 CHANGELOGS #26**：服务行 `plugin-manager` 自己就是 `!ctx.get('profileContext')`，工具行无条件开会要求一个不存在的服务，而缺服务按 D16 拒挂整条 preset；官方 Creator preset 用的正是这个表达式）（**不是**原设想照抄 `!!js '!ctx.get("profileContext")'`——官方 README 给的启用形状就是 `disabled: false`，且写明「Preset-backed sessions use their preset's tool-plugin-manager entry」；shipped `standard`/`ptc` 都是 `disabled: true`。⚠️ 但「照抄 `false`」的写法已在 #26 修成跟随服务条件）。live 已证：R7 新会话工具面从 5 个变 7 个、多出 `plugin_manager` 与 `skill`。⚠️ 代价按官方原文记在案：「installed Host code executes in-process outside the workspace sandbox」，且 plugin_manager 的**每个**动作（含 list_plugins/list_bundles）都要 danger-full-access 或该次审批；本仓库不替用户放宽权限模式（R19）。 |
| D18 | 长期技术栈方向 | **用户 2026-10-12 定：以 TS 为主，py 仅在「特定库成熟度高于 TS 同类库」时保留**（典型如 adb/uiautomator2 等设备库、视觉/CV 库）。新增与重构逻辑默认落 TS；py 是「库成熟度占优」的例外而非默认。本次 P4 收缩**不触发** py→TS 重写，只把保留 py 压缩到最小设备能力面（动作为主、零智能栈），作为未来 TS 迁移前的可验证基线。是 D8 之后的演进方向，不改变 D8 当下的动作面保留 |

## 三、对接语义（冻结基线，S1-S11）

2026-10-14 冻结：清空时保留作基线，新方案到达后按 R22 修订。

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
- **与宿主并发约定对齐（守则 R14）**：官方已经规定「独立只读调用可并发，变更类调用独占执行并按提交顺序」，所以我们只补「同一设备跨会话串行」这半边；`take_screenshot` / `get_ui_hierarchy` 已声明为可并发，字段名为 `isConcurrencySafe`（`@deepseek-ai/dsh-tools` 类型原文，G33 落地时从已安装产物取得）

**S4 设备熔断（状态在插件，拒绝出口用 guard）**
- closed →open（连续环境级失败 ≥ allowed_fails，工程默认 1）→ half-open（下一条真实消息动作即探测）→ 成功 closed
- 环境级判定（R2' 改写）：**工具层错误分类**——action server 连接失败/adb 不可达/设备离线/锁屏 = 环境级；模型语义失败 = 任务级；枚举不确定→继续熔断（fail-safe）、探测失败→不挂（fail-open）不对称保留
- **冷却期的拒绝走 `ctx.tools.guard()`**（守则 R13：它是加在 `tools/pre-execute` waterfall 之后的单调同步守卫，后续监听器无法把拒绝翻回允许，且不受注册顺序影响）；只有需要 await 的决策才在 `tools/pre-execute` 返回 `ask`。官方原文「尽量不要把部署策略内建到工具中」，所以熔断**状态**归插件、**拒绝出口**归 guard
- 挂起期间新消息保留在 Inbox（QueueDock 可见）；解除矩阵（旧 inventory/01 四路径的无队列映射，矩阵轮定稿）：
  ①探测成功关（`recordSuccess`）②冷却到期半开（单探测，`probeInFlight`）③探测环境失败重挂新窗（非永久，时间必再开；
  此处的 fail-open 指**判定失败**——internal/unknown 不记（G38）——而非探测失败）④新提交/显式 resume**不旁路**健康态
  （与旧世界及本条旧句的显式偏差：健康态非批次态；半开保证冷却后首动作即探测，消息永不饿死；旧 resume 为逃永挂而设，
  此处无永挂故不需要）；cancel 不碰健康态（中止无健康信息；重启即 fresh breaker = 旧 stop 效果）。
  省略/空 serial 一律落 `defaultDeviceKey`（`deviceKeyOf` 三处同源）；`allowed_fails` 默认 1（contracts 锁死）。

**S5 执行层契约（py action server，原样复用）**
- 载体：`artemis mcp --server adb` 动作面（13 工具：tap/long_press/swipe/back/launch_app/stop_app/open_link/focus_and_input_text/focus_and_clear_text/erase_one_char/press_key/take_screenshot/get_ui_hierarchy）
- autogamer TS 工具内部作 MCP client 转发（**不裸用 dsh-mcp-client patch**——会绕过闸门）；进程由插件生命周期管理
- env 极简（对齐上游容器契约）：`ADB_DEVICE_SERIAL`/`ADB_HOST/PORT/SERVER_SOCKET`/`ARTEMIS_HIERARCHY_BACKEND` + helper 相关
- 返回契约：ActionResult（`isError=False + ok=False` = 设备拒绝，观察非异常）；0-1000 归一坐标（G24）；**超时不许指望 `timeoutMs`**——注册表绝不强制执行定义里的它（守则 R15），现状是由 `ActionClient` 的 `Promise.race` 自实现并观测 `exec.signal`（主体前取消 = `ABORTED_BEFORE_DISPATCH`，主体后取消只能把成功换成 `ABORTED`，超时为 `TOOL_TIMEOUT`）；要交给宿主执行须挂 `dsh-tool-call-timeout-policy` 包装层，其入参官方文本未列（守则待补 2）
- **裸 schema 注册是合法形态，但前提是给的东西已经是完整 JSON Schema**（守则 R12/R13 补正 + G30 实证修正）：`ctx.tools.register()` 直接收 schema 定义，官方自己就这么接 MCP——「MCP 服务器发现工具后，用服务器的 schema 调用 `ctx.tools.register()`」；`defineTool` 是类型化 DSL 糖，**但命名 spec 映射 → object schema 的编译只发生在 `defineTool` 里**（`parameterSchemaSpecToJsonSchema`）。我们曾用命名 spec 直接裸注册，LLM API 以 `parameters.type` 非 `"object"` 拒绝整个请求（400）。现状：两处定义都走 `defineTool()`，object 节点显式 `additionalProperties`（G34）。代价照旧成立：**工具自己负责输入校验**，非空字符串、正数、跨字段也要自查——现在的 `target` / `text` / `key` 校验就是这部分
- **宿主服务依赖与图像结果（G36 实证）**：`inject` 是**属性 GET 的闸门**，不是启动偏好——没声明的服务读一下就抛 `cannot get property "attachments" without inject`（不是返回 undefined）。工具要让模型看图的正道：`ctx.attachments.saveImages([{data: Uint8Array, mediaType, name}])` 换内容寻址引用，结果 `render` 成 `[text 信封, image 块]`（官方 `read_image` 就是这个形状），**字节绝不进 value / 会话日志**；宿主会自行把图提升成带真实 base64 的后续 user 消息，**不需要**给 preset 挂 fs 或 `read_image` 去开那个只读路径。两个必踩的坑：provider 配置 `models[].input` 的 schema 默认 `[]`，而声明面口径是「absent=unknown，显式省略=负能力」，于是图被替成 `[image omitted because this model accepts text only]`——要显式写 `[text, image]`；附件准入有上限（单边 8192px / 64M 像素 / 单图 20MiB，宿主还会重编码成 JPEG），被拒时降级成文本而不是失败整个动作
- **注册可见性（G30，已定性并关闭）**：`ctx.tools.register()` 返回 disposer **不等于 Agent 能看见该工具**——真正的坑不在 scope，而在**注册的生命周期**：cordis `effect()` 是「回调立即执行、返回值才是清理函数」，把 teardown 当回调体传进去，工具就在注册后数毫秒内被自己注销，而 roster/插件页/清单一切正常（G30 根因 ①，changelogs #10）。判「生效」仍只认官方检查器（`cordis_inspect_query` 的 `Tool` 项、roster 的 `enabled`/`fiberPhase`/诊断、`inspectCompositions()` 的 leakedServices），但**最快的一步是插件侧 wire 差分**：看新会话里「哪几个工具在/不在」，比读挂载诊断收敛得快

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

## 四、差距清单（2026-10-14 起暂无未关闭项）

暂无未关闭差距。旧表 10 项的去向见 CHANGELOGS「已关闭差距史」（9 项放弃 + G36 行同步 UI 侧放弃），编号权威仍是 [registry](migration/registry.md)。

## 五、文档索引

已清空，改读 [导航](migration/README.md)（导航唯一权威）。
