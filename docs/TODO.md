# TODO · DSH 插件化迁移方案（R2' 定稿）

> 活文档：已完成条目直接删除，演进依据查 git 历史。
> 本方案于 2026-10-09 经七轮源码核实与两次方向重构后定稿：**基线 = google/artemis 上游实现**（本仓库为其 fork，智能栈基本未动；领先提交数**别写死**，复测：`gh api repos/giveUphope/autoGamer/compare/google:artemis:main...main --jq .ahead_by`，2026-10-10 实测 83，另有本会话未推送的提交），路径 = **直通插件**。论证过程与历史版本：git log + [upstream-rethink](migration/upstream-rethink.md) + [dsh-verification](migration/dsh-verification.md) + [feature-inventory](migration/feature-inventory.md)（含 inventory/01-05 明细）。
> 变更工作流（AGENTS.md 习惯）：用户确认方案后，先把方案 spec 落到本文件一条自足条目（做什么 / 怎么做 / 怎么验 / 什么算合格）再开工；每个检查点完成后随手勾选更新，保持过程与方案一致，避免来回翻代码核对。顺带发现的问题按归属留痕——未修的进差距清单并按 registry 编号，已顺手修复的记入 CHANGELOGS.md（本文件至多留一行指针），不允许只留在对话里。

## 零、当前状态（先读这一页，细节在后面的节）

| 项 | 现状 |
|---|---|
| 阶段 | **P0 收官（2026-10-11 深夜）**：G45 指令投递接线完成（CHANGELOGS **#14**），flash 契约真的进了 system（4052 字符、起于第 50 字符）；真机 spike 重跑 **T1 17s/5 步、T2 22s/7 步，两个任务全部达成**（基线 77.2s/6 步、42.1s/3 步；接线前 T2 是 47 请求失控人工停）⇒ **D9「直通」在执行质量这一维成立**。**终态语义也已闭环**（CHANGELOGS **#15**）：`concludeTurn()` 拿到 live 证据（G41 ✅）、未汇报回合的兜底追问端到端可用（G44 ✅）、T1 重跑 8 次动作全用 `{index:N}` 句柄零坐标回退（G42 再证）。骨架 / 离线 spike / 安装流 ✅，**conformance 已吃真实 runtime（G5 结案，CHANGELOGS #29）**，S10 四点 ✅。**G46 当日撤回**——拿 wire 请求体推断「没汇报」是错的，据此立守则 **R24**：判「没发生」只认会话日志 |
| S10 ①（工具面 + 模型稳定性） | ✅ 通过（2026-10-10，G30 关闭，双根因见 changelogs #10：`effect()` 语义反转自注销 + 裸注册未经 `defineTool()` 编译）。R7 新会话里模型真实调用 `run_device_action` 三次、入参合法、按次调整重试；「没有这个工具」与 400 签名全部消失 |
| S5 动作后端 | ✅ 真机 live（2026-10-10）：`py action server` + MuMu `emulator-5554`，`take_screenshot` 一次调用即成（`captured 1600x900`，回合 10s / 1 轮 2 步）。mock 后端超时那条已被真机取代 |
| live 环境（本轮固化） | `spike/web-live.patch.yml` = **交付形态**（`autogamer-device-inner` + `@deepseek-ai/dsh-tool-jobs`，G37 已收）+ 真机 `actionServerCommand`/`actionServerEnv` + provider 端口走 1235 取证代理（`scripts/dump-proxy.mjs` → LM Studio 1234）+ **`models[].input: [text, image]`**。R6 实测 exit 0 / 0 unmatched。旧结论「`actionServerEnv` 无法解析」（c8b49c8 删过它）作废 |
| 下一步（按序） | **1)** **G52 已结案**（正文见 CHANGELOGS **#32**：追问路径改由真实 `dsh-session` 提交的真 `turn/end` + 真实 `AgentRegistry` 句柄驱动，`{global:true}` 的筛选在 Tier 1 里被观察到；顺带摘掉追问消息的手镜像）。本轮新立 **G56** 已结案（CHANGELOGS **#35**：mock 补 `jsonrpc` 帧字段，真 SDK 握手通过）、**G57** 已结案（CHANGELOGS **#34**：裸 scope 注册本就生效，旧「双空」是无 scope 读法，root 空是隔离语义）。**2)** **G43**：spike 的复位与判据要固化成可复跑脚本（`ui_night_mode` 不作 oracle，只认截图）——P1 要跑更多任务就会撞它；**3)** 低成本债：G33（策略从工具正文迁 guard/pre-execute）；G34/G38 已结案（CHANGELOGS **#33**）；**4)** CI 侧：G53（前端 lockfile 全镜像 URL 令 `check_dependency_sources` 红）、G54（本 fork `on: push` 从不触发 run；任何「CI 证据」必须写明是手动派发）、G55（`check_dependency_sources.py` 不合 `ruff format`）；**5)** P1 开工：pro subagent（checker/validator 保真）+ skills 严格度梯级 + 熔断矩阵，注意 `check_ui_change` 的阈值与 ROI 已是现成判据，validator 升级梯直接建在它上面；**6)** 两条未闭环的证据/观察（不当结论用）：从零走通 DSH `install_bundle` 的完整成功还没拿到（G51 收尾）；同一份 dist 在 23:12 那个服务实例上两轮没触发追问、23:38/23:47 稳定触发。**已完成不再列**：G31/D17（#18/#20/#26）、G45（#14）、G47-G51（#19-#25）、G35（#16）、G32（#17）、G5（#29）、G52（#32）、G34/G38（#33）、G57（#34）、G56（#35）。 |
| 每步的前置 | R7（**开新会话**再验，旧会话不重读声明）；改 patch 后仍跑 R6，但 **R6 只合成声明树、不挂载 preset，过 R6 ≠ preset 能挂**——判定挂载只认 roster `broken` 与 `cordis_inspect_query`（R9）。G30 这轮换来的额外一条：**插件侧 wire 差分（哪几个工具在/不在）比挂载诊断更快收敛** |
| 已顺手修掉 | 两个 live 连带缺陷（`coord.ts` `byteAt` 递归、`screenSize` 真值陷阱）已修复，记录见 changelogs #9 |
| 测试面 | 插件 vitest **83 passed / 1 skipped**（复测：`pnpm --config.verify-deps-before-run=false test`；G52 净增 5 条真 runtime 追问证据；Tier 1 真 runtime 挂载 6 条 + 契约改写与复审守卫 6 条；复审轮的四条发现与修法见 CHANGELOGS **#28**；Tier 1 两条**变异校验**——`inject` 多写一个本图没有的服务 ⇒ 挂载红、摘掉 `Config` 导出 ⇒ reject 红；Tier 2 变异——映射值改成不存在的工具名 ⇒ fixture 档与 live 档都红；skipped 那条是 `AUTOGAMER_CONFORMANCE_PY=live` 的 opt-in 真服务比对，CI 用 `node scripts/spike-mcp.mjs` 做同一比对；CI **新增 `plugin-contracts` job**（ubuntu + windows，装真实 `@deepseek-ai/*` devDeps 后 build + test），此前插件测试从未进过 CI——现已实测双 OS success（run 38167498398，手动派发，见 G54）；存量：交付形态同步守卫 3 条 + 结果信封层级预算 2 条；R23 的「必须推迟出 append 边界」与 G42 的「层级不被 200 字符截断」都已做**变异校验**——把 followup 改回同步、把 `RENDER_HIERARCHY_BUDGET` 改回 200，对应测试确实变红）；py `tests/unit/mcp` **224 passed**（动作面 14 工具）；文档门禁 `scripts/check_doc_tables.py`、`scripts/check_doc_registry.py`。同一轮复审**记下但本轮未做**的测试债（都不是产品差距，不占 `G*` 号）：`apply.spec.ts` 里四份重复的注册装配（`registeredTools` / `registerToolWith` / `reportWith` / 内联）应收敛成一个；`fakeContext` 的 `agentId` 形参与 `emit(type, id)` 的 id 形参没人用，`index.ts` 里「拿不到 agent handle」那条 warn 分支也从未被走到；py 侧 `adb_server.py` 的 `coordinates`→ROI 转发与「帧解码失败」两条分支无行为测试（现有测试绕过 FastMCP 直接 `mcp.call_tool`）；整套 8.4s 里几乎全是真实 `EFFECT_SETTLE_MS` 睡眠，换假定时器能顺带把「settling 时机」本身锁住 |
| 读不动时 | 编号查 [registry](migration/registry.md)，词查 [glossary](migration/glossary.md)，进哪份查 [导航](migration/README.md)，动手前查 [守则](migration/plugin-contract-rules.md)（**R20：遇 DSH 行为问题先查官方一手资料，别先写猜测实现**） |

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
| D17 | 自举引入 | 给 `preset-autogamer` 挂 `@deepseek-ai/dsh-plugin-manager/tools`（官方 shipped preset 里该行的 disabled 写作 `!!js '!ctx.get('profileContext')'`，即 UI 会话中可用），让 AutoGamer agent 能对自己执行 `install_bundle`。这是上游「让 Agent 给自己造插件」的现成路径，也是把引入流从手工迁到自动的落点；执行细节与红线见 [守则 R2 / R9](migration/plugin-contract-rules.md)。**2026-10-12 已落地**：preset 的 plugins 加 `- id: tool-plugin-manager`，`disabled: !!js "!ctx.get('profileContext')"`（**先写成 `false` 是错的，见 CHANGELOGS #26**：服务行 `plugin-manager` 自己就是 `!ctx.get('profileContext')`，工具行无条件开会要求一个不存在的服务，而缺服务按 D16 拒挂整条 preset；官方 Creator preset 用的正是这个表达式）（**不是**原设想照抄 `!!js '!ctx.get("profileContext")'`——官方 README 给的启用形状就是 `disabled: false`，且写明「Preset-backed sessions use their preset's tool-plugin-manager entry」；shipped `standard`/`ptc` 都是 `disabled: true`。⚠️ 但「照抄 `false`」的写法已在 #26 修成跟随服务条件）。live 已证：R7 新会话工具面从 5 个变 7 个、多出 `plugin_manager` 与 `skill`。⚠️ 代价按官方原文记在案：「installed Host code executes in-process outside the workspace sandbox」，且 plugin_manager 的**每个**动作（含 list_plugins/list_bundles）都要 danger-full-access 或该次审批；本仓库不替用户放宽权限模式（R19）。 |

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

## 四、差距清单（现行有效；已关闭项随定稿移除，见 git 历史）

| # | 差距 | 状态/调整 |
|---|---|---|
| G3 | auto-serial 闸门缺口 | 保留：工具内调度——显式 serial 队列 + auto 空闲池（含 parking 语义 G28） |
| G4 | 熔断探测体 | 保留：S4 已定（下一条真实消息动作 = 探测；不对称策略保留） |
| G53 | 前端 lockfile 全镜像 URL 使 `check_dependency_sources` 门禁红 | 保留（**既有状态**，非插件轨道引入；CI 首次真跑才暴露）：把 `apps/showcase_ui_v2/package-lock.json` 的 `resolved` 重取为 `https://registry.npmjs.org/...` 再复跑门禁 |
| G54 | 本 fork 的 `on: push` 从不触发 workflow run | 保留：**两次 push 零 run**（`a4a0f44..5232265` 与 `5232265..1d24416` 之后 `total_count` 仍为 1，唯一那次是 `workflow_dispatch` 且 `head_sha` 是前一个提交，排除去重解释），只有 `gh workflow run` 起得来；Actions `enabled:true`、workflow `state:active` 都不管用——查清是 fork 开关、计费还是提交邮箱之前，任何「CI 证据」必须写明是手动派发 |
| G55 | `scripts/check_dependency_sources.py` 不合 `ruff format`，CI 的仓级格式检查必红 | 新开（2026-10-12 做 #31 时顺手实测，既有状态、与本轮改动无关）：`uv run ruff format --check scripts/` ⇒ `1 file would be reformatted`（`check_dependency_sources.py:55` 那一行过长），而 `.github/workflows` 的 `python-quality` job 跑的是 `ruff format --check .` ⇒ 该 job 必红。修法一条命令：`uv run ruff format scripts/check_dependency_sources.py`。与 **G53**（同一脚本的**运行时**门禁红）是两件事，别合并关闭 |
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
| G33 | 策略内建在工具正文里 | 新开（守则 R13）：熔断冷却拒绝、审批与超时判断现在都写在 `run_device_action` 正文内，与官方「尽量不要把部署策略内建到工具中」相反。迁移方向：单调拒绝改 `ctx.tools.guard()`、需要 await 的改 `tools/pre-execute` 返回 `ask`、结果观测改 `tools/result`，并显式声明并发安全属性（字段名待 `cordis_inspect_query` 取，见守则待补 4） |
| G36 | 截图媒体展示缺口 | **模型侧已关闭（2026-10-11，changelogs #11）**：`take_screenshot` 现在把字节交给 `ctx.attachments.saveImages`，结果 render 成 `[text, image]`，宿主把它提升成带 base64 的后续 user 消息，模型答出了只有像素里才有的信息（壁纸主题 + 本轮真实时刻 17:06）。**剩 UI 卡片侧**：官方形态要求工具注册**按 key 的 client toolview** 并声明 `tool.call.images` 子槽，而宿主 `presentCall`/`presentResult` 永不进客户端（R18），generic 兜底只有压平文本 → 归 **P3** 与 toolview 一起做。另记：`presentationMeta` 官方只持久化 `{path}` 一类小元数据，引用本身在 content 里，不重复存（R16） |
| G43 | spike 复现脚本的复位与判据不可靠（`settings put ui_night_mode`） | 新开（2026-10-11）：用 `adb shell settings put secure ui_night_mode 1` 复位深色主题**并不生效**——写完后屏幕仍是深色，于是同一轮里 `settings get` 读到 1 被当成「任务未达成」，而模型看图说的「开关已开」其实是对的。**判据错会把成功记成失败、把失败记成成功**。修法：spike 的初态复位一律走 UI（真的点开关），达成判定以截图为准，`settings get` 只作旁证 |
| 已关闭 | **全部结案条目的正文与关闭方式已移至 [`CHANGELOGS.md`](CHANGELOGS.md) 的「已关闭差距史」**（编号权威仍是 [registry](migration/registry.md)）。本表只列未关闭差距 | 结案即从本表移除，不留正文 |

## 五、Checklist（R2' 里程碑）

- [x] **P0 骨架与 spike**：`autogamer-device` 包骨架（run_device_action 工具骨架 + 闸门 + preset；`cordis.patch.yml`/peerDependencies/`dsh plugin add`/`--dump-config`）+ **S10 四点 spike**（模型稳定性/效果验证/闸门阻塞/Inbox 连发）+ **MCP 直连质量 spike**（flash skill + py action server 跑 2-3 个真实设备任务，对比上游 flash 质量——spike 过=直通，不过=回退三段式）+ conformance 测试骨架。**2026-10-11 收官**：四点 ✅、质量 spike 两任务达成且快于基线（D9 = 直通，CHANGELOGS #14/#15）、终态语义 live 闭环（G41/G44 ✅）。**P0 遗留的只有「怎么装」**：`install_bundle`（G31）与 D17 的 `tool-plugin-manager`
- [ ] **P1 设备工具与路由**：13 动作工具 TS 包装全量（闸门/熔断/效果验证/路由决策日志）+ **pro subagent**（checker/validator 保真，盘点 04 清单验收）+ skills（flash prompts 转化 + plan/goal 脚手架 + 严格度梯级）+ 熔断矩阵（4 解除路径/fail-open-safe 不对称/auto 端点默认键/allowed_fails=1）
- [ ] **P2 设备层补全**：helper TS 复刻（D13/G25）+ 录屏接回（D12/G23 契约 + graceful stop）+ mock driver + 诊断 admission（锁屏 fail-closed/多设备切换/emulator_manager 对接）+ 模拟器专属演进评估
- [ ] **P3 UI 收尾**：roster/QueueDock 验收对照 + toolview + goal 轮徽标（按需）。toolview 只能走 client 插件（守则 R18）：在 keyed slot `tool.call.toolview` 按 **wire 工具名**注册组件，Web Client **不消费** `presentCall`/`presentResult`，只定义 Host 展示方法不会增加专用卡片；factory 无副作用、样式只用 `--dsh-alias-*` token、**禁止 import 宿主 Client 包**（要像就拷贝 markup/CSS/行为并加自己的类名前缀），不许另建 presenter registry
- [ ] **P4 旧线归档**：旧控制台原地只读 + py 遗留退役清单（artemis-client 删/replay_manager 删/CLI `artemis run` 非 worker 分支与 `trace`/`batch` 退役/webhook 按需）+ quality_ratchet/locale 锁**显式不做**（记录为有意撤除）
- [ ] **一期改造登记**（对既有模块的任何修改先登记）：① py 侧零改动为默认（mcp_server/驱动原样）；② 如需触碰（如录屏工具），逐项登记并说明豁免理由。**已登记 1 项**：`compare_ui_frames` 只读工具（G39 路线 A，2026-10-11 确认），见上一节

### S10 ② 效果判定落 py 动作面（G39 裁定 = 路线 A，2026-10-11 用户确认）

- **What**：把「动作后屏幕是否变化」的判定移到 py 动作面，复用仓库里已有的 `artemis/utils/image_diff.py::check_ui_change`，
  让 TS 侧只负责取帧与路由。交付物：① `artemis/mcp/action_server.py` 新增**只读**工具 `compare_ui_frames`
  （入参 before/after 的 base64 + `action` + 可选 `coordinates`，返回 `{changed: bool, ratio: number}`）；
  ② `artemis/mcp/action_manifest.py` 登记该工具名并纳入能力门（与 `take_screenshot` 同一档）；
  ③ TS 侧 `captureFrame` 改调该工具，删掉 `src/frame.ts` 里失效的 PNG 差分（保留 600ms 沉降与 changed/unchanged/unknown 词汇）；
  ④ conformance 的 13 工具快照更新为 14。**范围外**：validator 升级梯、`wait_for_screen_stability` 的轮询语义（P1 再谈）、
  任何对 `image_diff.py` 本体的修改。
- **How**：判定是**设备层事实**不是展示层，且上游阈值口径要保真（盘点 04 / G27）。关键事实：`check_ui_change` 在本 fork 里
  **没有活调用点**（只有定义 + `tests/unit/agents/test_validator.py` 里的 mock），所以它的语义权威就是那份测试与函数文档串：
  遮状态栏 10%/导航栏 5%、全屏比例阈值 1e-4、tap 类走按屏对角缩放的 ROI（50px，最小 15px）、**解码失败按「有变化」兜底**。
  新工具**不自己截图**——上游刻意把 actuation 与 observation 拆开（`observation.py` 模块注释），取帧时机归 TS（它持有闸门与沉降）。
  豁免理由（D8「一期改造登记 ②」）：纯新增只读面，不改任何既有工具的行为与返回契约；真机 `take_screenshot` 回 JPEG，
  TS 侧无 cv2/PIL 等价物，自己复刻等于长期背两份同一算法。
- **Verify**：py 侧 `uv run python -m pytest tests/unit/mcp -q` 新增用例（同一帧→False、半屏翻转→True、
  tap ROI 命中→True、坏字节→True 且 ratio 语义不变、能力未开时不出现在 tools/list）；
  `uv run ruff check`；插件侧 `npm run test`（把 frame 相关锁测改判为「调用 py 工具」的形状）+ `npm run build`；
  R6 声明面自检照旧；live 按 R7 开新会话跑一次 `back`，结果必须出现 `effect=changed`（当前是 `effect=unknown`）。
- **Done means**（2026-10-11 全部达成，见 changelogs #12）：[x] py 工具注册且只读；[x] 两份 pin 住的快照同步、conformance 14 工具绿；
  [x] TS 不再依赖 PNG 解码，真机正反两例 `effect=changed` / `effect=unchanged`；[x] 阈值与兜底语义原样继承 `check_ui_change`（3 条行为锁）；
  [x] G39 并入已关闭行。**偏差**：工具最终落在 `adb_server.py` 而非最初写的 `action_server.py`——插件消费的是 `--type adb` 那个面，
  内部面的改动已全部撤销。

### G44 重做 v2（2026-10-11 按 R22 三步序：查文档 → 本方案 → 实现）

**第 1 步「查」的原文与出处**（本轮实测否证了 v1 的"要另写 Host 插件"结论）：

- `packages/core/scope/README.zh.md:71`：「注册视图沿链**向下**继承……事件放行沿链**向上**扩展（标签为祖先的监听器收到分发到后代键的事件）」。
- 同文件 `:75` 事件筛选：「**无标签监听器放行**；有标签监听器仅当标签为分发键或其祖先时放行；`key === undefined` 只放行无标签监听器。**带 `{ global: true }` 的监听器绕过筛选**」。
- 本机 cordis 4.0.4 声明面 `lib/types/events.d.ts:98-105`：`EventOptions { prepend?, global? }`，`global` 注释原文 "Receive the event regardless of context filter checks."；实现 `lib/index.js:263` 派发处 `hook.global || !filter || filter.call(...)`。
- `docs/subsystems/session.zh.md:1301`：`session/event` 是 post-commit emit，且「Scope-filtered dispatch: agent-scoped listeners receive only events from sessions entered through that agent's context」。
- 对照实现 `packages/goal/goal-round-driver/src/index.ts`（root 层，`inject = ['agents','goals','sessions']`）。

**结论**：v1 收不到 `turn/end` 不是"必须换 Host 插件"，而是**监听器被 scope 筛选挡掉了**；官方给的开关是注册时传 `{ global: true }`。

- **What**：交付三件——① `session/event` 监听改为 `ctx.on('session/event', handler, { global: true })`；② 恢复 v1 回退掉的 `TurnLedger`（按 `ctx.agents.currentInitiator().id` 归键，live 已证身份可用）与有界 `followup` 追问；③ 追问消息源按 R17 在 `MessageSourceMap` 自声明 kind（不再用被 V4 拒绝的 `{kind:'plugin',plugin}`）。**范围外**：新建 Host 级插件（被上述原文否证）、goal 机制、UI 卡片。
- **How**：global 监听会收到**所有**会话的事件，所以按 `session.id` 归键并从事件本身判断（`tool/call`/`tool/result` 的 `tool` 名不算 acted——acted 仍以工具内记账为准，避免双写真相）；追问上限 1 次/agent，超出只 warn（防死循环，v1 设计保留）。
- **Verify**：**前置实验② 先做**——自声明 `source.kind` 能否过 session format V4（v1 从未走到这步）；`npm run build` + `npm run test`（假 ctx 的 `on` 要接 options 并断言 `{global:true}`）；live 按 R7 开新会话，探针字段 `lastEvent` 必须出现 `turn/end@session-…`，随后**不靠人工发消息**观察是否自动追问并补出 `report_task_status`；截图按 G43 定案。
**v2 实施结果（2026-10-11，如实记录）**：代码已落地并通过单测（62/62，含一条锁「监听必须以 `{global:true}` 注册」）。
 **live 仍是负结果**：R7 新会话跑一次 `back`（1 轮 2 步 / 6 秒 / 回复"好"），**没有第二轮、wire 里没有追问文本**——`{global:true}` 没能让 `turn/end` 到达。
 失败面已收窄到两个候选，**下轮先做这个判别**：把 v1 的 `lastEvent` 探针字段重新加回 `run_device_action` 结果（wire 可见），
 若 `lastEvent` 出现 `turn/end@…` → 事件到了，问题在 `agent.followup()` 被拒（最可能是自声明 `source.kind:'autogamer'` 未过 session format V4，即实验②）；
 若仍是 `tool/call@…` → `global` 选项在 preset 作用域不生效或被上层再筛，那就回到 v1 的 Host/root 层结论（本条上方的原文只保证"绕过 context filter"，未保证穿过 preset realm）。
 **本轮不再猜**：两个候选各需一次 live 判别，代码保持现状（未回退，因为它是被单测锁住、且判别只需加探针的完整实现）。

- **Done means**：[x] 代码与单测落地；[ ] 实验② 有结论并写回本条；[ ] 探针看到 `turn/end`；[ ] 追问恰好一次且模型补出汇报；[ ] **顺带补上 G41 `concludeTurn` 至今缺失的 live 证据**；[ ] G44 并入已关闭行、G41 转 ✅；[ ] 重跑真机质量 spike 作 D9 裁决。

### 宿主交互实现审查（2026-10-11，按 R21 三态：✅ live 已证 / 🔶 仅单测或声明面 / ❌ 猜测）

| 项 | 位置 | 依据 | 态 | 处置 |
|---|---|---|---|---|
| `ctx.attachments.saveImages` 与 `ImageAttachmentRef` 形状 | `src/dsh-types.ts` | `docs/subsystems/attachment.zh.md` + `packages/attachment/attachment/src/types.ts` 的 `SaveImageAttachment{data,mediaType,name}` | ✅ | live 实证附件落盘且模型收到像素（changelogs #11）。**残留风险**：`@deepseek-ai/dsh-attachment` 本机未装（npm 只有 0.0.1-rc.1），dsh-llm 的 .d.ts 引它 → tsc 静默放行，是类型盲区；升级宿主时优先核对 |
| `exec.concludeTurn()` 终结回合 | `src/tools/reportTaskStatus.ts` | `@deepseek-ai/dsh-tools` 类型原文 "The agent loop stops after committing this successful result batch" | 🔶 | 单测锁死，**live 未证**——模型至今不调 `report_task_status`（G44），所以这条从未被走到。G41 状态栏已注明 |
| `inject` 必须声明才能读服务 | `src/index.ts` | 实测抛 `cannot get property "attachments" without inject` + `docs/cordis-primer.zh.md:11` | ✅ | 已入 S5 |
| `session/event` 会送达 `turn/end` | 已回退 | 曾按事件名推断，live 只收到 `tool/call` | ❌→已清 | **猜测实现已全部回退**（不留死代码，插件侧回到 57/57）。正解见 R20：`session/event` 是 scope-filtered，agent-scoped 只听本上下文会话；回合边界要挂 Host 级插件（照 `goal-round-driver`） |
| `source:{kind:'autogamer', plugin:…}` 追问消息源 | 已回退 | 无任何依据自造字段；且 R17 明载 `{kind:'plugin',plugin}` 已被 session format V4 拒绝 | ❌→已清 | 随上条回退。**遗留未知**：自声明 `MessageSourceMap` kind 能否过 V4，换到 Host 层后先验（`docs/subsystems/scope.zh.md` 仍未读） |
| py 结果契约的字符串嗅探（`Success`/`Failed`/`Error executing tool`） | `normalizeOutcome` / `classifyMessage` | 实测 `--type adb` 面就是返回纯字符串（`adb_server.py` 各分支 `return "Success"`），非结构化 | ✅ 形态真实 | 但**按文本分类环境/任务失败很脆**，插件内部错误会被误记成 task 级——已登记 **G38**，与 S4 熔断语义同源 |
| 0-1000 ↔ 像素换算、PNG/JPEG 头取尺寸 | `src/coord.ts` | G24 契约 + live 双证（真机 1600x900、mock 1080x2400） | ✅ | 保留 |
| `#N` 编号可见元素列表 | `src/hierarchy.ts` | 先按 XML 猜（❌ 从未有测试）、后按实测 JSON 载荷重写 | ✅ | 现 7 条单测锁死 + live 两轮命中（`#28`/`#17` 达成 T2）。**旧 XML 解析器无测试正是缺陷存活原因**，已入 R21 判据 |
| `EFFECT_SETTLE_MS=600`、`RENDER_HIERARCHY_BUDGET=6000` | `runDeviceAction.ts` | 前者经验值（无官方依据）；后者实测（27 元素被 200 字符截断） | 🔶 / ✅ | 沉降时长待与真机动画时长对表；若出现漏判 `changed` 优先调它 |
| 设备闸门 WeakMap promise 链 | `src/gate.ts` | 官方样板 `tool-bash-persistent` 形态；已核宿主无信号量 | ✅ | live 两会话串行实证（S10 ③） |
| `timeoutMs` 仅作声明 | 两处工具定义 | R15（注册表绝不执行它） | ✅ | 超时由 `ActionClient` 自实现并观测 `exec.signal` |

**结论**：两处纯猜测（回合事件投递范围、追问消息源）已全部回退而非留库；其余每项都归到三态之一。真正的遗留是 **G44 需要换层重做**（Host 级插件），以及 `concludeTurn` 与 `source.kind` 两条 live 空白。

### G44 完整方案 spec（2026-10-11 定稿待实施：让 `report_task_status` 成为终态唯一出口）

**先记两条硬事实（声明面已核）**：`turn/end` 是**会话事件**（`agent.ts:387` `session.append('turn/end',{turn,reason})`），
插件经 `ctx.on('session/event', (session, event) => …)` 观察；`followup/steer/inject` 是 **Agent 对象方法**
（`agent.ts:163-171`），经 `ctx.agents.get(session.id)` 拿句柄。官方同款需求已有可照抄的实现：
`packages/goal/goal-round-driver/src/index.ts`——`inject = ['agents','goals','sessions']`、
`case 'turn/end'`、`agent.followup(createUserMessage({content, source:{kind:'goal',…}}))`、
`ctx.on('agent/disposed', …)` 清态、`followup` 抛错时降级为 warn。

- **What**：交付三件——① `src/turnLedger.ts`：按 agent 记 `{acted, reported, nudged}`（`run_device_action` 成功即 acted，
  `report_task_status` 成功即 reported）；② `src/index.ts` 挂 `session/event` 监听，`turn/end` 且 `acted && !reported` 时
  **至多一次** `agent.followup()` 追问，并要求模型以 `report_task_status` 收尾；③ 自声明消息源 kind（样例
  `packages/experimental/webhook/src/types.ts` 的 `MessageSourceMap` 扩法），**不得**用已被 session format V4 拒绝的
  `{kind:'plugin', plugin:<name>}` 包装（S9）。范围外：goal 机制（它管 Round 不管回合）、UI 卡片（P3）。
- **How**：关键决策与理由——(a) **有界**：`nudged` 一次即止，第二次仍不汇报就只记 warn 不再追问，否则对着不调工具的模型是死循环；
  (b) 追问文案必须显式要求调用 `report_task_status` 并禁止再动设备；(c) `agent/disposed` 里删态，避免 WeakMap 之外的泄漏；
  (d) 终态补记**不**在本方案里做（`presentationMeta` 只在工具结果上存在，回合外没有可挂载的结果），改为把"未汇报"作为
  结构化 warn 日志 + `nudged` 状态暴露给后续 checker。
- **Verify**：**先做两个前置实验**（任一失败方案要改，别先写代码）：
  ① ✅ **已做（2026-10-11）**：`inject` 临时加 `agents`/`sessions` → 重新 build → 冷重启 → R7 新会话，wire 里工具面仍是
     `run_device_action` + `report_task_status` + jobs 三件（5 个），**没有停在 pending**——这两个服务在 preset 子作用域可解析，
     G30 那个风险不成立。改动已回退（不写监听就占两个服务依赖是死代码），实施时重新加上即可；
  ② **未及验证**：追问从未触发（见上条结构性结论），所以自声明 `source.kind` 能否过 format V4 **仍是未知**，换到 Host 级插件后要先测这一条。
  然后：`npm run build` + `npm run test`（假 ctx 要能 emit `session/event`，锁三条：acted 未 reported 才追问、只追问一次、
  已汇报不追问）；live 按 G43 用 `cmd uimode night no` 复位 + 截图定案，跑一个模型倾向不汇报的任务，看是否被追问后补出汇报。
- **Done means**：[ ] 两个前置实验各有结论并写回本条；[ ] 监听与有界追问实现且单测锁死；[ ] live 观察到「未汇报→被追问→补汇报」
  完整闭环；[ ] **顺带给 G41 补上至今缺失的 live 证据**（`concludeTurn` 真机生效）；[ ] G44 并入已关闭行、G41 状态转绿；
  [ ] 重跑真机质量 spike 作为 D9 的正式裁决。

### G41 / G42 修复轮（2026-10-11，插件侧 57/57）

- **G41 终态**：官方机制存在——`execute(args, exec)` 的第二参就是 `ToolRunContext`，其 `concludeTurn()` 把成功的结果标记为本回合终点（声明面原文："The agent loop stops after committing this successful result batch"），且只存在于 `ToolExecutionSuccess`。`report_task_status` 现在调用它；S2 的终态从「提示词约定」变成「有强制点」。
  **先排除了一条歧路**：`@deepseek-ai/dsh-tool-goal`（`create_goal` / `update_goal(complete|blocked)`、`blockedAfterConsecutiveRounds`）管的是**自主 Round 的续行**，不是回合内的工具循环，别拿它当终结手段。
- **G42 编号定位**：改成**一套编号两处用**——`parseVisibleElements` 按数组位置赋 0..n-1 句柄，模型看到的列表与解析器用的是同一个序号；无面积节点先丢弃不占号。旧的 XML 解析器**从来没有测试**，这就是缺陷能活下来的原因，`tests/hierarchy.spec.ts` 补上 6 条。
- **live 才暴露的真根因**：模型找不到目标其实是我们自己的展示层截断——`output.render` 把每个字符串字段 `slice(0, 200)`，27 个元素的层级到模型手里只剩 3 行。现在 `hierarchy` 单独给 6000 字符预算。
- **状态（2026-10-11 干净重跑后）**：**G42 live 通过**——初态用 `cmd uimode night no` 复位（截图核实浅色）、从桌面起跑，模型 4 次动作达成 T2：`launch_app` → `get_ui_hierarchy` → `click {index:26}`（显示行）→ `click {index:17}`（开关），**全程零 index 报错**，截图定案深色已开；同一任务基线是 42.1s/3 步，插件侧 ≈15s/4 动作且带效果判定。**G41 仍未 live 验证**：这一轮模型依旧直接文本收尾、没调 `report_task_status`（G44 再次成立），所以 `concludeTurn()` 的真机效果还没被走到——它目前只有单测与声明面依据。

### 真机质量 spike 结果（2026-10-11，D9 直通 vs 回退三段式的裁决材料）

对照条件公平：**同一台 MuMu（emulator-5554）、同一个模型（qwen3.6-35b-a3b-mtp）**，两侧只差执行器——
基线 `uv run artemis run "<goal>" --profile flash`，实验侧 DSH web 会话（AutoGamer preset + autogamer-flash skill）。

| 任务 | 基线（py flash） | 插件（DSH + skill） |
|---|---|---|
| T1 打开设置→显示页 | **77.2s / 6 步 / completed**，全部用归一化坐标（含 3 次滑动找目标），截图核实**真达成** | **≈35s / 10 次请求 / 达成**，但其中 **6 次是 `index` 定位失败**（G42）后才退回坐标 |
| T2 打开设置→开深色主题 | **42.1s / 3 步 / completed**，用**编号目标**（`target: 12`、`target: 17`），`ui_night_mode` 与截图双重核实**真达成** | **失控未完成**：`text` 目标失败后自认「设备连接问题」，转入指数退避 `wait` + 反复 `report_task_status`，70s 内 47 次请求仍在跑，**人工点「停止生成」才停**（G41） |

**判定：D9 的「直通」目前不成立，但失败原因是可修的接线/语义项，不是架构性的。**
- 赢的一面：单步延迟与总耗时明显更好（T1 35s vs 77s），效果判定（`effect=changed`）与截图进模型是基线没有的，
  闸门/连发/媒体四点全通过。
- 输的一面：基线的**编号可见元素列表**是我们缺的核心能力（G42），以及**终态语义在 DSH 侧没有落地机制**（G41，严重）。
- 建议顺序：**先修 G41 + G42，再重跑本 spike 作为 D9 的正式裁决**；在此之前不要宣布直通成立。
- ⚠️ **本表结论的对照前提作废（G45）**：实验侧那栏标注的「AutoGamer preset + autogamer-flash skill」里，
  **skill 从未被挂进会话**（preset 没有 skill 行，也没有 persona 行）。两侧不是「同指令不同执行器」，
  而是「基线有 flash 契约 / 插件侧根本没有」——G41 缺的那份 live 证据属无效前提下的观察，须接线后重测。
  **只有 G44 不受影响**：那条的指令是插件自己注入的追问文本，与投递缺失无关，其服从性结论仍成立。

### 真机质量 spike 重跑（2026-10-11 深夜，G45 接线之后 —— D9 的正式裁决）

对照条件：同一台 MuMu（emulator-5554）、同一个模型（qwen3.6-35b-a3b-mtp）、目标文本与上表**逐字相同**、
每个任务一个**新会话**（R7）、初态用 `am start … category.HOME` 复位并核实 `mCurrentFocus=LawnchairLauncher`。
**前提这次成立**：wire 里 system 消息 4052 字符、`You are AutoGamer…` 从第 50 字符开始，
`run_device_action` / `report_task_status` 都在 tools 里（上表那轮这两样都不存在）。

| 任务 | 基线（py flash） | 插件（G45 接线前） | **插件（G45 接线后）** |
|---|---|---|---|
| T1 打开设置→显示页 | 77.2s / 6 步 | ≈35s / 10 次请求，6 次 index 失败 | **17s / 5 步 / 达成**（截图核实停在「显示」页，浅色），零 index 报错 |
| T2 打开设置→开深色主题 | 42.1s / 3 步 | 失控：47 请求 / 70s / 人工停止 | **22s / 7 步 / 达成**（截图核实开关已开、整机转深色），**回合自己收尾、没有退避循环** |

T2 的动作序列把 G42 与 S10② 都跑成了正例：`take_screenshot` → `click {index:1}` 返回
**`effect=unchanged`** → 模型据此换坐标点 dock 图标（`effect=changed`）→ 点开关（`changed`）→ 再截图自查。
**全程没有一次 index 解析失败，也没有原样重试被拒动作**（persona 第 4 条）。

**D9 裁决：直通成立。** 两个任务全部达成、耗时约为基线的一半，并且带着基线没有的三样：逐动作效果判定、
截图真进模型、闸门/连发/媒体四点此前已全通过；上一版判定「直通暂不成立」的两条理由
（G42 编号定位、G41 终态不收敛）现在都有 live 反证。

**裁决后复查（同日深夜，CHANGELOGS #15）改写了本页对终态的判断**：
1. ~~终态语义仍未闭合~~ → **已闭合**。T1 重跑的会话日志里 `report_task_status` 的 `tool/call` 之后**直接** `turn/end`、
   无后续 `step/start` ⇒ `concludeTurn()` live 生效（G41 ✅）；故意"只截图不汇报"的会话里追问真的落进日志
   （`source.reason:"unreported-turn"`）并驱动出第二轮，模型在第二轮补出汇报（G44 ✅）。
   **上面那条"接线后模型仍不调 `report_task_status`"是拿 wire 请求体数出来的假结论**——
   终结回合的那次工具调用永远不会出现在后续请求体里（守则 **R24**）。
2. ~~兜底追问是死的（G46）~~ → **G46 当日撤回**，登记为撤回条目（同 G40）。
3. 样本只有 2 个任务、每任务 1 次，且都在设置应用内；换应用/输入类任务未测——这条保留，是 P1 的验收面。

**顺带把 G43 判据钉牢**：T2 达成后 `settings get secure ui_night_mode` **仍读 2**，而截图明确是深色。
⇒ 这台 ROM 上该 setting 根本不是深色主题的真相来源，**达成与否只认截图**（上表基线那格拿它当过旁证，注意）。

### G31/D17 交付形态：从手工引入迁到 `install_bundle`（2026-10-12，按 R22 三步序：查官方 → 本方案 → 实现）

- **What**：把「怎么装」从手工路径迁到官方路径，并让 preset 具备自举安装能力（D17）。
  范围：`cordis.patch.yml` 的 preset 行、bundle 的展示元信息（G31 顺带把 G32 的官方要求一次写全）、
  skill 随包根路径的解析方式、以及一份**可复跑的验收判据**。
  明确出范围：不改 py 动作面；不动 G36 的 UI 卡片半边；不改任何会话权限模式（R19）。
- **官方口径（本轮逐字核过，非推断）**
  1. **我们现在的做法是官方明令禁止的那种**：`cordis-plugin-development/SKILL.md:10`
     「Do not write the profile's `package.json` or `cordis.patch.yml`, create packages under `$DSH_HOME`,
     or run pnpm in the profile directory: **`install_bundle` performs those steps**」；
     `editing-cordis-compositions/SKILL.md:52`「It runs package installation and bundle selection itself;
     **do not reproduce those steps with shell commands**」。⇒ `dsh plugin add file:` + `--patch` overlay 只能当**测量仪器**，
     交付判定必须走 `install_bundle`。
  2. **preset 只能由 bundle 补丁承载**：`editing-cordis-compositions/SKILL.md:8`
     「Agent presets are ordinary `@deepseek-ai/dsh-agent-preset` declarations carried by bundle patches.
     Nothing edits a declaration in place: a preset is created or changed by **installing a bundle** whose patch declares or overrides it」
     ⇒ 我们的 `cordis.patch.yml` 形态本来就是对的，缺的只是「装进去」这一步。
  3. **`install_bundle` 的落点**：服务 `ctx.pluginManager`（`packages/boot/plugin-manager/src/index.ts:178`
     `class PluginManager extends TypertRemoteService`），`@Remote installBundle(spec, options?)`（`:496-497`）；
     `spec` 是「One package spec, including **local paths relative to the invocation directory**」（`:491-494`），
     且「run that fails, is cancelled, or adds a package **without a bundle patch** restores `package.json` and `pnpm-lock.yaml` as they were」
     ⇒ 本地开发用 `file:`/相对路径是官方支持面，失败自带回滚。
  4. **模型侧只有一个工具**：`plugin_manager`（`src/tools.ts:19-21`，`action` 枚举含 `install_bundle`，
     缺 `target` 直接 `throw new Error('target package spec is required')`）。
     官方 README 给的启用形状就是 preset 里一行 `- id: tool-plugin-manager` + `disabled: false`
     （「Preset-backed sessions use their preset's `tool-plugin-manager` entry」），
     而 shipped `standard`/`ptc` preset 都把它 `disabled: true`，只有 Creator 模式开。
     ⚠️ 代价要写清：README 同段「**installed Host code executes in-process outside the workspace sandbox**」。
  5. **授权边界（R19 的具体化）**：README 原文「**Every tool action requires `danger-full-access` or approval for that call**.
     Under lower sandbox modes, `ask` requests approval; `never`, rejection, cancellation, or an unavailable approval channel
     prevents execution. **An approval leaves the session permission mode unchanged.**」
     加上 `SKILL.md:10`「Every `plugin_manager` action, **including `list_plugins` and `list_bundles`**, also needs approval without Full access」，
     以及构建脚本审批另算（`approvedBuilds`，Web 是整组批准、无单包选择）、豁免要 `acceptRisk: true` 且先警告崩溃/数据丢失风险。
     ⇒ **我们绝不替用户放宽权限模式**；本机 web 会话现在是「完全权限」那是用户既设状态，用它在场做实验必须在正文里注明。
  6. **skill 随包根路径有官方现成解法**（G31 卡住的那问）：shipped `web-app/presets/cordis.patch.yml:134-138` 逐字是
     `customSkillDirs: [- !!js process.getBuiltinModule('node:path').join(…dirname(createRequire(baseUrl).resolve('<pkg>/package.json')), 'skills')]`
     —— 即**在补丁里用 `!!js` + `createRequire(baseUrl)` 解析包目录**，`baseUrl` 是宿主注入的 loader 变量。
     另一条官方路是专用提供方：`skill-badge/src/index.ts:18-22` 用 `new URL('../assets/dsh-badge.md', import.meta.url)`
     在码里注册（`rank: BUNDLED_SKILL_RANK`、`inject: ['skills']`、`ctx.skills.registerProvider()`）。
     旁证：`references/verification.md` 口径「querying one `entry` returns its `packageDir` … **never guess the path from `$DSH_PROFILE_DIR`**」。
  7. **G32 的官方要求已经查全**（`references/host-plugin.md:31-36,51`）：Plugin Manager 与 Settings **不激活插件**就读
     `locale/en.json` 的 `meta.title`/`meta.description` 与导出的 icon；须导出 `./locale/*.json` 与 `./icon`
     并把 patch/locale/icon/运行时文件都留在 `files` 里；icon 限 SVG/PNG/JPEG/WebP、**≤256 KiB、必须留在包内**
     （绝对路径、URL、越界符号链接一律拒绝）；缺字段回退 `package.json` 的 `name`/`description`、缺图用面板默认插画；
     **Host-only 与 configuration-only bundle 都不豁免**；元数据诊断不阻断管理。
- **How（按依赖顺序，每步都可单独回退）**
  1. **先补 bundle 形状**（G32，纯声明、零风险）：加 `locale/en.json` + `locale/zh.json`（`meta.title`/`meta.description`）、
     `icon.svg`，并在 `package.json` 的 `exports`/`files` 里登记。做完 `--dump-config` 仍须 exit 0。
  2. **再开自举能力**（D17）：preset 的 `plugins` 加 `- id: tool-plugin-manager` + `disabled: false`。
     这一步把「往宿主进程里装代码」的能力交给模型，**必须先向用户确认再落**（R19 精神 + 上面第 4/5 条代价）。
  3. **最后换引入路径**（G31 本体）：`customSkillDirs` 从绝对路径改成第 6 条那个 `!!js` 解析；
     若 `baseUrl` 在我们这个 bundle 的补丁里不可解析（它是宿主注入变量，**属未证事项**），退到码内 provider 方案。
     然后走一次真实 `install_bundle`（`spec` 用本地路径），验收见下。
- **Verify**
  - 声明面：`"D:/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd" --profile web --patch <abs cordis.patch.yml> --dump-config`
    exit 0 且 grep 不到 `unmatched`（R6）；两份 YAML 的 preset 一致性由 `tests/deliveryShape.spec.ts` 机械守（已建）。
  - 生效面（R9 只认官方检查器）：安装后**开新会话**（R7），判据是 roster 不 `broken` +
    `plugin_manager` 的 `list_bundles`/`list_plugins` 里我们的 bundle 在册 + 会话工具面出现 `run_device_action`/`report_task_status`/`plugin_manager`；
    **`dsh plugin` 是 pnpm 转发垫片，只证明装了不证明生效**，不许拿它当判据。
  - 投递面：新会话 wire 的 system 消息仍含 persona 契约原文（防 G45 复发）。
  - 授权面：`plugin_manager` 调用在**非**完全权限下必须走审批；我们不放宽模式，只观测。
- **Done means**
  - [x] G32：locale/icon/exports/files 齐备（CHANGELOGS **#17**）；面板 live 已渲染中文标题+描述+我们的 SVG，且加 `exports` 后挂载未受损
  - [x] D17：preset 的 `tool-plugin-manager` 行落地（**用户已确认「一起开 D17」**）；live 证：工具面 5→7，多出 `plugin_manager` 与 `skill`
  - [x] G31：`install_bundle` 端到端走通（CHANGELOGS **#18**）。⚠️ 只验了**成功路径**——「失败按原文回滚 package.json/pnpm-lock」那条**没验**（要造一次失败才会触发，本轮没造）
  - [x] skill 根路径不再写死绝对路径：官方 `!!js` + `createRequire(baseUrl).resolve('autogamer-device/package.json')` 形态**live 走通**——`<available_skills>` 列出 `autogamer-flash`，模型调 `skill({name:"autogamer-flash"})` 拿回 1784 字符正文与 `skill_resources` 基目录
  - [x] 生效判定全部来自官方检查器（R9：`--dump-config` 合成树 + profile `package.json` 的 bundles 列表，不拿 `dsh plugin list` 当证据）
  - [x] G31/G32/D17 结案进 CHANGELOGS，`registry.md` 同步，两份门禁脚本重跑（#17/#18/#26 + registry 已关闭行）

### P0 执行状态（2026-10-09 动工，plugins/autogamer-device）

- ✅ **骨架**：run_device_action 路由工具（闸门→MCP 转发→效果分类→路由日志）+ 闸门/熔断 + report_task_status + autogamer preset + flash skill；当时 19 个 vitest 用例全绿（含 conformance 契约 6 项），现 38/38 见状态表
- ✅ **安装流 spike（live）**：三处修正固化——`dsh.bundle.patch` 必须声明、bundle patch 是 `- insert:` 列表、Windows 路径+remove/add 重评估；层合成 dump-config exit 0。**2026-10-10 调研修正**：`dsh plugin add` 加手写 profile `cordis.patch.yml` 这条流程本身落在官方明令禁止的一侧（正道是 `plugin_manager install_bundle`），已固化下来的三条机制结论仍有效，但流程要按 D7 改写
- ✅ **MCP 直连 spike（离线）**：ActionClient ↔ `artemis mcp --type adb` 全链路；真实契约接线（13 工具名/像素坐标 0-1000 换算/字符串结果归一化含 `Error executing tool` 变体/`--type` 旗标）
- ✅ **S1**：外部 SessionId 源码核实（幂等 adopt）+ live 组合验证（preset 注册、新任务默认标记、选择器可见）
- ✅ **S10 前置定论**：headless 无 preset registry、root 工具不进 headless agent（4 轮实测+代理抓包）→ S10 转 web；pi-ai baseURL 需 `/v1` 前缀（日志代理实锤）
- ✅ **conformance（G5 已结，CHANGELOGS #29 / G18 基线）**：契约不再吃手镜像——`runtimeBoot.spec.ts` 在真实 DSH 服务包上读 `ctx.tools.schemas()`；`contracts.spec.ts` 三条 fixture 全为生成物（py 动作面 14 项 live 抓取、旧控制台 SSE 由发射漏斗+订阅面抽取得到 **26/17** 项及单向死信道、DSH pin 取实际安装态），事件词汇改读 `KNOWN_SESSION_EVENT_TYPES`
- ✅ **S10 ①（工具面 + 模型稳定性）通过（2026-10-10）**：从「AutoGamer 会话的请求体里根本没有 `tools` 键、模型幻觉出一个 `os` 工具」到「新会话里模型真实调用 `run_device_action` 三次、入参合法、按次重试」。根因与修法在 G30 关闭行与 changelogs #10；当时用来定性的同实例配对差分（标准模式 `tools=26` 且真跑 pwsh）留作方法——**插件侧 wire 差分比挂载诊断更快收敛**。这条留下两项仍可复用的资产：
  - **取证方法一（按钮态）**：主按钮位（class 含 `primary`）的 `aria-label` 会随回合状态变——空闲「发送消息」/运行中「停止生成」/运行中有草稿「排队发送」或「插话发送」。**按固定标签查按钮会把状态切换误读成入口消失**（G40 就是这么错出来又撤掉的）；要按按钮位 class 枚举再读标签。
  - **取证方法二（草稿合并）**：往非空草稿里 `insertText` 会把多条拼成一条用户消息（transcript 里出现「Q2…。Q1…。」），那是自动化的产物不是宿主行为；每次发送前必须先全选清空。
  - **取证方法三（Lexical）**：web UI 那个输入框是 Lexical，`fill` 无效；真实 click 建立选区后 `execCommand('insertText')` 才写入，且**不要在写入的同一次调用里回读 textContent**（会误判成没写进而重复注入）。发送用 `evaluate_script` 里按 aria-label 找按钮 `.click()` 最可靠——`click(uid)` 的 uid 会被同批改 DOM 的操作弄过期，我们因此白丢过两次发送。
  - 顺带证实：D5 重启后会话从磁盘恢复可用；`agent-preset-registry default: autogamer` 生效（新会话预设自动是 AutoGamer）。
- ✅ **S5 动作后端真机打通（2026-10-10/11）**：overlay 从 mock 切到 `.venv` python 的 `artemis mcp --type adb` + `actionServerEnv.ADB_DEVICE_SERIAL=emulator-5554`，MuMu 上 `take_screenshot` 一次调用即成（`captured 1600x900`，回合 10s / 1 轮 2 步）。当年 c8b49c8 按「无法解析」删掉的 `actionServerEnv` 块本轮复跑 R6 确认可合成（exit 0、0 unmatched、键出现在 `--dump-config` 输出里），旧结论作废；mock action server 的 1080x2400 解析证据同属坐标修复的 live 面（changelogs #9）。
- ✅ **G37 收回 + G36 模型侧打通（2026-10-11，三轮 live）**：overlay 收回交付形态后 R7 新会话实测工具面恰为 **5 个**（`run_device_action` + `report_task_status` + jobs 三件），说明交付 preset 形态本身能挂、G30 的修法在窄面上成立。媒体链路按官方声明面走通：`ctx.attachments.saveImages` → 内容寻址引用 → `render` 出 `[text, image]` → 宿主提升为带 base64 的 user 消息（请求体 12KB→296KB）→ 模型报出只有像素里才有的信息。**过程中否证两条**：① 不声明 `inject` 也能读宿主服务（cordis 在属性 GET 处直接抛）；② 模型看图需要挂 fs/`read_image` 去开只读路径（宿主自己提升）。细节与验收见 changelogs #11
- ✅ **S10 ② 效果验证通过（2026-10-11，真机正反两例）**：改屏动作前/后各取一帧、600ms 沉降后交 py 只读工具 `compare_ui_frames` 判定，工具结果带 `effect=changed|unchanged|unknown`。live 实证：Settings 按 `back` → `effect=changed`；已在桌面再按一次 → `effect=unchanged`——MuMu 动态壁纸没造成假阳性，说明上游 `check_ui_change` 的遮罩与阈值选择在真机站得住。过程中三条结论入册：**字节等值不可用**（静态三帧哈希全不同）、**TS 自研 PNG 差分不可用**（真机回 JPEG）、**判定归属选 py 动作面**（G39 路线 A，细节与豁免理由见 changelogs #12）。③ 闸门阻塞、④ Inbox 连发 未测
- ✅ **S10 ③ 闸门阻塞通过（2026-10-11，两会话同设备）**：会话 A `wait(20000)` 占闸，A 的结果出现在 wire `10:00:22.98`；会话 B 早在 `10:00:10.45` 就已把请求发给模型（**宿主确实跨会话并发**），但它的 `take_screenshot` 结果直到 `10:00:26.59` 才回到线上——阻塞精确落在工具调用上、时长≈A 的剩余占闸时间，即 per-device 闸门在跨会话生效。若不串行，B 应在 ~10:00:12 就返回
- ✅ **S10 ④ Inbox 连发通过（2026-10-11，原生 QueueDock）**：回合运行中输入区主按钮从「发送消息」切成**「排队发送」**（可用），点击后草稿清空、消息进 QueueDock 行，行上带**「编辑排队消息」/「删除排队消息」/「插话发送」**三个操作与「停止生成」；当前回合（`wait 30000`，用时 32 秒）结束后排队消息**按序自动执行**，模型回「收到」。D2/D4 的「Inbox 原生积压、零自建」前提**成立**，与官方 README 口径一致（「繁忙时 Queue 进入 QueueDock，繁忙时 Steer 进入 pending-steering 区域」）。**上一轮登记的 G40 已撤回**——那是探针自己的错：按固定 `aria-label="发送消息"` 找按钮，把「运行中换了标签」误读成「入口消失」
- 🔶 **P0 还差最后一道判据**：MCP 直连**真机**质量 spike（flash skill 跑 2-3 个真实设备任务，对比上游 flash 质量）——离线契约 spike 已过，这条才是 D9「直通成立 / 回退三段式双跑」的裁决点，目前只有工具面通了、还没跑过完整真机任务。
- ✅ **本轮 live 连带的两个缺陷修复**：`coord.ts` 的 `byteAt` 无限递归（截图取尺寸整条路死）与 `screenSize` 真值 `[undefined, undefined]` 陷阱（默认配置把 `NaN` 坐标发给 action server 还报成功）——问题、修法与验收（锁死测试＋删除实验）详见 changelogs #9。
- ✅ **联网调研上游插件形态（2026-10-10，正文见 [upstream-plugin-forms](migration/upstream-plugin-forms.md)）**：逐字读了 `editing-cordis-compositions` / `cordis-plugin-development` / `cordis-composition-reference` 三个官方 skill、`agent-preset` 与 `agent-preset-registry` 的 README、`core/scope` README、`mount.ts` 源码，以及 shipped `presets/minimal.patch.yml` 与 `standard.patch.yml`。对本方案有决定作用的三条：①preset 只能由 **bundle 补丁**承载且要经 `plugin_manager install_bundle`（官方明令禁止手写 profile 的 package.json / cordis.patch.yml）；②**声明只影响之后创建的 Agent**，现有会话保留其启动时的 revision；③`mountRevision` 对「行激活失败」与「服务泄漏进 root realm」都是**拒绝整个 preset 挂载**（源码 `mount.ts:193,212-213`）。据此修订 D7、新增 D16 与 G30，补 S5 注册可见性与 S8 版本差。
- ✅ **守则已成文（[plugin-contract-rules](migration/plugin-contract-rules.md)，那一轮成文到 R19；现行条款数看 [registry](migration/registry.md)）**：把这次调研与踩坑换成「每条都带出处口径和可执行判据」的红线。其中三条专门防我再次自伤——R6 每次改 patch 必须 `--dump-config` exit 0 且 grep 不到 unmatched；R7 复验前必须证明会话创建时刻晚于本次生效，否则该轮不作数；R9 判「生效」只认官方检查器（install 的 `application`/`warnings`、`list_plugins` 的 `enabled`/`fiberPhase`、roster 诊断、`cordis_inspect_query`、`inspectCompositions`），**不认**日志、进程列表、`dsh plugin list`、也不认 wire 反推。据此把 D7 重写为三层（并纠正上一轮两处误判：`--patch` 其实是 `dsh --help` 明列的官方 overlay；侧边栏「插件」面板能 install/enable/disable/retry，不是只读页），另加 D17 与 G31
- ✅ **未读清单已读完并回填（2026-10-10 第二轮，守则 R13-R19 成文）**：逐字读完 `references/practices.md`（官方列为「选扩展点前必读」）、`host-plugin.md`、`ui-plugin.md`、`user-actions.md`、`verification.md`、`docs/cookbook/adding-a-tool.zh.md` 与 `packages/core/tools/README.zh.md`。据此新增七条硬约束并改写 S3/S4/S5/S6/S9/S11/P3：扩展点按「够用即最弱」（R13）、宿主已有「只读并发 / 变更独占按提交序」的调度约定（R14）、**`timeoutMs` 只是声明、注册表绝不强制执行**（R15）、不许自写会话事件类型而要走 `presentationMeta`/投影（R16）、`inject` 不唤醒而 `followup` 唤醒（R17）、UI 只能进 slot 且禁止 import 宿主 Client 包（R18）、展示元信息与图标是义务且授权类动作永远 user-only（R19）。同时**否证了我自己的一条假设**（「裸 schema 注册必须经 `defineTool` 包装」——官方 MCP 路径就是拿 server schema 直接 `register()`）。新开 G32/G33/G34 三条实现差集，G31 按 CLI 证据收口
- ✅ **G30 关闭（2026-10-10，两轮官方检查器分级实证 + 两处真根因）**：调研改判的「asar 锚点拒挂」假设也被官方面否证（roster/插件页/清单全绿、新会话创建成功、`autogamer-device-inner` 运行中）——正确的定性路径是**功能轮差分**：新会话里 preset 其他子行的工具全部在模型清单上（fs/pwsh/jobs/web/present…），唯独缺我们两个，而行状态「运行中」⇒ 注册后立即被注销；第二轮修掉注销后 400 前移（tools[11]/[12] schema 非法）⇒ 裸注册未编译。双根因修复见 changelogs #10（effect 语义反转 + defineTool 编译），vitest 38/38 含 2 条回归锁，live 实证模型真实调用 `run_device_action` 三次。教训入册：**插件侧 wire 差分（哪几个工具在/不在）比挂载诊断更快收敛**；测试假 context 必须实现 effect 且按 cordis 语义。原 Fix A（file: URL 子行）与 Fix B（根行兜底)作废——锚点假设不成立
- 📌 **S2 spike 处置（R2' 决定）**：artemis-worker producer spike **移入 R1 回退件**——R2' 主路径不 spawn py worker job（「任务=job」映射由「turn 内动作序列 + MCP 直连」取代，已由 MCP 直连 spike 覆盖）；仅当直通质量 spike 失败、回退三段式双跑时才执行原 S2 spike
- ✅ **host/client 双端定论**：一期纯 host 插件（安装流已验证）；client 侧 spike 推迟到 P3 需要自定义 toolview 时

## 六、文档索引

| 文档 | 内容 |
|---|---|
| [README](migration/README.md) | **入口页**：按「你要做什么」给阅读顺序，并列出哪几处文档别当真 |
| [registry](migration/registry.md) | **编号唯一权威**：全部 D / S / G / R 编号一览（含已关闭的 `G*`，其中 G40 是当日撤回的错误归因），外加 `inventory/*` 与本文的 **G 编号撞车冲突表**。新增编号先登记到这里，`scripts/check_doc_registry.py` 守着。**其它文档不复述编号范围与条数**——那是腐烂处，要引用范围就指本表 |
| [glossary](migration/glossary.md) | 术语翻译表：宿主黑话、Cordis 概念、本项目自造词，以及 **`inject` 的两个意思** |
| [upstream-rethink](migration/upstream-rethink.md) | 上游 google/artemis 三张调用面研究 + R2' 基线论证 |
| [dsh-verification](migration/dsh-verification.md) | DSH 0.2.0-rc.2 源码核实（48 假设/12 修正 + 19 项防重复自建 + turn shim + 主流范式 + 业界约束模式，§一~八） |
| [feature-inventory](migration/feature-inventory.md) | fork 现状防丢失盘点（inventory/01-05 明细；队列控制台部分已随 R2' 降级为 fork 场景遗产，设备/智能栈部分为上游 canonical 契约） |
| [upstream-plugin-forms](migration/upstream-plugin-forms.md) | 上游公开文档与源码调研第一轮：插件 / preset / 工具形态的官方口径（D7 改写、D16、G30 的依据），含本轮收回的两条错误归因与官方活门禁判据清单 |
| [plugin-contract-rules](migration/plugin-contract-rules.md) | **插件契约守则**（连续编号，现行范围以 [registry](migration/registry.md) 为准）：每条带出处口径与可执行判据，动手改插件 / preset / patch 前先对照；R2 分三层看改配置、R7 复验必须新会话、R8 realm 与 fail-fast、R9 只认官方检查器、R13 扩展点按「够用即最弱」、R15 `timeoutMs` 不执行、R16 会话写入边界、R18 UI 走 slot、R19 图标与授权红线、R20 遇宿主行为先查官方一手资料、R22 查文档 → 写方案 → 才写码、R23 注入须推出 append 边界、R24 判「没发生」只认会话日志、R25 一次只测一个变量、R26 `gh` 写操作显式 `--repo`；并记录了三处对本文档早期判断的自我纠正 |
| [CHANGELOGS](CHANGELOGS.md) | **已结案变更的历史**：`### #N` 条目（问题 / 修法 / 验收）按分类组织，「已关闭差距史」承载所有结案 `G*` 的正文与关闭方式。编号发布后不得改写 |

