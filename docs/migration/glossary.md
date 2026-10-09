# 术语表（glossary）

> 为什么要有：方案文档里同时混着 **DSH 宿主术语**、**上游 Cordis 框架术语** 和 **本项目自造词**（闸门、熔断、parking、直通插件……）。同一个词还可能有两个意思（`inject`）。这张表只干一件事：**把黑话换成人话，并给出该去查哪个权威编号**。
> 用法：读 `todo.md` 或守则时卡住就回来查；新增自造词必须在此登记，否则视为不允许发明术语。
> 口径标注：**宿主** = DSH/Cordis 的概念（依据见 `plugin-contract-rules.md` 的出处）；**本项目** = 我们的叫法，权威定义在 `todo.md` 的 D/S/G 编号里。

## 一、易混淆的第一名：`inject` 有两个意思

| 写法 | 意思 | 归属 |
|---|---|---|
| 插件导出 `inject = ['tools']` | 声明**服务依赖**，被注入的服务就绪后插件才激活；放进 `ctx.inject([...])` 即「可选」，缺服务时不激活而不是抛错 | 宿主 |
| `agent.inject({content, source})` | 往某个 agent 的收件箱**追加持久上下文**，**不会唤醒**它；下一次准入的 step 才看到 | 宿主（守则 R17） |

写方案或代码时不要只说「inject」，要说清是哪一个。

## 二、DSH 与 Cordis 侧术语

| 术语 | 人话 | 备注 / 权威 |
|---|---|---|
| profile | 一套可启动的插件组合配置，目录在 `~/.dsh/profiles/<name>`；本机 spike 用 `web` | 每个 profile 的 `node_modules` 只放 profile 级安装的 bundle |
| bundle | 一个包，`package.json` 里声明 `dsh.bundle.patch`，其 YAML 补丁插入插件行 | 守则 R2、R19 |
| patch layer / overlay | 补丁按层叠加，后层覆盖前层；`--patch <path>` 是加在 profile 层之后的官方 overlay | 覆盖是**整体替换** config（R5） |
| Cordis | DSH 内嵌的插件框架：插件 = 实现 Service 的对象，上下文 = 服务容器 | 「Everything is a Plugin」 |
| Loader | 读补丁、决定每行是否挂载的组件；`!!js` 表达式由它在挂载时求值 | |
| agent preset（预设） | 一份「这个 agent 挂哪些子插件」的声明，即 `@deepseek-ai/dsh-agent-preset` 的 config | 只能由 bundle 补丁承载（R3） |
| preset registry | 预设目录与默认值服务；声明在启动时加载 | 不扫目录、不接受路径 |
| scope | 注册的可见性与所有权：子作用域继承祖先贡献，近者优先 | 通过 `agent.ctx` 注册的工具只对该 agent 可见 |
| realm / `isolate` | 服务实例的隔离域。preset 里提供服务的插件必须与消费方同 realm，否则挂载被拒 | 守则 R8、D16；`cordis:group` + `isolate:` 是官方写法 |
| fiber | 插件运行时的一次执行体；dispose 它的 fiber 就注销其中的注册 | |
| effect / disposer | 注册是可逆副作用：`ctx.effect()` / `ctx.on()` 返回清理函数，卸载时撤销 | 一处注册两个所有者时要各自留 disposer |
| waterfall | 环绕式中间件事件（`(...args, next)`）；不调 `next()` 即短路 | 不拥有决策权的监听器必须 `return next()` |
| guard | `ctx.tools.guard()`：单调、同步的最终拒绝，后续监听器翻不回来 | 我们的熔断出口该用它（R13） |
| restrict | `ctx.tools.restrict(filter)`：只能**缩小**某个 agent 的可见工具集 | 只能删不能加 |
| Inbox / QueueDock | 宿主原生的会话消息队列与排队界面 | D2/D4：不自建队列 |
| followup | 进 Inbox 的用户消息；会唤醒空闲 agent | |
| steer | 运行中注入指导 | S9 |
| turn / step | 一次 agent 回合 / 回合内的一步 | |
| session log | 会话事件追加日志，**唯一真相来源**；fork、resume、replay 都从它派生 | 插件内存只是派生缓存（R16） |
| durable 事件 | 已落盘的 `turn/end`、`assistant/message`、`tool/result` | 等这些，不要 poll `agent/status` |
| roster | 预设与插件的清单界面，激活失败会带诊断留在上面 | 判生效的入口之一（R9） |
| `enabled` / `fiberPhase` / `overridden` / `failed` / `restart-required` | 行的状态字段：`failed` 要诊断，`overridden` 表示有更高优先层赢了，`restart-required` 表示改动还没生效 | 全部按 R9 作数，别用日志推断 |
| PTC mode | 把工具暴露成 `await tools.<name>(args)` 的程序化调用模式 | 呈现方式按 agent 不按工具（S11 记过） |
| Native mode | 普通 function calling | |
| `defineTool` | 类型化 DSL：参数在执行前校验、声明输出与展示 | 裸 schema 注册也合法，但要自己校验（G34） |
| `output.schema` / `render` | 规范 JSON 返回值 + 模型可见文本 | UI 卡片是另一件事（R18） |
| `presentationMeta` | 从规范值派生可回放的 UI 事实，持久化在 `tool/result.meta` | 我们 checker 落盘的正道（R16） |
| `install_bundle` | `plugin_manager` 的安装动作，会自己跑包安装与选择 | 不许用 shell 复现这些步骤（R2） |
| HMR | 改配置层可免重启热重载；换包代码需要重启才有新的 JS 模块代 | D7 |
| `!!js` | 补丁里的表达式标量（**不是** `!js`），在挂载/激活时求值 | `disabled` 与 `config` 里合法 |
| Schemastery | DSH 用的 schema 校验库；`Config` 必须是它的原生对象 | 用 zod 会被拒（R10） |
| `Config.listConfigs` | 查已安装插件的真实 config schema 与 `packageDir` | 写 config 前先查它并跟 `$defs`（R12） |
| danger-full-access | 会话的文件策略档位（无沙箱限制），审批提示也被关掉 | 我们的 preset 目前跑在这一档 |

## 三、本项目自造术语

| 术语 | 人话 | 权威编号 |
|---|---|---|
| R2' / R2-prime | 现行方案：项目整体收缩为一个 DSH 插件 + 若干 skills | D1、D9 |
| 直通插件 | 插件直接提供执行工具，不经过 py worker/job 中间层 | D9 |
| 三段式双跑 | 直通质量不达标时的回退形态（新旧两条路径并行一段时间） | D9、S2 |
| 闸门 | 同一设备的动作串行化，后来的排队而不是失败 | S3、G3 |
| 熔断 | 设备连续环境级失败后暂时拒绝该设备的所有动作 | S4、G4 |
| closed / open / half-open | 熔断三态；half-open 用下一条真实动作当探测 | S4 |
| 不对称 fail 策略 | 判定不确定时**继续挂**（fail-safe），探测失败时**不挂**（fail-open） | S4 |
| parking | 没有指定设备时，让一条消息先占住一台空闲设备 | G28 |
| auto 端点 / 显式 serial | 设备寻址的两种形态；auto 走空闲池，显式走 serial 队列 | G3 |
| 0-1000 归一坐标 | 工具面对模型说千分比坐标，TS 侧换算成设备像素 | G24 |
| 层级后端 | UI 层级抓取的实现选择（u2 UiAutomation 与设备 helper 互斥） | G25 |
| helper | 装在设备上的辅助 APK，提供层级与输入等能力 | D13 |
| flash / pro | 旧 py 智能栈的两档执行策略：快档直接执行，慢档带复核 | D14、G27 |
| 单层执行路由（S11） | 一个 agent 循环 + 代码强制的路由器 + 两个只读 subagent | S11 |
| validator / checker | 执行失败后的自愈梯 / 出口与里程碑审计，都只读 | S11、G27 |
| 严格度梯级 | off / final / checkpoints / strict 四档审计强度 | S11 |
| run_outcome 双轴 | 任务终态分「目标达成」与「测试失败数」两条轴 | S2、G14 |
| 质量 spike | 用少量真实任务比较新旧执行质量，作为直通/回退的判据 | D9 |
| 盘点 | 怕丢能力而做的现状清单，`docs/migration/inventory/0N-*.md` | 引用它写「`inventory/0N` 的 X 段」，别写它的 G 编号 |
| 声明面 | 允许取证的范围：CLI `--help`、`--dump-config*`、随包 README、已安装包产物、`~/.dsh` 运行数据、上游公开仓库 | D15、R1 |
| 活门禁 | 能自己报警的检查：测试、尺子、`--dump-config` 自检、官方检查器 | R9 |
| 尺子 | 机械校验脚本的统称（表格几何、编号引用、质量棘轮） | `scripts/check_doc_tables.py`、`scripts/check_doc_registry.py` |
| P0-P4 | 里程碑阶段，**不是**差距编号 | `todo.md` 第五节 |

## 四、写作约定（给文档，也给代码注释）

- 差距与决策一律用编号引用，编号先登记进 `registry.md` 再使用。
- 引用上游结论时标口径：**文档口径 / 源码口径 / 实测口径**；只读文档得出的结论不许写成"已验证"。
- 「已生效」必须指名是哪个生产者状态字段或检查器回答的（R9），日志与截图不算。
- 描述缺陷时给形态不给猜测：先说"连 `tools` 键都不存在"，再说"所以像整体拒挂"。
