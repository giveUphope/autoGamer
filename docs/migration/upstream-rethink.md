# 上游实现情况研究与方案重构（upstream rethink）

> 日期：2026-10-09；上游：google/artemis（本仓库为其 fork，领先 92 提交）；方法：`git fetch upstream` + 结构/关键文件精读，对照 5 份既有盘点。
> 触发：用户裁定「当前迁移路线并非最优，需从未修改的上游项目获取实现情况重新思考」。

## 一、上游的三张调用面（google canonical）

| 面 | 形态 | 关键证据 |
|---|---|---|
| **MCP 面（README 主打）** | artemis 定位=「Let AI assistants use real phones」——`mcp_server` 让 Claude Code/Antigravity/Windsurf 直接驱动机器+logcat+截图 | README Key Highlights「MCP-Native Server」徽标与 MCP-setup 节 |
| **playground 云端面** | **每会话一个完整容器**：backend_manager 收请求 → spawn `artemis-session-<id>` 容器（内跑完整 admin_console server :8080）→ entrypoint 自动 `adb connect` **专属 Cuttlefish AVD**（6520+N）→ Nginx 按 `/session/:id/artemis/*` 反代；reaper 30s 心跳/TTL 销毁容器+AVD；BigQuery 登记映射 | playground/artemis_container/README 架构图；backend_manager/README 核心职责 1-6 |
| **本地控制台面** | admin_console + showcase_ui：单机多会话**共享设备**，共享队列 + device_lock + 熔断（我们 fork 强化的就是这张面） | 已有盘点 01/02 |

**容器 env 契约（上游版）只有 4 项**：`SESSION_ID` / `ADB_DEVICE_SERIAL` / `PORT` / `PYTHONUNBUFFERED` + LLM 凭据转发（docker_service.py:96-104）。我们 fork 演化出的 20+ env（ticket/ingress/submitted_at/lock scope/ipc）**全部是「共享队列」形态的复杂度，上游不存在**。

## 二、fork 偏移量化（92 提交的构成）

- admin_console：+1292/-44（队列增强：pause/resume、熔断、never-started 补插、幂等——全部服务于「共享设备多会话」形态）
- artemis/ 核心：41 文件 +868/-269（**智能栈基本未动**——上游 canonical 的 agents/graph/llm/memory 与我们审计基线一致）
- 新增 109 文件：showcase_ui_v2（~70）+ docs/migration（本文档系列）+ replay_manager + 少量测试

**结论：上游 = 纯净基线；我们审计的 5 份盘点对 artemis/* 核心全部有效，但「共享队列/锁/熔断」的复杂度属于 fork 场景（本地单机共享真机），不是上游核心。**

## 三、对迁移方案的重构（R2'·上游对齐直通插件）

上游定位（给 AI 助手的设备工具集）与「DSH 插件提供内容」完全同构。重构后的方案：

1. **内容层（=插件提供物）**：
   - 设备工具：上游 `mcp_server` 动作面（13 工具）为基线，经 TS 包装转发 py action server（闸门阻塞在自家工具内；不裸用 dsh-mcp-client patch 以免绕闸）
   - flash 模式：DSH agent loop + skills（与 FlashRunner 反应环天然同构，README：3-5s/步）
   - **pro 模式一期内实现（用户已决）**：checker/validator 以 DSH subagent 承接，**调用逻辑保真**——上游语义 = Operator 产出动作 → validator 执行前安全网 → blocked/failed 终态动作作为 `open_incident` 回 Operator 自行恢复 → checker 零副作用只读判定 → verify 失败回流（预算内）、assert 失败只记 tests.failed 不回流（盘点 04 §2.4/2.5 为保真清单）
   - 诊断/模拟器：上游 `core/diagnostics`（emulator_manager 管本地 AVD 生命周期——playground 的 Cuttlefish 编排在单机版对应物）→ admission 工具
2. **DSH 原生承接**：Inbox 队列、调度、web UI、jobs 监管、审批（run_adb_command 整工具 ask）、凭据、超时、沙箱、present
3. **设备模型分叉（待用户决策，影响闸门复杂度）**：
   - **共享真机**（本地单机现状）→ 完整闸门+熔断+准入（保留盘点 01 §1.2 全部语义）
   - **每会话专属模拟器**（上游 playground 模型；emulator_manager 原生管 AVD）→ 闸门退化为薄校验，复杂度大幅下降
4. **录屏**：后续补齐（用户已决）
5. **旧控制台**：原地只读保留（一期红线不变）；showcase_ui_v2 的近 6 提交行为断言不再需要接棒者（队列 UI 由 QueueDock 原生）

## 四、对既有文档的影响

- 盘点 01（队列控制台）的大部分条目降级为「fork 场景遗产」：仅在共享真机形态下部分有效（ENVIRONMENT_ERROR_MARKERS/终态权威/stdout 尾行仍随 py worker 沿用）
- 盘点 03/04（设备/智能栈）全部有效且升格为「上游 canonical 契约」——S10/S2/S5 的 env 契约表按上游 4 项 + py worker 必需项重新裁剪
- dsh-verification 全部有效；S10 架构（乙·tool-mediated）不变，run_device_task 工具内部按设备模型决策裁剪

## 来源

- google/artemis main@351ca84：README.md、playground/{backend_manager,artemis_container}/README.md、docker_service.py、server.py
- 本仓库 5 份盘点（docs/migration/inventory/01-05）+ dsh-verification.md
