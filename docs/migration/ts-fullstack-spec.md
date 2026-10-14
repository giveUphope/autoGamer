# TS 全栈终态规格：上游 ARTEMIS 能力收敛为 DSH 插件

> 本文件是决策 **D19**（TS 全栈、py 归零）与 **D20**（溯源归零、不保留上游内容；`LICENSE` 为本项目自撰 MIT）的展开规格。
> 本分支的编号与开放项看 [`../TODO.md`](../TODO.md)；归档分支 `legacy-fork-v2-dsh-plugin` 持有旧 fork 的全部实现与调研台账（`registry` / `CHANGELOGS` / `inventory`），本分支不携带。
> 状态：**2026-10-14 立项（方案，未开工）**。每期开工前按守则 **R22** 先在 `../TODO.md` §七 落自足条目，方案提交早于实现提交。
> 本文件不写体量与行数（体量属派生事实，一律由脚本生成，不手抄）。

## 一、终态定义（Done 的判据）

D19/D20 的终态是**五条同时成立**，缺一条不算收敛：

1. **仓库 py 归零**：`artemis/`、`mcp_server/`、`third_party/`、`pyproject.toml`、`uv.lock` 与 py 测试树全部从本仓库删除；CI 不再有 python job 或 py 依赖安装步骤。可复跑的判据是 `git ls-files '*.py'` 为空。
2. **TS 全栈**：`plugins/dsh-autogamer/` 是唯一实现面。设备执行、效果判定、图像/OCR、轨迹读取、诊断全部在 TS 侧完成，不再依赖任何常驻外部进程。
3. **外部 ARTEMIS 降为可选提供方**：仓库**不内置、不 vendored、不为它开开发依赖**。仅保留 adapter 能显式指向一个**用户自行安装的外部 ARTEMIS**（MCP 后端，走现有 `artemisMcpCommand` + `artemisRepoPath` 路径）；未配置即走 TS 原生。
4. **能力不丢**：§二 矩阵每一行都必须有 TS 落点与判据；任何被判定不迁移的能力，必须在**本分支**留下明确的放弃记录（结案条目；本分支首次结案时新建 `docs/CHANGELOGS.md`），不允许静默消失。
5. **溯源归零（D20）**：仓库不留存任何来自上游的信息——代码、prompt 文本、vendored 树、派生文档、copyright 头、指向上游的 git 元数据；`LICENSE` 为本项目自撰的 MIT 文本（版权人 giveUphope），非上游文本。判据见 §八。

> 解释口径：用户 2026-10-14 定稿「py 库可以引入、artemis 库可以引入，但不能作为主要技术栈，只能作为模块引入」，与「py 归零」合读 = **仓库内不再承载 py 实现，py 只可能以外部依赖形式被显式接入**。这是 §一.3 的来处。
> 同日追加（**D20**）：「最终不再留存除 license 以外的信息，包括代码，相当于本项目仅从该项目获取灵感后重新实现」——这是 §一.5 的来处，也是 §八 的全文。

## 二、能力迁移矩阵

上游 ARTEMIS 的能力按「现载体 → TS 落点 → 判据」逐行列清。状态列只写三态：**已具备**（TS 侧已在跑）／**部分**（TS 有骨架但契约未对齐）／**未开工**。

> **读表前提（重要）**：本表的「TS 落点」与状态列描述的是**归档分支 `legacy-fork-v2-dsh-plugin` 里已有的资产**——
> 它们**尚未搬到本分支**（搬迁是 §流程 的开放项）。所以「已具备／部分」说的是**归档里有**，不是「本分支里能 import」。

| 能力（上游面） | 现载体 | TS 落点 | 判据 | 状态 |
|---|---|---|---|---|
| 设备动作 15 工具（tap / swipe / input / launch / …） | py `adb_server.py` | adb CLI + on-device 协议客户端（自实现） | 与 `tests/fixtures/py-action-tools.json` 工具面逐字同名同参 | 部分（`ActionClient` 仅为 MCP 转发） |
| 截图 | py 动作面 | `adb exec-out screencap -p` | 同设备同帧的 PNG IHDR 尺寸等于帧空间（已验 1600x900） | 已具备（`coord.ts` 取源路径已验） |
| UI 层级 dump | py `uiautomator2` 客户端 | `adb shell uiautomator dump` + 自解析 | 节点集与 py 面一致、`parsed_bounds` 齐备、扁平语义保留 | 部分（`hierarchy.ts` 有骨架，契约未测） |
| 动作执行闸门 / 熔断 / 分类 | 插件 TS | — | 现有 spec 锁 | 已具备 |
| 效果判定 `compare_ui_frames` | py 委托上游 `check_ui_change` | TS 差分（dHash 类） | 同一 before/after 对判 red/green 与 py 一致 | 未开工 |
| OCR | py `httpx` → Google Vision | TS `fetch` | 同图同密钥返回同一文本集与坐标 | 未开工 |
| 画面标注 overlay | py `PIL` / `cv2` | sharp（libvips） | 标注元素集与 py 一致 | 未开工 |
| 任务编排 `run_task` / `manage_task` / `inspect_trace` | py 引擎（langgraph 图） | TS 单层路由（S11）+ DSH agent loop | 三条工具不再调 `mobile_*`；任务由 TS 侧循环驱动 `run_device_action` | 未开工 |
| 诊断 `diagnose` | py `core.diagnostics` | TS 探针 | 就绪七项同判 | 部分（`preflight.ts` 已有七项骨架） |
| 轨迹 / 步骤持久化 | py `data_engine`（SQLite） | DSH session log（首选）或 better-sqlite3 | 回放同一步集 | 未开工 |
| rules 注入 | `<repo>/mcp_server/rules.md` | 插件内固定文本或外部文件 | 注入内容非空且可达模型 | 部分（`rulesInjector.ts` 已在，供应链随 T4 改） |
| 录屏 / 视频分析 | py ffmpeg 系 | 不迁移（D12：一期无录像） | 放弃记录进本分支 CHANGELOGS（待新建） | 已砍 |
| notes / plan 语法 | py `utils` | TS 状态机（checker 用） | 计划与检查项语义等价 | 未开工 |

## 三、分期（顺序不可跳）

**T1 · 引擎去消费者**（对应 **G82**）
- What：把 `autogamer_run_task` / `autogamer_manage_task` / `autogamer_inspect_trace` 从「调 py `mobile_*`」改为 **TS 侧编排**：S11 路由循环驱动 `run_device_action`，任务状态落 DSH session，不再 spawn py 进程。
- How：复用已有 TS 资产（`runDeviceAction.ts` 路由、`validatorLadder`、`incidents`、`turnLedger`、`observations`）；补齐「跨回合任务状态」的 TS 载体（先查 DSH 原生 storage / session 投影，按 R20 取一手口径，不自建容器）。
- Verify：三条工具不再出现 `mobile_` 调用（grep + 契约锁）；新会话真机跑一条完整任务，`report_task_status` 终态双轴正确。
- Done：py 引擎在插件侧**无任何消费者**（可达性检查为空）。

**T2 · 动作面 TS 化**（对应 **G83**）
- What：15 工具动作面 TS 原生实现（adb CLI + on-device 协议），替换 py `adb_server.py`。
- How：先按 §四 实测 wire 契约；逐条对照 py 面行为（**同一输入同一输出**），fixture 复用现有 `py-action-tools.json` 作为逐字判据。
- Verify：工具面 fixture 全等；真机逐工具一次成功判定（用现成 `scripts/spike-mcp.mjs` 的对照方式）；坐标/层级/截图三条金标准复测。
- Done：`artemis mcp --type adb` 不再是任何路径的运行时依赖；15 工具全在 TS 侧可跑。

**T3 · 图像与 OCR TS 化**（对应 **G84**）
- What：`compare_ui_frames` 差分、OCR 调用、overlay 标注落 TS。
- How：差分算法从 py 侧读设计（阈值与算法即设计事实，属「无思路时从上游取设计」的典型）；OCR 是 HTTP 调用，直译。
- Verify：同 before/after 对、同图，TS 与 py 判定一致（对照表留档）；`runDeviceAction` 的效果确认路径不再经 py。
- Done：效果判定与 OCR 无 py 依赖。

**T4 · 收尾删 py 与溯源清理**（对应 **G85** 与 **G86**）
- What：删除 py 树、清 py 依赖与 CI、更新全部文档口径（`AGENTS.md` 命令表、`README.md` 导览、`../TODO.md` 基线节）；同时执行 §八 的溯源清理（G86）。
- How：按目录分批删，每批后跑插件全套 + R6；`docs/` 里的 py 引用要么改指向 TS，要么标注为历史；溯源清理的逐项处置见 §八 表。
- Verify：`git ls-files '*.py'` 为空；CI 无 python job；插件 tsc + vitest 全绿；R6 rc 0；R7 新会话活体验证；§八 的判据命令（`git grep -l 'Google LLC'` 为空等）逐条通过。
- Done：§一 **五条**全部成立。

## 四、必须先实测的契约边界（动 T2/T3 之前）

按守则 **R25**（先读机制文档、一次只测一个变量）逐项取证，任一项未测不许开工对应期：

1. **uiautomator dump 的真 wire 形态**：`adb shell uiautomator dump` 输出到设备的 XML 是什么形状，与 py 解析后的扁平列表如何对应（py 侧已知为扁平、无 `children`）。
2. **helper（accessibility APK）服务协议**：端口、握手、请求/响应格式、`adb forward` 生命周期（与 **G78** 的残留问题同源）。
3. **`compare_ui_frames` 的算法与阈值**：py 委托的 `check_ui_change` 判据是什么，阈值取多少。
4. **外部提供方接入的边界**：`artemisMcpCommand` / `artemisRepoPath` 在 T1–T3 期间仍可用，T4 后它的语义只剩「可选外部 ARTEMIS」。

## 五、风险与不做项

- **回归面是主要风险，不是技术可行性**：py 引擎有数百条测试与真机实战记录，TS 侧重写要重新挣这些行为。已有的语义锁（动作效果判定、错误分类、`run_outcome` 双轴）是有用地基，但不是全覆盖。
- **衍生作品风险（D20 相关）**：重实现时最容易被忽略的一条——「读代码照着写」会把上游文本带进来。§八 的「只借鉴设计、不搬运文本」是硬约束，T1–T3 全程适用，不能等到 T4 才想起来。
- **真机强依赖**：T2/T3 的验收必须有设备在场（T1/T4 可离线推进）。
- **中间态共存**：T1 完成前不得动 T2，否则 py 动作面与 TS 动作面同时被两条链消费，契约漂移无人看守。
- **不做**：视频分析（D12）、旧控制台、把 py 以「可选运行时」名义反装回仓库、在迁移期并行维护两套任务编排。

## 六、与既有编号的关系（不另立新语义）

- **D19 收紧 D18**：D18 的「py 仅在特定库成熟度高于 TS 同类库时保留」在终态下**不成立**——已实测该例外不适用：`langchain` 出现在 54 个 py 文件而 DSH 宿主本就提供 LLM 绑定；OCR 只是 HTTP 调用；`cv2`/`PIL` 有成熟 TS 同类；`uiautomator2` 是 on-device 协议的客户端。D18 保留为演进过程记录，D19 是终态。
- **D8 / D13 / D14 的对应**：D8「langgraph 智能栈不迁移」由 T1 落实（不是新设计，是把已声明的做法做完）；D13「helper 二期 TS 复刻」归入 T2/T3；D14/S11 是 T1 的设计依据。
- **S5 的退化**：S5 原写「原样复用 py action server」。D19 下它退化为**迁移期过渡**，主体由 TS 原生执行面取代；外部 ARTEMIS 若被配置，它就是「可选外部提供方」。
- **G72 / G74 / G78 的终局**：G72（提供方形状）在 T4 消解——不再需要仓内提供方；G74（映射层按 5 工具面锁形状）在 T2 重锁为 TS 原生契约；G78（`adb forward` 残留）由 §四.2 的生命周期设计一并处置。
- **G81 并行**：spec 类型检查是 TS 侧独立债，与本期并行，不构成前置。
- **D20 与 §一.5 / G86**：D20 是**独立于 D19 的一根轴**——D19 管「用什么语言实现」，D20 管「内容从哪来、留什么」。两者同期收尾（T4），但判据互不替代：py 删干净 ≠ 溯源清干净（copyright 头、vendored 第三方、派生文档、文案措辞、git 元数据都可能残留）。
- **D1 的边界不变**：D1「方案基线 = google/artemis 上游」指的是**设计灵感来源**，与 D20 的「不留存上游内容」不冲突；D20 正是把这条说清楚——借鉴设计，不保留内容。

## 七、判据与门禁

- 每期收尾：插件 `tsc` + `vitest` 全绿；改过 patch 跑 **R6**（`--dump-config` rc 0 且无 `unmatched`）；**R7** 开新会话验证；判「生效」只认 **R9** 的官方检查器。
- T2/T3 的对照判据是**同一输入同一输出**，不是「都能跑」：对照结果必须留档（可复跑命令 + 实测输出）。
- T4 的终态判据按 §一 **五条**逐条勾，且每条都要给出可复跑命令，不许用「CI 会保证」代替。

## 八、溯源与许可：LICENSE 为本项目自撰 MIT（D20）

**要求（用户 2026-10-14 定）**：本仓库虽从 `google/artemis` fork 而来，终态**不留存任何来自上游的信息，包括代码**——即本项目仅从上游获取灵感后独立重实现；`LICENSE` 重写为本项目自撰的 MIT 许可证（版权人 giveUphope，2026），保持开源。

**法律边界（实测，非推测）**：

- **本分支根 `LICENSE` 为本项目自撰 MIT 全文**（版权人 giveUphope，2026）——不随迁任何上游许可证文本；MIT 义务只随本项目自己的版权声明与许可声明走。
- **归档分支现状（历史，本分支不携带）**：旧 fork 根 `LICENSE` 为 Apache-2.0 全文（附录含 `Copyright 2026 Google LLC`），另有一份第三方许可 `third_party/mobile_use/LICENSE` + `NOTICE`——vendored 树来自另一个上游（凭 33 处 `minitap` 标记与 29 处 `originally from` 判定）。这些义务随归档分支而止，不波及本分支。
- 许可证的义务只随「保留的派生作品」走；本分支不保留任何上游派生内容，即不承继上游作品的义务——**前提是确实没有保留任何派生内容**（下述判据机械核对）。
- **推论（本规格的硬约束）**：TS 重实现必须**只借鉴设计，不搬运文本**。设计（算法、阈值、状态机、契约形状）可自由研读并照语义重写；**prompt 正文、注释、文档段落不得逐字照抄**——逐字照抄等于保留派生内容，与 D20 冲突。这条约束**贯穿 T1–T3**，不是收尾才做的事。

**清理面（2026-10-14 实测现状，**描述归档分支**）**：
（本分支通过「不随迁」已满足其中大部分——py 树、vendored 第三方、上游派生文档都没搬过来；
下表保留作归档分支的清理依据与「搬迁插件时逐文件核对」的检查清单。）

| 面 | 现状 | 处置 |
|---|---|---|
| py 代码 | 281 文件（`artemis` 218 / `third_party` 40 / `mcp_server` 23 等） | T4 删（**G85**） |
| copyright 头 | 319 个被跟踪文件带 `Google LLC` 字样（其中 `docs` 3、`scripts` 1、`tests` 30、`Makefile`/`pyproject` 各 1） | 随文件删或逐面清理（**G86**） |
| vendored 第三方 | `third_party/mobile_use/`（自带 `LICENSE` 与 `NOTICE`） | T4 删（**G86**） |
| 上游派生文档 | `docs/research/*`、`docs/migration/inventory/*`（旧代码盘点）、`artemis/agents/*.md`（prompt 正文） | 删或标注为历史；**不得作为本项目实现依据**（**G86**） |
| 致谢 / 命名文案 | `README`、插件 `README` 的「致谢 ARTEMIS」、包描述 | 按 D20 改写为「灵感来源」措辞，不写「基于」（**G86**） |
| git 元数据 | 历史含全部上游内容；`upstream` remote 已删 | **已裁定**：历史保留（仅作记录、不影响新实现）；remote 只剩 `origin`（见下） |

**判据（可复跑）**：`git ls-files '*.py'` 为空；`git grep -l 'Google LLC' -- ':!docs'` 为空；`git grep -l 'Apache License' -- ':!docs'` 为空（根 `LICENSE` 为 MIT，自身不含该串；`docs/` 是台账，允许出现归档描述与判据命令本身）；`third_party/` 目录不存在；`git remote -v` 不含 `upstream`；根 `LICENSE` 为 MIT 文本（头部可见 `MIT License` 与 `Copyright (c) 2026 giveUphope`）；无逐字搬运的上游文本（人工复核 + prompt 文本自写）。

**两个由用户裁定的问题（2026-10-14 定案）**：

1. **[已裁定] git 历史保留（原三选一中的 a）**：工作树清干净，**历史中的上游内容仅作记录存在、不影响当前新方案设计与实现**；不重写历史、不新建仓库。因此 D20 的判据明确只覆盖**工作树层**，历史作为事实记录保留。
2. **[已裁定] `upstream` remote 已移除**：并设 `remote.pushDefault=origin`，另加版本化 `pre-push` 护栏
   （白名单只放 `origin`）——起因是一条跨库 PR 误开到了上游，处置与判据见 `../TODO.md` §零。

**许可物**：本项目自撰 `LICENSE`（MIT 全文，版权人 giveUphope，2026）。MIT 不要求 `NOTICE` 文件，故本分支不另设 `NOTICE`。

> **[已裁定 2026-10-14] LICENSE 措辞**：不保留 Apache-2.0 文本及其附录的 `Copyright 2026 Google LLC` 行——
> 根 `LICENSE` 重写为本项目自撰 MIT 全文（版权人 giveUphope，2026），保持开源；与 `google/artemis`
> 无代码关系、仅受其设计启发这一事实已在 README / AGENTS / 本规格中说明，不另设 NOTICE。

## 九、资产复用映射（2026-10-14 清点，目的：避免从零实现）

**一句话结论**：不必从零——归档分支 `legacy-fork-v2-dsh-plugin` 里的 **TS 资产可近乎整体搬用**（实测零上游痕迹）。

### v2 · 可搬走的（productive 来源）

| 资产 | 规模（实测） | D20 判定 | 处置 |
|---|---|---|---|
| `plugins/dsh-autogamer/src/**` | 27 文件 / 4506 行 | **零上游痕迹**：`Google LLC` / `derived from` / `originally from` / `minitap` / `Copyright` 在整棵插件树里**均为 0** | **直接搬** |
| `plugins/dsh-autogamer/tests/**` | 35 文件 / 4896 行（内含 **33 个 spec**） | 同一目录树，同上 | **直接搬** |
| `plugins/dsh-autogamer/scripts/**` + `spike/**` | 6 文件 / 555 行 | 同上 | 搬（spike 装置按需保留） |
| `tests/fixtures/py-action-tools.json` | 动作面契约夹具 | 我方观测产物 | 搬 —— T2「同一输入同一输出」的判据 |
| `docs/migration/*` 调研台账 | — | 我方记录 | **只读作设计参考**，正文不进新实现 |
| py 全树（281 文件 ≈70k 行）+ vendored `third_party` | — | 318 个文件带上游版权头 | **不搬**；T2/T3 期间**只读设计** |

**33 个 spec 就是已固化的语义**——新实现按这些语义重写、不抄文本。代表性文件（按能力分组）：
动作效果判定 `validatorLadder.spec.ts`｜错误分类 `classify.spec.ts`｜熔断 `breaker.spec.ts` + `breakerGuard.spec.ts`｜
闸门与并发 `gate.spec.ts` + `devicePool.spec.ts` + `deviceKey.spec.ts`｜去重 `dedup.spec.ts`｜坐标 `coord.spec.ts`｜
层级句柄 `hierarchy.spec.ts` + `liveObservation.spec.ts`｜路由错误 `router-errors.spec.ts`｜
终态与追问 `runTask.spec.ts` + `followup.spec.ts`｜宿主契约 `contracts.spec.ts` + `runtimeBoot.spec.ts` + `scopeVisibility.spec.ts`｜
交付形状 `deliveryShape.spec.ts`｜预检 `preflight.spec.ts`｜诊断 `diagnose.spec.ts`。

### v1（`legacy-fork-v1`）· 无实质复用价值，只作设计底本

- **形态**：上游 `google/artemis` + 该 fork 的少量改动（台账记「92 commits ahead」，核心 `artemis/` 基本未改）。
- **上游派生面**：596 个文件带 `Google LLC`、`originally from` 32、`minitap` 35 —— 大面积派生内容。
- **fork 自研部分** = 旧控制台队列 + `showcase_ui_v2` + 迁移文档 —— 控制台按 **D9/D10** 已废弃。
- **设备动作设计**（可读、不可搬）：**shell 调 adb**（`input tap/swipe`；文本走剪贴板注入；层级用 UIAutomator2 客户端）；
  契约定义在 `artemis/mcp/{action_specs,action_types,action_manifest}.py`。T2 读它作设计来源。
- **结论：否**。

### 由此确定的两条动作

1. **搬迁顺序**：先整块搬 TS 树，再**逐文件过 D20**（按实测预期零改动；仅插件 README 措辞要从「基于 ARTEMIS」改成「灵感来源」）。
2. **本分支现状**：TS 资产**一个都还没搬**（`plugins/` 尚不存在）——这是 §流程「新分支特有」的第一条开放项。
