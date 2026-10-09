# 迁移盘点 · 智能栈与配置

> 范围: worker 进程入口/启动退出契约、`artemis/agents/**`、`artemis/graph/**`、`artemis/llm/**` + `services/llm.py` + `token_meter`、`artemis/memory/**`、`artemis/tools/**`、`artemis/config/**` + `admin_console/services/model_service.py` + `task_preset_catalog.py`。
> 基线: cc6b20c；日期: 2026-10-09。
> 覆盖标注约定:【已覆盖 D#/S#/G#】= todo.md 已记录，此处不展开；【缺失】= todo.md 未写、无人记录即丢；【矛盾】= 与 todo.md 现有条目冲突，需修订；【部分】= 有条目但语义细节缺。
> 处置: ①一期黑盒保留 py / ②二期 DSH 重写 / ③DSH 原生承接 / ④需决策。

---

## 1. worker 启动与退出契约（S5/S2 的输入，最优先）

### 1.1 进程链与入口

- 队列 worker 的真实命令行: `python -m artemis.main <goal> --profile <pro|flash> --test-name web_<ts>_<run8> [--session-id --output-description --enable/disable-outputter --verification-level --explorer-pro-mode --locked-app --app-path --device-serial]`。由 `task_queue_service._build_worker_invocation` 组装（apps/admin_console/services/task_queue_service.py:578-663）。
- `artemis/main.py:40-54` 把无子命令的 `python -m artemis.main "goal"` 归一化为 `run "goal"`。
- `run_command`（artemis/interfaces/cli/commands/run.py:304-311）以 `ARTEMIS_TASK_WORKER=1` 或 `ARTEMIS_DEVICE_QUEUE_TICKET` 存在判定"我是 worker"，跳过 Daemon 派发分支直接本地执行。**DSH bash job 直接跑 `python -m artemis.main` 时若不设 `ARTEMIS_TASK_WORKER=1`，会走 Daemon 派发分支**（自动起 daemon、提交、轮询 1800s）——S5 说"入口不变"，但没写这个开关是进入 worker 语义的钥匙。【缺失】
- 执行链: `run_command` → `execute_task`（run.py:44-166，读 env 选 serial/装配 config builder）→ `run_automation`（third_party/mobile_use/main.py:90-130）→ `artemis.sdk.agent.Agent(config, session_id)` → `agent.init(ARTEMIS_HEALTH_RETRIES=5, ARTEMIS_HEALTH_DELAY=2)` → `run_task` → `_run_task`（third_party/mobile_use/sdk/agent.py:394-796）。【缺失】

### 1.2 启动顺序与 start_session 边界（时序不变量）

`_run_task` 内部顺序（third_party/mobile_use/sdk/agent.py:471-560）：
1. 解析 task_id/session（`self._session_id or ARTEMIS_SESSION_ID or ARTEMIS_CLOUD_SESSION_ID or uuid4`，agent.py:419-424；`artemis/sdk/agent.py:95-98` 同序）。
2. **设备锁获取**：`DeviceExecutionLock.acquire`（除非 `already_held`——锁 active owner 的 pid==本进程 且 session/token 匹配，即队列票据已定；agent.py:471-513）。锁 `description=goal[:120]`，`ingress=ARTEMIS_TASK_INGRESS`。取消时经 `queue_cancel_event` 排空后重抛。
3. **才** `_prepare_tracing` → `DataEngine(ctx)` + `data_engine.start_session(goal, device_info, session_id)`（artemis/sdk/agent.py:287-344）。注释明确："Session creation must be inside the same boundary ... a queued task must not publish a new active session while the current task is still finishing"（agent.py:514-520）。
4. 连接 screen client（helper 安装/升级事件在此发出）→ keyguard 检查（锁定则拒绝执行，绝不猜 PIN，agent.py:215-237）→ app 安装 → Chrome Web Accessibility 强制标志（写 /data/local/tmp chrome-command-line + `am force-stop com.android.chrome`，agent.py:239-285——**设备变更，无人审批**）→ 屏幕录制启动。
5. profile 分叉：`flash` → FlashRunner；否则 langgraph `get_graph(context).astream(...)`，`recursion_limit=request.max_steps`（agent.py:602-625）。

【缺失】todo.md 只有"DataEngine.start_session 持久化"一句话（AGENTS.md 有），**锁→start_session 的先后边界**是"排队任务不得提前发布 active session"这条不变量的载体，DSH 侧必须保住等价语义（job 只有在闸门放行后才算 session 开始）。

### 1.3 env 变量全集（worker 读到的）

来源三处：队列注入（task_queue_service.py:597-662）、worker 自身读取（artemis/config/constants.py:24-83）、config 层（settings.py）。按语义分组：

| 组 | 变量 | 语义 | 证据 |
|---|---|---|---|
| 身份 | `ARTEMIS_SESSION_ID`（回退 `ARTEMIS_CLOUD_SESSION_ID`） | 会话 UUID；trace 目录名 + DataEngine 主键 + cancel marker key | sdk/agent.py:95-98, 326-338 |
| 身份 | `ARTEMIS_CONVERSATION_ID` | 会话续聊线程；worker 据此查同线程上一完成任务的 notes 注入 planner（见 §2.6.4） | sdk/agent.py:362-374; task_queue_service.py:613-617 |
| 身份 | `ARTEMIS_SUBMITTED_AT` | 入队墙钟；仅 console 排序用，engine 侧再持久化 | task_queue_service.py:618-623 |
| 身份 | `ARTEMIS_TASK_INGRESS` | 提交渠道标记（cli/frontend/...），进锁 description 与 device_info | run.py:92-93; task_queue_service.py:611 |
| 模式 | `ARTEMIS_TASK_WORKER=1` | **worker 语义开关**（跳过 daemon 派发） | run.py:304-307 |
| 模式 | `ARTEMIS_DEVICE_QUEUE_TICKET` | 队列票据；worker 侧 `already_held` 判定输入之一 | run.py:306; sdk/agent.py:471-479 |
| 模式 | `ARTEMIS_STANDALONE=1` | 嵌入模式，不起 daemon | run.py:308 |
| 模型 | `ARTEMIS_MODEL_ENDPOINT` | 端点库记录名 pin（见 §2.2）；未知名字 **RuntimeError 拒启** | config/llm.py:215-242 |
| 设备 | `ADB_DEVICE_SERIAL` / `ADB_HOST` / `ADB_PORT` / `ADB_SERVER_SOCKET` | 设备与 ADB 寻址 | constants.py:49-53; run.py:137-146 |
| 设备 | `ARTEMIS_HIERARCHY_BACKEND`（auto/helper/uiautomator） | UI 层级后端 | constants.py:54-55 |
| 设备 | `ARTEMIS_HELPER_AUTO_INSTALL`（默认 true） | 允许任务在持有的设备上安装/升级辅助 APK；false = 只附着 | constants.py:56-58 |
| 设备 | `ARTEMIS_KEEP_DEVICE_AWAKE`（默认 true） | 屏幕常亮服务开关 | runtime/awake_service.py:41 |
| 执行 | `ARTEMIS_DEFAULT_PROFILE`（默认 pro）/ `ARTEMIS_DEFAULT_MODEL` | CLI 未显式时的默认 | constants.py:75-76, 118-119 |
| 执行 | `ARTEMIS_EXPLORER_VERSION` | Explorer 层级 env 覆盖（优先级高于配置文件，低于显式参数） | config/agent.py:365-367 |
| 执行 | `ARTEMIS_CHECKER_ENABLED` / `ARTEMIS_COMMITTEE_ENABLED` / `ARTEMIS_PLANNER_VALIDATION_ENABLED` / `ARTEMIS_OUTPUTTER_ENABLED` / `ARTEMIS_VIDEO_RECORDING_ENABLED`(=`ARTEMIS_WITH_VIDEO_RECORDING_TOOLS`) / `ARTEMIS_VIDEO_LEDGER_ENABLED` | 运行时开关，**最高优先级**（压过 artemis.jsonc） | config/agent.py:977-1018 |
| 执行 | `ARTEMIS_EXPLORER_CACHING`（settings.EXPLORER_CACHING） | Explorer context caching env 覆盖 | settings.py:132-138 |
| 可靠性 | `LLM_PAUSE_TIMEOUT_SECONDS`（默认 900，≤0 永久等待） | LLM 重试耗尽后暂停死限（见 §2.3.3） | settings.py:141-148 |
| 健康检查 | `ARTEMIS_HEALTH_RETRIES`(5) / `ARTEMIS_HEALTH_DELAY`(2) | agent.init 的设备就绪重试 | third_party/mobile_use/main.py:105-108 |
| 测试 | `ARTEMIS_FAKE_LLM=1` / `ARTEMIS_FAKE_LLM_DELAY_S` | 全模型替换为 FakeChatModel；同时跳过连接预热 | llm/router.py:215-223; sdk/agent.py:131-136 |
| 调试 | `ARTEMIS_DEBUG` / `ARTEMIS_STRICT_STATE`(测试) / `KEEP_VIDEOS` / `EVENTS_OUTPUT_PATH` / `RESULTS_OUTPUT_PATH` | 调试与产物路径；`RESULTS_OUTPUT_PATH` 有值则结构化输出额外落盘 | constants.py:80-83; third_party/mobile_use/main.py:123-125 |
| 凭证 | `GOOGLE_API_KEY`/`GEMINI_API_KEY`/`GCP_API_KEY`/`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`ANTHROPIC_API_KEY`/`OPEN_ROUTER_API_KEY`/`XAI_API_KEY`/`OCR_API_KEY`/`VISION_API_KEY` + `credential_bindings.json` 自定义名映射 | provider 凭证；placeholder 值清洗；Google/Gemini/GCP 三键互通 | settings.py:61-91, 157-216, 335-366 |
| 进程 | `ARTEMIS_IPC_PORT` | worker→daemon 事件总线端口（startup_progress/checker_event/llm_retry 等结构化事件走这里） | config/runtime.py:41; task_queue_service.py:607-608 |
| 进程 | `ARTEMIS_CANCEL_GRACE_SECONDS`（队列侧，默认 45） | 优雅取消宽限，超时硬杀进程树 | task_queue_service.py:73, 98-110 |

【部分】S5 只列了 `ARTEMIS_CONVERSATION_ID`/`ARTEMIS_SESSION_ID`/goal/profile/model_endpoint 四个。上表全集（尤其 `ARTEMIS_TASK_WORKER`、`ARTEMIS_DEVICE_QUEUE_TICKET`、`ARTEMIS_IPC_PORT`、`LLM_PAUSE_TIMEOUT_SECONDS`、凭证组）是 DSH job 侧复制环境的最小集合，**漏掉 `ARTEMIS_TASK_WORKER=1` 会导致 worker 走错分支**。

### 1.4 退出码语义（S2 映射的直接输入）【矛盾，最重要发现】

**py 真相：退出码不编码任务结果，只编码进程结局。**

| 结局 | 退出码 | stdout/stderr 表现 | DataEngine 会话状态 |
|---|---|---|---|
| graph/flash 正常跑完（含 verifier 判 blocked、flash 自报 failed） | **0** | 正常日志；blocked 时仅一行 `logger.warning("[..] Task ended blocked: ...")` | `failed`（end_session("failed")，third_party/mobile_use/sdk/agent.py:663-677, 588-599） |
| graph 正常跑完且通过 | 0 | `✅ Automation ... is success ✅` | `completed`（agent.py:686-689） |
| 运行中异常（设备/LLM/代码） | 1（traceback 入 stderr） | `Task execution failed: ...`（run.py:463-464）；API key 类错误另有 Panel + SystemExit(1)（run.py:449-461） | `failed` |
| Ctrl+C / SIGTERM / cancel marker | **130**（run.py:442-446, 472-473） | 无 | `cancelled`（CancelledError 路径，agent.py:727-739） |
| 队列侧硬杀（宽限 45s 超时） | 非零（强杀） | — | 视 DB 既有状态 |

队列侧的裁决函数 `_resolve_terminal_status`（task_queue_service.py:310-333）：**DB 终态优先（success→completed 归一），退出码只是"会话从未到达终态"时的回退**（0→completed，非0→failed）；手动停止一律 cancelled。

**与 S2 的矛盾**：S2 写"退出码 0 → completed；非 0 → failed（detail = stdout 错误尾行）"。按 py 行为，**verifier 判 blocked / flash 自报 failed / assert 有失败但任务完成的任务都退出 0**——DSH job 侧会把它们标成 `completed`，与 DataEngine 的 `failed` 漂移。一期兼容做法（按 S5"py 零改动"约束）二选一：
- DSH job outcome 判定改为：stdout 扫描 `Task ended blocked` / `Task execution failed` 等特征行 + 退出码联合判定（近似 `_classify_failure` 的文本扫描）；
- 或承认"job outcome 只是 UI 层，任务终态以 DataEngine DB 行为准"（S5 已写"终态留痕由 DataEngine 写入"），DSH completed/failed 展示层标注"以 trace 为准"。【需决策，建议后者为主、前者为辅】

另有细节：`assert` 失败（strict 校验断言）在预算内不回流、任务仍 `completed`，只是 run_outcome.tests.failed>0（agent.py:679-687）；只有 verify 未满足耗尽预算才 `blocked→failed`。

### 1.5 取消协议（cancel marker 文件）【矛盾】

- 队列无法可移植地给 worker 发信号 → 写 marker 文件（临时目录，session/pid 双键，TTL 3600s，**pid marker 记录进程创建时间防 PID 复用**）；worker 内 `watch_for_cancel_request` 轮询，命中即走与 Ctrl+C 相同的优雅路径：停录屏并 remux、编译 trace 目录、释放设备锁（artemis/sdk/agent.py:183-204；artemis/runtime/cancel_requests.py:40-142；task_queue_service.py:124-159）。
- Windows 上外部 TerminateProcess 不会触发 Python 的 SIGTERM 处理（run.py:407-415 的 SIGTERM→KeyboardInterrupt 钩子在 Windows 只对 `os.kill` 类信号有效）；**优雅取消在 Windows 只能走 marker 文件**。
- **矛盾**：todo.md 模块映射 C 区把 `cancel_requests` 标为"✅ 删除（`JobRegistry.kill`/`agent.cancel` 原生承接）"。一期 py worker 黑盒运行时，若 DSH `JobRegistry.kill` 在 Windows 走进程树强杀，录屏 remux/trace 编译/锁释放全部跳过，且 worker 不会写 `cancelled` 终态。**取消通道在一期必须保留：DSH 侧 kill 前先写 cancel marker（或复用 `request_cancel`），宽限 `ARTEMIS_CANCEL_GRACE_SECONDS` 后再硬杀。**【需修订 todo.md + 纳入 P1 spike】

### 1.6 stdout 面（job output ring 能看到什么）

- 进程创建 `stderr→STDOUT` 合并，console 输出 tee 进 trace 的 stdout.log（apps/admin_console/services/worker_process_io.py:41-104）。
- rich console 进度（排队/执行中/成功/失败）、loguru 日志、异常 traceback 是 ring 的全部内容。
- **结构化事件不走 stdout**：thinking/toolcall/llm_retry/checker_event/startup_progress 走 `engine._publish` → IPC(SSE)（services/llm.py:184-195, 231-241；graph/checkpoints.py:70-72）。一期 G2 已接受降级；若要做"JSONL 结构化事件 + toolview"（G2 可选项），挂点在 `_publish`/`publish_startup_progress`，py 一期零新增则该选项不可用，需二期。【已覆盖 G2，补充挂点位置】
- **机器可读最终结果只进 DB**：`_extract_output` 的返回值在 CLI 被丢弃（run.py 不消费 execute_task 返回值）；结构化 output/outputter 报告由 DataEngine 会话行承载。DSH 侧要拿最终回答只能读 DB 或 stdout 特征行。【缺失，建议记入 S2】

---

## 2. 行为与不变量（按主题）

### 2.1 profile 系统（config/agent.py）

两个执行 profile + 一组组件开关，配置文件发现顺序 `artemis.jsonc → artemis.json → agent_config.json`（config/agent.py:1078-1088；config/llm.py:148-155）。工作区现配 config/artemis.jsonc（当前指向本地 LM Studio openai/qwen3.6）。

| 项 | flash | pro |
|---|---|---|
| 执行体 | FlashRunner 单 agent 反应环（observe-think-act），`max_turns=0` 默认无限 | langgraph 多 agent 图（§2.5） |
| 结束方式 | `report_task_status(status=completed|failed)` 工具唯一出口（validator/tool_declarations.py:276-289） | plan 全勾 + 收敛门 + exit settlement |
| 笔记工具 | **无写笔记工具**（读有），prompt 也不教（flash/runner.py:196-203） | scratchpad 全套 + plan 写入拦截 |
| Explorer 层级 | `flash.explorer_mode`（默认 flash） | `pro.explorer.mode`（默认 flash） |
| checker/committee | 无 | checker 梯级 + committee(默认关) |

- 验证梯级 `off/final/checkpoints/strict`（config/agent.py:241-260）：off=Operator 自报完成无审计；final=仅出口审计（**工厂默认**，midway off）；checkpoints=每个 plan checkpoint+出口；strict=checkpoints + repair 预算加大（4/5/30）+ assert 失败 halt。`verification_level_for_checker` 反推梯级（agent.py:281-291），`run_tuning_for_profile` 把 pro 的梯级+explorer 模式写进会话 device_info（agent.py:294-311，model_service 反推的依据）。
- [vlm] 说明：todo.md 说"旧线 [vlm] 路由已验证"——py 侧**没有**名为 [vlm] 的路由键；多模态按节点配置（`video_analyzer`/`object_detector`/`explorer` 节点 + `is_multimodal` 默认 true，llm/router.py:100-102）。flash 层级要求 Gemini ER 模型做空间坐标（artemis.jsonc:39-49 注释），非 ER 模型检测会失败。【部分，防止二期照抄不存在的 [vlm] 键】
- Explorer 层级解析优先级：显式参数 > `ARTEMIS_EXPLORER_VERSION` > per-agent `explorer_versions` > profile 模式 > default（config/agent.py:352-383）。层级=flash(1 turn)/pro(3 turn)/ultra(8 turn+zoom+OCR+image processor)；caching 默认 ultra on、pro off（explorer/tiers.py:72-93）。

处置：①一期黑盒；②二期→DSH profiles + per-agent AgentOptions（todo.md 已映射）；**但 flash/pro 行为差异表和验证梯级语义是二期 skills/agent 定义的转化基线**，todo.md 目前只有一行"逐 agent 渐进搬迁"。【部分】

### 2.2 model_service / 端点库（admin_console/services/model_service.py + artemis/config/endpoint_library.py + config/llm.py）

- 端点库 = `endpoint_library.json` 保存的选择记录（name/api_format/api_base/model 四字段），**是保存的选择不是运行时输入**；运行时模型来自 artemis.jsonc `default` 块（endpoint_library.py:15-52）。
- **pin 机制**：队列把选中记录名经 `ARTEMIS_MODEL_ENDPOINT` 传给 worker；config 层把它折算成 default 块覆盖（覆盖字段 = provider/model/provider_label + ENDPOINT_OWNED_KEYS(api_base/api_key/api_key_env/fallback)，config/llm.py:215-256）。**未知名字直接 RuntimeError 拒启**（不静默回退——"静默跑在没人选的模型上是最要避免的失败"）；记录缺 api_format/model 同样拒绝。【缺失】todo.md 只写"model_service 端点库/固定端点/profile 反推 → DSH 原生"。pin 的 fail-loud 语义与覆盖字段清单是 DSH per-agent model 选项要对齐的行为。
- **profile 反推**（model_service.resolve_session_profile，model_service.py:101-165）：device_info.profile → running 提交参数 → agent/trace 名单（planner/validator/...→pro，flashrunner→flash）→ llm trace payload，四级回退。纯展示层，DSH session log 原生后可删。【已覆盖映射表"✅ 原生"】
- 节点继承：`default` 块展开进 12 个 agent 节点 + 4 个 utils 节点（outputter/hopper/video_analyzer/object_detector），节点覆写深合并（config/llm.py:158-212）；`history_analyzer` 缺省继承 operator，`validator_pixel_safety_net`/`planner_validation` 共享轻量 judge 默认（default 端点 temperature 0），`output_analyzer` 继承 log_analyzer（config/llm.py:63-87, 132-145）。【缺失——节点清单与继承规则是 DSH AgentOptions 表的直接输入】
- 无内置端点：default 未配置 → 一切模型解析 RuntimeError 带配置指引（services/llm.py:963-968）。

### 2.3 LLM 路由/可靠性/结构化输出

#### 2.3.1 故障分类与重试（llm/reliability.py）

- 8 类 FailureCategory（rate_limit/provider_unavailable/timeout/connection/auth/bad_request/cancelled/unknown），由状态码+消息标记匹配（reliability.py:77-109）。每类 RetryPolicy：rate_limit 4 次(10s→60s 指数+抖动)、unavailable 4 次(5s→30s)、timeout/connection 3 次(2s→15s)、unknown 2 次；auth/bad_request/cancelled 1 次（不重试）（reliability.py:154-166）。**跨类累计上限 8 次**（services/llm.py:114, 448-454）。
- fallback 判定：auth **可以** fallback（换凭证可能活）、bad_request **不** fallback（换弱模型只会藏 bug）（reliability.py:101-108；services/llm.py:1087-1094）。

#### 2.3.2 端点熔断（进程内）

`_ENDPOINT_BREAKER`（threshold=3, cooldown=30s，key=`provider:model`）：仅瞬态类计数；半开只放行一个试验调用；等待端有 120s 兜底防死锁（reliability.py:197-267；services/llm.py:107, 370-383）。**这是 LLM 维度熔断，与设备维度熔断（S4）不同层，别合并**。【缺失——S4 只讲设备熔断；DSH 的 LLM seam 若无等价物，行为会漂移为"打满重试才降级"】

#### 2.3.3 暂停-恢复协议（PAUSE_FILE）【缺失，DSH 一期必须知道】

重试耗尽且无 fallback → 写 `PAUSE_FILE`（内容=`LLM Error: ...`，路径=app_dir/.artemis_paused，config/paths.py:224-226）→ 任务**暂停等待文件被清除**，`LLM_PAUSE_TIMEOUT_SECONDS=900s` 到点 → `LLMExhaustedError`（services/llm.py:300-367, 487-507）。恢复信号 = 外部删文件（旧 UI 的"恢复"按钮做这件事）。事件：`task_paused`/`task_resumed` + `llm_pause` trace。**在 DSH 一期这表现为"job 挂着不输出 900s 然后失败"**——job 侧要么接受（按失败处理），要么删除 app_dir 下的 `.artemis_paused` 当作 resume 按钮，总之要在 DSH 侧成文，否则像死锁。

#### 2.3.4 流式与结构化

- `complete()` 是唯一调用形态：内部流式、增量转发 UI（`engine.stream_output`），**mid-stream 失败丢弃 partial 整体重试**（partial 永不进消息历史，防重复块）；端点不支持流式→一次性探测并永久记忆 `_NON_STREAMING_ENDPOINTS`（services/llm.py:653-757）。`astream()` 是兼容 shim 只 yield 一条最终消息（旧版 chunk 级重试会重复投递——这是修过的 bug，别复原）。
- `acomplete_structured`：parse 失败把错误回给模型自纠 1 轮（`correction_attempts=1`），仍失败抛 `StructuredOutputError`，**永不把 raw text 冒充解析结果**（services/llm.py:807-862）。
- `parse_structured` 管线：剥 thinking 标签 → 围栏块优先/裸平衡跨度 → 宽容修复（注释/尾逗号）→ 可选 pydantic 校验（llm/structured.py:163-194）。
- Google 特殊性：①四类 harm safety 全 `BLOCK_NONE`（router.py:255-260）；②monkey-patch `ChatGoogleGenerativeAI._process_tool_config` 保 `include_server_side_tool_invocations`（内置工具+函数调用混用必需，router.py:139-198）；③grounding：endpoint 开 `enable_grounding` 或显式声明时注入 `{"google_search": {}}`，非 Google 端点**过滤掉** google_search dict 工具（services/llm.py:553-586）；④`thinking_level` 仅 Gemini≥3 支持（1.x/2.x 只认 thinking_budget，google/provider.py:136-144）；⑤agentic 视频：Flash≥3.6 / Flash-Lite≥3.5 且仅 base 型号；**Flash-Lite auto 模式被刻意排除（实测误读时间戳），须显式 opt-in**（google/provider.py:147-185）；⑥provider SDK 的 retry 日志被劫持成结构化 `llm_retry` 遥测（services/llm.py:244-297）。
- Anthropic：reasoning_effort→thinking_budget 映射 low=2048/medium=8192/high=32768，开 thinking 时 temperature 强制 1.0（router.py:330-337）。
- Gemini ER 模型名（不可解析版本）假定支持 thinking_level（google/provider.py:140-144）。

处置：①一期保留；②二期→DSH LLM seam。**重试策略表、fallback 判定（auth 可/bad_request 不可）、流式 partial 丢弃、暂停文件、Google safety/patch 这五点是 DSH provider adapter 的验收基线**，todo.md 未拆。【部分→缺失】

### 2.4 多 agent 流水线（逐角色）

| agent | 一句话职责 | 输入→输出 | 失败行为 |
|---|---|---|---|
| planner | 初始计划：读目标+首帧截图写 task_plan.md（LLM 工具环：save_note 等） | State.initial(goal, prior_conversation_context)+截图 → task_plan.md | 拿不到截图 raise ValueError→整个 run failed；LLM 经 with_fallback，再耗尽→pause 协议（planner.py:263-268, 298-329） |
| planner_validation | 里程碑文本变更的**咨询式**异步复审（轻量 judge） | last_validated_plan vs 新 plan → feedback | 异常一律视为通过（fail-open 不阻塞），flagged 也**不回滚**，仅以 operator_feedback 注入关注点（graph.py:189-228; planner.py:196-198） |
| operator | 屏幕感知+决策：产 structured_decisions（动作 JSON）或 plan 编辑 | 观察尾+反馈+transcript → decisions | 工具超限标记 `operator_tool_limit_exceeded`；fast-action burst 超 4 动作在执行前拒回（config/agent.py:797-824） |
| validator | 执行前安全网 + 动作执行：XML 匹配/坐标自愈/pixel VLM 双网，单动作(vetted)或 burst | decisions → ActionResult/incident | 执行 incident（blocked/failed terminal action）记入 `open_incident`，交 Operator 自行恢复（无独立修复 agent），成功后一次 CLOSED 通知（state.py:130-141; validator/validator.py docstring） |
| checker | **零副作用只读**判定 agent：midway checkpoint 审计（无实时屏幕，用证据锚）+ final 出口审计（有最终屏幕）；只挂只读设备探针/读历史/读笔记，release 决策由调用方算（checker.py docstring; graph.py:31） | check_items+ledger → verdicts | 出错 fail-open 释放但 verdict=inconclusive 原样入账（graph.py:324-353）；verify 失败回流 loop（预算 final_check_max_attempts），assert 失败永不回流只记 tests.failed |
| explorer | ask_explorer 视觉子 agent：元素定位/多候选搜索，三层级 | query+截图 → 定位/答案 | 层级见 §2.1；`denylisted_tools.explorer` 可裁工具 |
| diagnoser | ask_diagnoser 失败根因诊断（子 agent 带工具环，末轮强制 submit_answer） | 症状+日志 → 诊断 | submit_answer 唯一出口（diagnoser.py:63, 285） |
| committee(ask_committee) | 多席辩论（planner_avatar/history_analyzer_expert/diagnoser_expert × debate_rounds 轮），**不遵守 Operator 回合结束契约**（graph.py:987-988 注释） | 议题 → 建议摘录 | 默认关（committee.enabled=false） |
| summarizer(Pro) | 把步骤派发给共享视觉过渡 lens（不再自己调 LLM 产胶囊） | step_id → versioned summary | 未就绪回退 detailed 渲染，transition 安全（summarizer.py docstring） |
| flash step_summarizer | Flash 异步后台步骤视觉摘要（同 StepMemoryService） | pre/post 截图 → 摘要 | retry_limit=3 耗尽 → `summary_status=failed`，不无限重试（config/agent.py:401-409） |
| outputter | 出口报告合成 + 结构化 schema 提取（enabled 默认 true；force_synthesis 控制无 schema 时是否强做） | 全历史+notes → 报告/JSON | task.finalize content 的来源 |
| log_analyzer/output_analyzer | analyze_logs 错误日志诊断（log_analyzer 带 grounding）；output_analyzer 继承其配置 | 日志 → 结论 | — |
| image_processor/object_detector | 通用多模型图像处理 / 视觉坐标检测（ER 模型要求见 §2.1） | 图像 → 文本/坐标 | 解析失败走 ParseFailure 类型化路径（object_detector.py:17） |
| history_analyzer | 会话历史问答（挂共享 history 工具） | 自然语言问题 → 检索回答 | — |
| video_analyzer | 屏幕录像时间线分析：native(Gemini Files API/agentic) + universal(多模型关键帧) 双引擎，自带熔断（3 次瞬态失败旁路 60s）与 bisection | 录像 → 动作账本/验证 | circuit_breaker_threshold=3/cooldown 60s；native 失败 1 次重试后切 universal（config/agent.py:68-136） |

【已覆盖（映射表 A 区一行）→细节缺失】二期重写时本表是验收基线；尤其 checker 零副作用三不变量（append-only 历史 / 释放与判定分离 / check 任务内零副作用，graph/checkpoints.py:15-29）与 validator incident 移交语义。

### 2.5 graph / langgraph（Pro 编排）

- 拓扑（graph.py:948-1055）：`START → planner → convergence →(gate)→ perception → operator → execution_check →(有 decisions→validator→summarizer→convergence | 无→convergence) →(gate)→ ... → exit_settlement →(continue→perception | end→END)`。
- **没有 langgraph checkpointer**：`graph_builder.compile()` 无 checkpointer 参数，无 interrupt/resume。**"断点续跑"在 py 线不存在**——进程死=任务死，与 D5"运行中任务死亡标 failed 不重入"完全一致。【矛盾（易误读）】todo.md 写"graph/（langgraph 编排 + checkpoints）……checkpoint 语义由 session log 承接"——此 checkpoint 是**计划校验检查点**（check_ledger.jsonl），不是执行位置断点；二期别去 DSH session log 里找 resume 语义，直接按"无断点续跑"设计。
- **checkpoints 真身**：plan 驱动的校验调度 + append-only verdict 账本，存 session trace 目录：`check_ledger.jsonl`（判定账）、`run_outcome.json`（机器可读终局）、`check_streams.jsonl`（checker 自身推理转写，单条 20k 截断）（graph/checkpoints.py:58-68）。三不变量：append-only（判定不改写过去）/释放与判定分离（fail-open 只影响释放，inconclusive 原样记录）/check 任务零副作用（副作用只在 harvest 点与 settlement）（checkpoints.py:15-29）。
- run_outcome 语义：goal 轴 × test 轴；`task_status=blocked` 仅当 verify 未满足且预算耗尽（或 user_stop/assert_halt 门闩）；assert 失败计 tests.failed 但任务可 completed（§1.4）。
- **task_plan.md 写入通道的机器规则**（graph.py:515-806）——Pro 最重的暗规则集，todo.md 零记录：
  1. 机器频道拒绝（带回滚）：计划要结束时不得留未完成嵌套子目标；`[Loop:continuous]` 里程碑**只有用户显式 stop（user_stop_requested）才能删除/打勾**，意图绝不从措辞推断（graph.py:533-555）。
  2. 手滑整文件重写检测：状态未变但文本漂移的顶层 milestone → 拒绝并回滚（graph.py:558-575）；声明式 update_note（target/replacement）豁免。
  3. check 行确定性保护：被删/改的声明 check 行纯文本合并回来（内容驱动、与开关无关）；**用户指导豁免**：注入指导时在场的 check 行解除保护可被删改，之后新增的恢复保护（graph.py:645-691; perception.py:95-115）。
  4. finding 行确定性投影：未决 verify findings 每次写计划时从 repair 状态重渲染（模型删了会再长出来，解决了自动退役，graph.py:698-698）。
  5. `checker-`/`checker:` 前缀 note key 系统保留，模型侧写入被拒（graph.py:578-597）。
  6. ratchet 基线：里程碑变更对照"上次验证过的 plan"而非上一次写入（多次小编辑不能把漂移摊薄到触发线下，graph.py:703-738）。
- perception 节点：注入指令消费（`<base_dir>/injected_instruction.json`：`{instruction, release_loop}`，读后即删，perception.py:75-92）→ 用户指导解除 check 行保护 → 混合 settles 截图（上轮动作非 wait 时 0.4s 停顿）→ OCR（配置了才做，状态栏裁剪+坐标回映射）→ XML 融合 → 截图后台落盘（sha256 内容寻址）。【缺失——**injected_instruction.json 是"任务中途注入指导"的唯一通道**，见 §6 新 S9】
- State 通道（state.py:30-163）：全字段显式 `extra="forbid"`；`user_stop_requested` 用 sticky_or reducer（一旦 True 永不回落）；`operator_feedback` append-only 注入（[checker]/[planner]/[final check] 源标签）。visibility.py 是节点级读写字段清单（`ARTEMIS_STRICT_STATE=1` 测试期执法）——**这是每个 agent 能看/能写什么的权威声明**，二期权限模型可直接翻译。【缺失】
- convergence_gate 终局路由（graph.py:872-945）：assert_halt 门闩 → checker_success=False 回 operator → 计划文件缺失 continue → 无顶层子目标也进 settlement（final review 对象是原始 goal 不是 plan）→ 全勾但存在 [Loop:continuous] 且无用户停止 → 继续。

处置：①一期黑盒；②二期 DSH agent loop 替换时，上述 plan 写入规则 + run_outcome + Loop:continuous 语义是**必须搬进 skills/工具守卫的行为基线**，量级远超 todo.md 目前的"DSH agent loop 原生替代"一句话。

### 2.6 memory

#### 2.6.1 transcript 账本（memory/transcript.py）

S/F/A/T 四区：S=字节级稳定系统前缀；F=冻结历史+压缩块；A=原始回合 append-only（**永不删除/重排，tool-call 配对永不拆散**）；T=当前尾。`T+mm:ss` 会话起始偏移时间戳（冻结后字节稳定）。ephemeral blocks（提醒/提示/指导包装）标记在 `additional_kwargs.ephemeral_blocks`，scrub 边删除，**永不进冻结区或胶囊**（transcript.py:15-95）。**`memory.transcript.enabled=false` 是字节级回滚开关**（还原 legacy 2-message 路径，L2/L3 同乘此旗）。【缺失——回滚开关的存在本身是行为契约】

#### 2.6.2 scrub 边与压缩梯级（config/agent.py:444-596）

- 截图边：深度 3（紧凑）/6（低于 start gate 的宽松档）；`pending_grace_steps=3`；**深度变化永不重写已 scrub 的消息**。
- 文本边 xml_scrub_depth=1：一有更新观察，旧观察的 UI 列表/plan 复述/ephemeral 块即删——**刻意浅：只有活观察带索引元素列表，stale [n] 索引永不成为可点目标**（安全理由，重写时必须保留）。
- 压力梯级 start 0.35 / soft 0.7 / hard 0.9 × `context_budget_tokens=80000`（操作者自测 prompt 尺寸，**不是** token_meter 的 last_prompt_tokens——后台 lens 的小 prompt 不得冒充上下文基数，token_meter.py:99-118）；`min_active_steps=5` 滑窗下限；ladder 校验 `0≤start≤soft≤hard≤1`（agent.py:581-596）。
- 相似历史提示：dHash 64bit 汉明距离 ≤5 触发（460 步实测校准：同屏 ≤4、异屏 ≥7），近 3 步内静默（像素级同屏提示的地盘）。

#### 2.6.3 chunking（memory/chunking.py 1833 行）

三带胶囊（①概要+效果 ②区间摘要 ③逐步动作账本）+ era 折叠 + recall-only 周期；边界=里程碑切换/12 步/2000 token；失败胶囊保留原文重试；hard 线强制换入含 pending、冻结区整体折叠 L3（不可逆，后续 L2 追加其后）；`min_steps=3` 防一步一块（里程碑关闭豁免、hard 豁免）；模型=部署 default（当前 qwen3.6）。注入指令是 band③ 永不逐出行（graph.py:156-159）。【已覆盖（"chunking 策略专项评估"）→数值与 L3 不可逆语义补充】

#### 2.6.4 跨任务会话记忆【缺失，S1 的盲区】

`ARTEMIS_CONVERSATION_ID` 存在时，worker 在 start_session **前**查同线程最近完成任务的 `notes/*.md`（上限 8000 字符）作为 `prior_conversation_context` 注入 planner prompt 顶部（sdk/agent.py:357-374; data_engine/storage.py:410-440）——"notes 是线程的持久记忆，跨提交旅行"。**S1 只映射了 ID，没映射这个上下文继承行为**：DSH 侧等价物 = agent 会话历史原生延续（若 conversation≡session 一对一成立则免费），但 py 的"只继承 notes 不继承对话原文"是有意的上下文预算决定，重写时要显式决定继承什么。

#### 2.6.5 step_memory（memory/step_memory.py）

共享后台摘要运行时：零阻塞派发 / 有界重试（1+3 次，退避 0/0.5/1/2/3s，耗尽显式 failed）/ 有界 flush(30s) / step_id 规范键+别名（tool_call_id/legacy 序号）/ 信号量并发(2) / detached_trace（lens 的模型调用不挂到提交者 span）。Flash 与 Pro 共用。【缺失】

#### 2.6.6 context_policy（memory/context_policy.py）

每 agent 编译历史视图策略表：operator=strict_milestone(窗口3)、operator_cold_start=全量、planner=strict(窗口5,last2)、outputter/history_analyzer=full+chunk full view、diagnoser/committee=whitelist；chunk 两视图 full（带③账本）/digest（③换成 search_history 指引行）；`agent.memory.policies` 按 agent 覆写。旗关时输出字节不变。【缺失】

### 2.7 token_meter（services/token_meter.py 267 行）

每会话计量器：真实 `usage_metadata` 逐调用记 `llm_usage` trace（prompt/completion/cached/context_base_tokens + 会话快照 + per-source cached_ratio）；UI"上下文占用"分母 `OPERATOR_CONTEXT_WINDOW_TOKENS=1_000_000`；来源=endpoint key 或 lens 标签。**不做决策、永不 raise 进调用路径**；`last_prompt_tokens` 明确不供压缩阈值使用（§2.6.2）。会话结束 `log_session_summary` 一行 INFO。映射表 F 区"大部分删除"成立；但它是 transcript 压缩阈值的**数据来源说明**（阈值读 operator 自记值而非 meter），二期用 DSH KV-cache 统计时注意这个区别。【已覆盖（F 区）→补充】

### 2.8 task_preset_catalog（admin_console/services/task_preset_catalog.py 515 行）

- 15 条预设（TaskPreset: id/title/description/goal/profile(flash|pro)/category(flash|pro|cross_app|monitor)/tag/apps/required_packages/match_mode(any|all)/priority 50-95）+ APP_REGISTRY 22 个常用包（含微信/小红书/美团/支付宝等中国区应用）。
- 推荐打分：命中 required_packages +100（all 模式多包再 +30），未命中 -40，按 priority 基分排序取 limit=12；category 过滤（profile 严格等值）。
- 转 DSH skills 的转化基线：goal 文本、profile→执行模式映射、包匹配→设备适用性过滤三件事要一起搬。【已覆盖（映射表"🔧 转化为 skills"）→打分逻辑补充】

---

## 3. 工具敏感分级表（S6 approval 映射输入）

**关键前提**：结构化动作集本身不含卸载/清数据；**破坏性面集中在 `run_adb_command`（任意 adb shell，无命令过滤）**。S6 的"卸载/清数据/支付类"在一期映射实操上= 对 run_adb_command 的参数做模式审查，或整工具 ask。逐工具：

| 工具 | 一句话 | 敏感级（建议 S6 映射） | 证据 |
|---|---|---|---|
| click/click_sequence/long_press/swipe/press_key/input_text/erase_one_char/focus_and_clear_text/open_link | 屏幕级 UI 操作 | never（常规设备操作，S6 原则） | mcp/action_specs.py:685-693, action_specs 各 spec |
| manage_app(launch) | 启动 app | never | actuators/adb.py:301-319 |
| manage_app(stop) | 强停 app（terminate_app） | **low-risk ask/never（需决策）**：非数据破坏但可中断状态 | actuators/adb.py:320-327；仅支持 launch/stop 两值，无 uninstall/clear |
| wait_for_delay / wait_for_text / wait | 等待 | never | action_specs.py:614-653; tools/wait_tool.py:53 |
| **run_adb_command** | 任意 adb shell（host 子进程 `adb -s <serial> shell`），支持持久终端环境、超时转后台、stdin 交互 | **破坏性入口：`pm uninstall`/`pm clear`/支付类操作皆可达。建议：ask + 允许清单（logcat/dumpsys 等只读 never）或整工具 ask**；无任何内置过滤 | tools/command_tool.py:618-744（无 allowlist/denylist，grep 证实） |
| manage_task | 管理后台 adb 任务（查看/kill/send_input） | never（作用域限本会话启动的后台任务） | command_tool.py:902, 1148 |
| launch_app | 按名找包并启动 | never | tools/mobile/launch_app.py:47 |
| get_ui_hierarchy / ocr_recognition | 读屏幕 | never | mobile/read_hierarchy.py:52; mobile/ocr.py:139 |
| read_logs / search_logs / analyze_logs | 读/搜设备日志 | never | mobile/read_logs.py:76; mobile/search_logs.py:211; log_tool.py:54 |
| ask_explorer / ask_diagnoser / ask_committee / ask_image_processor / video_analyzer / object_detection | 感知/LLM 子 agent | never | explorer_tool.py:564; diagnostic_tool.py:72; committee_tool.py:85; image_processor_tool.py:63; video_tool.py:253; object_detection_tool.py:181 |
| save_note/read_note/list_notes/update_note/append_note | scratchpad 笔记（worker 本地文件） | never（写侧有 plan 拦截规则，§2.5） | scratchpad.py:104-790 |
| search_history / replay_steps / get_step_screenshot | 冷历史检索/回放/截图 | never（只读 DataEngine 产物） | tools/history/__init__.py:159-295 |
| report_task_status / submit_answer | 终局自报/诊断提交 | never（终态语义工具） | validator/tool_declarations.py:276; diagnoser_submit_answer_tool.py:57 |
| （隐式）helper APK 安装/升级 | 设备环境准备，**非模型调用、无审批点** | 设备变更：一期建议视为任务前置的隐式授权（`ARTEMIS_HELPER_AUTO_INSTALL=false` 可关） | constants.py:56-58; sdk/agent.py:384-415 |
| （隐式）Chrome accessibility 强制 | 写 /data/local/tmp + force-stop Chrome，任务启动时自动 | 同上，隐式设备变更，可经 AgentConfig.force_web_accessibility 关 | sdk/agent.py:239-285 |
| （隐式）keyguard | **拒绝**替用户解锁（不猜 PIN） | 正向安全不变量，二期必保 | sdk/agent.py:215-237 |

【部分】S6 只有抽象分级原则；本表是逐工具落地输入。**"破坏性=run_adb_command 参数审查"这个事实 todo.md 未记录。**

---

## 4. 外部契约清单（一期 DSH job 侧必须复制/遵守的输入输出）

| 契约 | 内容 | 破坏后果 |
|---|---|---|
| env 全集 | §1.3 表（尤其 `ARTEMIS_TASK_WORKER=1`、`ARTEMIS_IPC_PORT` 可省、`ARTEMIS_MODEL_ENDPOINT`、凭证组、`ARTEMIS_SESSION_ID`） | 缺 TASK_WORKER → 起错分支；缺 SESSION_ID → 会话无主 |
| CLI 形态 | `python -m artemis.main <goal> --profile --session-id ...`（§1.1） | — |
| 退出码 | §1.4：0≠completed；DB 终态权威 | 终态展示漂移 |
| 取消 | cancel marker 文件协议（§1.5）+ 45s 宽限硬杀 | Windows 下优雅取消失效 |
| 暂停 | `.artemis_paused` 文件（§2.3.3），删除=恢复 | 900s 假死 |
| stdout | 纯文本日志（§1.6）；结构化事件在 IPC 不在 stdout | G2 降级已接受 |
| 终态留痕 | DataEngine SQLite（`DATA_ENGINE_DB_PATH` env 同步给子进程，settings.py:372-374）；trace 目录 `traces/<session>/`（notes/*.md、check_ledger.jsonl、run_outcome.json、check_streams.jsonl、images/、stdout.log） | 会话丢失 |
| 配置文件 | `artemis.jsonc`（工作区根 config/）+ `endpoint_library.json` + `credential_bindings.json` + app_dir `.env`；env 开关压过配置文件 | 模型/开关漂移 |
| 注入指导 | `<trace_dir>/injected_instruction.json` `{instruction, release_loop}`（§2.5 perception） | 会话中调整方向能力丢失 |
| 设备锁协作 | worker 内仍会自取 DeviceExecutionLock（除非票据判定 already_held，§1.2）；`ARTEMIS_DEVICE_QUEUE_TICKET` + lock scope env 是协作键 | 双跑期双调度器互踩 |
| 结构化输出 | `--output-description` → Outputter → DB 会话行（+可选 `RESULTS_OUTPUT_PATH` 落盘） | 最终结果拿不到 |

---

## 5. 漂移风险 Top 10（按风险排序）

1. **S2 退出码映射与 py 真相相反**：blocked/flash-failed 任务退出 0；DSH 会把失败任务标 completed（§1.4）。需改 S2 判定或声明 DB 权威。
2. **cancel marker 通道被标"✅ 删除"与一期黑盒矛盾**：Windows 下 JobRegistry.kill=强杀，优雅清理（录屏 remux/trace/锁释放/cancelled 终态）全部依赖 marker 文件（§1.5）。
3. **PAUSE_FILE 暂停协议未记录**：LLM 重试耗尽后任务静默挂 900s，DSH 侧看起来像死锁（§2.3.3）。
4. **plan 写入机器规则集零记录**：Loop:continuous 保护、手滑重写检测、check 行合并回、finding 投影、checker- 前缀保留、ratchet 基线——二期重写最易整包丢失的暗规则（§2.5）。
5. **会话续聊上下文继承（notes 注入 planner）未入 S1**：conversation≡session 若一对一成立则原生免费，但"只继承 notes 不继承原文"的预算决定要显式化（§2.6.4）。
6. **`ARTEMIS_TASK_WORKER=1` 缺席 env 清单**：不设则 worker 走 daemon 派发分支，S5"入口不变"悄悄失效（§1.3）。
7. **LLM 端点熔断 + 暂停 + fallback 判定的可靠性行为未成文**：DSH LLM seam 若只做重试，auth 可 fallback / bad_request 不 fallback / 进程内 3 次 30s 熔断 / 8 次跨类上限都会漂移（§2.3）。
8. **graph 无断点续跑**：todo.md"checkpoint 语义由 session log 承接"易误读成有 resume 语义；py 侧 checkpoint=校验账本非执行断点（§2.5）。
9. **`injected_instruction.json` 中途指导通道未入对接语义**：release_loop（[Loop:continuous] 的唯一合法解锁）也走这里（§2.5, §6 新 S9）。
10. **结构化最终结果只在 DB 不在 stdout**：一期 job output ring 拿不到机器可读结果，依赖 DataEngine SQLite 可达（§1.6）。

次级：manage_app 无 uninstall/clear（破坏性全在 run_adb_command，§3）；Google safety BLOCK_NONE + langchain patch（§2.3.4）；xml_scrub_depth=1 的 stale-index 安全理由（§2.6.2）；Flash-Lite agentic 视频误读时间戳的显式排除（§2.3.4）；ADB 后台任务随任务终止的 15s 清理边界（sdk/agent.py:752-760）。

---

## 6. 对 docs/todo.md 的修订建议

1. **S2 修正**：补"py worker 退出码不编码任务结果（0 含 blocked/flash-failed）；终态以 DataEngine DB 行为权威，job outcome 仅 UI 层；stdout 特征行（`Task ended blocked`/`Task execution failed`）可作一期辅助判定"。
2. **S5 修正**：env 清单补全——`ARTEMIS_TASK_WORKER=1`（worker 分支开关，必设）、`ARTEMIS_DEVICE_QUEUE_TICKET`、`ADB_DEVICE_SERIAL`、凭证组、`LLM_PAUSE_TIMEOUT_SECONDS`；补"取消走 cancel marker 文件（`request_cancel`），kill 仅作 45s 宽限后的兜底"。
3. **映射表 C 区修正**：`cancel_requests` 从"✅ 删除"改为"一期保留（Windows 优雅取消唯一通道），二期随 worker 退役"。
4. **新增 S9（建议）· 任务中途指导注入**：`<trace_dir>/injected_instruction.json` `{instruction, release_loop}` 读后即删；release_loop 是 `[Loop:continuous]` 里程碑唯一合法结束信号。DSH 侧对应物（followup 带 control 标志？）需 spike。
5. **新增差距 G8**：一期 job 侧终态判定需访问 DataEngine SQLite（或 stdout 特征扫描），S4 环境级判定的 `has_steps`（零步骤）信号在 TS 侧无直接来源——需定"读同一 SQLite"还是"降级为 exit code+markers"。
6. **新增差距 G9**：LLM 暂停文件（`.artemis_paused`）在 DSH 一期的呈现（挂起 job）与 resume 操作（删文件）需写入运维手册；或一期设 `LLM_PAUSE_TIMEOUT_SECONDS` 显式小值。
7. **映射表 A/B 区补充**（防二期丢行为基线）：指向本文件 §2.4/§2.5/§3 作为"逐 agent 渐进搬迁"的验收清单；点名 plan 写入机器规则、checker 三不变量、run_outcome 双轴语义。
8. **G4 补充**：环境级判定除了 markers 扫描，py 原版以"零步骤失败"为一票通过（task_queue_service.py:1070-1086）；一期 TS 侧若不读 DB，此信号缺失，误判率会升。
9. **映射表 model_service 行补充**：pin fail-loud（未知端点名拒启）+ ENDPOINT_OWNED_KEYS 覆盖清单 + 节点继承规则（12 agent 节点+4 utils，history_analyzer←operator 等）是 DSH per-agent 模型选项的输入。
10. **P0/P1 spike 清单补充**：S2 spike 增加"kill→cancel marker 联动验证（Windows）"与"worker 内 DeviceExecutionLock 自取与 TS 闸门叠加行为验证"。
