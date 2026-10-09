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

## 方案修改对照（已回写 todo.md）

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
