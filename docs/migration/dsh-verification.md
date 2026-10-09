# DSH 本地源码核实报告

> 日期：2026-10-09；核实版本：**DSH desktop 0.2.0-rc.2**（全部 279 个 @deepseek-ai/dsh* 包同版本）。
> 核实对象：本机 Electron 桌面安装（`D:\DeepSeek Harness\`）内嵌 runtime；源码提取：`resources/app.asar → D:\tmp\dsh-ref\dsh\`（临时解包，不入 repo）；真实运行数据参照：`C:\Users\78557\.dsh\`（web profile 活配置、`sessions/--D-DEV-autoGamer--/` 真实会话 v3/v4 并存）。
> 方法：4 路并行子代理对 48 项方案假设做源码级核实（jobs / session+Inbox / 插件缝+审批 / SDK+CLI）。
> 维护规则：DSH 升级（尤其 rc→正式）必须重验本表全部「⚠️修正」项。

## 结论速览（触发方案修改的 12 项）

| # | 原假设 | 核实结果 | 方案修改 |
|---|---|---|---|
| 1 | 初版用自带 bash job kind 跑 py worker | ⚠️ bash-local **POSIX-only**（"Windows is unsupported"）；kind 是开放字符串，官方注册了 bash/pwsh/subagent/workflow | Windows 直接自写 producer 插件，自定义 kind `artemis-worker`（照抄 tool-bash/tool-pwsh 样板） |
| 2 | 退出码 0→completed / 非0→failed | ⚠️ **registry 不做该映射**，outcome 全由 producer 的 `done` 给出；官方 shell job **非 0 退出=completed**（detail 带 exit code），failed 仅 spawn 失败/producer 抛错 | 与 G8（DB 终态权威）天然一致：producer 的 done 判定由迁移层自定 |
| 3 | kill→killed（Windows） | ✅ killed 成立，但 Windows = `TerminateJobObject` **整棵进程树立即硬杀**（无宽限无钩子；POSIX 有 SIGTERM→3s→SIGKILL）；宿主进程死时 Job Object kill-on-close 连带杀子树 | G10 cancel-marker 优雅取消通道更加必要；孤儿对账在 Windows 有 OS 兜底，仍需 worker 状态文件对账 |
| 4 | 重启后 Inbox pending 原生续派（零自建） | ⚠️ pending **原生恢复**（durable projection 落 session log），但 resume 后 driver 处于 idle，**不会自动开跑——需一次显式唤醒**（新 followup 或宿主 kick） | autogamer-queue 启动对账时补一个「唤醒所有有 pending 的会话」动作 |
| 5 | workspace/session-stop 杀该会话全部 job | ✅ 存在，但它是 `agent.cancel` **不带 keepInbox——会丢弃该会话排队消息** | ARTEMIS「停单个任务/保留队列」语义用 `cancel(cause,{keepInbox:true})`；只有清空会话才用 session-stop |
| 6 | G20 晚订阅 catch-up 需验证 | ✅ **原生支持**：`readSessionState` 全量快照 / `page` 分页 / `projections(asOfSeq)` + live `session/event` | G20 关闭，无需自建补偿 |
| 7 | 通知可经 DSH webhook 出站 | ⚠️ **DSH 无出站 webhook**（webhook 只有入站，fire-and-forget 202、无重试/去重/完成回报；唯一带认证的入站适配器是 GitHub HMAC） | G21 通知适配全部插件侧自建：订阅 `ctx.jobs.events` settled → 按 ARTEMIS webhook schema POST |
| 8 | 媒体路由用 `ctx.connection.fetch` | ⚠️ 真实 API 是 **`ctx.webServer.register()`**（exact/prefix 路由 + handler(req,res) + registerUpgrade/registerFallback；无自带鉴权）；`ctx.connection` 是浏览器侧 RPC | autogamer-media 改用 webServer；鉴权自担（根约束+扩展白名单语义照搬） |
| 9 | toolview 由插件注册（dsh-data-agent 模式） | ⚠️ 确认可注册，但缝是 **client 侧插件**：`ctx.slots.inject('tool.call.toolview',…)` 按 wire 工具名注册组件（`dsh-agent-tool-presentation` 是模型面 native/ptc 配置，不是 UI） | G2 交付物按 client plugin 形态写；工具名用全名（含 `mcp__` 前缀若走 MCP） |
| 10 | 配置热重载（patchReload: "live"） | ⚠️ `patchReload` 字段在 rc.2 代码中**不存在**（惰性字段）；真实机制 = `dsh-hmr` 监听 cordis.patch.yml/package.json 免重启 reconcile **配置层**；插件模块代码（node_modules）不监听 | P0 开发流改为「**配置层热重载、代码层冷重启**」 |
| 11 | DSH 官方 SDK（TS + Python）；webhookRuntime 外部接入 | ✅ TS=`@deepseek-ai/dsh-sdk-client`（npm 0.0.1-rc.1），Python=`deepseek-harness`（PyPI 0.3.1，**版本线高于本地 rc.2**）；⚠️ SDK/ACP 全是 **stdio 本地子进程**，无跨机 HTTP 入口 | 外部 HTTP 调用方需「HTTP→SDK 子进程」薄桥；接入主选 SDK，webhook 只做单向触发，ACP 备选 |
| 12 | 二期设备工具=autogamer-device TS 重写 | ➕ 新选项：**`dsh-mcp-client` 可直连 ARTEMIS 现有 mcp_server**（stdio/streamable-http，一条 patch entry，工具注册为 `mcp__<server>__<tool>`；注意无 MCP prompt templates、toolCallTimeoutMs 默认 60s） | 二期「ARTEMIS mcp_server 直接作为 DSH 工具源」与「TS 全量重写」两条路线并行评估 |

## 一、jobs 子系统（12 项）

| # | 结论 | 证据与关键 API |
|---|---|---|
| 1 | ⚠️ kind 开放字符串，无内置注册表；官方注册 bash/pwsh/subagent/workflow；**bash-local POSIX-only**，Windows 对应物 `dsh-pwsh-local`（pwsh7→PATH→PS5.1） | dsh-bash-local/README.md:142；dsh-tool-bash/lib/index.js:396；dsh-tool-pwsh/lib/index.js:367 |
| 2 | ✅ `JobSpec.owner?: SessionId` = 发起 agent 的 session id；围栏真实（非本人 list/get/read/kill 全拒）；但 command/env/cwd 在 ShellExecRequest（shell 层）不在 JobSpec | dsh-jobs-local/lib/index.js:527-568；api-catalog.js:5464,6924 |
| 3 | ✅ env 完全可控：合成序 = scrubbedParentEnv → ENV_OVERRIDES{NO_COLOR,TERM,PAGER,GIT_PAGER} → `request.env` → dshEnv；**scrub 剥除键名匹配 /KEY\|PASSWORD\|SECRET\|TOKEN/i 与 DSH_***；显式 env 在 scrub 后合并可复活任意键 | dsh-subprocess/lib/index.js:32,50-62；dsh-subprocess-local/lib/runner-launch-*.js:694-712 |
| 4 | ✅ `start()` 内同步调 `spec.run(handle)`，run 必须同步返回 `{cancel(reason?), done: Promise<JobOutcome>}`；done reject → 强制 failed | dsh-jobs-local/lib/index.js:412-475 |
| 5 | ✅ ring 按 UTF-8 字节计：live 256KiB → settled 16KiB，泵 150ms；spillPath **运行中即可读**；官方 spill = `%TMP%\dsh-subprocess-*\*.log`，`maxSpillBytes` 默认 **64MiB（超限删除）**；dsh-spill 包是另一回事（工具结果存储） | dsh-jobs-local/lib/index.js:119-232；dsh-subprocess-local/lib/output.js:137-176 |
| 6 | ⚠️ kill = 协作式：调 hooks.cancel → status=stopping → 返回 `'requested'`；**Windows=TerminateJobObject 整树立即硬杀**（无宽限），fallback `taskkill /T /F`；POSIX=SIGTERM→3s→SIGKILL；kill-on-close 兜底宿主崩溃 | dsh-jobs-local/lib/index.js:611-621；dsh-subprocess-local/lib/runner-launch-*.js:724-735 |
| 7 | ⚠️ **非 0 退出 = completed**（detail="exit code: N"，官方注释 "reported, not failed"）；failed 仅 spawn 失败/producer 抛错；Windows 强杀由 executor 依 abort signal 判 killed | dsh-tool-bash/lib/index.js:38-60,118-124 |
| 8 | ✅ `ctx.jobs.events.subscribe(filter, listener)`：settled 事件 `{type:'settled', job, cause:'producer'|'kill'|'teardown', awaited}`；dsh-tool-jobs 把 settled 转会话 notice（空闲 owner→followup 唤醒开新轮；忙碌→inject） | dsh-jobs-local/lib/index.js:736-765；dsh-tool-jobs/lib/index.js:256-296 |
| 9 | ✅ `workspace/session-stop` 原生杀该 Session 名下全部 owned job（reason 'session archived'） | dsh-jobs/lib/types/archive-admission.js:18-38 |
| 10 | ✅ jobs-local 纯进程内 Map 无落盘；重启无任何记录（无孤儿对账——ARTEMIS 自建）；Windows 宿主死→Job Object 连带杀子树 | dsh-jobs-local/README.md:32,138 |
| 11 | ✅ `JobHandle.updateProgress(line)`；**无 queued 状态**——排队以 progress 文本表达（run 同步执行，注册即 running） | api-catalog.js:5404；dsh-jobs-local/lib/index.js:430-435 |
| 12 | ✅ JobStatus = running/stopping/completed/killed/failed | api-catalog.js:5468 |

附加：owner session 在 start 时**必须存活**（resolveOwner 否则抛错）；owned job 随 owner disposal 被 cancel（"owner disposed"）；**每 owner 并发 job 上限默认 10**（`maxConcurrentJobsPerOwner`）。

## 二、session / Inbox（12 项）

| # | 结论 | 证据与关键 API |
|---|---|---|
| 1 | ✅ Inbox = **两条**有序列表（`next-turn`/`next-step`）的 durable projection，每次变更落 `agent/inbox/spliced` 事件进 session log；**resume 后不自动开跑**（driver idle，需一次唤醒） | dsh-agent-loop/lib/index.js:26-62,204,1559 |
| 2 | ✅ `followup(input)`（next-turn，FIFO，每 turn 消费 1 条）/ `steer(input)`（next-step）/ `inject`；API 侧还有 `updateQueue` 改/删排队项（对应 ARTEMIS 队列 chip 单独移除） | dsh-agent-loop/lib/index.js:103-119,806-814；dsh-api-session-controller/lib/index.js:882-937 |
| 3 | ✅ **create 接受外部 SessionId**：brandString 任意字符串；API `session.create({sessionId})` 幂等 create-or-adopt（`ensureSession`）；id 经转义成为磁盘目录名 | dsh-agent-loop/lib/index.js:1851-1856；dsh-api-session-controller/lib/index.js:688,253 |
| 4 | ✅ owner-fencing 成立但**仅进程内**（跨进程/durable 后端需自塑身份——单宿主一期无碍） | dsh-jobs/README.md:38-127；dsh-agent/lib/types/index.js:241-243 |
| 5 | ✅ session log v4：JSONL+zstd、一事件一行 `{type,seq,time,data}`、61 种已知事件类型、append-only+fsync+torn-tail 恢复；v3→v4 惰性迁移且 v3 原文件永久保留（真实数据可证） | dsh-session-format-v3-to-v4/lib/index.js:1053-1099；dsh-session/lib/types/known-event-types.js:21-81 |
| 6 | ✅ `resume({resumeSessionId})` 冷读重建；崩溃 turn 由 interruptedTurnClosers 合成 `turn/end{reason:{kind:'interrupted'}}` 收尾，**不重入不重跑**；`sessions.fork()` 原生 fork | dsh-agent-loop/lib/index.js:1921-1978；dsh-session/lib/types/index.js:1064-1077 |
| 7 | ✅ **晚订阅 catch-up 原生**：`readSessionState` 全量 / `Remote("page")` 分页 / `projections` 快照(asOfSeq) / `sessionQuery.read*` 冷读 + live `session/event` | dsh-api-session-controller/lib/index.js:1022-1034,2596-2598 |
| 8 | ⚠️ `dsh-session-query-sqlite` 仅是 FTS5 全文搜索派生索引（可选 openAt）；精确查询走 provider 无关的 `ctx.sessionQuery` | dsh-session-query-sqlite/README.md |
| 9 | ✅ checkpoint-policy = 持久化 flush 屏障（模型请求前/顶层工具执行前/每 pre-step），fail-closed；**非断点续跑**——与 py 侧「无 resume」结论一致，durable 前缀+中断收尾 | dsh-session-checkpoint-policy/README.md |
| 10 | ✅ compaction 原生：阈值 `floor(min(W×0.8, W−O−65536))`、保留最新 16%、`/compact` 命令；被遮蔽内容留在 log（回放确定性） | dsh-compaction-basic/README.md |
| 11 | ✅ 单会话 turn **严格串行**（唯一 driver `while(await turn())`；running 期间 wake 锁存到 turn 结束）——会话 FIFO 队列语义成立 | dsh-agent-loop/lib/index.js:887-901,854-858 |
| 12 | ⚠️ agent status 仅 idle/running；「archived」属 workspace 层；`cancel(cause,{keepInbox})` 确切存在（keepInbox:true 只中止当前 turn 保留 pending）；`workspace/session-stop` 的 cancel **不带 keepInbox（丢队列）** | dsh-agent-loop/lib/index.js:790-798,815-821；dsh-agent/lib/index.js:26-37 |

## 三、插件 / 审批 / 沙箱（12 项）

| # | 结论 | 证据与关键 API |
|---|---|---|
| 1 | ✅ `dsh plugin --profile <name> <pnpm-args>` = 转发 pnpm（add/remove/why；源=pnpm 语义，git 需 profile `pnpm-workspace.yaml` 的 `allowBuilds`）；声明 bundle 的包自动追加进 `dsh.profile.bundles`；另有 `allow-version/revoke-version/version-exemptions` | dsh/lib/bin.js:115-127；dsh-plugin-manager/lib/index.js:237-262 |
| 2 | ✅ `package.json` 声明 `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`（string 或数组）；patch entry 字段 id/name/config/disabled/inject/group；`name` 即 loader import 的模块说明符（双锚解析：dsh 安装目录→profile node_modules） | dsh-app-boot/lib/index.js:468-517 |
| 3 | ✅ peer 兼容强制：`semver.satisfies(runtimeVersion, range, {includePrerelease:true})` 不满足→启动 skip/安装拒（`incompatible-version`）；豁免=profile `compatibility.json` + `--accept-risk`；**官方包惯例=dsh-\* 精确版本号** | dsh-app-boot/lib/index.js:286-322,929-932；dsh-plugin-manager/lib/index.js:1490 |
| 4 | ⚠️ `patchReload:"live"` 字段 rc.2 代码 0 命中（惰性）；真实热重载=`dsh-hmr` 监听 cordis.patch.yml/package.json 免重启 reconcile **配置**；模块代码不监听（root:[] 且 ignored node_modules）→ **配置热、代码冷** | dsh-hmr/lib/index.js:339-370,239-244 |
| 5 | ✅ `--dump-config`：按层合成（bundle 层→profile patch→home patch→--patch），输出带每层来源注释的 entry 树+unmatched-patch 警告；另有 --dump-default-config/--dump-config-schema | dsh/lib/dump-config-BEDI-dNY.js；dsh-app-boot/lib/index.js:3604 |
| 6 | ⚠️ toolview 缝 = **client 侧**：`ctx.slots.inject('tool.call.toolview', …)` + `register({name:'tool.call.toolview', key:'<wire 工具名>'}, Component)`；owner props=ToolCallOwnerProps(callId/toolName/phase/openFile/inspect/loadImage)；`dsh-agent-tool-presentation` 是模型面 native/ptc 配置非 UI | dsh-client-ui-tool/README；dsh-client-ui-cordis/lib/client.js:1446-1453 |
| 7 | ⚠️ HTTP 路由缝 = **`ctx.webServer.register()`**：`{kind:'exact'|'prefix', path, handler(req,res)}` 返回 disposer，另有 registerUpgrade/registerFallback；匹配 exact→最长前缀→fallback；host 仅 127.0.0.1/0.0.0.0，**无自带鉴权**；`ctx.connection` 是浏览器 RPC 非路由 | dsh-host-webserver/lib/index.js:158-208 |
| 8 | ✅ approval preset：`{sandbox: read-only|workspace-write|danger-full-access, approval: ask|never}` + defaultPreset；授权粒度**只有 allowed-once**（无 always/remember）；fail-closed 默认（无 answerer→unavailable→拒绝）；never 在 waterfall 前确定性拒绝 | dsh-permission-presets/README；dsh-user-approval/lib/index.js:31,74,175 |
| 9 | ✅ Windows 沙箱 = `dsh-sandbox-windows-acl` AclSandbox（restricted token+capability SID ACE+Low integrity），**无需 Docker**；模式 read-only/workspace-write/danger-full-access；SANDBOX_UNAVAILABLE fail-closed | dsh-sandbox-windows-acl/README；dsh-sandbox/README:58-60 |
| 10 | ✅ `ctx.webhookRuntime.register(rule)/dispatch(delivery)`；`WebhookSessionRequest{workspacePath,title,prompt,agentPreset,permissionPreset,model?}`→提交=Agent.followup()（source.kind:"webhook"）；**无内建认证——认证归 adapter**（github 适配器=HMAC 验签在 ctx.webServer 路由上） | dsh-webhook/README.md:28-41；dsh-webhook-github/README.md:35-57 |
| 11 | ✅ `AgentOptions{provider, model, reasoningEffort?, maxTokens?}`（per-agent）；采样面仅 temperature/maxTokens/stop；dsh-llm-retry：normal 模式对 EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT 重试 5 次、500ms→10s 指数+10% jitter、尊重 Retry-After、重试前落 `llm/retry` 事件 | dsh-agent/README.md:37-43；dsh-llm-retry README |
| 12 | ✅ `dsh-mcp-client` = DSH 作为 MCP **client** 连外部 server：stdio{command,args,env,cwd}/streamable-http{url,headers}；工具注册 `mcp__<serverName>__<tool>`；重连退避可配、toolCallTimeoutMs 默认 60s、server instructions 进 system prompt；**不支持 MCP prompt templates** | dsh-mcp-client/README |

## 四、SDK / CLI / 调度 / 版本（12 项）

| # | 结论 | 证据与关键 API |
|---|---|---|
| 1 | ✅ CLI：唯一真子命令 `dsh plugin --profile <name> …`；`dsh <name>`≡`--profile`；旗标 --profile/--patch/--dump-config*/-V；内置 profile：web/headless/sdk/sdk-minimal/acp（desktop 保留给 Electron） | dsh/lib/bin.js:105-136 |
| 2 | ✅ SDK = **独立进程 stdio JSON-RPC**（initialize/session/prompt/shutdown + session.event/session.status/subagent.\* 通知）；TS=`@deepseek-ai/dsh-sdk-client`（0.0.1-rc.1）；**Python=`deepseek-harness`（PyPI 0.3.1，版本线高于本地 rc.2，接入前先对齐协议形状）** | dsh-sdk-protocol/README.md:12,38-52；dsh/README.md:5 |
| 3 | ✅ ACP = automation-only agent 侧 server（`dsh --profile acp`，stdio JSON-RPC：session/new/prompt/cancel/request_permission…），面向可信控制器，无认证 | dsh-acp/README.md:12,60-76 |
| 4 | ⚠️ webhook **只有入站**（202 fire-and-forget，无队列/重试/去重/完成回报）；**无出站 webhook**——事件只推给已连接 web 客户端 | dsh-webhook/README.md:71-75 |
| 5 | ✅ dsh-schedule：after/at/every_seconds(≥60s)/daily/weekly/cron(5 字段) 六种 selector、持久化跨重启；**默认关闭**（experimental-schedule-bundle 启用）；**硬依赖 Web Host Session controller（headless/SDK-only 挂不上）** | dsh-schedule/README.md:26-37 |
| 6 | ✅ web profile：默认 **127.0.0.1:3080**（--host/--port/--no-open）；认证=启动 URL 一次性 token→签名 cookie 覆盖 API+WS；三层热更新（dsh-hmr 配置层 / dsh-client-hmr 浏览器无刷新 / SSE `/plugins/events`） | dsh-web-app/cordis.patch.yml:173-174；dsh-web-app/lib/startup.js:22 |
| 7 | ✅ desktop-host=Electron 壳的 Node 宿主；headless=一次性运行（`--json` NDJSON：session/status/text/thinking/tool_call/tool_result/final；--session-id 续聊；exit 0/1） | dsh-headless/README.md:12,58 |
| 8 | ✅ token-meter：`ctx.tokenMeter.measure()` → tokenUsage/contextPressure/contextBreakdown；启发式≈4 字符/token，**CJK/JSON 明显低估** | dsh-token-meter/README.md:36-55 |
| 9 | ✅ subagent：`ctx.subagents` 具名 provider（spawn=干净子代理 / fork=父对话已完成 turns 快照）；maxDepth 默认 1、maxActiveSubagents 默认 8 | dsh-subagent-fork-in-process/README.md:12-24 |
| 10 | ✅ 配置层级：bundle patches→profile cordis.patch.yml→home patch→--patch；settings.yaml.imported=旧版一次性导入残留 | dsh/README.md:41-48；dsh-settings/README.md |
| 11 | ⚠️ workflow/workflow-ptc = 模型提交 JS 编排脚本（agent()/parallel()/pipeline()），**阻塞父 turn、同步、无持久化**——不是任务队列，勿与 Inbox/schedule 混淆 | dsh-workflow/README.md:32-53 |
| 12 | ✅ 279 个 dsh* 包全部 0.2.0-rc.2；peerDeps 惯例：dsh-\* 精确版本、cordis ~4.0.4；自研插件 peerDependencies 建议精确 pin + 升级走 conformance | 全树 package.json |

## 方案修改对照（第一轮，已回写 todo.md）

| 位置 | 修改 |

| 位置 | 修改 |
|---|---|
| S1 | spike 降级为接入验证（外部 SessionId 已核实可行，幂等 adopt） |
| S2 | bash kind→自写 producer（kind `artemis-worker`）；outcome 映射归 producer done；ring/spill 容量限制；session-stop 丢队列→用 cancel({keepInbox}) |
| S5 | 新增 env scrub 警告：凭据组（*KEY/*TOKEN 等）须显式经 request.env 传入 |
| S6 | headless 全 never 需显式 patch 配置（否则是 fail-closed 拒绝而非 never） |
| D5 | 「原生续派」改为「原生恢复待派 + 显式唤醒」；中断收尾=interrupted 事件投影 failed |
| D6/D7 | 补核实结论（peer 强制机制/官方精确 pin 惯例/安装流/dump-config） |
| G2 | toolview=client 侧 slot 插件（非 host 侧、非 tool-presentation） |
| G6 | ✅ 关闭：Windows ACL 沙箱无需 Docker；进程树杀=TerminateJobObject（印证 G10 必要性） |
| G9 | 增 env scrub 断言项 |
| G20 | ✅ 关闭：catch-up 原生支持 |
| G21 | 明确：DSH 无出站 webhook，通知适配全插件侧 |
| 映射表 | media 行 `ctx.connection.fetch`→`ctx.webServer.register()`；/api/run 行补 SDK 主选+webhook 单向；mcp_server 行增 mcp-client 直连选项（二期评估） |
| P0 | 开发流改「配置热重载、代码冷重启」；S2 spike 增 producer 样板验证 |
| P3 | 补 web profile 默认端口 3080 与一次性 token 认证 |

## 五、第二轮核查：防重复自建（2026-10-09，19 项）

> 动机：第一轮核实「计划依赖的假设」，本轮核查「计划里仍标注自建的东西，DSH 是否已有更优实现」。范围：UI 聚合层 / 并发原语 / 持久终端 / 凭据 / hooks / 超时 / 媒体展示 / 存储原语。

### 5.1 UI 聚合与并发（G19/S3 相关）

| # | 结论 | 证据与关键 API |
|---|---|---|
| 1 | ✅ **排队消息 UI 原生存在（QueueDock）——ARTEMIS dock 队列的等价物**：排队计数「{n} 条排队消息」、每行 edit/remove/steer 三键（steer 仅运行中可用）、走 `conversation.updateQueue(itemId,{kind:"edit"/"remove"/"steer"})`；slot `conversation.input.dock`（id queue, order 20） | dsh-client-ui-conversation/lib/client.js:15369,15677-15696 |
| 2 | ⚠️ round 概念部分原生：goal_round driver 有 `attempt.phase queued/claimed`、`roundsStarted` 计数、`goal.phase active/paused/complete/blocked`；但 **UI 无轮次时间线组件**、排队 goal 轮在 dock 里与普通消息无视觉区分 | dsh-goal-round-driver/lib/index.js:135-160；dsh-client-ui-chat/lib/client.js:6626 |
| 3 | ✅ slots 全集约 **70 个缝**；关键的：`conversation.view/chat.node/chat.turnTail/input.dock/input.overlay/composer(.bar/.dock)/session.header.{actions,utilities,corner,lineage}/approval.detail/tool.call.toolview(keyed)/sidebar.right.pane.tab/settings.general.item/shell.overlay` 等 | dsh-client-ui-slots/lib/index.js:50；dsh-client-ui-layout/lib/client.js:604-627 |
| 4 | ✅ jobs UI 原生：会话头按钮 roster（`conversation.session.header.actions`），数据 `job.list`/`job.follow`/`job.kill`，两段式 stop，无 job 不渲染 | dsh-client-ui-jobs/lib/client.js:610 + README |
| 5 | ⚠️ **无库级 semaphore/mutex/p-queue**（全树 grep 0 命中）：闸门地基=弱表 promise 链（官方样板 `dsh-tool-bash-persistent/lib/index.js:325-333`：WeakMap<owner,Promise> 尾链；tracked pending 模式 :179-237 支持取消）+ `dsh-deque` 环形队列 | dsh-deque/lib/index.js（86 行）；dsh-chunked-list |
| 6 | ⚠️ persistent shell **工具**（bash/pwsh-persistent）不支持交互 stdin（读 stdin 的前台子进程挂到 timeout）；per-agent 单 shell、命令串行 | dsh-tool-bash-persistent/README.md |
| 7 | ✅ **`ctx.terminals` 服务层才是持久终端正解**：`spawn/startSend(交互 stdin)/read(有界 scrollback)/signal/abortAndClose/close`，per-owner 多实例，backend=shell（POSIX bash/Windows pwsh），输出可编程读取——正是 ARTEMIS `run_adb_command` 持久终端+stdin 的形态。注意用户面右侧栏终端（remote.terminal）是另一套、不进 transcript | dsh-terminal/lib/index.js:91-199；dsh-api-terminal-controller/README.md |
| 8 | ✅ dsh-output-retention = 模型面工具输出保留库（ItemRetainer head 窗+omitted 计数 / TextRetainer head/tail 字节窗 UTF-8 安全切）——自定义工具输出窗口化直接用 | dsh-output-retention/lib/index.js |
| 9 | ✅ 一个 session 一个 goal（GOAL_ALREADY_EXISTS；多 goal 排队串行）——ARTEMIS 一次提交多 goal = 多条 followup | dsh-goal/lib/index.js:639,90-100 |

### 5.2 平台工具件（凭据/hooks/超时/媒体/存储）

| # | 结论 | 证据与关键 API |
|---|---|---|
| 1 | ✅ **凭据管理原生**：`ctx.credentials.resolve/describe(永不回值)/set/unset` + records 枚举（`credentialKey('<owner>/<id>')`）+ `<DSH_HOME>/.credentials.yaml`（precedence：启动 env > 存储文件 > 项目 .env > home .env，watch 热载，rotation 即时生效）；配置用 `apiKeyEnv` 引用。**缺**：连通性测试（seam 不发网络请求，自建一小块）；refs 不可枚举（用 records 存 provider 清单） | dsh-credentials/lib/index.js:7-104；dsh-credentials-local/README |
| 2 | ⚠️→✅ **原生工具拦截缝存在且强**：`tools/pre-execute` waterfall → Decision `{allow/deny(reason)/ask/cancel}`，ask 经 `approval.request→'allowed-once'|'rejected'|'cancelled'|'unavailable'`；`tools/post-execute` 可替换输出；轻量版 `ctx.tools.guard`（返回 string 即 deny）；`ctx.tools.restrict({allow,deny})`。**dsh-hook-protocol/-hooks-claude-code/-hooks-codex 是存量 hooks 兼容层（其 updatedInput/continue:false 不生效）——原生插件勿走** | dsh-tools/lib/types/index.js:876-900,1097-1144,513-525 |
| 3 | ✅ **工具超时原生且语义正确**：`ToolDefinition.timeoutMs`（每工具声明，无全局默认）→ wrapper 以 `deadline(exec.signal, timeoutMs,'TOOL_TIMEOUT')` 融合信号，超时→模型收结构化 `TOOL_TIMEOUT` 错误。**契约：工具内部必须监听 exec.signal 主动杀进程**，否则超时静默失效（不崩会话但挂住调用方）——正是 ARTEMIS「超时必须工具内生效」教训的 DSH 版 | dsh-tools/lib/types/index.js:468-471,975；dsh-timeout/README |
| 4 | ⚠️ 媒体展示：**`present(files[])` 工具 → deliverables 卡片**是最优承载（持久、`deliverables/presented` 事件可重放、右 Sidebar 预览/系统播放器打开）；attachment 管线只对**用户上传图片**做入库+模型直读；**mp4 无专门处理、聊天流内嵌播放器无现成物**（要内嵌需 client UI 扩展） | dsh-tool-present/lib/index.js:116；dsh-client-ui-deliverables |
| 5 | ✅ 插件状态持久化不手写：`ctx.storageDomain.defineDomain({name,version,tables(zod)})` → durable 写 + `domain/changed` 事件 + per-domain 写链（host-side only）；裸文件用 `dsh-atomic-write` 的 `writeFileAtomic` + `withFileLock`（跨进程锁；无 fsync） | dsh-storage-domain/README；dsh-atomic-write/README |
| 6 | ⚠️ dsh-http-proxy 仅出站 HTTP 代理（env 一次性解析，覆盖 LLM/web/MCP 流量，无 SOCKS/PAC/会话级）——与模型路由无关；本地 LM Studio/OpenAI 兼容端点直接配 dsh-llm(pi-ai) 适配器 + apiKeyEnv | dsh-http-proxy/README |
| 7 | ⚠️ dsh-fs-observation-policy 名字有误导：是 read-before-edit **写护栏**（fs/write-intent、FS_NOT_OBSERVED/FS_STALE_VERSION），不观察目录、不影响 bash 落盘（设备截图目录无涉） | dsh-fs-observation-policy/README |
| 8 | ✅ session-stats 原生：turns/steps/llmMs/toolMs/ttftMs/ttftSteps/decodeMs/decodeTokens 八指标全 log 折叠投影（对照 ARTEMIS usage 端点）+ token-meter 三投影 | dsh-session-stats/README |
| 9 | 一句话：auto-review=实验性 per-tool-call LLM 审查（三期审批参考实现）；persona=preset 内 per-agent 人设行；`ctx.systemPrompt` registry=一期注入 autogamer 操作指引的挂点；invariants=运行时自检注册表（调试用） | 各包 README |
| 10 | ✅ 用户文件上传端到端原生（`ctx.fileUpload.upload` 进度/取消 + Host staged receipt + admission 落 attachments）——二期用户附图无需自建路由 | dsh-client-file-upload；dsh-attachment-local |

### 5.3 对方案的最终影响（已回写 todo.md）

1. **G19 缩小 70%**：QueueDock（排队 chips/编辑/插队）+ jobs 头部 roster + timeline 按 turn/step 分组 + goal 轮 turn-trigger 卡全部原生；插件侧只剩「轮次时间线视图、排队 goal 轮视觉区分、轮状态徽标」，挂 `conversation.chat.node`/`chat.turnTail`，数据源 `goal` projection。
2. **凭据管理删自建**（二期）：dsh-credentials 承接存储/掩码/rotation/分层；自建仅连通性测试。
3. **S3 闸门地基明确**：弱表 promise 链样板 + Deque + tracked pending；状态持久化用 ctx.storageDomain（不手写 JSON）。
4. **二期模式 a 的闸门/审批前置有原生缝**：tools/pre-execute Decision（deny/ask），不必包一层工具；hook-protocol 兼容层勿用。
5. **run_adb_command 持久终端建在 ctx.terminals**（非 persistent shell 工具）。
6. **媒体展示面 = present 卡片优先**；内嵌播放器需 client UI 扩展（产品决策项）。
7. **超时契约**：自定义工具必须声明 timeoutMs 并监听 exec.signal 主动杀——写入 autogamer-device 工具规范。

## 六、第三轮补充核实：轮次执行 shim（2026-10-09，主代理直查）

> 盲区：方案定义了「用户消息 = followup 进 Inbox」，但没写**谁来把这条消息变成 job**——不处理的话每轮会跑一次普通 LLM 对话（无效实现）。六个发现：

| # | 发现 | 证据 |
|---|---|---|
| 1 | ✅ **自定义 Agent 实现是一等缝**：agent-loop README 明言 "Choose a custom Agent implementation only when the standard 'call model, run tools, repeat' lifecycle is insufficient"；`dsh-agent` 源码图有 **factory slot**（AgentRegistry factory provider——官方 ReactLoopAgent 即此挂法；provider unload 会停掉其创建的全部 handle） | dsh-agent-loop/README.md:28 Summary；dsh-agent/README.md:97,118 |
| 2 | ✅ **创建 agent 不强制 model**："a model call additionally requires both provider and model"——只约束 dispatch；`agent/request` waterfall 可在派发前补/改 provider-model | dsh-agent-loop/README.md:32,51 |
| 3 | ✅ **`agent/pre-step` 拒绝 = 不开 step = 不调模型**（"A rejected decision or empty first batch opens no step"）——标准 loop 的最小拦截缝 | dsh-agent-loop/README.md:119 |
| 4 | ✅ inbox 生命周期事件 host 侧可订阅：`agent/inbox/inserted {message}` / `claimed {message, turn}` / `discarded`；Inbox API（append/prepend/replace/remove/clear/splice）= updateQueue 同源，remove/clear 是 durable 取消 | dsh-agent/README.md:91 |
| 5 | ⚠️ **`ctx.jobs.start()` 必须挂 `dsh-tool-jobs` 才被武装**（"this plugin's controller is what arms producers' ctx.jobs.start()"）；`completionDelivery: quiet` 关闭模型通知、`maxConsecutiveWakes` 限自唤醒链；完成通知两形态：busy→注入下一步、idle→followup 唤醒新轮 | dsh-tool-jobs/README.md |
| 6 | ⚠️ 无 tool_choice 强制（前轮已确认采样面只有 temperature/maxTokens/stop）——tool-mediated 路线的「模型必调工具」只能靠 instructions 约束 | 前轮 §三.11 |

**三条候选路线与推荐**：

- **B1 插件直派（推荐）**：autogamer-queue 经 factory slot 注册自定义 driver——claim 到 next-turn 不调模型，直接闸门→spawn job→await settle→把结果写回会话（tool/call+result 对）。零 LLM 成本；turn/step/tool 事件由我们发，toolview/时间线天然有数据。风险：driver 细节工作量（事件正确性、prompt 装配最简化）。
- **B2 备选**：标准 loop + preset 不配 model + `agent/pre-step` 一律拒绝。自定义代码最少，但 claim 后无 step 的消息归属（是否入 history、下轮可见性）需 spike 核实。
- **A 兜底**：preset 极简 instructions + spawn 工具（每轮一次廉价 LLM 调用）。B1/B2 spike 失败才退到这里；无 tool_choice 是固有跑偏风险。

**任一路线通用**：composition 必须挂 dsh-tool-jobs（武装 job 启动）；`maxConcurrentJobsPerOwner` 默认 10；autogamer preset 的 approval 对 spawn 工具应为 never（它就是产品动作本身）。

## 七、主流 agent harness 任务调用范式调研（2026-10-09，web 调研）

> 动机：§六的 S10-B1（自定义 Agent factory driver）疑点=逆主流、维护面大。调研四个主流样本验证。

| 样本 | 任务调用方式 | 会话连续性 | 队列在哪 | turn 能否绕过模型 |
|---|---|---|---|---|
| Claude Code | `claude -p "goal" --output-format stream-json`（headless=任务单元） | `--resume <sid>` / `--continue` | **harness 外**（CI/调用方） | ❌ 无此概念 |
| Codex CLI | `codex exec "goal"`（"bounded agent workflow" 出结构化结果+确定性退出码） | session 参数 | harness 外 | ❌ |
| Gemini CLI | `gemini -p "goal"` | session flag | harness 外 | ❌ |
| ACP（编辑器↔agent） | client 启动 agent 子进程 → `session/new` → `session/prompt` 流式 | session 对象 | client 侧 | ❌（agent=LLM loop 是定义） |
| OpenClaw 网关 | Gateway（WS server）收消息（聊天平台/webhook/cron）→ 路由给 Agent runtime | 会话由 runtime 管 | **Gateway 层**（网关自带队列/路由） | ❌ |
| DSH | `dsh --profile headless "task"`（NDJSON 事件、exit 0/1）/ SDK stdio / web Inbox | `--session-id` resume | Inbox（harness 内，异类但可用） | ⚠️ 仅经 factory slot 自定义 driver（内部缝） |

**铁律**：主流世界从不改造 harness 的 turn 模型——把「一次 harness 调用」当任务，队列/调度/重试全部在调用方或网关层。`dsh headless` 与 `claude -p`/`codex exec` 完全同构，且 DSH 已自带。

**对 S10 的影响（路线重排）**：
1. **甲·headless-per-task（主流对齐首选）**：autogamer-queue 收提交 → 自建 durable 队列（storageDomain）+ 设备闸门 → spawn `dsh --profile headless --session-id <conversation> "goal"` 为 job → NDJSON 进 output ring → 退出码判终态。会话记忆原生延续；**运行中信息面 = job roster+progress+output ring，与一期 py worker 黑盒完全同构**（G2 降级已是接受项）；QueueDock/Inbox 不承担排队（排队在插件队列）。
2. **乙·tool-mediated（UI 体验完整选）**：即 §六路线 A——Inbox+QueueDock 原生排队 UI、turn/时间线全原生，代价每轮一次廉价本地 LLM 调用。
3. **丙·B1 自定义 driver 降级为最后手段**（零 LLM 成本但逆主流、贴内部缝、rc.2 升级脆弱）。
4. **二期换壳洞察**：甲方案下 **py worker ⇆ dsh headless 是对等可换壳物**——同一 job 命令从 py worker 换成 dsh headless agent（带 autogamer-device MCP 工具）即模式 a 的最平滑渐进入口，先换壳再拆逻辑。

来源：[Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)、[Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness)、[Harness Engineering: Headless mode](https://www.zyte.com/blog/harness-engineering-3-headless-mode-the-minimal-agent-harness)、[ACP Architecture](https://agentclientprotocol.com/get-started/architecture)、[OpenClaw Architecture](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)、[Claude Code headless](https://mcpmarket.com/tools/skills/headless-mode-for-claude-code)

## 八、业界「普通 agent + 外部机制约束」模式调研（2026-10-09，web 调研）

> 动机：验证 S11「单层 agent + 确定性路由」是否业界正确形态。结论：**是，且是收敛方向**——研究趋势明确反对「反思式自检」（模型审查自己不可靠），支持 verifier 驱动 + 逻辑化守卫。

| # | 机制（按约束力排序） | 业界出处 | S11 对应 |
|---|---|---|---|
| 1 | 确定性代码包住模型（workflows：代码编排 LLM 调用，模型只填参数） | Anthropic「Building Effective Agents」五模式（routing/parallelization/evaluator-optimizer…）；「workflows 给可控性、agents 给开放性」 | S11 路由器 = 动作级 workflow |
| 2 | **逻辑驱动的动作验证**（明确批评 reflection 式自检，提出逻辑化守卫） | arXiv 2503.18492「Safeguarding Mobile GUI Agent via Logic-based Action Verification」 | S11 前置校验/失败阈值门=逻辑守卫；validator subagent 只做语义层 |
| 3 | Verifier 驱动范式（验证者一等公民 + 离散化动作空间） | arXiv 2503.15937「Verifier-Driven Mobile GUI Agents」+ evaluator-optimizer 模式 | S11 checker subagent + run_outcome 记账；ARTEMIS 结构化动作集即离散动作空间 |
| 4 | **动作效果验证**（post-action effect check：屏幕真的变了吗） | ACL 2026「Action-Effect Verification and Self-Refinement」 | **S11 采纳升级**：路由器执行后以效果信号（屏幕差分/dHash，py utils 已有 image_diff/image_hash）确认生效，未生效=失败路径检测信号 |
| 5 | 分层反思（长程失败复盘） | MobileUse hierarchical reflection / GUI-Reflection | S11 checker 里程碑审计为粗粒度对应；不做模型自反思（与 #2 立场一致） |
| 6 | 代码模式/PTC（模型写代码确定性调用工具：98% token 节省+确定性控制流） | Anthropic PTC / code-execution-with-MCP；**DSH 原生对应=dsh-workflow + dsh-ptc-runtime（已解包核实）** | 一期不需要（py worker click_sequence/burst 已覆盖确定性动作串）；三期把动作 burst 迁 PTC 的现成机制 |

来源：[Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)、[Logic-based Action Verification](https://arxiv.org/html/2503.18492v1)、[Verifier-Driven Mobile GUI Agents](https://arxiv.org/html/2503.15937v4)、[Action-Effect Verification (ACL 2026)](https://aclanthology.org/2026.acl-long.1335.pdf)、[MobileUse hierarchical reflection](https://openreview.net/pdf?id=KR6tnkb6h4)、[Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)、[Programmatic Tool Calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
