# 迁移盘点 · 核心运行时与持久化

> **编号警示**：本文里 `**Gn · …**` 形式的「新增差距」段落属于早期编号方案，与 `docs/todo.md` 现行 G 编号**不是同一套**（G8/G9/G10/G11/G12 已撞车，冲突表见 [registry.md](../registry.md)）。引用内容时写「`inventory/0N` 的 X 段」，不要写 `Gn`。

> 范围: `artemis/runtime/**`、`artemis/data_engine/**`、`artemis/interfaces/cli/**`、`artemis/sdk/**`、worker 进程 `ARTEMIS_*` env 契约、`tests/unit/data_engine` 基线; 基线: cc6b20c; 日期: 2026-10-09
>
> 方法: 逐文件精读 + 全局 grep。每条含行为语义、证据 (file:line)、todo.md 覆盖状态、处置建议。todo.md 已覆盖的只标号不展开。

---

## 1. 行为与不变量

### 1.1 device_lock.py —— 跨进程设备互斥与 FIFO 队列

todo.md 定位: 映射表「device_lock.py 946 行 → 跨进程场景消失, 收缩为进程内闸门 + 熔断 (D2/D3)」——**方向已覆盖**, 但以下语义细节是自建盘点未记录的迁移输入 (尤其双跑期与孤儿对账):

**锁文件格式** (`DeviceLockOwner`): JSON `{pid, process_created_at, token(uuid4), device_id, description, acquired_at(ISO-UTC), session_id?, ingress?, lock_scope?}`, 写在 `<temp>/device-locks/artemis-device-<clean_id>.lock`, 创建用 `O_CREAT|O_EXCL` 原子占位 (device_lock.py:45-69, 141, 551-581)。

**FIFO 队列 ticket**: 全局共享目录 `<temp>/device-locks/artemis-global-device.queue/`, ticket 文件名 `{time_ns:020d}-{token}.wait`, **文件名前缀即排队序**。Windows 粗时钟 (~1ms) 会给连续预约相同前缀 → 进程内 `_reserve_lock` 串行化 + 前缀 bump 循环 (最多 64 次) 保证前缀唯一且严格递增; 同进程跨线程靠类级 threading.Lock (device_lock.py:88-95, 409-427)。**DSH 侧 Promise 链 FIFO (S3) 取代此机制, 但「Windows 时钟精度导致排序退化」是已修过的历史 bug, Promise 链天然免疫, 无需搬运**。

**pending/any parking 语义** (G3 相关, 但 parking 本身 todo 没写): `reserve()` 默认 `device_id="pending"` (提交占位); `_build_device_queue` 把未认领的 pending/any ticket **park 到恰好一个空闲设备** (按 lock-id 排序取候选), 而不是计入每台设备的队列——历史版本单个 pending 队头会卡住所有设备, parking 是修这个 bug 的不变量 (device_lock.py:296-343, 368-385)。worker 领到具体 serial 后 `transfer_reservation` 把 ticket 原地改写 (保留原始 mtime → 时间序不丢) 并带上 worker 的 pid/process_created_at (device_lock.py:445-486)。

**PID 复用防护 (核心不变量, 全仓库 5 处共用同一协议)**: 存活判定 = `(pid, process_created_at)` 二元组, `psutil.create_time()` 差 ≥1s 即判定 PID 已被回收 → 死; 无 created_at 的 legacy 记录降级为「进程名/cmdline 含 python/artemis/pytest 才信」; AccessDenied/无法判定 → **默认存活** (宁可漏清理不可错杀) (process_probe.py:15-98; device_lock.py:203-222)。同一协议还出现在 trace_store._lock_is_stale (trace_store.py:121-142)、awake_lease (awake_lease.py:79-86)、cancel_requests PID 标记 (cancel_requests.py:126-166)、ProcessSupervisor.terminate_tree_verified (supervisor.py:68-92, 销毁前校验 create_time 防 PID 复用误杀)。**S7 孤儿对账要 kill 孤儿 worker, 必须用此协议而非裸 pid**。

**锁 scope (多 ADB server)**: `ARTEMIS_ADB_ENDPOINT_ID` env = `tcp:<host>:<port>` 小写 identity (adb_endpoint.py:36, 82-85, 104-113); 有 scope 时 lock id = `<scope>__<device>` (device_lock.py:108-116)。同一台手机接在两个 ADB server 上是两把独立锁; ticket 匹配要求 scope 兼容 (device_lock.py:359-363)。S3「lockKey = endpoint+serial」已覆盖结论, 但 **env 注入链没写**: 队列 worker spawn 时 `target.endpoint.apply_to_environment(env)` + `env[LOCK_SCOPE_ENV] = target.lock_scope` (task_queue_service.py:629-630)——DSH bash job 跑 py worker 时若不注入, py worker 的锁会落到无 scope 的默认域, 与过渡期 py 线互不相认。

**ticket view 字段语义 (AGENTS.md 已写结论, 这里补证据与出处)**: `get_queued_tasks()` 返回的 `created_at`/`start_time` = **ticket 文件 mtime** (即 reserve 时刻/认领时刻, 不是提交时刻) (device_lock.py:869-889); `description` 由队列在 reserve/transfer 时写成 `f"{ingress} task: {goal[:120]}"` (task_queue_service.py:704, 1258)——「frontend task: 」前缀由此而来。真正的提交时刻在 `state.submission_meta` 注册表 + `ARTEMIS_SUBMITTED_AT` env (见 1.2/2.1)。**S3 的 `updateProgress("queued: waiting for device X")` 排队展示若要等价, 时间戳须来自 DSH Inbox/JobSpec, 不得复刻 mtime**。

**可重入**: 同 PID 且同 session_id (或同 token) 视为同一逻辑持有者——可越过 FIFO 直接再拿锁、可代替 release (device_lock.py:562-575, 671-684, 725-741)。**同 session 但不同 PID 不算重入** (pid 必须相等)。

**陈旧回收**: 损坏/不可读锁文件有 5s 宽限 (`_MALFORMED_LOCK_GRACE_SECONDS`); `cleanup_stale_locks()` 清死主锁 + 死主 ticket, stop_server 与队列 worker 启动时都调用 (device_lock.py:84, 232-244, 528-549, 981-1028; server_lifecycle.py:346, 375, 421; task_queue_service.py:391)。

**并发模式**: `ARTEMIS_CONCURRENCY_MODE` (global/serial/1→1; per_device/device/parallel/0→0) 优先于 `ARTEMIS_MAX_CONCURRENT_TASKS` (int; 0=按设备, 1=全局严格串行, >1=全局并发上限), mode=1 时重入父进程豁免 FIFO (device_lock.py:583-615)。队列服务共享同一解析 (task_queue_service.py:374)。**D3-c 熔断自建, 但「全局并发上限 N」这个第 3 种模式 todo 没提——DSH 侧若不承接, 配了该 env 的用户语义丢失 (需决策)**。

** acquire 循环**: 默认 poll 0.1s, 支持 `cancel_event` 中断等待 (抛 DeviceBusyError), 非阻塞模式抛带当前 owner 描述的 DeviceBusyError (device_lock.py:617-723)。S3 的 `gate.acquire(lockKey, signal)` + kill 中断已对应。

**覆盖状态小结**: 已覆盖 = 收缩方向 (D2/D3/映射表)。缺失 = parking 不变量、PID 复用协议、scope env 注入链、ticket mtime 语义佐证、全局并发上限 N 模式、可重入精确条件。

### 1.2 data_engine —— SQLite 持久化与会话/步骤生命周期

todo.md 定位: 映射表「data_engine + repositories + SQLite → session log, ✅ 删除自建」+ S5「终态留痕: DB/trace 仍由 DataEngine 写入 (一期)」——**去向已覆盖**, 但以下契约是一期黑盒 worker 继续依赖、且旧控制台只读共存期 (G7) 仍然生效的:

**DB 完整 schema** (SQLite, WAL, 连接 timeout 30s, 进程内 RLock 串行写; storage.py:70, 87-99, 103-104):

| 表 | 列 (语义) | 证据 |
|---|---|---|
| sessions | session_id PK; initial_goal; start_time(引擎拿到设备轮的时刻); end_time; status(**canonical: completed/failed/cancelled; "success" 是 legacy 别名, end_session 强制归一为 completed**, engine.py:675-677); device_info(JSON); video_filepath; pid(worker 进程); error_message; model_endpoint(提交时经 `ARTEMIS_MODEL_ENDPOINT` 固定); conversation_id(聊天线程); **submitted_at(入队墙钟, 由 env 注入, 聊天轮次排序锚)** | storage.py:105-135, 293-315; models.py:27-45; engine.py:617-634 |
| images | image_name PK = **截图 SHA-256**; timestamp; ocr_result JSON; ui_tree JSON; extra_metadata JSON; 内容寻址, 文件在 `traces/images/<hash>.jpg`, INSERT OR IGNORE + COALESCE 补写 OCR/UI tree | storage.py:137-145, 496-544; engine.py:837-877 |
| steps | step_id PK; session_id FK; step_number(**1-based 单调, 恢复会话时从已有 steps 重建计数** engine.py:645-660, 897-908); timestamp; pre/post_image_name; summary; action_taken JSON; operator_raw/native_thinking; last_execution_result JSON; extra_metadata JSON (含 foreground_app、pre/post_image_dhash、width/height、summary_status/version/source/model) | storage.py:147-165, 611-638; engine.py:879-978 |
| traces | trace_id PK; session_id; step_id; parent_trace_id(树); type("agent"/"tool"/"log"/"llm_call"); name; timestamp(**同 tick 冲突用 +N×1e-7 微移保证顺序** engine.py:1052-1054); duration; status(success/failed/running); payload JSON | storage.py:186-202; engine.py:1035-1085 |
| failed_outputs | 自增 id; session_id; trace_id; model_name; prompt; raw_output; error_message; timestamp —— 「crime scene」 LLM 坏输出留痕 | storage.py:204-217, 1054-1074 |
| background_tasks | task_id PK; session_id; summary; status(running/completed/failed); start/end_time; trace_id; logs(终态时从内存累积日志落库) | storage.py:219-231, 1076-1145; engine.py:1591-1632 |
| history_chunks | chunk_id PK; session_id; start/end_step_id; start/end_step_number(**身份 = step 区间**); source_step_ids JSON; subgoal_hash; version(**append-only, 同区间新版本号更大, 读侧 latest-wins**); status(pending/ready); band1 JSON/band2/band3/rendered_text | storage.py:232-251, 736-827; models.py:73-97 |
| video_recordings | video_id PK; session_id; device_id; start/end_time; local_video_path; status(**默认 recording, 迁移时对已有行按 end_time 回填 ready**); error | storage.py:252-277, 342-395 |
| (外部表) video_analysis_observations/segments | 不由 storage.py 创建 (video memory 侧建), 但 clear/delete 按 board_key=`session:<sid>`/`video:<vid>` 清理 —— **删自建时别忘了这两张表的存在** | storage.py:1179-1192, 1255-1268 |

**列自动迁移机制**: `_init_db()` 在**每次非只读 StorageManager 构造**时执行——`CREATE TABLE IF NOT EXISTS` + 一串 try/`ALTER TABLE ADD COLUMN`(吞 OperationalError); video_recordings 用 PRAGMA table_info 检查列再补 (storage.py:101-291)。**没有版本表、没有 down migration; schema 演进 = 启动时幂等补列**。G7「旧 DB 不迁移」成立, 但一期 worker 每次启动仍会对旧 DB 跑这套幂等迁移——**双跑期同一 DB 文件被 py 线持续演进, TS 侧任何「建表/校验 schema」的启动逻辑都必须容忍多出的列**。

**submitted_at vs start_time**: start_time = DataEngine.start_session 时刻 = 拿到设备轮的时刻; submitted_at = 入队墙钟, 由队列 worker 经 `ARTEMIS_SUBMITTED_AT` 注入, `_parse_submitted_at` 只接受 >0 的 float (engine.py:60-68, 629-633)。聊天轮次排序用 submitted_at (models.py:41-45 注释; AGENTS.md)。**会话延续取「最近完成轮」时却按 start_time DESC** (storage.py:455-471)——两个锚并存, 语义不同, 迁移 session log 时要各归其位。

**session 状态机**: create (INSERT OR REPLACE, status=running) → running → end_session(status∈completed/failed/cancelled, end_time=now); **end_session 幂等**: 已有 end_time 且 status∉(running,paused) 时跳过重复发布 (engine.py:687-692); **update_session 只更新 end_time/status/device_info/video_filepath/error_message** —— conversation_id/submitted_at/pid/model_endpoint 是 create 期一次性写, 之后不可变 (storage.py:322-340)。失败落库路径 = `_finalize_tracing` 把 task.status 映射为 session_status (failed/cancelled/completed) 写 end_session (third_party/mobile_use/sdk/agent.py:886-896); **worker 死亡(无机会 end_session)由孤儿对账补**: status=running 且 pid 已死 → 标 failed + end_time, 同步 status.json (session_repository.py:424-469; server_lifecycle.py:166-183 反转依赖注册)。

**step summary 版本化写** (并发收敛不变量): summary_status/version/source/model 写进 extra_metadata; 显式 version 低于存量 → 丢弃; version=None 自增; **status 降级保护**: pending 不覆盖 ready/failed, failed 不覆盖 ready (除非显式更新版本); summary 列只被 ready 写触碰 (storage.py:656-734; 测试 test_step_summary_versioning.py)。

**trace upsert 不变量**: ON CONFLICT(trace_id) — **running 写永不覆盖已 terminal (success/failed) 的 status/payload; timestamp 取 MIN(新旧); duration COALESCE** (storage.py:1017-1052) —— 乱序/重复上报收敛。

**截图去重**: pre==post 同 hash → post_image_name 置 None (engine.py:924-925; storage.py:869-876)。

**会话延续上下文 (跨提交记忆, todo 未记录)**: 同 conversation_id 的下一提交, worker 启动时读 `traces/<最近完成session_id>/notes/*.md` (文件名排序, 总量 ≤8000 chars) 拼成 header+sections 注入 planner 初始 State (storage.py:410-453; sdk/agent.py:357-374)。**这是「一个会话 = 多轮连续对话」的 py 侧实现本体; DSH 侧 agent 会话原生带记忆, 但一期黑盒 worker 仍靠它——G7 旧数据不迁移会导致切换瞬间会话记忆断档 (需在 P4 双跑清单里点名)**。

**写路径异步性**: 所有 SQLite/文件写经 `_run_in_background` (有 loop 走 asyncio.to_thread, 无 loop 起守护线程), `shutdown()` 等待全部落盘后才退出 (engine.py:1110-1141, 1238-1260)。**DSH job 的退出码 0 语义 = 「DataEngine 已落盘」, 依赖 py worker 正常走完 shutdown**。

**IPC 事件桥 (worker→server)**: DataEngine 把事件 (session_started/step_recorded/trace_recorded/step_updated/llm_stream/recording_ready/...) 以 NDJSON 发到 `127.0.0.1:<ARTEMIS_IPC_PORT>`; 端口双源 = 继承 env + 磁盘 port file (server 重启后 env 永久过期, file 是新鲜源); 连接失败指数退避 (0.5s→30s 封顶), 0.2s 连接超时防遥测拖死 worker; socket 按锁串行防 Windows 帧交错 (engine.py:445-524)。**映射表「ipc_service+/api/stream SSE ✅ 删除自建」指的是 server 侧; worker→server 这一跳的 env/port-file 协议属于一期黑盒保留面, todo 未点名 (缺失)**。

**只读离线打开**: `StorageManager(read_only=True)` 用 URI mode=ro, **绝不建目录/建表/WAL 文件** (MCP trace inspector 用) (storage.py:73-78, 86-99)。DB 是外部消费面的一部分 (见 §2.3)。

### 1.3 daemon / server lifecycle

todo.md 定位: 映射表「runtime daemon/server lifecycle → DSH launcher/profiles, ✅ 大部分删除」——**去向已覆盖**, 保留细节:

- **server_info 元数据文件**: `{pid, port, host, started_at, cwd, sys_executable, cmdline, lifecycle_token}`, 路径 = app_dir 或 ROOT_DIR 的 `server-info.json` (server_lifecycle.py:55-80; config/paths.py:162-166)。clear 支持按 port/token 定向删, 防误删别的实例 (server_lifecycle.py:100-124)。
- **优雅停机 = 应用层请求, 不是 OS 信号**: POST `/api/system/shutdown` + `X-Artemis-Lifecycle-Token` 头 (token 来自 server_info; 无 token/端口不符 → 回退杀进程)。原因注释: Windows 上 taskkill /F 与 os.kill(SIGTERM) 都绕过 FastAPI shutdown hook, 而 hook 要负责取消任务 worker、落终态、释放锁/IPC (server_lifecycle.py:127-156, 357-366)。**S7/`JobRegistry.kill` 语义对照: DSH kill 是硬杀, 等价于 force 路径 → 优雅清理依赖 py worker 自己的 cancel marker 路径 (1.5) 而非信号**。
- **PID 发现 4 层**: server_info → lsof → fuser → netstat(win, errors="replace" 防 GBK 解码炸) → psutil net_connections → 进程表 cmdline 扫 `apps.admin_console.server`/`artemis ui` (server_lifecycle.py:191-300)。stop 后 `cleanup_stale_locks()` + 孤儿会话对账 + 定向 clear info (server_lifecycle.py:420-433)。
- **`artemis ui --restart`**: 先 stop_server(12s) 再起; **端口被占且非 --restart**: TTY 时给交互三选 (打开浏览器/重启/取消), 非 TTY 提示用 restart 并退出——**「server 永不自动开浏览器」(--open 默认 False, 端点 launcher 显式传) AGENTS.md 已写, 交互分支 todo 没有** (interfaces/cli/commands/ui.py:316-354)。
- **daemon 拉起**: `spawn_daemon` 一律 `sys.executable -m apps.admin_console.server`, **绝不走 console-script shim**——Windows 上常驻 `artemis.exe` shim 锁自身文件, 阻塞 `uv sync` (os error 32) (daemon_client.py:98-165; ui.py:37-61)。日志落 `get_app_dir()/logs/daemon-<port>.log` (daemon_client.py:91-95)。`artemis restart` 默认 daemon 模式, 等就绪最多 60s, 父进程退出再给 5s 宽限 (commands/server_lifecycle.py:98-192)。`--reload` 强制前台。
- **`ARTEMIS_STANDALONE=1` / `--standalone`**: 跳过 daemon 自动拉起, 进程内直跑 (daemon_client.py:39-41; run.py:291-308)。
- **worker 识别**: `ARTEMIS_TASK_WORKER=1` 或存在 `ARTEMIS_DEVICE_QUEUE_TICKET` → `artemis run` 不再转投 daemon, 直接本地执行 (run.py:304-311)。**DSH bash job spawn py worker 若两个都不设, worker 会反向 POST /api/run 造成自提交循环 (缺失, 必须写入 S5)**。
- **`artemis run` 非 worker 默认行为**: ensure_daemon_running(自动 spawn) → POST /api/run → 轮询 wait_for_daemon_task(1800s) → 终态; 入队失败降级本地执行 (run.py:311-401)。**这是双跑灰度开关 (G7) 的现有挂点: 全走 DSH 后此路径整体退役**。
- **`ARTEMIS_MOCK_DRIVER=1` 作用点**: `drivers/factory.py:52` 与 `controllers/unified_controller.py:100,408,528` —— worker 进程内驱动工厂层, **不是 server 层**; DSH bash job 环境里要透传才能跑离线 mock。

### 1.4 trace_store —— status.json 与 trace 目录

todo.md 定位: 映射表 C「trace_store ✅ 删除, session log 原生」——**去向已覆盖**, 但删除前的消费耦合没记录:

- **status.json 字段**: `{trace_id, task_desc, model, conversation_id, status(running→completed/failed/cancelled; success 归一为 completed), device_serial, start_time, end_time, error, result, pid?, hierarchy_backend?...}` (trace_store.py:221-246, 285-326, 346-357)。
- **原子写**: temp + fsync + `os.replace`(带 5 次重试抗 Windows sharing violation); 读三态: 缺文件→静默 None; 坏 JSON→WARNING 并隔离为 `status.json.corrupt`; 其它 IO→WARNING None (trace_store.py:74-118, 249-277)。
- **跨进程读-改-写锁**: `<path>.lock` O_EXCL + 内容 `{pid, process_created_at}`; **年轻锁 (<0.5s) 不探测** (Windows 上打开读句柄会阻塞 owner 的 unlink — 无 FILE_SHARE_DELETE); 5s 超时后**放行无互斥继续写** (last-writer-wins 优于死锁) (trace_store.py:50-62, 121-193)。此为独立的第二套锁协议, 与 device_lock 语义不同 (timeout 后降级 vs DeviceBusyError)。
- **消费方**: 队列服务 (终态回写防 MCP poller 永远看到 running; task_queue_service.py:803-812, 1438-1441, 1776-1778)、孤儿对账 (session_repository.py:448-454)、/api/sessions 路由 (routers/sessions.py:170-171)、SDK 层 `_announce_hierarchy_backend` 也写 (sdk/agent.py:498-505)、mcp_server 轮询。
- **目录**: `traces/<trace_id>/status.json|stdout.log|stderr.log|notes/` (trace_store.py:196-218)。stdout.log 由队列服务为 MCP API 兜底创建 (task_queue_service.py:722-726)。
- **trace 目录成品命名**: 临时目录 `traces/<task_name>` (worker 由队列命名为 `web_<epoch>_<run8>`, task_queue_service.py:596), 结束时编译 (GIF/steps.json/去截图尘) 后 **rename 为 `<task_name><_PASS|_FAIL|_TESTFAIL>_<ts>`** 到输出目录; 断言失败必须是 _TESTFAIL 与 _FAIL 区分 (third_party/mobile_use/sdk/agent.py:905-942; sdk/run_outcome.py:51-58)。**回放/外部脚本按此 glob; session log 迁移后此文件产物契约消失, P4 下线旧控制台前需确认无外部消费**。
- `clear_all_data` 额外删 `web_*` 目录、`traces/images/*`、`mcp_server.log` (storage.py:1198-1219)。

### 1.5 cancel_requests —— 跨进程协作取消

todo.md 定位: 映射表 C「✅ 删除, JobRegistry.kill/agent.cancel 原生」——**去向已覆盖, 但一条生命周期映射矛盾必须记录**:

- **机制**: daemon 在 `<temp>/cancel-requests/` 写 `session-<sid>.cancel` 和/或 `pid-<pid>.cancel` (JSON: requested_at/reason/session_id/pid/process_created_at); worker 侧 `watch_for_cancel_request` 后台协程按 0.5s (`ARTEMIS_CANCEL_POLL_SECONDS`) 轮询, 命中后**先删标记再**调 `on_cancel` → Agent.stop_current_task() → 与 Ctrl+C 同一条收尾路径 (录像 remux、trace 编译改名、设备锁释放) (cancel_requests.py 全文; sdk/agent.py:183-204)。
- **PID 标记防复用**: pid 标记仅在记录的 process_created_at 与本进程一致 (±1s) 时才生效 (cancel_requests.py:145-165)。
- **TTL 与清理**: 标记 1h 过期; 每次 request_cancel 顺带 purge; watcher 消费即删; clear_cancel_request 由消费方调 (cancel_requests.py:40, 74-86, 169-199)。
- **软取消→硬杀宽限**: 队列服务写标记后等待 `ARTEMIS_CANCEL_GRACE_SECONDS` (0=立即杀, 恢复 legacy) 再 terminate_tree (task_queue_service.py:100-104, 165)。
- **退出码**: 取消路径 = KeyboardInterrupt/CancelledError → `SystemExit(130)` (run.py:405-473)。**⚠ 与 S2 矛盾**: S2 写「退出码 0→completed; 非 0→failed; kill→killed (reason 透传)」。py worker 被协作取消时**自己**退出 130; DSH bash job 视角这是「非 0 退出」→ 会标 **failed**, 而语义应为 killed/cancelled; 反之 DSH kill 打断 bash job 时 py worker 收不到信号 (CREATE_NO_WINDOW), 只能靠 cancel marker 自愿退出——**即 S2 的 kill→killed 实际上绕道 cancel marker 才能优雅, 需在 S2 补: (a) exit code 130 (或专门值) 映射 killed; (b) JobRegistry.kill 对 py worker 先写 cancel marker、宽限后再杀** (缺失+矛盾)。

### 1.6 awake_service / awake_lease —— 屏幕常亮

todo.md 定位: 映射表 C「二期 TS, autogamer-device 内」——**去向已覆盖**, 语义要点 (TS 重写时全部要继承):

- **双策略**: 首选 USB-scoped `svc power stayon usb` + 验证 (`stay_on_while_plugged_in==2` 且 dumpsys `mStayOn=true`); 验证失败降级 **5s 主机心跳** `input keyevent KEYCODE_UNKNOWN` (awake_service.py:87-150)。策略归属 USB 电源而非进程/任务——拔线即恢复用户自身息屏行为。
- **只碰 Artemis 认领的设备**: 无显式 target 时只对 `device_pool.get_claimed_serials()` (活跃锁+活 ticket) 中的设备施策, **不碰同一 ADB server 上无关用户设备**; 2s 监控线程自动注册新插入/停拔线的 (awake_service.py:153-186, 261-300)。`ARTEMIS_KEEP_DEVICE_AWAKE` 可关 (默认开); `ARTEMIS_CLOUD_MODE=1` 全禁。
- **附赠消毒**: `sanitize_device_state` = pkill 孤儿 screenrecord + 广播 CLOSE_SYSTEM_DIALOGS 关 ANR 弹窗 (awake_service.py:69-84)。
- **wake lock 租约** (awake_lease, legacy 路径的清理者): Android `cmd power set-wakelock` 是 per-display/type 单把引用计数锁, 多进程各自调用会泄漏引用; lease 文件 `<temp>/awake-leases/<hash16>.leases/<token>.lease` + `<hash16>.mutex` 互斥 (10s 超时, 5s 损坏宽限); 无活租约时先 drain 旧引用 (上限 256 次防失控) 再 acquire; 最后一个退出者 drain (awake_lease.py:44-283)。
- **Windows 细节**: mutex 释放前先读回 token 校验再删, 防 O_EXCL 竞态下删掉别人的锁 (awake_lease.py:139-147)。

### 1.7 helper_manager —— 无障碍 helper 生命周期

todo.md 定位: 映射表 C「helper_manager.py 931 → 二期 autogamer-device; 一期保留」——**去向已覆盖**, 契约细节:

- **四段生命周期**: Provision (持久设备态: 装 bundled APK + secure settings 启服务) / Attach (每进程×设备×会话: `adb forward --no-rebind tcp:0`→固定设备端口 18888, **tcp:0 由 adb 分配宿主端口**, 复用同 serial 已有 forward 使多进程共享隧道) / Serve (HTTP, 传输错误 reattach 一次) / Detach (只删自己 owns 的 forward; 拔线 adb 自动清, transport_id 变化 = 重建信号) (helper_manager.py:15-59, 813-829, 846-1001)。
- **Token 安全模型**: 设备 loopback 端口对手机上所有 app 可达 → helper 除 /ping 外要求 `X-Artemis-Token`; token 是**每主机一个随机 secret**, 存 `<temp>/helper-token/session.token` (0o600, 48 hex), 同机所有 Artemis 进程共享; 经显式组件 `am broadcast` 下发 (仅 adb shell uid 能发, receiver 有 WRITE_SECURE_SETTINGS 守卫); 每次 attach 都推, helper 回 401 (重绑后丢 token) 再推 (helper_manager.py:39-47, 308-368)。
- **协议版本握手**: ping 报 `protocol_version`; `MIN_PROTOCOL_VERSION=2`, 过旧 → 能装则 force 重装, 否则报手动命令 (helper_manager.py:93, 926-950)。
- **UiAutomation 抑制 (关键排障知识)**: 无 FLAG_DONT_SUPPRESS 的 UiAutomation 存活期间 Android 解绑一切无障碍服务; uiautomator2 server (`com.wetest.uia2.Main`/`com.github.uiautomator`) 是自家 fallback **可以杀** (杀后 1s 内重绑), **Appium 的永不碰**只点名 (helper_manager.py:50-59, 108-113, 431-475, 888-920)。
- **provision 互斥**: 跨进程文件 mutex `<temp>/helper-provision/<hash16>.mutex`, 90s 超时/180s 陈旧回收; Windows 对删除中的锁文件可能报 PermissionError——non-nt 才 raise, nt 继续轮询 (helper_manager.py:546-588)。
- **enable 不粘滞**: `settings put secure` 后 0.4s 复读重试 ×5 (AccessibilityManager 可能刚装完解析不到又剪掉); 彻底失败 → 自动打开无障碍设置页让人手点 (helper_manager.py:590-629, 768-787)。
- **自动安装开关**: `ARTEMIS_HELPER_AUTO_INSTALL` (env→settings, 默认 true); false 时缺装报错并给 `artemis helper install --serial` 手动命令, 过装旧版照用 (helper_manager.py:138-162, 696-722)。
- **revive**: 已 enabled 但哑掉 (被杀/ROM 清) → secure settings 里移除再加回促重绑; reattach 永远允许 revive, 首次 attach 仅 provision 路径允许 (helper_manager.py:631-664, 853-863)。

### 1.8 device_pool / adb_endpoint —— 设备发现与分配

- **快照缓存**: TTL 1s 合并突发枚举; **枚举失败时旧快照续命 10s** (真断连是成功列举里少了设备, 只有 server 级故障才走 stale); 冷启动 `adb devices` 可能要拉起 server, 预算 2s(热)/8s(冷) (device_pool.py:68-80)。
- **失败≠空列表**: `try_list_devices` 用 None 区分「问不了 adb」与「没有设备」; **显式 serial 校验 fail-open**: 枚举失败/为空一律放行, 让任务下游报清晰的 no-device 错而不是误硬拒 (device_pool.py:354-398)。**admission 探测 (G7→TS) 重写时易丢这个 fail-open 语义**。
- **auto 选择**: 显式 serial 永远原样返回 (adb 可后续连上); 否则第一台空闲 → 全忙则第一台 ready (去排队) → 退而任何 attached (device_pool.py:448-474)。对应 G3 的 auto 池语义。
- **claimed serials**: 纯锁/ticket 元数据计算, 零 adb 流量; pending/any 占位不认领 (device_pool.py:408-430)。
- **endpoint 不可变快照**: 用户偏好 (current_adb_endpoint) 与任务执行快照 (AdbTarget) 分离, 排队/运行中任务不随偏好漂移 (adb_endpoint.py:15-21)。

### 1.9 worker 端到端时序 (把上述串成一条线)

enqueue: `reserve(description, device_id=pending, scope)` → spawn worker (env: SESSION_ID/CONVERSATION_ID/SUBMITTED_AT/TASK_INGRESS/TASK_WORKER/MODEL_ENDPOINT/IPC_PORT/LOCK_SCOPE/QUEUE_TICKET) → worker 构造 DeviceExecutionLock 时 **pop 走 ticket env (一次性)** (device_lock.py:144) → `transfer_reservation` 绑 worker pid → acquire (FIFO 等待) → 拿锁删 ticket → start_session (INSERT + annotate_active_owner 把 session_id 回写锁文件) → 跑 langgraph → end_session → `_finalize_tracing` (trace 目录 rename + video path 回写) → release 锁。取消: marker → watcher → Ctrl+C 同路径 → exit 130; 宽限后硬杀 terminate_tree。

---

## 2. 外部契约清单

### 2.1 ARTEMIS_* 环境变量 (worker 进程读取的全部; 全局 grep 基线)

| 变量 | 写入方 | 读取方 | 语义 | todo 状态 |
|---|---|---|---|---|
| ARTEMIS_SESSION_ID | 队列 spawn (task_queue_service.py:610) | engine.start_session (engine.py:595-603)、DeviceLock (device_lock.py:146-148)、run.py:88、sdk/agent.py:95-98 | 会话 UUID, 贯穿 DB/锁/取消/trace | S5 已列 ✅ |
| ARTEMIS_CONVERSATION_ID | 队列 (task_queue_service.py:617) | engine.py:629、sdk/agent.py:363 | 聊天线程; 触发 notes 上下文继承 | S5 已列 ✅ |
| ARTEMIS_SUBMITTED_AT | 队列 (task_queue_service.py:623) | engine.py:60-68, 633 | 入队墙钟; **S5 没列 (缺失)**; AGENTS.md 有 | **S5 缺失** |
| ARTEMIS_TASK_INGRESS | 队列 (611, 默认 frontend) / run.py:92-93 (cli) | DeviceLock (device_lock.py:149)、engine.py:641 | 描述前缀 `<ingress> task:` 来源 | **S5 缺失** |
| ARTEMIS_TASK_WORKER | 队列 (=1, 612) | run.py:304-307 | 标记 worker 身份, 防止 `artemis run` 反向自提交 daemon | **S5 缺失 (自提交循环风险)** |
| ARTEMIS_DEVICE_QUEUE_TICKET | 队列 (633) | device_lock.py:86, 144 (**os.environ.pop, 一次性**), run.py:306 | FIFO 预约 token 交接 | S3/S5 隐含, env 名未列 |
| ARTEMIS_ADB_ENDPOINT_ID | target.endpoint.apply_to_environment (task_queue_service.py:630; adb_endpoint.py:112) | device_lock LOCK_SCOPE_ENV (device_lock.py:87) | 多 ADB server 锁 scope | S3 结论覆盖, 注入链缺失 |
| ARTEMIS_MODEL_ENDPOINT | 队列 (task_queue_service.py:626) | engine.py:626 (落库 sessions.model_endpoint) + config 层路由 | 提交时固定模型端点 | S5 已列 ✅ |
| ARTEMIS_IPC_PORT | server 进程 env → 队列透传 (task_queue_service.py:608) | engine.py:446-466 (双源: env + port file) | worker→server 事件桥 | **缺失** |
| ARTEMIS_MOCK_DRIVER | 用户/脚本 | drivers/factory.py:52; controllers/unified_controller.py:100,408,528 | 强制离线 mock 驱动 (worker 层) | AGENTS.md 有; todo 无 |
| ARTEMIS_CANCEL_POLL_SECONDS | 可选 | cancel_requests.py:230 | 取消标记轮询间隔 (默认 0.5s) | 缺失 (cancel 已整体删除, 仅双跑期相关) |
| ARTEMIS_CANCEL_GRACE_SECONDS | 可选 (task_queue_service.py:104) | 队列软取消→硬杀宽限; 0=立即杀 | | 缺失 |
| ARTEMIS_STANDALONE | 用户 | run.py:308; daemon_client.py:39 | 跳过 daemon 自动拉起 | 缺失 |
| ARTEMIS_DEVICE_ID / ADB_DEVICE_SERIAL / ADB_HOST / ADB_PORT / ADB_SERVER_SOCKET | endpoint.apply_to_environment (adb_endpoint.py:104-113) | awake_service.py:158-165, adb_command | ADB 定位三件套 + 认领设备 | S3 隐含 |
| ARTEMIS_HELPER_AUTO_INSTALL | 用户/settings | helper_manager.py:143 | helper 自动安装开关 | 缺失 (helper 整体二期) |
| ARTEMIS_KEEP_DEVICE_AWAKE | 用户 (默认 true) | awake_service.py:41 | 屏幕常亮总开关 | 缺失 (二期 TS 时要接) |
| ARTEMIS_TRACES_DIR / ARTEMIS_APP_DIR / ARTEMIS_USE_USER_DIR | 部署层 | config/paths.py:112, 70 | DB/trace/temp 根路径重定位 | 缺失 |
| 其余 (CLOUD_*, TENANT_*, FAKE_LLM, DEBUG, HIERARCHY_BACKEND, EXPLORER_*, DEFAULT_*, MCP_*, EDGE_PORT...) | 调试/云/MCP 层 | 各处 | 非队列主链路 | 随所属模块处置 |

### 2.2 文件/目录契约 (全部在 `get_temp_dir()` 或 `traces/` 下)

| 路径 | 格式 | 创建者→消费者 | todo |
|---|---|---|---|
| `<temp>/device-locks/artemis-device-<id>.lock` | JSON owner payload | worker→队列/状态页/pool | 映射表覆盖方向, 格式缺失 |
| `<temp>/device-locks/artemis-global-device.queue/*.wait` | JSON ticket, 文件名=序 | 队列↔worker | S3 替代, parking 缺失 |
| `<temp>/device-locks/artemis-global-device.lock` | legacy 兼容读 | 只读兼容 | 可随删除 |
| `<temp>/cancel-requests/*.cancel` | JSON marker, TTL 1h | daemon→worker | ✅ 删除已覆盖 |
| `<temp>/awake-leases/<hash>.leases|mutex` | JSON lease | awake service | 二期 TS 覆盖, 细节缺失 |
| `<temp>/helper-provision/<hash>.mutex`、`<temp>/helper-token/session.token` | mutex / 48-hex token | helper manager | 二期 TS 覆盖, 细节缺失 |
| `<temp>/ipc.port` 等 port/address/server-info 文件 | 文本端口 / JSON | server↔worker/CLI | **缺失** (worker 双源回退依赖) |
| `traces/data_engine.db` (+WAL/SHM) | SQLite, 见 2.3 | worker 写→控制台/MCP 读 | G7 只读共存 ✅, 多列容忍缺失 |
| `traces/<session_id>/notes/*.md` | markdown | worker 写→下一提交读 (≤8000 chars) | **缺失 (会话记忆)** |
| `traces/images/<sha256>.jpg` | JPEG | worker→回放/检索 | 随 data_engine |
| `traces/<task_name>{_PASS|_FAIL|_TESTFAIL}_{ts}/` | 录像+GIF+steps.json | worker→回放/外部脚本 | **缺失 (成品命名契约)** |
| `traces/<session_id>/status.json(.lock/.corrupt)`、`stdout.log`、`stderr.log` | JSON/文本 | daemon+worker+MCP 多写多读 | ✅ 删除已覆盖, 消费方缺失 |
| `<app_dir>/logs/daemon-<port>.log` | 文本 | spawn_daemon→排障 | 缺失 (小事) |

### 2.3 SQLite DB 契约

- 全 schema 见 §1.2 表格; **迁移 = 启动幂等补列, 无版本表** (storage.py:101-291)。
- 读侧: 旧控制台 4-step merge (G7 只读共存)、`OfflineHistoryReader`/`friendly_step`/`build_interleaved_events` 与在线引擎共用同一投影代码 (engine.py:183-401; history_reader.py) —— **「两套读路径必须渲染一致」是 tests/unit/data_engine 锁定的行为基线** (test_offline_reader_*)。
- read_only 连接绝不产生 WAL (storage.py:73-78)。

### 2.4 CLI 命令面 (`artemis`, typer; interfaces/cli/main.py:41-69)

| 命令 | 关键 flags | 说明 | todo |
|---|---|---|---|
| `ui` | `--host/-h`(127.0.0.1) `--port/-p`(8000) `--open/--no-open`(默认 **no-open**) `--reload` `--restart/-r` | 前台起 server; 端口占用交互三选; 自动重建 showcase (sources 比 dist 新时 npm install+vite build; wheel 安装永不触发 npm) | 部分缺失 (交互/构建逻辑) |
| `restart` | `--host/-H` `--port/-p` `--open`(默认 **true**) `--force/-f` `--reload` `--daemon/--foreground -d/-F`(默认 daemon) | stop→spawn_daemon→等就绪 60s; `--reload` 强制前台 | 映射表覆盖 |
| `stop` | `--port/-p` `--force/-f` | 优雅 API→进程树杀→清锁→孤儿对账 | 覆盖 |
| `status` | `--port/-p` | server_info+端口探测 | 覆盖 |
| `run` | `--profile/-p`(pro) `--locked-app/-a` `--test-name` `--traces-path` `--output-description` `--with-video-recording-tools` `--app-path` `--enable/disable-planner-validation` `--enable/disable-committee` `--enable/disable-checker` `--enable/disable-step-summarizer` `--enable/disable-outputter` `--force-output-synthesis` `--explorer-version` `--explorer-flash-mode` `--explorer-pro-mode` `--verification-level`(off/final/checkpoints/strict) `--device-serial/-s` `--session-id` `--standalone` | worker 入口 (S2 bash job 调的就是它; flag 集即 job 参数面) | S5「入口不变」✅, flag 面未列 |
| `batch` | `--file/-f` `--profile/-p` `--delay/-d`(5s) `--standalone` `--verification-level` `--explorer-pro-mode` + 位置 goals | 顺序批量, 走 daemon | 缺失 |
| `init` | (交互向导) | API key/设备配置 | 缺失 |
| `doctor` | (8 个 flag) | 就绪诊断 (core/diagnostics 前端) | E 表一期保留 ✅ |
| `mcp` | `--type/-t`(agent/adb/xml) `--transport`(stdio/sse) `--host` `--port/-p`(8001) `--install/-i` `--generate-config/-g` | MCP server + 客户端配置安装器 | ⚠️ 薄层 ✅ |
| `server web` | `--port/-p`(8080) 等 | Cloud Run 代理 | 缺失 (云端专用, 可标注弃置) |
| `trace list/view` | `--path/-p` `--limit/-l` | 离线查 trace 目录 | 缺失 |
| `helper status/install/uninstall/parity` | `--serial/-s` `--json` `--force` `--all` `--yes/-y` `--rounds` | helper 设备侧管理 | 二期 TS 覆盖 |
| 全局 | `--version/-v` | | |

### 2.5 SDK 对外面 (`artemis.sdk`)

- `Agent(config=|device_serial=, concurrency_mode=, max_concurrency=, session_id=)` — AgentConfig builder (builders/agent_config_builder.py 474 行); `__all__ = Agent + types + builders` (sdk/__init__.py:21-26)。
- 会话 id 解析链: 参数 → `ARTEMIS_SESSION_ID` → `ARTEMIS_CLOUD_SESSION_ID` → task.id (sdk/agent.py:95-98, 326-338)。
- 返回值契约: `attach_test_summary` (dict 注入 test_summary; str 包 `{result, test_summary}`; 仅当有 check 项), `resolve_trace_suffix` (_PASS/_FAIL/_TESTFAIL) (run_outcome.py:18-58)。
- `interfaces/sdk/task.py` + `client.py` (72+19 行): 提交侧薄类型。todo 映射表「packages/artemis-client 实为 Python client → 删除」✅; **sdk/ (agent 侧) 与 interfaces/sdk 未出现在映射表——一期随 langgraph worker 黑盒保留 (D8), 二期随模式 a 消亡; 建议映射表补一行**。

---

## 3. 漂移风险 Top 10 (按风险排序)

1. **取消语义映射矛盾 (S2)**: 协作取消 = py worker 自愿退出码 130; DSH bash job 会把它标 `failed` 而非 `killed`; 且 DSH `JobRegistry.kill` 硬杀下 py worker (CREATE_NO_WINDOW) 收不到信号, 优雅清理只能靠 cancel marker 自愿路径——kill 语义与清理路径互相依赖却互相矛盾。(§1.5, §1.9)
2. **worker 自识别 env 缺失 → 自提交循环**: DSH bash job spawn `artemis run` 不带 `ARTEMIS_TASK_WORKER=1`/ticket 时, worker 会 ensure_daemon_running + POST /api/run 反向投递到旧 server。(§1.3)
3. **submitted_at/CONVERSATION_ID 注入断档 → 聊天时间线回归**: 双跑期 DSH 侧 spawn 忘带 `ARTEMIS_SUBMITTED_AT` → DB 列 NULL → 旧控制台按 start_time 排序 → 轮次重排/ghost 会话 (AGENTS.md 记录过的 bug 类复发)。S5 env 清单不全。(§2.1)
4. **跨进程 PID-liveness 协议丢半 → 误杀/死锁回归**: pid+process_created_at(±1s)+默认存活三元组遍布锁/取消/trace 锁/supervisor; S7 孤儿对账 kill 若只看 pid, 正撞 device_lock 前科 (PID 复用)。(§1.1)
5. **ticket view 语义漂移**: 排队展示的 created_at=mtime、description=`<ingress> task: <goal[:120]>`——若 DSH roster 直接用 job 入队时间戳+全量 goal, 与旧控制台/AGENTS.md 规则漂移; 反向 (submission_meta 赢) 规则要随 state.py 删除一起显式迁移。(§1.1)
6. **双跑期共享 temp 目录协议**: py 线与 TS 闸门若并存, `device-locks/` 目录是两者间的真实 IPC; TS 侧换目录名/换格式 = 互不相认 → 同设备双跑并发。(§2.2; 与 G7 灰度开关直接相关)
7. **会话延续记忆断档**: notes 继承是 py 侧「多轮对话」本体; G7 旧 DB 不迁移 + 新会话无 notes → 切换瞬间所有进行中聊天线程失忆。(§1.2)
8. **`_PASS/_FAIL/_TESTFAIL` 成品目录与回放契约**: 回放器/外部脚本/`artemis trace list` 按此命名消费; session log 迁移后若 P4 前未确认无外部消费, 静默破坏。(§1.4)
9. **auto-serial fail-open 与 claimed-only**: 设备校验 fail-open (枚举失败不硬拒) 和 awake 只碰 claimed 设备, 都是「看似可简化实则防事故」的语义; TS 重写最易被"clean up"。(§1.6, §1.8)
10. **DB 多列容忍 + 只读连接零副作用**: 双跑期 py worker 持续幂等补列; 旧 MCP 只读打开绝不建 WAL。TS 侧任何 schema 校验/连接方式不当即破坏只读共存。(§1.2)

---

## 4. 对 docs/todo.md 的修订建议

### 新增差距

| # | 差距 | 建议调整 |
|---|---|---|
| G8 | **worker 取消/退出码契约未定义** (S2 矛盾): 协作取消 exit 130 vs kill→killed; 硬杀下 py worker 无法优雅清理, 需 DSH kill 前先写 cancel marker (双跑期) 或接受强制路径 | S2 补: exit code 130→killed 映射; P1 spike 增加「kill py worker 时终态与 DB 留痕」验证 |
| G9 | **S5 env 契约清单不全**: 缺 ARTEMIS_SUBMITTED_AT/TASK_INGRESS/TASK_WORKER/DEVICE_QUEUE_TICKET/ADB_ENDPOINT_ID/IPC_PORT; 无 TASK_WORKER 时 py worker 反向自提交旧 daemon | S5 改为引用本文 §2.1 全表; P0 S2 spike 断言 env 透传集合 |
| G10 | **跨进程 PID-liveness 协议** (pid+created_at) 是孤儿对账/锁回收的共同前提, todo 只写了「启动时对账孤儿」 | S7 补: 对账 kill 用 terminate_tree_verified 等价语义; 保留 process_probe 语义为契约测试项 |
| G11 | **会话延续 notes 契约** (traces/<sid>/notes, ≤8000 chars) 未记录; G7 切换期记忆断档 | P4 双跑清单补: 切换粒度按 conversation 边界 (进行中线程不切), 或 py worker 继续 写 notes |
| G12 | **双跑期共享 temp 目录协议**: device-locks/ 是 py↔TS 真实 IPC, 目录名/JSON 格式即契约 | G7 灰度语义补: 双跑期 TS 闸门与 py 锁共用目录与格式, 或以「每任务二选一线路」保证不同设备不相交 |
| G13 | **全局并发上限 N** (ARTEMIS_MAX_CONCURRENT_TASKS>1) 语义 D3 未涵盖 (只写了 per-device 与熔断) | D3 补一句: 全局上限 N 由 TS 闸门信号量承接或显式声明不支持 |
| G14 | **成品 trace 目录命名** (_PASS/_FAIL/_TESTFAIL) 与 notes 是旧控制台/回放/外部脚本的文件契约 | P4 下线清单补「外部消费确认」检查项 |

### 映射表修正

- 「data_engine ✅ 删除自建」行补注: `StorageManager(read_only)` 离线读、会话 notes 延续、双跑期幂等补列在一期仍活跃。
- 「runtime daemon/server lifecycle ✅ 大部分删除」行补注: `spawn 走 python -m 不经 console-script shim`、`优雅停机=带 token 的 /api/system/shutdown 而非信号` 两条 Windows 约束在 DSH launcher 上同样适用 (DSH job/进程管理视角)。
- 「ipc_service ✅ 删除」行补注: worker→server 的 IPC 事件桥 (ARTEMIS_IPC_PORT + port file 双源) 属 py worker 黑盒内部, 一期不动。
- 映射表补一行: `artemis/sdk/* + interfaces/sdk/*` (Agent/AgentConfig/run_outcome) —— 一期随 langgraph worker 黑盒保留, 二期随模式 a 退役。
- 「cancel_requests ✅ 删除」行补注: 双跑期 py worker 的优雅取消仍依赖 cancel marker; TS 删除它之前需 G8 落地。

### 新增 checklist 项

- [ ] P1 补: pending/any **parking 回归测试** (单个未认领 ticket 不得阻塞多设备; 认领后保持原时间序) —— 即使进程内闸门, auto 池语义 (G3) 也要锁死该行为。
- [ ] P1 补: **ticket/roster 时间戳语义**测试 (提交时刻≠拾取时刻≠设备轮时刻, 三者不得混用)。
- [ ] P4 补: 「外部接入方迁移清单」具体化 = mcp_server (trace/status.json 轮询) + packages/artemis-client (py) + `artemis run` 非 worker 分支 (daemon 投递) + `artemis trace`/`batch` CLI。
