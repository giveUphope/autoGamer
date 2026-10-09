# TODO · DSH 插件化迁移方案（R2' 定稿）

> 活文档：已完成条目直接删除，演进依据查 git 历史。
> 本方案于 2026-10-09 经七轮源码核实与两次方向重构后定稿：**基线 = google/artemis 上游实现**（本仓库为其 fork，领先 92 提交但智能栈基本未动），路径 = **直通插件**。论证过程与历史版本：git log + [upstream-rethink](migration/upstream-rethink.md) + [dsh-verification](migration/dsh-verification.md) + [feature-inventory](migration/feature-inventory.md)（含 inventory/01-05 明细）。

## 一、最终形态

整个项目收缩为**一个 DSH 插件 `autogamer-device` + 若干 skills**：

- **DSH 宿主提供**（原生，禁止自建）：会话队列（Inbox/QueueDock）、调度（agent loop）、Web UI、jobs 监管、审批、凭据、超时、沙箱、媒体展示（present）、会话记忆
- **插件提供内容**：`run_device_action` 执行工具（内含单层路由器，S11）+ 设备资源管理（闸门/熔断/准入，工具内部）+ autogamer preset（instructions/白名单/approval）+ validator/checker 两个只读 subagent
- **py 复用**（零重写）：`mcp_server` 动作面（13 工具）+ 驱动栈（adb/uiautomator2）+ 诊断栈 + clients/controllers + utils CV；录屏后补（D12）
- **不迁移**：py 智能栈（langgraph 多 agent——由 S11 单层替代）、旧控制台（原地只读保留）、artemis-client（无外部调用方）

## 二、决策记录（现行有效，D1-D14）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 战略路线 | 项目以 **DSH 插件形态重生**；方案基线 = google/artemis 上游（upstream-rethink） |
| D2 | 队列底座 | 会话队列 = **DSH Inbox**（durable + QueueDock）；禁止自建队列容器/引 Redis；「autogamer-queue」插件概念已取消 |
| D3 | 设备模型 | **共享真机 + 完整闸门**（用户已决）：闸门/熔断/准入 = run_device_action 工具内部逻辑；每会话专属模拟器（上游 playground 模型）= 二期演进项 |
| D4 | 积压策略 | Inbox 无上限原生，零自建 |
| D5 | 重启恢复 | Inbox pending 原生恢复待派 + 插件启动显式 kick（已核实的唯一缺口）；动作无断点续跑（与上游一致） |
| D6 | 版本管控 | peerDependencies 声明 + runtime 强制校验 + conformance 契约测试；自研包精确 pin |
| D7 | 引入形态 | out-of-tree 插件（`dsh.bundle.patch` + `dsh plugin add`）；**配置层热重载、代码层冷重启**（`patchReload` 字段 rc.2 无实现） |
| D8 | 技术栈 | 插件 TS；py 复用动作面/驱动/诊断/helper/录屏(后补)；**langgraph 智能栈不迁移**（由 S11 单层替代） |
| D9 | 迁移路径 | **R2' 直通插件**（P0 即插件形态，质量 spike 把关；不过→回退三段式双跑，历史方案见 git）；一期红线=旧控制台**原地只读保留**（不删除） |
| D10 | 产品形态 | 项目=DSH 插件，**无独立外部 HTTP API 面**：不建 HTTP→SDK 桥、artemis-client 直接删、webhook 通知按需再建 |
| D11 | 审批 | 常规动作 never；**run_adb_command 整工具 ask**（allowed-once，唯一授权粒度）起步；headless 需显式 `policy: never` |
| D12 | 录屏 | 后续补齐（一期无录像） |
| D13 | helper | 二期 TS 复刻（保留与 Mobly/Appium 共存差异化能力） |
| D14 | 智能层 | **单层执行路由（S11）**：单 agent + 代码强制路由器 + validator/checker 只读 subagent；pro 一期内实现、调用逻辑保真；不做反思式自检（业界 SOTA 立场） |

## 三、对接语义（S1-S11，R2' 最终版）

**S1 会话映射**
- ARTEMIS `conversation_id` ≡ DSH `SessionId`（✅ 核实：外部指定 + 幂等 create-or-adopt；id 会转义为磁盘目录名）
- 用户消息 = `followup` 进 Inbox（原生会话 FIFO + QueueDock 排队 UI）；会话记忆 = DSH 原生对话延续（py notes 继承机制消失）

**S2 任务 = turn 内动作序列（R2' 修订，取代「任务=job」）**
- 不再 spawn py worker job（R1 遗产）：设备动作 = `run_device_action` 工具调用，内部转发 py action server
- 长任务 = 单 turn 内多动作（工具内 await）；kill = `agent.cancel`（工具经 exec.signal 取消转发、释放闸门）
- 终态 = 汇报工具的 `completed/blocked + tests.failed`（run_outcome 双轴语义，盘点 04）

**S3 设备闸门（工具内部）**
- 闸门 = per-device 弱表 promise 链（官方样板 tool-bash-persistent：WeakMap<owner,Promise> + tracked pending 支持取消）+ `dsh-deque`；lockKey = endpoint+serial
- 阻塞获取（排队以 turn 进行中呈现）；parking（auto 单 ticket park 一台空闲设备）与全局并发上限（G28）内部化

**S4 设备熔断（工具内部）**
- closed →open（连续环境级失败 ≥ allowed_fails，工程默认 1）→ half-open（下一条真实消息动作即探测）→ 成功 closed
- 环境级判定（R2' 改写）：**工具层错误分类**——action server 连接失败/adb 不可达/设备离线/锁屏 = 环境级；模型语义失败 = 任务级；枚举不确定→继续熔断（fail-safe）、探测失败→不挂（fail-open）不对称保留
- 挂起期间新消息保留在 Inbox（QueueDock 可见）；解除 = 设备恢复探测 / 新提交 / 显式 resume

**S5 执行层契约（py action server，原样复用）**
- 载体：`artemis mcp --server adb` 动作面（13 工具：tap/long_press/swipe/back/launch_app/stop_app/open_link/focus_and_input_text/focus_and_clear_text/erase_one_char/press_key/take_screenshot/get_ui_hierarchy）
- autogamer TS 工具内部作 MCP client 转发（**不裸用 dsh-mcp-client patch**——会绕过闸门）；进程由插件生命周期管理
- env 极简（对齐上游容器契约）：`ADB_DEVICE_SERIAL`/`ADB_HOST/PORT/SERVER_SOCKET`/`ARTEMIS_HIERARCHY_BACKEND` + helper 相关
- 返回契约：ActionResult（`isError=False + ok=False` = 设备拒绝，观察非异常）；0-1000 归一坐标（G24）；超时必须在工具内生效（ToolDefinition.timeoutMs + exec.signal，G6）

**S6 审批映射**
- 常规动作 never；破坏性面全部集中在 run_adb_command → **整工具 ask**（D11）；helper APK 安装/Chrome 强制标志 = 任务前置隐式授权（ARTEMIS_HELPER_AUTO_INSTALL 可关）；fail-closed 默认

**S7 重启对账**
- 插件启动：拉起/校验 action server → 扫 pending inbox 非空会话显式 kick（D5）→ 无孤儿 worker 概念（R1 遗产消失）

**S8 版本门禁**：conformance 契约测试锁事件/工具面/session 格式，接 `dsh plugin` 升级流

**S9 中途指导注入**：py 机制消失；DSH 侧 = `steer`/`followup` 原生（已核实）

**S10 turn 执行（已裁定乙）**：用户消息 → Inbox → agent turn → 工具直调。R2' 下无 shim 需求（无 job、无 py worker 分支）；已核实的通用前提仍然有效：composition 挂 `dsh-tool-jobs`、`maxConcurrentJobsPerOwner`（默认 10）、创建 agent 不强制 model

**S11 单层执行路由（D14）**
- 结构：单 agent loop + `run_device_action` 路由工具 + validator/checker 只读 subagent + goal 工具（可选计划脚手架）
- 路由器按序判定（**代码强制，模型不可绕过**）：
  1. 目标置信：元素索引可解析且无歧义 → 短路径直执行（3-5s/步保持）
  2. 风险等级：破坏性/不可逆 → validator 前置 + approval ask
  3. 执行后效果确认（✅ 业界采纳 action-effect verification）：屏幕差分/dHash 确认生效 → 未生效 → validator 自愈梯（XML→坐标→pixel）→ 连败达阈值 → checker 审计通过才许重试
  4. 计划检查点：有 plan（goal 工具）→ 里程碑 checker 审计；无 plan = 仅出口审计
  5. 严格度梯级 off/final/checkpoints/strict = 路由器配置（run_device_task 入参）
- 保真对照（盘点 04 = 验收清单）：validator 升级梯原样；checker 三不变量（只读/判定 append-only 落 session log/释放与判定分离）；run_outcome 双轴；预算 = goal `maxGoalRounds` + checker 重试上限
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
| 已关闭 | G1（模式矛盾）/G2（UI 降级）/G6（Windows 沙箱）/G7（双跑）/G9（worker env）/G12（LLM 暂停）/G15（共享锁）/G16（notes）/G18（SSE）/G19（轮次视图）/G20（catch-up）/G21（通知→按需）/G22（SDK）/G29（注入） | 随 R2' 与裁定消失，逐条证据见 git 历史与三份研究文档 |

## 五、Checklist（R2' 里程碑）

- [ ] **P0 骨架与 spike**：`autogamer-device` 包骨架（run_device_action 工具骨架 + 闸门 + preset；`cordis.patch.yml`/peerDependencies/`dsh plugin add`/`--dump-config`）+ **S10 四点 spike**（模型稳定性/效果验证/闸门阻塞/Inbox 连发）+ **MCP 直连质量 spike**（flash skill + py action server 跑 2-3 个真实设备任务，对比上游 flash 质量——spike 过=直通，不过=回退三段式）+ conformance 测试骨架
- [ ] **P1 设备工具与路由**：13 动作工具 TS 包装全量（闸门/熔断/效果验证/路由决策日志）+ **pro subagent**（checker/validator 保真，盘点 04 清单验收）+ skills（flash prompts 转化 + plan/goal 脚手架 + 严格度梯级）+ 熔断矩阵（4 解除路径/fail-open-safe 不对称/auto 端点默认键/allowed_fails=1）
- [ ] **P2 设备层补全**：helper TS 复刻（D13/G25）+ 录屏接回（D12/G23 契约 + graceful stop）+ mock driver + 诊断 admission（锁屏 fail-closed/多设备切换/emulator_manager 对接）+ 模拟器专属演进评估
- [ ] **P3 UI 收尾**：roster/QueueDock 验收对照 + toolview（按需，client 侧 slot）+ goal 轮徽标（按需）
- [ ] **P4 旧线归档**：旧控制台原地只读 + py 遗留退役清单（artemis-client 删/replay_manager 删/CLI `artemis run` 非 worker 分支与 `trace`/`batch` 退役/webhook 按需）+ quality_ratchet/locale 锁**显式不做**（记录为有意撤除）
- [ ] **一期改造登记**（对既有模块的任何修改先登记）：① py 侧零改动为默认（mcp_server/驱动原样）；② 如需触碰（如录屏工具），逐项登记并说明豁免理由

### P0 执行状态（2026-10-09 动工，plugins/autogamer-device）

- ✅ **骨架**：run_device_action 路由工具（闸门→MCP 转发→效果分类→路由日志）+ 闸门/熔断 + report_task_status + autogamer preset + flash skill；19 个 vitest 用例全绿（含 conformance 契约 6 项）
- ✅ **安装流 spike（live）**：三处修正固化——`dsh.bundle.patch` 必须声明、bundle patch 是 `- insert:` 列表、Windows 路径+remove/add 重评估；层合成 dump-config exit 0
- ✅ **MCP 直连 spike（离线）**：ActionClient ↔ `artemis mcp --type adb` 全链路；真实契约接线（13 工具名/像素坐标 0-1000 换算/字符串结果归一化含 `Error executing tool` 变体/`--type` 旗标）
- ✅ **S1**：外部 SessionId 源码核实（幂等 adopt）+ live 组合验证（preset 注册、新任务默认标记、选择器可见）
- ✅ **S10 前置定论**：headless 无 preset registry、root 工具不进 headless agent（4 轮实测+代理抓包）→ S10 转 web；pi-ai baseURL 需 `/v1` 前缀（日志代理实锤）
- ✅ **conformance 骨架（G5/G18）**：tests/conformance/contracts.spec.ts——py 动作面 13 工具快照（fixture=live 抓取）、旧控制台 SSE 事件名 15 项快照含死信道清单（G18）、DSH peer 精确 pin
- ⏳ **S10 四点 live 复验（唯一剩余）**：Config schema 根因修复已就位（插件无 Config 声明时 patch 行 config=absent、preset 子挂载被跳过——creator 模式 cordis_inspect 实锤），启动 `dsh --profile web --patch spike/web-live.patch.yml` → 新会话（默认 AutoGamer）→ 发设备任务 → 确认 run_device_action 触发（mock action server 已带延迟）→ 顺带观察 Inbox 连发（④）与并发闸门（③）。注：ZCode IAB 自动化浏览器已卡死（对健康服务导航超时），此步需用系统浏览器执行或重启 ZCode 后再试
- 📌 **S2 spike 处置（R2' 决定）**：artemis-worker producer spike **移入 R1 回退件**——R2' 主路径不 spawn py worker job（「任务=job」映射由「turn 内动作序列 + MCP 直连」取代，已由 MCP 直连 spike 覆盖）；仅当直通质量 spike 失败、回退三段式双跑时才执行原 S2 spike
- ✅ **host/client 双端定论**：一期纯 host 插件（安装流已验证）；client 侧 spike 推迟到 P3 需要自定义 toolview 时

## 六、文档索引

| 文档 | 内容 |
|---|---|
| [upstream-rethink](migration/upstream-rethink.md) | 上游 google/artemis 三张调用面研究 + R2' 基线论证 |
| [dsh-verification](migration/dsh-verification.md) | DSH 0.2.0-rc.2 源码核实（48 假设/12 修正 + 19 项防重复自建 + turn shim + 主流范式 + 业界约束模式，§一~八） |
| [feature-inventory](migration/feature-inventory.md) | fork 现状防丢失盘点（inventory/01-05 明细；队列控制台部分已随 R2' 降级为 fork 场景遗产，设备/智能栈部分为上游 canonical 契约） |
