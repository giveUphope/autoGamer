# 迁移文档导航（从这里进）

> 这一页只解决一个问题：**你现在这件事该读哪份、读到哪、哪些别当真。**
> 体量数字是 `scripts/check_doc_registry.py` / 尺子实测出来的，不是估的。

## 一、按你要做的事找入口

| 你要做的事 | 先读 | 再读 | 大概 |
|---|---|---|---|
| 第一次进这个项目，想知道它要变成什么 | 本页 § 二 | `todo.md` 第一、二节 | 5 分钟 |
| 改 `plugins/autogamer-device` 的任何代码 | `plugin-contract-rules.md`（R2、R6-R15） | `todo.md` 的 S 段对应条 | 10 分钟 |
| 改 `*.patch.yml` 或 preset 声明 | `plugin-contract-rules.md` R2-R8 | `registry.md` 查编号 | 5 分钟 |
| 判断「我这次改动到底生效没有」 | `plugin-contract-rules.md` R9 + R7 | `todo.md` 顶部「当前状态」 | 3 分钟 |
| 想知道某个编号（`G30` / `R13` / `D7`）是什么 | `registry.md` | 定义所在文档 | 1 分钟 |
| 看不懂某个词（realm、parking、PTC、熔断） | `glossary.md` | — | 1 分钟 |
| 要动 py 侧（驱动、action server、诊断栈） | `todo.md` D8/D9 + 第五节「一期改造登记」 | `inventory/02`、`inventory/03` 的相关段 | 按需 |
| 做 UI（toolview、卡片、录屏展示） | `plugin-contract-rules.md` R18 | `inventory/05` | 10 分钟 |
| 怀疑某个能力要丢了 | `feature-inventory.md` | `inventory/0N` 明细 | 按需 |

## 二、这个项目现在在做什么（三句话）

1. 整个 ARTEMIS 正在收缩成**一个 DSH 插件** `autogamer-device` + 若干 skills：队列、调度、UI、审批、记忆全部交给宿主，插件只提供设备执行工具与设备资源治理（D1、D9、D10）。
2. py 侧的动作面与驱动栈**原样复用**，不重写；旧 py 智能栈（langgraph 多 agent）由「单层执行路由 S11」替代（D8、D14）。
3. 当前卡在 **G30**：工具注册成功但没进 agent 的工具面。守则 R8 给了形态判据（连 `tools` 键都没有 = 整个 preset 被拒挂），头号候选是 `inject` 里的服务在该 realm 不可解析。

## 三、文档清单与可信度

| 文档 | 体量（实测） | 定位 | 可信度口径 |
|---|---|---|---|
| `docs/todo.md` | 177 行 / 34.9 KB | **方案本体与进度**（活文档，完成即删，历史查 git）；顶部第一节就是「当前状态」 | 现行权威 |
| `registry.md` | 141 行 / 10.1 KB | **编号唯一权威**：D17 / S11 / G34 / R19 一览 + 冲突登记 | 现行权威，`scripts/check_doc_registry.py` 守着 |
| `glossary.md` | 88 行 / 8.4 KB | 术语翻译表（含 `inject` 的两个意思） | 现行权威 |
| `plugin-contract-rules.md` | 166 行 / 19.6 KB | **守则 R1-R19**：每条带出处与判据 | 现行权威；与 todo 冲突时以守则为准并回改 todo |
| `upstream-plugin-forms.md` | 66 行 / 11.7 KB | 上游插件形态第一轮调研（结论已提炼进守则） | 现行，含两处**已撤回**的归因（别引用它们） |
| `dsh-verification.md` | 218 行 / 37.0 KB | rc.2 的 48 项假设核实报告 | **混合口径**：README / CLI 类证据可用；37 处包内代码行引用属 asar 旧口径，沿用前须按声明面重验（D15） |
| `feature-inventory.md` | 108 行 / 13.8 KB | 防丢失盘点索引 | 现行；设备与智能栈部分是上游 canonical 契约 |
| `inventory/01`…`05` | 约 1400 行 / 215 KB | 盘点明细，几乎全是表格 | **内容可用，编号不可引用**：其 `**Gn · …**` 与现行 G 编号撞车（冲突表见 registry，警示行已加进每份文件顶部） |
| `upstream-rethink.md` | 51 行 / 5.4 KB | 为什么基线选 google/artemis 上游 | 现行 |
| `../plugins/autogamer-device/README.md` | 77 行 / 4.9 KB | 插件包自己的说明：入口、三层引入流、契约要点、债务表 | 现行（2026-10-10 重写，旧版那条指向 `headless-spike.patch.yml` 的安装说明已废） |
| `../../AGENTS.md` | 137 行 / 9.3 KB | agent 作业说明：文档地图、命令、门禁 | 现行 |

> 体量口径：**行数**按 `\n` 计数，**KB** 按文件真实字节数除以 1024（中文在 UTF-8 下占 3 字节，所以「字符数」与「字节数」差得很远——本页早期版本混过这两个口径，现已全部重测）。

## 四、明确「别当真」的四处

1. **`artemis/agents/**.md`**（flash_runner、outputter、video_analyzer、step_capsule 等 prompt 文档）：属 D8「langgraph 智能栈不迁移」的一侧。它们是现行 py 代码的说明，读到别当成插件轨道的目标形态。
2. **`docs/research/vue3-arco-migration-research.md`**（297 行）：旧控制台（Vue3 + Arco）迁移研究。旧控制台按 D9 是**原地只读保留**，这份研究不再是路线。
3. **`apps/showcase_ui_v2/README.md`**（400 行）：控制台自身的开发说明，有效，但只管"只读保留"的那部分。
4. **`playground/backend_manager` 的 docker 材料**：不是本工程依赖（历史裁定「先不动」），别再调查或提清理。

## 五、改文档的规则（防止债务复发）

- 新增编号（D/S/G/R）**先登记进 `registry.md`**，否则 `scripts/check_doc_registry.py` 直接报悬空。
- 新增 markdown 表格文档，要把路径加进 `scripts/check_doc_tables.py` 的 `DEFAULTS`，并跑 `--selftest` 证明尺子仍能报警。
- 活文档只留现行结论：已完成条目删掉，证据进 git；不要把已关闭项压成一句括号（那正是 14 个悬空引用的成因）。
- 上游一手资料的取用配方与位置记在 `AGENTS.md` 的插件轨道一节；不要在本目录复制一份。
