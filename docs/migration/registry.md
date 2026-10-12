# 编号登记表（registry）——D / S / G / R 的唯一权威

> 为什么要有这张表：本仓库的交叉引用全靠编号（`D7`、`S11`、`G30`、`R13`），而编号此前**散落在四份文档里且已经撞车**——机械对照查出 `G8` / `G10` / `G11` 在 `inventory/*` 与 `TODO.md` 里指的不是同一件事，`inventory` 内部同一个 `G10` 还被用了两次。审计还查出 14 个 `G*` 引用在任何表格里都找不到行（它们被压进了「已关闭」那一句的括号里）。
> 用法：**任何新增引用前先在这里查号**；查不到就说明它还没登记，不许直接引用。改名要连引用一起改，或在此登记映射。
> 机器校验：`python -X utf8 scripts/check_doc_registry.py`（悬空引用、编号语义冲突、本表与 todo 的集合一致性）。

## 一、D · 决策（现行有效）

定义位置：`docs/TODO.md` 第二节决策表。

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

定义位置：`docs/TODO.md` 第三节。

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

**现行在册**（定义与状态见 `docs/TODO.md` 第四节表格）：

| 编号 | 一句话 |
|---|---|
| G54 | 本 fork 的 `on: push` 从不触发 workflow run（三次 push 零 run，fork 级开关已排除） |
| G59 | 本机 web profile 的 `--dump-config-schema` 常驻失败，live 复验前需重装 bundle |
| G17 | 共存鉴权：旧控制台只读，DSH 认证走插件轨道 |
| G23 | 录像产物契约（manifest、命名、首帧锚定、`image://` 安全模型） |
| G25 | 层级后端互斥：u2 UiAutomation 单例、降级窗、用后 stop |
| G26 | PID-liveness 协议：仅用于 action server 进程管理 |
| G27 | 智能栈暗规则：pro 保真清单（盘点 04） |
| G36 | 截图媒体展示：模型侧已通（附件引用 + `[text, image]`），剩 UI 卡片侧归 P3 |

**已关闭**（`TODO.md` 第四节把它们压进了 `| 已关闭 |` 一行，故从前无法按号查回）：

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
| G30 | preset 工具可见性（曾是 P0 阻塞点） | 双根因修复：cordis `effect()` 语义反转导致自注销 + 裸 `register()` 未经 `defineTool()` 编译；证据见 ../CHANGELOGS.md #10 |
| G37 | live overlay 停在二分实验形态 | overlay 收回 `inner + tool-jobs` 交付形态，R6 exit 0 且 R7 新会话实测工具面恰为 5 个；证据见 ../CHANGELOGS.md #11 |
| G42 | `{index}` 元素定位整条不可用 | 按数组位置统一编号（模型看到的列表与解析器同源）+ 修掉 render 的 200 字符截断；7 条单测 + live 两轮命中 `#28`/`#17` |
| G39 | 效果判定归属层（真机回 JPEG 令 TS 侧 PNG 差分失效） | 裁定路线 A：py 动作面新增只读 `compare_ui_frames`，判定委托仓库内上游实现 `check_ui_change`；证据见 ../CHANGELOGS.md #12 |
| G41 | 终态不收敛：`report_task_status` 之后回合继续跑 | `concludeTurn()` live 实证：汇报的 tool/call 之后直接 `turn/end`、无后续 `step/start`（CHANGELOGS **#15**） |
| G44 | 模型可以不调 report_task_status 就结束回合 | `{global:true}` 监听 + 边界外 `followup()` 的兜底追问端到端可用，第二轮模型补出汇报（CHANGELOGS **#15**） |
| G40 | 运行中 UI 不接受第二条消息（**当日撤回的错误归因**） | 探针按固定 `aria-label="发送消息"` 找按钮，把运行中主按钮切成「排队发送」误读成入口消失；改按按钮位 class 枚举后实测 QueueDock 原生可用、回合结束按序执行 |
| G46 | 未汇报追问在交付形态下从不触发（**当日撤回的错误归因**） | 拿 wire 请求体数 `report_task_status` 推断「没汇报也没追问」；实际那次汇报是**终结回合的最后一次工具调用**，永远不会出现在后续请求体里。改读会话日志后：追问与汇报都正常发生，详见 CHANGELOGS **#15** 与守则 **R24** |
| G45 | 交付 preset 没有指令投递行：flash 契约从未进过模型，spike 与服从性观察的前提都不成立 | `persona` 行进交付形态与 overlay（文本内禁 `{{}}`）；新会话 wire 断言 system 4052 字符、契约起于第 50 字符；详见 CHANGELOGS **#14** |
| G49 | GitHub 安装失败于 `ERR_PNPM_EPERM`（根因未定） | 单变量跑完：停服务报错不变→否证占用假说；清掉同名 junction 后 `added 17` exit 0→成立。机制=`importPackage` 顺着旧 `link:` 走进开发工作区重建符号链接被 Windows 拒；详见 CHANGELOGS **#22** |
| G50 | git 形态装出来的 bundle 缺 `dist/`，pnpm 成功但不可用 | tarball 路线端到端验通（清单含 dist+skills、安装 exit 0、服务加载后工具面与终态链路完整）；对外交付形状定为 GitHub Release 资产 tarball URL；详见 CHANGELOGS **#23** |
| G51 | 本机 Node TLS 信任被本地中间代理接管，走 https 的依赖安装要 `--use-system-ca` | 源码核对 + 两次 DSH 侧实测确认前置有效；README 已写安装前置并禁用关掉校验；详见 CHANGELOGS **#25** |
| G47 | `install_bundle` 的两项未验：失败是否真回滚 profile 文件、`files` 打包清单是否生效 | 一次性包三轮实测：两例失败后 profile 两文件 SHA256 不变；tarball 安装落地树恰等于 `files` 白名单；详见 CHANGELOGS **#19** |
| G48 | 成功的 git 安装无证据；`files` 与 `path:` 子目录在 git 形态下是否生效未测 | `git+file://` 本地仓库两形态都 `application:"applied"`，落地树恰等于 `files` 白名单；详见 CHANGELOGS **#20** |
| G35 | 文档门禁脚本默认路径写死 | `DEFAULTS` 从脚本自身位置推导仓库根；自测锚点改为动态取第一条 G 行；详见 CHANGELOGS **#16** |
| G32 | bundle 展示元信息缺失（locale meta 与 icon） | 补 locale/{en,zh}.json 的 meta.title/description + 原创 icon.svg + exports/files；详见 CHANGELOGS **#17** |
| G31 | 引入流仍靠手工：交付形态要迁 install_bundle | 一次性空 bundle 端到端验通 install_bundle（applied/注册/撤除干净）；随包 skill 路径改官方 !!js 解析；详见 CHANGELOGS **#18** |
| G5 | conformance 需要真实 DSH runtime（CI 起 DSH 跑契约测试） | 三层落地：真实 DSH 服务包 in-process 挂载读 `ctx.tools.schemas()`、三条 fixture 改生成物、live 取证脚本，并新增 CI `plugin-contracts` job（双 OS 实测 success）；详见 CHANGELOGS **#29**（过程 #27/#28） |
| G52 | 追问路径仍只有 fake 事件总线证据 | 新增 Tier 1 `tests/conformance/followup.spec.ts`：真 `dsh-session` 提交 `turn/end`、真 `AgentRegistry` 解析句柄、真 `ToolRuntime.execute` 标记 acted，并在两个 realm 之间观察到 scope 筛选确实排除非 global 监听；顺带摘掉追问消息的手镜像（缺 `UserMessage.id`）；详见 CHANGELOGS **#32** |
| G56 | mock 与 `ActionClient` 握手超时 | 手拼应答缺 `jsonrpc` 字段被 SDK 读侧拒收；补帧字段后真 SDK 握手通过；详见 CHANGELOGS **#35** |
| G57 | 插件挂进 `createScope` realm 后其工具对注册表视图不可见 | 裸 scope 注册本就生效（`register()` 打 scope 标签，读须传 scope；旧「双空」是误读）；详见 CHANGELOGS **#34** |
| G33 | 策略内建在工具正文里 | 冷却拒绝迁 `guard()`，只读动作声明 `isConcurrencySafe`；顺带修掉 `starting` 失败缓存与组装期传输分类；详见 CHANGELOGS **#36** |
| G53 | 前端 lockfile 全镜像 URL 使门禁红 | 221 个 `resolved` 只换 host（零漂移），门禁绿；详见 CHANGELOGS **#37** |
| G55 | `check_dependency_sources.py` 不合 `ruff format` | 一条命令修好（`e1de835`）；仓级另 9 处红另立 G58；详见 CHANGELOGS **#38** |
| G34 | 裸 schema 注册的输入自校验缺口 | 输入语义校验入工具（coordinate 存在即判、不静默回退，text 非空、duration 正数、key 可解、swipe 起止成对、package/url 非空），11 条单测锁死；详见 CHANGELOGS **#33** |
| G38 | 插件内部错误被归类成任务级失败 | 第三类 `internal`：无前缀异常与逃逸抛出走 internal，不记 breaker，抛 `internal:` 并带勿重试信号；传输层保持 environment（fail-safe）；详见 CHANGELOGS **#33** |
| G4 | 熔断探测体（矩阵落定） | 键同源、四解除、不对称引用既有锁；新提交不旁路等显式偏差见 S4；详见 CHANGELOGS **#39** |
| G43 | spike 复位与判据不可靠（`settings put` 无效） | `scripts/spike_reset.py` 复位脚本 + dry-run 锁；live deferred，P1-live 接；详见 CHANGELOGS **#42** |
| G58 | 仓级另 9 处格式红（G55 文件已先修） | `ruff format .` 零语义 + 同文件 3 处 E731 改 `def`；279/1 回归绿；详见 CHANGELOGS **#43** |
| G8 | 终态权威（收缩） | 汇报双轴 + `concludeTurn`；exit-code 映射随 worker 消失；详见 CHANGELOGS **#44** |
| G10 | 动作中断语义 | `exec.signal` 穿透到 SDK 请求；闸门释放早已在 `finally`；详见 CHANGELOGS **#44** |
| G11 | 熔断判定信号 | 工具层错误分类；详见 CHANGELOGS **#44** |
| G13 | 幂等 / 去抖 | in-flight 去重（变更类专属）；详见 CHANGELOGS **#44** |
| G14 | 状态词汇 | 汇报 `completed/blocked + tests.failed`；详见 CHANGELOGS **#44** |
| G24 | 坐标契约 | 归一域/端侧索引；详见 CHANGELOGS **#44** |
| G60 | 两枚文档门禁从未接进 CI | `ci.yml` 新增无 `if` 的 `Check documentation gates` step；真 run 未观测（G54）；详见 CHANGELOGS **#46** |
| G61 | 仓库无 `.gitattributes`，工作树字节随 checkout 变 | 新增 `.gitattributes` + renormalize 实测零文本 blob 改写；本机 `ruff format --check` 假红转绿；详见 CHANGELOGS **#47** |
| G62 | py action 面无「无设备可跑」路径，离线契约只能吃插件的 JS 桩 | `artemis/mcp/mock_server.py` + CLI `--type mock`，用现成 `MockActuator` 预置两条缓存短路绕开 adb I/O；与 `--type adb` 工具清单逐字相同；详见 CHANGELOGS **#52** |
| G63 | py 动作面 fixture 从未在 CI 被重新比对 | `python-quality` job 新增无 `if` 的一步，用 `--type mock` 每次重导并比对；本地同命令 exit 0，变异校验（fixture 删一名）exit 1；详见 CHANGELOGS **#54** |
| G3 | auto-serial 闸门缺口：显式 serial 队列 + auto 空闲池 | A 片 `src/devicePool.ts`（roster 由 config 注入，默认空＝现状不变）；真枚举另立 G64；详见 CHANGELOGS **#55** |
| G28 | parking 与全局并发上限的内部语义 | 按 `device_lock.py:332` 口径实现并六条锁死；详见 CHANGELOGS **#55** |
| G64 | 设备 roster 的真来源 | py 只读 `list_devices` 工具 + 插件 `rosterSource`（`discoverDevices` 默认 false）；详见 CHANGELOGS **#56** |

> 逐条证据：`TODO.md` 已关闭行的原话是「随 R2' 与裁定消失，逐条证据见 git 历史与三份研究文档」。本表只登记编号与短语，**不重述证据**；要考证就查 git 与研究文档，别在这里二次抄写（抄一遍就多一处会腐烂的地方）。

### 编号冲突（**不得作为引用目标**）

机械对照（`scripts/check_doc_registry.py`）查出 `inventory/*` 沿用的 G 编号与现行编号撞车，且 inventory 内部自身也重复使用：

| 编号 | `TODO.md` 现行含义 | `inventory/*` 里另一套含义 | 出处 |
|---|---|---|---|
| G8 | 终态权威 | worker 进程 env / CLI 完整契约表；SSE 与事件契约对照基线 | `inventory/01-console-queue.md`、`inventory/02-runtime-persistence.md` 等 |
| G9 | worker env（已关闭） | 优雅停止宽限语义 | `inventory/01-console-queue.md` |
| G10 | 动作中断语义 | 幂等 / 去抖提交语义；对外通知契约 | `inventory/01-console-queue.md`、`inventory/02-runtime-persistence.md` |
| G11 | 熔断判定信号 | 状态词汇表映射；会话轮次视图不变量 | `inventory/01`、`inventory/05` |
| G12 | LLM 暂停（已关闭） | 熔断解除矩阵与 fail 策略等（inventory 正文另有用法） | `inventory/01`、`feature-inventory.md` |

处置：**以本表与 `TODO.md` 为唯一权威**；`inventory/*` 是盘点现场记录，其中 `**Gn · …**` 形式的「新增差距」段落属早期编号方案，**只作内容参考，不作编号引用**。需要指代 inventory 里那条时，写「`inventory/0N` 的 X 段」而不是 `Gn`。

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
| R20 | 遇 DSH 行为问题先查官方一手资料取解法，不许先写猜测实现 |
| R21 | 手镜像的宿主契约必须标出处与版本，并区分「单测证明」与「live 证明」 |
| R22 | 功能实现三步序：查官方文档 → 写 todo 方案 → 才动代码（方案提交须早于实现提交） |
| R23 | 不得在 `session/event` 的 emit 里 append；注入类调用先推出发布边界 |
| R24 | 判「没发生」只认会话日志；wire 与插件 logger 都无否证力 |
| R25 | 定根因先读机制文档，一次只测一个变量；禁止连环试错，推荐方案前先核是否已是现状 |
| R26 | `gh` 的写操作必须显式 `--repo`，失败先核对打到了哪个仓库 |
| R27 | 判据必须经变异校验证明会红；字节/行尾类口径要写明量 blob 还是工作树，未进 CI 的门禁不许当验收 |

## 五、还有一类编号：P 里程碑与 X 面

- `P0`-`P4`：`TODO.md` 第五节 checklist 的里程碑，**不是差距编号**，与 `G*` 无对应关系。
- 文档内引用「盘点 04」「`inventory/03`」等指 `docs/migration/inventory/0N-*.md`，按文件名引用。
