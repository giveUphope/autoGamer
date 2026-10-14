# TODO · 待办（TS 全栈重建）

> 本分支的**编号权威就是本文件**（归档分支 `legacy-fork-v2-dsh-plugin` 的 `registry.md` 是历史）。
> 规则：任何非平凡改动先在 **§流程** 落自足条目（What / How / Verify / Done 四段），
> **方案提交早于实现提交**（R22）；实施中每完成一个检查点当轮勾选并记录偏差。
> 终态定义见 [ts-fullstack-spec](migration/ts-fullstack-spec.md)。

## 零、当前状态

**分支命名（2026-10-14 整理，按用途）**

| 分支 | 用途 |
|---|---|
| `main` | **现行主线**：TS 全栈、py 归零的干净重实现（本分支） |
| `legacy-fork-v1` | 初版二开（在 fork 上二次开发），未达效果，已归档 |
| `legacy-fork-v2-dsh-plugin` | 第二次尝试：收缩为 DSH 插件形态；**参考归档**（含全部历史实现与调研台账） |

- **[已结清 2026-10-14] 远端默认分支已切到 `main`**（用户操作，实测两路读数一致：
  `gh api repos/giveUphope/autoGamer --jq .default_branch` → `main`；`git ls-remote --symref origin HEAD` → `ref: refs/heads/main`）。
  随之删掉旧名 ref `dsh-plugin-contraction`（此前删不掉：GitHub 不允许删除默认分支）。远端现在只有三个按用途命名的 ref：
  `main` / `legacy-fork-v1` / `legacy-fork-v2-dsh-plugin`。
- **搬迁与复用（2026-10-14 清点完成，结论见规格 §九「资产复用映射」）**：不必从零 —— 归档分支
  `legacy-fork-v2-dsh-plugin` 的 **TS 资产可近乎整体搬用**（实测整棵插件树零上游痕迹：`Google LLC` /
  `derived from` / `originally from` / `minitap` / `Copyright` 均为 0；src 27 文件 4506 行、tests 35 文件 4896 行
  含 33 个语义锁 spec）。`legacy-fork-v1` 只作设计底本（596 个文件带上游版权头，fork 自研部分已按 D9/D10 废弃）。
  **搬迁顺序**：先整块搬 TS 树 → 再逐文件过 D20（预期零改动，仅插件 README 的「基于 ARTEMIS」措辞要改）。
- **许可与 git 历史裁定（2026-10-14，用户裁定）**：① `LICENSE` **重写为本项目自撰 MIT 全文**（版权人 giveUphope，2026），保持开源、不再随迁上游 Apache-2.0 文本（含原 `Copyright 2026 Google LLC` 附录行）；② **git 历史保留**——历史中的上游内容仅作记录存在，不影响当前新方案设计与实现，D20 判据只覆盖工作树层。裁定展开见规格 §八。
- **阶段：未开工**。本分支为新建立的空白分支；插件工程与全部 py 实现都不在此处（前者待搬迁，后者按 D19 归零）。
- **进行中里程碑**：**D19（TS 全栈、py 归零）+ D20（溯源归零、不保留上游内容；LICENSE 为本项目自撰 MIT，版权人 giveUphope）**。
- **最先能做的两件事（离线可跑）**：§流程 的「前置-1」与「前置-3」。
- **remote 结构（2026-10-14 已裁定并执行）**：`upstream`（`github.com/google/artemis`）**已移除**；
  仅保留 `origin`（`giveUphope/autoGamer`，既是 fetch 也是 push）；并设 `remote.pushDefault=origin`，
  使裸 `git push` 只走 origin。**理由**：这两条是「误把东西交到上游」的结构性入口——`upstream` 在场时
  `gh` 的仓库解析可能落到它，而这条隐患**已经真实发生过一次**（见下条）。若日后仍需读上游设计，
  请按只读形态重新添加（`git remote add` 后立刻 `git remote set-url --push <name> no-push`）。
- **推送护栏（2026-10-14 落地并验证）**：三件一起上 —— ① `upstream` remote 已删；② `remote.pushDefault=origin`；
  ③ 版本化的 `.githooks/pre-push` + `core.hooksPath=.githooks`（非白名单远端一律拒绝更新 ref）。
  **A/B 实测**（对一个本地一次性 bare 仓库）：非白名单推送 = `exit 1` + `BLOCKED` 消息；加 `--no-verify` 才通过
  —— 对照能证明「是钩子拦的」。边界与重装方法见 `AGENTS.md`「远端与 PR 纪律」。
  **护栏不覆盖**：PR 的创建（任何本地钩子都管不到，只能靠规则与正确判据），以及**不可达目标**的推送
  （`pre-push` 在连接之后才运行，连接失败就看不到钩子消息）。
- **[已结清 2026-10-14] 跨库 PR `google/artemis#182` 已关闭**（用户操作，实测 `state: CLOSED`、
  `closedAt: 2026-10-13T17:34:01Z`；并复查 `gh pr list --repo google/artemis --author giveUphope --state open` **为空**
  ⇒ 上游不再有本 fork 的任何开放 PR）。
  ⚠️ 过程记一笔：第一次报告「已关闭」时实测仍是 OPEN（`closedAt: null`）——**只有复查读数才算数**（R27 / R28）。
- **教训（写进 AGENTS）**：`gh pr list --repo <本仓>` **只列 base 在本仓的 PR**，看不到「从本仓发到上游」的 PR
  ——曾据此得出「无开放 PR」的错误结论并用它论证改名无连带影响（R27：一个不能失灵的判据等于没判据）。

## 一、决议（现行）

| 编号 | 一句话 |
|---|---|
| D19 | **TS 全栈、py 归零**：仓库内不承载任何 py 实现；外部 ARTEMIS 只保留为可选提供方（规格 §一） |
| D20 | **溯源终态 = 不保留上游内容**（`LICENSE` 为本项目自撰 MIT，版权人 giveUphope，2026）；硬约束「只借鉴设计、不搬运文本」贯穿全部实现期（规格 §八） |
| D7 | 引入形态三层：禁手写 profile 目录内文件 / `--patch` 为官方 overlay / 交付走 `install_bundle`；配置热重载、代码冷重启；声明只影响之后创建的 Agent |
| D11 | 审批：常规动作 never；破坏性面集中在 `run_adb_command` 整工具 ask |
| D16 | Host 插件提供共享服务，preset 只贡献 scoped tools；provider 与消费方须同处一个 isolate realm；挂载 fail-fast |
| D17 | 自举引入：preset 挂 `tool-plugin-manager`，让 agent 自己执行 `install_bundle`（每个动作都需权限，R19 不代批） |
| S11 | **单层执行路由**：单 agent + 代码强制路由器 + validator / checker 只读 subagent —— 这是 T1 的设计依据 |

> 其余历史决策（D1–D6 / D8–D10 / D12–D15 / D18 与 S1–S10）的原文在归档分支
> `docs/migration/registry.md`；本分支只保留新实现直接要用到的这些。

## 四、开放差距

| 编号 | 一句话 | 归属 |
|---|---|---|
| G75 | 一台模拟器暴露多条 adb 传输被 roster 报成多台 → 闸门/并发上限/熔断计数翻倍 | 设备面，T2 期间处理 |
| G76 | 坐标空间缺一致性防护（帧空间 vs `wm size`） | 设备面，T2 期间处理 |
| G78 | `adb forward` 残留：生命周期归属未定 | T2（与前置-2 同源） |
| G81 | 插件 spec 从未被类型检查（`tsc` 的 `include` 只含 `src`，实测 144 条错误） | TS 侧独立债 |
| G82 | py 引擎仍被 `run_task` / `manage_task` / `inspect_trace` 消费 → 须由 S11 路由器替代 | **T1** |
| G83 | 15 工具动作面是 py-only → 须 TS 原生实现并与现面逐条对照 | **T2** |
| G84 | 效果判定 `compare_ui_frames` / OCR / overlay 是 py-only → 须 TS 化 | **T3** |
| G85 | py 归零收尾：删 py 树、清 CI 与依赖、更新文档口径 | **T4** |
| G86 | 溯源清理：copyright 头、vendored 第三方、派生文档、致谢文案、git 元数据 | **T4**（约束贯穿 T1–T3） |

> G72（提供方形状）与 G74（映射层按旧 5 工具面锁形状）**不在本分支跟踪**：它们随 T4 消解。

## 七、流程

> T1–T4 是分期名**不是编号**。每期收尾门禁：插件 `tsc` + `vitest` 全绿；改过 patch 跑 **R6**；**R7** 开新会话；判「生效」只认 **R9**。

### 前置：契约实测（动 T2/T3 之前，任一未测不许开工对应期）

- [ ] 前置-1 `adb shell uiautomator dump` 的真 wire 形态（设备侧输出与既往扁平列表的对应关系）
- [ ] 前置-2 helper（accessibility 服务）协议：端口 / 握手 / 请求响应格式 / `adb forward` 生命周期（与 **G78** 同源）
- [ ] 前置-3 效果判定所依据的差分算法与阈值（**无思路时从旧实现读设计，不搬文本**）
- [ ] 前置-4 外部提供方接入边界：`artemisMcpCommand` / `artemisRepoPath` 在 T4 后只剩「可选外部 ARTEMIS」语义

### 搬迁-1 · 插件 TS 树从归档分支搬入（方案，2026-10-14 立项，R22）

**What（范围）**
- 从 `legacy-fork-v2-dsh-plugin` 搬入：
  - 插件根配置：`.gitignore`、`.npmrc`、`package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`vitest.config.ts`、`icon.svg`、`client.js`、`cordis.patch.yml`
  - `locale/`、`skills/`
  - `src/**`（27 文件）、`tests/**`（36 文件，含 fixtures 与 support）
  - `scripts/`：`mock-action-server.mjs`、`spike-mcp.mjs`（测试直接依赖）、`dump-proxy.mjs`、`conformance-live.mjs`
- 明确不搬：
  - `spike/wire-tools.py`（Python，D19）
  - `spike/` 其余 3 个（写死旧机 D:/DEV、D:\ 路径的环境耦合装置；T2 前按当前环境重建）
  - 根 `tests/fixtures/action_surfaces/*`（py 侧契约 fixture，随 py 测试在 T4 归零）

**How（做法与关键决策）**
- 整块 checkout 归档文件 → 逐文件过 D20（已实测插件树零上游痕迹：`Google LLC` / `derived from` / `originally from` / `minitap` / `Copyright` 均为 0）
- README 重写：去掉指向归档台账（registry / glossary / CHANGELOGS）的链接、写死盘符、归档债务表（G30–G34）；Layout 块须与 src 实际文件逐一对应（`readmeLayout.spec` 锁）
- `conformance-live.mjs`：dsh 默认取 PATH（不再写死 D:/DeepSeek Harness）；`readSession` 从 `uv run python zstandard` 改为 Node 原生 `node:zlib` zstd 流（Node 22 原生支持，本机已验证有 `createZstdDecompress`）
- 不引入任何新依赖

**Verify（验收命令，在 `plugins/dsh-autogamer/` 内）**
- `pnpm --config.verify-deps-before-run=false install --frozen-lockfile --config.autoInstallPeers=false`
- `pnpm --config.verify-deps-before-run=false run build`（tsc）
- `pnpm --config.verify-deps-before-run=false run test`（vitest，期望全绿）
- `git ls-files '*.py'` 为空；`git grep -n -E 'D:/DEV|D:/DeepSeek' -- plugins` 为空

**Done means**
- [ ] 插件工程在 main 上可构建、测试全绿
- [ ] 无 py 文件、无写死旧盘符路径
- [ ] 本文件 §零「阶段：未开工」与下方「新分支特有」搬迁项同步更新

### 新分支特有（搬迁与基建）

- [ ] 从归档分支搬迁插件工程 `plugins/dsh-autogamer/`，**逐文件做 D20 清理**（方案见上方「搬迁-1」）
- [ ] TS 版文档门禁，替代未随迁的 py 脚本（`check_doc_registry` / `check_doc_tables` 的机械职责）
- [ ] 本分支的 `CHANGELOGS`（首次结案时新建，规则：`### #N` 三段、编号永不复用）

### T1 · 引擎去消费者（**G82**）

- [ ] 落自足条目（What / How / Verify / Done）并按 R22 先提交方案
- [ ] `run_task` / `manage_task` / `inspect_trace` 改 TS 侧编排（S11 路由驱动设备动作工具）
- [ ] 跨回合任务状态载体定案（先查宿主原生 storage / session 投影，按 R20 取一手口径，不自建容器）
- [ ] 三条工具不再调用任何外部进程（契约锁）
- [ ] R7 真机跑一条完整任务，终态双轴正确
- [ ] **Done：py 引擎无消费者**

### T2 · 动作面 TS 化（**G83**）

- [ ] 动作工具面 TS 原生实现（adb CLI + on-device 协议客户端）
- [ ] 与旧实现逐条对照：**同一输入同一输出**（对照结果留档，含可复跑命令与实测输出）
- [ ] 坐标 / 层级 / 截图三条金标准复测
- [ ] **Done：不再依赖任何 py 动作面**

### T3 · 图像与 OCR TS 化（**G84**）

- [ ] 效果差分落 TS（算法与阈值从旧实现读设计）
- [ ] OCR 改 HTTP 直译
- [ ] overlay 标注改 TS 图像库
- [ ] 对照表留档（同输入同输出）
- [ ] **Done：效果判定与 OCR 无 py 依赖**

### T4 · 收尾与溯源清理（**G85** + **G86**）

- [ ] py 树、CI 的 python job 与 py 依赖安装步骤全部清除
- [ ] 文档口径同步（`AGENTS.md`、本文件、规格）
- [ ] **Done：规格 §一 五条全部成立**

#### 溯源线（D20 / **G86**；约束贯穿 T1–T3，清理收尾于 T4）

- [ ] **贯穿约束**：T1–T3 的实现只借鉴设计、不搬运文本——每期收尾自检一次
- [ ] copyright 头清零（含旧 fork 的 `Google LLC` 字样）
- [ ] vendored 第三方整树不存在
- [ ] 上游派生文档一律不作为实现依据（归档分支可查，本分支不留）
- [ ] 致谢 / 命名文案用「灵感来源」措辞，不写「基于」
- [x] `upstream` remote 已移除（2026-10-14 裁定，仅保留 `origin`，并加 pre-push 护栏）
