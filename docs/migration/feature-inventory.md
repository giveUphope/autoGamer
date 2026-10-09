# 迁移前功能盘点（feature inventory）

> 目的：DSH 迁移启动（P0）之前，把「若无人记录就会无声丢失」的行为、不变量与契约全部成文，防止迁移中途功能漂移丢失。
> 基线：cc6b20c；日期：2026-10-09。
> 方法：五路并行子代理审计（逐文件精读 + 全仓 grep + 测试基线扫描，合计约 2.4 万 tokens/sec·334 次工具调用），主代理对全部「硬矛盾」结论逐条抽查核实（退出码 130 / `ARTEMIS_TASK_WORKER` 分支 / `_resolve_terminal_status` / 18 个 ENVIRONMENT_ERROR_MARKERS / `is_mock` 死检查 / 全部行数）。
> 维护规则：条目证据一律 `file:line`，以代码为准；代码变了回改本目录。

## 文件导航

| 文件 | 范围 | 亮点 |
|---|---|---|
| [inventory/01-console-queue.md](inventory/01-console-queue.md) | admin_console 队列/控制台后端 + 单测基线 | /api/run 准入管线（幂等/去抖/409）、终态权威顺序、熔断 hold 解除矩阵、三种「暂停」辨析、SSE 服务端契约、45s 优雅停止、数值常量总表 |
| [inventory/02-runtime-persistence.md](inventory/02-runtime-persistence.md) | runtime + data_engine + CLI + sdk | device_lock 语义全景（parking/PID 复用/ticket mtime）、DB 全 schema 与幂等迁移、ARTEMIS_* env 全集、cancel marker 协议、notes 跨任务记忆、worker 端到端时序 |
| [inventory/03-device-media-diagnostics.md](inventory/03-device-media-diagnostics.md) | drivers/媒体管线/诊断/mcp 动作层 | 录像 manifest v2 与首帧锚定、0-1000 归一坐标契约、helper/u2 互斥、mock driver 复刻基线、doctor 检查项全集、Windows quirk 汇总表 |
| [inventory/04-agent-stack-config.md](inventory/04-agent-stack-config.md) | worker 启动退出契约/智能栈/LLM/配置 | 退出码真相（S2 矛盾）、task_plan.md 写入暗规则、工具敏感分级表（S6 输入）、LLM 可靠性/暂停协议、env 全集按语义分组 |
| [inventory/05-frontend-integration.md](inventory/05-frontend-integration.md) | showcase_ui_v2 + mcp_server + artemis-client + 脚本 | SSE 事件×前端消费矩阵（含死信道）、4-step merge 不变量、跨线程竞态五件套、通知通道矩阵、SDK 公开面、dev/构建链 |

> 注：各 inventory 文件 §4（修订建议）写于统一编号之前，其 G 编号是草案编号；**权威编号以本文 G8–G29 为准**，其建议已由主代理汇总落进 `docs/todo.md`（2026-10-09）。

## 与 todo.md 的硬矛盾（P0 前必须消化，已回改 todo.md）

1. **S2 退出码映射与 py 真相相反**：verifier 判 blocked / flash 自报 failed 的任务退出码为 **0**（CLI 不检查任务结果，run.py:463-473 只对异常与取消设非零）；协作取消退出 **130**。按 S2 原文「0→completed / 非0→failed」会把失败任务标成 completed。py 真相：**DataEngine DB 终态权威，退出码仅兜底**（task_queue_service.py:310-333）。
2. **cancel_requests 被映射表标「✅ 删除」，但它是 Windows 下唯一优雅取消通道**：worker 以 CREATE_NO_WINDOW 创建，`JobRegistry.kill` 硬杀时收不到任何 Python 信号；录屏 remux / trace 编译 / 锁释放 / cancelled 终态全靠 cancel marker 文件协议 + 45s 宽限（默认 `ARTEMIS_CANCEL_GRACE_SECONDS`）。
3. **S5 env 清单是子集**：漏 `ARTEMIS_TASK_WORKER=1`——不设（也无 ticket）时 `artemis run` 会 ensure_daemon + POST /api/run **反向自提交旧 daemon**（run.py:304-311）；漏 `ARTEMIS_SUBMITTED_AT` 则聊天轮次排序回归；另有 TASK_INGRESS / DEVICE_QUEUE_TICKET / ADB_ENDPOINT_ID / IPC_PORT / driver 组 / 凭证组共 20+ 个。
4. **「queue pause/resume → agent.cancel + inbox splice」归类错误**：实际是调度器闸门（保留 pending、不碰任何运行中任务）；且现行为手动 resume 会同时清熔断挂起，与半开自动恢复的新设计需写明差异。
5. **「graph checkpoint 由 session log 承接」易误读**：py 无 langgraph checkpointer、**无断点续跑**（进程死=任务死，恰与 D5 一致）；checkpoint 是计划校验账本（check_ledger.jsonl），不是执行位置。
6. **「旧线 [vlm] 路由已验证」不存在**：py 无 [vlm] 路由键，多模态按节点配置（video_analyzer/object_detector/explorer + is_multimodal）。

## 统一差距清单（G8–G29，已同步进 docs/todo.md 差距表）

### A. 一期对接语义修正（阻塞 P0 spike）

| # | 差距 | 详情与证据 |
|---|---|---|
| G8 | 退出码/终态判定契约（S2 矛盾） | py 退出码不编码任务结果；DB 终态权威（success→completed 归一、raw 值保留对账）；`exit 130`→cancelled；DSH kill 必须先写 cancel marker、宽限后再硬杀。inventory/01 §1.5、02 §1.5、04 §1.4–1.5 |
| G9 | worker env/CLI 全量契约（S5 是子集） | `ARTEMIS_TASK_WORKER=1` 必设（缺失→自提交循环）；`ARTEMIS_SUBMITTED_AT`/`TASK_INGRESS`/`DEVICE_QUEUE_TICKET`/`ADB_ENDPOINT_ID`/`IPC_PORT`/driver 组（`ADB_*`/`ARTEMIS_MOCK_DRIVER` 等）/凭证组；stderr→stdout 合并；Windows creationflags。inventory/02 §2.1 全表、04 §1.3 |
| G10 | 优雅取消通道 | cancel marker（PID+process_created_at 防 PID 复用）→ 45s 宽限（env 可调，0=立即杀）→ 到期硬杀进程树；取消路径 worker 收尾：录屏 remux、trace 编译改名、锁释放。inventory/01 §1.5、02 §1.5、04 §1.5 |

### B. 一期 job 侧能力缺口

| # | 差距 | 详情与证据 |
|---|---|---|
| G11 | 终态/环境级判定信号来源 | 零步骤失败一票判环境级（需查 DB `has_steps`）+ 18 个 ENVIRONMENT_ERROR_MARKERS（宽泛词会误判，照搬前须有意识）；fail-open（步骤探测失败→不挂）vs fail-safe（设备枚举不确定→继续挂）不对称；auto 失败挂端点默认队列键；**allowed_fails 默认值需决策**（建议 1=保持现行为）。inventory/01 §1.2、04 §6 |
| G12 | LLM 暂停协议的 DSH 呈现 | 重试耗尽写 `.artemis_paused` → 任务静默挂 900s（`LLM_PAUSE_TIMEOUT_SECONDS`）→ LLMExhaustedError；DSH 侧表现为假死 job。删文件=resume。inventory/04 §2.3.3、01 §1.3 |
| G13 | 幂等/去抖提交语义 | session 级短路（重试跳过就绪探测）、1s 同 goal 防抖、409 设备锁定/400 未知端点/rejected/`unknown`（MCP 防重复提交）——webhookRuntime/SDK 接入的验收项。inventory/01 §1.1、05 §3.1 |
| G14 | 状态词汇表映射 | 现网 pending/running/completed/failed/cancelled（success→completed 归一）↔ DSH JobStatus（running/stopping/completed/killed/failed）；manual stop=cancelled↔killed 等映射需显式定义。inventory/01 §4 |

### C. 双跑/共存期契约

| # | 差距 | 详情与证据 |
|---|---|---|
| G15 | 双跑共享 temp 目录协议 | `<temp>/device-locks/` 是 py 线与 TS 闸门间的真实 IPC；换目录名/格式=互不相认→同设备双跑并发。inventory/02 §2.2 |
| G16 | 会话延续 notes 记忆 | 同 conversation 下一提交读 `traces/<sid>/notes/*.md`（≤8000 chars）注入 planner——py 侧「多轮对话」本体；G7 旧数据不迁移→切换瞬间进行中线程失忆。inventory/02 §1.2、04 §2.6.4 |
| G17 | 共存期鉴权面 | SameOrigin（Host 校验防 DNS rebinding、Origin==Host、**无 Origin 头直通**）、lifecycle token、loopback-only restart/shutdown、/api no-store；vite 代理 Origin 剥离同样作用于 SSE。inventory/01 §1.7、05 §3.5 |

### D. UI/事件契约

| # | 差距 | 详情与证据 |
|---|---|---|
| G18 | SSE 事件契约 + 死信道 | 前端订阅面与广播面有差集：`queue_held/paused/resumed` 服务端广播但前端**零订阅**——队列 UI 信源实为 2s 轮询 `/api/status` 的 `queue_paused/queue_holds`；`recording_ready` 双形状分叉（engine vs 队列兜底）；llm_stream 合批（80/500ms）+泳道关闭语义。inventory/05 §1.2、01 §1.4 |
| G19 | 线程聚合视图不变量 | submitted_at 排序锚、幽灵防护（60s TTL+dismissedNoRowSessions）、自动跟随绝不跨线程（mayAutoFollowSession）、草稿豁免、排队轮不渲染/不提升——四源合并「问题消失」仅对数据源成立，聚合展示在 DSH roster/toolview 原样重现。inventory/05 §2.1/2.2/2.4 |
| G20 | 晚订阅 catch-up | SSE 订阅即回放（合成 session_started + startup_progress + 已落库步骤逐条 step_recorded）——晚开页面不空窗；DSH session/event 等价物待验证。inventory/01 §1.4、05 §1.1 |

### E. 外部承诺

| # | 差距 | 详情与证据 |
|---|---|---|
| G21 | 对外通知契约 | 仅 `conversation_id 存在或 ingress=mcp` 才通知 + 两类判死触发点；webhook POST schema（5s 超时、UA Artemis-MCP/3.0）是外部网关既有契约；agentapi 通道 env 恢复黑科技。inventory/05 §3.3 |
| G22 | 外部 SDK/MCP 基线 | artemis-client 公开面（task_id 幂等重试、get_task 队列兜底、错误分层）此前无成文处；`/api/v1/capabilities` 是假端点（恒 404→客户端回退编造集）；MCP 工具 docstring 即协议（1 分钟兜底轮询、release_loop 唯一优雅停止信号、对账「不确定=存活」）。inventory/05 §3.2/3.4 |

### F. 二期重写基线（防重写时行为漂移）

| # | 差距 | 详情与证据 |
|---|---|---|
| G23 | 录像产物与 trace 媒体契约 | manifest v2 字段、`recording{,_NNN}.(mkv|mp4)` 命名、首帧锚定（session.start_time=首帧）、`_PASS/_FAIL/_TESTFAIL` 终态改名、`image://{sha256}` 截图引用协议、媒体 HTTP=根约束+扩展白名单（无 token）。inventory/03 §1.4–1.6、02 §1.4 |
| G24 | 设备工具坐标与结果契约 | 0-1000 归一坐标域（换体系=历史 trace 回放与 prompt 全失配）、元素索引 client 端解析（wire 只见坐标）、target_description 记录不上 wire、ActionResult（设备拒绝=isError=False+ok=False，非异常）、动作名归一表。inventory/03 §1.8 |
| G25 | 层级后端互斥与降级 | helper（设备端口 18888+X-Artemis-Token）与 u2 的 UiAutomation 单例互斥；auto 模式 30s 降级窗；u2 用后必须 stop_server；离线快判。不复刻 helper=显式放弃 Mobly/Appium 共存。inventory/03 §1.9 |
| G26 | 跨进程 PID-liveness 协议 | `(pid, process_created_at)`±1s、不确定=默认存活——锁/取消/trace 锁/supervisor 五处共用；S7 孤儿对账 kill 必须用此协议（PID 复用前科）。inventory/02 §1.1 |
| G27 | 智能栈暗规则基线 | plan 写入机器规则六条（[Loop:continuous] 保护/手滑重写检测/check 行合并回/finding 投影/checker- 前缀保留/ratchet 基线）、checker 三不变量、run_outcome 双轴（assert 失败≠任务失败）、memory 梯级与 xml_scrub_depth=1 的 stale-index 安全理由、transcript 回滚开关。inventory/04 §2.4–2.6 |
| G28 | parking + 全局并发上限 N | 单个未认领 pending/any ticket park 到恰好一台空闲设备（历史 bug 修复的不变量）；`ARTEMIS_MAX_CONCURRENT_TASKS>1` 全局上限是 D3 未涵盖的第三种语义（承接或显式声明不支持）。inventory/02 §1.1 |
| G29 | 任务中途指导注入通道 | `<trace_dir>/injected_instruction.json` `{instruction, release_loop}` 读后即删；release_loop 是 [Loop:continuous] 唯一合法结束信号——已立 S9，DSH 对应物待 spike。inventory/04 §2.5 |

## 跨领域漂移风险 Top 10（五路审计汇总）

| # | 风险 | 一句话 |
|---|---|---|
| 1 | 退出码/终态契约（G8） | 照 S2 原文实现会把失败任务标 completed——一期兼容的最大单点 |
| 2 | 优雅取消通道（G10） | cancel marker 被标删除，丢了它 Windows 下「停止」降级为硬杀、录屏与 trace 靠启动对账兜底 |
| 3 | worker env 契约（G9） | 漏 `ARTEMIS_TASK_WORKER=1` 自提交循环、漏 `SUBMITTED_AT` 轮次重排——「py 零改动接入」的前提 |
| 4 | 录像产物契约（G23） | 格式猜错=时间线/回放/step-seek 全断，且 py worker 一期继续按 py 格式写，双端漂移概率最高 |
| 5 | 线程聚合不变量（G19） | 五个刚修完的竞态 bug 的测试全部住在即将删除的 Vue spec 里，没有接棒者 |
| 6 | 队列状态信源（G18） | DSH 只做事件推送会丢掉现 UI 实际依赖的轮询字段——dock「继续队列」入口失明 |
| 7 | PID-liveness 协议（G26） | 孤儿对账裸看 pid 正撞已修过的 PID 复用前科——误杀/死锁回归 |
| 8 | 双跑共享协议（G15/G16） | device-locks 目录与 notes 记忆是 py↔TS 无形契约，破坏即「同设备并发」与「会话失忆」 |
| 9 | 坐标/互斥契约（G24/G25） | 换坐标体系=历史全失配；占用 UiAutomation=「偶发全设备层级失败」类事故 |
| 10 | 外部承诺（G13/G21/G22） | 幂等重试、通知矩阵、MCP docstring 协议都是外部调用方踩着的隐性契约 |

## 待决策清单（2026-10-09 用户讨论后状态）

1. ~~allowed_fails 默认值~~ → **工程默认 = 1**（保持现状「单次环境级失败即挂」），P1 落地时若要改再提。
2. ~~job 侧终态判定方式~~ → **推荐采纳：读同一 SQLite**（S10 spike 时顺带验证插件侧只读连接可行性）。
3. ~~队列状态信源（G18）~~ → ✅ 已随 S10 裁定关闭：乙路线（插件只提供内容）=QueueDock/时间线原生 + job roster 看设备级进度。
4. ~~二期是否复刻 helper~~ → ✅ **用户决策：复刻 helper**（保留 Mobly/Appium 共存差异化能力）。
5. LLM 暂停的 DSH 呈现（G12）→ 运维手册成文（删文件=resume），一期不建 UI；低优先级。
6. ~~run_adb_command 审批方式~~ → ✅ **用户决策：整工具 ask**（allowed-once）起步，只读白名单二期再评估。
7. ~~capabilities 假端点处置~~ → ✅ **随 D10 直接消失**（无外部调用方，artemis-client 直接删除）。
8. quality_ratchet 与 locale 锁测试 → **TS 侧显式不做**（记录为有意撤除，非遗漏）。
