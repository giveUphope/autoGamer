# 编号登记表（registry）——D / S / G / R 的唯一权威

> 为什么要有这张表：本仓库的交叉引用全靠编号（`D7`、`S11`、`G30`、`R13`），而编号此前**散落在四份文档里且已经撞车**——机械对照查出 `G8` / `G10` / `G11` 在 `inventory/*` 与 `todo.md` 里指的不是同一件事，`inventory` 内部同一个 `G10` 还被用了两次。审计还查出 14 个 `G*` 引用在任何表格里都找不到行（它们被压进了「已关闭」那一句的括号里）。
> 用法：**任何新增引用前先在这里查号**；查不到就说明它还没登记，不许直接引用。改名要连引用一起改，或在此登记映射。
> 机器校验：`python -X utf8 scripts/check_doc_registry.py`（悬空引用、编号语义冲突、本表与 todo 的集合一致性）。

## 一、D · 决策（现行有效）

定义位置：`docs/todo.md` 第二节决策表。

| 编号 | 一句话 |
|---|---|
| D1 | 项目以 DSH 插件形态重生，方案基线 = google/artemis 上游 |
| D2 | 会话队列 = DSH Inbox；禁自建队列容器与引 Redis；「autogamer-queue」概念已取消 |
| D3 | 设备模型 = 共享真机 + 完整闸门；每会话专属模拟器为二期演进项 |
| D4 | 积压策略：Inbox 原生无上限，零自建 |
| D5 | 重启恢复：Inbox pending 原生恢复待派 + 插件启动显式 kick；动作无断点续跑 |
| D6 | 版本管控：peerDependencies 声明 + runtime 强制校验 + conformance 契约测试 |
| D7 | 引入形态三层：禁手写 profile 文件 / `--patch` 为官方 overlay / 交付走 install_bundle；配置热重载、代码冷重启；声明只影响之后创建的 Agent |
| D8 | 技术栈：插件 TS，py 复用动作面与驱动栈，langgraph 智能栈不迁移 |
| D9 | 迁移路径 = R2' 直通插件，质量 spike 不过则回退三段式双跑；红线是旧控制台原地只读 |
| D10 | 产品形态：项目即 DSH 插件，无独立外部 HTTP API 面；删 artemis-client，webhook 按需 |
| D11 | 审批：常规动作 never，破坏性面集中在 run_adb_command 整工具 ask |
| D12 | 录屏后续补齐（一期无录像） |
| D13 | helper 二期 TS 复刻（与 Mobly / Appium 共存的差异化能力） |
| D14 | 智能层 = 单层执行路由（S11），不做反思式自检 |
| D15 | 契约核实只用声明面；禁止解包 app.asar |
| D16 | Host 提供共享服务，preset 贡献 scoped tools；provider 与消费方必须同 isolate realm；挂载 fail-fast |
| D17 | 自举引入：preset 挂 tool-plugin-manager，让 agent 自己执行 install_bundle |

## 二、S · 对接语义（现行有效）

定义位置：`docs/todo.md` 第三节。

| 编号 | 一句话 |
|---|---|
| S1 | 会话映射：ARTEMIS `conversation_id` 等于 DSH `SessionId`，消息走 followup 进 Inbox |
| S2 | 任务 = 单个 turn 内的动作序列，不再 spawn py worker job |
| S3 | 设备闸门：工具内的 per-device 串行 + parking + 全局上限；只补宿主没覆盖的那半边 |
| S4 | 设备熔断：closed / open / half-open 与不对称 fail 策略；拒绝出口走 `ctx.tools.guard()` |
| S5 | 执行层契约：原样复用 py action server 的 13 工具面；超时自实现，不指望 `timeoutMs` |
| S6 | 审批映射：破坏性集中一工具；授权类动作永远 user-only |
| S7 | 重启对账：校验 action server + kick 有 pending 的会话 |
| S8 | 版本门禁：conformance 锁契约；本机落后上游两版，升级前 fixture 视为过期 |
| S9 | 中途指导：DSH `steer` / `followup` 原生；`inject` 不唤醒而 `followup` 唤醒 |
| S10 | turn 执行形态已裁定乙：用户消息 → Inbox → agent turn → 工具直调 |
| S11 | 单层执行路由：单 agent + 代码强制路由器 + validator / checker 只读 subagent |

## 三、G · 差距清单

**现行在册**（定义与状态见 `docs/todo.md` 第四节表格）：

| 编号 | 一句话 |
|---|---|
| G3 | auto-serial 闸门缺口：显式 serial 队列 + auto 空闲池 |
| G4 | 熔断探测体：下一条真实消息动作即探测 |
| G5 | conformance 需要真实 DSH runtime（CI 起 DSH 跑契约测试） |
| G8 | 终态权威（worker 退出码映射随 py worker 消失） |
| G10 | 动作中断语义：`exec.signal` 取消转发并释放闸门 |
| G11 | 熔断判定信号：工具层错误分类，不再查 DB |
| G13 | 幂等 / 去抖：工具内同会话同 goal 短防抖 |
| G14 | 状态词汇：汇报工具 completed / blocked + tests.failed |
| G17 | 共存鉴权：旧控制台只读，DSH 认证走插件轨道 |
| G23 | 录像产物契约（manifest、命名、首帧锚定、`image://` 安全模型） |
| G24 | 坐标契约：0-1000 归一域、索引在 client 端解析、动作名归一 |
| G25 | 层级后端互斥：u2 UiAutomation 单例、降级窗、用后 stop |
| G26 | PID-liveness 协议：仅用于 action server 进程管理 |
| G27 | 智能栈暗规则：pro 保真清单（盘点 04） |
| G28 | parking 与全局并发上限的内部语义 |
| G30 | **P0 当前阻塞点**：工具在 `register()` 成功后仍不进 Agent 工具面 |
| G31 | 引入流仍靠手工：交付形态要迁 install_bundle |
| G32 | bundle 展示元信息缺失（locale meta 与 icon） |
| G33 | 策略内建在工具正文里，与官方「不要内建策略」相反 |
| G34 | 裸 schema 注册的输入自校验缺口 |

**已关闭**（`todo.md` 第四节把它们压进了 `| 已关闭 |` 一行，故从前无法按号查回）：

| 编号 | 原短语 | 关闭方式 |
|---|---|---|
| G1 | 模式矛盾 | 随 R2' 定稿消失 |
| G2 | UI 降级 | 随 DSH 原生 roster / QueueDock 与旧控制台只读消失；**注意它只覆盖展示降级面，没覆盖 catch-up**（后者是 G20） |
| G6 | Windows 沙箱 | 随 R2' 不 spawn job 消失 |
| G7 | 双跑 | 转为 D9 的回退件 |
| G9 | worker env | 随 R1 遗产消失 |
| G12 | LLM 暂停 | 随 py 智能栈不迁移消失 |
| G15 | 共享锁 | 由 D3 裁定吸收 |
| G16 | notes | 由 D2 与 S1 的 DSH 原生会话记忆承接 |
| G18 | SSE | 随 D10 收缩；事件名全集保留为 conformance fixture（见 `tests/fixtures/sse-events.json`） |
| G19 | 轮次视图 | 旧控制台只读，DSH 原生承接 |
| G20 | catch-up | 核实为 DSH 原生支持（`readSessionState` 等），无需自建 |
| G21 | 通知 | 改为按需再建（D10） |
| G22 | SDK | 随 D10 删除 artemis-client |
| G29 | 注入 | 由 S9 以 DSH 原生承接 |

> 逐条证据：`todo.md` 已关闭行的原话是「随 R2' 与裁定消失，逐条证据见 git 历史与三份研究文档」。本表只登记编号与短语，**不重述证据**；要考证就查 git 与研究文档，别在这里二次抄写（抄一遍就多一处会腐烂的地方）。

### 编号冲突（**不得作为引用目标**）

机械对照（`scripts/check_doc_registry.py`）查出 `inventory/*` 沿用的 G 编号与现行编号撞车，且 inventory 内部自身也重复使用：

| 编号 | `todo.md` 现行含义 | `inventory/*` 里另一套含义 | 出处 |
|---|---|---|---|
| G8 | 终态权威 | worker 进程 env / CLI 完整契约表；SSE 与事件契约对照基线 | `inventory/01-console-queue.md`、`inventory/02-runtime-persistence.md` 等 |
| G9 | worker env（已关闭） | 优雅停止宽限语义 | `inventory/01-console-queue.md` |
| G10 | 动作中断语义 | 幂等 / 去抖提交语义；对外通知契约 | `inventory/01-console-queue.md`、`inventory/02-runtime-persistence.md` |
| G11 | 熔断判定信号 | 状态词汇表映射；会话轮次视图不变量 | `inventory/01`、`inventory/05` |
| G12 | LLM 暂停（已关闭） | 熔断解除矩阵与 fail 策略等（inventory 正文另有用法） | `inventory/01`、`feature-inventory.md` |

处置：**以本表与 `todo.md` 为唯一权威**；`inventory/*` 是盘点现场记录，其中 `**Gn · …**` 形式的「新增差距」段落属早期编号方案，**只作内容参考，不作编号引用**。需要指代 inventory 里那条时，写「`inventory/0N` 的 X 段」而不是 `Gn`。

## 四、R · 插件契约守则

定义位置：`docs/migration/plugin-contract-rules.md`（每条带出处口径与判据）。

| 编号 | 一句话 |
|---|---|
| R1 | 取证只走声明面，禁解包 asar |
| R2 | 改配置分三层看：禁手写 profile 文件、`--patch` 合法、交付走 install_bundle |
| R3 | preset 只能由 bundle 补丁承载；注册表不扫目录、不接受路径 |
| R4 | preset 声明行的字段约束（`id` 与 `plugins` 必填；子项可省略 id） |
| R5 | 覆盖是整体替换 config，truthy `name` 是断言不是改名 |
| R6 | 每条非 insert 补丁都必须命中：`--dump-config` exit 0 且无 unmatched |
| R7 | 声明只影响之后创建的 Agent；复验必须开新会话 |
| R8 | realm 约束与挂载 fail-fast（缺 `tools` 键 = 整体被拒的形态特征） |
| R9 | 判生效只认官方检查器，不认日志 / 进程 / `plugin list` / wire 反推 |
| R10 | 插件必须声明原生 Schemastery 的 `Config`；未配置可选 tuple 是真值数组 |
| R11 | 版本门禁：本机与上游的版本差要让 fixture 过期 |
| R12 | Host 插件导出形态二选一，不许混用；写 config 前先查 schema 并跟 `$defs` |
| R13 | 扩展点按「够用即最弱」选，策略不许内建进工具正文 |
| R14 | 宿主已有「只读并发 / 变更独占按提交序」，工具要声明安全属性 |
| R15 | `timeoutMs` 不执行；超时要么包装层要么自实现，取消必须观测 `exec.signal` |
| R16 | 不许自写会话事件类型；可回放状态走 `presentationMeta` 或投影 |
| R17 | `inject` 不唤醒、`followup` 唤醒；`source.kind` 要声明 |
| R18 | UI 只进 slot、拷贝不 import 宿主 Client 包；Web 不消费 Host 展示方法 |
| R19 | 命名唯一与展示元信息是义务；授权类动作永远 user-only |

## 五、还有一类编号：P 里程碑与 X 面

- `P0`-`P4`：`todo.md` 第五节 checklist 的里程碑，**不是差距编号**，与 `G*` 无对应关系。
- 文档内引用「盘点 04」「`inventory/03`」等指 `docs/migration/inventory/0N-*.md`，按文件名引用。
