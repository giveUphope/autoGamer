# AGENTS.md

Instructions for agents working in this repository.

## What this is

**ARTEMIS 的后继实现**：从 `google/artemis` 只取**设计灵感**、独立重实现的 **DSH（DeepSeek Harness）插件**。
本仓库**不是**上游代码的延续——按 **D20**，不保留任何上游内容；`LICENSE` 为本项目自撰的 MIT 许可（版权人 giveUphope，2026）。旧 fork 的两版尝试都在归档分支里：
**`legacy-fork-v2-dsh-plugin`**（第二次尝试：收缩为 DSH 插件形态，含全部历史实现与调研台账）与
**`legacy-fork-v1`**（初版二开，未达效果）。本分支（**`main`**）从零重建。

**终态**：TS 全栈、py 归零（**D19**）。判据与四期路线见 `docs/migration/ts-fullstack-spec.md`。

## 两条终态决议（现行，优先于一切历史约定）

| 编号 | 内容 | 出处 |
|---|---|---|
| D19 | **TS 全栈、py 归零**：仓库内不承载任何 py 实现；外部 ARTEMIS 只保留为**可选提供方**，不内置、不 vendored | 规格 §一 |
| D20 | **溯源终态 = 不保留上游内容**（`LICENSE` 为本项目自撰 MIT，版权人 giveUphope）；**硬约束：只借鉴设计、不搬运文本**（prompt 正文 / 注释 / 文档段落逐字照抄 = 保留派生内容，违规） | 规格 §八 |

> 编号（D / S / G / R）在本分支的权威是 **`docs/TODO.md`**（归档分支的 `registry.md` 是历史）。

## 硬规则（新实现直接适用）

完整守则（R1–R28，逐条带官方出处与判据）在 `docs/migration/plugin-contract-rules.md`；以下是动手时最常撞上的：

- **R1** 契约取证只走声明面；**禁止解包 `app.asar`**
- **R2 / R3** preset 只能由 bundle 补丁承载；**禁**手写 profile 目录内文件、禁在 profile 目录跑包管理
- **R6** 改过任何 `*.patch.yml`，必跑 `--dump-config` 自检：退出码 0 且输出 grep 不到 `unmatched`
- **R7** 声明**只影响之后创建的 Agent** ⇒ 复验必须**开新会话**
- **R9** 判「生效」只认**官方检查器**，不认日志 / 进程列表 / `plugin list` / wire 反推
- **R12 / R13** 写 config 前先查 schema；扩展点「够用即最弱」，**策略不许内建进工具正文**
- **R14 / R15** 工具要声明并发安全属性；`timeoutMs` **不被执行**，超时须自实现并观测取消信号
- **R16** 不许自写会话事件类型
- **R17** `inject` 不唤醒、`followup` 才唤醒
- **R18** UI 只进 slot；不 import 宿主 Client 包
- **R19** 授权类动作（批准调用 / 回答提问 / 放宽策略）**永远 user-only**；命名与展示元信息是义务
- **R20** 遇宿主行为问题**先查官方一手资料**再动手，不许先写猜测实现
- **R22** 三步序：**查文档 → 写方案 → 才写码**；方案提交必须早于实现提交
- **R24** 判「某事没发生」**只认会话日志**（wire 看不到终结回合的最后一次工具调用）
- **R25** 定根因先读机制文档、**一次只测一个变量**；推荐方案前先核它是否已是现状
- **R27** 判据必须经**变异校验**证明它会红，否则不许当验收
- **R28** 实测 / 调研结论**当轮回写台账**；被推翻的旧表述不许静默保留

## 新环境拉取（fresh clone / 切分支）

- **拉取或切分支后先跑环境检测**：`node scripts/check-env.mjs`（零依赖，只用 Node 内置模块，可在装插件依赖之前跑）。
  它机械检测 D19 环境面：
  - **H1（硬失败）**：被 git 跟踪的 `.py`（`git ls-files '*.py'`）；
  - **H2（失败）**：工作树里的 py 栈残留（`.venv/`、`__pycache__/`、`*.pyc`/`*.pyo`、`.pytest_cache`/`.ruff_cache`、
    `*.egg-info`、`pyproject.toml`/`uv.lock`/`setup.py`/`requirements*.txt` 等）；
  - **NOTE（仅提示）**：运行数据/临时区（`traces/`、`scratch/`、`data_engine.db`、`.artemis_*`）。
  `node_modules/`、`dist/`、`.git/` 是白名单，绝不误报。退出码：0 干净（或仅 NOTE），1 有 H1/H2。
- **为什么需要**：切到 orphan `main` 时 git 只删被跟踪源码，被 `.gitignore` 忽略的旧栈（`.venv`、`__pycache__`、
  旧 `node_modules`、`traces`）会留在磁盘且 `git status` 完全干净；本脚本把这种隐性残留变成红/绿。
  脚本只报告、不删除；清理可用其输出给出的 `git clean -ndX`（预览）/`git clean -fdX`（执行，注意会删 `.env`）。
- **钩子（版本化于 `.githooks/`，每台机器激活一次 `git config core.hooksPath .githooks`）**：
  `post-checkout` / `post-merge` 在切分支/拉取后自动跑检测，**只警告不阻断**；`pre-push` 在远端白名单之外再
  硬拦 H1（被跟踪 py 拒绝推送）。

## 命令（TS 侧）

- 插件工程在 `plugins/dsh-autogamer/`（已从归档分支搬迁，2026-10-14；`node scripts/check-env.mjs` 是仓库级检测，与插件无关）
- 本机装依赖与跑脚本**要带旗标**（不带时 pnpm 会隐式 install 并重写 lockfile——那是环境产物，别提交）：
  `pnpm --config.verify-deps-before-run=false install --frozen-lockfile --config.autoInstallPeers=false`、
  `pnpm --config.verify-deps-before-run=false run build|test`
- **设置的家在 `plugins/dsh-autogamer/pnpm-workspace.yaml`**（`allowBuilds` / `autoInstallPeers` / `pmOnFail` 都在那儿，pnpm 11 起只有 auth 与 registry 从 `.npmrc` 读——那条 `.npmrc` 已删，别再加回来）。
  设错地方的后果不是「不生效」而是**一条最朴素的命令变红**：lockfile 记着 `autoInstallPeers: false` 而有效默认是 `true` 时，裸 `pnpm install --frozen-lockfile` 会 exit 1（`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`）。出处见 CHANGELOGS #100。
- **依赖的构建脚本策略**写在 `plugins/dsh-autogamer/pnpm-workspace.yaml` 的 `allowBuilds`：`esbuild: true`（vitest 要它的原生二进制）、
  `tesseract.js: false`（其 `postinstall` 只是赞助横幅、无产物）。若安装报 `ERR_PNPM_IGNORED_BUILDS` 并非零退出，
  **先看这一行**，不要直接 `pnpm approve-builds`——那条会把构建脚本放行，且 pnpm 会顺手改写被跟踪的 `pnpm-workspace.yaml`。出处见 CHANGELOGS #98。
- **包管理器版本已钉**：`plugins/dsh-autogamer/package.json` 的 `"packageManager": "pnpm@11.21.0"`（精确版本，不带 hash）
  ＋ 同目录 `pnpm-workspace.yaml` 的 `pmOnFail: error`。**版本不符 ⇒ 每条 pnpm 命令直接 exit 1**（报 `This project is configured to use … of pnpm`），
  这不是故障，是设计：不同 pnpm 对「构建脚本被拦截」的处理不同（有的 exit 1、有的只告警），**宁可响不可悄悄不同**。
  - 临时绕过（单次、不改仓库）：`--pm-on-fail=ignore` 或 `warn`；**正解**是先升级本机 pnpm，或按下面的流程改钉。
  - **升版流程（人决定）**：改 `packageManager` 的版本号 → 同一次提交里跑一遍 `install` + `verify` → 在 `docs/TODO.md` §七 与 CHANGELOGS 记明依据；顺带复核 #98 的构建脚本策略在新版本上是否仍被支持（pnpm 换掉 `pmOnFail`/`allowBuilds` 键名时会静默失效）。
  - **边界**：钉在插件工程（全仓唯一的 `package.json`，也是所有文档命令的工作目录）；**从仓库根跑 pnpm 不受本钉约束**（根无 manifest，那也不是文档化的用法）。
  - 出处见 CHANGELOGS #99。
- 声明面自检：`dsh --profile <name> --patch <abs path> --dump-config`（`dsh` 取 PATH，**不要写死安装盘符**）
- `dsh plugin` 只是包管理转发垫片，只证明「装了」，**不证明「生效」**（R9）
- **文档门禁（TS 版，2026-10-14 落地，基建-2）**：`node scripts/check-docs.mjs` —— 六条机械检查（结清一致性 / 链接可解析 /
  派生计数只认权威 / 编号范围自算 / 表格成形（只在未转义 `|` 处切分）/ 自称完成不得留未勾验收项）；`--selftest` 内置变异自证不假绿
  （**变异锚点必须落在文档结构上——章节标题、表格分隔行——绝不在正文文字上**：散文会被实测改动重写，锚点一腐烂，判据就静默失效，本分支已因此两次 BLIND）。
  **触发**：版本化 `.githooks/pre-commit`，暂存路径命中 `docs/**`、`AGENTS.md`、`README.md` 时跑门禁，命中前者或 `scripts/check-docs.mjs` 时**再跑 `--selftest`**（87ms），失败即拒绝提交；
  逃生口 `git commit --no-verify` 属**故意行为**，须在台账写明理由。**本分支无 CI** ⇒ 门禁是本地钩子 + 手跑，**不许写成「由 CI 保证」**（R27）。
  新克隆/新机器仍要一次性 `git config core.hooksPath .githooks` 激活全部钩子。

## 远端与 PR 纪律

- **只有一个 remote：`origin`**（本项目自己的仓库），且 `remote.pushDefault=origin` —— 裸 `git push` 只走它。
  **不得**添加指向第三方上游（如 `google/artemis`）且带 push 地址的 remote；本项目产出只留在 `origin`。
- **机械护栏（已装，版本化）**：`.githooks/pre-push` + `core.hooksPath=.githooks` —— 非白名单远端**拒绝更新任何 ref**。
  白名单 = `giveUphope/autoGamer`。**新克隆/新机器要重装一次**：`git config core.hooksPath .githooks`。
  检验法（A/B，已实测）：对一个本地一次性 bare 仓库推送**被拦**（exit 1），加 `--no-verify` 才通过
  —— 能对照出「是钩子拦的」，不是别的什么在拦。
  **已知边界（别当它万能）**：git 在**连上远端并列出 ref 之后**才跑 `pre-push`（要更新的 ref 走 stdin），
  所以它挡的是「推送」而非「连接」；对**不可达**目标的推送会在连接阶段就失败，因此看不到钩子的消息。
  **PR 的创建本身不在任何本地钩子的覆盖范围内** —— 它只能靠上面的规则与正确判据把关。
  该 hook 现含**两道检查**：①远端白名单（非白名单拒推）；② **H1 / D19**：白名单通过后，若 `git ls-files '*.py'`
  非空（py 被跟踪）仍拒推。A/B 已实测（一次性本地裸仓，URL 含白名单字符串）：track 一个 py 时被 H1 拦 exit 1、
  bare 未收到；移除该 py 后推送成功 exit 0、bare 收到 main。
  逃生口 `git push --no-verify <url> <refspec>` 存在，但属**故意行为**，必须在台账里写明理由。
- **不要对任何第三方上游开 PR / 建分支 / 推内容**。若确实要读上游源码作设计参考，用只读形态：
  添加后立刻 `git remote set-url --push <name> no-push`。
- **判「有没有误开的 PR」不能用** `gh pr list --repo <本仓>` —— 它只列 **base 在本仓**的 PR，
  **看不到「从本仓发到上游」的跨库 PR**。正确判据是按 **base 仓库**列：
  `gh pr list --repo <上游仓库> --author <自己> --state all`。
  （这条是血债：曾用错判据得出「无开放 PR」，并据此论证分支改名无连带影响 —— 见 R27：判据必须证明它会红。）
- 一切 `gh` 的写操作必须**显式指定仓库**，不许依赖默认解析。（归档分支的 R26 是这条的通用形态。）

## 文档纪律

- **一个派生事实只有一个权威**：编号范围与计数 → `docs/TODO.md`；进度与阻塞 → `docs/TODO.md` §零；
  已结案变更 → 本分支尚无 CHANGELOGS 文件（结案时新建，规则同下）；其它地方只写**指针**，不写副本
- **方案先行**（R22）：任何非平凡改动先把自足条目写进 `docs/TODO.md`（What / How / Verify / Done 四段），
  方案提交早于实现提交；实施中每完成一个检查点**当轮**勾选并记录偏差
- **顺带发现当轮落账**：未修 → `docs/TODO.md` 差距行；已顺手修 → 结案条目

## 上游一手资料（唯一允许的补充来源）

`github.com/deepseek-ai/deepseek-harness` @ `master` —— 三个官方 skill 在
`packages/preset/agent-preset/skills/`（`cordis-plugin-development` / `editing-cordis-compositions` /
`cordis-composition-reference`），另有 `packages/preset/agent-preset{,-registry}/README.zh.md`、
`packages/bundle/web-app/presets/*.patch.yml`、`docs/cli-help.zh.md`。
**解包 `app.asar` 取证一律禁止（R1）**。

> 注意区分两个「上游」：**design 参考**是 `google/artemis`（只读设计，不搬内容，D20）；
> **宿主契约来源**是 `deepseek-ai/deepseek-harness`（可照抄其声明面确实公开的形状，如 patch 行的 `id`/`name`）。

## Environment notes

- 主开发环境 Windows；**PowerShell 5 不支持 `&&` / `||`**，链式命令用 `;`
- Conventional Commits；**不推送**，除非用户明确要求
- 授权边界：涉及权限授予、放宽策略、安装 Host 代码这类动作，**由用户决定，不代批**（R19）
