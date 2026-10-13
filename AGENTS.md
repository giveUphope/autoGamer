# AGENTS.md

Instructions for agents working in this repository.

## What this is

**ARTEMIS 的后继实现**：从 `google/artemis` 只取**设计灵感**、独立重实现的 **DSH（DeepSeek Harness）插件**。
本仓库**不是**上游代码的延续——按 **D20**，除 `LICENSE` 外不保留任何上游内容。旧 fork 的两版尝试都在归档分支里：
**`legacy-fork-v2-dsh-plugin`**（第二次尝试：收缩为 DSH 插件形态，含全部历史实现与调研台账）与
**`legacy-fork-v1`**（初版二开，未达效果）。本分支（**`main`**）从零重建。

**终态**：TS 全栈、py 归零（**D19**）。判据与四期路线见 `docs/migration/ts-fullstack-spec.md`。

## 两条终态决议（现行，优先于一切历史约定）

| 编号 | 内容 | 出处 |
|---|---|---|
| D19 | **TS 全栈、py 归零**：仓库内不承载任何 py 实现；外部 ARTEMIS 只保留为**可选提供方**，不内置、不 vendored | 规格 §一 |
| D20 | **溯源终态 = 只留 LICENSE**；**硬约束：只借鉴设计、不搬运文本**（prompt 正文 / 注释 / 文档段落逐字照抄 = 保留派生内容，违规） | 规格 §八 |

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

## 命令（TS 侧）

- 插件工程在 `plugins/dsh-autogamer/`（**尚未从归档分支搬迁**，见 `docs/TODO.md` 开放项）
- 本机装依赖与跑脚本**要带旗标**（不带时 pnpm 会隐式 install 并重写 lockfile——那是环境产物，别提交）：
  `pnpm --config.verify-deps-before-run=false install --frozen-lockfile --config.autoInstallPeers=false`、
  `pnpm --config.verify-deps-before-run=false run build|test`
- 声明面自检：`dsh --profile <name> --patch <abs path> --dump-config`（`dsh` 取 PATH，**不要写死安装盘符**）
- `dsh plugin` 只是包管理转发垫片，只证明「装了」，**不证明「生效」**（R9）
- **文档门禁暂缺**：旧 fork 的门禁脚本是 Python（`scripts/check_doc_*.py`），不随迁；本分支暂无机械门禁，
  以人工核对为准并**记债**（见 `docs/TODO.md`）。TS 版门禁是待办项。

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
