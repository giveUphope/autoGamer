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
- **阶段：T1 的离线可证部分已收口，live 项阻塞（2026-10-14）**。插件工程已搬入（搬迁-1）；T1 切片 1–3 的代码在位，G82 的 Done 判据「py 引擎在插件侧无任何消费者」在**离线可证的范围内**成立
  （类型面 / 实现面 / 契约锁三重，证据见 §七「T1 进度」）。
  **读数不写死**（R28 判据 4）：复测 = 在 `plugins/dsh-autogamer/` 跑 `pnpm --config.verify-deps-before-run=false run verify`（build + typecheck + vitest 三段）。
  全部 py 实现均不在本分支（按 D19 归零）。
- **环境残留护栏（2026-10-14 落地，基建-1）**：本机从旧 fork 切到 orphan main 后曾残留约 1 GB 旧栈（`.venv` / `__pycache__` / 旧 `apps/node_modules` / `traces` 等，均被 `.gitignore` 忽略、`git status` 干净），已清理。检测固化为仓库规则：`scripts/check-env.mjs`（H1 被跟踪 py 硬失败 / H2 工作树 py 栈残留失败 / NOTE 仅列运行数据，白名单 `node_modules`/`dist`/`.git`）；`.githooks/post-checkout` 与 `post-merge` 切分支/拉取后跑检测、**只警告不阻断**；`pre-push` 追加 H1 硬拦（拒绝推送被跟踪 py）。A/B 已实测，新环境拉取流程见 `AGENTS.md`「新环境拉取」。
- **基建-2 立项（2026-10-14；方案已落，实现未开工）**：本轮读进度实测出 **6 处文档滞后**并已修正（提交 `258f7b7`）——
  结清的编号还占着开放表、被推翻的旧句静默保留、自称完成而验收项一个没勾、整行重复、进度副本漂在权威之外、同一事实两个数，
  **全是机器抓得住的形状**。本分支因 D19 不随迁旧 py 门禁，此前**没有任何机械文档门禁**。据此立项 `scripts/check-docs.mjs`
  （六条检查 + 内置 `--selftest` 变异 + 只在文档暂存时触发的 `pre-commit`），方案与判据见 §七「基建-2」。
  ⚠️ 实现落地前，`AGENTS.md` 的「**文档门禁暂缺**」一句**仍然成立**——别把它当已解决。
- **进行中里程碑**：**D19（TS 全栈、py 归零）+ D20（溯源归零、不保留上游内容；LICENSE 为本项目自撰 MIT，版权人 giveUphope）**。
- **最先能做的两件事（离线可跑）**：§流程 的「前置-1」与「前置-3」。**2026-10-14 实测修正**：本机**无 `adb`**（全盘 0 命中）、
  无在线设备 ⇒ **前置-1 与前置-2 阻塞在环境**（用户裁定「先做有环境的」；解锁条件与复跑命令见 §七「前置-1/2 阻塞」，
  属用户授权动作、不代批）。**前置-3 已完成**（算法/阈值/分支/失败语义/坐标空间五条结论齐备，T3 移植范围收口为
  `check_ui_change` 单条路径；坐标空间疑点查证为「不是错位」，残留的帧空间问题改挂 **G76**）。
  **阻塞现状（2026-10-14 更新）**：T1 离线可证部分已完成，剩下两条**只有设备在场才能做**——切片 3 的宿主绑定核验（🔶 R9）与 R7 真机跑一条完整任务；
  **T2 全部**同样阻塞于本条。**下一个开工项待用户裁定**，候选与各自的前置见 §七（T3 的取证依据即前置-3 已齐，但 §三「顺序不可跳」是否算 T1 收口，属裁定而非现状）。
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
| G82 | py 引擎仍被 `run_task` / `manage_task` / `inspect_trace` 消费 → 须由 S11 路由器替代 | **T1** |
| G83 | 15 工具动作面是 py-only → 须 TS 原生实现并与现面逐条对照 | **T2** |
| G84 | 效果判定 `compare_ui_frames` / OCR / overlay 是 py-only → 须 TS 化 | **T3** |
| G85 | py 归零收尾：删 py 树、清 CI 与依赖、更新文档口径 | **T4** |
| G86 | 溯源清理：copyright 头、vendored 第三方、派生文档、致谢文案、git 元数据 | **T4**（约束贯穿 T1–T3） |

> G72（提供方形状）与 G74（映射层按旧 5 工具面锁形状）**不在本分支跟踪**：它们随 T4 消解。
> **G81（插件 spec 从未被类型检查）已于 2026-10-14 结清**，权威记录在下方「新分支特有」的 G81 行与其量化小节，故不再列进开放差距表。
> 顺带更正本行原先写着的「实测 144 条错误」：它与量化小节的基线 **124** 是同一件事的两个数，且 144 无从复核——结清后只保留 124 那一份读数（R28：一个派生事实只留一个权威）。

## 七、流程

> T1–T4 是分期名**不是编号**。每期收尾门禁：插件 `tsc` + `vitest` 全绿；改过 patch 跑 **R6**；**R7** 开新会话；判「生效」只认 **R9**。

### 前置：契约实测（动 T2/T3 之前，任一未测不许开工对应期）

- [ ] 前置-1 `adb shell uiautomator dump` 的真 wire 形态（设备侧输出与既往扁平列表的对应关系）— **本机阻塞，见下方「前置-1/2 阻塞」**
- [ ] 前置-2 helper（accessibility 服务）协议：端口 / 握手 / 请求响应格式 / `adb forward` 生命周期（与 **G78** 同源）— **本机阻塞，同上**
- [x] 前置-3 效果判定所依据的差分算法与阈值（**无思路时从旧实现读设计，不搬文本**）— 结论见下方「前置-3 实测结论」（2026-10-14 完成；**T3 移植范围已收口为 `check_ui_change` 单条路径**）
- [x] 前置-4 外部提供方接入边界 —— **已完成**（2026-10-14；结论见下方「前置-4 实测结论」）：
      `artemisMcpCommand` 留但收窄语义；`artemisRepoPath` 的 **cwd / pyproject 探测 / uv project 三种 py 语义删**，
      其 **rules 文本来源必须改指向自己**（D20 红线，同时归属 G85+G86）；`uvPath` 删；
      preflight 七项在 T4 重画为「提供方未配置即跳过，设备面三项才是 gate」

#### 前置-1/2 阻塞 · 环境缺失（2026-10-14 实测，用户裁定「先做有环境的」）

**阻塞原因（实测，非推测）**：本机**没有 `adb`**——`Get-Command adb` 返回空；`%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`
与 `C:\Android` / `D:\Android` 等常见位置 `Test-Path` 均为假；`Get-ChildItem C:\ -Filter adb.exe -Recurse -Depth 4` **0 命中**。
无 `adb` 即无法产生 wire 形态，**也没有在线设备**。`dsh` 在 PATH 且为 `0.2.0-rc.2`（与 R11 基线一致，宿主侧不缺）。

- **影响**：按规格 §四「任一项未测不许开工对应期」，**T2 不得开工**（前置-1/2 未测）。T1、T4 与离线的前置-3/4 不受此阻塞。
- **解锁条件与复跑命令**（接上设备 + 装好 platform-tools 后重跑，结论当轮回写本节）：
  1. `Get-Command adb; adb version` → 确认工具链在 PATH；
  2. `adb devices -l` → 拿到 serial；
  3. `adb -s <serial> shell uiautomator dump /sdcard/window_dump.xml`；
  4. `adb -s <serial> exec-out cat /sdcard/window_dump.xml` → 记录设备侧 XML 真形状（是否带 `children` 嵌套、节点属性集）；
  5. 与规格 §二「UI 层级 dump」行的「py 侧已知为扁平、无 `children`」逐条对照，**对照结果留档后**才允许开工 T2。
- **授权边界**：安装 platform-tools、连接/开启设备属 AGENTS「涉及权限授予、安装 Host 代码，由用户决定」的动作，**不代批**。
- **提醒义务**：后续每次进入 T2 相关工作、或用户在会话中提到设备/真机时，先复述本条阻塞与解锁条件。

### 前置-3 · 效果判定的差分算法与阈值（方案，2026-10-14 立项，R22）

**What（范围）**
- 取证对象（只读 git blob，不 checkout、不装 py、不加依赖）：
  `legacy-fork-v2-dsh-plugin` 的 `artemis/utils/image_diff.py`（`check_ui_change` / `wait_for_screen_stability` /
  `wait_for_screen_data_stability`）、其调用点 `artemis/mcp/adb_server.py` 的 `compare_ui_frames`，
  以及 `tests/unit/utils/test_image_diff.py` 的判别用例集。
- **只取设计事实**（算法族、参数、阈值、判定分支、失败兜底方向、坐标空间），**不搬文本**（D20）——结论用自己的话写。
- 产出物：本节末尾的「实测结论」小节，作为 **T3** 的实现依据。本项**不改任何代码**。

**How（做法与关键决策）**
1. 先判**哪些函数在活路径上**：全仓 grep 调用点，据此收口 T3 的移植范围（死代码不当契约）。
2. 逐条记录：遮罩比例 → 差分管线每一步及其参数 → 两处阈值 → 按动作名的分支表 → ROI 几何公式 → 失败兜底方向。
3. **坐标空间单独立一条**：它是下游最易错处（模型面向 0–1000 归一坐标，像素判定需要设备像素）。
4. 结论每条标注出处（函数名 + 常量名），便于复核；**任何从代码外推的疑点只写「候选 + 待做判别实验」**，不写成结论（R25）。

**Verify（验收命令）**
- `git grep -n "check_ui_change(" legacy-fork-v2-dsh-plugin -- "*.py"` → 生产调用点数量与位置可核对。
- `node scripts/check-env.mjs` → exit 0（本项不产生 py 文件）。
- 结论中每个数字都能指回 blob 内的具体常量（复核时按函数 + 常量名 grep）。

**Done means**
- [x] 算法 / 阈值 / 分支 / 失败语义 / 坐标空间 五条均有结论且各带出处
- [x] 活路径与死代码判定完成，T3 移植范围收口
- [x] 坐标空间疑点已查证（**结论：不是错位**，见下「I」），残留真问题改挂 **G76**

#### 前置-3 实测结论（2026-10-14，读归档分支 blob，未搬文本）

取证命令：`git show legacy-fork-v2-dsh-plugin:<path>`；调用点统计：`git grep -n "check_ui_change" legacy-fork-v2-dsh-plugin`。
下列每条都标出处（函数 + 常量名），复核时按名 grep 即可。

**A. 活路径收口（决定 T3 移植范围）**

- `check_ui_change` 的**生产调用点恰好一处**：`artemis/mcp/adb_server.py` 的 `compare_ui_frames` 工具（import + 调用共 2 处命中）。
- `wait_for_screen_stability` 与 `wait_for_screen_data_stability` **无任何生产调用者**——全仓命中只在定义文件自身与
  `tests/unit/utils/test_image_diff.py`。⇒ **T3 只需移植 `check_ui_change` 这一条路径**；两个「等屏幕静止」的函数不进 T3 契约
  （将来若 TS 侧要做「等静止」，那是**新设计**，须另立条目，不许拿死代码当需求）。
- TS 侧现状（G84 的 py-only 面）：`src/index.ts` 的 `compareFrames` 用 `client.callTool("compare_ui_frames", …)` 转发给外部
  action server；`src/tools/runDeviceAction.ts:831-839` 取 `payload.coordinates` 作 ROI 入参，并按「`changed !== false` 即放行」
  消费返回值，`undefined`（无判定）记 `effect: "unknown"` 且不触发阶梯。

**B. 输入与失败兜底（fail-open）**

- 入参两帧字节 + 动作名 + 可选坐标对；出参一个布尔「是否变化」。
- 两帧一律先转**灰度**再比（丢弃颜色通道）。
- 解码失败或内部抛异常 ⇒ 判 **「变了」**（`check_ui_change` 返回 `True`）。方向是**放行而非阻塞**。
  TS 侧的等价语义是 `compareFrames` 返回 `undefined` → 上层 fail-open，不进阶梯、不计 incident。

**C. 遮罩（防状态栏/导航栏误判）**

- 全局路径在**裁剪后**的画面上比较：顶部 10% 当状态栏、底部 5% 当导航栏，先裁掉再比。

**D. 差分管线（全局判定与「等静止」共用同一套）**

1. 逐像素取绝对差；
2. 高斯模糊 **5×5**、sigma 传 0（由核大小推导：cv2 口径 σ=0.3×((k−1)×0.5−1)+0.8 ⇒ k=5 得 **σ≈1.1**）；
3. 二值化，阈值 **25**；
4. 变化占比 = 非零像素数 ÷ 内容区像素总数。

**E. 阈值与分支表**

- `full_screen_threshold` 默认 **1e-4**（全局占比门限）；`roi_threshold` 默认 **0.05**（ROI 占比门限，**比全局高 500 倍**——
  只有局部变化足够大才允许 ROI 放行）。
- 分支：`swipe` 直接看全局（滑动本就应当大范围变化）；`tap` / `long_press_on` / `focus_and_input_text` / `focus_and_clear_text`
  **且**坐标是二元组 ⇒ 先算 ROI，ROI 占比 > 0.05 即判「变了」；其余（无坐标的 tap、launch_app 等）⇒ 回落全局。
- **ROI 未过门限不等于判「没变」**：会再落回全局判一次（这是两级门限的语义要点，T3 移植时最容易漏掉的一步）。

**F. ROI 几何**

- 参考机型取 1080×2400 的对角线；`scale = 当前帧对角线 ÷ 参考对角线`；`roi_size = max(15, int(50 × scale))`
  （`max(15, …)` 是为了低分辨率屏上 ROI 不塌成 0）。
- ROI 从**未裁剪的原图**裁，而全局占比在**裁剪后的图**上算——两条路径的取景不同，移植时别混用坐标系。
- ROI 管线参数与全局**不同**：高斯模糊 **3×3**（σ≈0.8）、二值化阈值 **20**（比全局的 25 更灵敏）。
- ROI 四边钳制在图内。

**G. 「等静止」函数（记录以防误当契约，无活路径）**

- 两者与全局判定**共用同一条管线**（裁剪 + 5×5 模糊 + 阈值 25），门限不同：占比 **< 0.001** 视为静止；
  轮询间隔 **0.2s**、总上限 **1.5s**，超时强制返回最后一帧。二者只差返回类型（纯 base64 截图 vs 截图+XML 一起）。

**H. 判别用例集（T3 的 spec 蓝本，来自归档分支的测试）**

1. 同帧自比 ⇒ 不变；
2. 全屏变化 + `swipe` ⇒ 变；
3. 中心 40×40 方块 + `tap`（1000×1000 帧）⇒ 变（ROI 触发；此分辨率下 `roi_size ≈ 26`）；
4. 变化只落在顶部 50 行 ⇒ 不变（状态栏遮罩生效）；
5. 1080×2400 帧中心 10×10 方块 + `tap`，并把全局门限抬到 1e-3 ⇒ 不变
   （ROI 占比 ≈ 100/10000 = 0.01 < 0.05 落空 → 回落全局 ≈ 4.5e-5 < 1e-3）。
   用例 5 把「ROI 落空要回落全局」与两级门限的相对关系钉死，是 T3 最该先落的 spec。

**I. 坐标空间：查证结论「不是错位」，但牵出 G76**

- 我起初的候选怀疑：模型侧用 0–1000 归一坐标，是否被当作像素喂进 ROI ⇒ **被代码否证**。证据链（均可复核）：
  `resolvePixelTarget` 对 `{coordinate:[x,y]}` 走 `coord.ts` 的 `toPixels` 换算，对 `{index}`/`{text}` 走 `hierarchy.ts` 的
  `parsed_bounds` 节点中心——**两条路都在工具边界内侧先换算成设备像素**；`src/tools/runDeviceAction.ts:900-901` 又把像素中心
  换回归一值只为重试目标。插件内部**统一用像素**，归一值只出现在工具边界。故 `compare_ui_frames` 收到的就是像素，与 ROI 期望一致。
- **残留的真问题（不是坐标格式，而是两套像素可能不等）**：ROI 按**解码出的帧的 `w`/`h`** 取景，而插件换算用的是
  `requireScreenSize(key)` 探针值。二者不一致时 ROI 仍会错位——这正是 **G76「帧空间 vs `wm size` 缺一致性防护」**。
  ⇒ 不新立条目，**挂在 G76 名下**；T3 实现时 ROI 必须按**帧自身尺寸**取景，不得引入第三套尺寸来源。
- **判别实验（仍需设备，阻塞于前置-1）**：在「只有局部变化」的画面（如切换开关）上比较两种取景口径的 verdict，
  一次只改「帧尺寸 vs 探针尺寸」这一个变量。

### 前置-4 · 外部提供方接入边界（方案，2026-10-14 立项，R22）

**What（范围）**

- 取证对象：`artemisMcpCommand` / `artemisRepoPath` / `uvPath` 三个配置项，在 **T4 之后只剩「可选外部 ARTEMIS」**语义时
  （规格 §一.3）各自的边界：谁在读、读它干什么、终局是**留 / 删 / 改指向自己**。
- 连带取证：`src/env/preflight.ts` 的七项体检、`src/prompt/rulesInjector.ts` 的注入供应链、
  `src/artemis/mcpBackend.ts` 的 spawn 面。
- **本项只出结论，不改代码**（改代码属 T4）。产出物是本节末尾的边界表 + 锁的落点建议。

**How（做法与关键决策）**

1. **先画消费图再判定**：每个配置项的**每一处读取点**都要有 `文件:行` 出处；一个配置项被几处读、每处读它干什么，
   是判「留还是删」的唯一依据。
2. **区分「同一名字承载多种语义」**：这是本项最容易漏的面——若一项配置同时被「spawn 进程」「探测 py 工程」
   「读文件进 prompt」三处用，它不是一个开关，而是三个决定，必须逐个判。
3. **prompt 面单独红线**：凡是把**外部仓库里的文本**注入模型面的路径，判据不是「可选不可选」，
   而是 D20「只借鉴设计、不搬运文本」——这类路径在 T4 必须改指向我们自己拥有的来源，不能保留上游目录约定。
4. **失败语义不许混**：现有三条（注入 fail-open / 体检 gate / backend lazy spawn）在改配置面时必须保持各自的语义。
5. 结论写进台账并标注归属（T4 / G85 / G86），不留「以后再说」。

**Verify（验收命令）**

- 每个读取点都能用 `grep -n "<配置项>" src` 复核，且与结论表逐行对齐。
- 本项不改代码 ⇒ `tsc`、`vitest`、`node scripts/check-env.mjs` 保持绿（回归证明）。
- 结论里引用的每处 `文件:行` 必须真实存在（抽样 `read` 复核）。

**Done means**

- [x] 三个配置项各自的终局判定表（留 / 删 / 改指向自己）+ 每项的读取点清单 → 结论 **§一 消费图** + **§二 终局判定**（`cb53bc7` 方案、`ba3f709` 结论）
- [x] 至少识别出「一名字多语义」与「prompt 供应链」两类需要额外处置的面 → **§一**（一个名字四种语义，5 个读取点）+ **§三**（红线）
- [x] preflight 七项在 T4 的重画建议（哪些属于设备面、哪些属于提供方体检）→ **§四**
- [x] 为 T4 留下锁的落点建议（哪些契约锁要跟着改）→ **§五**
- 未验证的两条已单列在 **§六**，不写进结论

#### 前置-4 实测结论（2026-10-14，读声明面与本仓源码；本项未改代码）

清点命令（可复核）：`grep -n "<配置项>" src`——`artemisMcpCommand` **3 处**、`uvPath` **9 处**、`artemisRepoPath` **27 处**。

**一、消费图：一个名字，四种语义**

`artemisRepoPath`（默认 `""`）不是「一个路径开关」，是**四件事**共用一个名字，这是本项最要紧的发现：

| # | 读取点 | 它在干什么 | 性质 |
|---|---|---|---|
| 1 | `src/index.ts:183-184` | 作为 backend 的 **`cwd`**，即 py 进程的工作目录 | py spawn |
| 2 | `src/env/preflight.ts:197-208` | 探测 `<repo>/pyproject.toml` 是否存在 | **py 工程探测** |
| 3 | `src/env/preflight.ts:213`（`venvProbe`） | `uv run --project <repo> --no-sync artemis …`，`installedCheck`/`helperCheck` 各调一次 | **再 spawn py CLI** |
| 4 | `src/prompt/rulesInjector.ts:44-45` | 读 `<repo>/mcp_server/rules.md` 并交给 `systemPrompt.section()` | **prompt 正文供应链** |
| 5 | `src/tools/diagnose.ts:114-116` | 只用于拼提示文案 | 文案 |

`artemisMcpCommand`（默认 `["python","-m","mcp_server"]`）只有一条真实消费链：`index.ts:181` → `createArtemisBackend`
→ `mcpBackend.ts:52` 的 `StdioClientTransport`，即**spawn 一个 py 进程**当 MCP server（构造时 lazy，不 spawn）。

`uvPath`（默认 `"uv"`）全部指向 py 工具链：`uv --version`、`uv tool list`、`venvProbe`。

**二、终局判定（T4 / 规格 §一.3）**

| 配置项 · 语义 | 终局 | 依据 |
|---|---|---|
| `artemisMcpCommand`（spawn MCP server） | **留，但收窄语义** | §一.3 允许「用户自行安装的外部 ARTEMIS」；命令可指**任何** MCP server 实现，不必是 py。保留项须在文档里写清「不内置、不 vendored、不为其开开发依赖」 |
| `artemisRepoPath` ① cwd / ② pyproject 探测 / ③ uv project | **删** | 三者都是 py 专属探测。T4 后仓内无 py（`git ls-files '*.py'` 为空是终态判据），这些探测无对象可探，且它们会把「未配置提供方」变成**体检失败**而非「走 TS 原生」 |
| `artemisRepoPath` ④ rules 文本 | **必须改指向自己**（红线） | 见下条 |
| `uvPath` | **删** | 纯 py 工具链探针 |

**三、prompt 供应链是红线，不是可选项（D20 × D19）**

`rulesInjector.ts` 今天把**外部仓库里的 `mcp_server/rules.md` 原文**注入模型 system prompt；
连**路径约定本身**（`<repo>/mcp_server/rules.md`）在 `rulesInjector.ts:16-17` 的注释里都写明来自「fork 的证据」。

- 这同时踩 **D19**（仓内不承载 py）与 **D20**（只借鉴设计、不搬运文本；prompt 正文不得逐字照抄）。
  因此它**同时归属 G85 与 G86**，不是二选一——这一条要写进 T4 的范围，否则会被当成「可选提供方的小事」放过去。
- 规格 §二 该行的判据是「注入内容非空且可达模型」、落点是「**插件内固定文本或外部文件**」。现状两者都不是：
  它既不是我们自己的文本，也不是我们自己的文件路径，而是一个**上游目录结构**。T4 必须在下列二选一中定案：
  1. **插件内固定文本**（我们自己写，来源是我们自己的设计）；或
  2. **我们自己拥有的外部文件**（新的配置项，与外部提供方无关，路径约定由我们定义）。
  3. ⛔ 不能继续沿用 `<外部仓库>/mcp_server/rules.md` 这个约定。
- 连带：测试夹具 `tests/fixtures/fake-repo/mcp_server/rules.md` 锁的就是这个上游路径约定，T4 改判据时它要一起改。

**四、preflight 七项在 T4 的重画**

现状七项：`uv` / `python` / `artemis-repo` / `artemis-installed` / `adb` / `adb-devices` / `helper`。
其中 **前四项是「外部提供方的体检」，后两项是设备面，`helper` 是设备面但由提供方 CLI 代答**。

- T4 后建议：**提供方未配置 ⇒ 这几项整体跳过而不是失败**（否则「不配置提供方」会被误报成环境坏了），
  只保留设备面三项为真正的 gate。这正是 §一.3「未配置即走 TS 原生」的落地形态。
- **三条失败语义不许混**（改配置面时必须逐条保持）：注入 **fail-open**（6 种 outcome、绝不抛、告警即止，
  见 `rulesInjector.ts:53`）／体检 **gate**（`requireEnv` 先跑、失败即拒并附 fix）／backend **lazy spawn**
  （构造不 spawn，首调才连，故 `apply()` 本身无副作用）。

**五、给 T4 的锁落点建议**

- 改 `rulesInjector` 时：把「注入内容来自我们自己拥有的来源」写成**契约锁**（当前 `rulesInjector.spec.ts`
  只锁了 outcome 与 fail-open，**没锁文本来源**——这是漏的）。
- 删 py 探测时：`preflight.spec.ts` 的七项断言要同步重画，别让旧断言把新行为锁回去。
- 配置面收窄后：`tests/conformance/contracts.spec.ts` 的 `Config` 字段断言要跟着改，否则会锁住已删字段。

**六、本项未验证的（不写成结论）**

- 外部 ARTEMIS 是否真能以「非 py 的 MCP server」形态提供同一能力——**未测**，属 T4 的 live 项。
- `helper` 在 T4 后由谁代答（本插件自己实现 vs 仍由提供方 CLI）——**未决**，留 T4 当时按 §一.3 取舍。

**七、回归证明（本项未改代码）**

`tsc` rc 0 ／ `vitest` 35 files · 330 passed · 1 skipped ／ `node scripts/check-env.mjs` exit 0。
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
- [x] 插件工程在 main 上可构建、测试全绿（tsc rc 0；vitest 293 passed / 1 skipped）
- [x] 无 py 文件、无写死旧盘符路径
- [x] 本文件 §零「阶段」与下方「新分支特有」搬迁项同步更新

### 基建-1 · 工作树环境残留检测（D19 环境护栏，方案，2026-10-14 立项，R22）

**背景**：本机从旧 fork 工作区切到 orphan `main` 后，`git ls-files '*.py'` 已为 0（仓库干净），但磁盘仍留
约 1 GB 旧栈——切分支时 git **只删被跟踪源码，不删被 `.gitignore` 忽略的文件**（`.venv` 856 MB、旧
`apps/node_modules`、各目录 `__pycache__/*.pyc`、`traces`、`scratch`、`.env` 等）。`git status` 干净，
靠肉眼无从发现。需要一个**机械检测**在新环境拉取/切分支时把它变成红/绿。

**What（范围）**
- 新增零依赖 Node 脚本 `scripts/check-env.mjs`（Node 是 TS 栈前置，不依赖插件 `node_modules`；D19 下检测脚本本身不得是 py）。
- 检测分两级：
  - **H1 跟踪层（硬失败）**：`git ls-files '*.py'` 非空 → FAIL（py 被纳入版本控制）。
  - **H2 工作树残留（失败）**：扫描工作树（排除白名单）发现 py 栈特征：
    `*.py`/`*.pyc`/`*.pyo`/`*.pyd`、`__pycache__/`、`.venv/`/`venv/`/`env/`、
    `.pytest_cache/`/`.ruff_cache/`/`.mypy_cache/`/`.tox/`/`.nox/`、`*.egg-info/`、
    `pyproject.toml`/`uv.lock`/`setup.py`/`setup.cfg`/`requirements*.txt`/`Pipfile*`。
  - **NOTE（不失败，仅列出）**：运行数据/临时区 `traces/`、`scratch/`、`data_engine.db*`、`.artemis_*`。
- **白名单（不得误报）**：`.git/`、所有 `node_modules/`、所有 `dist/`（TS 栈依赖与构建产物）。
- 脚本只**检测+报告**，不删除任何东西；报告里给出清理命令（`git clean -fdX` 或精确路径）。
- 自动触发（版本化于 `.githooks/`）：
  - 新增 `post-checkout` + `post-merge`：切分支/拉取后运行检测，**只警告不阻断**（exit 0，避免妨碍正常切换）。
  - 现有 `pre-push` 追加 **H1 硬检查**：被跟踪 py 非空则拒绝推送（D19 红线）。
- 文档：`AGENTS.md` 增加「新环境拉取」步骤（clone 后 `git config core.hooksPath .githooks` + `node scripts/check-env.mjs`）。

**How（做法与关键决策）**
- 纯 Node 内置模块（`node:fs`/`node:path`/`node:child_process`）；Windows 路径用 `path.sep` 归一化，git 输出正斜杠统一转换。
- 判据用「py 栈特征文件/目录」而非「目录名」：因此新建的根 `scripts/`（放检测脚本本身）不会被误判。
- `post-checkout` 只警告：残留是历史遗留，不影响当前分支工作；阻断切换会误伤。
- 检测脚本与 hooks 都被 git 跟踪，随 clone 获得（hook 仍需一次性 `git config core.hooksPath .githooks` 激活，同现有 pre-push 护栏）。

**Verify（验收命令，可复跑）**
- 干净：`node scripts/check-env.mjs` → exit 0；且 `plugins/dsh-autogamer/node_modules`、`dist` 存在时仍 exit 0（白名单）。
- 变异（R27，证明会红）：仓库根放 `var_x.py` → exit 1 且报告该文件；放 `__pycache__/x.pyc` 与 `.venv/` → exit 1；删除后回到 exit 0。
- H1：`git ls-files` 层构造被跟踪 py 会被 pre-push 拒绝（用一次性本地裸仓 A/B，参照现有 pre-push 护栏的实测法）。
- hook：`git config core.hooksPath .githooks` 后，切一次分支观察 post-checkout 打印警告但不阻断。

**Done means**
- [x] 干净 checkout 下脚本 exit 0，白名单不误报（plugins 的 `node_modules`/`dist` 存在时仍绿）
- [x] 变异校验（py / pyc / .venv / 根级 env）逐一证明会红、清理后变绿；深层 `src/env/` 不误报；仅 NOTE 时 exit 0
- [x] pre-push H1 与 post-checkout/post-merge 经 A/B 实测（H1 裸仓 A/B：track py 被拦 exit 1、移除后 exit 0；post-checkout 警告不阻断）
- [x] `AGENTS.md` 新环境拉取步骤写明
- [x] 本文件 §零 与下方「新分支特有」同步

### 基建-2 · 文档门禁 TS 化（方案，2026-10-14 立项，R22）

**背景**：`AGENTS.md` 记着本分支「**文档门禁暂缺**」——旧 fork 的门禁是 Python，D19 下不随迁，于是本分支一个机械文档门禁都没有。
本轮读进度时实测出 **6 处滞后**（已修，提交 `258f7b7`），**每一处都是机器抓得住的形状**：结清的编号还留在开放差距表里、被推翻的旧句静默保留、
自称完成而验收项一个没勾、整行重复、进度副本漂在权威之外、同一事实两个数。靠人核对不可靠，而 R28 自己要求判据**必须能红** ⇒ 做成脚本。

**取证（R20/R22 第 1 步：读了哪份、它怎么说）**（全部转述，不搬文本 —— D20）

| 出处 | 取到的设计事实 | 对本方案的作用 |
|---|---|---|
| 归档分支 `scripts/check_doc_registry.py`、`scripts/check_doc_tables.py`（`git show legacy-fork-v2-dsh-plugin:<path>`，只读 blob） | 六类判定（声明集 vs 引用集、路径可解析、表格成形、范围独占、体量实测、重复 id）；失败契约**没有 warning 层**，命中即非零；脚本**自带 `--selftest` 变异模式**，某条检查在注入缺陷后仍不红就报「blind」并失败；度量前先归一 CRLF→LF；阈值与锚点**一律从内容现算**，锚点找不到就大声失败 | 本方案的检查族、失败契约、selftest 形态、归一口径与「不许静默跳过」全部由此派生（取其设计，不取其文本） |
| 同分支 `.github/workflows/*`、`.pre-commit-config.yaml`、`Makefile`（实测） | 三条门禁**确实接在 CI 的跑动步骤里**；pre-commit 只覆盖 lint 与质量棘轮，**没有**文档门禁；归档分支**没有** `.githooks/` | 触发面的教训：门禁一旦只挂在「CI 会跑」而本分支无 CI，就等于没门禁 |
| 本仓守则 **R27** 判据 1 / 2 / 4 / 5 | 新判据必须变异校验证明会红；样本量与执行位置都要咬得住；未接进 CI 的门禁**不许**写成「由 CI 保证」；不许拿 `cmd \| tail` 的退出码当判据 | 决定验收必须含**手工逐个变异**，且文档里如实写触发面 |
| 本仓守则 **R28** 判据 1 / 2 / 4 | 被推翻的旧表述要么改要么就地标作废；派生计数只留复测命令 | 检查 3「派生副本禁令」与检查 6「自称完成对账」的直接来处 |
| 实测（本分支现状） | 文档只有 4 份（`docs/TODO.md`、`docs/migration/` 两份、根 `AGENTS.md`/`README.md`）；`registry.md`、`CHANGELOGS.md`、`inventory/*`、体量表、`uv.lock` **一律不存在**；根**无 `package.json`**；`README.md` 本就零表格 | 旧门禁里「全集必须有编号行」「体量表实测」「依赖来源」三类判定**在此无对象，不移植**；命令面只能走 `node scripts/…`；vacuity 规则必须按文件计，否则 README 立刻假红 |

**What（范围）** — 新增 `scripts/check-docs.mjs`，对 `git ls-files '*.md'`（索引面，不是历史面）跑六条检查，命中即 FAIL：

1. **结清一致性**：某编号在 §四「开放差距」表**之外**的任何行里已带 `[x]` 或「已结清/已结案」样式，却仍占着 §四 一行 ⇒ FAIL。（本轮 G81 就是这一条。）
2. **引用可解析**：markdown 链接的目标、以及反引号里写出的仓内路径必须存在。**例外只许走显式豁免清单并写明理由**——`docs/CHANGELOGS.md` 属「首次结案时新建」的计划而非缺陷，须显式放行。
3. **派生副本禁令**：形如「N passed」「N 条错误」「N 个文件」的计数只许出现在**该事实的权威**（`docs/TODO.md` 的验收行）；出现在规格或 `AGENTS.md` ⇒ FAIL。（本轮 293 与 144 两处就是这么漂的。）
4. **编号范围自检**：凡写成「R1–R28 / D1–D6」这类**整体集合范围**，必须等于按标题与表行**现算**出的真实范围 ⇒ 专抓「范围写死、后来过期」。**en-dash（–）与 ASCII hyphen（-）两种都要认**（旧脚本禁止侧只认一种、抽取侧两种都认，口径不对称导致它长期漏报）。
5. **表格成形**：每个连续表格块要求第 2 行是分隔行、每行以 `|` 收尾、单元格数等于表头、且块不得跨 `## ` 标题。**计量单元格必须只在未转义的 `|` 处切分**——`\|` 是合法内容而不是分隔符（本轮实测踩过：朴素按 `|` 切分把一条合规表行判成多一列，两次探针还各错一种口径，见下方「实测记录」）。**按文件计**：一个文件零表格不算失败（`README.md` 本就无表）。
6. **自称完成与验收项对账**：条目自称「已完成 / 已结清」而它自己的 **Done means** 清单仍留 `- [ ]` ⇒ FAIL。（本轮 前置-4 就是这一条。）

**非目标（明确排除）**：不做拼写与文风；不重建「编号全集必须有一行」那套（本分支没有 registry，权威就是 TODO）；**不移植依赖来源门禁**（D19 下无 `uv.lock`，无对象）；不生成任何文档内容；不改既有的 `check-env.mjs`。

**How（做法与关键决策）**
- 零依赖 Node，只用 `node:fs`/`node:path`/`node:child_process`；形状对齐同目录 `scripts/check-env.mjs`：`git rev-parse --show-toplevel` 定根，退出码 **0 干净 / 1 有 FAIL / 2 用法错**，**不设 warning 层**（要区分就当场决定它算不算 FAIL，不留灰区）。
- 读入即归一 CRLF→LF 再判定（R27 判据 3：字节/行尾类判据必须写明口径——本门禁量的是**工作树**，不是 blob）。
- 所有阈值、编号集合、范围极值**从内容现算**，不写字面量；锚点缺失即 FAIL 并报「锚点缺失」，**不许静默跳过**。
- 豁免一律是显式清单 + 一句理由，且指明它由哪条决议放行；不做语义猜测。
- `--selftest` 内置变异：逐条检查各注入一个缺陷形态（**直接用本轮 6 处真实漂移当样本**），断言该条确实变红；任一检查注入后仍绿 ⇒ selftest 非零并报 blind；还原须字节级一致。
- 触发面：新增版本化 `.githooks/pre-commit`，**仅当暂存路径命中 `docs/**`、`AGENTS.md`、`README.md`** 时运行，FAIL 拒绝提交；`post-checkout`/`post-merge` 沿用 check-env 的口径**只提示不阻断**（切分支不该被文档漂移挡住）。本分支无 CI ⇒ 文档必须如实写「本地钩子 + 手跑，不由 CI 保证」（R27 判据 4）。

**Verify（验收命令）**
- `node scripts/check-docs.mjs` → 在当前 HEAD 上 **exit 0**（先证明它对现状不误报）。
- `node scripts/check-docs.mjs --selftest` → exit 0，并逐条打印 6 项各自的变异断言。
- 检查 5 须**双向**变异：往格子里插一个裸 `|` ⇒ 必须红；写一个 `\|` ⇒ 必须绿。假阳与假阴各证一次（R27 判据 2），**只证一侧不算过**。
- **手工逐个变异**（不拿 selftest 自证）：把本轮修掉的 6 处漂移**各别还原一处**，确认对应检查各红一次、且红的正是那一条；退出码用 `cmd > /tmp/o 2>&1; echo $?` 取，不接管道（R27 判据 5）。
- 钩子 A/B：暂存一处文档漂移 → `git commit` 被拒；加 `--no-verify` 才通过 ⇒ 证明是钩子拦的（照现有 pre-push 护栏的实测法）。
- 回归：`node scripts/check-env.mjs` 仍 exit 0（新脚本必须是 Node，不得引入 py）；插件 `pnpm … run verify` 不受影响。

**Done means**
- [x] 脚本落地，现状 exit 0（`node scripts/check-docs.mjs` → OK，6 checks / 8 files）
- [x] `--selftest` 覆盖 6 条且证明无 blind（7 例：C1–C4、C6 各红，C5 双向——裸 `|` 红、`\|` 绿）
- [x] 本轮真实漂移**做过手工变异并留输出**——偏差如实记：C1 单独一次（注入 G81 行 → 恰好 1 条 finding、指向正确行）；
      C2–C6 **一次五处并行**（→ 恰好 5 条 finding、各对应一条检查），未逐条单独跑；「各检查互不串扰」由 `--selftest` 的逐条过滤另行证明
- [x] `.githooks/pre-commit` 按文档范围触发并经 A/B 实测（隔离克隆：带漂移提交被拒 `exit 1` + 钩子消息、HEAD 不动；`--no-verify` 才通过并生成提交）；
      `AGENTS.md` 的「文档门禁暂缺」已改写为现状 + 重装说明
- [x] 本文件 §零 与「新分支特有」同步；规格 §七 只加一条**指针**，不写副本

**方案立项轮的实测记录（当轮落账，R28）**

- 归档门禁的设计面已从 blob 读齐（`git show legacy-fork-v2-dsh-plugin:scripts/check_doc_registry.py` 与 `…check_doc_tables.py`；只读，未 checkout、未装 py、未加依赖）。
  其「门禁接在 CI 里跑」的事实经该分支 `.github/workflows/*` 核对成立；而**本分支无 `.github/`、根无 `package.json`** ⇒ 触发面只能落在 `.githooks/` 与手跑命令，文档里**不许**写「由 CI 保证」（R27 判据 4）。
- 旧门禁的三类判定在本分支**无对象**（`registry.md`、体量表、`uv.lock` 均不存在），已在非目标里排除——不做大号移植。
- 本分支 4 份文档的表格块：在「只在未转义 `|` 处切分」的口径下全部成形；`README.md` 零表格，所以 vacuity 规则必须按文件计，否则一落地就假红。
- **检查 5 的切分口径是本轮真金白银学到的**：两次探针各错一种——第一次按裸 `|` 切分，把一条写了合法 `\|` 的合规表行判成多一列；第二次用 BRE `'\\|'` 数转义串，把「有 1 个」读成「0 个」。最终 `grep -o -F '\|'` 才取到准数，确认文档没错、**错的是判据命令的口径**（R27 判据 6：判据本身要先被证明量的是对的东西）。
- 变异样本**直接用本轮修掉的 6 处真实漂移**（即 `258f7b7` 的反向），不造伪样本。

### 新分支特有（搬迁与基建）

- [x] 从归档分支搬迁插件工程 `plugins/dsh-autogamer/`，**逐文件做 D20 清理**（方案见上方「搬迁-1」，2026-10-14 完成）
- [x] 工作树环境残留检测（D19 环境护栏）：`scripts/check-env.mjs` + `post-checkout`/`post-merge`/`pre-push` 钩子（方案见上方「基建-1」，2026-10-14 完成）
- [x] **G81 · 插件 spec 纳入类型检查**（2026-10-14 完成）：新增 `tsconfig.spec.json`（`noEmit` + `rootDir: .`
      + `allowJs`，覆盖 `src` / `tests` / `vitest.config.ts`）与 `typecheck` 脚本，并把 build+typecheck+test
      串成 `verify`。**存量 124 条类型错误清零**（`tsc -p tsconfig.spec.json` rc 0）。
      - 根因有两类，值的记：① **测试双件的 seam 没在边界收窄**——`exec()` 只有 `signal`、cordis 的 `on`/`plugin`/
        `createScope` 带宿主泛型、`Config` 被声明成 `object` 而它其实是个可调用的归一化器；
        ② `noUncheckedIndexedAccess` 下的索引取值。
      - **纪律修正**：我一度把 `Config` 在 **src** 里改成可调用类型以图省事，结果 schemastery 的 `Schema<>`
        不是函数型，在 src 里引出 5 条新错。**不该为迁就测试改生产类型**——已回退 src，改为在
        `tests/support/config.ts` 提供 `configOf` 收窄（测试边界才配做收窄，R21）。
      - **变异校验**（R27）：在 `tests/hierarchy.spec.ts` 插一行 `const deliberate: string = 42`
        ⇒ `typecheck` exit 2 并报出该行；移除后 rc 0 ⇒ 门禁会咬。
      - 收窄一律放在 seam（`exec()`、`on`/`plugin`/`createScope` 的局部 cast、`read()` 读取器），
        **不放宽 `strict` 与 `noUncheckedIndexedAccess`**，也没加 `any`。
      - 顺带修掉两处由我造成的脚本事故（批量替换误伤 `exec()` 函数体、`fields..type`），均已修复并复验。
- [x] **基建-2 · 文档门禁 TS 化**（2026-10-14 完成）：`scripts/check-docs.mjs` 六条检查 + `--selftest`（7 例变异，含 C5 双向）+ `.githooks/pre-commit`（文档范围触发，A/B 已实测）；`AGENTS.md` 已同步。范围与取证见 §七「基建-2」。
- [ ] 本分支的 `CHANGELOGS`（首次结案时新建，规则：`### #N` 三段、编号永不复用）

### T1 · 引擎去消费者（**G82**）· 方案（2026-10-14 立项，R22）

**What（范围）**

- `autogamer_run_task` / `autogamer_manage_task` / `autogamer_inspect_trace` 三条工具改为 **TS 原生**：
  不再经 `backend.startTask / manageTask / inspectTrace` 打外部 ARTEMIS 任务引擎（py 进程）。
  **G82 的 Done = py 引擎在插件侧无任何消费者。**
- 任务状态与执行步迹改为**由会话日志派生**（跨回合）。
- **契约面不动**：工具名、参数、输出字段、render 全部保持现状，只换实现与数据来源
  （判据是 `tests/fixtures/py-action-tools.json` 与 `deliveryShape.spec.ts`）。
- 范围外：`run_device_action` 的动作面（属 T2）、效果判定算法（属 T3）、外部 ARTEMIS 作为
  **可选提供方**的保留（属 §一.3 / T4）。

**R20 第 1 步「查」：查了哪份、原文怎么说**（上游 `deepseek-ai/deepseek-harness` @ `master`，只读取证面，未解包）

| # | 出处 | 原文（摘） | 对本方案的作用 |
|---|---|---|---|
| 1 | `skills/cordis-plugin-development/references/practices.md` 原则 1 | "The session log is the only source of truth. Anything the model sees must be reconstructable from committed session events; fork, resume, and replay derive from the log. **Plugin memory is a derived cache.**" | 执行主体交给 agent loop；插件侧只留**派生缓存**，不许自建真相源 |
| 2 | 同上「Performance」段 | "Keep per-session state derived from the log in a `ctx.sessionProjections` unit instead of subscribing to `session/event` and rescanning `session.events`. `apply(state, event)` is pure and synchronous and returns the same reference for events it ignores… Read with `stateOf()`." | 状态载体定案为 session 投影；禁 `session/event` 重扫 |
| 3 | `docs/subsystems/session-projection.zh.md`（`ctx.sessionProjections` 签名块） | `register(definition) => disposer`；`stateOf(session, key)`；`onChanged(listener)`；`snapshot`/`checkpoint` | 注册表 API 形状（**🔶 未在本机装好的宿主上核过**） |
| 4 | 同上「投影单元」段 | `ProjectionDefinition` = `key` / `stateSchema`(Zod) / `init(header, inheritedEventCount)` / `apply(state, event)` / `wire?` / `stateVersion`；"state MUST be plain JSON (the persisted-cache precondition)" | 单元形态与纯 JSON 约束；**推出 zod 依赖**（见 How-8） |
| 5 | 同上「快照与变更流」段 | `ProjectionChangeListener = (session, key, value, seq) => void`；"an object-valued view must reuse its reference to suppress publication" | **读路径走 `onChanged` 变更流**（见 How-4） |
| 6 | 同上 | "Contributors may preserve optional registration through `ctx.inject(['sessionProjections'], …)`"；注册是 effect，disposer 随调用方 fiber | 可选注册 + 自清理 |
| 7 | `practices.md`「Performance」 | "Wait on durable events such as `turn/end`, `assistant/message`, or `tool/result`… Do not poll `agent/status`." | 步迹的折叠源 = `tool/result`（durable） |
| 8 | `practices.md`「Performance」 | "A timer that starts work calls `agent.followup()`, which wakes the agent; `agent.inject()` does not wake it, so injected context can wait in the inbox" | steer 用 `inject`（调用者本就醒着）；唤醒才用 `followup` |
| 9 | `practices.md`「Stability」 | "Do not append session events with a new `type`… Derive state from existing events, or keep plugin-owned data in a storage service found through inspection." | 禁自造事件类型（R16 同源） |

**How（做法与关键决策）**

1. **执行主体 = DSH agent loop**（S11）：`run_task` 只登记任务并**立即返回** `task_id`（500ms 内），
   真正的设备动作由模型调 `run_device_action` 完成。不在插件里另造后台执行循环——那等于第二套 agent loop。
2. **状态载体 = `ctx.sessionProjections` 单元**（出处 2/3/4/6）。键自定（例 `autogamerTasks`），
   `state` 是 plain JSON：`{ tasks: { [taskId]: TaskRecord }, steps: Step[] }`。
3. **单元形态**：`init` 造空态；`apply` 是纯同步折叠，**不关心的事件返回同一引用**（出处 4，官方明文要求）。
4. **读路径绕开一个未证事实**：`stateOf(session, key)` 需要 `Session` 实例，而本插件的 `ToolExec`
   镜像只有 `signal` / `concludeTurn`（`src/dsh-types.ts:168`），R17 又称 `exec.agent` 存在——两者**都没在
   本机宿主上核过**（🔶 见 Verify）。因此读路径改走官方 `onChanged` 变更流：在 `apply` 期维护
   `sessionId → 投影值` 的缓存，三条工具只按 `sessionId` 读缓存。**这不是自建容器**（出处 1：插件内存本就是
   派生缓存；真相源仍是日志，重放时由注册表从日志重折叠）。
⚠️ **2026-10-14 实施中更正**：本条的前提写错了。`onChanged` **只为「客户端可见」单元推送**——文档原文是 "called once per **client-visible** unit whose raw view changed by `Object.is`"，且监听器的 `key` 类型被限定为 `SessionProjectionMap`。**host-only 单元（不声明 `wire`）永远不会推送**，照原设想实现会得到「折叠正确、但三条工具永远读到 `undefined`」的死路。
   ⇒ 单元**必须带 `wire.view`**；顺带让 Web Client 拿到成品值而不必自己折叠（分工正是 seam 的设计）。连带约束：`view` 必须复用引用，故取 `view(state) => state`（折叠已保证不关心的事件返回同一引用）。
5. **步迹来源 = `tool/result` 事件**（出处 7）：本会话 `run_device_action` 的结果折叠成 step
   （action / effect 三态 / category / incident / 时间戳）。`inspect_trace` 的 `summary|full` 复用现有
   `summarizeSteps()`（取边 + 失败步），语义不变。
6. **steer = `agent.inject()`**（出处 8）；**stop** = 任务标 `stopped`，并由**已有**的
   `ctx.tools.guard()`（同步单调拒绝，R13）挡住该任务后续的设备动作——不新造拒绝机制。
7. **失败方向 fail-open**：`stateOf`/缓存读不到、或投影未注册 ⇒ 任务工具返回 `state: "unknown"` 而非报错，
   与 G84 记录的 `compare_ui_frames` fail-open 方向一致。
8. **依赖 `zod`**：`stateSchema` 是 `ZodType`（出处 4）。
   ⚠️ **2026-10-14 更正**：原写「新增依赖 zod」是**错的**——实测 `plugins/dsh-autogamer/package.json`
   的 `dependencies` **已含 `zod ^4.6.5`**（`node_modules/zod` 在位），切片 3 **不需要新增依赖**。
   另实测：`zod` **已被引用**——`src/task/projection.ts` 的 `stateSchema` 与 `wire.viewSchema` 就是 zod schema。
   ⚠️ **2026-10-14 二次更正（R28）**：这一行原先写「`zod` 目前**全仓零引用**（src / tests / scripts 全无 import），属已声明未使用的依赖，
   是否清理由 T4 收尾时一并裁定」——那句成文于 `6afc9ed`，而**下一个实现提交 `1fb3605`（切片 2）就落地了 `projection.ts` 并 import 了 zod**，
   当时没回改，属「新事实推翻旧行、旧行还在」的形态，本轮按 R28 就地更正。
   因此 T4 收尾时**不得**把 zod 当「已声明未使用」清理掉。复跑判据：`grep -rn 'from "zod"' plugins/dsh-autogamer/src`（非空即成立）。
9. **可选注册**：`ctx.inject(['sessionProjections'], …)`，注册表缺席时插件照常挂载（出处 6）。

**Verify（验收命令）**

- **契约锁 + 变异校验（R27）**：三条工具的 spec 注入「一调用就抛的 fake backend」，断言 `execute` 路径零调用；
  然后**故意**让 `runTask` 调一次 backend，确认该 spec 变红 ⇒ 证明这条锁会咬。
- **折叠单测**：用合成事件驱动 `apply`，覆盖五语义：登记任务 / 步迹追加 / effect 三态（changed·unchanged·unknown）/
  stop 后不再计步 / **不相关事件返回同一引用**（`Object.is`）。
- `pnpm --config.verify-deps-before-run=false run build`（tsc rc 0）；
  `pnpm --config.verify-deps-before-run=false run test`（vitest 全绿）。
- `node scripts/check-env.mjs` → exit 0；`git ls-files '*.py'` 为空。
- 🔶 **live（阻塞于前置-1 的设备环境，本机做不了）**：`cordis_inspect_query` 核 `sessionProjections`
  的真实签名与 `onChanged` 载荷形状；按 R7 开新会话跑一条完整任务，终态双轴正确。
  在此之前，所有宿主交互一律按 R21 标 🔶（仅单测 / 未 live 验证）。

**Done means**

- [ ] 三条工具零外部进程调用（契约锁 + 变异校验通过）
- [ ] 任务状态与步迹由**会话日志派生**，无自造事件类型、无自建真相源
- [ ] 折叠纯函数与三条工具的 spec 全绿；`tsc` + `vitest` 全绿
- [ ] zod 依赖落定并记入插件 `package.json`
- [ ] 🔶 live 绑定核验（R9 + R7）——**阻塞于前置-1 的设备环境，不在本机可完成范围内**

### T1 · 引擎去消费者（**G82**）· 进度

- [x] 落自足条目（What / How / Verify / Done）并按 R22 先提交方案（`ab3c3c3`，含 R20 九条一手出处原文）
- [x] **切片 1 · 日志折叠**（2026-10-14）：`plugins/dsh-autogamer/src/task/fold.ts` + `tests/taskFold.spec.ts`（13 锁）
- [x] **切片 2 · 三条工具接线**（2026-10-14）：`run_task` 本地铸 `task_id` 并即时返回；`manage_task` 读折叠状态（status / stop / steer，steer 走 `agent.inject` 而非 `followup`，R17）；`inspect_trace` 读步迹（summary = 取边 + 失败步）。三者的 `presentationMeta` 补上折叠需要的卡片（`run_task` 的 `taskId`、`manage_task` 的 `state`）。**`ArtemisBackend` 接口与 `mcpBackend` 实现已删除 `startTask` / `manageTask` / `inspectTrace` / `mapStep`** —— 引擎在**类型面与实现面都不再可达**，G82 的「无消费者」由结构保证，而不只是调用约定。
- [ ] 切片 3 · 宿主绑定（🔶）：`ctx.inject(['sessionProjections'], …)` 注册单元 + `onChanged` 维护 `sessionId → 值` 缓存 —— **代码已写**（`src/task/projection.ts` + `src/task/cache.ts`，9 条锁），真实签名与「自定义 key 是否被接受」待 `cordis_inspect_query` 核验
- [x] 跨回合任务状态载体定案 —— session 投影 + `onChanged` 派生缓存，真相源仍是日志，无自建容器（🔶 绑定待切片 3）
- [x] 三条工具不再调用任何外部进程 —— 契约锁 `tests/taskSurface.spec.ts`（11 条）；变异校验：故意把 `deps.backend` 塞回 `run_task`，该锁**恰好 1 条变红**、其余 10 条仍绿 ⇒ 会咬
- [ ] R7 真机跑一条完整任务，终态双轴正确 —— **阻塞于前置-1 的设备环境**
- [x] **Done：py 引擎无消费者** —— 离线可证的范围内成立（类型面 / 实现面 / 契约锁三重）；live 侧（`inspectCompositions`、roster 诊断）仍待宿主会话核验

**切片 1 的实测记录（当轮落账，R27/R28）**

- **新增发现（决定了折叠的读源）**：本插件**早已把机器可读事实写进 `tool/result.meta`**
  （`runDeviceAction.ts` 的 `presentationMeta` → `effect`/`category`/`incident`；
  `reportTaskStatus.ts` → `status`/`tests_failed`/`outcome`，注释标 P1-b / R16）。
  ⇒ 折叠**只读 `meta`**，不解析模型可见文本；文本是散文，`meta` 才是声明过、经 JSON 校验、能重放的卡片。
- **事件形状不靠猜**（R25）：`tool/call` / `tool/result` 的载荷取自 `docs/subsystems/session.zh.md` 的
  `SessionEventMap`；配对字段 `message.toolCallId` 取自**已安装** `@deepseek-ai/dsh-llm`
  `lib/types/message.d.ts:153-160`（`ToolResultMessage.toolCallId: ToolCallId`，配 `tool/call.callId`）。
- **既有锁自己咬了一次**：`tests/readmeLayout.spec.ts`（README Layout 必须覆盖每个 `src/` 模块）在新模块落地时变红，
  补 README Layout 行后转绿——证明该锁不是虚的。
- **变异校验**（R27）：把 `applyTaskState` 的「非 `tool/result` 事件返回同一引用」改成返回新对象，
  `tests/taskFold.spec.ts` **恰好 1 条变红**（`an event of another type folds to the SAME reference`，
  其余 12 条仍绿）⇒ 这条锁会咬。回退后全量 **33 files / 306 passed / 1 skipped**，`tsc` rc 0，
  `node scripts/check-env.mjs` exit 0。
- **未定论（留待切片 2/3）**：`run_task` 目前**没有** `presentationMeta`，折叠读的 `meta.taskId` 尚无产出方；
  切片 2 补上后这条链才闭合。另外 🔶：`ToolExec` 镜像只有 `signal`/`concludeTurn`
  （`src/dsh-types.ts:168`），工具执行期能否直接拿到 `Session` 实例**未在宿主上核过**——
  方案 How-4 已用 `onChanged` 绕开该依赖，但绑定仍需 live 核验。

**G81 量化（2026-10-14 实测）与顺序更正**

- **基线**：把 `tests/` 纳入类型检查（临时 config：`noEmit` + `rootDir: .`）⇒ **124 条存量错误**。
  本切片新 spec 曾贡献 18 条，**已用自己的取值收敛助手修掉**（`0f951cd`），不降低严格度。
- **分布**：`apply.spec.ts` 45（36%）、`conformance/contracts.spec.ts` 15、`getDeviceState` 8、`dedup` 7、
  `diagnose` 7、`scopeVisibility` 6、`followup` 5、`runtimeBoot` 4、`liveObservation` 4、其余零星。
  错误码以 `TS2345`(37) / `TS2532`(36) / `TS2349`(29) 为主，多为 `noUncheckedIndexedAccess` 与
  测试假件的签名宽松所致。
- **顺序更正（原建议「先 G81 再切片 2」是浪费）**：其中 **13 条落在 `runTask` / `manageTask` / `inspectTrace`
  三个 spec**，而这三个 spec 正是**切片 2 要重写的对象**——先修等于修两遍。
  ⇒ **改为：切片 2 → 再做 G81 全量扫**（G81 顺带要落一条 `typecheck` 脚本把 `tests/` 纳入常设门禁）。

**挂载自证（2026-10-14，用户放行「只做挂载自证、不建 profile」）**

- ✅ **R6 组合面通过**：`dsh --profile web --patch <abs>/plugins/dsh-autogamer/cordis.patch.yml --dump-config`
  ⇒ **rc=0**、输出 **0 处 `unmatched`**、`preset-autogamer` 行存在且 `config.plugins` **7 行非空**
  （`persona` / `dsh-autogamer-inner` / `tool-jobs` / `tool-cordis` / `skill-filesystem` / `tool-skill` /
  `tool-plugin-manager`），根行 `dsh-autogamer` 在位。**R3 判据（preset 行存在 + plugins 非空）满足。**
- ❌ **不证明生效**（R9）：`enabled` / `fiberPhase` / `Config.listConfigs` / `Tool` 列表 / `leakedServices`
  都是**真实挂载后**的运行时事实，本轮拿不到——**结构性不可得**，不是没查：
  `dsh-autogamer` 包**未安装**进 `web` profile（`node_modules` 无该包），而 R2/D17 规定交付必须走
  `install_bundle` 或侧边栏「插件」面板，两者都要 agent 会话。`dsh plugin` 只是 pnpm 垫片，R2 明禁在
  profile 目录跑包管理。⇒ 五项仍为 🔶。
- ⚠️ **更正上一轮的一处高估**：我当时把 `enabled`/`fiberPhase` 等列进「只放行挂载自证」也能拿到，
  那是错的——`--dump-config` 只给组合面。已按实测口径改写。

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

- [ ] **按前置-4 结论收窄配置面**（**G85+G86 交叉，不可当小事放过去**）：
      删 `artemisRepoPath` 的 cwd / `pyproject.toml` 探测 / `uv project` 三种 py 语义与 `uvPath`；
      `artemisMcpCommand` 保留但写明「不内置、不 vendored、不为其开开发依赖」；
      **rules 注入必须改指向我们自己拥有的来源**（插件内固定文本，或我们自己定义的外部文件项）——
      不得继续读 `<外部仓库>/mcp_server/rules.md`（D20：上游 prompt 正文不得进本项目模型面）
- [ ] **preflight 七项重画**（前置-4 §四）：提供方未配置 ⇒ 那几项**跳过而非失败**，
      只让设备面三项（adb / adb-devices / helper）当 gate；保持三条失败语义不混
      （注入 fail-open / 体检 gate / backend lazy spawn）
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
