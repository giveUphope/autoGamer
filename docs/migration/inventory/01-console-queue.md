# 迁移盘点 · 队列与控制台后端

> **编号警示**：本文里 `**Gn · …**` 形式的「新增差距」段落属于早期编号方案，与 `docs/todo.md` 现行 G 编号**不是同一套**（G8/G9/G10/G11/G12 已撞车，冲突表见 [registry.md](../registry.md)）。引用内容时写「`inventory/0N` 的 X 段」，不要写 `Gn`。

> 范围: `apps/admin_console/**`（routers / services / core / database / schemas / server.py / replay_manager.py）+ `tests/unit/admin_console/**`；基线: cc6b20c；日期: 2026-10-09
> 目的：记录 docs/todo.md（D1–D8 / G1–G7 / 全模块映射表 / P0–P4）**未写明、迁移中若无人记录即会丢失**的行为、不变量与契约。todo.md 已覆盖的条目只标注出处、不展开。

---

## 1. 行为与不变量

### 1.1 队列完整生命周期

**提交入口 `/api/run`（routers/tasks.py:69-198）的准入管线，顺序固定：**
1. goal/goals 归一（两者都缺 → 400，tasks.py:77-81）。
2. `model_endpoint` 若提供，必须能在 endpoint library 中解析，否则 400 并回显全部已存端点名（tasks.py:87-96；测试 `test_run_rejects_unknown_model_endpoint_before_enqueue`）。pin 在**提交时刻校验**，运行期不再跟随全局默认。
3. **幂等短路（先于一切昂贵探测）**：带 `session_id` 且单 goal 时，若该 session 已在 queue_items、已落 DB、或属于 active 状态，直接返回既有表示（status=running/queued），`enqueued_count=0`，不重复入队、不重跑设备就绪探测（tasks.py:102-130；测试 `test_idempotent_retry_skips_device_probe_for_active_session`）。理由：admission 响应丢包重试时设备可能正被原任务持有，再探测会误伤。
4. 显式 serial 先经 `validate_explicit_serial_async` 拒绝——**仅当枚举确定**才拒绝（adb 抖动/空总线=不确定 → 放行，让任务排队后在下游以清晰的 no-device 错误失败，fail-open）（tasks.py:138-150；测试 `test_explicit_device_proceeds_when_enumeration_is_indeterminate`）。
5. 就绪探测 `run_device_submission_probe`：`Device Locked`/`Lock State Unknown` → **409**（tasks.py:160-174）；探测解析出活动设备且用户未显式指定 serial 时，把探测到的 serial 绑定为 target（显式 serial 永不被静默替换，tasks.py:176-182）。
6. 进入 `enqueue_tasks`。

**`enqueue_tasks`（services/task_queue_service.py:1288-1399）：**
- `conversation_id` 规则：调用方传入则 strip 后沿用；为空则 `uuid4()` **在 enqueue 时刻分配、绝不留 NULL**（task_queue_service.py:1328-1330）。一次提交的多个 goal 共享同一 conversation_id。
- 去重 1：session_id 已 active/在队 → 返回既有项（仅单 goal 时生效，task_queue_service.py:1157-1181）。
- 去重 2（防抖）：同 goal + 同 serial + 同 endpoint.identity + **1.0s 内**的重复 pending 提交短路返回（task_queue_service.py:1184-1205；测试 `test_enqueue_tasks_debounces_rapid_identical_submissions`）。
- 无显式 serial 时 `select_device_async` 解析设备（异常 → None = auto，task_queue_service.py:1343-1350）。
- **新提交解除该 lock_key 的熔断挂起**（task_queue_service.py:1352-1359）。
- 队列项字段（`_create_queue_item`，task_queue_service.py:1232-1286）：session_id（复用或 uuid4）、goal、profile（默认 flash）、expected_output、enable_outputter、verification_level、explorer_mode、model_endpoint、locked_app_package、app_path、device_serial、adb_endpoint（**快照**，测试 `test_enqueued_task_keeps_its_adb_endpoint_snapshot`）、ingress、conversation_id、status=pending、queue_ticket（入队即 `DeviceExecutionLock.reserve`）、created_at/start_time=`now + index*0.001`（同批多 goal 错峰排序）。
- 同步登记 `state.remember_submission(session_id, conversation_id, created_at, goal)`（task_queue_service.py:1380-1385）——registry 值此后恒优先于锁票据视图（AGENTS.md 已载；todo 未载，见 §4）。
- 响应：`{"status": "started"|"queued", "tasks": [...], "enqueued_count": N, "total_queued": M}`（started vs queued 取决于 `state.is_running`，task_queue_service.py:1395）。

**worker 子进程 spawn（`_execute_task_item` → `_build_worker_invocation`，task_queue_service.py:578-663, 996-1067）：**
- 命令：`{sys.executable} -m artemis.main <goal> --profile <p> --test-name web_<unix>_<run_key前8> [--session-id] [--output-description] [--enable-outputter|--disable-outputter] [--verification-level] [--explorer-pro-mode] [--locked-app] [--app-path] [--device-serial]`，cwd=WORKSPACE_ROOT。
- env 契约（**全量清单，todo S5 只列了子集**）：`PYTHONPATH`（workspace + apps/admin_console + apps/cloud_service + 继承值重组）、`PYTHONUTF8=1`、`PYTHONUNBUFFERED=1`、`ARTEMIS_IPC_PORT`、`ARTEMIS_SESSION_ID`、`ARTEMIS_TASK_INGRESS`、`ARTEMIS_TASK_WORKER=1`、`ARTEMIS_CONVERSATION_ID`、`ARTEMIS_SUBMITTED_AT`（入队墙钟，轮次排序锚，task_queue_service.py:618-623）、`ARTEMIS_MODEL_ENDPOINT`（仅 pinned 时）、adb endpoint env（`target.endpoint.apply_to_environment`）、`ARTEMIS_ADB_ENDPOINT_ID`（lock scope）、`ARTEMIS_DEVICE_QUEUE_TICKET`、`ADB_DEVICE_SERIAL`（显式时）。
- spawn 选项：stdout=PIPE、stderr=STDOUT（**合并**）；Windows 加 `CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`（worker_process_io.py:32-51；测试 `test_windows_worker_has_no_inherited_console`）。
- run_key = session_id（无则 uuid4.hex）；launch 期取消竞争：spawn 后检查 cancelled_session_ids/manually_stopped_run_ids，命中则立即终止（task_queue_service.py:734-743）。
- spawn 后：登记 active_runs、trace_store.update_trace_pid 写 status.json、`transfer_reservation` 把队列票据转移给 worker pid（description=`"{ingress} task: {goal[:120]}"`——**原始 goal 必须来自 registry/queue item**，锁描述是格式化截断的，task_queue_service.py:698-714）、启动输出转发器（tee 到 traces/<sid>/stdout.log，**该路径是 MCP API 对外宣称的日志路径**，task_queue_service.py:717-731）。

**调度（`queue_worker` + `_dispatch_pending_tasks`，task_queue_service.py:376-540）：**
- 常驻循环：探测挂起队列 → 派发 → `wake_event.wait(0.3s)`；初始 `cleanup_stale_locks`；取消时终止全部活 worker。
- 并发语义：`resolve_env_concurrency()` 0=每设备一个任务、N≥1=全局 N（`ARTEMIS_CONCURRENCY_MODE` global/serial/1→1、per_device/device/parallel/0→0、`ARTEMIS_MAX_CONCURRENT_TASKS` 默认 0；device_lock.py:601-613）。limit==1 且 is_running 时不派发。
- 容量计数把「已派发未 spawn」的 running 队列项也计入（active_runs 滞后于 subprocess 启动延迟，task_queue_service.py:479-493）。
- `prune_finished_runs`：进程退出或 **PID 已不存在**的 run 从 active_runs 剔除，防止死协程永久占位（state.py:168-182）。
- auto 设备（无 serial）任务只在完全空闲的调度器上起（limit==0 时 active_runs/in_flight/dispatched_any 任一非空即跳过），因为它的 lockKey 未定（task_queue_service.py:517-521）。
- cancelled_session_ids 中的 pending 项直接移除。

**settle/kill 与终态（task_queue_service.py:310-333, 745-828, 959-1067）：**
- 终态解析 `_resolve_terminal_status` 优先级：手动停止 → `cancelled`；worker 写入的 DB status 是**权威**（`success`→`completed` 归一；completed/failed/cancelled 原样保留且不再写库）；DB 无终态时退出码兜底（0→completed，非 0→failed）。测试 `test_resolve_terminal_status_preserves_authoritative_result`。
- DB 行不存在且结果为 failed → **补插最小 failed 行**（`create_failed_session`：goal/created_at 作 start_time/conversation_id/submitted_at/stdout 尾行或默认 "Task failed before executing any step."；INSERT OR IGNORE，task_queue_service.py:770-791 + session_repository.py:529-569；测试 `test_worker_death_before_session_row_persists_failed_round`、`test_manual_stop_without_row_never_inserts_failed_row`）。
- 终态同步写回 trace status.json（canonical：completed/success→completed）供 MCP 轮询方对账，OSError 重试 3 次（0.5s/1.0s 退避）（task_queue_service.py:803-827）。
- 结束广播 `session_ended {session_id, status, was_stopped_manually}`；**仅当有 conversation_id 或 ingress=="mcp" 才外发通知**（mcp_server.notifiers.notify，payload 带 trace_id/session_id/status/goal）（task_queue_service.py:944-962）。
- 失败且非手动停止 → 进入熔断判定（§1.2）。
- 清理 `_release_run_slot`：移除队列项、丢弃取消标记、清 cancel marker 文件、弹 active_runs；最后一个 run 结束时清 manually_stopped_run_ids 防泄漏（task_queue_service.py:964-993）。

**/api/stop（task_queue_service.py:1488-1937）：**
- `all=true`：取消所有未 running 项的票据 → 清队列 → **清 held_queues 与手动暂停** → 终止全部设备锁 owner（逐个优雅停止 + DB/trace 标 cancelled + session_ended 广播）→ 终止本地 runs（逐 run 标记，测试 `test_manual_stop_of_one_run_does_not_pollute_concurrent_run`）→ 清 pause 文件。
- 定向（session_id/device_id）：owner 解析顺序——按 session 匹配 owner → 按 device 匹配 owner → 作用域回退 owner（**不同 session 的陈旧 owner 永不收养**，测试 `test_stop_tasks_session_target_never_adopts_mismatched_fallback_owner`）→ 本地 run（PID 相等才认 is_local_owner）→ 队列项票据取消 → DB 行 running 且 PID 活着则优雅停止。owner 记录存在但不可解析且未指定 session 时**拒绝停止**（task_queue_service.py:1674-1677）。无目标（遗留单设备手势）仅在恰有一个活 run 时才歧义消除。
- 停止目标解析出 session 后：cancelled_session_ids 登记由该 run 自己的 finalizer 收尾（并发安全）、DB/trace 标 cancelled、session_ended 广播、队列项移除、清 pause 文件。

**覆盖状态**：生命周期大方向已覆盖（todo S1–S3、S7、映射表 task_queue_service 行）；但 env/CLI **全量**契约（S5 只列 5 个）、幂等/去抖、admission 探测管线、终态权威顺序、票据转移失败兜底（"worker will queue a fresh ticket itself"，task_queue_service.py:710-714）均为**缺失**。
**处置建议**：env/CLI 表与幂等语义 → 新增差距（见 §4 G8/G10）；终态权威顺序与 never-started 补插 → 保留为 autogamer-queue 的领域规则（自建 TS，不得丢）；admission 探测 → P0/P1 一期保留 py doctor（映射表 E 行已定）。

### 1.2 失败分类体系与熔断挂起（hold）

- `ENVIRONMENT_ERROR_MARKERS` **具体内容**（小写子串匹配，task_queue_service.py:77-96）：`device, adb, helper, llm error, llm request, model, unavailable, rate limit, quota, api key, unauthorized, forbidden, timeout, timed out, connection, refused, 503, 502`（18 个；todo S4/G4 只点名机制未列内容）。注意宽泛词（model/connection/timeout）可能把任务级失败误判为环境级——这是现状语义，照搬前应有意识。
- `_classify_failure`（task_queue_service.py:1070-1086）：**零步骤失败 → environment（不看错误文案）**；有步骤且命中 marker → environment；否则 task。测试 `test_failure_classification_separates_environment_from_task`。
- 判定输入：`step_repo.has_steps`（探测 schema 失败 → **不挂起、继续派发**，fail-open，task_queue_service.py:1104-1111；测试 `test_step_probe_failure_keeps_queue_dispatching`）+ DB 行 error_message。
- hold 结构（`state.held_queues[lock_key]`）：reason/failure_class/session_id/device_serial（显式 serial 或 "auto"）/last_probe。**auto 设备失败挂的是端点默认队列键**——该端点上所有 auto 任务都被挡（task_queue_service.py:1123-1131；测试 `test_auto_device_failure_holds_default_queue`）。hold 按设备隔离，其他设备照常派发（测试 `test_hold_is_per_device_other_device_keeps_dispatching`）。
- hold 期间后续消息**保留 pending、可见**（SSE `queue_held` 事件含 reason/failure_class）。
- 解除路径（共 4 条）：① 设备重新上线——`_probe_held_queues` 每 **5s**/设备节流，用真实枚举判定；**枚举不确定（adb 不可达）→ 继续挂**（fail-safe），恢复后广播 `queue_resumed`（task_queue_service.py:418-462；测试 `test_held_queue_auto_resumes_when_device_comes_back`）；② 对该 lock_key 的新提交（①-③ 见 §1.1）；③ `resume_queue`（手动，清全部）；④ stop 全部。
- **当前是单次环境级失败即挂**（无失败计数）；todo S4 的新设计是「连续 ≥ allowed_fails → open」——这是有意的语义变化，但 **allowed_fails 默认值未决**。

**覆盖状态**：机制与半开恢复已覆盖（todo S4、D3.c、G4）；marker 内容、零步骤规则、auto→端点默认键、枚举不确定继续挂（fail-safe）vs 步骤探测失败不挂（fail-open）的不对称、单次即挂 vs allowed_fails 计数的差异为**缺失/需显式决策**。
**处置建议**：挂起解除矩阵与不对称策略写进 autogamer-queue 规格ENVIRONMENT_ERROR_MARKERS 原样沿用（G4 已定）；allowed_fails 默认值需决策（建议 1，保持现状语义）。

### 1.3 pause/resume 语义（共三个不同的「暂停」，不可混淆）

| 机制 | 范围 | 语义 | 证据 |
|---|---|---|---|
| 手动队列暂停 `POST /api/queue/pause`（`state.queue_manually_paused`） | 全局调度器 | pending 全部保留不派发；**运行中不受影响**；resume 解除 | task_queue_service.py:1883-1911；state.py:65-67 |
| 熔断挂起 `state.held_queues` | 设备（lock_key）维度 | 见 §1.2；`POST /api/queue/resume` **同时**解除手动暂停与全部挂起 | task_queue_service.py:1896-1911；测试 `test_manual_pause_gates_dispatch_and_resume_clears_holds` |
| 任务级暂停 `PAUSE_FILE`（`POST /api/resume` 清除） | 单 worker 内部 | worker LLM 重试层在不可恢复 LLM 失败时写 pause 文件，engine 轮询暂停；`/api/status` 以 `status:"paused"+paused_error` 暴露（剥离 `"LLM Error: "` 前缀，默认文案 "AI model request failed. The task is paused."）；stop 请求顺手清文件 | state.py:232-247；artemis/services/llm.py:307,866-870；task_queue_service.py:1401-1410,1939-1944 |

**覆盖状态**：queue pause/resume 已覆盖（映射表「/api/stop、queue pause/resume」行）；但该行把它映射到 `agent.cancel + inbox splice`，与实际语义（**调度器闸门，不碰任何运行中任务**）不符——轻微**矛盾**；PAUSE_FILE 任务级暂停 + paused_error 契约完全**缺失**（worker 内 py 保留件，但其 HTTP 面与状态字段是控制台契约）。
**处置建议**：映射表该行修正为「queue pause/resume → autogamer-queue 调度器闸门（自建，百行）」；PAUSE_FILE 暂停随 worker 一期黑盒保留，DSH 侧无对应（LLM seam 重试原生），前端删除后仅 /api 消费方可见。

### 1.4 /api/status 四源合并 与 /api/stream SSE

**/api/status（routers/tasks.py:281-480）四源**：
1. `state`（queue_items/active_runs/active_connections/current_*）；
2. `DeviceExecutionLock`（global owner + active_owners + 排队票据）；
3. `session_repo`（latest session、running session id、DB 行 profile/LLM traces 反推）;
4. `state.submission_meta`（registry 回填）。
关键规则（AGENTS.md 已载规则此处只列名）：registry 值恒优先于票据视图（created_at 是锁文件 mtime=取号时刻非提交时刻；goal 是 "frontend task: <goal>" 格式化值）；队列项优先、registry 兜 worker 已取走的任务；active_tasks 字段 = device_id/session_id/raw goal/pid/ingress/acquired_at/conversation_id/created_at（tasks.py:320-339）；pinned endpoint 时 model_info 报 pinned 记录而非全局当前值（tasks.py:379-384）；`status` ∈ running/paused/idle，running 优先，其次 latest-session 有 IPC 连接，否则 idle（idle 也带 queue/active_tasks/model_info/ipc_port）；`queue_paused`+`queue_holds[]` 每个响应都带（tasks.py:418-429）。

**/api/stream（SSE，routers/tasks.py:483-614）**：
- 事件名全集：`info`（订阅确认）、`session_started`、`session_ended`、`startup_progress`、`step_recorded`、`step_updated`、`trace_recorded`、`background_tasks_updated`、`recording_ready`、`recording_failed`、`queue_held`、`queue_resumed`、`queue_paused`、`server_shutdown`、`keep-alive`（data `{}`）。
- **订阅即回放**：`all/active` 订阅时合成一条 session_started + 补发该会话全部 startup_progress + **已落库步骤逐条 step_recorded**——晚接入的客户端不空窗（tasks.py:522-561；测试 `test_stream_events_active_session_replay`）。指定 session 订阅时也补发其 startup_progress。
- 过滤规则：session_started/session_ended/background_tasks_updated 恒全局送达；其余事件按 session_id 过滤（无 session 的事件以 active_session_id 判定）（tasks.py:492-512）。
- 空闲 5s 发 keep-alive；shutdown_event 触发即断流；payload 经 `ipc_service.sanitize_event_data` 清洗（剥截图字节、trace payload 归一，ipc_service.py:69-134）。

**覆盖状态**：两endpoint的去留已覆盖（映射表「/api/status 四源合并 ✅ 删除」「ipc_service + /api/stream ✅ 删除自建」）；事件名全集、订阅即回放语义、paused/idle 响应形状为**缺失**。G2 只覆盖了「步骤时间线降级」的 UI 面。
**处置建议**：DSH `session/event` 流需验证等价物：晚订阅 catch-up（或前端接受空窗）+ 队列级生命周期事件（queue_held/paused/resumed）在 DSH 事件模型中的承载——建议作为 P1/P3 验证点写入 checklist；事件清单保留为契约测试素材（G5）。

### 1.5 worker 死亡检测、stdout 尾行、孤儿处理

- 等待退出：`wait_for_worker_process` 1.0s 轮询 + psutil 看门狗——PID 被外部 reap/zombie 时以 `-15` 兜底返回（worker_process_io.py:126-145；测试 `test_wait_for_worker_process_watchdog_handles_reaped_process`）。
- 输出转发：增量 UTF-8 解码（防多字节截断，测试 `test_forward_worker_output_preserves_split_utf8`）、4096B 块、tee 到 stdout.log、排空 2.0s 超时防句柄拖死队列（worker_process_io.py:54-123）。
- stdout 错误尾行 `_worker_error_tail`（task_queue_service.py:830-857）：读 stdout.log **末 4096 字节**、取最后一条非空行、截 300 字符、剥 traceback 首行模块路径前缀（`pkg.module ExcType: msg` → `ExcType: msg`，仅当点分段全是标识符）。测试 `test_worker_error_tail_reads_last_stdout_line`。
- 录屏兜底 `_recover_or_fail_recording`（task_queue_service.py:859-922）：worker 死前未 finalize 的原始 scrcpy 文件 → remux 发布 → 广播 `recording_ready`；无文件可救 → `mark_recording_failed_if_pending` + `recording_failed`。启动时另有全量扫描（`recover_orphaned_recordings_on_launch`，跳过仍 running 会话的行，session_repository.py:157-189；测试 `test_startup_sweep_publishes_orphaned_recordings`）。
- 孤儿 session 对账：启动时 `cleanup_orphans_on_startup`（status=running 且 **PID 确认死亡**才标 failed；liveness 不确定=存活，绝不误收杀，session_repository.py:424-473；测试 `test_startup_cleanup_keeps_live_cross_process_session`）；`/api/sessions` 列表时对 running 行再校验（非 active 且 worker 死 → failed + auto-harvest + trace 标 failed，routers/sessions.py:111-181）。repo 模块加载时把 reconcile 注册进 server_lifecycle（**停止跨进程 worker 的钩子**，session_repository.py:600-606）。
- 优雅停止：不发信号，写 **cancel marker 文件**（带 PID + process_created_at 防 PID 复用误伤，psutil 取创建时刻），worker 轮询后走正常取消路径（停录屏 remux、编译 trace、释放租约）；宽限 `ARTEMIS_CANCEL_GRACE_SECONDS`（默认 **45s**，0=立即杀）；宽限期到由 deadline enforcer 硬杀（0.5s 轮询），杀后清 marker（task_queue_service.py:73-242；测试 `test_stop_requests_graceful_cancel_and_skips_kill_when_worker_exits`、`test_stop_kills_worker_that_ignores_the_cancel_request`、`test_stop_tasks_does_not_kill_stale_reused_pid`、`test_zero_grace_keeps_the_immediate_kill`）。

**覆盖状态**：孤儿对账已覆盖（S7、D5、映射表 cancel_requests/trace_store 行）；「PID 复用前科」已提及（todo 背景段）。**缺失**：cancel-marker 优雅停止整套语义（宽限、created_at 防 PID 复用、取消路径收尾录屏/trace/租约）、stdout 尾行提取规则、`-15` 看门狗、/api/sessions 列表期 auto-harvest。
**处置建议**：优雅停止是 DSH `JobRegistry.kill`（即时杀）**没有**的语义——若一期直接换 kill，取消中的任务将丢录屏 remux 与 trace 编译（只能靠启动对账兜底）。需决策：① DSH kill 前置钩子/先发 cancel marker 再延时 kill（autogamer-queue 内自建，推荐）；② 或明确接受硬杀语义并写进 G6。尾行提取与 auto-harvest 规则随 never-started 补插一起保留在 queue 侧。

### 1.6 replay_manager 能力清单（2276 行，删除前资产清点）

todo 映射表已定「回放 → DSH trajectory replay（session log fork/replay）原生承接大头；录屏产物经 spillPath → ✅ 一期后删除」。此处只补 todo 未写的**能力边界**，供二期评估 DSH trajectory replay 是否真覆盖：

- **回放对象**：单步骤沙箱重执行，仅两个注册工具 `ask_explorer` / `ask_image_processor`（REPLAY_TOOLS_CONFIG，replay_manager.py:46-79）——拦截 Gemini 调用（wrapped_generate_content）捕获思考/原始输出，物理设备实时交互（adbutils + UIAutomator）。
- **状态重建**：把 session traces 切块到 `traces/replay/data/<sid>_chunked/step_NN/`（`.chunked` 哨兵文件标记成功；DB 步数与块数不一致自动重切，replay_manager.py:1251-1290）；沙箱临时 SQLite（setup_temporary_database）+ 步前状态预填充 + 主库截图/图片引用。
- **产物**：沙箱输出在 `traces/replay/outputs/<sid>_step_<NN>/temp_traces/data_engine.db`（`/api/traces/{id}` 会优先查这个沙箱库，routers/steps.py:56-66）；回放 trace 树经 `/api/sessions/{sid}/steps/{n}/replay_traces` 读取。
- **与录屏的关系**：`resolve_master_video_path` 从 DB recorded path/文件索引定位主录像；`calculate_virtual_start_time` + `_preemptive_clip_video` 预切该步对应的视频片段（回放 UI 与原步骤视频对齐）。
- **启动钩子**：每次启动把残留 replay outputs 归档到 `traces/data/older/<name>_<ts>`（`archive_older_replays_on_launch`）；对 **DB 中全部 session** 校验/补切块（`verify_chunks_exist_on_launch`——历史大会拖慢启动）。
- 测试基线：test_replay_state.py（沙箱状态构建）。

**处置建议**：删除按映射表执行；但「replay outputs 归档/切块校验启动钩子」与「沙箱 DB 优先的 trace 查询」随控制台删除，无需迁移。若二期要保步骤级工具重放（explorer/image_processor），能力清单此节是唯一记录，建议移入项目记忆。

### 1.7 端口、静态资源、鉴权与进程生命周期

- 绑定：默认 `127.0.0.1:8000`；env `ARTEMIS_SERVER_HOST` / `ANTIGRAVITY_SIDECAR_WEB_PORT`（server.py:478-496）。远端访问约定走隧道 + `ARTEMIS_ALLOWED_HOSTS`。
- **SameOriginBoundaryMiddleware**（core/security.py:100-178）：无账号模型——能连上 TCP 端口即操作者；浏览器向量两关闭：Host 校验防 DNS rebinding（IP 字面量恒可信、localhost + ARTEMIS_ALLOWED_HOSTS 白名单）、Origin==Host（或白名单）防 CSRF；**无 Origin 头的非浏览器客户端直通**；`ARTEMIS_DISABLE_ORIGIN_GUARD=1` 关闭；附加安全头（nosniff/no-referrer/DENY frame/COOP）+ `/api/*` no-store；websocket 同样过检（纯 ASGI）。403 JSON 拒绝。
- **管理面鉴权**（routers/system.py）：`/api/system/restart` 仅 loopback（延迟 0.6s，POSIX execv / Windows Popen+`os._exit`）；`/api/system/shutdown` loopback + `x-artemis-lifecycle-token` 头（启动时 `secrets.token_urlsafe(32)`，写进 server info 文件供本地 CLI 读取，server.py:112-113）；ADB 端点变更 loopback（`ARTEMIS_ALLOW_REMOTE_ADB_CONFIGURATION=1` 可放开）+ Origin==Host。测试 `test_restart_is_loopback_only`、`test_adb_endpoint_mutation_*`。
- 生命周期：`write_server_info`（pid/port/lifecycle_token）→ adb 预热（防首秒提交撞 adb 冷启动，server.py:137-147）→ 清陈旧锁 → 后台：归档 replay、校验切块、孤儿对账、孤儿录屏恢复 → IPC server（127.0.0.1:0 临时端口 + 端口文件）→ queue worker。关闭顺序（server.py:164-216）：置 shutting_down + 广播 server_shutdown → 取 worker task（5s）→ 取消 run coroutines 让 finalizer 跑完（5s）→ 杀残余进程 → 取消队列票据 → 清锁 → **仅对 UI 拥有的 running 队列项标 cancelled**（跨进程 worker 不动，测试 `test_shutdown_marks_only_ui_owned_running_sessions`）→ 停 IPC → 停 awake 服务 → 清 server info。
- **Windows SIGINT 保护**：任务活跃时忽略 Ctrl+C（防误杀），Ctrl+Break 强制（ArtemisUvicornServer.handle_exit，server.py:421-444；测试 `test_windows_sigint_is_ignored_while_task_is_active`）。
- uvicorn `timeout_graceful_shutdown=5`。
- SPA 服务（server.py:242-382）：dist 查找顺序 `showcase_ui_v2/dist/browser` → `dist/` → wheel 内捆绑（测试 test_showcase_dist）；路径解析防穿越（`_resolve_static_file`）；拦截排除前缀 `api/ images/ videos/ local_file docs openapi.json redoc`；`/admin`、`/debug` 走旧控制台 index。
- 媒体端点安全（routers/media.py + media_service）：`/images/*` 仅 IMAGES_DIR 内 .jpg；`/videos/*` 限 WORKSPACE_ROOT/TRACES_PATH 根 + mp4/webm/mkv 后缀（resolve(strict) 后复查 is_relative_to）；`/local_file` 仅媒体后缀白名单（jpg/jpeg/png/gif/webp/mp4/webm/mkv）；session video 契约：recording/finalizing → `{status:"processing", retry_after_ms:750}`；ready → URL 带 `?v=<end_time*1000>` 版本参数 + 分段列表；failed 且无可救文件 → `{status:"failed", message}`（routers/media.py:110-176；测试 test_media_recording_lifecycle）。

**覆盖状态**：鉴权/设备流/查询 API 的去留已覆盖（映射表「core/security.py → DSH 认证原生 ✅ 删除/收缩」）；SameOrigin 具体行为面、管理面 token/loopback 规则、SIGINT 保护、关闭对账范围、媒体 URL 版本契约、启动 adb 预热为**缺失**。
**处置建议**：过渡期旧控制台只读共存（G7/P4）意味着这套 HTTP 面仍活着——建议 P4 把「同源边界 + lifecycle token + no-store」列为共存期不可回退项；DSH web profile 的认证模型与此不同（账号/凭据），切换时外部 SDK/MCP 调用方清单纳入 P4（G7 已含外部接入方，补充「无 Origin 直通」假设的迁移验证）。

### 1.8 数值参数总表（迁移时需显式决定去向的硬编码常量）

| 常量 | 值 | 位置 | 说明 |
|---|---|---|---|
| 取消宽限 | 45.0s（env `ARTEMIS_CANCEL_GRACE_SECONDS`，0=立即杀） | task_queue_service.py:73,98-110 | 优雅停止 |
| 强杀期限轮询 | 0.5s | task_queue_service.py:216,226 | deadline enforcer |
| 调度器 tick | 0.3s（wake_event 超时） | task_queue_service.py:406 | 派发循环 |
| 挂起队列探测节流 | 5.0s/设备 | task_queue_service.py:437 | adb 枚举 |
| 提交防抖窗口 | 1.0s | task_queue_service.py:1195 | 同 goal+设备 |
| 同批 created_at 错峰 | index×1ms | task_queue_service.py:1284-1285 | 排序稳定 |
| submission_meta 容量 | 500 条 | state.py:95 | FIFO 淘汰最旧 |
| startup_progress 保留 | 16 条/会话 | state.py:275 | 按 stage upsert |
| stdout 尾行 | 末 4096B / 300 字符 | task_queue_service.py:831,851 | 错误横幅 |
| 终态 status.json 重试 | 3 次，退避 0.5/1.0s | task_queue_service.py:806-827 | MCP 对账 |
| 输出转发 | 4096B 块 / 排空 2.0s | worker_process_io.py:87,111 | |
| 退出等待看门狗 | 1.0s | worker_process_io.py:130 | psutil 兜底 |
| IPC | 127.0.0.1:0 临时端口；行上限 100MB | ipc_service.py:217 | worker→daemon |
| SSE keep-alive | 5.0s | tasks.py:577 | |
| uvicorn 优雅关闭 | 5s（worker/run 各再等 5s） | server.py:461,468,179,191 | |
| restart 延迟 / shutdown flush | 0.6s / 0.05s | system.py:1226,1269 | |
| MJPEG 采集 | 目标 0.08s（下限 0.03s）、帧>1000B、发送 0.04s | device_stream_service.py:82-88,132 | screencap 轮询 |
| 批量删除上限 | 500 | sessions.py:262 | 400 拒绝 |
| model_info 缓存 TTL | 10s | model_service.py:29 | 配置改动生效窗 |
| 视频处理轮询提示 | retry_after_ms=750 | media.py:132 | |
| ffmpeg 转换 | ≤45s，失败结果也缓存 | media_service.py:47-49 | 防重复转换 |
| 默认绑定 | 127.0.0.1:8000（`ARTEMIS_SERVER_HOST`/`ANTIGRAVITY_SIDECAR_WEB_PORT`） | server.py:483,492 | |
| 并发解析 | mode global/serial/1→1；per_device/device/parallel/0→0；`ARTEMIS_MAX_CONCURRENT_TASKS` 默认 0（=每设备） | device_lock.py:601-613 | |
| profile 反推 LLM traces | limit 3 | session_repository.py:231 | |
| 注册重放步骤 | 每次 /api/sessions 轮询全量重算 | sessions.py:71-183 | to_thread 防阻塞 |

**覆盖状态**：全部**缺失**（todo 无任何参数表）。
**处置建议**：随行为归属（autogamer-queue / autogamer-media / DSH job 配置）逐项分配；其中 45s 宽限、5s 探测、1s 防抖、并发解析是行为敏感项，建议成为 conformance 测试断言（G5）。

---

## 2. 外部契约清单

### 2.1 HTTP API（请求/响应字段；消费方：showcase_ui_v2、artemis-client SDK、mcp_server、CLI）

| 端点 | 方法 | 请求要点 | 响应/错误契约 | 证据 |
|---|---|---|---|---|
| /api/run | POST | goal 或 goals[]；profile/expected_output/enable_outputter/verification_level/explorer_mode/locked_app_package/app_path/device_serial/model_endpoint/ingress/session_id/conversation_id（task_schema.py:18-38） | `{status: started\|queued\|rejected, tasks[], enqueued_count, total_queued}`；rejected 附 error、tasks=[]；400（无 goal / 未知 model_endpoint）；409（设备锁定/锁状态未知） | tasks.py:69-198 |
| /api/run/defaults | GET | — | `{verification_level, explorer_mode}`（来自 artemis.jsonc） | tasks.py:201-214 |
| /api/devices | GET | — | `{devices:[…]}`；**tasks.py 与 replay.py 重复注册，先注册者（tasks）生效** | tasks.py:217-221; replay.py:33-36 |
| /api/stop | POST | query 或 JSON body：all/session_id/device_id | `{status:"stopped", session_id}` 或 `{status:"no_running_task"}` | tasks.py:224-256 |
| /api/resume | POST | — | `{status:"resumed"}` / `{status:"not_paused"}`（清 PAUSE_FILE） | tasks.py:259-264 |
| /api/queue/pause | POST | — | `{queue_paused:true}` | tasks.py:267-271 |
| /api/queue/resume | POST | — | `{queue_paused:false}`（同时清熔断挂起） | tasks.py:274-278 |
| /api/status | GET | — | running: status/paused_error/goal/pid/session_id/background_tasks/queue[]/model_info/active_tasks[]/queue_paused/queue_holds[]；idle 另带 ipc_port | tasks.py:281-480 |
| /api/stream[/{sid}] | GET(SSE) | client 可选 | 事件清单见 §1.4 | tasks.py:483-614 |
| /api/stream/device-live,-state | GET | — | MJPEG multipart（boundary=frame）/ {connected,serial,live_stream_url} | stream.py:31-56 |
| /api/tasks/presets,/api/tasks/catalog | GET | category/packages/limit | 推荐任务 / 全量目录+应用注册表 | tasks.py:45-66 |
| /api/sessions 系列 | GET/POST | — | 列表（含 device_id/recording_status/video_url/model_info，轮询内 auto-harvest）、详情、usage、tree、startup_progress、checks、plan、notes、video；/api/cleanup 清空全部；单删/批删（≤500，部分失败 degraded per-item） | sessions.py 全文; media.py:110-199 |
| /api/sessions/{sid}/steps, /api/steps/{id}/traces, /api/traces/{id}[/download] | GET | session_id+step_number 可选沙箱库回退 | 步骤列表/trace 树/trace payload（unwrap 媒体引用） | steps.py 全文 |
| /api/system/* | GET/POST/DELETE | readiness、devices/select、adb restart/connect/heal-keys/server*、emulator launch/status/stop/dismiss、credentials(/test/entries)、model-config(GET/POST/DELETE)、endpoints/use、endpoints/{name}(DELETE)、server-status、restart、shutdown | 管理面鉴权见 §1.7；凭证仅回 presence/masked 预览，原文不出进程 | system.py 全文 |
| /api/replay/*, /api/sessions/{sid}/replay_steps, …/replay, …/replay_traces | GET/POST | ReplayRequest{device_id,user_submits,tool_name,replay_id} | 沙箱重放触发与 trace 树 | replay.py 全文 |

### 2.2 worker 进程契约（env + CLI + IPC + 文件）

| 类别 | 契约 | 证据 |
|---|---|---|
| env | `ARTEMIS_SESSION_ID`、`ARTEMIS_CONVERSATION_ID`、`ARTEMIS_SUBMITTED_AT`、`ARTEMIS_TASK_INGRESS`、`ARTEMIS_TASK_WORKER=1`、`ARTEMIS_IPC_PORT`、`ARTEMIS_MODEL_ENDPOINT`（仅 pinned）、`ARTEMIS_ADB_ENDPOINT_ID`、`ARTEMIS_DEVICE_QUEUE_TICKET`、`ADB_DEVICE_SERIAL`、endpoint env、`PYTHONPATH` 三段重组、`PYTHONUTF8=1`、`PYTHONUNBUFFERED=1` | task_queue_service.py:597-663 |
| CLI | `-m artemis.main <goal> --profile --test-name web_<ts>_<key8> --session-id --output-description --enable/-disable-outputter --verification-level --explorer-pro-mode --locked-app --app-path --device-serial`；cwd=workspace | task_queue_service.py:635-663 |
| spawn | stdout=PIPE、stderr→stdout 合并；win32 `CREATE_NEW_PROCESS_GROUP\|CREATE_NO_WINDOW` | worker_process_io.py:32-51 |
| IPC（worker→daemon，127.0.0.1:port） | 每行 JSON `{event_type, data}`；`session_started{session_id,pid,initial_goal,device_info{profile}}` 登记连接/取消会话抑制；`session_ended` 清理；`startup_progress` 落盘；其余全部转播订阅者 | ipc_service.py:136-227 |
| 文件 | `traces/data_engine.db`（sessions/steps/traces/background_tasks/video_recordings）；`traces/<sid>/status.json`（+lock/corrupt 隔离）；`traces/<sid>/stdout.log`（MCP 宣称路径）；`traces/images/`；`traces/replay/data\|outputs`；`traces/data/older`；pause 文件（app_dir 或 ROOT）；IPC 端口文件；server info 文件（pid/port/lifecycle_token） | paths.py:224-266; trace_store.py:196-305 |

### 2.3 SSE 事件与 payload（要点）

| 事件 | payload 要点 | 来源 |
|---|---|---|
| session_started | session_id/initial_goal/profile/device_serial | task_queue_service.py:568-576 |
| session_ended | session_id/status/was_stopped_manually | task_queue_service.py:935-942 |
| startup_progress | session_id/stage(queued→launching→process_ready)/message/timestamp | task_queue_service.py:271-282 |
| queue_held | device_serial/lock_key/session_id/reason/failure_class | task_queue_service.py:1136-1145 |
| queue_resumed | reason:"manual" 或 device_serial/lock_key | task_queue_service.py:458-461,1908 |
| queue_paused | reason:"manual" | task_queue_service.py:1891 |
| recording_ready/failed | session_id/video_url / error | task_queue_service.py:910-922 |
| step_recorded/step_updated | 步骤字典（剥 screenshot 字节；payload 清洗；normalize_step_actions） | ipc_service.py:94-133 |
| server_shutdown | {status:"stopping"} | server.py:168 |

**覆盖状态**：§2 全表的「承载物去留」已由映射表覆盖；字段级契约为**缺失**。S2 只定义了 job output/exit-code 映射，未列 env 全集。
**处置建议**：§2.2/2.3 原样作为 S2/S5 契约测试素材；§2.1 中被删除端点的外部消费方（mcp_server 读 status.json/stdout.log 对账、artemis-client 调 /api/run //api/status）迁移清单归入 P4/G7。

---

## 3. 漂移风险 Top 10（最易无声丢失，按风险降序）

1. **worker env/CLI 全量契约**（S5 只列 5 个）：漏 `ARTEMIS_SUBMITTED_AT` → 轮次排序回退到设备启动时刻、队列洗牌（AGENTS.md 教训重演）；漏 `ARTEMIS_TASK_INGRESS` → mcp 通知路由失效；漏 ticket/scope env → 设备锁跨进程语义断裂。
2. **优雅停止整套语义**（cancel marker + 45s 宽限 + created_at 防 PID 复用 + 取消路径收尾 remux/trace/租约）：DSH kill 即 killed，直接替换会把「停止」降级为硬杀，录屏与 trace 靠启动对账兜底。
3. **终态权威顺序**（worker 写的 DB status 权威 > 退出码 > cancelled 优先；success→completed 归一但 get_session_status 特意保持 raw 供对账）：S2 的「退出码 0→completed / 非 0→failed」只是兜底层，若当主规则会覆盖 worker 的真实结果。
4. **never-started failed 轮次补插**（含 stdout 尾行提取规则）：丢了它，启动前死掉的轮次从时间线消失、队列与可见轮次不一致（这套行为的修复有测试锁定）。
5. **幂等/去抖提交面**（session 短路 + 1s 防抖 + 重试跳过就绪探测 + 409/400 错误码）：SDK 重试与 UI 双击的防线；webhookRuntime 接入时若不保留，会重复操作设备。
6. **订阅即回放（catch-up）**：DSH session/event 若无历史回放，晚打开页面看不到进行中会话的任何步骤（G2 只覆盖展示降级，没覆盖 catch-up）。
7. **熔断解除矩阵与不对称 fail 策略**（枚举不确定→继续挂 / 步骤探测失败→不挂 / auto 挂端点默认键 / 单次即挂 vs allowed_fails）：G4 只定义了探测体；这些边界丢了会出现「adb 抖一下清空整队列」或「永挂」。
8. **同源边界与管理面鉴权**（Host/Origin、ARTEMIS_ALLOWED_HOSTS、lifecycle token、loopback-only restart/shutdown、/api no-store）：共存期与切换期都是攻击面；DSH 认证模型不同，等价性需验证。
9. **关闭/启动对账范围**（只取消 UI 拥有的 running 项；孤儿判定 PID 不确定=存活；跨进程 worker 永不误收杀 + repo 注册进 server_lifecycle 的钩子）：误杀别的 daemon 的 worker 是实测过的 bug 类。
10. **MCP 对账双通道**（DB 行 + trace status.json 双写、3 次重试、stdout.log 宣称路径）：mcp_server 轮询方靠它收敛 stale 状态；删 trace_store（映射表 ✅）时必须同步改 mcp_server，否则外部轮询永远看到 running。

---

## 4. 对 docs/todo.md 的修订建议

**新增差距（G8+）：**
- **G8 · worker 进程 env/CLI 完整契约表**：S5 的清单是子集，补 §2.2 全表（尤其 ARTEMIS_SUBMITTED_AT/TASK_INGRESS/TASK_WORKER/IPC_PORT/DEVICE_QUEUE_TICKET/ADB_ENDPOINT_ID/ADB_DEVICE_SERIAL/endpoint env/PYTHONPATH 重组/stderr 合并/Windows creationflags），并声明「py 侧零新增」的前提是这套 env 原样保留。
- **G9 · 优雅停止宽限语义**：cancel marker（PID+created_at 防复用）→ 宽限（默认 45s，env 可调）→ 到期硬杀 → marker 清理；取消路径上 worker 收尾（录屏 remux、trace 编译、租约释放）。DSH `JobRegistry.kill` 需 pre-kill 钩子或 autogamer-queue 先发 marker 再延时 kill；否则明确接受硬杀并写明录屏兜底路径。
- **G10 · 幂等/去抖提交语义**：session 级短路、1s 同 goal 防抖、重试跳过就绪探测、409 设备锁定 / 400 未知端点——webhookRuntime/SDK 入口需对齐，否则 SDK 重试重复操作设备。
- **G11 · 状态词汇表映射**：现网 vocabulary（pending/running/completed/failed/cancelled + legacy success→completed 归一、get_session_status 保持 raw）↔ DSH JobStatus（running/stopping/completed/killed/failed）：manual stop=cancelled ↔ killed；历史数据显示映射需显式定义。
- **G12 · 晚订阅 catch-up**：DSH session/event 流是否支持新订阅者回放历史事件（startup_progress/已落库步骤）；不支持则需 toolview/roster 侧补偿，作为 P3 验证点。

**映射表修正：**
- `routers/system.py` 现挂在 replay 行下（「replay_manager.py + routers/replay.py + routers/system.py（1071）」），但该文件实为 readiness/ADB 端点管理/emulator/credentials/model-config/lifecycle 五类，与回放无关——建议拆行：readiness+emulator 归 E 行（一期保留 py）、credentials/model-config/endpoints 归 F 行（DSH profiles+provider adapters）、server-status/restart/shutdown 归 launcher 行。
- 行数修正：task_queue_service 1880→2028；system.py 1071→1280；device_stream_service 120→137（小项，避免盘点失真）。
- 「/api/stop、queue pause/resume → agent.cancel + JobRegistry.kill + inbox splice ✅ 原生」一行：queue pause/resume 是**调度器闸门**（保留 pending、不碰运行中任务），与 agent.cancel/kill 不同物——建议改标「autogamer-queue 闸门（自建）」，且新设计里手动 resume 不再清熔断（半开自动恢复取代），需写明与现行为的差异。

**Checklist 增补：**
- P1 增补：熔断解除矩阵四路径 + fail-open/fail-safe 不对称 + auto 端点默认键；allowed_fails 默认值决策（建议=1 保持现行为）。
- P1 增补：never-started failed 轮次补插 + stdout 尾行提取 + 终态双写（DB+status.json 等价物）规则随 queue 插件落地。
- P4 增补：`/api/status`+trace_store 是 mcp_server 的对账回退路径——下线控制台前先改 mcp_server；无 Origin 直通假设（SDK/curl/CLI）在 DSH 认证下的等价性验证；共存期保留 SameOrigin+lifecycle token 行为。
- P0 增补：S2 spike 增加「kill 时 worker 能否收到通知并收尾」验证（对应 G9）。

---

### 附：本审计依据的测试基线（tests/unit/admin_console，迁移后由 conformance 测试接棒的对应关系）

- 队列生命周期/停止/熔断/幂等：test_task_queue_service.py（48 个用例，名称即行为基线）
- 优雅停止/录屏兜底：test_graceful_stop_and_recovery.py、test_media_recording_recovery.py、test_media_recording_lifecycle.py
- 服务边界/生命周期：test_security_boundary.py、test_server_lifecycle.py、test_server_status_endpoint.py、test_showcase_dist.py
- 就绪/设备准入：test_task_device_readiness.py、test_system_emulator_endpoints.py
- 模型 pin/配置：test_model_endpoint_pinning.py、test_model_config_endpoint.py、test_credential_entries.py、test_model_service.py
- 会话数据面：test_session_*.py、test_step_repository.py、test_session_usage_endpoint.py、test_startup_progress.py、test_replay_state.py
