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
- **阶段：T1–T5 全部落地，宿主内 live 证明已完成（2026-10-15）**。插件工程已搬入（搬迁-1）；T1 的三条任务工具、T2 的十五工具面、T3 的效果判定、T4 的收尾与溯源清理、T5 的内置 OCR 均在 TS 侧，`verify` 全绿；
  **宿主内真会话已跑通**（R6/R7/R9/R24 四条读数：面板 2/2 运行中、`Config` 返回 `status:"schema"`、七个工具对模型可见、会话日志 7 次工具调用与 7 次结果），权威记录在 CHANGELOGS **#97**。
  本文件 §四 只剩三条**非待办**行：**G92**（OCR 整页召回——已量过并否证简单方案，解法「按区域识别」已**立项于 §七，探针 A 离线管线已落地、探针 B/C 待设备**）、**G88 / G78**（清点后判为无消费者的**待需求**，不是没做完）。
  **读数不写死**（R28 判据 4）：复测 = 在 `plugins/dsh-autogamer/` 跑 `pnpm --config.verify-deps-before-run=false run verify`（三段脚本的形状与 `build` 的差别见 `AGENTS.md`「命令」）。
  全部 py 实现均不在本分支（按 D19 归零）。
- **环境残留护栏（2026-10-14 落地，基建-1）**：本机从旧 fork 切到 orphan main 后曾残留约 1 GB 旧栈（`.venv` / `__pycache__` / 旧 `apps/node_modules` / `traces` 等，均被 `.gitignore` 忽略、`git status` 干净），已清理。检测固化为仓库规则：`scripts/check-env.mjs`（H1 被跟踪 py 硬失败 / H2 工作树 py 栈残留失败 / NOTE 仅列运行数据，白名单 `node_modules`/`dist`/`.git`）；`.githooks/post-checkout` 与 `post-merge` 切分支/拉取后跑检测、**只警告不阻断**；`pre-push` 追加 H1 硬拦（拒绝推送被跟踪 py）。A/B 已实测，新环境拉取流程见 `AGENTS.md`「新环境拉取」。
- **基建-2 已落地（2026-10-14，提交 `f9434cf`）**：`scripts/check-docs.mjs` 六条检查（结清一致性 / 链接可解析 / 派生计数只认权威 / 编号范围自算 /
  表格成形 / 自称完成不得留未勾验收项）+ 内置 `--selftest` 变异（7 例，含 C5 的合法 `\|` 反向例，全不盲）+
  版本化 `.githooks/pre-commit`（**仅文档暂存时**触发；A/B 实测：带漂移提交被拒 `exit 1`，`--no-verify` 才通过）。
  **手工变异**一次五处并行（C2–C6）→ 恰好 5 条 finding、各对应一条检查；C1 另单独变异一次（注入 G81 行 → 1 条、指向正确行）。
  `AGENTS.md` 的「**文档门禁暂缺**」已改写为现状——门禁是**本地钩子 + 手跑**，本分支无 CI，**不许写成「由 CI 保证」**（R27）。
  ⚠️ 已知盲区（本轮实测）—— **两条已由 基建-6 分头处置（2026-10-15），本段保留作判据来处**：① 门禁**抓不住**「§零 状态行说未开工、而跟踪行已勾完成」这类**同一事实的两处状态不一致**（它就是本行上一版的样子）；② **也不查 §四 表内编号唯一性**——已实测：把 §四 一行的编号重复一次，门禁仍 `OK` / exit 0，撤掉后照旧，所以这是**真的会漏**的判据缺口。当时写的是「要覆盖这两类须各加一条检查，属后续项」，该句**已作废**：
  ② 已补为门禁第 **7** 条检查 **C7「§四 编号唯一性」**（CHANGELOGS **#104**）；① **清点后判定不写** —— 今天全仓**零不一致样本**（唯一两个未全勾的条目 交付-1 / G92，其 §零 指针行都如实写了阻塞与待设备），没有样本的判据是永不红的假判据（R27），且条目名**两种形状并存**、`T1`/`T2`/`T3` 各有**两个同名小节** ⇒ 按名配对天然脆。判定与清点证据见 §七「基建-6」。
  （自我更正一笔：这句初稿引的是「我改 G76 时造出重复行、门禁全绿」——但那次我**并没有在重复行还在的时候跑过门禁**，属自己反对过的未证 claims；已改成上面这种实测过的口径。）
  范围与取证见 §七「基建-2」与「基建-6」。
- **基建-3 已落地（2026-10-15，提交 `9dea904`）**：拉取 T5 后首次装依赖，pnpm 11 报 `ERR_PNPM_IGNORED_BUILDS` 并 **exit 1**，且**顺手改写了被跟踪的** `plugins/dsh-autogamer/pnpm-workspace.yaml`（写入 `tesseract.js: set this to true or false` 占位行）。该 `postinstall` 的实质是赞助横幅（`opencollective-postinstall || true`）、无产物，而 OCR 语言数据随包 vendored ⇒ 定案 `allowBuilds: tesseract.js: false`（**保留** `esbuild: true`，vitest 要它的原生二进制）。安装现 **exit 0**、不再改写仓库文件；同机同 lockfile 的 A/B：占位形态 exit 1 / 定案形态 exit 0。`build` rc 0、`test` **38 文件 / 439 通过**。🔶 当时还记了一笔「**pnpm 版本未钉**」的债 —— **已由 基建-4 结清**（`packageManager: pnpm@11.21.0` + `pmOnFail: error`，CHANGELOGS **#99**）：版本不符现在一律 exit 1。范围与取证见 §七「基建-3」与 CHANGELOGS **#98**。
- **基建-4 已落地（2026-10-15，提交 `6e30db2`）**：把上一条那笔债结清 —— `package.json` 声明 `"packageManager": "pnpm@11.21.0"`（精确版本、无 hash），`pnpm-workspace.yaml` 声明 `pmOnFail: error`。**版本不符时每条 pnpm 命令直接 exit 1**（`install` 与 `pnpm -v` 都实测过），且失败发生在任何下载/改动之前。A/B：`pnpm@9.15.0` ⇒ exit 1 + `This project is configured to use 9.15.0 of pnpm`；改回 ⇒ exit 0 且 **lockfile 零变化**。选型依据取自官方文档：`pmOnFail`（v11 新增，默认 `download`）取代了已移除的 `managePackageManagerVersions`/`packageManagerStrict*`；**选精确版本而非范围**，因为范围正是把「不同机器结论不同」那个洞重新打开；**选 legacy 字段而非 `devEngines.packageManager`**，因为后者会把解析版本写进 lockfile；**选 `error` 而非默认 `download`**，因为后者是静默的网络下载 + 版本切换。本机 `corepack` 未装，故不依赖它。已知边界：钉在插件工程，**从仓库根跑 pnpm 不受约束**；升版流程与误配处置写在 `AGENTS.md`。`verify` **38 文件 / 439 通过**。范围与取证见 §七「基建-4」与 CHANGELOGS **#99**。
- **基建-5 已落地（2026-10-15，提交 `d524739`）**：把上一条那条「`.npmrc` 死配置无害」的判断**推翻并修好** —— 实测有效默认是 `true`、lockfile 记的是 `false`，于是**裸 `pnpm install --frozen-lockfile` 一直 exit 1**（`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`）。修法：设置搬进 `pnpm-workspace.yaml`（`autoInstallPeers: false`，设置真正被读的那份文件），`.npmrc` 整份删除（全文只有那一行、25 字节、不在 `files` 里）。读数：`pnpm config get autoInstallPeers` → `false`（改前 `undefined`）；裸安装 **exit 0**；文档命令 exit 0；`verify` **38 文件 / 439 通过**；lockfile 全程零变化。**单变量隔离**：把 `.npmrc` 那行临时写回，裸安装仍 exit 0 ⇒ 生效的是文件里的设置，删它去的是重复声明。探针两向证明该设置有牙（自动装入的 peer 只进虚拟 store、不做顶层链接 —— 第一版判据看 `node_modules/react` 是**假绿**，已改读 lockfile）。设置的家写进 `AGENTS.md`。范围与取证见 §七「基建-5」与 CHANGELOGS **#100**。
- **packed bundle 交付验证已落地（2026-10-15，交付-1）**：`pnpm pack` 出 tarball 后经 web profile 面板完成真实安装（非 link）——**唯一成立的交付形态是面板直接输入 `.tgz` 路径**（`file:` 复制安装，30 依赖落位）；解压目录安装是 `link` 且不装依赖，精简目录必然 `failed to import`（已实测失败）；每个新 profile 首次安装必遇 `tesseract.js` build script 授权（R19 用户点，postinstall 仅赞助横幅，「无产物」裁决见 §七「基建-3」/ CHANGELOGS **#98**，此处为第三来源实锤）；替换安装后**必须重启宿主**。重启后 **2/2 组件运行中**，双语 locale 标题/描述与 icon 浏览器实测正确，R6 `--dump-config` exit 0 / unmatched 0 / autogamer 行 10。验证中抓出构建缺陷——**tsc 增量输出不清理，5 个已裁决删除模块（actionClient/mcpText/rulesInjector/scrcpy×2）随 tarball 分发**，已修（构建前 `clean-dist` + 陈旧产物守卫），见 CHANGELOGS **#101**；`verify` 新读数 **39 文件 / 440 通过**。
  ⚠️ **C 项（三任务工具宿主内点名）阻塞**：本机当前无 `adb`、无设备（D 盘已不在、无模拟器、无监听端口），preflight 闸门要求 adb + 一台 `device` 状态设备，需用户提供真机或模拟器；完整记录见 §七「交付-1」。
- **G92 探针 A 已落地（2026-10-15，离线，CHANGELOGS #102）**：区域 OCR 管线 `src/ocr/image.ts`（裁剪/最近邻放大/PNG 编码，零依赖）+ `src/ocr/regions.ts`（层级叶级候选→裁剪 padding 8→@2×→逐块 recognize→坐标映射回全屏，预算/signal/fail-open）。新增 3 测试文件 26 条；真模型夹具实测 16 候选全在 y≤204、16 块 ≈1457ms、命中均落回候选框（映射不漂），并**实证 P1 对层级缺席的渲染区（y≈240 缩略图）无效**（P1 对 TapTap/游戏中心 undefined，整帧命中），强化 P2/P3 必要性。三处变异（坐标映射/容器过滤/fail-open）各红一次；本轮**未接产品阶梯**。`verify` 新读数 **42 文件 / 466 通过**。探针 B/C 与 C 项共用同一设备前置（adb + 设备），G92 不结案。
- **基建-6 已落地（2026-10-15，CHANGELOGS #104）**：把基建-2 自测时记下的**两条门禁盲区**分头处置 —— ②「§四 表内编号唯一性不查」补为门禁第 **7** 条检查 **C7**（`checkGapIdUniqueness`；C1 把编号收进 `Set`，结构上就看不见重复）；①「同一事实两处状态不一致」**清点后判定不写**：今天全仓**零不一致样本**（唯一两个未全勾的条目 交付-1 4/5、G92 3/8，其 §零 指针行都如实写了阻塞与待设备），且条目名两种形状并存、`T1`/`T2`/`T3` 各有两个同名小节 ⇒ 按名配对天然脆。**没样本的判据是假判据（R27）**，故记判定不占编号，将来有真实样本再按记录的清点法走。
  变异：**M8-C7**（结构锚点＝整行复制，不点编号不碰散文）`--selftest` 里 `ok -> C7 1 finding(s)`；**真实文件手工变异**（`G78` 行改成 `G92`）⇒ exit 1 且 finding **指被改的那一行**（报出首次出现行号），改回 exit 0 且 diff 零差异；那次变异**未**触发 C1 ⇒ 两条检查职责边界符合预期。门禁 **7 checks / 8 变异无假绿**，`check-env` exit 0，插件 `verify` 读数不变（本片不动插件代码）。范围与取证见 §七「基建-6」。
- **守则时效校正已落地（2026-10-15，CHANGELOGS #105）**：跑 R11 的版本判据（`gh api … /releases`）时查出**两条守则自身已过期/失效**，当场改掉：
  ① **R11 只记到 alpha.2，而上游 2026-10-14（前一天）已发 `dsh-v0.2.1-alpha.3`** —— 且 `check-docs` 七条检查里**没有一条查版本**，这条判据只能靠人记得跑，这正是它会腐烂的原因（已把该事实与两条相关 release notes 写进 R11）。
     alpha.3 有一条**直接触及本插件**：「修复插件更新或重新安装后仍运行旧代码的问题，启用热重载时可直接生效、不能热重载才提示重启」⇒ 交付-1 那条「替换安装后必须重启宿主」是 **rc.2 上的实测**，插件 README 已加版本限定（别在新版上无条件重启）；另一条「子智能体可选独立 Agent Preset」与本插件 preset 面相关。**升不升 alpha.3 是人的决定**（按 R11，升则全部 conformance fixture 视为过期、live 证据要在新版本上重跑）。
  ② **待补清单第 3 项里有一处路径是凭印象写的**：`docs/dsh-tool-call-timeout-policy` 一查 **404**；真实路径是 **`packages/guard/timeout-policy/README.zh.md`**（**包名 `@deepseek-ai/dsh-tool-call-timeout-policy` 未变**，只是仓库路径挪到了 `packages/guard/` 下）—— 这条本身就是 R20「不许凭印象引用」的现成案例。
     同轮用 `gh api contents` 把待补清单五份文档**逐个核实存在**并记下实测字节数（`capability-seams.md` 65092 / `tool-catalog.md` 102356 / `jobs/README.zh.md` 10059 / `subsystems/scope.zh.md` 3763）⇒ **它们全都可取回，纯读、零设备**。
     另给第 5 项（R14/R15 的真实字段名）补了一条**更省的路**：开宿主会话要模型凭据，而上游公开仓库的 `packages/guard/timeout-policy/types` 与 `packages/core/tools` 可能直接写着 ⇒ 先读声明面，查不到才回到 `cordis_inspect_query`。
- **⚠️ 本轮我自己犯了一次 R25（跨作用域外推），留着当复发样本**：`capability-seams.md` 里 `ctx.slots` **0 命中**，我据此写下「将来做 UI 必须重新查真名」，
  **差一步就推出「client 插件可能挂不上」**。错在：`capability-seams.md` 画的是**宿主侧** `ctx.*`，而 `client.js` 跑在**浏览器**里、client 侧有自己的 `ctx` ⇒ **「宿主图谱查不到」根本不构成「该服务不存在」的证据**。
  正确查证方向是 client 侧（浏览器 console / `cordis_inspect what:"client"`），不是宿主图谱；而 `client.js` 的形状本就**逐字取自官方 decoration 模板** ⇒ 有官方出处。
  **它意外挖出的真缺口是另一件事**（这条才是有价值的）：`git grep -n "clientHalf.spec" -- plugins` 只命中 `client.js` 自己的注释 ⇒ **那个 spec 已在 T4（`3677a49`）被删**，
  而 `client.js` 仍在交付面里（`files` / `exports` / `dsh.client`）并为 5 个工具注册 `tool.call.toolview` 卡片 ⇒ **零自动化锁 + 注释指向已删文件**。
  ⇒ **新立 G95**（§四），处置见该行：写回一个只锁结构事实的小 spec + 修掉注释里那句谎话。**删它的理由不适用** —— `client.js` 不是 provider 链成员。
- **能力重审-2 已落地（2026-10-15，方案 `ef617ec` → 实现与结案 CHANGELOGS #112）**：元素源的 **UiAutomation 占用者第一次有了名字** —— `readUiAutomationOccupants`（`ps -A -o PID,ARGS` + 四个具名 marker）返回**三态** `occupied` / `free` / `unknown`，接到 `autogamer_diagnose` 的新 `hierarchy` 栏（render 只在问过之后出现）。
  一手机制补进台账：`UiAutomationConnection.connect()` 同时刻只容一个客户端，而 **`uiautomator dump` 自己就是占位者**且 `connect()` **无参**⇒默认压制 a11y 服务、**无 flag 可免**（⇒ §七「前置-2」互斥行的轴已重划）。
  ⚠️ **`unknown` 不是装饰**：`-o PID,ARGS` 的列布局**本仓从没量过**（ledger 只有裸 `ps -A` 的读数）⇒ 解析不到 marker **绝不许答「没人占」**（没有证据的健康证明比不报更坏）；收窄这一态**必须等真机复验**。
  一处偏离方案并已记账：接线在**诊断面**（可选 dep，照 `ocrStatus`/`provider` 形状）而非失败路径 —— 后者会把这条读落进阶梯的 **3 次重取**里，且占用者是设备属性不是本次调用的属性；顺带**既有 39 条 diagnose 锁一条没动**。
  另改掉两处「注释指向不存在的锁」（`preflight.ts:49` 的 `contracts.spec` **不是文件**，真锁 `preflight.spec.ts:76-77`，其中 `:76` 比导出常量会**自愈**、`:77` 的字面量 `[true, true]` 才锁住数量；`tools/diagnose.ts` 的未用 `requireEnv` import 已删并补**源码结构锁**——该锁第一次跑就**红在本轮自己新写的注释**上，实证有牙）。
  三条变异实测计数**与方案的「恰好一条红」不符**（①1 红、②3 红、③3 红，成立的是「各红自己那面、不连坐」），已按实测改判并记在 #112。新增 18 条；`verify` **44 文件 / 497 通过**。只读零副作用：不 `kill`/不 `force-stop`/不卸载（R19）。
- **能力重审-1 已落地（2026-10-15，方案 `95c536a` → 实现 `3884bd3` → 结案 CHANGELOGS #111）**：六面重审交回的项里，先做**零授权、离线可判、且不引入新退化**的三条 ——
  ① abort 从 `task` 收成**第四类 `cancelled`**（两侧都不记账；方案原文「统一为 `environment`」被 `breaker.ts:56-63` 的 `allowedFails=1` 否决：**用户按一次停止键就锁死后续全部动作**）；
  ② `wait` 上限 `WAIT_CEILING_MS = 30_000` **低于**声明的 45s、超限拒绝而非钳制、睡眠观测 signal（`duration_ms: 50000` 曾让内部台账与模型可见答案**必然相反**）；
  ③ `resolveScreenSize` / `captureFrame` 两缝补上 `signal`。⚠️ 重审建议「删掉两处 `timeoutMs` 声明」被本仓**否掉**：删后模型最坏等待 **45s → 204s**。
  🔶 **两条锁被变异当场证伪**（abort 分类锁挂在够不到的分支；signal 锁因 `signal?` + 只记 argv 的记录器而结构上无法生效 ⇒ `fakeAdb.signalSeen` 断言**身份**）；
  ⚠️ 本条台账的**第一次落账失败**（`oldString` 引了文件里不存在的 `## 四 · 附录`）而实现提交已进库 —— 教训同 R24：**工具调用发出 ≠ 改动生效**。
  `verify` **44 文件 / 479 通过**（结案时复跑同读数）。六面重审的其余结论**全部落账在 §七「重审综合」**（含三条否证与四条「现在就做」候选）。
- **PSM 这条路已查实并否掉（2026-10-15，联网调研 + 离线实测，CHANGELOGS #110）**：`tesseract.js` **支持** `tessedit_pageseg_mode`（`SPARSE_TEXT=11` 的上游语义正是「跳过版面分析」），
  而这是本分支从未考虑过的设计空间，所以查了。实测（两帧 × 六种设置，**每格独立 worker**）：
  **合成难帧上所有 PSM 都读不出 needle** ⇒ **「关掉版面分析让引擎自己找」不成立**，P1/P2/P3 的方向**没有被推翻**。
  ⚠️ 附带一条对未来有用的陷阱：**显式设 PSM 3 比不设更差**（前者 miss、后者 HIT），而枚举里 `AUTO='3'` ⇒
  **`setParameters` 不是可靠旋钮**（worker 脚本在 recognize 前后有 Save/Restore 参数），将来谁想调 PSM **必须先证明它生效**。
  ⚠️ 本轮**四次修正了自己的测量**（复用 worker + 语言顺序写反 → 仍复用 worker → 怀疑状态污染 → 独立 worker 才是干净读数），
  **前三轮数字全部不可用**；那个「PSM 11 HIT」的好消息若直接落账，就是把污染读数当设计依据。
- **设备前置已查清（2026-10-15，调研，见 §七「设备前置调研」）**：那三件「需要设备」的事**能不能用 mock 顶掉**，答案是**机制层能、live 层不能**；
  而「需要设备」本身的措辞**修正过一次**：本机虚拟化**已启用**、32 GB RAM、712 GB 空闲磁盘、`winget` 里 Platform Tools 与 Android Studio 都可装
  ⇒ 卡的是**安装**（R19 授权面 + 数 GB 下载），不是硬件能力。**成本最低的解锁路径**：Platform Tools（~10 MB）＋ 用户自己的手机开无线调试。
  ⚠️ 本轮踩到读数陷阱：`Win32_Processor.VirtualizationFirmwareEnabled` 报 **False**（hypervisor 接管时按设计如此），
  照它会答成「本机跑不了模拟器」；**可靠来源是 `systeminfo` / `Get-ComputerInfo`**（两者一致：已启用）。这是 R25 的又一条样本。
  同时查实：**三个任务工具全部过 `requireEnv`**（`runTask.ts:110` / `manageTask.ts:114` / `inspectTrace.ts:95`）
  ⇒ **交付-1 C 项无法用 mock 替代**（没有设备必被 preflight 挡）；而 `report_task_status` **不过 preflight** 且声明 `timeoutMs: 5000`
  ⇒ 超时两层机制的**离线验证**可行（需加一个 devDependency，属授权面）。
- **G92 合成难帧已落地（2026-10-15，离线，CHANGELOGS #108）**：G92 方案 Verify 里那条标「可选」的离线项完成 —— 零依赖生成器 `scripts/synth-hard-frame.mjs` 造出**整帧读不出、区域识别读得出**的合成帧（41 KB）+ 配一份恰好一个叶级候选框的合成层级，
  落 2 条**成对**真模型锁（① 帧确实是难的；② 区域扫到且映射回全屏的落点落在那个候选框内，候选数实测 = 1）。**只证机制可用，不替代真机召回数字**（探针 B/C 仍需设备）。
  **三条否定结论先立在前头**（都是实测，别重试）：① 「把好帧标签缩小再贴」全档 miss —— 缩小在像素层摧毁字形，@2× 救不回来；
  ② 「夹具自带难帧」不成立 —— 夹具是「整帧 ⊇ 区域」，与 G92 要的方向相反；③ 「放大标签让整帧能读」也不成立 —— 放大 5 倍整帧仍读不出，
  ⇒ 由此**收窄夹具的代表性**：它复现的是「散乱背景 + 孤立文字块」，与真机满屏混排不同构。
  **参数表（探针 B 的离线预演）**：`scale=1.5` 每个 padding 都 miss、`pad=24` 全 miss、默认 `scale=2` 依赖 `pad≥8` ⇒ **不改默认值**（一块标签一个位置不构成改常量的依据）。
  ⚠️ 变异①第一版**是绿的**：spec 里 `scale: 2` 写死字面量、没引用 `DEFAULT_REGION_OPTIONS`，改默认值对它零影响 ⇒ 改成读默认值后才红。
  这是 R27 判据 6 的教科书形态（锁不虚，是**改动没进到被执行的路径**）；不真跑一次就会照错误结论去「重写一条好锁」。
  `verify` **44 文件 / 474 通过**。详见 §七「G92 · 合成难帧」。
- **G95 已结清（2026-10-15，CHANGELOGS #107）**：`client.js` 的浏览器半边锁**恢复**，六条断言一条没改即全绿 ⇒ 反证 `client.js` 与 manifest 半边自 T4 以来未动。
  根因是 T2-f 清点时把「`clientHalf` / `mcpBackend` 规格」**混称**，T4 据此把 `tests/clientHalf.spec.ts` 当 provider 链规格连坐删除（`3677a49`），
  而它锁的是 `client.js`（交付面里、R18 路线唯一实现）⇒ 该文件一度**零锁**，且头注释还写着「locked by tests/clientHalf.spec.ts」= **指向不存在的文件**。
  三条变异各红一次且恰好一条红（删一个 wire key / 加 `require('lodash')` / 从 `files` 去掉 `client.js`）；注释已改成事实并**写明锁的边界**（锁结构，**不证明卡片在浏览器渲染过**——五个工具全过 `requireEnv`，那条 🔶 需设备）。
  ⚠️ 本轮两处自纠：① 恢复时用 PowerShell 重定向把文件写成 **UTF-16**，esbuild 报错长得像代码问题、实为编码问题 ⇒ 正解 `git checkout <commit> -- <path>`；
  ② 方案里那条闭环判据我**假设** spec 会自指文件名，实测只有 1 处命中 ⇒ 改成「注释指向的文件是否存在」（`Test-Path` 修复前 False / 修复后 True），**判据要能红才算数**。
  `verify` **43 文件 / 472 通过**（+1 文件 +6 条）；`check-docs` / `check-env` exit 0。详见 §七「G95」。
- **调研-1 已落地（2026-10-15，CHANGELOGS #106）**：把守则「待补清单」里那五份从未读过的上游文档读完并回写，**本轮推翻了我上一轮自己写下的一个判断** ——
  R15 原写「包装层未接」，实测**是错的**：上游 `packages/guard/timeout-policy/` 写明该包装层**零配置、随 `dsh` 基础组合默认启用**，
  且本机 `dsh --profile web --dump-config` 的组合树里确有 `- id: timeout-policy`（**无 `disabled`**）⇒ 我们不是选择不接，它是默认就在。
  ⇒ **现状是「外层兜底 + 内层自实现」的嵌套**（外层对声明了 `timeoutMs` 的工具设 deadline：`run_device_action` 45s / `report_task_status` 5s；内层 adb / OCR / provider backend 各自自实现），不是重复实现；
  🔶 **两层同时计时的情形一次都没量过**（#97 的 live 里工具都正常返回）⇒ 量到之前不许写「两层不冲突」，要实测需设备。
  ⚠️ 核验时踩到 R25 老坑：紧邻上一行 `@deepseek-ai/dsh-tool-workflow` 带 `disabled: true`，不读上下文就会把它错安到 timeout-policy 头上、得出相反结论。
  其余四条结论：**R14** 的并发读侧入口是 `executionMode()`（声明侧是我们已在用的 `isConcurrencySafe`，已随七个工具 live 验证）⇒ 台账原写「必须用 `cordis_inspect_query` 取真名」**多余**，先读上游声明面即可；
  **scope** 是库原语、`ScopeKey` 按对象身份比对、`Scope.dispose()` 是完全停稳边界（印证我们 `{ global: true }` 的用法）；
  **jobs** 归属当前 agent 会话、跨 agent 不可见不可停（我们挂 tool-jobs 但没用它跑任务，任务走会话投影）；
  **capability-seams** 图谱交叉验证我们 inject 的 `tools`/`attachments`/`agents` 三个服务**都真实存在**（R8 风险当前不成立），而 **`ctx.slots` 0 命中** ⇒ 将来做 UI 必须重查真名；
  **tool-catalog** 里**没有 adb / 设备执行类工具** ⇒ 本插件能力无官方重叠。
  另结清一条凭印象写的路径（`docs/dsh-tool-call-timeout-policy` 实测 404，真路径在 `packages/guard/` 下、包名未变）。范围与逐条出处见 §七「调研-1」。
- **文档对齐-1 已落地（2026-10-15，CHANGELOGS #103）**：把**七个文档面**逐条对当前实现核一遍并改掉漂移，**每条改动都配一条可复跑的核验**（`git grep` / 读源码 / 跑门禁），逐条清单见 §七「文档对齐-1」与 CHANGELOGS **#103**。本轮**未改任何代码**：
  ① **规格 §二** 三行仍挂着已结案的 **G94 / G91**（任务编排、轨迹持久化、长按语义）⇒ 改成实测结论 + 指针 #97，并把「三任务工具宿主内点名仍未做」如实留给「交付-1」C 项；
  ② **规格 §一.3** 还写着 `artemisRepoPath` 是活的配置路径 ⇒ 该字段 T4 已删（`contracts.spec` 有「stay removed」锁），实际只剩 `artemisMcpCommand`（默认 `[]`，唯一消费者 `autogamer_diagnose`）；**§一.1** 的「CI 无 python job」补上「本分支无 CI」这个前提；
  ③ **规格 §四.1** 那句「py 侧已知为扁平」是**已被前置-1 否证的旧表述**（设备侧是嵌套树，「扁平」是解析产物）⇒ 就地更正并指向前置-1 实测结论；
  ④ **守则 R15 / R19 / R21 / R2 四条判据**引的都是已删或未随迁的东西（`ActionClient` 的 `Promise.race`、「两项都缺，已登记为 G32」、`docs/TODO.md`「宿主交互实现审查」表、`spike/` 目录）⇒ 逐条改成现状 + 本分支的落点；
  ⑤ **插件 README** 的 Layout 仍写 preflight「7 项 / 可按 provider·device 范围取」（实际 `run()` 无参数、只两项）、`getDeviceState`「外部 ARTEMIS 透传」（透传已删，provider 唯一消费者是诊断）、脚本清单漏了 `clean-dist.mjs`，且两个 `src/ocr/` 模块**没有生产消费者**却长得像在跑的路径 ⇒ 全部标注；
  ⑥ **`verify` 的形状**：它是 `tsc → tsc → vitest`，**不含** `clean-dist`（那步只在 `build`，#101）⇒ 「交付/pack 前必须先 `build`」写进 `AGENTS.md` 与插件 README（原文两处都写成「build + typecheck + test」）；
  ⑦ **`AGENTS.md`** 仍写「本分支尚无 CHANGELOGS 文件」（该文件 #84 起就在用了）、「四期路线」（实为 T1–T5），并补上 `scripts/ocr-probe.mjs` 与交付形态的指针；**根 `README.md`** 的「现状」还停在「从零重建中」⇒ 改写为已落地 + 唯一真待办 G92。
  ⚠️ 顺带修掉一处**悬空编号**：交付-1 里三处引用的 `G97`「postinstall 无产物」裁决，在本分支与归档 `registry.md` 里**都不存在这个编号** ⇒ 改指 §七「基建-3」/ CHANGELOGS **#98**。
  `verify` 读数不变（**42 文件 / 466 通过**，与对齐前同读数）；门禁 `check-docs`（含 `--selftest`）与 `check-env` exit 0。逐条核验见 §七「文档对齐-1」与 CHANGELOGS #103。
- **rules-1 已落地（2026-10-14，提交 `01de3b2`）**：`rulesInjector` 整链拆除（模块 / `injectRules` 配置 / 诊断项 / 5+2+2+1 条相关锁 / 夹具 / README Layout），
  `systemPrompt` 缝（手镜像 + `inject` 条目 + Tier-1 断言）随链消失；**引导图保留 `dsh-system-prompt`**（agent loop 经它解析，删了会挂载失败——五条 mount 测试变红即证）。
  插件树内 `rulesInjector|injectRules|rulesFilePath|mcp_server/rules` **零命中**；R27 变异（`injectRules` 塞回 schema ⇒ contracts 字段锁红）已闭环。
  规则文本由 persona（常驻）+ skill（按需）承载；不迁移记录见 **CHANGELOGS #84**。
- **T3 第一片已落地（2026-10-14，提交 `00106f8`）**：`compareFrames` 改为 **TS 原生差分** —— `src/effect/png.ts`（最小解码：depth 8 / colorType 2·6 / 非隔行，其余抛错）+ `src/effect/diff.ts`（双管线 + 遮罩 + ROI 回落 + 分支表，常量各带前置-3 出处）。
  验证：判别用例 7 条（前置-3 的 5 条 + 我补的 2 条判别性用例）+ 失败方向 + 解码器，**三处变异各红一次**；另有真实帧冒烟（1600×900 RGBA）**同帧自比全 false**、跨帧检出——但那是**本机一次性探针，未入库**（`scratch/` 是忽略区，真帧也不在仓库里）；**已入库的锁只有那 7 条 spec + 三处变异**，别把冒烟当可复跑判据。
  ⚠️ **与 py 的同输入同输出对照在本机做不了**（仓内无 py、无解释器，provider 未配置）⇒ 列**延迟项**（🔶 不勾）。见 §七「T3 · 效果差分 TS 化」。
- **OCR 判为推迟（2026-10-14，新立 G87）**：⚠️ **本条判定已于 2026-10-15 被用户裁定推翻并落地为内置（T5，见下方「T5 · OCR 已落地」）；正文保留作当时的取证记录，「不实现」结论作废。**
  T3 收尾查「OCR 这片做不做」——**本分支零消费者**（插件树 grep 零命中；动作面 15 工具无 OCR；上游的 OCR 只服务 py 智能栈感知层，而那套按 D8 不迁移）。
  ⇒ **不实现**（无消费者的 HTTP 客户端 + 密钥面 + 融合策略是净增复杂度），但**不是放弃**：画布类 UI 的文字发现是真缺口，现有支撑是「模型自看截图 + 归一坐标」，更弱但未断。
  设计事实（端点结构 / 密钥回退与「未配置即空」/ 跳过整图合并文本 / 顶点→框 / **XML 优先**的融合 / 三类低价值文本过滤）**已一次取齐**并带出处，将来解锁不必重查。见 §七「前置-5」与 CHANGELOGS #87。
- **overlay 同判（2026-10-14，新立 G88）**：用同一把尺子量「画面标注」——插件**从不产出标注图**（截图原样交付），两处 `overlay` 命中经核是 dsh patch 语义、与图像标注无关 ⇒ 零消费者，**不实现**（为调试图引入 libvips 原生依赖不划算）。上游的标注只服务 agents 调试产物与 `data_engine` 存档，两者分别已被 D8 与 session log 取代。见 §七「前置-6」与 CHANGELOGS #88。
- **设备到位，前置-1/2 已测（2026-10-15）⇒ T2 解锁**：`adb` 已在 PATH（WinGet 的 PlatformTools 1.0.41 / 37.0.1），`emulator-5554` 经 `adb reconnect offline` 由 offline 转 `device`；
  2026-10-14 那条「本机无 adb」**已作废**并就地标注（R28）。**前置-1** 取到 wire 真形状：XML **嵌套树**、**无 `children` 属性**、77 节点 / 19 属性且每节点全带、bounds 全为 `[l,t][r,b]`、`rotation=1`；
  这同时**否证两条旧表述**——规格里「py 侧已知为扁平」是把**解析结果**当成了 wire 形状；G76 名下「帧空间 vs 探针值可能不等」不成立（两者同源于截图 IHDR），G76 因此收窄为「手填 `screenSize` 无校验」一条。
  **前置-2** 取到 helper 协议形状（设备端口 18888、host 端口由 adb 分配即隧道身份、除 `/ping` 外要 session token、`transport_id` 变更即陈旧、**与 UiAutomation 互斥**）并验证了转发机制，
  但服务是 **enabled-but-unbound** ⇒ 请求/响应格式那一半**未验 🔶**（要设备侧重新绑定服务，属用户授权面，本轮未做）。
  **层级源定案：`uiautomator dump`，helper HTTP 不作主源** ⇒ G78 退出 T2 前置（口径：不采用该路线所以不需要设计，≠ 已解决）。
- **用户授权（2026-10-15，目标级）**：「接下来**所有测试与实现均授权**，按仓库规则自行推进验证与交付；需要决策的由 agent 先给推荐、**不必提问**；目标结束前允许提交与推送；终态=插件所有功能可用且本文件无待办。」
  据此本目标内**自行推进**：设备安装与挂载（`install_bundle` / 侧边栏面板）、真机与破坏性测试、依赖新增、以及被推迟项的反向结案（**OCR 改判为内置**——用户明确要求「无需额外安装配置」，故 G87 的推迟判定作废并反转，见 §七「T5 · OCR 内置」）。
  **仍不越的两条**：① R19——会话内「批准工具调用 / 回答 agent 提问 / 放宽策略」永远由用户点，我不代批；② 推送只走 `origin` 白名单（`pre-push` 护栏照旧）。
- **进行中里程碑**：**D19（TS 全栈、py 归零）+ D20（溯源归零、不保留上游内容；LICENSE 为本项目自撰 MIT，版权人 giveUphope）**。
- **T2-a 设备面已落（2026-10-15）**：roster / 设备态 / 屏幕锁态 / `screenSize` 校验**全部改走本机 `adb`**，`list_devices` 不再是插件调用。
  新增 `src/device/{adb,roster,state}.ts`；**G75 结案**（`android_id` 去重 + 传输别名折叠进同一把闸门锁），**G76 结案**（手填值与帧 IHDR 不符即拒，
  残留的「缓存不随转屏失效」另立 **G90**）；顺带把预检拆成 `provider` / `device` 两个范围（否则本地工具会被「没装 uv」拒掉）。
  `verify` **37 文件 / 374 通过 / 1 跳过**（上一绿态 35/332），五条新锁各自跑过变异（M1–M5，见 §七「T2-a 收口记录」）。
- **T2-b 层级已落（2026-10-15）**：`get_ui_hierarchy` 改为**设备侧 `uiautomator dump` 读回 + 自带 XML 解析**（退出码与成功消息实测都会撒谎，唯一可信的是读回的字节），
  provider 的 JSON 层级路径**整条删除** ⇒ `contracts.spec` 直呼清单只剩 `take_screenshot`；`#N` 编号与身份解析语义不动（G42 / G67 的锁原样跑绿）。
  `verify` **38 文件 / 390 通过 / 1 跳过**，五条变异 N1–N5 各跑到红（见 §七「T2-b 层级收口记录」）。
- **T2-c/d/e 动作面已落（2026-10-15）**：12 条动作**全部**改走 adb（`src/device/act.ts`，仍产 `Success` / `Failed` / `Error: …` 旧字符串契约 ⇒ 分类器与既有锁原样有效），
  路由的 `client` 依赖与 `ActionClient` 装配**整条拆除**，截图改 `exec-out screencap -p`（顺带修掉「一张图抓两次」），模型可控文本/URL 走设备 shell 引号 + 形状白名单（`javascript:`、`file:`、带空格的 URL、`com.x; rm -rf /` 全部**拒在 spawn 之前**）。
  配置面删 `actionServerCommand` / `actionServerEnv` 两字段；`contracts.spec` 的直呼清单锁由「还剩哪些」改成**禁止**（现为空）。
  `verify` **39 文件 / 412 通过 / 1 跳过**；六条变异 P1–P6 各自跑红；真机逐条 `Success` + 三条该拒的拒（见 §七「T2-c/d/e 动作面收口记录」）。**G91 新立**：长按语义的对照实验不成立，待挂载期复测。
- **T2-f 诊断已落 ⇒ T2 整体除「挂载后真机跑一遍」外收口（2026-10-15）**：`autogamer_diagnose` 改由本地探针拼装（连接 / 锁态 / 帧 / helper 版本 / crash 日志），`include_screenshot` 从「收下但忽略」变成真附图；任务三件套与诊断的预检门改 `device` 范围 ⇒ **没有工具再要求 uv / python / provider**。
  **提供方清点答案：`src/artemis/` 与 `ActionClient` 均已无工具消费者**（模块与配置字段的删除归 T4）。`verify` **39 文件 / 425 通过 / 1 跳过**；四条变异 Q1–Q4 跑红（其中两条**第一次是绿的**，补了用例才有牙——见 §七「T2-f」的自纠段）。
- **T5 · OCR 已落地（2026-10-15，G87 结案）**：`src/ocr/recognize.ts` + 包内 `ocr/{eng,chi_sim}.traineddata.gz`（`4.0.0_fast`，合计 **3.5 MB**）⇒ **用户零安装零配置**；`tesseract.js` WASM 单例 worker（boot 168ms、**657ms/帧**，比一次 `uiautomator dump` 便宜），`langPath` 指包内 + `cacheMethod:"none"` ⇒ 跑完不落任何文件（变异 M7 实测：默认形态会把 6.6 MB traineddata 解包落在进程 cwd）。
  消费点：`{text}` 且**层级答不出**才问帧（`{index}` / `{coordinate}` 永不走），命中取**实际匹配那串词**的框中心（行框会横跨整排图标）；歧义与低置信一律不猜；结果带 `target_source`。诊断项 `ocr_ready` **只报不门**。
  `verify` **42 文件 / 470 通过 / 1 跳过**（上一绿态 39/425）；**14 条变异 M1–M14 各红一次**（其中 M7 第一次是绿的——相对断言在脏机器上失明，改成绝对+相对才咬住）。
  ⚠️ **一条实测否证了「可用」的强口径**：真机桌面页 24 个带文字节点，OCR 与层级同时答得出的只有 **2 个**，小字浅色 CJK 直接没认出字形 ⇒ 安全面已锁、**召回面另立 G92**。数字与逐条查因见 §七「T5 收口记录」。
- **挂载面清点（2026-10-15 实测，把「挂载待办」变成一条有依据的阻塞）**：`dsh` 的 CLI 垫片在 PATH（`dsh.cmd`，版本 **0.2.0-rc.2**），且 **`web` profile 里本插件早已安装**——`dsh plugin list --profile web` 读出 `dsh-autogamer@link:D:/DEV/autoGamer/plugins/dsh-autogamer`（开发期 link，不是 bundle 交付）。
  **R6 声明面自检过**：`dsh --profile web --patch <abs>/cordis.patch.yml --dump-config` ⇒ exit 0、输出 grep 不到 `unmatched`，且合出的树里 `dsh-autogamer` 与 `preset-autogamer`（persona + inner + skill dirs）齐备（读数存 `scratch/dump-config-t5.txt`，忽略区）。
  **一条宿主缺陷（与本分支无关，值得上游修）**：`dsh headless "…"` 一启动就返回 `'D:\DeepSeek' 不是内部或外部命令`（GBK 乱码原文），即宿主为 profile **spawn 子进程时路径含空格未加引号**（安装在 `D:\DeepSeek Harness\`）；同 profile 的 `--dump-config` / `--dump-config-schema` 都不 spawn，全部正常 ⇒ 故障定位在「启动子进程」这一步，不是配置合成。再往下查要解包 `app.asar` ⇒ **R1 禁止**，故不继续。`headless` / `desktop` 两个 profile 都**没有**本插件行（`--dump-config | grep -c autogamer` = 0），只有 `web` 有。
  ⚠️ **本条上一版据此写下「宿主内 R7/R9/R24 的 live 证明阻塞」——该结论已作废**：`dsh --profile web --no-open --port <p>` 直接把宿主当本地服务起，浏览器带 token 进去就能开真会话，**live 证明已在那儿完成**（读数见上一条「宿主内 live 证明已完成」）。插件侧原有的离线证明（真实 cordis 挂载 + 真注册表解析，`tests/conformance/runtimeBoot.spec.ts`，G5 Tier 1）仍然有效，只是不再是上限。
- **门禁的锚点又腐烂过一次，这次把自检装进了钩子（2026-10-15，T4 内收口，R28 当轮回写）**：`check-docs --selftest` 的 **M1-C1 在 HEAD 上就已 BLIND** —— 它的锚点是 §四 G78 那一行的**字面文字**，
  而那行在 前置-2 改写后措辞变了，变异不再落地（其余六条当时仍绿，所以没人看见）。已把锚点改成**结构定位**（§四 表头分隔行后插行），`--selftest` 现 7 例全落地。
  这条不是新问题而是**同类错误的复发**：变异用例的锚点用散文，散文一漂移判据就静默失效 —— 与 §五「测试用词不许当判据」是同一条纪律。
  **T4 已把这条收口**（当初只记录、不动门禁范围是对的，但同一类错误在 T4 当天又复发一次：M5/M6 锚在 §四 的 G86 行文字上，而 T4 正是**删掉了 G86 那一行** —— 于是两条变异同时失明，是本分支第二次实测到「散文锚点会腐烂」）：
  ① **七条变异全部改为结构锚点**（§四 表分隔行后插行；按**行首**定位小节、作用域截到下一个 `### ` 之前、再在小节内的 `**Done means**` 块里翻转第一个复选框 —— 裸子串定位会被台账自己引用的标题文字带偏，改造时当场踩到），并写下锚点规则注释；
  ② **`--selftest` 进 `.githooks/pre-commit`**（87ms，且暂存路径含 `scripts/check-docs.mjs` 时也触发），所以「锚点腐烂」这件事以后在**造成它的那次提交**上就会被拦下，而不是等到下次有人手跑。
  A/B 已实测：把 M1 的锚点改成不存在的标题 ⇒ 提交被 `did not all land` 拒、HEAD 不动；恢复后 `--selftest` 七条全落地。门禁仍是**本地钩子 + 手跑**（本分支无 CI）。
- **T4 已落地 ⇒ G85 / G86 结清，规格 §一 五条全部成立（2026-10-15）**：门从七项收成**两项**（`adb` / 有设备；提供方五项**删除而非跳过**，`run()` 不再要参数）；按**消费者计数**删除 `ActionClient` 链、`mcpText`、三个需要活 py 服务的脚本，以及**整条镜像链**（`src/scrcpy/*` + 5 字段 + 225 行 spec —— 只构造不驱动、还要操作者自备 server 二进制；清点后新立 **G93** 再删）。
  **§一.3 的读法**：保留的是「能显式指向外部那一份」的**能力**，不是没人调的类 ⇒ adapter 不删，而是**第一次给它消费者**：`autogamer_diagnose` 报 `provider{configured,command,reachable,error}`，而 `artemisMcpCommand` 默认从 `["python","-m","mcp_server"]` 改成 **`[]`**（空 ⇒ 永不 spawn）。
  py 动作面名单改为**分区锁**（11 原生 + 2 本地 + 2 带理由放弃 = 15，逐个打到 `runNativeAction` 上证明 case 在，并配反向对照）；`notes/plan` 语法经实测**零消费者** ⇒ 判为不迁移（放弃记录 #94）。
  **G89 结案为已知边界**（无该并发场景）、**G90 结案**（缓存加 5s TTL）。`verify` **38 文件 / 437 通过**；**N1–N10 十条变异各红一次** —— 其中 **N2 第一次是绿的**：G90 判据的时钟跳量当初写成 `SCREEN_SIZE_TTL_MS + 1`，于是「TTL 改成永远」的变异把跳量也一起放大了 ⇒ 判据**自我失效**；改成绝对秒数后才咬住（第三次撞上 R27 这同一课）。
  D19/D20 判据读数：被跟踪 py **0**、`Google LLC` / `Apache License` / `minitap` 在 `:!docs` 外**零命中**、无 vendored 树、无 CI、`LICENSE` 为自撰 MIT、远端只有 `origin`；R6 复跑 exit 0 / unmatched 0。
- **宿主内 live 证明已完成（2026-10-15 05:07–05:18，`emulator-5554` 在线）⇒ G94 结案**：走的是 **`dsh --profile web --no-open --port 8731`**（宿主自带 web 服务档口），浏览器按启动日志里的 token 打开后即进入正常会话界面。四条读数：
  - **R9 官方检查器**：插件面板「已安装 1 · AutoGamer 设备执行 v0.1.0」，启用开关 **on**，「包含的组件 共 2 个 · **2 运行中**」（`dsh-autogamer` 与 `preset-autogamer` 都显示「运行中」）；Agent 预设选择器里出现 **AutoGamer**（描述文案就是我们的 persona 行）。
  - **R7 新会话**：新建会话、选 AutoGamer 预设、跑两轮任务。
  - **R24 会话日志**（`session-f07d997c…`，**65 条记录**）：`tool/call=7`、`tool/result=7`、`turn/end=3`（reason 全部 completed），工具计数 `autogamer_get_device_state=1 / run_device_action=4 / report_task_status=2`。关键返回原文：`device_serial=emulator-5554; connected=true; …frame 1600x900…`；`hierarchy=#0 [800,450] pkg=app.lawnchair android.widget.FrameLayout …`（**我们的 #N 编号**）；`result=Success; target_source=hierarchy; effect=changed`（**闸门 + 原生 adb 动作 + 本地效果判定 + T5 的 target_source 全在同一条里**）；`task outcome recorded: completed`。
  - **R6 声明面**：同 profile `--dump-config` exit 0、`unmatched` 0。
  ⚠️ **两条被本轮推翻的旧表述（R28 就地标注）**：① 本小节上一版写「宿主内 live 证明阻塞在宿主缺陷（`dsh headless` spawn 路径含空格未加引号）」—— **那只堵了 headless 这一条路**，web profile 完全可用，故该结论作废，`headless` 的故障本身仍如实记录（它是宿主的缺陷，与我们无关，值得上游修）；② 取证脚本 `conformance-live.mjs` **一直只读到日志的第一个 zstd 帧**（Node 的解压器不跨帧），于是它把「跑过四个工具」的会话报成 `tools invoked: none` —— 已改为按帧魔数逐帧解压（同一文件从 1 条记录变 65 条），见提交 `1f4d372`。**这条判据此前是坏的，凡是它报过的「没调用」都不算数**。
- **最先能做的两件事（离线可跑）**：§流程 的「前置-1」与「前置-3」。**2026-10-14 实测修正**：本机**无 `adb`**（全盘 0 命中）、
  无在线设备 ⇒ **前置-1 与前置-2 阻塞在环境**（用户裁定「先做有环境的」；解锁条件与复跑命令见 §七「前置-1/2 阻塞」，
  属用户授权动作、不代批）。**前置-3 已完成**（算法/阈值/分支/失败语义/坐标空间五条结论齐备，T3 移植范围收口为
  `check_ui_change` 单条路径；坐标空间疑点查证为「不是错位」，残留的帧空间问题改挂 **G76**）。
  **阻塞现状（2026-10-14 更新）**：T1 离线可证部分已完成，剩下两条**只有设备在场才能做**——切片 3 的宿主绑定核验（🔶 R9）与 R7 真机跑一条完整任务；
  **T2 全部**同样阻塞于本条。**下一个开工项待用户裁定**，候选与各自的前置见 §七（T3 的取证依据即前置-3 已齐，但 §三「顺序不可跳」是否算 T1 收口，属裁定而非现状）。
  **⚠️ 本条已被 2026-10-15 的两项事实推翻（按 R28 就地标注，不静默保留）**：① `adb` 已在 PATH（winget 的 Platform Tools），`emulator-5554` 在线 ⇒
  「前置阻塞在环境」与「T2 全部阻塞」两条同时失效；② 用户已给出目标级授权（见上条「用户授权」）⇒「待用户裁定」不再是现状。T2 据此已开工，进度见下条。
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
| G92 | 内置 OCR 的**召回面**在真帧上不成立：1600×900 桌面页 24 个带文字节点，OCR 与层级**同时**答得出的只有 0–3 个（逐帧方差大）；小字浅色 CJK 被读成 `只@45/wep@33` 一类（不是门槛挡掉，是没认出字形） | **T5 新立**（安全面已锁：fail-open、只补不抢、歧义不猜、不可读帧先拒）。**2026-10-15 已量过放大假设：整帧 1×/1.5×/2×/3× ⇒ 0/1/3/0 命中（3× 还贵 70%），而同一屏 140×70 的**局部裁剪 @2×** 能正确读出「游戏 中 心」⇒ 瓶颈是**整页版面分析**不是像素尺寸**；解法形态是「按区域识别」。**2026-10-15 已立项，方案见 §七「G92 · OCR 按区域识别」**（探针 A 可离线先行，探针 B/C 待设备）。**2026-10-15 能力重审-1 把 P1 判为「未接线」并给了到期条件**：P1 的候选框全部来自层级 bounds ⇒ 层级无框时它结构性地帮不上，而那正是 OCR 存在的理由 ⇒ 不接线的依据是逻辑；**到期条件 = 探针 B 的真机 needle 命中率 ≥ 整帧基线**，到那天才接线（未加阻止接线的锁） |
| G78 | `adb forward` 生命周期归属未定 —— **随 helper 路线不采用而退出 T2 前置**（口径是「不需要设计」，不是「已解决」） | 待需求（复刻 helper 时重查，见 §七「前置-2」） |
| G88 | 画面标注 overlay（在截图上画元素框与标签）——**本分支无消费者，判为推迟**；清点与解锁条件见 §七「前置-6」 | 待需求（不在 T1–T4 排期内。**2026-10-15 复核仍未解锁**：宿主侧没有承载标注图的 UI 落点（R18），而 OCR 内置之后，「画框」要成立还多了一个前置——元素源本身要可信 ⇒ 与 **G92** 挂钩。要做时是「UI slot + 可信元素源」的新条目，不是给截图加一层绘制）。⚠️ **2026-10-15 能力重审推翻本行两处依据**（结论「仍推迟」**不变**，但理由要换）：① 「宿主侧没有承载落点」**当时为真、现在为假**——宿主自己渲染工具结果里的 image 块（`runDeviceAction.ts:693-694` 已产 `[text, image]`），标注图**不需要一张 client 卡片**；② 前置-6 的成本依据「要引入 sharp/libvips」也过期（仓内已有零依赖 PNG 解码 `effect/png.ts:103` + 编码 `ocr/image.ts:119`）。⇒ **唯一成立的前置是元素源可信度（G92）**；判据方法论见 §七「重审综合」的「已就地标注」段 |

> **本表只列还开着的事**（R28：结案的行不再占位，去 §七 与 CHANGELOGS 找记录）。
> G72（提供方形状）与 G74（映射层按旧 5 工具面锁形状）**不在本分支跟踪**：它们随 T4 消解。
> **G81（插件 spec 从未被类型检查）已于 2026-10-14 结清**，权威记录在下方「新分支特有」的 G81 行与其量化小节，故不再列进开放差距表。
> **G87（OCR）已于 2026-10-15 结案**：反转为内置并由 **T5** 落地，权威记录在 §七「T5 收口记录」与 CHANGELOGS **#93**；它留下的**召回缺口是新编号 G92**，不是同一件事的两种写法（R28：一个派生事实只留一个权威）。
> 顺带更正本行原先写着的「实测 144 条错误」：它与量化小节的基线 **124** 是同一件事的两个数，且 144 无从复核——结清后只保留 124 那一份读数（R28：一个派生事实只留一个权威）。
> **2026-10-15（T4）一次结案八条**：**G82 / G83 / G84 / G85 / G86 / G89 / G90 / G93** —— 前三条是 T1–T3 的「离线可证」部分（各自的判据、变异与遗留 🔶 见 §七 对应收口记录；**G84 的「与 py 逐条对照」由 T4 的分区锁替代**，因为本分支按 D19 没有可跑的 py 可比）；
> **G85/G86** 是 D19/D20 的收尾读数（§七「T4 收口记录」）；**G89** 裁定为已知边界（无该并发场景，解锁条件写在 `enumerateRoster` 注释里）；**G90** 用 TTL 收；**G93** 镜像链整体删除。
> ⚠️ 这八条**都不含**「宿主内真跑过」那一半 —— 那一半曾集中在 **G94**，现已于 2026-10-15 完成并结案（连同 **G91** 的长按语义复测：换成可区分的靶子后，`input swipe x y x y 1500` 与 `motionevent DOWN/UP` **都真的弹出了长按菜单**，现行实现正确）。权威记录见 CHANGELOGS **#97** 与 §零「宿主内 live 证明已完成」。

## 七、流程

> T1–T5 是分期名**不是编号**。每期收尾门禁：插件 `tsc` + `vitest` 全绿；改过 patch 跑 **R6**；**R7** 开新会话；判「生效」只认 **R9**。

### 前置：契约实测（动 T2/T3 之前，任一未测不许开工对应期）

- [x] 前置-1 `adb shell uiautomator dump` 的真 wire 形态（设备侧输出与既往扁平列表的对应关系）— **已实测**（2026-10-15，设备到位；结论见「前置-1 实测结论」）
- [x] 前置-2 helper（accessibility 服务）协议：端口 / 握手 / 请求响应格式 / `adb forward` 生命周期（与 **G78** 同源）— **协议形状已取证、隧道机制已验证；helper 本次未应答（原因查明，见「前置-2 实测结论」）**
- [x] 前置-3 效果判定所依据的差分算法与阈值（**无思路时从旧实现读设计，不搬文本**）— 结论见下方「前置-3 实测结论」（2026-10-14 完成；**T3 移植范围已收口为 `check_ui_change` 单条路径**）
- [x] 前置-4 外部提供方接入边界 —— **已完成**（2026-10-14；结论见下方「前置-4 实测结论」）：
      `artemisMcpCommand` 留但收窄语义；`artemisRepoPath` 的 **cwd / pyproject 探测 / uv project 三种 py 语义删**，
      其 **rules 文本来源必须改指向自己**（D20 红线，同时归属 G85+G86）——**已提前执行：规则链整条拆除（rules-1，CHANGELOGS #84），不以「改指向」实现**；`uvPath` 删；
      preflight 七项在 T4 重画为「提供方未配置即跳过，设备面三项才是 gate」
- [x] 前置-6 画面标注 overlay 的消费者清点 + **推迟判定** —— **已完成**（2026-10-14；插件树零消费者 ⇒ **不实现**，新立 **G88**）
- [x] 前置-5 OCR 与层级融合的设计事实 + ~~推迟判定~~ **（判定已作废：2026-10-15 用户裁定改内置，见「T5 · OCR 内置」；本节保留作设计事实的取证处）**
- [x] 前置-7 adb 命令面的真 wire 形态 —— **已实测**（2026-10-15；12 面结论见 §七「前置-7 实测结论」。**三条改写设计的硬事实**：`uiautomator dump` 成功也退 139 且消息不可信 ⇒ 只能读回文件校验；`Success`/`Failed` 是旧实现自造的字符串 ⇒ 原生层继续自造；`input text` 直接吃非 ASCII ⇒ 剪贴板路线不预建。G75 去重键定为 `android_id`）

#### 前置-1/2 阻塞 · 环境缺失（2026-10-14 实测，用户裁定「先做有环境的」）——**2026-10-15 已解除**

> ⚠️ **本段的「本机无 adb」已被推翻**（R28：旧结论不静默保留）：2026-10-15 复查时 `adb` 已在 PATH
> （WinGet 装的 `Google.PlatformTools`，version 1.0.41 / 37.0.1-15733141），且 `emulator-5554` 可联
> ——**「offline」一台在 `adb reconnect offline` 后即转 `device`**。原段的解锁清单逐条跑完，结果落在下面两节。
> 本段正文保留作**判据来处**（它记录了当时是怎么量的，以及「一次只测一个变量」的口径）。

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

### 前置-1 实测结论（2026-10-15，设备 `emulator-5554`，product aurora / model 24031PN0DC）

**先记一条判据陷阱**：Git Bash 会把形如 `/sdcard/window_dump.xml` 的**参数**做 MSYS 路径转换——`uiautomator dump` 的回显被打成 `/Files/Git/sdcard/window_dump.xml`，
但 `ls -l` 证实**落点仍是设备侧 `/sdcard/window_dump.xml`**（回显被改写，不是写错地方）。⇒ 量设备行为必须带 `MSYS_NO_PATHCONV=1`，否则会把工具的输出当设备的事实。

**取到的形状**（一次真实界面：launcher，横屏；命令 `uiautomator dump` + `exec-out cat`，全程只读）

| 面 | 实测 |
|---|---|
| 大小与节点数 | 29,417 bytes；`<node>` **77 个** |
| 属性集 | **19 个，且每个节点全带**：`index` `text` `resource-id` `class` `package` `content-desc` `checkable` `checked` `clickable` `enabled` `focusable` `focused` `scrollable` `selected` `drawing-order` `hint` `password` `bounds` 等 |
| 层级表达 | **没有 `children` 属性**；嵌套靠**元素**表达，实测最大深度 **12** |
| bounds | 77/77 都是 `[left,top][right,bottom]`；最大值 `[0,37][1600,900]` |
| 根与朝向 | `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="1">` |

**与规格 §二 那行的对照**（这条就是 §四 要求留档的对照）：**「无 children」成立 ✓；「扁平」不成立 ✗**——设备侧从来是嵌套树，
「扁平列表」是**旧实现解析之后的产物**，不是 wire 形状。规格里那句话把「解析结果」当成了「设备输出」，已按此更正。

**对本插件的真门槛**：`src/hierarchy.ts` 的 `parseVisibleElements` 吃的是 **JSON 数组**（连字符键 `content-desc` / `resource-id`，加上 `parsed_bounds`），
而设备给的是 **XML**。⇒ 原生动作面必须自带「XML → 节点列表」这一步；`parsed_bounds` 是 py 侧造的字段，原生实现里由我们自己的解析产出，
不是可以照抄的既有形状（该文件头注释也记着早年「扫 `<node>` 标签结果一个都没匹配上」的教训——方向反过来才成立）。

**层级源的结论**：T2 的层级主源就用 `uiautomator dump`——本次实测可用、不需要 APK、不需要 token、不与任何东西抢绑定。理由见「前置-2」。

#### G76 的新证据：转屏时 `wm size` 与帧空间差一次转置（插件内部不受影响）

| 来源 | 值 |
|---|---|
| `adb shell wm size` | **Physical size: 900x1600**（自然方向） |
| `adb exec-out screencap -p` 的 IHDR | **1600 × 900**，depth 8 / colorType 6（RGBA） |
| 层级 bounds 最大值 / `rotation` | 1600×900 / `rotation="1"` |

⇒ 屏上旋转态下，`wm size` 与帧空间**确实差一次转置**。但插件的尺寸取源是**截图 IHDR**（`src/index.ts:261-275` `resolveScreenSize`），层级 bounds 也在同一空间
⇒ **截图、层级、由它们推出的像素三者一致**。**这同时否证了前置-3 留在 G76 名下的那条疑点**（「ROI 按帧尺寸、换算用探针值，二者可能不等」）——两个值同源于截图，不存在不等；按 R28 就地标注。
⇒ G76 的真实暴露面**收窄为一条**：`config.screenSize` 由操作者**手填**时若填成 `wm size` 的 900×1600，就与帧空间转置失配，而**现在没有任何校验拦得住**。落法见 T2 方案（配置值 vs 截图 IHDR 的机械防护，可离线验）。

### 前置-2 实测结论（2026-10-15；协议形状取自只读 blob，未搬文本）

**协议形状**（`artemis/runtime/helper_manager.py`：`DEVICE_PORT`、`MIN_PROTOCOL_VERSION`、`attach` / `reattach` / `detach`）：

| 面 | 事实 |
|---|---|
| 承载 | helper 是 accessibility 服务，在**手机上跑 loopback HTTP** 提供层级；设备端口**固定 18888** |
| attach | `adb forward tcp:0 → tcp:18888`：**host 端口由 adb 现分配，且它就是隧道的身份**（不是固定号——多设备同主机靠它区分）；同 serial 的既有转发**复用** |
| token | loopback 端口对手机上**所有 app 可达**，故除 `/ping` 外一律要 **session token**；token 是**每台主机一份随机秘密**，落在 Artemis temp 目录的文件里让多进程共享，经 `am broadcast` 投递（接收器受 `WRITE_SECURE_SETTINGS` 保护）；每次 attach 重投，helper 答 401 时再投 |
| 版本 | `MIN_PROTOCOL_VERSION = 2`；传输错误时 `reattach` **只试一次** |
| 生命周期 | detach 只删**本进程建的**转发；物理拔出无需主机动作（adb 随传输丢弃转发，设备侧服务照跑）；`adb devices -l` 的 `transport_id` **每次重插都变** ⇒ 变了就当隧道陈旧重建 |
| **互斥**（决定选型的一条） | Android 在 UiAutomation 连接存活期间**解绑所有 accessibility 服务** ⇒ **helper 与 uiautomator 天生互斥**，旧实现的做法是发现 uia2 服务器占着就把它停掉（Appium 的从不动，只在错误里点名）。⚠️ **2026-10-15 重审补两条**（一手，出处见 §七「重审综合」）：**`uiautomator dump` 自己就是 UiAutomation 占位者**，且 `UiAutomationShellWrapper.connect()` 调**无参** `mUiAutomation.connect()` ⇒ 走「默认压制 a11y 服务」分支、**没有 flag 可以不压制**；故本行的互斥成立于**另一根轴**——「helper ⟂ 任何 UiAutomation 使用者」，而 dump 与 uia2 的冲突窗口只是**时长不同**（dump 那几秒 vs uia2 整段寿命），属**可调和**（代价是一套 interlock），不是「天生不可共存」 |

**本次在设备上验到哪一步**
- ✅ 隧道机制：`adb forward tcp:0 tcp:18888` 返回分配端口 **57361**；测完已 `--remove`，`forward --list` 为空。
- ❌ **`/ping` 无应答**（`UND_ERR_SOCKET`）。定位原因（全只读）：设备 `ss -tln` 只有 `*:5555`（adbd）；`dumpsys accessibility` = **`Bound services:{}`** 而 **`Enabled services:{com.artemis.helper/.ArtemisAccessibilityService}`**；`ps -A` 里**没有任何 uia2 / uiautomator / artemis 进程**。
- ⇒ 不是被 UiAutomation 压制，而是 **helper 已启用但未绑定**（服务进程没跑）。要让它应答得改设备安全设置或启停该服务——属 **AGENTS 的用户授权面**（安装 Host 代码 / 连接开启设备由用户决定，不代批），**本轮未做**。
- ⇒ 所以「请求/响应格式」这一半**仍未验证 🔶**；`MIN_PROTOCOL_VERSION=2` 之类的版本协商只在服务真跑起来时才量得到。

**对 T2 / G78 的影响**：不把 helper HTTP 路线当层级或动作主源（要 APK、要 token、要和 UiAutomation 抢绑定，而 `uiautomator dump` 单条命令就够）。
⇒ **G78（`adb forward` 生命周期归属）因此退出 T2 前置**——但结论的口径是「**因为不采用该路线所以不需要设计**」，**不是「已解决」**；将来若真要复刻 helper（D13 的二期），本节就是重查的起点。

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
| `artemisRepoPath` ④ rules 文本 | **已拆（rules-1）** | 整链删除，规则文本改由 persona + skill 承载（CHANGELOGS #84） |
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
### 前置-6 · 画面标注 overlay 的消费者清点与推迟判定（2026-10-14，R22）

**问题**：规格 §二 把「画面标注 overlay（py `PIL`/`cv2` → sharp/libvips）」列为待迁移能力。要不要在这片做？

**清点（实测）**
- 本分支：`grep -rniE 'overlay|annotat|drawbox|draw_text|label_image|标注' src tests skills README.md` → 仅两处命中，且都是**dsh patch 的 overlay 语义**（`deliveryShape.spec.ts:6`、`README.md:73`），与图像标注无关 ⇒ **零消费者**。
- 插件从不生成标注图：截图走 `ctx.attachments.saveImages` 原样交付（`saveScreenshot`），模型看的是原帧；工具面也没有「返回标注图」的工具。
- 归档侧（只读 blob）：标注出现在 `artemis/agents/**`（flash / operator / summarizer 的调试产物）与 `artemis/data_engine/**`（历史截图存档的可视化）——前者按 **D8** 不迁移，后者按规格 §二 改由 **DSH session log** 承载。

**判定**：**不实现**，判**推迟**并新立 **G88**。为「给人看的调试图」引入 `sharp`（libvips 原生依赖）换来的是零消费者的产物；本分支的调试面是日志与真帧，没有标注图这一层。
⚠️ **2026-10-15 能力重审：本节的两条依据都已过期，判定「推迟」暂不变但理由要换**（综合见 §七「重审综合」）——
① **成本依据失效**：仓内已有**零依赖** PNG 解码（`src/effect/png.ts:103`）与编码（`src/ocr/image.ts:119`）⇒ 画框＝改 RGB 缓冲，**不需要 `sharp`**；无字形光栅时可退化成「命中/未命中着色 + 序号」。
② **承载依据失效**：宿主自己渲染工具结果里的 image 块（`src/tools/runDeviceAction.ts:693-694`）⇒ 标注图作为**工具结果的 image 块**即可，**不需要 client 卡片**（也就不必绕 `tests/clientHalf.spec.ts:64-75` 的禁列）。
⇒ 现在唯一站得住的前置是**元素源可信度**（G92）。**解锁条件的形态随之改变**：不是「等 UI slot 出现」，而是「等元素源可信」；届时走 A 路线（工具结果 image 块），B（toolview 卡片）只在需要**活数据**时才值。
**不是放弃**：若将来做 Web toolview 的「把命中的元素框画出来」这类展示（P3/G2 轨道），那才是消费者出现之时——届时按当面的官方形态（client 插件的 `tool.call.toolview` keyed slot，R18）设计，依赖选择重新评估。

**Done means**
- [x] 消费者清点为 0（本分支），且两处 overlay 命中被证明语义无关
- [x] 归档消费者定位清楚（agents 调试产物 + data_engine 存档），各自归属已有决议覆盖
- [x] 判定与解锁条件落账，新立 **G88**；规格 §二 该行改「推迟」；结案记录进 CHANGELOGS #88

### 前置-5 · OCR 与层级融合的设计事实（取证 + 推迟判定，2026-10-14，R22）

**背景**：T3 收尾要回答「OCR 这片做不做」。先查消费者，再决定形态——**结论是本分支不做，判为推迟（新立 G87）**，同时把设计事实一次取齐，避免将来重新查一遍。

**取证（R20 第 1 步；全部只读归档 blob `git show legacy-fork-v2-dsh-plugin:<path>`，取其设计、不搬文本）**

| 面 | 事实 | 出处 |
|---|---|---|
| 传输 | 单端点 HTTPS POST，query 带 key；请求体是「一张 base64 图 + 一个文本识别特性」的批式结构；**超时 30 秒**；进程内复用一个长连接客户端 | `artemis/utils/ocr_api.py`（`perform_ocr` / `get_http_client`） |
| 密钥 | 先取配置里的 `ocr` 密钥，回退环境变量两个名字；**占位符值视同未配置**；未配置 ⇒ **返回空列表而不是报错** | `ocr_api.py`（`is_ocr_configured` / `perform_ocr`） |
| 响应 | 只取第一个响应；**跳过第 0 条 annotation**（它是整图合并文本）；每条留「文本 + 多边形顶点」；非 200 ⇒ 抛 | `ocr_api.py`（`_parse_ocr_response`） |
| 几何 | 顶点列表 → `[left, top, right, bottom]`（x/y 取 min/max）；**空顶点 ⇒ 全零框** | `ocr_xml_fusion.py`（`_parse_ocr_position`） |
| 融合策略 | OCR 结果是**虚拟元素**，与 XML 层级元素并存；**命中测试优先 XML**，OCR 盒子带 `is_ocr` 标记且只在更小面积者胜出时替代；重叠率分母取 **OCR 面积**（非对称） | `ocr_xml_fusion.py`（`_calculate_overlap_ratio`）、`element_hit_test.py` |
| 文本质量过滤 | 判「低价值」的三类：空文本；**单字符且既非中文也非数字**（噪声）；一小撮占位词与工具默认标记 | `ocr_xml_fusion.py`（`_is_low_value_text`、`PLACEHOLDERS`） |
| 消费者 | **只有 py 智能栈的感知层**（explorer / checker / screen_index / tiers / runners）——动作服务器里没有 OCR 工具 | `git grep -li ocr` 命中全在 `artemis/agents/**` |

**本分支现状（实测）**：`grep -rniE 'ocr|vision|text_detect|find_text' src tests README.md cordis.patch.yml skills` → **零命中**；动作面夹具 `py-action-tools.json` 的 15 个工具里**没有 OCR 工具**。⇒ 插件没有任何 OCR 消费者。

**判定（2026-10-14 当时）：为什么不现在做**（⚠️ **此判定已于 2026-10-15 被用户裁定推翻**——OCR 改为内置并自建消费点，见 §七「T5 · OCR 内置」；下列四条保留作**推理与取证的原地**，其中的"设计事实"部分仍然有效并被 T5 直接沿用）
1. **无消费者**：实现一个没人调用的 HTTP 客户端 + 密钥配置面 + 与 `hierarchy.ts` 的融合策略，全是净增复杂度，且违反「不为假想需求设计」。
2. **上游用它的原因不在本分支**：OCR 是 py 图（checker/explorer 感知层）的元素源，而那套按 **D8** 不迁移、按 **T1** 已由 S11 单层路由 + agent loop 取代。
3. **真实缺口存在但未断**：画布类 UI（层级拿不到文字）仍需 OCR 才能"发现"文本；本分支对该场景的现有支撑是「模型自看截图 + 归一坐标 `[x,y]`」——**能做但更弱**，这是记录在案的已知短板，不是假装已解决。

**推迟的解锁条件（G87）**：⚠️ **2026-10-15 已解锁并落地**（消费者由本项目自建，形态换成离线内置 ⇒ 下面这条 `fetch`/密钥方案**未采用**，见 §七「T5」）：出现真实消费者（例如层级为空的画布界面反复失败）⇒ 另立实现条目，形态按已取证的事实落：
`fetch` 直译（零依赖）、密钥走我们自己的配置项（不复活 `.env` 约定）、**未配置即返回空而非报错**、跳过整图合并文本、XML 优先的融合与上面那三条质量过滤——并给每条常量带出处。

**Done means**
- [x] 消费者清点（grep + 动作面夹具）为 0
- [x] 设计事实七面取齐且各带函数/常量名出处
- [x] 判定与解锁条件落账，新立 **G87**；规格 §二 该行改「推迟」——**其后状态：2026-10-15 反转为内置（T5 已落地），该行现为「已落地」**
- [x] 结案记录进 CHANGELOGS #87（放弃/推迟记录是规格 §一.4 要求的落点）；反转记录进 **#93**

### T5 · OCR 内置（**G87 反转**；2026-10-15 立项并落地，R22；收口记录见本节末）

> ⚠️ **本节推翻「前置-5」的推迟判定**：用户 2026-10-15 目标裁定「将 OCR 功能**内置到插件本体**，使用户使用时无需额外安装配置」⇒ 「零消费者所以推迟」不再成立（消费者由本项目造）。前置-5 正文保留作**设计事实的取证处**，其"不做"结论就地标注作废。

**为什么不照搬上游形态**：上游 OCR 是 **Google Cloud Vision HTTP + 用户 API key**（`ocr_api.py` 实测口径：key 走配置/环境变量，**未配置就返回空**）。
那条路线与「无需额外安装配置」**直接冲突**（要用户去拿 key），所以**只取其用途**（层级拿不到文字时提供备用元素源），形态换成**离线内置**。

**可行性实测（2026-10-15，真截图 1600×900；探针是临时件、已清出包目录）**

| 面 | 实测 | 结论 |
|---|---|---|
| 引擎 | `tesseract.js@7.0.0`（WASM），`pnpm add` 1.8s；**pnpm 忽略其构建脚本仍可用** | 无原生依赖，Windows / Node 24 可跑 |
| 离线 | 从**包内本地 `langPath`** 读 `eng.traineddata.gz`：**696ms/帧**（首跑带下载 1.22s） | 语言数据进包即完全离线 ⇒ 满足"零配置" |
| 体积 | `eng` raw 5,199,098 → **gz 2,944,683**；`chi_sim` raw 2,471,033 | 双语约 **4.5 MB** 进包；`files` 必须含 `ocr/` |
| 质量 | `eng` 整帧 conf=27（中文全废）；`chi_sim` conf=35 且**确实读出屏上中文**（「热血冒险正当时」一类）；`eng+chi_sim` 1964ms conf=35 | 整帧精度不高；但**「按已知标签找框」这一用途不需要整帧准确** |
| 副作用 | 默认会把 traineddata **下载进进程 cwd（我这次落在包目录，7.7 MB）** | 实现里必须 `langPath` 指包内 + `cacheMethod: "none"`，否则 bundle 会带垃圾（也是包污染的入口） |

**What（范围）**
1. `src/ocr/recognize.ts`：`recognizeText(png, {langs}) → { hits: [{text, confidence, bbox}] } | undefined`；worker **懒建、单例复用**，disposer 挂在本插件 fiber 上（R12/R16：资源注册在 `apply` 内、返回清理）。
2. `ocr/eng.traineddata.gz` + `ocr/chi_sim.traineddata.gz` 随包发布；`package.json` 的 `files` 加 `ocr/`；新增配置项 `ocrLanguages`（默认 `"eng+chi_sim"`）与 `ocrEnabled`（默认开——**用户不必配置任何东西**）。
3. **消费点（这条链存在的理由）**：`run_device_action` 的 `target:{text}` 在**层级未命中**时走 OCR 找框，命中则取框中心为像素点；结果卡片记 `target_source: "hierarchy"|"ocr"` 进 `presentationMeta`（T1 的折叠只读 `meta`，天然继承）。
4. `autogamer_diagnose` 增一项「OCR 就绪」（语言包在位 + 一次极小样例识别），**不进 preflight 的 gate**（增强面，失败不阻断，与 rules 注入当年的 fail-open 同向）。
5. 第三方许可物登记：tessdata 语言数据自带许可（Apache-2.0），**与上游 artemis 无关但仍是随包再分发** ⇒ 新增 `THIRD_PARTY_NOTICES.md` 记来源/版本/许可，并加进 `files`。这与 D20 不冲突（D20 管的是**上游 artemis 内容**），但 R1/包义务要记清。

**非目标**：不做 Google Vision/key 路线；不做整页排版还原或阅读顺序重建；不把 OCR 用于效果判定（T3 已原生）；不做多设备并发下的 worker 池（先单例）。

⚠️ **依赖卫生**：`tesseract.js` 随方案先行入库（`62c2902`），在 T5 落地前它是**已声明而未使用**的依赖——**不得当"清理未用依赖"顺手删掉**（同 §七 T1 How-8 的 zod 教训，那条当年就被我写错过一次口径）。

**How（关键决策）**
- **单测不碰 4.5 MB 模型**：`recognize` 作为**注入依赖**进工具，spec 全用假件（与 `compareFrames` 同一手法）；真模型只在版本化探针里跑一次。
- 失败方向 `undefined` + 上层 fail-open：OCR 不可用绝不能让动作失败或让挂载报错（同 rules 注入当年的教训：**静默跳过要被诊断暴露**，所以配 4 的诊断项）。
- 精度门槛：只有 `confidence >= OCR_MIN_CONFIDENCE`（常量，实现时按实测 35 定一个不高于它的可用值并写理由）且**唯一命中**才走 OCR 落点，多命中 ⇒ 回落原错误，不猜。
- 超时自实现（R15）：整帧 1–2s，给 `ocrTimeoutMs`（默认 8s）+ `AbortSignal` 观测。

**Verify（验收命令）**
- 版本化探针 `node scripts/ocr-probe.mjs`（吃**版本库内夹具 PNG**，不吃 `scratch/`）：断言读出已知标签、耗时与体积打印、且**进程无网络访问**（判据：`langPath` 在包内 + `cacheMethod:"none"` + 断言包目录不新增 traineddata）。
- 消费路径锁：层级命中 ⇒ **不调** OCR；层级未命中 ⇒ 调且 tap 落在返回框的中心。
  **变异校验（R27）**：① 把「层级未命中才 OCR」的判断删掉（永远调）⇒ "层级命中不调 OCR" 那条必须红；② 把置信度门槛改成 0 ⇒ 多命中/低置信回落锁必须红；③ 把 `files` 里的 `ocr/` 删掉 ⇒ 包内容检查那条红。
- `pnpm … run verify` 三段全绿；`check-docs` / `check-env` exit 0；`du -sk plugins/dsh-autogamer/ocr` 记录进账（只留命令，不写死数）。

**Done means**
- [x] `src/ocr/recognize.ts` + 配置项 + 诊断项落地；包内 `ocr/` 双语语言包在位
- [x] 消费点接线：层级未命中才 OCR，`target_source` 进 `presentationMeta`（折叠侧自然继承）
- [x] 版本化探针可离线复跑且证明无网络；三条变异各红一次（**实到 14 条**，见下方收口记录）
- [x] `THIRD_PARTY_NOTICES.md` 登记语言数据来源与许可，并加进 `files`
- [x] 台账/规格同步：G87 结案、规格 §二 OCR 行改「内置（离线 WASM）」、CHANGELOGS 新条目记这条**反转**（不重写 #87，编号永不复用）

#### T5 收口记录（2026-10-15）

**实施期复测覆盖方案期数字**（方案表保留作立项证据，此处是落地时的读数——R28：被推翻的口径不许静默并存）

| 面 | 收口实测（`node scripts/ocr-probe.mjs`，夹具 1600×900） | 与方案期的差 |
|---|---|---|
| 语言数据 | `4.0.0_fast`：`eng` gz **1,984,273** + `chi_sim` gz **1,730,011** ⇒ 合计 **3.5 MB** | 方案期引的是 standard 版（2,944,683 / 双语 4.5 MB）⇒ 比预估小 1 MB |
| 耗时 | worker boot **168ms**、首帧 **657ms**、次帧 **594ms**（单例复用） | 方案期 696ms（首跑带下载 1.22s）、双语 standard 1964ms ⇒ 快得多，且**比一次 `uiautomator dump`（2.4s）便宜** |
| 置信度 | 真标签**词级 72–96**；噪声（状态栏字形、图标碎片）**0–47**；混排行**行级均值 60** | 方案期「整帧 conf 27/35」是**整帧**口径 ⇒ 门槛按**命中窗口最弱词**判，故取 **60**，**偏离方案 How-3 的字面（「不高于 35」）**，理由即此 |
| 副作用 | `langPath` 指包内 + `cacheMethod:"none"` + `gzip:true` ⇒ 跑完 cwd 与 `ocr/` **零新增**（探针两次读数 + 一条锁） | 默认形态会把 traineddata **解包落在进程 cwd**：变异 M7 实测多出 `eng.traineddata` 4.1 MB / `chi_sim.traineddata` 2.5 MB |

**命中模型是实测逼出来的**（方案只写了 `{text, confidence, bbox}` 三件）。tesseract 把一整排桌面图标读成**一行**：夹具里 `游戏 中 心 TapTap 光环 助手` 与 8 个图标碎片同属一行，行框 `x0=4..x1=1441`、行中心 **(723,245) 落在两个图标之间的空白**，行均值 conf 只有 60；而「游戏中心」是这一行里的**三个词**（96/93/92，合并框中心 **(1003,240)**）。⇒ 命中必须**回填到实际匹配的那串词**（`matchWindow`），并**按那串词的最弱词置信度**判。按行判两个方向都错：真标签被行均值 60 拖到门槛下、噪声被行 conf 99 放进来（两条都有锁）。

**消费路径（What-3）**：`{text}` 且**层级答不出**才问帧；`{index}` / `{coordinate}` 永不走 OCR；多命中或低置信 ⇒ 保持原层级错误文案（不猜）。结果带 `target_source: "hierarchy"|"ocr"`，`presentationMeta` 复制它 ⇒ T1 折叠侧只读 `meta`，天然继承。**每轮阶梯各看一次帧**（3 次 = 3 次新截图 + 3 次识别 ≈ 0.8s/次）：阶梯的本意就是「屏幕可能还在动」，所以不缓存、不复用上一帧。

**诊断项（What-4）**：`autogamer_diagnose` 多一个 `ocr_ready` + `ocr{enabled,langs,missing_data,frame?}`，并把「缺语言包 / 引擎问不出」写进 `recommendations`；**不进 preflight 门**（`checkEnv` 不含 OCR 项），检查自己抛错也只记一行不炸诊断。`ocrEnabled:false` 视为**选择**而非故障（不给建议）。

**验证**：`verify` **42 文件 / 470 通过 / 1 跳过**（上一绿态 39/425）；语言数据体积复跑 `du -sk plugins/dsh-autogamer/ocr`（不写死数）；新增 `tests/ocrRecognize.spec.ts`（23）、`tests/ocrConsumer.spec.ts`（9）、`tests/ocrPackaging.spec.ts`（5，**含一条真跑包内模型的**：读真夹具、断言 `TapTap`→(1206,241) 与 `游戏中心`→(1003,240)、且跑完不落任何文件)、`tests/diagnose.spec.ts` +8。
**变异 M1–M14 全部落地**（脚本 `scratch/mutate-t5.mjs`，输出 `scratch/mutate-t5.txt`；`scratch/` 是忽略区，**可复跑性只由那三条 spec 承担**）：M1 OCR 抢先 / M2 `{index}` 也走 OCR / M3 命中不回填框 / M4 门槛归 0 / M5 按行置信度判 / M6 `files` 去掉语言包 / M7 `cacheMethod:"write"` / M7b 去掉 `langPath` / M8 OCR 检查炸掉整条诊断 / M9 建议不落地 / M10 `ocr_ready` 不看缺数据 / M11 render 丢字段 / M12 缺数据判定反了 / M13 `status()` 谎报 worker 已起 / M14 `tesseract.js` 降级为 devDependency。
⚠️ **M7 第一次是绿的**：断言原先只比「本次运行前后目录差集」，而上一轮变异已把两个 `traineddata` 落在插件目录 ⇒ 脏机器上失明。改成**绝对断言 + 相对断言**两条并跑后才红（并清掉那两枚遗留文件）。这是 R27 的同一课：**判据失灵过一次，就等于没有判据**。

**真机对照（2026-10-15，`emulator-5554` 桌面页，跑的是 `dist/` 产物）**：帧 1,279,741 B、层级 83 节点其中 24 个带文字、OCR 79 命中 / 754ms。两侧都答得出的只有 **0–3/24**（两次独立复跑分别是 2 与 0；其中 Δy≈40px 是**语义差**不是误差——层级节点框含图标，OCR 框只有文字）。逐条查因（一次一个变量）：`游戏中心` 这帧被读成 `只@45 / 本@34 / wep@33`（**根本没认出字形**，不是被门槛挡掉）；`杖剑传说` 读成 `杖@38 剑@72 传说@53`；dock 的 `设置/图库/文件` 附近**零命中**。⇒ **内置 OCR 的「安全面」已成立（fail-open、只补不抢、零配置、不落垃圾），「召回面」在 1600×900 小字浅色 CJK 上不成立**；同一屏的夹具帧反而认得出（92–96）⇒ 逐帧方差大 ⇒ **新立 G92**。

**放大假设已量过并否证（2026-10-15 补测，`scratch/ocr-upscale-probe.mjs`）**：同一帧最近邻放大后整帧识别，按节点文本回查命中数 —— 1×(1600×900) **0/24** 760ms；1.5×(2400×1350) **1/24** 840ms；2×(3200×1800) **3/24** 942ms；3×(4800×2700) **0/24** 1269ms。而**把「游戏中心」那一块 140×70 裁出来 @2×** 识别，读出的正是 `游戏 中 心`。⇒ **瓶颈是整页版面分析，不是像素尺寸**：像素够，但 tesseract 在整屏混排下不把那些小块当文字行。所以 G92 的解法形态是「**按区域识别**」（先取候选区域再逐块 OCR），不是改一个 scale 常量 —— 那是新设计，另立条目再做，本片不擅自扩范围。

⚠️ **这轮测量顺带抓出一条已发布代码的崩溃路径**（详见 CHANGELOGS **#96**）：把 leptonica 读不了的字节交给 `worker.recognize`，除了 promise 被 reject（我们接住了），tesseract.js **还会在 `process.nextTick` 上抛一个无人处理的 error** ⇒ 宿主进程会死；截断的 `screencap` 正是这种形状。已修：识别前先用**同一个 IHDR 读取器**验帧，不可读就不起 worker、只记一行 warn（单元锁证明工厂未被触达，包内锁证明真 worker 活下来）。

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

### 基建-3 · 依赖构建脚本策略定案（`tesseract.js` 的 postinstall 不执行）（方案，2026-10-15 立项，R22）

**背景**：拉取 T5（内置 OCR，`tesseract.js` 首次进入依赖面）后在本机装依赖，`pnpm install --frozen-lockfile` **退出码 1**：

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: tesseract.js@7.0.0
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```

- **版本面**：仓库**没有钉 pnpm 版本**（根无 `package.json`，插件 `package.json` 无 `packageManager` 字段，根无 `.npmrc`），本机实测 **pnpm 11.21.0**。新 pnpm 把「被拦截的构建脚本」当**错误**退出，旧版只当告警 ⇒ 同一条命令在不同机器上结论不同，而仓库里没有任何一处能解释这个 1 从哪来。
- **更要紧的一条**：安装动作**改了被跟踪文件** —— `plugins/dsh-autogamer/pnpm-workspace.yaml` 被写入占位行 `tesseract.js: set this to true or false`（本轮已 `git checkout` 还原，未入库）。安装改仓库文件不是可以靠「记得 `git checkout`」兜住的事：下一个新增依赖会再发生一次。
- **该脚本的实质**（读 `node_modules/tesseract.js/package.json`）：`postinstall = "opencollective-postinstall || true"` —— 打印一条赞助横幅，**无任何功能性产物**。而 OCR 的语言数据是**随包 vendored** 的（`ocr/*.traineddata.gz` 已进 `files`、`langPath` 指包内，见 #93），所以不存在「必须构建才有产物」这回事。
- **为什么不能只是「本机忽略掉」**：那等于把决策留给每个人，于是每个新依赖都要重新吵一遍、且新 clone 的人会先撞上一次 unexplained exit 1。口径要写进被跟踪文件。

**What（范围）**

- `plugins/dsh-autogamer/pnpm-workspace.yaml` 的 `allowBuilds` 增一行 **`tesseract.js: false`**（沿用文件里既有的键与 `esbuild: true` 的写法，不引入新键名）。
- 保留 `esbuild: true`：vitest 依赖它的原生二进制，那条**确实**需要构建 —— 本条只处置「无产物的横幅脚本」，不顺手放宽别的。
- 文档：本条（方案 → 结案）+ `AGENTS.md` 安装段一句指针 + 结案后的 CHANGELOGS 条目；§零 与 §七「新分支特有」清单同步。
- **非目标**：不 pin pnpm 版本（那是另一件事，本条不夹带）；不改 lockfile、不改插件 `package.json`、不加依赖、不动 `.npmrc`。

**How（做法与关键决策）**

- 取 `false` 而**不是删键**：键显式存在即表态（pnpm 只对显式 `true` 执行），删掉等于回到「每次安装改仓库文件 + 非零退出」的老形状。
- 判据跟着脚本的性质走，不跟着包名走：**该依赖的安装脚本无产物、且只出网打印** ⇒ 不执行。将来若某个 postinstall 真的产出东西（例如要编译原生模块），这条必须同步改 `true` —— 解锁条件记在 Done means 的备注里。
- **安装后 `git status --short` 里 `pnpm-workspace.yaml` 必须不出现**，这是「策略已定案」与「碰巧没触发」的分界。

**Verify（验收命令）**

- 在 `plugins/dsh-autogamer/`：`pnpm --config.verify-deps-before-run=false install --frozen-lockfile --config.autoInstallPeers=false` ⇒ **exit 0**，输出无 `ERR_PNPM_IGNORED_BUILDS`；随后仓库根 `git status --short` 中 `pnpm-workspace.yaml` 不出现。
- **A/B（判据会红，R27）**：把该行还原成占位文本（`tesseract.js: set this to true or false`）⇒ 同一条命令回到 **exit 1** + `ERR_PNPM_IGNORED_BUILDS`；撤掉即复绿。本轮的「改前」读数就是这个形状——同机、同 lockfile、同命令，唯一变量是这一行。
- 回归：`pnpm --config.verify-deps-before-run=false run build` ⇒ exit 0；`… run test` ⇒ 全绿（本轮实测 **38 文件 / 439 通过**）；`node scripts/check-docs.mjs` 与 `node scripts/check-env.mjs` ⇒ exit 0。

**Done means**

- [x] `allowBuilds` 含 `tesseract.js: false`，且安装不再改写该文件（`git status --short` 里没有它）
- [x] 安装 exit 0 且无 `ERR_PNPM_IGNORED_BUILDS`；A/B 实测占位形态会红（exit 1）、撤回复绿
- [x] `build` exit 0、`test` 全绿；`check-docs` / `check-env` exit 0
- [x] `AGENTS.md` 安装段落指针；CHANGELOGS 结案条目 + §零 状态行 + §七「新分支特有」清单同步

> **解锁条件（不是待办）**：将来某个依赖的 `postinstall` **确有产物**（要编译原生模块之类）⇒ 该条必须改 `true`，并在此处与 CHANGELOGS 同时记明依据。本条判定的是「无产物、只出网打印」这一类，不是对 `tesseract.js` 的永久否决。

**结案记录（2026-10-15）**

- 实施：`pnpm-workspace.yaml` 的 `allowBuilds` 增 `tesseract.js: false`；安装 **exit 0**（865ms）、输出无 `ERR_PNPM_IGNORED_BUILDS`，且**不再改写该文件**；`build` rc 0、`test` **38 文件 / 439 通过**。A/B 见上方 Verify（占位形态 exit 1 是本轮改前的原始读数）。
- 🔶 **记债（当时不在本条范围）**：**pnpm 版本未钉**（根无 `package.json`、插件包无 `packageManager`、根无 `.npmrc`；本机 11.21.0）。⚠️ **该债已于 2026-10-15 由 基建-4 结清**（`packageManager: pnpm@11.21.0` + `pmOnFail: error`，权威记录见 §七「基建-4」与 CHANGELOGS **#99**）；本条保留当时的读数，「新版本上未验」那句已由那次实测取代。
- 提交：方案 `2fb1982` → 实现 `9dea904` → 结案 `e82c2e2`。

### 基建-4 · 包管理器版本钉死（`packageManager` + `pmOnFail: error`）（方案，2026-10-15 立项，R22）

**背景**：基建-3 结案时记了一笔债 —— 仓库**不钉 pnpm 版本**（根无 `package.json`、插件包无 `packageManager`、根无 `.npmrc`）。而 pnpm 各版本对「依赖的构建脚本被拦截」这件事的处理并不一致（新版非零退出，旧版只告警），于是**同一条安装命令在不同机器上结论不同**，而仓库里没有任何一处能解释。本条把它钉死，让「机器不同」变成「响」而不是「悄悄不同」。

**取证（R20 第 1 步：查了哪份、它怎么说 —— 官方一手，转述不搬文本，D20）**

| 出处 | 取到的设计事实 | 对本方案的作用 |
|---|---|---|
| pnpm 官方文档 `pnpm.io/package_json` §`devEngines.packageManager`（Added in **v11.0.0**） | 该字段**支持版本范围**；解析出的版本会存进 `pnpm-lock.yaml` 的 `packageManagerDependencies` 并在仍满足范围时复用 | 「钉版本」有两种载体，而这一种会动 lockfile |
| 同页 §`packageManager`（legacy 字段，与上条对照） | 用 legacy `packageManager` 声明 **pnpm 12** 且 `pmOnFail` 不是 `ignore` 时，解析信息会写进 lockfile 的 env lockfile 文档 | 反向读法：钉 **11** 不给 lockfile 加东西 ⇒ 选 legacy 字段可保持 lockfile 零churn（并已实测确认） |
| pnpm 官方文档 `pnpm.io/settings/cli` §`pmOnFail`（Added in **v11.0.0**，默认 **`download`**） | 版本不符时的四种行为：`download`（默认）/ `error` / `warn` / `ignore`；**它取代了已被移除的** `managePackageManagerVersions`、`packageManagerStrict`、`packageManagerStrictVersion`；错误信息自带绕过方式 | 选 `error`：本仓库要的是「不一致就响」，不是自动下载并改用声明版本 |
| 同页 §`engineStrict` | 项目**自身**（非依赖）的 `engines` 不符时安装**总是**失败 | 记为**未选**的第三条路：`engines.pnpm` 是范围语义，钉不住精确版本 |
| 本机实测 | `pnpm -v` = **11.21.0**；**`corepack` 未安装**（Node 24.14.1，来自 trae-cn 的 Node 发行，`corepack -v` 报「无法识别」） | 钉法必须是 pnpm 自带的机制；不引入 corepack 前置（本机也没有） |

**What（范围）**

- `plugins/dsh-autogamer/package.json` 增 `"packageManager": "pnpm@11.21.0"`（精确版本，**不带 hash**）。
- `plugins/dsh-autogamer/pnpm-workspace.yaml` 增 `pmOnFail: error`（与既有 `allowBuilds` 同文件，符合 v11「设置只从 `pnpm-workspace.yaml` 读」的口径）。
- 文档：本条 + 结案后的 CHANGELOGS；`AGENTS.md` 写明钉法、**误配时的处置**与**升版流程**；**基建-3 记的那笔债就地标注结清**（R28），§零 与「新分支特有」清单同步。
- **非目标**：不给仓库根加 `package.json`（那会凭空造一个 workspace 根）；**不 pin Node 版本**（另立）；不换包管理器；不动 lockfile 内容；不夹带 `.npmrc` 那笔债（见文末）。

**How（做法与关键决策）**

- **精确版本而不是范围**：`devEngines.packageManager` 支持范围，但范围等于把基建-3 那个洞重新打开 —— 11.5 与 12.x 对「构建脚本被拦截」的处理不同，`ERR_PNPM_IGNORED_BUILDS` 会不会非零退出就会随范围漂移。精确版本 + `error` 才能让这件事响。
- **legacy `packageManager` 而不是 `devEngines.packageManager`**：后者按官方文档会把解析版本写进 lockfile；前者在本版本下 lockfile 零变化（实测：`pnpm-lock.yaml` 不出现在 `git status` 里）。本仓库把 lockfile 变动视为需要解释的产物，能不动就不动。
- **`error` 而不是默认的 `download`**：默认行为是**下载并改用**声明版本 —— 一次静默的网络动作加一次版本切换。判据要求不一致时立刻暴露。
- **不写 hash**（`pnpm@11.21.0+sha512.…`）：hash 的作用是校验下载物，而 `error` 模式下**根本不会下载**；corepack 缺席也生成不出来。写一个自己算不出的 hash 是假严谨。
- **钉在插件工程**（全仓唯一的 `package.json`，也是所有文档命令的工作目录）。**已知边界**：从仓库根跑 pnpm 读不到这个钉（根无 manifest）—— 那不是文档化的用法，写进 `AGENTS.md`，不假装没有这条边界。

**Verify（验收命令）**

- 匹配态：`pnpm --config.verify-deps-before-run=false install --frozen-lockfile --config.autoInstallPeers=false` ⇒ **exit 0**；`git status --short` 里 **`pnpm-lock.yaml` 不出现**。
- **A/B（R27，判据必须会红）**：把 `packageManager` 改成 `pnpm@9.15.0` ⇒ 文档里那条安装命令 **exit 1**，报 `[ERROR] This project is configured to use 9.15.0 of pnpm. Your current pnpm is v11.21.0`，且**报错发生在任何下载/改动之前**（`node_modules` 与 lockfile 均无变化）；改回即复绿。
- 回归：`pnpm --config.verify-deps-before-run=false run verify` 三段全绿；`node scripts/check-docs.mjs` 与 `node scripts/check-env.mjs` exit 0。
- **判据的边界（如实写）**：它证明的是「版本不符会响」，**不证明 11.21.0 本身就是正确选型** —— 那是本条的选定值，升版流程写进 `AGENTS.md`，由人决定何时动。

**Done means**

- [x] `package.json` 有 `packageManager: pnpm@11.21.0`，`pnpm-workspace.yaml` 有 `pmOnFail: error`
- [x] 匹配态安装 exit 0 且 **lockfile 零变化**；A/B 实测不符时 exit 1、且失败发生在改动之前
- [x] `verify` 三段全绿；`check-docs` / `check-env` exit 0
- [x] `AGENTS.md` 写明钉法、误配处置、升版流程，以及「从仓库根跑不受本钉约束」这条边界
- [x] 基建-3 / CHANGELOGS #98 里那笔「未钉版本」的债**就地标注已结清**并指向本条；§零 与「新分支特有」清单同步

**结案记录（2026-10-15）**

- 实施：`package.json` 增 `"packageManager": "pnpm@11.21.0"`，`pnpm-workspace.yaml` 增 `pmOnFail: error`。读数：匹配态 `install` **exit 0**（649ms）且 `pnpm-lock.yaml` **未出现在** `git status` 里；`verify` 三段全绿 **38 文件 / 439 通过**；`check-docs` / `check-env` exit 0。
- **A/B（R27）**：`packageManager` 置 `pnpm@9.15.0` ⇒ 文档那条安装命令 **exit 1**（`This project is configured to use 9.15.0 of pnpm. Your current pnpm is v11.21.0`），**报错在任何下载/改动之前**（`node_modules` 与 lockfile 无变化）；`pnpm -v` 同样 exit 1 ⇒ 约束覆盖每条命令，不只安装；改回即复绿。
- 提交：方案 `8f7c835` → 实现 `6e30db2` → 结案（本提交）。

### 基建-5 · peer 设置搬进 `pnpm-workspace.yaml`，`.npmrc` 那行死配置删除（方案，2026-10-15 立项，R22）

**背景**：基建-4 的「顺带发现」记了一笔债 —— `plugins/dsh-autogamer/.npmrc` 里的 `auto-install-peers=false` 在 pnpm 11 **不被读取**。本轮把这件事量到底，发现它不是「无害的死配置」，而是**一条会红的命令**：

- 仓内 lockfile 已记录 `settings.autoInstallPeers: false`（每条文档命令都带 `--config.autoInstallPeers=false`）。
- 而 pnpm 11.21.0 的**有效默认是 `true`**（实测，见下方取证）。
- 于是任何不带那个旗标的命令直接失败：`pnpm install --frozen-lockfile` ⇒ **`[ERR_PNPM_LOCKFILE_CONFIG_MISMATCH] Cannot proceed with the frozen installation. The current "settings.autoInstallPeers" configuration doesn't match the value found in the lockfile`** ⇒ **exit 1**。
- 也就是说：**一条最朴素的命令今天是坏的**，而仓库里没有一处文档说它坏在哪。

**取证（R20 第 1 步：官方文档 + 本机实测；转述不搬文本，D20）**

| 出处 | 取到的事实 | 对本方案的作用 |
|---|---|---|
| pnpm 官方文档 `pnpm.io/settings` | pnpm 从命令行 / 环境变量 / `pnpm-workspace.yaml` 取配置；**只有 auth 与 registry 从 `.npmrc` 读** | `.npmrc` 里那行是**不被读取**的死配置，不是「另一处等效写法」 |
| pnpm 官方文档 `pnpm.io/settings/peer-dependencies` §`autoInstallPeers` | 文档写的默认值是 **`true`**；缺失的**非可选** peer 会被自动装入 | 决定「默认值不可信、必须显式声明」 |
| 本机实测（临时区最小工程，`react-dom@19.0.0` + 非可选 peer `react ^19`） | 默认时 lockfile 记 `settings.autoInstallPeers: true` 且虚拟 store 里**有**自动装入的 `react@19.3.0`，快照写成 `react-dom@19.0.0(react@19.3.0)`；写 `autoInstallPeers: false` 后 lockfile 记 `false`、`react` **不在树里**、快照不带 peer 后缀 | **两向**证明这个设置有牙，同时确认 11.21.0 的有效默认 = `true` |
| 本机实测（插件工程内） | `pnpm config get auto-install-peers` → `undefined`（同目录 `allowBuilds` 从 `pnpm-workspace.yaml` 读得到）⇒ `.npmrc` 那行确实没生效 | 死配置的**直接**读数 |
| 本机实测（插件工程内） | 裸 `pnpm install --frozen-lockfile` ⇒ `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` / **exit 1**；且失败发生在写 lockfile 之前（`git status` 干净） | 本条要修的**具体**故障，不是推测 |
| 本机核对（交付面） | `.npmrc` **不在** `package.json` 的 `files` 里 ⇒ 不进交付 tarball；`dsh plugin` 走 link/pack 也不读它 | 删它不影响宿主 |

**What（范围）**

- `plugins/dsh-autogamer/pnpm-workspace.yaml` 增 **`autoInstallPeers: false`**（v11 的设置家，与既有 `allowBuilds` / `pmOnFail` 同文件）。
- **删除** `plugins/dsh-autogamer/.npmrc` —— 全文件只有那一行（25 字节），留着等于同一个设置有两处声明而其中一处是哑的。
- 文档：本条 + 结案后的 CHANGELOGS；`AGENTS.md` 写明「设置的家是 `pnpm-workspace.yaml`；`.npmrc` 只留给 auth/registry」；**基建-4 记的那笔发现就地标注结清**（R28），§零 与「新分支特有」同步。
- **非目标**：**不动文档里那些命令的旗标**（`--config.autoInstallPeers=false` 继续有效且与文件一致，去掉它们会波及整本台账的历史读数，且没有收益）；不改 peer 声明本身；不 pin Node；不夹带别的配置搬迁。

**How（做法与关键决策）**

- **搬进 `pnpm-workspace.yaml` 而不是留着 `.npmrc`**：官方口径如此，且实测 `config get` 只有从该文件读得到。两处声明同一件事、其中一处哑掉，是本分支反复吃过的亏（配置、注释、文档三类都算）。
- **删 `.npmrc` 而不是把它改成注释说明**：一个 25 字节、唯一作用不被读取的文件，留着的收益是零、风险是下一个人以为它生效。真要 auth/registry 设置时按官方口径加回来即可（那本就是 `.npmrc` 的用途）。
- **值不变（仍是 `false`）**：本条是**搬迁 + 让它生效**，不是改策略；策略变更要单独立条目。
- **修好之后「朴素命令」就成立**：lockfile 记录的 `false` 与有效配置一致 ⇒ 裸 `pnpm install --frozen-lockfile` 从 exit 1 变 exit 0。这条是本条真正的验收物，不是「配置文件更好看」。

**Verify（验收命令）**

- 设置真的被读到：插件目录内 `pnpm config get autoInstallPeers` ⇒ **`false`**（改前 `undefined`）。
- **A/B（R27，判据会红）**：裸 `pnpm install --frozen-lockfile` ⇒ 改前 **exit 1** + `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`，改后 **exit 0**；两次之后 `git status --short` 都必须**不出现** `pnpm-lock.yaml`。
- **两向证明设置有牙**（临时区最小工程，不入库；读数抄进本条正文）：默认 ⇒ lockfile 记 `true` 且虚拟 store 有自动装入的 peer；`false` ⇒ lockfile 记 `false`、peer 不在树里、快照不带 peer 后缀。
- 回归：文档那条命令 `pnpm --config.verify-deps-before-run=false install --frozen-lockfile --config.autoInstallPeers=false` ⇒ **exit 0**；`pnpm --config.verify-deps-before-run=false run verify` ⇒ 三段全绿；`node scripts/check-docs.mjs` 与 `node scripts/check-env.mjs` ⇒ exit 0。
- 删除的边界核对：`git grep -n 'auto-install-peers' -- plugins` ⇒ **零命中**（`.npmrc` 已删，且 `pnpm-workspace.yaml` 用的是 camelCase 的 `autoInstallPeers`）。

**Done means**

- [x] `pnpm-workspace.yaml` 含 `autoInstallPeers: false`；`.npmrc` 已删除；全仓零处再以 kebab 形式声明同一设置
- [x] `pnpm config get autoInstallPeers` → `false`（改前 `undefined`）
- [x] A/B：裸 `pnpm install --frozen-lockfile` 改前 exit 1 + `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`、改后 exit 0；两次都不动 lockfile
- [x] 文档命令仍 exit 0；`verify` 三段全绿；`check-docs` / `check-env` exit 0
- [x] `AGENTS.md` 说明设置的家与 `.npmrc` 的用途边界；基建-4 / CHANGELOGS #99 里那笔发现**就地标注结清**；§零 与「新分支特有」清单同步

**结案记录（2026-10-15）**

- 实施：`pnpm-workspace.yaml` 增 `autoInstallPeers: false`；`git rm plugins/dsh-autogamer/.npmrc`（该文件全文只有那一行、25 字节，且不在 `files` 里，不进交付 tarball）。
- **单变量隔离（不只证「一起改完是绿的」）**：把 `.npmrc` 那行**临时写回**（未跟踪）⇒ 裸 `pnpm install --frozen-lockfile` 仍 **exit 0** ⇒ 生效的是文件里的设置，那行 `.npmrc` 确实不参与；删掉即删除重复声明，不是「碰巧同时修好」。
- 读数：`pnpm config get autoInstallPeers` ⇒ **`false`**（改前 `undefined`）；裸安装 **exit 0**（改前 exit 1 + `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`）；文档那条命令 exit 0；`verify` **38 文件 / 439 通过**；`git grep 'auto-install-peers' -- plugins` **零命中**；两次安装后 `pnpm-lock.yaml` 均未出现在 `git status`。
- 提交：方案 `9a07618` → 实现（本提交）→ 结案（下一提交）。

**方法上的自纠（R27，同轮记）**

- 探针第一版的判据是看 `node_modules/react` 存不存在 ⇒ **两种情况都「不存在」，是假绿**：自动装入的 peer 只进虚拟 store（`node_modules/.pnpm/react@…`），**不做顶层链接**。改成读 lockfile 的 `settings:` 与快照的 peer 后缀（`react-dom@19.0.0(react@19.3.0)`）才咬住。教训与本分支已记的两次同类事故同源：**判据要落在「记录事实的地方」，不是落在你以为的路径上**。

**顺带发现（同轮落账，R28）**

- `plugins/dsh-autogamer/.npmrc` 里的 `auto-install-peers=false` 在 pnpm 11 **已不被读取**：官方文档写明 v11 起只有 auth/registry 从 `.npmrc` 读（实测 `pnpm config get auto-install-peers` → `undefined`，而同目录 `allowBuilds` 从 `pnpm-workspace.yaml` 读得到）。⚠️ 初版把「今天无害」也写进了这里 —— **该判断已被实测推翻**：lockfile 记着 `autoInstallPeers: false` 而有效默认是 `true`，裸 `pnpm install --frozen-lockfile` 会 exit 1。**已由 基建-5 结清**（设置搬进 `pnpm-workspace.yaml`、`.npmrc` 删除，权威记录见 §七「基建-5」与 CHANGELOGS **#100**）。

### 基建-6 · 文档门禁补第七条检查（§四 编号唯一性）；另一条盲区清点后判定不写（方案，2026-10-15 立项，R22）

**背景**：基建-2 结案时自测出**两条门禁盲区**，记在 §零 那条 ⚠️ 里并写着「要覆盖这两类须各加一条检查，属后续项」：
①「同一事实的两处状态不一致」（§零 状态行说未开工、而 §七 跟踪行已勾完成）**抓不住**；
②「§四 表内编号唯一性」**不查** —— 当时实测：把 §四 一行的编号重复一次，门禁仍 `OK` / exit 0，撤掉后照旧。
本片**先清点再决定写不写**，不为「把两条都写掉」而写。

**R20 第 1 步「查」：只读清点（探针 `scratch/probe-gate-gaps.mjs`，忽略区、不入库）**

| 问 | 实测（2026-10-15，HEAD `1336cf5`） | 判定 |
|---|---|---|
| §四 表内 G 编号唯一吗 | **3 行 / 3 个不同编号，零重复** | 判据零歧义，且**有实测过的历史违例**（基建-2 那次）⇒ **可写**：与 C5 同性质——守住结构不变式，不是抓现存漂移 |
| §零 与 §七 真有状态不一致吗 | 26 个 §七 条目里**只有两个未全勾**：**交付-1 4/5**（C 项阻塞）、**G92 3/8**（探针 B/C 等）；而这两条在 §零 的指针行**都如实写了**「阻塞 / 探针 B/C 待设备」 | **当前零不一致样本** ⇒ 按 R27（没样本的判据是假判据）**不写** |

清点另外暴露两条让「按名配对」天然脆的事实（⇒ 更不该现在写那条检查）：

1. **条目名形状不统一**：既有 `### 小节` 形式（T1 / T5 / 基建-x），也有 §七 顶部的 `- [x] …` 清单项形式（前置-1 / 前置-2）——
   解析器要么只覆盖一半，要么得维护两套规则，而两套规则的分歧点没人能预先判定。
2. **`T1` / `T2` / `T3` 各有两个同名 `###` 小节**（方案 + 收口记录各一个）⇒ 「条目名 → Done means」**不是单射**，配对必须先定义取哪一个，而任何选择都会在某次改名后静默失效。

而盲区①在历史上唯一的真实样本（基建-2 自己那行）**已被 C6 覆盖**（自称完成 vs 未勾验收项）——
所以这条检查今天既无样本，其近邻语义也已有覆盖：**先记判定，不占编号**。

**What（范围）**

1. `scripts/check-docs.mjs` 增第七条检查 **C7「§四 编号唯一性」**：解析 §四 表第一列，`/^G\d+$/` 的编号**重复出现即 FAIL**，finding 指向**第二次出现**的那一行。
2. `--selftest` 增一条变异 **M8-C7**：结构锚点 —— 在 §四 表分隔行后**复制第一行数据行** ⇒ 必然产生重复编号，C7 必须红。
3. 盲区①**不写检查**：把上面两张清点表与两条脆点事实落成本条的「判定：不写」段；并**就地更新** §零 基建-2 那条 ⚠️（R28：已判定的旧表述不许继续写「属后续项」）。

**非目标**：不改 C1–C6 的任何判定；不引入 CI（本分支无 CI，门禁仍是本地钩子 + 手跑）；**不把盲区①写成一个靠词表的启发式检查**（那只会造一台永不红的假绿机器）；不动插件代码。

**How（做法与关键决策）**

- **复用 C1 已解析的那一遍扫描**：C1 已经在扫 §四 的 G 行并收集成 `Set` —— **正是 Set 去重，所以它看不见重复**。C7 只需在同一遍里多记「每个编号第一次出现的行号」，改动面最小、也不必第二次解析整份台账。
- **指向第二次出现**：第一次出现是合法的，报告位置取后一处 —— 与 C1 / C5 的风格一致（指出**哪一行**有问题，不整表点名）。
- **判据是结构不变式，不是「今天没有重复」**：这类检查的价值在未来，所以验收**只能靠变异**证明它会红，不能靠现状是绿的。
- **锚点纪律**：M8-C7 一律走「§四 表分隔行后插行」这个结构锚点，**绝不锚在某一行的散文上**（本分支已因此两次 BLIND，见基建-2 收口记录）。

**Verify（验收命令）**

- `node scripts/check-docs.mjs` ⇒ exit 0（先证明对现状不误报：今天 §四 无重复）。
- `node scripts/check-docs.mjs --selftest` ⇒ exit 0，并打印 8 条变异；其中 M8-C7 必须是 `ok -> C7 1 finding(s)`。
- **手工变异（R27，落在真实文件上）**：把 §四 某一行编号改成表内另一行已有的编号 ⇒ exit 1 且 finding **指向被改的那一行**；改回 ⇒ exit 0。
  （`--selftest` 只证明内存副本会红；真实文件这一手是防「判据在真文件上失明」。）
- 回归：`node scripts/check-env.mjs` exit 0；`pnpm --config.verify-deps-before-run=false run verify`（插件）读数**不变**（本片不动插件代码）。
- 边界自查：`git grep -n "C7" -- docs scripts | grep -v "^scripts/check-docs.mjs"` 的每一处都指同一条检查（防编号重名）。

**Done means**

- [x] C7「§四 编号唯一性」落地并进 `CHECKS`，今天对现状 exit 0
- [x] M8-C7 变异落地；`--selftest` 8 例无假绿；真实文件上手工变异红/绿各一次且 finding 指对行
- [x] 盲区①的「不写」判定与清点证据落本条目；§零 基建-2 的 ⚠️ 就地更新（不再写「属后续项」）
- [x] `check-docs` / `check-env` exit 0；插件 `verify` 读数不变

**结案记录（2026-10-15）**

- **落地**：`scripts/check-docs.mjs` 增 `checkGapIdUniqueness`（登记为 **C7 / `gap-id-uniqueness`**）、进 `CHECKS`、文件头检查清单补一行；`--selftest` 增 **M8-C7** 与它的结构锚点 `duplicateFirstGapRow()`。
- **实现口径**：
  - 复用 `section(todo, 含「开放差距」)` + `splitRow`，**编号形状 `/^G\d+$/` 与 C1 完全一致** ⇒ 两条检查不会在「什么算一个编号」上分叉；
  - finding 指向**第二次出现**的行，消息里带上第一次的行号（C1 / C5 的风格：指出哪一行，不整表点名）；
  - 锚点缺失（表没了 / 一行 G 编号都解析不出）与 C1 同款报错，不静默跳过（基建-2 的 How 纪律）。
  - **为什么 C1 看不见这件事**：C1 把这些编号收进 `Set` —— Set 正是「去重」的结构，也就是**结构上不可能看见重复**。C7 是它的补集，不是重复劳动。
- **变异（R27，两手都要）**：
  - `--selftest` 的 **M8-C7**：`ok -> C7 1 finding(s)`。锚点是**表结构**（读出第一行数据行并整行复制），不点任何编号、不碰散文 ⇒ 将来 §四 换哪几条差距都不会让它悄悄失明；整行复制还保证单元格数不变，所以这条变异的颜色**只**归 C7。
  - **真实文件手工变异**：把 §四 里 `G78` 那一行的编号改成表内已有的 `G92` ⇒ `check-docs` **exit 1**，输出 `C7 docs/TODO.md:165 -> G92 already holds an open-gap row at line 164` ⇒ **finding 指的正是被改的那一行**；改回 ⇒ exit 0，`git diff` 对该文件**零差异**（撤销干净）。
  - **一条顺带的确认**：那次变异**没有**触发 C1（C1 只对「§四 之外带结清措辞」的编号响，而被改那行讲的是「退出前置」，没有结清词）⇒ 两条检查的职责边界符合预期，不是互相代偿。
- **门禁与回归**：`check-docs` ⇒ **7 checks / 9 files，exit 0**；`--selftest` ⇒ **8 变异，无假绿**；`check-env` exit 0；插件 `verify` **42 文件 / 466 通过**（本片不动插件代码，读数不变）。
- **盲区①为什么就此打住**（判定，不是搁置）：清点见方案段两张表 —— 当前**零样本**，且按名配对有两条结构性脆点（条目名两种形状、`T1`/`T2`/`T3` 同名小节）。**将来真出现不一致时的正确做法**：先照本条的清点法跑一遍，把**真实样本**贴进本条目，再决定检查形状；不要凭想象写一个靠词表的启发式检查 —— 那会是一台永不红的假绿机器。
- 提交：方案 `0e74e9e` → 实现与结案（本提交）。

### 调研-1 · 上游五份未读文档读完并回写（含一条推翻自己上一版的实测）（2026-10-15 结案；CHANGELOGS #106）

> 性质：**只读调研 + 文档回写**，不改任何代码。起因是「还有哪些无需设备的内容」这个清点 —— 守则「待补清单」那份
> 诚实清单本身就是答案：五份上游文档从未读过，且其中一条路径是凭印象写的。

**R20 第 1 步「查」：读了哪份、原文怎么说**（全部取自上游 `master`，副本在忽略区 `scratch/upstream/`，**不入库**、不复制原文进仓）

| 上游文档 | 与本插件相关的取到事实 | 落到哪 |
|---|---|---|
| `packages/guard/timeout-policy/README.zh.md` + `src/index.ts` | **零配置、随 `dsh` 基础组合默认启用**；协作式只通知不硬停；只对**声明了 `timeoutMs`** 的工具设 deadline；结构化错误 code 在 **`error.info.code`**；多包装层按注册顺序组合；包名已定为不再改 | **守则 R15**（并**推翻**下面那条） |
| `packages/core/tools/README.zh.md` | 并发读侧入口 **`executionMode()`**；「**插件只能在自身拥有的定义上声明分类器**」；`tools/pre-execute` **有意不允许改写 `exec.arguments`** | **守则 R14** + 待补清单第 6 条 |
| `docs/subsystems/scope.zh.md` | scope 是**库原语**（非服务）：`ScopeKey` 是不透明对象身份、`Scoped<T>` 是编译期品牌标记的路由接收器、`Scope.dispose()` 是「完全停稳边界」；注册表层用 `ScopeLayer`/`ScopedLayers` 聚合 | 印证我们 `session/event` + `{ global: true }` 的用法符合官方原语（R8/R16/R20） |
| `packages/jobs/jobs/README.zh.md` | `dsh-jobs` 的归属是**当前 agent 会话**，id 形如 `<kind>-<short-uuid>`，**跨 agent 不可见也不可停** | 我们挂的是 `dsh-tool-jobs`（给 agent 的工具面），**自己没用 jobs 跑任务**；任务走会话投影，语义方向一致 |
| `docs/capability-seams.md` | 生成的服务图谱：`ctx.sessionProjections`/`ctx.systemPrompt`/`ctx.tools`/`ctx.attachments`/`ctx.agents` **都存在**；**`ctx.slots` 0 命中** | 交叉验证我们 inject 的三个服务真实存在 ⇒ R8 的「waiting for services」风险当前不成立；`ctx.slots` 的真名待将来做 UI 时重查 |
| `docs/tool-catalog.md` | 官方工具目录里**没有 adb / 设备执行类工具**（grep 只命中浏览器 stagehand 的 `stagehand_screenshot` 等） | 本插件的能力**无官方重叠**，是真实增量 |

**本轮最重要的一条：推翻我自己在上一轮写下的判断**

上一轮（文档对齐-1 / #103）我把守则 R15 的现状写成「**包装层未接**」。**那是错的**，本轮当场更正：

- 上游 README 写明该包装层**零配置、随 `dsh` 基础组合默认启用** ⇒ 不存在「我们选择不接」这回事；
- 本机实测 `dsh --profile web --dump-config` 的组合树里确有 `- id: timeout-policy` / `name: '@deepseek-ai/dsh-tool-call-timeout-policy'`，
  **无 `disabled`** ⇒ 启用中（本轮不需要设备、不需要会话，一条命令 + 读上下文就证完）。
- ⚠️ **核验时踩到 R25 的老坑**：紧邻上一行 `@deepseek-ai/dsh-tool-workflow` 带 `disabled: true`。
  不读上下文就 grep，很容易把那个 `disabled` 错安到 `timeout-policy` 头上、得出**相反**的结论。
- ⇒ **现状是「外层兜底 + 内层自实现」的嵌套**：包装层对声明了 `timeoutMs` 的工具设 deadline（我们 `run_device_action` 45s、`report_task_status` 5s），
  adb / OCR / provider backend 三处仍各自自实现。不是重复实现：内层通常先返回，包装层是兜底。
- 🔶 **但两层同时计时的情形一次都没量过**（#97 的 live 里七个工具都正常返回）⇒ **在量到之前不许写「两层不冲突」这种结论**，要实测需设备。

**顺带结清的两条待补**

- **R14 / R15 的真实字段名取到了**（R14：`executionMode()`；R15：包装层**根本没有入参**）⇒ 台账原写「必须用 `cordis_inspect_query` 取真名」**是多余的**，
  先读上游声明面即可，且省掉一轮需要模型凭据的宿主会话。
- **一处凭印象写的路径实测 404**：`docs/dsh-tool-call-timeout-policy` 不存在，真路径 `packages/guard/timeout-policy/README.zh.md`（包名未变）。
  一份标题写着「不许凭印象引用」的清单，自己违反了自己的规矩 —— 留作 R20 的现成案例。

**Verify（验收命令）**

- `node scripts/check-docs.mjs` 与 `--selftest` ⇒ exit 0；`node scripts/check-env.mjs` ⇒ exit 0（上游副本只在忽略区 `scratch/`）。
- `dsh --profile web --dump-config` ⇒ exit 0，组合树含 `- id: timeout-policy` 且**该行块内无 `disabled`**（R6 口径本轮没改 patch，仅作取证）。
- `git grep -n "clientHalf.spec" -- plugins` ⇒ **只命中 `client.js` 自己的注释**（那个 spec 已随 T4 删除）⇒ 这就是 **G95** 的判据起点。
- 回归：插件 `verify` 读数不变（本条只改文档）。

**Done means**

- [x] 五份文档读完 + 包装层 `src/index.ts` 读过，结论逐条落到 R14 / R15 / 待补清单，每条带官方出处
- [x] **R15 的「包装层未接」被实测推翻并就地更正**（含相邻包 `disabled` 的核验陷阱）
- [x] 待补清单第 3 项标为已读、第 5 项标为已结清；新增第 6 条记新欠账（宿主图谱交叉验证结论 / `pre-execute` 不可改参数）
- [x] **本轮自己那次跨作用域外推（R25）已就地作废并留证**，它意外挖出的 `client.js` 零锁缺口新立 **G95**
- [x] 门禁三条命令 exit 0；插件 `verify` 读数不变；上游副本只在忽略区，未入库

**非目标**：不接那个包装层（本插件的超时自实现保留，R15 的嵌套形态已写清）；不动 `classify.ts`（`error.info.code` 的分类口径记进 R15，等真有超时再落）；不因 `ctx.slots` 未命中就改动任何 UI 计划（G88 仍待需求）。

### G95 · 恢复 `client.js` 的浏览器半边锁（T4 的连坐删除；方案 2026-10-15 立项，R22）

**根因（已查实，不是推测）**：这不是「顺手删过头」，是一次**混称导致的连坐**：

1. T2-f 的提供方清点记：`src/artemis/` 已无消费者 ⇒「模块本体与其 `clientHalf` / `mcpBackend` 规格 ⇒ **T4 裁决删除或保留为可选面**」；
2. **那一句把两个不同的东西混称了** —— `mcpBackend` 的规格锁的是 `src/artemis/mcpBackend.ts`（确属 provider 链，该删），
   而 `tests/clientHalf.spec.ts` 锁的是 **`client.js`**（浏览器半边，与 provider 链毫无关系）；
3. T4（`3677a49`）据那句把 `tests/clientHalf.spec.ts` 一并删除，与 `actionClient` / `mockServer` / `scrcpy` 三个**确属**该删的并列；
4. ⇒ **`client.js` 留在交付面里却零锁**，而它自己的头注释仍写着「locked by tests/clientHalf.spec.ts」—— **指向一个不存在的文件**。
   判据起点（可复跑）：`git grep -n "clientHalf.spec" -- plugins` ⇒ **只命中 `client.js` 自己的注释**。

**R20 第 1 步「查」：官方一手原文（两处，都取自上游 `master` / 本仓历史，只读、不搬文本）**

| 出处 | 取到的事实 | 对本方案的作用 |
|---|---|---|
| 上游 `packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/client.js`（HTTP 200，686 B） | 官方模板逐字是 `window.__ModuleLoader__.load({ id, factory(require) })` + `require('react')` + `return { inject: ['slots'], apply(ctx) { ctx.slots.inject(<slot>, () => ctx.slots.register({ name, id, order }, Component)) } }` | **证实 `ctx.slots.inject/register` 这个形状有一手出处**（调研-1 那次「图谱查不到」的怀疑到此彻底排除：`capability-seams.md` 只画宿主侧）；也说明模板的 `register` 只给 `{name,id,order}`，我们多传的 `key` 依据在 **R18**（keyed slot 按 wire 工具名注册） |
| 本仓历史 `3677a49^:plugins/dsh-autogamer/tests/clientHalf.spec.ts`（77 行） | 它锁的四组：① manifest 半边（`dsh.client{platform,immediately,inject:['slots']}` + `exports['./client']` + `files` 含 `client.js`）；② ModuleLoader 形状 + 五个 wire key；③ **只准 `require('react')`**（禁第二个框架、禁 `from '@deepseek-ai/'` = R18 的「不许 import 宿主 Client 包」）；④ **负向锁**（`conversation.card` / `ctx.rpc` / `settings.plugin.item` / `WebSocket` / `VideoDecoder` / `multipart/x-mixed-replace` / `fetch(` 一律不得复活） | **这些断言今天仍然全部成立**（`client.js` 与 `package.json` 自 T4 以来未动）⇒ **恢复即可，不必重写**；且它是**我们自己仓库的历史代码**，恢复不触碰 D20（不搬运上游文本） |

**What（范围）**

1. 从历史**恢复** `tests/clientHalf.spec.ts`（`git show 3677a49^:…`），**逐条复核断言今天仍成立**再入库。
2. **变异校验（R27）**：故意改坏 `client.js` / `package.json`，证明每组锁都会红，且是「恰好那一条」红。
3. 修 `client.js` 头注释：把「locked by tests/clientHalf.spec.ts」从**谎话**改回事实，并**补上这条锁的边界**（见 How-3）。
4. 台账：G95 结案（§四 删行）、§零 指针、CHANGELOGS 条目。

**How（做法与关键决策）**

- **恢复，不重写**：那 77 行锁的正是我们要守的东西（manifest 半边 + 形状 + 五个 key + R18 负向锁），重写只会丢断言。
  但**不许假设「恢复就绿」**：T4 之后 manifest 动过（`actionServerCommand` 等字段被删、`files` 重排），所以恢复后**逐条跑**，
  哪条不成立就**按实测改判据并把理由写进本条目** —— **不许为了让绿去改 `client.js`**（那是本末倒置）。
- **为什么锁文本而不是行为**：`client.js` 是手写的 ModuleLoader 格式纯 JS（tsc 编不出，node 也 import 不了）⇒ 只能对文本断言。
  这与 `deliveryShape.spec` 锁两个 patch 文件互相印证，是本仓已有的手法，**不是新发明**。
- **⚠️ 明确这条锁的边界（写进 `client.js` 注释）**：它锁**结构事实**，**不证明**卡片在浏览器里真的渲染过。
  live 渲染验证另需一次真实会话，而**五个工具全过 `requireEnv` 预检** ⇒ **那条验证也需要设备**，本轮不做、标 🔶。
  别把「有锁」读成「验过」（R21：区分单测证明与 live 证明）。
- **不删 `client.js`**：它在 `files` / `exports` / `dsh.client` 三处都在，是 R18 路线的唯一实现，G88 将来解锁时的起点。

**Verify（验收命令，在 `plugins/dsh-autogamer/` 内）**

- `pnpm --config.verify-deps-before-run=false run verify` ⇒ 三段全绿（文件数/用例数按实测记，不预设）。
- **变异（R27，三条各证明会红）**：
  ① 从 `client.js` 的 `CELLS` 删掉 `autogamer_diagnose` 一行 ⇒ 「五个 wire key」那条红；
  ② 在 `client.js` 加一行 `const _ = require('lodash');` ⇒ 「只准 `require('react')`」那条红；
  ③ `package.json` 的 `files` 去掉 `client.js` ⇒ manifest 那条红。全部还原后复跑须全绿。
- `node scripts/check-docs.mjs`（含 `--selftest`）与 `node scripts/check-env.mjs` ⇒ exit 0。
- 闭环判据：`git grep -n "clientHalf.spec" -- plugins` ⇒ 命中**两处且都指向真实存在的文件**（spec 自身 + `client.js` 注释）；
  `git status --short` 在三次变异还原后对 `plugins/` **零差异**。

**Done means**

- [x] `tests/clientHalf.spec.ts` 恢复，四组断言逐条复核（不成立者按实测改判据并记理由，不许改 `client.js` 求绿）
- [x] 三条变异各红一次且恰好对应那条锁；还原后 `verify` 复绿、工作树对 `plugins/` 零差异
- [x] `client.js` 注释改回事实并写明锁的边界（结构锁 ≠ live 渲染验证，后者 🔶 需设备）
- [x] G95 结案（§四 删行）、§零 指针、CHANGELOGS 条目；`check-docs` / `check-env` exit 0

**结案记录（2026-10-15）**

- **恢复即绿，六条断言一条没改**：`git checkout 3677a49^ -- plugins/dsh-autogamer/tests/clientHalf.spec.ts` 之后 `6 passed`。
  ⇒ 方案里那句「不许假设恢复就绿」的检查**做了、结论是它成立**：自 T4 以来 `client.js` 与 `package.json` 的 manifest 半边确实没动过，
  **一条判据都不用改**。这也反过来证明方案里「不为了绿去改 `client.js`」的约束不是空话 —— 它有可能是被违反的，只是这次没触发。
- ⚠️ **一次操作层面的翻车，值得记**：第一次恢复用 PowerShell 的 `git show … > file` 重定向，
  PowerShell 5 按默认编码把文件写成 **UTF-16**，esbuild 直接解析失败（`1 failed / no tests`，而错误栈指向 esbuild、与测试内容毫无关系）。
  ⇒ **正解是 `git checkout <commit> -- <path>`**：它按字节写文件，顺带把条目 stage 好。判据上也要注意：这种失败的报错**长得像代码问题**，
  实际是编码问题 —— 与本分支记录的「一串错误只能证明那次失败发生、不能证明因果」是同一条（R25）。
- **三条变异各红一次，且恰好一条红**（R27）：
  | 变异 | 改哪 | 红的锁 |
  |---|---|---|
  | ① | `client.js` 的 `CELLS` 删掉 `autogamer_diagnose` 一行 | 「五个 wire key」⇒ 报 `toolview key for autogamer_diagnose` |
  | ② | 加一行 `const _ = require('lodash');` | 「imports nothing but react」⇒ 报 `not to match` + 那条**排除 react 的 require 正则**（**这正是 R18「不许第二个框架/宿主 Client 包」的机械形态**；⚠️ **正则本身不要用单反引号包** —— C2 会把反引号里的内容当仓内路径查，会假红） |
  | ③ | `package.json` 的 `files` 去掉 `client.js` | manifest 那条 ⇒ 报 `expected [...] to include 'client.js'` |
  三次都是 `1 failed | 5 passed`，其余五条不受影响；全部还原后 `git status --short` 对 `plugins/` **零差异**（只剩新增的 spec）。
- **注释改成事实，并写明这条锁的边界**：`client.js` 头注释原来那句「locked by tests/clientHalf.spec.ts」现在成真（此前是谎话），
  同时补上「它锁结构、**不证明卡片在浏览器里渲染过**」—— 后者要一次真会话，而五个工具全过 `requireEnv` ⇒ **需设备**，标 🔶。R21：别把「有锁」读成「验过 live」。
- ⚠️ **方案里那条闭环判据我自己写错了，当场改口径**（R27）：我写的是「`git grep clientHalf.spec -- plugins` ⇒ 命中**两处**（spec 自身 + 注释）」——
  **实测只有 1 处**，因为 spec 内部**不自指文件名**（它的头注释是 "Browser-half locks (Phase 3)"）。
  真正能咬住这条的判据是**注释指向的文件是否存在**：`Test-Path plugins/dsh-autogamer/tests/clientHalf.spec.ts`
  ⇒ 修复前 **False**（注释在撒谎），修复后 **True**。判据改成两条并列，**都要能红**。
- 读数：`verify` **43 文件 / 472 通过**（上一绿态 42/466，+1 文件 +6 条）；`check-docs` / `check-env` exit 0。
- 提交：方案 `a3578ac` → 实现与结案（本提交）。

**非目标**：不删 `client.js`；不做 live 渲染验证（需设备）；不扩 UI 能力（G88 仍待需求）；不动 `package.json` 的 manifest 形状（它就是被锁的对象）。

### G92 · 合成难帧（方案 2026-10-15 立项，R22；G92 方案 Verify 里那条标「可选」的离线项）

> 本条是 **G92 方案 Verify 里的「（可选）合成难帧」**，只做**机制回归**，**不替代真机召回数字**（方案原话）。
> 探针 B/C 与阶梯接线仍需设备，不在本条范围。

**R20 第 1 步「查」：先量「能不能造出来」，再决定方案（探针在忽略区 `scratch/`，不入库）**

| 问 | 实测 | 结论 |
|---|---|---|
| 能不能离线造出「整帧 MISS + 区域 HIT」的帧？ | **能**，但只有一种造法成立（见下） | 本条成立 |
| 造法①：把好帧的标签**缩小**再贴 | ❌ 全档 MISS，连「只缩不降对比」（shrink=2、keep=1）都 MISS | **已否证**：缩小在**像素层**摧毁字形，@2× 放大救不回来。与 T5 真机实测（原生 140×70 块 @2× 成功）不矛盾 —— 那块本来就有 70px 高 |
| 造法②：直接用夹具自带难帧 | ❌ 夹具上**区域命中的 needle 整帧全都有** | **已否证**：夹具是「整帧 ⊇ 区域」，而 G92 要的是「区域 ⊋ 整帧」，**方向相反** |
| 造法③：**原尺寸**标签贴进混排背景 | ✅ 整帧 MISS、区域 @2× HIT | **成立** —— 整帧失败来自版面分析而非细节丢失，正是 G92 认定的瓶颈 |

**顺带扫出的参数表（探针 B 的离线预演；pad × scale，needle =「游戏中心」，真模型）**

```
pad\scale |  1.0  1.5  2.0  3.0
      0   |  HIT  miss  miss  HIT
      4   |  HIT  miss  miss  HIT
      8   |  HIT  miss   HIT  HIT
     16   |  HIT  miss   HIT  HIT
     24   |  miss  miss  miss  miss
```

三条稳健读数：① **`scale=1.5` 是全 miss 的陷阱档**（反直觉：中间倍数最差）；② **`pad=24` 全 miss**（padding 过大让版面分析又找不到行）；
③ **当前默认 `scale=2` 依赖 `pad≥8` 才成立**（pad=0/4 时 miss）。
⚠️ 这是**一块标签、一个位置**的读数，**不能**据此改默认常量（真机最优点要探针 B 在真机上量）。它的用处是**缩小探针 B 的搜索空间、并给本条挑一组已知可行的锁参数**。

**What（范围）**

1. 新增版本化生成脚本 `plugins/dsh-autogamer/scripts/synth-hard-frame.mjs`：读现有真夹具 → 裁一块**原尺寸**标签 → 贴进合成的启动器背景（灰底 + 散乱色块）→ 用 `src/ocr/image.ts` 的 `encodePng` 落成
   `tests/fixtures/screen-synth-hard.png`；**并**落一份最小合成层级 `tests/fixtures/hierarchy-synth-hard.xml`（根 + 一个叶级框，正好覆盖那块标签，面积比远小于候选上限）。
2. 新增 `tests/ocrSyntheticFrame.spec.ts`（真模型，**成对**断言）：
   - **它确实是难帧**：`findNeedleHits(整帧识别)` **无命中**；
   - **机制确实成立**：`recognizeRegions` 在同一帧上命中，且映射回全屏的落点**落在那个候选框内**。
   两条缺一不可 —— 只锁前者会得到一个「难但没法救」的夹具，只锁后者则可能夹具根本不难。
3. 生成脚本同时是一个**可复跑的参数扫描探针**（打印上面那张 pad × scale 表）；测试本身只跑一组已知可行的参数，不把全表塞进 CI。
4. 台账：G92 记「合成难帧已完成（机制回归）」，探针 B/C 的 Done 项**不动**。

**How（做法与关键决策）**

- **合成器用零依赖自研像素操作**（背景、贴图都由 `RgbImage` 手写），**不引入任何图像/字体依赖** —— 延续 T5 否掉 `sharp`/`pngjs` 的口径。
  文字**不重新渲染**：用真夹具里已知的字形，这也正是造法①被否、造法③成立的原因。
- **合成层级要「干净」**：根节点全屏 + 恰好一个叶级框。候选过滤会把全屏容器按面积比与包含关系剔掉（现有规则），所以**必须实测候选数 = 1**，否则这条锁测的不是 P1 而是被过滤后的巧合。
- **锁 `pad=8, scale=2`（= `DEFAULT_REGION_OPTIONS` 当前值）**：证明**默认常量在难帧上也成立**，将来改常量会立刻被这条抓住。`scale=1.5` 那格留作**变异②**（把它设成默认 ⇒ 锁红），不写进常规断言（依赖具体字形与引擎版本，太脆）。
- **明确这条锁的边界**：它证明「**整帧失败时区域识别能救回**」这一机制，**不证明**任何真机召回率。G92 结案仍要探针 B/C 的真机数字。
- 生成脚本放 `scripts/`（不进 `files` 白名单 ⇒ 不进交付 tarball，符合预期，与 `clean-dist.mjs` 同例）。

**Verify（验收命令）**

- `node scripts/synth-hard-frame.mjs`（插件目录内）⇒ 落两个夹具 + 打印 pad × scale 表；**重跑字节级一致**（同样的输入与纯函数式合成 ⇒ 可作判据）。
- `pnpm --config.verify-deps-before-run=false run verify` ⇒ 三段全绿，文件/用例数按实测记。
- **变异（R27，三条各红一次）**：
  ① 把 `DEFAULT_REGION_OPTIONS.scale` 改成 **1.5**（扫描表里的全 miss 档）⇒ 合成帧那条锁红 —— **这条把「参数扫描的结论」变成自动化判据，而不只是纸面记录**；
  ② 去掉 `mapHitToFrame` 的 origin 偏移 ⇒ 落点不在候选框内，红；
  ③ 让合成帧的**整帧**也能命中（例如把标签放大到整帧可读）⇒ 「它确实是难帧」那条红 —— **证明第一条断言不是空断言**。
- `node scripts/check-docs.mjs`（含 `--selftest`）与 `node scripts/check-env.mjs` ⇒ exit 0。

**Done means**

- [x] 合成器 + 两个夹具入库；重跑字节级一致；参数表可复跑打印
- [x] 真模型锁成对落地（难帧断言 + 区域命中且落框内），候选数实测为 1
- [x] 三条变异各红一次（其中「把默认 scale 改成 1.5 ⇒ 红」是本条的关键产物）；还原后 `verify` 复绿
- [x] 台账与 CHANGELOGS 同步，**并写明这条锁不替代真机召回数字**；**G92 本身不因此结案**（探针 B/C 与阶梯接线仍需设备）；门禁三条命令 exit 0

**结案记录（2026-10-15）**

- **落地**：`scripts/synth-hard-frame.mjs`（零依赖，生成器 + `--scan` 探针）、`tests/fixtures/screen-synth-hard.png`（**41 KB**，对比真夹具 1.28 MB）、
  `tests/fixtures/hierarchy-synth-hard.xml`（根 + **恰好一个**叶级候选框，`[620,430][800,482]`）、`tests/ocrSyntheticFrame.spec.ts`（2 条真模型锁）。
  **生成器字节级可复跑**（连跑两次 PNG/XML 的 SHA-256 相同）⇒ 「重跑即得同一夹具」是可用的判据，不是愿望。
- ⚠️ **合成 XML 的第一版是无效 XML**：叶节点重复了 `clickable` / `focusable` 属性（我把它拼在了已含该属性的属性串后面）。已拆成 root/leaf 两套属性串重生成。
  这条没被任何测试抓到 —— **因为测试是在夹具生成之后才写的**；写夹具时顺手核一遍 XML 合法性是更早的防线。
- **三条变异，各红一次**，其中第一条的**第一版是绿的**，这才是本条最值钱的地方：

  | 变异 | 结果 |
  |---|---|
  | ① 把 `DEFAULT_REGION_OPTIONS.scale` 改成 **1.5**（扫描表里的全 miss 档） | **第一版全绿** ⇒ spec 里 `scale: 2` 是**写死的字面量**、根本没引用默认值，改默认值对它零影响。改成从 `DEFAULT_REGION_OPTIONS` 取参后 ⇒ **红**，报 `region scan found no needle in the one candidate` |
  | ② `mapBox` 去掉 `origin` 偏移 | 红：`expected 99 to be greater than or equal to 612`（落点掉到框外，坐标差一目了然） |
  | ③ 把夹具换成**整帧可读**的真夹具 | 红：「难帧」断言变红 ⇒ **证明它不是空断言** |

  变异①的教训是 **R27 判据 6** 的教科书形态：变异「跑了、什么都没变」有两种原因 —— 锁是虚的，或者**改动没进到被执行的路径**。
  我第一反应是「这条锁大概不行」，而真相是**我的 spec 没走产品要走的那条路**（写死字面量 vs 读默认值）。
  若不真跑这一次，就会照着错误结论去「重写一条好锁」。
- **第三条否定结论（与造法①②同族）**：我本想让「整帧可读」通过**把标签放大**实现，实测**放大 5 倍整帧仍然读不出** ——
  ⇒ 在散乱色块背景上，tesseract 面对**单个**文字块时整页版面分析直接放弃，**与字号无关**。
  所以变异③改用真夹具做对照（它整帧确实读得出 `游戏中心`）。
  ⚠️ **由此收窄这条夹具的代表性**：它复现的是「散乱背景 + 孤立文字块」这一形态，**与真机难帧并不完全同构**（真机是满屏图标+标签混排）。
  这不削弱它的用途 —— 它证明的是**机制可用**（整帧放弃时区域识别能救回），**不证明真机召回**，后者仍属探针 B/C。
- **参数表（探针 B 的离线预演，已落 §七方案段）**：`scale=1.5` 在每个 padding 都 miss、`pad=24` 全 miss、当前默认 `scale=2` 依赖 `pad≥8`。
  **不改默认值** —— 一块标签一个位置的读数不构成改常量的依据。
- 读数：`verify` **44 文件 / 474 通过**（上一绿态 43/472，+1 文件 +2 条）；三次变异还原后 `git status --short` 对已跟踪文件**零差异**（只剩两个新夹具待入库）。
- 提交：方案 `69ab7dd` → 实现与结案（本提交）。

### 设备前置调研 · 「这三项能不能不靠设备推进」（2026-10-15 结论；CHANGELOGS #109）

> 起因：用户问「现在没有设备是否可以设计 mock 来完善这三项」。本条只出**结论与路径**，不动代码。

**一、mock 能顶到哪（逐项查实，不是推测）**

| 项 | mock 能顶到哪 | 依据 |
|---|---|---|
| **G92 探针 B**（真机难帧召回数字） | ❌ 顶不到 | 探针 A 已把**工程面**做完（管线 / 坐标映射 / 候选过滤 / 锁），B 剩下的**只有真机数字**：字体渲染、抗锯齿、设备实际对比度都不是 mock 能造的 |
| **G92 探针 C**（判 P2 去留） | ⚠️ 一半 | 「P1 在无层级场景必然失效」可离线锁（合成一张纯渲染帧 + 全屏容器层级）；「P2 能不能救」必须真实渲染帧 |
| **交付-1 C 项**（三任务工具宿主内点名） | ❌ 顶不到 | **三个工具全部过 `requireEnv`**（`runTask.ts:110` / `manageTask.ts:114` / `inspectTrace.ts:95`）⇒ 没有设备必被 preflight 闸门挡 |
| （附带）超时两层机制 | ⚠️ 有条件可行 | `report_task_status` **不过 preflight** 且声明 `timeoutMs: 5000` ⇒ 可在 conformance 里用**真实 timeout-policy 包**离线验机制；代价是**加一个 devDependency**（R19 授权面） |

⇒ **一句话**：mock 补的是**机制层**，补不了 **live 层**；任何 mock 绿都必须标 🔶，不许冒充结案（R21 / C1）。

**二、「需要设备」这个前提本身要修正（本条最有价值的产出）**

台账与对话里一直写成「需要用户提供设备」，读起来像**本机做不到**。实测不是：

| 面 | 实测 | 出处 |
|---|---|---|
| 虚拟化 | **已启用**（固件中已启用虚拟化 = 是；虚拟机监控程序模式扩展 = 是；要求虚拟化方面的 Hyper-V = 已启用）；`HyperVisorPresent = True` | `systeminfo` / `Get-ComputerInfo` |
| 内存 / 磁盘 | RAM **32 GB**、C 盘空闲 **712 GB** | `Get-CimInstance` / `Get-PSDrive` |
| 可安装性 | `winget` 里 `Google.PlatformTools` **37.0.1**、`Google.AndroidStudio` **2026.2.1.8** 均在源内 | `winget search` |
| CPU | Intel Core Ultra 9 185H（支持 VT-x） | `Win32_Processor` |

⇒ **卡的是「安装」（R19 授权面 + 数 GB 下载），不是硬件能力。**

**三、四条解锁路径（成本 / 授权 / 解锁范围）**

| 路径 | 成本 | 授权面 | 解锁 |
|---|---|---|---|
| **B（推荐）** Platform Tools（~10 MB）＋ **用户自己的手机开无线调试** | 最小；手机侧需用户自己操作 | R19：装 adb | **全部三件**（G92 探针 B/C + 交付-1 C）+ 超时两层 live |
| A Platform Tools ＋ **本机装模拟器**（SDK + system image + AVD） | 数 GB 下载 + 装软件 | R19：装 Host 代码 | 同上，且不依赖用户在场 |
| C 云端设备农场 | 账号 + 凭据 + 可能付费 + 延迟 | R19：外部服务 | 同上，但引入外部依赖与延迟 |
| D 只做 mock 机制层 | 0 | 无 | 只覆盖探针 C 前半 + 超时机制；**不解锁任何真机数字** |

**四、本轮踩到的一条读数陷阱（R25 的新样本，已就地留证）**

`Get-CimInstance Win32_Processor` 报 `VirtualizationFirmwareEnabled=False` / `SLAT=False` / `VMMonitorModeExtensions=False`
—— **照它作答会得出「本机跑不了任何模拟器」，而那是错的**。该属性在**已有 hypervisor 接管**时按设计返回 False
（本机 `HyperVisorPresent=True` 即反证）。**可靠来源是 `systeminfo` 与 `Get-ComputerInfo`，两者一致。**
与本分支已记的「一条错误串只能证明那次失败发生、不能证明因果」同源；差别在于这次错误读数会让人**买设备**，代价更高。

**Done means**

- [x] 三项逐一查实「mock 顶到哪」，每条带源码或命令出处（关键：`runTask/manageTask/inspectTrace` 全过 `requireEnv`）
- [x] 「需要设备」的前提修正：硬件 / 内存 / 磁盘 / winget 可安装性四项实测入库，并写明卡的是安装不是能力
- [x] 四条解锁路径按成本与授权面列出，推荐路径明确
- [x] 读数陷阱（R25）就地留证，并写明可靠来源；台账两处措辞同步更正

### 调研-2 · 「改一个 PSM 参数就能解决 G92？」—— 联网调研 + 离线实测的否定结论（2026-10-15 结案；CHANGELOGS #110）

> 起因：用户问「能否靠联网调研完善」。这条给出一个**具体问题的具体答案**：
> T5 判定「瓶颈是整页版面分析」，此后所有设计（P1 区域裁剪、P2 投影分割、P3 网格）都在**自己实现版面分析**——
> 但**谁都没查过 tesseract 自己有没有这个开关**。查了，而且实测了。

**R20 第 1 步「查」：一手来源（本机 node_modules 里的包本体 + 其类型定义）**

| 出处 | 事实 |
|---|---|
| `node_modules/tesseract.js/src/index.d.ts` | `Worker.setParameters(params: Partial<WorkerParams>)`；`WorkerParams` 里**明确列出 `tessedit_pageseg_mode: PSM`** |
| 同上，`enum PSM` | `AUTO='3' AUTO_OSD='1' AUTO_ONLY='2' SINGLE_BLOCK='6' SINGLE_LINE='7' SINGLE_WORD='8' **SPARSE_TEXT='11'** SPARSE_TEXT_OSD='12' RAW_LINE='13'` |
| `node_modules/tesseract.js/src/worker-script/index.js` | 内部 `api.SetVariable('tessedit_pageseg_mode', ...)`，且 recognize 前后有 **`api.SaveParameters()` / `api.RestoreParameters()`**（参数被内部保存/恢复） |

⇒ **PSM 11 = SPARSE_TEXT**，上游语义就是「把图当稀疏文本，尽量多找文字，**跳过版面分析**」—— 与 T5 诊断的瓶颈正对。
这是本分支**从未考虑过**的设计空间，所以值得查。

**实测结论（离线、真模型、两张已入库夹具；每个 PSM 一个全新 worker）**

| 设置 | 真夹具（`screen-chrome-tab-overview.png`） | 合成难帧（`screen-synth-hard.png`） |
|---|---|---|
| **不设参数（现状）** | **HIT**（含 `游戏中心`）conf 55 | miss conf 53 |
| 显式 `PSM 3` | **miss** conf 84 | miss conf 0 |
| `PSM 6` / `11` / `12` | HIT conf 55 / 69 / 69 | **全 miss** |

**两条结论**

1. **PSM 开关救不了 G92**：合成难帧上**所有** PSM 都读不出 needle ⇒ 「关掉版面分析让引擎自己找」这条路**不成立**，
   P1/P2/P3 自己切区域的方向**没有被这次调研推翻**。
2. ⚠️ **`setParameters({tessedit_pageseg_mode})` 不是可靠旋钮**：**显式设 `3` 比不设更差**（前者 miss、后者 HIT），
   而 tesseract.js 的枚举里 `AUTO = '3'`。结合 worker 脚本里 recognize 前后的 `SaveParameters` / `RestoreParameters`，
   合理的解释是**内部逻辑会在 recognize 期间覆盖这个变量** ⇒ **任何人将来想调 PSM，必须先证明它真的生效**，
   不许拿「我设了」当「它起作用了」（R27 判据 6）。

**⚠️ 本轮四次修正了自己的测量（R25 的又一次密集复发，全部留证）**

| 轮次 | 读数 | 为什么错 |
|---|---|---|
| 1 | 「PSM 11 在整帧 HIT」 | 复用了同一个 worker，且语言顺序写成 `chi_sim+eng`（插件默认是 `eng+chi_sim`）—— **一次动了两个变量** |
| 2 | 对齐语言顺序后仍与锁矛盾 | 仍是**同一个 worker 连续多次 recognize** |
| 3 | 「不设 HIT / PSM11 HIT / PSM3 miss」 | 怀疑 worker 状态污染与内部 Save/Restore |
| 4 | **每个 PSM 一个全新 worker** | ✅ 干净、可归因、可复跑 |

⇒ 前三轮的数字**全部不可用**。若把第 1 轮那个「好消息」直接写进台账，就会把一条**建立在污染读数上的结论**当成设计依据。

**Done means**

- [x] 联网查到 PSM 这个设计空间并实测（两帧 × 六种设置，每格独立 worker）
- [x] 否定结论入库：**PSM 救不了 G92**；**`setParameters` 不可当可靠旋钮**（显式 3 ≠ 默认）
- [x] 四次测量修正的过程落账（R25 样本），并写明前三轮数字不可用
- [x] 门禁三条命令 exit 0；插件代码未改（探针只在忽略区 `scratch/`）

**非目标**：不改 `recognize.ts` 的封装（setParameters 的取舍留到真机探针 B 有需要时再定）；不做 P2/P3；不因 PSM 结论动任何默认值。

### 能力重审-1 · 三个零授权的确定性修正（OCR 契约收窄 / 区域 OCR 标注未接线 / 超时三处缺陷）（方案，2026-10-15 立项，R22）

> 来源：六面能力重审（子代理只读调研，2026-10-15，见 §七「重审综合」）。本条只取**零授权、离线可判、且改完不引入新退化**的三项。

**R20 第 1 步「查」：本轮实际读到的代码事实**

| 面 | 事实（出处） |
|---|---|
| OCR 契约 | schema 里 `text: "Substring to locate the element."`（`runDeviceAction.ts` target 块）；`SKILL.md:15-16` **主动不推荐** `{text}`（「优先 `#N`；坐标仅在无匹配时用」） |
| 区域 OCR | `regions.ts` / `image.ts` **无生产消费者**（`git grep recognizeRegions -- src` 只命中自身；`README.md:62-63` 自陈） |
| P1 的结构性边界 | P1 候选源是**层级 bounds** ⇒ 层级无框时「P1 cannot add anything」（`regions.ts:78-111,192-196`） |
| 超时 · 声明值 | `runDeviceAction.ts:582` `timeoutMs: 45_000`；`reportTaskStatus.ts:25` `timeoutMs: 5_000`；宿主对**未声明者** `return next()` ⇒ **7 个工具里只有 2 个有宿主 deadline** |
| 超时 · 内层最坏 | `RESOLVE_ATTEMPTS=3`（`:194`）× (dump 30s + cat 10s) + capture 20s + OCR 8s ≈ **204s** |
| 超时 · 同一事件三种分类 | abort 时：hierarchy 读 ⇒ `task: hierarchy unreadable`（`:420`）｜动作 ⇒ `task: action cancelled by the user`（`:691,:800`）｜截图 ⇒ `environment: screencap returned no frame`（`:1064`）⇒ **environment 那条会开 breaker** |
| 超时 · 两缝丢 signal | `resolveScreenSize(key)`（`:342`）与 `captureFrame?(key)`（`:360`）的签名里**没有 signal** ⇒ 效果帧与屏幕尺寸探测**不可取消** |
| 超时 · `wait` | 本地处理，**无 abort 监听**；`duration_ms` 无上限校验（`:575` schema 未写 max）⇒ 可超过 45s 声明值 |

**⚠️ 我修正了重审的一条建议（先记，因为它改变了做法）**

重审建议「方案 C：删掉两处 `timeoutMs` 声明」。**该建议漏算一个数字**：删掉后模型的最坏等待从 **45s 变成 204s**（内层最坏路径），对慢设备是**实质退化**。
⇒ 本条**不删声明**，改为「**保留兜底 + 让内层真正响应 signal + 统一 abort 的分类**」：45s 到点 abort 后模型拿到的必须是 `environment`（不是 `task`），且插件内部必须**真的停下**（今天它还在跑 ladder、可能已经点了屏幕多次）。

**What（范围）**

1. **OCR 契约收窄**（零代码路径）：`target.text` 的 schema 描述与 `SKILL.md` 写明分工 —— `{text}` 的语义是「**不看图也能算出的确定性落点**」；看不清就用 `{coordinate}`（模型自己看帧）。理由：OCR 与 VLM 的**互补区只剩「定位」**（可复算、可在 `target_source` 追责），**验证**已由像素差分承担（`effect/diff.ts:195`）。
2. **区域 OCR 明确标注「未接线 + 到期条件」**：`§四 G92 行` 与插件 `README` 各写一句 —— 当前不接线；**到期条件 = 探针 B 的真机数字 ≥ 整帧基线**。理由：P1 候选源与触发条件互斥（层级无框 ⇒ P1 结构性地帮不上），而那正是 OCR 存在的理由 ⇒ 不接线的依据是**逻辑**，不是「还没来得及」。
3. **超时三处确定性缺陷**：
   - a. **abort 的分类统一为 `environment`**（`:420` / `:691` / `:800` 三处）⇒ 宿主超时不再污染 incident、不再让模型收到「任务失败」；
   - b. **`wait` 上限 ≤ `timeoutMs`**：给 `duration_ms` 加 `maximum`（或执行前钳制），使声明值变诚实；
   - c. **补两处 signal 缝**：`resolveScreenSize` / `captureFrame` 的签名加 `signal`，`index.ts` 侧透传 ⇒ 45s abort 能真正停住整条链路。

**非目标**：不删 `timeoutMs`（理由见上）；不做统一 `Deadline` 值对象（那是重审的方案 B，改动 11 个文件，**另立**）；不改 adb / OCR / provider 三处内层超时本身；不接线区域 OCR；不改 P1/P2/P3 任何逻辑。

**How（关键决策）**

- **先改分类、再补 signal**：顺序不能反。若只补 signal 不改分类，abort 仍会被记成 `task`（`tests/router-errors.spec.ts:156-181` **正锁着**这个行为）⇒ 模型仍收到「任务失败」且 incident 照计。
- **`{text}` 的描述要给出「为什么用我」，不是「不要用我」**：模型看不到 `{coordinate}` 之外的理由，就会在无框画面上反复试 `{text}`。描述里必须点明它是**确定性**通道。
- **区域 OCR 只写「未接线 + 到期条件」，不加阻止接线的锁**：接不接它由探针 B 的数字决定，加锁等于把结论钉死成「永不接线」。

**Verify（验收命令）**

- 三条变异各红一次（R27）：
  ① 把 `:420`/`:691`/`:800` 任意一处的 `environment` 改回 `task` ⇒ 新锁「宿主 abort 记 environment、不计 incident」红；
  ② 把 `duration_ms` 的上限改大到 > `timeoutMs` ⇒ 「`wait` ≤ 声明值」那条红；
  ③ 从 `index.ts` 侧删掉任一 signal 透传 ⇒ 「两处 probe 缝都接了 signal」那条红。
- 回归：`pnpm --config.verify-deps-before-run=false run verify` ⇒ 三段全绿（`router-errors.spec.ts` 需按新语义改，**改判据的理由写进该 spec 注释**）。
- `node scripts/check-docs.mjs`（含 `--selftest`）与 `node scripts/check-env.mjs` ⇒ exit 0。
- 边界自查：`git grep -n "timeoutMs:" -- src` 仍为 2 处（**没删**，与本条决策一致）。

**Done means**

- [x] `{text}` 的 schema 描述与 `SKILL.md` 写明「确定性通道」分工
- [x] 区域 OCR 在 `§四 G92 行` 与插件 `README` 标注「未接线 + 到期条件」，且**未加阻止接线的锁**
- [x] abort 三处统一为 `cancelled`；`duration_ms` 有上限；两处 probe 缝接上 signal；三条变异各红一次
- [x] `verify` 三段全绿、`check-docs` / `check-env` exit 0；R15 的现状描述按本条实测同步

**实施记录（2026-10-15，三处偏离方案 + 两条锁曾经是假的）**

| # | 方案说的 | 实际做的 | 为什么 |
|---|---|---|---|
| 1 | abort 统一为 `environment` | 新增**第四类 `cancelled`**，两侧都不记账 | `allowedFails` 默认 1 ⇒ 一次 `environment` 就开闸 30s。**用户按一次停止键会锁死后续全部动作** —— 这是方案本身会引入的退化，读 `breaker.ts:56-63` 后改 |
| 2 | 给 `duration_ms` 加 `maximum` | 上限只落在**执行器**与描述里 | 官方 value-schema DSL 的标量分支只认 `type`/`enum`/`const` + 注解，`minimum`/`maximum` 会被 `assertAuthorKeys` 抛 `JsonSchemaError`（读 `@deepseek-ai/dsh-tools` 自身编译器确认）。**声明面放不下这个约束**（R20） |
| 3 | 只改三处分类 | 「层级读不回」也从 `task` 改成 `environment` | 独立理由：`dump` 成功也退 139，读不回＝dump 没送达，模型改措辞修不好；旧分类让 breaker 在环境持续坏时保持关闭 |

**两条锁曾经是假的（R27 实证，方法论产出）**

1. 「abort 不计 incident」那条锁，变异 `cancelled→task` 时**仍然绿**。原因：真正送达模型的是 `dispatch` 内 `execute` 层的 catch，
   而外层 `.catch()` 与 `get_ui_hierarchy` 分支都不在这条路径上 ⇒ **锁挂在了一个够不到的分支**。
   改成在 spec 注释里写明「本锁覆盖的是哪条分支」，再对那条分支变异才红。
2. 「两处 probe 缝接了 signal」那条锁，变异 `index.ts` 去掉 `{ signal }` 时**仍然绿**。原因：该 spec 自己 stub 了两个缝，
   从没跑到 `index.ts` 的生产接线；而两处签名都是 `signal?`，**去掉也编译通过**，`calls` 只记 argv ⇒ 旧记录器根本分不出来。
   ⇒ 给 `tests/support/fakeAdb.ts` 加 `signalSeen`（记 signal 对象本身），在 `apply.spec.ts` 里对**生产接线**断言 **signal 身份**（不是「有信号」）才红。
   **教训**：`signal?` 这类可选参数 + 只记 argv 的记录器 = 结构上无法被锁住的缝；判据必须落在**身份**上。

**仍然欠着的（不因本条结清）**

- `TOOL_TIMEOUT` 仍**识别不到**：插件没挂 `tools/result` / `post-execute` 监听器，包装层的结构化错误进不了任何分类器。
- 内层四处自实现超时仍在（adb / OCR / provider / preflight），未统一成一个 `Deadline`（那是重审的方案 B，改 11 个文件，另立）。
- `wait` 中途 abort 后仍会 `recordSuccess`？——**已修**（abort 时返回 `cancelled`，不记账账）；但「包装层在真宿主里是否真的替换结果」仍 🔶，需宿主会话而非设备。

### 能力重审-2 · 元素源占用者诊断 + 两处「注释指向不存在的锁」（方案，2026-10-15 立项，R22）

> 来源：§七「重审综合」的「现在就做」行 1 与行 4。本条只取**零授权、离线能判红、且不改动执行路径**的两件。

**R20 第 1 步「查」：本轮实际读到的代码事实**

| 面 | 事实（出处，均已复跑核验） |
|---|---|
| 占用者诊断缺位 | `git grep -nE "ps -A\|wetest\|com\.github\.uiautomator\|uiautomator2" -- src` ⇒ **零命中**：今天 `readHierarchyXml` 读不回只给 `undefined`，调用方无法区分「dump 自己失败」与「槽位被别人占着」 |
| 一手机制 | **同一时刻只能有一个 UiAutomation 连接**（AOSP `UiAutomationConnection.connect()` 在已连接时抛 `Already connected.`），且 **`uiautomator dump` 自己就是占位者**、`UiAutomationShellWrapper.connect()` 调**无参** `connect()` ⇒ 默认压制 a11y 服务（已标注进 §七「前置-2」互斥行） |
| 本仓已验的输出形状 | §七「前置-2」记录的真机读数用的是 **`ps -A`**（当时「没有任何 uia2 / uiautomator / artemis 进程」）；**`-o PID,ARGS` 的列布局从未在本机量过** ⇒ 见下方「未知态」决策 |
| 诊断面缺口 | `src/device/diagnose.ts` 从不跑层级读、也不报占用者；`src/tools/diagnose.ts` 的返回体没有层级源这一栏 |
| 注释说谎 | `src/env/preflight.ts:49` 写「`contracts.spec` locks this list」——**`tests/` 下没有 `contracts.spec.ts`**（40 个 spec 清单实查）；真正的锁在 `tests/preflight.spec.ts:76-77`（`:76` 比 id 列表来自被导出常量 ⇒ 单独会**自愈**；`:77` 的字面量 `[true, true]` 才锁住「只有两项」） |
| 死 import | `src/tools/diagnose.ts:21` import `requireEnv` 但**从不调用**（`grep -c` 实查＝该文件仅 1 处命中即 import 行）；tsconfig 未开 `noUnusedLocals` ⇒ 编译不报，读者会误以为诊断也过闸门 |

**What（范围）**

1. **占用者诊断器**：新增 `readUiAutomationOccupants(serial, options)`（放 `src/device/hierarchy.ts`，与元素源同源），跑 `adb shell ps -A -o PID,ARGS`，
   在一组词表上匹配**具名**占用者（`com.wetest.uia2.Main`、`com.github.uiautomator`、`io.appium.uiautomator2`、`androidx.test.runner.MonitoringInstrumentation`），返回三态：
   `occupied`（命中 ≥1 个名字）／`free`（进程表读得出来但一个都没命中）／`unknown`（非零退出、空输出、或读不出可识别的进程表）。
   在 `autogamer_diagnose` 的报告里新增一栏 `hierarchy`，`occupied` 与 `unknown` 各给一条 recommendation，`free` 只给事实不给建议。
2. **两处真相修复**：注释改指**实际存在的**锁并写明「哪一条才锁住数量」；删掉未使用的 `requireEnv` import。

**How（关键决策，含与「现在就做」行 1 的一处偏离）**

- **偏离：不挂在失败路径上，挂在诊断面上。** 「现在就做」行 1 原写「`readHierarchyXml` 返回 `undefined` 时报具名原因」。改到 diagnose 的三个理由：
  ① 失败路径上补一次 adb 往返要发生在**阶梯的每一次重取**里（`RESOLVE_ATTEMPTS = 3`），把「读不到」变成三条腿的读；
  ② diagnose 已经并行跑 4 个探针 + 2 条 shell，多一条 `ps` 的边际代价几乎为零；
  ③ 占用者是**设备属性**而不是**本次调用的属性**，放进诊断面模型能主动问，放进报错则只能等坏一次才知道。
  ⇒ 失败路径的具名报错**留作后续**（要做时先解决「一次失败只问一次 `ps`」的计数问题）。
- **必须有 `unknown` 态**：`-o PID,ARGS` 的列布局没在本机量过（表上只有 `ps -A` 的读数）。**读不出来就答「读不出」**，
  绝不把「解析不到 marker」说成「没有占用者」——后者是一张**假的健康证明**，比不报更坏（R21 反向形态：别把「有读数」写成「验过」）。🔶 真机第一次跑要复验列名，验完才允许把 `unknown` 收窄。
- **只读、零副作用**：不 `kill`、不 `force-stop`、不卸载任何东西。上游对第三方 blocker 的做法是 `pm uninstall --user 0` 直接卸掉用户的 Maestro（归档只读 blob 查明），**本仓绝不照搬**（R19：这类动作永远 user-only）。
- **不动 `timeoutMs` 声明面**：新读的超时走 `AdbOptions`（与同文件其它探针一致，10s），不给 `autogamer_diagnose` 新增宿主 deadline（R15：声明了就等于断言能停稳）。
- **不新增配置项**（R12/R13）：词表是代码内常量，因为它不是策略而是**事实清单**；策略（要不要停掉别人）根本不由插件决定。

**Verify（验收命令）**

- 三条变异各红一次、且**恰好一条红**（R27）：
  ① 从词表删掉 `com.wetest.uia2.Main` ⇒ 「命中 uia2 服务器时报具名占用者」红；
  ② 把 `unknown` 分支改成返回 `free`（即读不出时当作没人占） ⇒ 「读不出可识别进程表时答 unknown、不许答 free」红；
  ③ 把 recommendation 的生成条件从 `occupied` 改成 `free` ⇒ 「free 时不给建议」红。
- 死 import 的反证：删掉 `requireEnv` import 后 `verify` 仍全绿 ⇒ 证明它本就没被执行路径用到；再补一条**结构锁**断言 `src/tools/diagnose.ts` 不出现 `requireEnv`（防止有人日后再加回来却以为闸门在跑）。
- 注释锁：`git grep -n "contracts.spec" -- plugins/dsh-autogamer/src` ⇒ **零命中**；且 `Test-Path plugins/dsh-autogamer/tests/preflight.spec.ts` ⇒ True（照 #107 的做法：**判据要能红**，单靠 `git grep` 命中数不够）。
- 回归：`pnpm --config.verify-deps-before-run=false run verify` 三段全绿（读数在 Done 段如实记录）；`node scripts/check-docs.mjs`（含 `--selftest`）与 `node scripts/check-env.mjs` ⇒ exit 0。
- 声明面自检（R6）：本片**不改 patch**，故不跑 `--dump-config`；若实施中被迫改了 `*.patch.yml`，当轮补跑。

**非目标**：不接失败路径的具名报错；不加 `dump --windows`（它的**收益只有真机能判**，离线只能锁 argv，按 R27 不许以「重写」立项，登记在 §七「重审综合」）；
不接线区域 OCR；不做 `TOOL_TIMEOUT` 监听器（须先按 R20 查官方形态）；不动 breaker 与分类语义；不 `force-stop` / 不卸载任何包。

**Done means**

- [x] `readUiAutomationOccupants` 三态落地且词表、`unknown` 判定各带离线单测；三条变异各红一次
- [x] `autogamer_diagnose` 报告新增 `hierarchy` 栏，`occupied` / `unknown` 各给 recommendation、`free` 不给
- [x] `preflight.ts:49` 注释改指实际存在的锁；`diagnose.ts` 的未用 import 删除并补结构锁
- [x] `verify` 全绿、`check-docs` / `check-env` exit 0；§七「重审综合」的「现在就做」行 1、4 改判为已做，行 2 保持待立项

**实施记录（2026-10-15，一处接线偏离方案 + 变异计数与方案不符 + 结构锁当场抓到我自己的注释）**

| # | 方案说的 | 实际做的 | 为什么 |
|---|---|---|---|
| 1 | 接线位置未细说 | 新增**可选 dep `hierarchyStatus`，在 `index.ts` 装配**（照 `ocrStatus` / `provider` 的现成形状），而不是在 `device/diagnose.ts` 的 `Promise.all` 里多跑一条 | 后者会让 `diagnose.spec.ts` 里**每一条既有 recommendation 断言**都因多出一条而不相识；照现成形状接，**既有 39 条锁一条没动**，且「报告从未问过就不许答」这条规则自动适用 |
| 2 | 「三条变异各红一次、且**恰好一条红**」 | ① 删词表 marker ⇒ **1 红**（`hierarchyXml`）；② `unknown`→`free` 塌缩 ⇒ **3 红**（同一条判据的三个样本：`it.each` 的两格 + 直接解析那条）；③ recommendation 条件从 `occupied` 翻成 `free` ⇒ **3 红**（具名、free 不给建议、纯函数优先级） | 方案写「恰好一条红」时**没料到判据本身是参数化的**。②③ 各自仍**只红自己那面的文件**（② 时 `diagnose.spec` 零红、③ 时 `hierarchyXml` 零红）⇒ 「不连坐」这条成立，「恰好一条」这条按实测改判 |
| 3 | 结构锁写 `expect(source).not.toContain("requireEnv")` | **保留原判据**，改的是**注释措辞** | 第一次跑就红——红在**我新写的头注释里点了 `requireEnv` 这个名字**。这条锁的强度因此得到实证：它连「注释里提一句」都不放过。改成 prose 说明「不许把闸门 import 加回来」，判据不动 |

**读数与核验**

- 词表与三态：`tests/hierarchyXml.spec.ts` 新增 10 条（含 `it.each` 五格失败形态）；工具面：`tests/diagnose.spec.ts` 新增 8 条。
- argv 锁：`-s emulator-5554 shell ps -A -o PID,ARGS` **只此一条调用**（`A.calls` 整表比对，不是 `toContain`）⇒ 加第二条读就红。
- 失败形态五格：非零退出 / **code 0 但设备侧报错文本**（`deviceReportedFailure` 的 `Unknown command:`）/ 只有表头没有行 / 空输出 / `timedOut` ⇒ 全部 `unknown`。
- 🔶 **`unknown` 态不是保守装饰**：`ps -A -o PID,ARGS` 的**列布局在本仓 ledger 里没有实测**（§七「前置-2」只记过裸 `ps -A` 的读数）。真机第一次跑必须复验列名，验完才允许收窄这一态（R21 反向形态：别把「有读数」写成「验过」）。
- 两处真相：`preflight.ts` 注释改指 `tests/preflight.spec.ts:76-77` 并写明 **`:76` 比的是导出的常量、会自愈，真正锁住「只有两项」的是 `:77` 的字面量 `[true, true]`**；`src/tools/diagnose.ts` 的 `requireEnv` import 删除，头注释改为事实陈述。
- `verify` **44 文件 / 497 通过**（上一绿态 44/479，+18 条）；`check-docs`（含 `--selftest`）与 `check-env` exit 0。
- 声明面（R6）：本片**未改** `cordis.patch.yml` ⇒ 无需 `--dump-config`；也**未**给 `autogamer_diagnose` 新增 `timeoutMs`（R15：声明即断言能停稳，新读只带 `AdbOptions.timeoutMs = 10s`）。

### 重审综合 · 六面能力重审的结论、否证与处置（2026-10-15，只读调研，零设备）

> **缘起**：用户逐项质证「对照表里有些能力未实现或被改造」后要求「分派子代理完成所有面的重审」（2026-10-15）。六个只读子代理各查一面，
> 报告全文当时**只存在于会话 transcript**（`ses_ec26d7e82ffe32mbJo2gnEkPRV`），台账里一个字都没有 ⇒ 本小节是它的落账处（R28）。
> **已结清的三项**（abort 分类 / `wait` 上限 / 两处 signal 缝）走 CHANGELOGS **#111**，本处只记**其余结论、否证与处置**。
> 证据层级口径：**一手**＝官方 / AOSP / npm 原文（逐条带 `gh api` 或 webfetch 出处）；**结构**＝读源码或归档只读 blob；**单测**＝离线 vitest；**live**＝CHANGELOGS 已记实测；**未验**＝无一手证据。
> ⚠️ 六份报告**全部零 live 证据**（本轮无设备）；下表凡「判据需真机 / 需宿主」的都标 🔶，不许把结构证据写成实测。

**逐面结论与处置**

| 面 | 一句话结论 | 处置 | 落点 |
|---|---|---|---|
| 超时与执行 | 现状不是「三层兜底」而是**一个共享 abort 信号上的两层记账**：包装层 45s **只 abort 不返回**（`await next()`），我们把 abort 映射成 `task` 级失败 ⇒ 内部台账与模型可见答案互斥 | 三条已修（#111）；`Deadline` 值对象统管四处内层（重审方案 B，11 文件）与 `TOOL_TIMEOUT` 识别**未做** | 本节「待立项」行 5、6 |
| OCR 识图 | 保留 `recognize.ts` 的 needle→像素**确定性解析器**，重新定位为「确定性兜底」；**放弃**「区域 OCR 救召回」；**新增一条非 OCR 的召回轴** | 建议 1、2 已做（#111）；建议 3 待立项（本节「现在就做」行 3） | CHANGELOGS #111；下行 3 |
| 层级元素源 | **保留 dump、不建 uia2 客户端**——uia2 是第二**传输**不是第二**数据源**（两条路都跑 `AccessibilityNodeInfoDumper`）⇒ 换过去**不解决 G92 的渲染区缺席** | 「现在就做」两条：占用者诊断器、`dump --windows` | 下行 1、2 |
| 闸门与诊断 | 问题不是「2 项太少」而是**闸门放错了地方**：三处真会给出误导性结果的故障都不在 preflight，而 preflight 罩住了两个不碰设备的工具（`manage_task` / `inspect_trace`）、**没罩住唯一真正驱动设备的 `run_device_action`** | 闸门语义按裁决动（需先改规格 ⇒ 待裁决）；两条注释/死代码真相修复「现在就做」 | 下行 4；R19 段 |
| 智能栈等价物 | **D8 的取代论证只覆盖执行侧**：`explorer`/`runners` 确有取代者，但 `screen_index` 无对应物、`checker` **只有提示词** | 判「重做」而非放弃，但**均需先补 R20 取证**（官方子代理扩展点本轮未查）⇒ 立为**待取证**，不占编号 | 本节「待取证」段 |
| 可观测与调试 | 轨迹＝**重做而非放弃**（会话内已成立，跨会话查询/聚合/导出是真缺口，其中导出宿主已覆盖大半）；overlay＝**推迟依据部分失效**；录屏＝**维持放弃** | 就地标注四条过期依据（本轮已做）；能力本体待需求 / 待设备 | 本节「已就地标注」段 |

**三条否证（实测或一手证据，别重试）**

1. **uia2 路线不解决 G92**（一手 + 结构）：`dump` 与 uia2 的 `dumpWindowHierarchy` 分别是 AOSP 与 openatx 的**同名 dumper**，属性词表同源；
   `xpath` 也不是设备侧能力（openatx 官方：先 `dump_hierarchy` 取 XML，**主机侧 lxml** 解析，动作仍走服务器）；
   而本仓 OCR/区域候选源就是 `node.bounds`（`src/ocr/regions.ts:78-111` 已自陈「层级无框则无候选」）⇒ **换传输不产生新框**。
   uia2 的独有增量只有三项（常驻连接、服务端等待器、`max_depth`），且**同一时刻只能有一个 UiAutomation 连接**（AOSP `UiAutomationConnection.connect()` 抛 `Already connected.`）⇒ 走这条路要付 interlock + `u2.jar` 二进制资产（供应链面）+ 自写 TS 客户端（npm 上只有 2016 年废弃包）。
2. **「自己实现版面分析」的三条路都已实测否掉**：整帧放大 1×/1.5×/2×/3× ⇒ 0/1/3/0 命中；**所有 PSM 在合成难帧上全 miss**（CHANGELOGS #110）；合成帧把标签放大 5× 整帧仍读不出（#108）。
   ⇒ P1 不接线的依据是**结构性**的（候选源与触发条件互斥），不是「还没来得及」。
3. **「D8 已取代整个智能栈」不成立**：全仓 `subagent|explorer|checker` grep **0 命中**，`screen_index` 的两半都在仓内但**接口不相交**（`src/observations.ts:12-22` 是不可查询的扁平列表；OCR 页从不进任何索引）。

**「现在就做」四条（零授权、离线可判、各带能红的判据）——待按 R22 立项，本处不实现**

| # | 做什么 | 为什么是它 | 判据（离线） |
|---|---|---|---|
| 1 | **层级占用者诊断器**（约 30 行，`git grep "ps -A\|wetest\|com.github.uiautomator" -- src` 现**零命中**） | dump 静默失败后今天**直接降级到 OCR 且无人知道原因**，是元素源面最大的真实缺口 | `readHierarchyXml` 返回 `undefined` 且喂固定 `ps` 文本命中 marker ⇒ 报**具名**占用者；空 ⇒ 报「dump 本身失败」。变异：删 marker 匹配必红。**✅ 2026-10-15 已做（能力重审-2 / CHANGELOGS #112）——接线点改到诊断面**（`{text}` 走的是执行路径，那里补一条 `ps` 会落在阶梯的 3 次重取里；占用者是设备属性不是本次调用的属性），三态与理由见该条目 |
| 2 | **`uiautomator dump --windows`**（`--compressed` 默认关） | `--windows` 取 `FLAG_RETRIEVE_INTERACTIVE_WINDOWS`，能多捞弹窗/系统窗口节点；`--compressed` **反向**（上游 py 显式传 `compressed=True`，而 verbose 的 `setCompressedLayoutHierarchy(false)` 节点**最多**⇒ 照搬上游对 G92 更差） | 离线：mock adb 断言 argv 含 `--windows`。🔶 增量几个节点需真机 |
| 3 | **`{text}` 未命中时把「叶级候选框编号 + 该帧 attachment 引用」交回模型**（通路已存在：`src/index.ts:292-310` 存附件、`runDeviceAction.ts:693-694` 已产 `[text, image]` 块） | 一条**非 OCR** 的召回轴：层级答不出时让帧进入模型视野、由模型回 `{coordinate}` 或 `{index}`，而不是继续在 tesseract 上重实现版面分析 | 新增 spec：`{text}` 未命中时结果**必含** `frame` 引用且**不含任何猜的坐标**；变异：删引用必红。🔶 收益数字属探针 B |
| 4 | **两处「注释/代码说谎」的真相修复**：`src/env/preflight.ts:49` 写「`contracts.spec` locks this list」——**该文件不存在**，真锁是 `tests/preflight.spec.ts:76-77`（`:76` 比 id 列表、`:77` 用字面量 `[true, true]` 才真正锁住「只有两项」）；`src/tools/diagnose.ts:21` import `requireEnv` **从不调用**（tsconfig 未开 `noUnusedLocals` ⇒ 编译不报，读者会误以为诊断也过闸门） | 与 #107 的 `client.js` 注释同类缺陷：**指向不存在的锁**＝把读者引向一个假的验收 | 改完 `git grep -n "contracts.spec" -- plugins/dsh-autogamer/src` ⇒ 零命中；`requireEnv` 的 import 删除后 `verify` 不变绿即证它本就没被用。**✅ 2026-10-15 已做（能力重审-2 / CHANGELOGS #112），并加了一条源码结构锁**（`diagnose.ts` 里出现 `requireEnv` 即红——第一次跑就红在我自己新写的注释上，实证它有牙） |

**待立项两条（本条不实现，因为它们要先补取证或先改规格）**

5. **`TOOL_TIMEOUT` 识别**：插件只挂 `session/event` 与 `tools.guard`，**没有** `tools/result` / `post-execute` / `tools/execute` 监听器 ⇒ 包装层的结构化错误进不了任何分类器。
   正确落点**不是** `classify.ts`（它只在我们的工具体内被调用，拿不到包装层的错误）。⚠️ 动手前须按 **R20** 查官方监听器形态与 `error.info.code` 的确切读法。
6. **统一 `Deadline` 值对象**（重审方案 B）：四处内层（adb / OCR / provider / preflight）各持一份预算与取消观测，三处孤儿计时器（OCR 超时不取消 worker、MCP 计时器从不清除 ⇒ 成功后 30s 仍 `dispose()`、`rm` 子进程 fire-and-forget）。改 11 个文件，**语义不变**、只统一形状。

**需人裁决（R19 授权面，或 R22 要先改规格）**

- **provider 自我循环四选项**：A 全删（与规格 §一.3 冲突 ⇒ 先改规格；收益是卸掉 `@modelcontextprotocol/sdk` 这个**唯一消费者是 `mcpBackend.ts`** 的运行时依赖）、B 降级为纯文档（**更糟**：留下说谎的规格）、C 重新定位为「原生 adb 读 vs 外部读」的**对照源**（今天 `index.ts:543-563` 把返回值整个丢掉、只拿「有没有回话」当 `reachable` ⇒ **内容盲**）、**C′ 折中＝依赖降为 optional peer**（不动规格、不动工具面，未配置者安装面少一个依赖）。
- **装 adb + 一台设备**：解锁 G92 探针 B/C、交付-1 C 项、以及本处所有标 🔶 的 live 判据（§七「设备前置调研」已查实成本最低路径＝Platform Tools + 用户手机无线调试）。
- **加 devDependency 做离线 conformance**：验「声明 `timeoutMs` → 包装层替换结果」这条链（`report_task_status` 不过 preflight 且声明 5s ⇒ 唯一可离线碰的工具），属授权面。

**闸门面的其余处置（不新建编号，逐条给结论）**

- 锁屏（候选③）：**不是 preflight 项**，而是修既有闸门的三个缺陷——`roster.ts:113-116` 不看 `timedOut/aborted` ⇒ 一次慢 `dumpsys window` 就 `readScreenState("")=null` ⇒ 每次点名调用被硬拒「lock state is unknown」；auto 路径不查门；auto + 唯一锁屏设备时 `eligibleDevice` 恒 undefined 且 `acquire` 无超时 ⇒ **动作工具挂住**（结构证据，🔶 未实测观感）。
- 层级源（候选④）：**只报不门**（门它会连带拒掉完全正常的 `take_screenshot` / `{coordinate}`）；真修法在失败点改分类 ⇒ **已随 #111 做掉**（`task` → `environment`）。
- OCR 语言包（候选⑤）：**范围化**到 `{text}` 的拒绝文案，`diagnose` 已报（`missingLanguageData`）缺的是把事实接到文案上；当全局 gate 会白丢截图/点击（OCR 本就 fail-open）。
- **一条 preflight 的潜伏风险**（读 breaker 得出）：一旦把 preflight 接进 `run_device_action`，`environment:` 前缀 + `allowedFails` 默认 1 ⇒ **一次用户可修的条件就开闸冷却 30s** ⇒ 原则落地：**preflight 抛错要么不带该前缀，要么不给它记账权**。
- `requireEnv` 与 `preflight.run()` **都不接 `AbortSignal`**（四调用点也不传）⇒ 用户取消后仍要等 `adb version` + `adb devices` 跑完才抛。

**待取证（不占编号，也不许现在写实现）**

- **DSH 是否有官方只读子代理扩展点**：本轮**未做 R20 第 1 步**（`src/dsh-types.ts` 镜像里没有子代理创建面**不足以**判定官方没有）。
  「感知子代理」（复刻 `ask_explorer` 契约：query + 截图 → **多候选坐标**）的可行性**全悬在此**；它与宿主 VLM 原生看同一张图有重复，且会把 S11 删掉的第二个推理环与第二份 token 账单请回来。
- **`checker` 的提示词替代是「已裁决」还是「当时没想清楚」**：persona 第 6 条（`cordis.patch.yml:45-51`）+ `SELF_CHECK_PROMPT` 是**仅有**的东西；上游 checker 的权威来自**工具表而非提示词**（枚举只读 `dumpsys` 探针、正则校验参数、固定 argv）且**放行判定在模型外算**，
  而我们 `report_task_status` 的 `status` / `tests_failed` 是**模型自己填的数**（`reportTaskStatus.ts:51-70`）⇒ 台账**无裁决条目**，这是一条**未结的差距**，不是一笔已放弃的债。
- **`ctx.llm` 由第三方插件直接发起 VLM 调用是否合规**：seam 存在（`LlmRuntime.stream`，消息可带 `ImageBlock`），但官方列出的直接消费方只有 `agent-loop` 与 `compaction-basic`；宿主是否允许 / 如何计费与记日志**未查证**。

**已就地标注（本轮做的四条 R28 更正）**

- §四 **G88 行**：推迟判定的**成本依据已过期**——原写「为调试图引入 sharp/libvips 不划算」，而仓内已有**零依赖** PNG 解码（`src/effect/png.ts:103`）与编码（`src/ocr/image.ts:119`）⇒ 画框＝改 RGB 缓冲，无新依赖；且**宿主自己渲染工具结果里的 image 块**（`runDeviceAction.ts:693-694`）⇒ 标注图不需要卡片。真闸门仍是**元素源可信度**（与 G92 挂钩）。
- §七「**前置-6**」的判定段：同上两条失效依据，并改写**解锁条件的形态**——从「等 UI slot 出现」改成「等元素源可信」，届时走「工具结果的 image 块」路线（不需要 client 卡片，也就不必绕 `tests/clientHalf.spec.ts:64-75` 的禁列）。
- §七「**前置-2**」的互斥行：补两条一手事实（`uiautomator dump` **自己就是** UiAutomation 占位者，且 `UiAutomationShellWrapper.connect()` 调**无参** `connect()` ⇒ 默认压制 a11y 服务、**无 flag 可免**），并把「天生互斥」限定到正确的轴上（helper ⟂ 任何 UiAutomation 使用者；dump 与 uia2 只是**冲突窗口时长**不同，属可调和）。
- CHANGELOGS **#85**：该条把「调试录屏」与上游 `artemis/agents/video_analyzer/**`（**感知能力**，已按 D8 砍）混为一谈，须点名以免误导下一个人。
- §七「**重审综合**」的指针：`能力重审-1` 条目原先引「§七「重审综合」」而该节不存在（**悬空指针**），本节即其补落点。

**录屏维持放弃的一手依据**：宿主无视频承载面——上游全仓 `getDisplayMedia` 0 命中、`.mp4` 0 命中，subsystems 无录制页，附件准入只接受 `png/jpeg/webp/gif` ⇒ **MP4 连附件通道都不存在**；等价替代是帧序列（每步截图已落附件存储 + `session-log-export` 打成含 `media/` 的 ZIP）。

**D20 判读**：轨迹、overlay、录屏三面**都不冲突**——`task/fold.ts` 已自述设计来源是 session log 与官方子系统文档；画框/配色无上游文本可搬（与 T3 差分同性质）；`adb shell screenrecord` 是 Android 平台能力而非 artemis 资产。**唯一红线**：`artemis/agents/video_analyzer/*.md` 是 prompt 正文，照抄即违规。

**判据方法论产出（与 #111 同族，供将来复用）**：「零消费者」判据必须**两侧都查**（本仓 grep **且** 宿主声明面 / 官方 subsystem 文档）——只查本仓会出**假阴性**（G88 已发生一次）；
须区分**载体缺失**与**消费者缺失**（载体可被宿主新增能力一夜填平）；**成本论证要带时效戳**，过期理由会继续推迟本该重估的事。

### rules-1 · rules 注入链拆除（D20 红线；前置-4 §三 定案后提前执行；方案，2026-10-14 立项，R22）

**背景**：前置-4 判定 `rulesInjector` 的 `artemisRepoPath → <repo>/mcp_server/rules.md` 这条供应链是 **D20 红线**（上游目录约定 + 上游 prompt 正文进模型面），归属 G85+G86，要求 T4 二选一定案。本轮先按用户要求做**形式调研**（「先调研这个适合在 DSH 中以何种形式使用」），结论把二选一改成了第三条路：**拆除**。

**R20 第 1 步「查」：查了哪份、原文怎么说**

| # | 出处（R1 允许面） | 原文（摘/转述） | 对本方案的作用 |
|---|---|---|---|
| 1 | 随包文档 `@deepseek-ai/dsh-system-prompt/README.zh.md` §配置提示词（**已安装 npm 包产物**） | 配置拥有「固定开场白、runtime 上下文、**部署 persona 前缀与后缀**与工具顺序」；`personaPrefix`（order 0）／`personaSuffix`（10200） | 部署方文本的官方位置是 persona，不是外部文件 |
| 2 | 同上 §贡献提示词段 | `ctx.systemPrompt.section({name, order, text})`；「仓库自带贡献方通过 `getSectionOrder(name)` 解析集中分配的位置；**外部贡献可以使用任意有限的顺序值**」 | `section()` 形态合法，但它的定位是「**插件拥有的事实**」，不是转发外部仓库的文件 |
| 3 | 同上 §已知限制（**决定性**） | 「**部署方编写的提示词文本只来自配置／组合**……其他段来自拥有相应事实的插件。**不存在终端用户提示词编辑 API**」 | ① 指向用户任意文件的「规则源」不是平台形态；② 部署文本走 composition；③ 没有终端用户直接编辑提示词的官方通道 |
| 4 | 同上 §模型体验 / Token 与 KV Cache 影响 | 「Persona 前缀、后缀与插件文本**在每次请求中重复**，成本随渲染内容增长」；渲染不变则前缀稳定 | 常驻文本有每请求成本 ⇒ 过程性知识更适合**按需**形态；已有 skill 承载同族纪律是正确分工 |
| 5 | 本仓 `plugins/dsh-autogamer/cordis.patch.yml`（persona 行） | persona 行（`@deepseek-ai/dsh-persona`）**已承载我们自撰的 6 条操作纪律**；行上注释记录 G45：「preset 不能自己挂 prompt 注册表，**这个 scope-only 行是 preset 改变模型所知的官方方式**」 | 规则文本早已在正当位置；外部文件那条是**重复的第三条链** |
| 6 | 本仓 `plugins/dsh-autogamer/skills/autogamer-flash/SKILL.md` | 同族纪律的**按需**版本（one action per call / handle validity / no verbatim repeat / checker-style audit） | 三链内容高度重叠：persona（常驻）＋skill（按需）＋外部文件（红线） |
| 7 | 本仓现状触点：`src/prompt/rulesInjector.ts`、`src/index.ts`（`injectRules` 声明＋调用点）、`src/tools/diagnose.ts`、`tests/rulesInjector.spec.ts`、`tests/fixtures/fake-repo/mcp_server/rules.md`、`tests/conformance/contracts.spec.ts`、`tests/apply.spec.ts` | 现行链：`injectRules`（默认 true）＋`artemisRepoPath` → 探 `<repo>/mcp_server/rules.md` → 读入 → `section()`；六种 outcome 全 fail-open；诊断文案让人「checkout 一个带 `mcp_server/rules.md` 的仓库」 | 拆除范围（8 处触点）一次列清 |

**结论（形式定案）**：规则文本的正当载体是 ① composition/persona（常驻、**agent 作用域**）与 ② skill（按需、零常驻 token）；对外部文件的依赖是唯一非官方且踩 D20 的一条，且与 ① ② 重复。
⇒ **终局 = 拆除 rulesInjector 链**，不做「改指向自己」的替代品——那会引入第三份重复文本，并把 agent 作用域的纪律放大成 profile **全局**的 `section()`。

**What（范围）** —— 五处删除，不新增任何东西：
1. 删 `src/prompt/rulesInjector.ts`（`rulesFilePath` / `RULES_SECTION_*` / 六 outcome 一并消失）。
2. 删 `src/index.ts` 的 `injectRules` 配置项与 `setupRulesInjection(...)` 调用点（`rulesOutcome` 一并消失）。
3. 删 `src/tools/diagnose.ts` 的 rules 项与其「checkout 一个带 `mcp_server/rules.md` 的仓库」文案。
4. 删 `tests/rulesInjector.spec.ts` 与 `tests/fixtures/fake-repo/mcp_server/rules.md`（夹具目录若无他用则整体删）。
5. 清 `tests/apply.spec.ts`、`tests/conformance/contracts.spec.ts` 的相关断言；README Layout 删对应行（`readmeLayout.spec` 会咬）；locale 若有 rules 文案一并清。

**非目标**：不动 persona 文本、不动 skill、不动 `artemisRepoPath` 的其余三种语义（cwd / pyproject 探测 / uv project，属 T4）、不动 preflight 七项。

**How（做法与关键决策）**
- 先删模块与调用点，跑一次 `verify` 看哪些锁咬（预期：`rulesInjector.spec`、contracts 字段表、`readmeLayout`、`apply.spec` 的规则断言），逐条按「删除即正确」改，**不加替代实现**。
- 配置删除要保持**缺席可观察**：contracts 字段表从「含 `injectRules`」改为「不含」——变异校验 = 把字段加回，该锁必须变红。
- 台账同步：规格 §二「rules 注入」行改为**已砍**（载体= persona/skill），§六 与 §四 前置-4 行同步；本项把 G85/G86 中「rules 供应链」一条标记为**已处理**（≠ G85/G86 整体结清）。
- 放弃记录：规格 §一.4 要求「判定不迁移的能力」留结案记录，落点是本分支 `docs/CHANGELOGS.md`（尚未新建）。**本项结案时一并新建 CHANGELOGS**，记入本项并补录既有的「录屏/视频分析已砍」。

**Verify（验收命令）**
- `git grep -n "rulesInjector\|injectRules\|rulesFilePath\|mcp_server/rules" -- plugins` → **零命中**（`docs/` 允许保留历史叙述）。
- `grep -c "injectRules" plugins/dsh-autogamer/tests/conformance/contracts.spec.ts` → 0，且该 spec 的字段表断言仍绿。
- **变异校验（R27）**：把 `injectRules` 塞回 Config schema ⇒ contracts 的字段断言变红；移除后复绿。
- `pnpm --config.verify-deps-before-run=false run verify` 三段全绿；`node scripts/check-docs.mjs` exit 0；`node scripts/check-env.mjs` exit 0。
- 预期**不改** `cordis.patch.yml`；若实现中确需改，必跑 **R6**（`--dump-config` rc 0 且 grep 不到 `unmatched`）。

**Done means**
- [x] 五处删除完成；插件树内 `rulesInjector|mcp_server/rules` 零命中（含 `dist/`；陈旧构建产物已清）
- [x] 配置面不再有 `injectRules`；contracts 字段锁更新且变异校验通过（塞回字段 ⇒ 恰好该条红，撤回复绿）
- [x] `verify` 三段 + `check-docs` + `check-env` 全绿（34 files / 320 passed / 1 skipped）
- [x] 规格 §二/§四/§六 与 TODO §零、前置-4、G85/G86 归属同步（只写指针）
- [x] `docs/CHANGELOGS.md` 新建并记入本项（含录屏/视频分析既有放弃记录的补录）

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
  **⚠️ 事后自纠（2026-10-15）**：当时写「7 例全绿」并不成立 —— M1-C1 的锚点后来被措辞漂移顶掉、在 HEAD 上报 BLIND（见 §零「顺带查出门禁自己盲了一条」）；锚点已改结构定位，现复跑 7 例全落地。
- [x] **基建-3 · 依赖构建脚本策略定案**（2026-10-15 完成，提交 `9dea904`）：`pnpm-workspace.yaml` 的 `allowBuilds` 增 `tesseract.js: false`（保留 `esbuild: true`）；pnpm 11 的 `ERR_PNPM_IGNORED_BUILDS` 与「安装改写被跟踪文件」两件事一并消解，安装 exit 0；A/B 实测占位形态会红。~~🔶 记债：**pnpm 版本未钉**，本条策略在更新版本上的兼容性未验。~~ **该债已由 基建-4 结清**（CHANGELOGS #99）。范围与取证见 §七「基建-3」、结案记录 CHANGELOGS **#98**。
- [x] **基建-4 · 包管理器版本钉死**（2026-10-15 完成，提交 `6e30db2`）：`package.json` 的 `"packageManager": "pnpm@11.21.0"` ＋ `pnpm-workspace.yaml` 的 `pmOnFail: error`；版本不符时**每条 pnpm 命令 exit 1**（`install` 与 `pnpm -v` 均实测），且失败发生在下载/改动之前；匹配态安装 exit 0 且 lockfile 零变化。**结清基建-3 记的「未钉版本」那笔债**。边界（从仓库根跑不受约束、升版流程、误配处置）写在 `AGENTS.md`。范围与取证见 §七「基建-4」、结案记录 CHANGELOGS **#99**。
- [x] **基建-5 · peer 设置搬位，`.npmrc` 删除**（2026-10-15 完成，提交 `d524739`）：`autoInstallPeers: false` 进 `pnpm-workspace.yaml`，哑掉的 `.npmrc` 整份删除；**裸 `pnpm install --frozen-lockfile` 从 exit 1（`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`）复绿**；lockfile 全程零变化。**结清 #99 记的那笔发现，并推翻其中「今天无害」的判断**。范围与取证见 §七「基建-5」、结案记录 CHANGELOGS **#100**。
- [x] **rules-1 · rules 注入链拆除**（2026-10-14 完成，提交 `01de3b2`）：`rulesInjector` 链已删（模块 / 配置 `injectRules` / 诊断项 / spec / 夹具 / 契约断言 / README Layout / `systemPrompt` 缝），规则文本由 persona（常驻）+ skill（按需）承载；不迁移记录 **CHANGELOGS #84**。范围与取证见 §七「rules-1」。
- [x] 本分支的 `CHANGELOGS`（2026-10-14 首次结案时新建：`docs/CHANGELOGS.md`，编号自 **#84** 续起并写明理由；规则：`### #N` 三段、编号永不复用）

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

- [x] 三条工具零外部进程调用（契约锁 + 变异校验通过）
- [x] 任务状态与步迹由**会话日志派生**，无自造事件类型、无自建真相源
- [x] 折叠纯函数与三条工具的 spec 全绿；`tsc` + `vitest` 全绿
- [x] zod 依赖落定并记入插件 `package.json`
- [x] 🔶→**已核验（2026-10-15，宿主内真会话）**：R9 官方面板显示 `dsh-autogamer` 与 `preset-autogamer` **2/2 运行中**、`Config.listConfigs` 对本插件返回 `status:"schema"`（不是 `absent`）、模型侧可见工具清单含**全部 5 个 `autogamer_*` + `run_device_action` + `report_task_status`**；R7 新会话跑了 5 轮、R24 日志 `tool/call=7 / tool/result=7 / turn/end` 全 completed。读数与复跑方法见 CHANGELOGS **#97**。

### T1 · 引擎去消费者（**G82**）· 进度

- [x] 落自足条目（What / How / Verify / Done）并按 R22 先提交方案（`ab3c3c3`，含 R20 九条一手出处原文）
- [x] **切片 1 · 日志折叠**（2026-10-14）：`plugins/dsh-autogamer/src/task/fold.ts` + `tests/taskFold.spec.ts`（13 锁）
- [x] **切片 2 · 三条工具接线**（2026-10-14）：`run_task` 本地铸 `task_id` 并即时返回；`manage_task` 读折叠状态（status / stop / steer，steer 走 `agent.inject` 而非 `followup`，R17）；`inspect_trace` 读步迹（summary = 取边 + 失败步）。三者的 `presentationMeta` 补上折叠需要的卡片（`run_task` 的 `taskId`、`manage_task` 的 `state`）。**`ArtemisBackend` 接口与 `mcpBackend` 实现已删除 `startTask` / `manageTask` / `inspectTrace` / `mapStep`** —— 引擎在**类型面与实现面都不再可达**，G82 的「无消费者」由结构保证，而不只是调用约定。
- [x] 切片 3 · 宿主绑定：`ctx.inject(['sessionProjections'], …)` 注册单元 + `onChanged` 维护 `sessionId → 值` 缓存（`src/task/projection.ts` + `src/task/cache.ts`，9 条锁）。
      **2026-10-15 宿主内核验到的程度（说清是推断还是直读）**：面板 `2/2 运行中` + 七个工具全部对模型可见 ⇒ 注入**已解析**——若 `sessionProjections` 解析不到，本插件那行会停在「waiting for services」，正是本仓记录过的 **G30 形状**（工具根本不会注册），所以这不是乐观推断而是排他结论。
      **仍未直读到的是签名本身**：`cordis_inspect_query` 的官方 provider 只有 `Service / Event / Config / Tool`（宿主会话实测），**没有 projection / fiber 查询面**，故自定义 key 的形状无法从检查器读出。⇒ 该项**结案为「行为已证、签名不可直读」**，不再挂 🔶。
- [x] 跨回合任务状态载体定案 —— session 投影 + `onChanged` 派生缓存，真相源仍是日志，无自建容器（绑定同上已核验）
- [x] 三条工具不再调用任何外部进程 —— 契约锁 `tests/taskSurface.spec.ts`（11 条）；变异校验：故意把 `deps.backend` 塞回 `run_task`，该锁**恰好 1 条变红**、其余 10 条仍绿 ⇒ 会咬
- [x] R7 真机跑一条完整任务，终态双轴正确 —— **2026-10-15 宿主内实跑**：同一会话里 `run_device_action`（`get_ui_hierarchy` / `click` / `long_press`）与 `report_task_status`（`task outcome recorded: completed`）连续完成，`turn/end` 三次 `reason: completed`；`result=Success; target_source=hierarchy; effect=changed` 是双轴里「动作轴」的原文证据。
      ⚠️ 一条诚实边界：`autogamer_run_task` / `manage_task` / `inspect_trace` **本身没被点用过**（模型在被要求时选了 `job_list`）——它们的**注册可见**已证、**读投影路径**由离线 11 条锁覆盖。要补这一条，需在宿主里显式点名调用一次，属后续可选项，不以此代勾「三条工具在宿主里跑过」。
- [x] **Done：py 引擎无消费者** —— 离线可证的范围内成立（类型面 / 实现面 / 契约锁三重）；live 侧（面板运行态、Config `status:"schema"`、工具清单）已于 2026-10-15 核验，见 CHANGELOGS #97

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

### T2 · 动作面 TS 化（**G83**）· 方案（2026-10-15 立项，R22）

**前置状态**：**已解锁**。§四 要求的两项（前置-1 / 前置-2）2026-10-15 已在真机量完并落账（见该两节）；helper 路线经判定**不作为层级/动作源**，G78 随之退出。**仍缺的一条实测**是 adb 命令面本身 ⇒ 列为本片第 0 步（前置-7），不许跳过直接写实现。

**R20 第 1 步「查」：已握有的事实**（不重复取证，只指权威）

| 来源 | 事实 | 对 T2 的作用 |
|---|---|---|
| §七「前置-1 实测结论」 | 层级 wire 是 **XML 嵌套树**（77 节点 / 19 属性全带 / 无 `children` / 深度 12 / bounds 全 `[l,t][r,b]` / `rotation` 在根上）；本插件解析器现在吃 **JSON 数组**且依赖 py 造的 `parsed_bounds` | T2 必须自带 XML→节点列表；`#N` 句柄与 G67「按身份不按位置」的语义**不变** |
| §七「前置-1 · G76 的新证据」 | 转屏态下 `wm size`=900x1600 而**帧空间**=1600x900；插件三处尺寸同源于截图 ⇒ 唯一暴露面是**手填 `screenSize` 无校验** | 落一条机械防护（配置值 vs 截图 IHDR 不符即拒） |
| §七「前置-2 实测结论」 | helper 要 APK + token + 与 UiAutomation 互斥 ⇒ **不采用**；`adb forward` 生命周期因此不需要设计（G78 口径：不是已解决） | 层级/动作全走 `adb` CLI + `uiautomator dump` |
| §七「前置-3 实测结论」 | 效果判定已在 TS 侧（`00106f8`），`compare_ui_frames` **不再是插件调用** | T2 的 15 工具面**去掉这一条** ⇒ 原生面实为 14 项，provider 仍可有它 |
| `tests/fixtures/py-action-tools.json` 的 notes | 结果形状是**纯字符串**：`Success` / `Failed` / `Error: …` / `Error executing tool …`；坐标是 legacy 像素、归一化发生在插件内；真旗标是 `--type adb` | 原生实现的**可观察输出契约**（分类器 `classify.ts` 靠这些串分类，不能换形状） |
| 守则 **R14 / R15** | 宿主已有并发约定（safe 并发 / mutating 独占）；`timeoutMs` **不被执行**，超时须自实现并观测取消信号 | adb 子进程的超时与 `signal` 传播必须由我们做 |
| 守则 **R12 / R13** | 扩展点「够用即最弱」；策略不许内建进工具正文 | 设备执行机制留在工具内，闸门/熔断仍走既有 `ctx.tools.guard()` |

**What（范围与切片顺序）** —— 每片都要「先测后写」，一片一个收尾门禁（`verify` 全绿 + 涉及 patch 则 R6）：

- **前置-7（第 0 步，纯测量）**：adb 命令面的真 wire 形态 —— `adb devices -l`（含**一台模拟器多条传输**的 G75 现场）、`shell input tap/swipe/keyevent/text`（**含非 ASCII 文本**：`input text` 在多数 Android 版本只吃 ASCII，上游因此走剪贴板注入 ⇒ 本分支必须实测定案）、`exec-out screencap -p`（尺寸/耗时）、`shell monkey/am/start` 的成败与输出、失败与超时时的 stderr/exit code、`uiautomator dump` 的耗时与在部分界面下的失败形态。结果写进本节末「前置-7 实测结论」。
- **T2-a 设备面**（**已完成 2026-10-15**，收口与变异记录见 §七「T2-a 收口记录」）：roster（`adb devices -l` 解析 + **G75 去重**：一条模拟器多传输只算一台）、`getDeviceState` 本地化（连接态 / 屏幕 / helper 状态改为本地探针）、**G76 的 `screenSize` 校验**。
- **T2-b 层级**（**已完成 2026-10-15**，收口与变异记录见 §七「T2-b 层级收口记录」）：`hierarchyXml.ts`（XML → 节点列表，自产 `parsed_bounds`），`parseVisibleElements` 增加 XML 入口并保持现有 `#N` / 身份解析语义不变（G42 / G67 的锁不动）。实际落名为 `src/device/hierarchy.ts`（读）+ `src/hierarchy.ts` 的 XML 入口（解析后共用同一份元素记录）。
- **T2-c 截图**（**已完成 2026-10-15**）：`exec-out screencap -p` 直接产帧，喂给已有的 `saveScreenshot` / `parseImageSize` / 效果差分（T3 已原生，零改动复用）。附带修掉旧浪费：截图此前被**抓两次**（buildCall 内一次、执行面一次）。
- **T2-d 手势与输入**（**已完成 2026-10-15**）：tap / long_press / swipe / keyevent / back / 文本（**按前置-7 走 `input text`，剪贴板路线不建**）/ erase_one_char，逐条对上现有字符串契约与分类；长按语义挂 **G91** 待复测。
- **T2-e 应用与链接**（**已完成 2026-10-15**）：launch_app / stop_app / open_link；包名与 URL 走形状白名单（拒在 spawn 之前）。
- **T2-f 诊断与设备态**（**已完成 2026-10-15**，见 §七「T2-f 诊断本地化与提供方清点」）：`diagnose` 不再走 `backend.diagnose()`，改由 preflight（已有七项）+ 本地探针拼装；**顺带落 T4 的 `artemisMcpCommand` 终局**所需的「provider 还有没有消费者」清点 ⇒ **答案是「无」**。

**范围外**：helper APK 的 TS 复刻（D13 二期，另立）；OCR / overlay（当时 G87 / G88 判为推迟 —— ⚠️ OCR 其后由 **T5** 反转为内置并已落地，overlay 仍推迟 ⇒ G88）；删除 provider 适配层本身（§一.3 保留为可选外部提供方，T4 定夺）。

**How（关键决策）**
1. **可观察契约不动，只换实现**：与 T1 同一手法——工具名/参数/返回字符串/`render` 保持现状，判据是既有锁（`deliveryShape.spec`、`classify.spec`、`router-errors.spec`、`gate/devicePool/breaker` 全套）。
2. **子进程边界集中**：所有 adb 调用过一个 `spawnAdb(serial, args, {timeoutMs, signal})`，超时**自实现**并观测 `signal`（R15），错误分类映射到既有字符串形状；禁止各工具自己拼命令（防注入：serial 与参数走 argv 数组，不拼 shell 字符串）。
3. **一次只测一个变量**：前置-7 的每条测量单独记录原始输出，再据以写实现（R25）；被测量**否证**的旧表述当场就地标注（R28）。
4. **原生为默认，provider 为可选**：`ActionClient`（MCP stdio）保留但不作为默认路径；「默认走原生」的开关语义与 preflight 的「提供方未配置 ⇒ 跳过」一并在 T2-f/T4 收口。
5. **live 验证的授权边界**：把插件真挂进 profile 需要 `install_bundle` / 侧边栏面板（要 agent 会话与权限，R19 不代批）⇒ 设备侧 `adb` 测量**可以**由我做，挂载类验证**必须**由用户放行。凡「只过单测、未挂载」的宿主/设备交互，一律标 🔶（R21）。

**Verify（每片必跑）**
- `pnpm --config.verify-deps-before-run=false run verify`（build + typecheck + vitest 全绿）；`node scripts/check-docs.mjs` 与 `node scripts/check-env.mjs` exit 0。
- 每条 adb 行为都要留**可复跑命令 + 实测输出**（前置-7 那张表就是格式）。
- **R27 变异校验**：每条新契约锁配一次「故意改坏 ⇒ 恰好它红」（沿用本轮 apply.spec / contracts.spec 的做法）。
- **与 py 的「同一输入同一输出」对照**：本机仍**做不了**（无 py 运行时；provider 未装）。替代证据 = 字符串契约锁 + 设备实测形状；对照表与 T3 那条一起挂在延迟项上，**不许勾**。
- 若某片动了 `cordis.patch.yml` ⇒ R6（`--dump-config` rc 0 且无 `unmatched`）；改动影响声明面 ⇒ R7 开新会话复验。

**Done means**（T2 整体）
- [x] 前置-7 测完并落「实测结论」（含文本注入路线的定案：`input text` 直接承载非 ASCII，剪贴板路线不预建）
- [x] 动作面直呼清单**为空**（T2-a/b/c/d/e 收口：`contracts.spec` 的锁已从「还剩哪些」改为**禁止**，恢复任何一条即红）——**T2-f 的诊断与提供方清点仍在办**，不在本条范围内
- [x] G75 / G76 在设备面片内结案（各配一条会红的锁）—— **T2-a 达成**：G75 的锁在 `deviceRoster.spec` + `devicePool.spec` + `apply.spec`（变异 M2 / M4 跑红），G76 的锁在 `apply.spec`（变异 M1 跑红）；残留一半另立 G90
- [x] `run_device_action` 全链在 TS 侧跑通一次真机 —— **2026-10-15 宿主内会话**：`get_ui_hierarchy`（我们的 `#N` 清单原文 `hierarchy=#0 [800,450] pkg=app.lawnchair …`）、`click {text:"设置"}` ⇒ `result=Success; target_source=hierarchy; effect=changed`、`long_press` ⇒ 桌面图标真的弹出快捷菜单（G91 复测，CHANGELOGS **#97**）
- [x] **Done（前半）：`artemis mcp --type adb` 不再是任何路径的运行时依赖** —— T2-c/d/e 清零动作面直呼、T2-f 拆掉最后一个 provider 消费者（diagnose），`ActionClient` 与 `src/artemis/` **均无工具消费者**（模块删除与配置面收窄归 T4）
- [x] **Done（后半）：15 工具全在 TS 侧「可跑」的真机证明** —— 离线面全部有锁，「挂进宿主后一次跑完」已于 2026-10-15 完成（R6/R7/R9/R24 四条读数见 #97）。
      ⚠️ 诚实边界：**逐条**真机覆盖不是 15/15 —— 宿主会话里实跑的是层级 / click / long_press / 设备态 / 汇报五条；其余动作的真机证据是 T2-c/d/e 那轮 `adb` 直测（逐条 `Success` + 三条该拒的拒），不是宿主内跑过。

#### 前置-7 实测结论（2026-10-15，Android 15 / SDK 35，`emulator-5554` aurora / 24031PN0DC）

测量方式本身就是结论之一：**用 `spawnSync('adb', argv)`（无 shell）跑**，与插件将来原生层的调用形状一致。
探针脚本在忽略区（`scratch/probe-adb*.mjs`），**判据已全部抄进下表**，不依赖脚本存在。

| 面 | 实测事实 | 对原生实现的硬约束 |
|---|---|---|
| 成功**没有**输出 | `input tap/swipe/keyevent/text` 成功一律 **code=0 + stdout 空** | 夹具里 `Success` / `Failed` 那套字符串是**旧实现自造的**，不是 adb 的；我们自造并保持（分类器 `classify.ts` 依赖它） |
| 退出码不可信（成功侧） | `uiautomator dump` **成功也返回 code=139**，且把成功消息打到 stdout | 层级读取**不得**以退出码判成败 |
| 成功消息也不可信 | 给一个不存在的路径，它照样打印 `UI hierchary dumped to: /nope/x.xml`（仍 139） | 唯一可信判据是**把文件读回来并校验 XML**（`dump` → `exec-out cat` → 校验根 `<hierarchy`） |
| 错误在 stdout 上且码为 0 | `input keyboard insert …` ⇒ stdout `Unknown command: insert`，**code=0** | 不能只看码；要看输出内容形状（原生层需统一「含 `Unknown command` / `Exception` 即失败」） |
| 参数被**设备侧 shell 重切** | `monkey` 的失败输出把参数逐条回显为 `bash arg: -p` / `arg: "-p"` | `adb shell <cmd>` 会把参数交给设备 shell 再解析 ⇒ **模型可控文本 / URL / 包名必须自行转义或封装**，argv 数组不免疫（安全面） |
| 失败码形状 | `input tap abc 450` → code=**255** + stderr `Exception occurred while executing 'tap'…`；`am start -n` 不存在的组件 → code=**1** + stderr `Error type 3` / `Error: Activity class … does not exist.`；坏 serial → code=1 + stderr `adb.exe: device 'nope-9999' not found` | 分类映射表（environment / nontarget / refused）按这些真实形状写，不猜 |
| 幂等性 | `am force-stop <不存在的包>` → code=0 且无输出 | stop_app 天然幂等，不需要「先查在不在」 |
| 启动目标解析 | `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER <pkg>` → `pkg/activity`；`monkey -p <pkg> -c …LAUNCHER 1` → code=0，stdout 尾 `Events injected: 1` | launch_app 两条路线都有权威形状；`resolve-activity` 更适合做「解析即失败」的早退 |
| 截图 | `exec-out screencap -p` → code=0，**632ms**，**1,281,058 bytes**，PNG depth 8 / colorType 6 | **必须抬高子进程缓冲**：默认 `maxBuffer`（1MB）会抛 `ENOBUFS`（本轮第一枪就栽在这）；帧空间与 `dumpsys window displays` 的 `cur=`/`app=` 同值 |
| 文本注入 | 地址栏基线 `example.com` → `input text ZONEE` 后层级读到 `"ZONEE"` → 再 `input text 你好` 读到 `"ZONEE你好"` | **`input text` 直接承载非 ASCII**（本机 / Android 15）⇒ 上游「剪贴板注入」不是必需路线；剪贴板方案留作**未来设备失败时的备选**，不预建 |
| roster 身份（G75） | 同机三传输 `emulator-5554` / `127.0.0.1:7555` / `127.0.0.1:16384`：`ro.serialno` 与 `ro.boot.serialno` **都是空串**，而 `settings get secure android_id` 三行同为 `c0021066f3fbaf47`；`disconnect` 后回到单条 | **G75 的去重键定为 `android_id`**（不是 serial）；`adb connect` 现场可稳定复现 ⇒ 去重锁写得出来 |
| 层级耗时 | 普通 dump 2.5s、`--compressed` 4.1s（同一屏） | 缓存与 `settle` 节奏不变；`--compressed` **不比全量快**，不采用 |

**本轮三条判据卫生自纠**（都不是设备行为，是我自己的错，按 R27/R28 记账）：
① 第一枪把 `screencap` 的 `code=null` 当成 adb 的行为——真相是 `spawnSync` 默认 `maxBuffer` 撞限抛 `ENOBUFS`，抬高后同一条命令 632ms 正常。
② 第一版文本探针传了 `tap undefined undefined`（我取 `target.x` 而值在 `target.c.x`），又拿 `dumpsys input_method` 的 `mText:` 回读——Android 15 已无该行；两错叠加得到「ASCII 与 CJK 一样」的**无效对照**，判为不作结论并重做。这正是 R27 判据 6：变异/测量本身要先被证明生效。
③ 报告文件一度被我的 `cmd | tee f | head -30` 截断（head 退出致 EPIPE），看起来像「adb 卡住」——判据命令不许接管道（R27 判据 5）。

**设备状态**：测完 `KEYCODE_ESCAPE` + `KEYCODE_HOME`，三条 TCP 传输已 `disconnect`（`adb devices` 回到单条 `emulator-5554`）。

#### 前置-8 实测结论 · 设备态探针（2026-10-15，同一台 `emulator-5554`，T2-a 写码前测）

复跑脚本：`node scratch/probe-device-state.mjs`、`node scratch/probe-screenstate.mjs`、`node scratch/live-device.mjs`（都在忽略区；判据抄在下面，不依赖脚本存在）。

| 面 | 实测事实 | 落进实现的约束 |
|---|---|---|
| 连接态 | `get-state` ⇒ `device` + code=0；未知 serial ⇒ **code=1** + stderr `error: device 'nope-9' not found` | 只认 `device` / `offline` / `unauthorized` 三个词，其它一律当「没答案」（不许读成 offline） |
| 没命名设备时问的是谁 | `get-serialno` ⇒ code=0 `emulator-5554`；坏 serial ⇒ **code=1 且 stdout 空** | 单设备配置不必让操作者填 serial；`device_serial` 缺省 = 不传 `-s`，多设备时 adb 自己报错 ⇒ 诚实回答「说不清」 |
| **屏幕态与前台同源于一次 dump** | `dumpsys window`（671 行）里 `screenState=SCREEN_STATE_ON` 恰 1 行、`mCurrentFocus=` / `mFocusedApp=` 各 1 行；**`dumpsys window displays`（258 行）里 screenState 0 行**；`dumpsys display`（616 行）两者都没有，且 `mRotation` 取不到 | 锁态与前台用**无参数的 `dumpsys window`**；问错参数不会报错，只会得到「unknown」⇒ 准入按 G65 拒。argv 本身有锁（`deviceRoster.spec` / `deviceState.spec`），变异 M3 跑过 |
| 唤醒态 | `dumpsys power` ⇒ `mWakefulness=Awake` | **未采用**（与 screenState 同源但多一次子进程；留作 screenState 在别的 ROM 上缺席时的备选） |
| helper 是否装了 | `pm list packages -3` ⇒ 8 个包，**含 `com.artemis.helper`** | helper 态 = 包名在不在；本机 APK 已在场（前置-2 缺的是 token/授权那一步，不是 APK） |
| 帧空间 vs `wm size` | `wm size` 900x1600、`wm density` Physical 240 / Override 204、`accelerometer_rotation=1`，而 `exec-out screencap -p` 的 IHDR = **1600x900**（code=0，116,674 bytes） | **G76 的转置失配当场可复现** ⇒ 校验基准必须是**帧 IHDR**，不是 `wm size`；`wm size` 从此不再被任何路径读取 |
| 整套本地探针的代价 | serial + get-state + dumpsys + pm + screencap + IHDR + roster + 锁态 全跑一遍 = **455ms** | 只读的设备态工具可以每次问全套，不需要为省时间而少报字段（`get_device_state` 因此总附帧尺寸） |

#### T2-a 收口记录（2026-10-15）

- **落了什么**：`src/device/adb.ts`（唯一 adb 出口：自实现超时 + 观测 `signal` + 二进制安全 `exec-out`）、`src/device/roster.ts`（`devices -l` 解析、`android_id` 去重、锁态三值）、`src/device/state.ts`（连接 / 前台 / 屏幕 / 帧 / helper / capture 探针）。
  `enumerateRoster` 改由这三件拼出；`resolveScreenSize` 改问帧 IHDR；`autogamer_get_device_state` 的 backend 依赖**整条摘掉**；
  `contracts.spec` 的直呼清单从 `get_ui_hierarchy / list_devices / take_screenshot` 收敛为 `get_ui_hierarchy / take_screenshot`。
- **两条差距结清**：**G75 已结清**（`android_id` 去重把三传输折成一台，`PoolDevice.aliases` + `canonicalKey` 再把别名折回**同一把闸门锁**——只折 roster 不折键，翻倍计数照样发生）；
  **G76 已结清**（手填 `screenSize` 与帧 IHDR 不符 ⇒ `environment:` 拒并给出该填的值；基准是帧，不是 `wm size`）。两者各配会红的锁，见下「变异」。
  结清后不留 §四 行（§四 只放开放差距），残留的一半另立 **G90**。
- **顺带做的一件（超出切片清单，理由写在实现注释里）**：预检拆成 `provider` / `device` 两个范围，缓存按范围分键。
  不拆的话「已经走本地 adb 的只读工具」会因「没装 uv」被拒 —— 那是预检在说谎。T4 的 preflight 重画以此为起点。
- **provider 侧的连带后果（不许被当成死代码清掉）**：`McpArtemisBackend.getDeviceState` 仍在接口与 `clientHalf.spec` 的 wire 锁里，
  但**已无工具消费者**。「provider 还剩哪些消费者」的清点属 **T2-f / T4**，本片只记录不裁决。
- **五条新锁的变异（R27）**：`node scratch/mutate-t2a.mjs` —— M1 去掉 G76 校验 ⇒ `apply.spec` 恰 1 红；M2 去掉别名折叠 ⇒ `devicePool.spec` 2 红；
  M3 把 dumpsys 参数改回 `window displays` ⇒ `deviceRoster.spec` 恰 1 红；M4 停止按 `android_id` 折叠 ⇒ `deviceRoster.spec` 恰 1 红；
  M5 把「没答的 helper 探针」报成 `false` ⇒ `getDeviceState.spec` 恰 1 红。五条全部**跑到红**，无一条假绿。
- **仍标 🔶 的**：这些 adb 形状只在**这一台** Android 15 模拟器上量过（其它 ROM 的 `screenState` 缺席路径已有回落，但未实测）；
  挂载后的真机 `get_device_state` / 完整任务仍未跑（§六 前置，属用户授权面）。

#### T2-b 层级收口记录（2026-10-15）

**复跑命令**：`node scratch/probe-hierarchy2.mjs`（现场取 dump）、`node -e` 走 `dist/device/hierarchy.js` 的真机核验、`node scratch/mutate-t2b.mjs`（变异）。

- **实测（在 前置-1 之外新增/更正的）**：
  - `uiautomator dump` 本轮 **code=139 / 2439ms**，stdout 依旧 `UI hierchary dumped to: …`（Android 自己的拼写）⇒ 读回校验这条路再确认一次；
  - 同一棵树 **45 节点 / 每节点 19 属性**（属性名顺序固定：`index,text,resource-id,class,package,content-desc,checkable,checked,clickable,enabled,focusable,focused,scrollable,long-clickable,password,selected,bounds,drawing-order,hint`）、**混合标签形态**（21 自闭合 + 24 成对）、`bounds` 全为 `[l,t][r,b]`（45/45）、`rotation` 挂在 `<hierarchy>` 根上（本机 = 1，正是 `wm size` 与帧空间转置的来源）；
  - **深度是 14，不是探针脚本先算出的 15**：那条是探针自己的计数口径错（把自闭合也算一层），实现用**祖先栈**并在 `hierarchyXml.spec` 里以「构造已知的三行树」独立证明栈是对的，再拿真机 dump 锁数值；
  - 夹具 `tests/fixtures/hierarchy-chrome.xml` = 真机原文逐字（含 CJK 文本与弯引号），头注写明来路；**取回时必须按字节读**：第一版探针把 `exec-out cat` 当 utf8 字符串再 `latin1` 转 Buffer，CJK 全成乱码且 `bounds` 正则 0 命中 —— 看着像设备行为，其实是测量自身的错（按 R27 判据 6 记账）。
- **落了什么**：`src/device/hierarchy.ts`（dump → 读回 → 校验 → 清理，`dumpPath()` 带 pid 以免两个实例互读）；`src/hierarchy.ts` 的 `parseVisibleElements` 增 XML 入口，**同一份元素记录**由两种 wire 形态产出（锁在「两条入口给出同形」那条）；路由 `hierarchy` 依赖**改为必填**并**删除 provider 的 JSON 层级路径**（`get_ui_hierarchy` 从此不过传输），读失败按 G33 冠 `environment:` 前缀。
  `contracts.spec` 的直呼清单因此收敛为 **`take_screenshot` 一条**。
- **一处行为差别（不是回归，但值得记）**：真机 dump 是**整棵树**（容器节点也在内），所以模型看到的 `#N` 列表含无标签的容器行；旧夹具只有两行是因为 py 侧那份 JSON 本来就是简化过的。77 节点那次实测同样包含容器 ⇒ 与提供方一致，不是新引入的噪声。
- **空层级怎么算**：`<hierarchy></hierarchy>`（0 节点）**判为「读不到」而不是「屏幕是空的」**——与 前置-1 的 fail-closed 口径一致；DRM/安全屏若真给空树，走的是「重读或退回截图+归一坐标」那条既有 refusal。
- **五条变异（R27）**：N1 去掉读回校验 ⇒ `hierarchyXml.spec` 2 红；N2 不用祖先栈 ⇒ 1 红；N3 把成对标签也当自闭合 ⇒ 1 红；N4 读失败丢掉 `environment:` 前缀 ⇒ `validatorLadder.spec` 1 红；N5 让层级退回传输 ⇒ `apply.spec` 4 红。
- **verify**：**38 文件 / 390 通过 / 1 跳过**（T2-a 后为 37 / 374）。真机端到端：`dist` 走一遍 **2038ms**，45 节点、11 个 clickable、CJK 完好。

#### T2-c/d/e 动作面收口记录（2026-10-15）

**复跑命令**：`node scratch/probe-acts.mjs`、`node scratch/probe-acts2.mjs`、`node scratch/probe-acts3.mjs`、`node scratch/probe-acts5.mjs`（测量）、`node scratch/live-acts.mjs`（真机逐条动作）、`node scratch/mutate-t2cde.mjs`（变异）。

- **实测新增（在 前置-7 之外）**：
  - `cmd package resolve-activity … <不存在的包>` ⇒ **code=0 + stdout `No activity found`**（退出码又一次撒谎的第二例）⇒ launch_app 先解析、按文本早退；
  - `input keyevent 67 67 67` 一次调用**恰好删 3 个字符**（真机地址栏 `MARKER9` → `MARK`）⇒ 清字段不必 N 次 spawn；
  - `input text` 落在**光标处**，且 `keyevent 123`（MOVE_END）在 Chrome omnibox **不生效**（实测文本插进了字符串中间）⇒ 清字段做「双向删除 + 读回校验」，不假设单向清空；
  - `am start -a VIEW -d '<url>'` 成功打印 `Starting: Intent { … }`；`am force-stop <没装过的包>` code=0 无输出（幂等，无需先查）；
  - 长按：零距离 swipe / `motionevent DOWN…UP` 与**普通 tap 对照组反应完全一致** ⇒ 该实验不成立（不是阴性），形态按标准写法落，语义复测挂 **G91**。
- **落了什么**：`src/device/act.ts`（12 条动作全部走 adb，产出**旧字符串契约** `Success` / `Failed` / `Error: …`，使 `classify.ts` 与既有锁原样可用）；
  路由的 `client` 依赖**整条删除**，改为 `execute` + `capturePng` 两个函数；截图改 `exec-out screencap -p`（不再 base64 往返，也修掉「一张截图抓两次」的旧浪费）；
  模型可控文本/URL 走 `quoteForDeviceShell`，包名/URL 走**形状白名单**（`javascript:` / `file:` / 带空格的 URL 一律拒，且拒在 spawn 之前）。
  `src/index.ts` 不再构造 ActionClient；配置面因此**删掉两个字段**（`actionServerCommand` / `actionServerEnv`），`contracts.spec` 的字段清单同步。
- **`contracts.spec` 的直呼清单从 3 条 → 2 条 → 1 条 → 0 条**：本片的锁由「还有哪些直呼」改成**禁止**（`toEqual([])`，恢复任何一条即红）。
  这**达成 §四 T2 Done 判据第一条**（`src/` 内再无指向动作面工具的 `client.callTool`）。
- **连带处置**：`ActionClient` 与其夹具（`actionClient.spec` / `mockServer.spec`）现在**无任何生产消费者**，本片**不删**（删它属 T4 的提供方裁决），只在 §七 记为「已无消费者的在测代码」。
- **六条变异（R27）**：P1 放开 URL 白名单 ⇒ 1 红；P2 包名不校验 ⇒ 1 红；P3 文本不转义 ⇒ 2 红（单参数 + 引号转义两条）；P4 只看退出码不看 stdout ⇒ 1 红；P5 swipe 丢 duration ⇒ `apply.spec` 1 红；P6 清字段不读回校验 ⇒ 1 红。
- **真机端到端**（`node scratch/live-acts.mjs`，逐条打真机）：back / launch / swipe / tap / input text / erase / press_key / open_link / stop_app / long_press 全 `Success`；
  三条**该拒的都拒了**（`javascript:` URL、无 launcher 的包、`com.x; rm -rf /sdcard/*`）且**没有产生任何子进程**；`capturePng` 1,281,952 bytes / IHDR 1600x900。
  ⚠️ 一处诚实标注：该轮 tap 落点不是输入框，故「文本落到字段里」这一条在**本轮 live 未复现**（前置-7 已量过 `input text` 承载 ASCII 与 CJK，argv 形状另有单测锁）。
- **verify**：**39 文件 / 412 通过 / 1 跳过**（T2-b 后为 38 / 390）。

#### T2-f 诊断本地化与提供方清点（2026-10-15）

- **落了什么**：`src/device/diagnose.ts` 把诊断拼成本地探针的合成人（连接态 / 锁态 / 帧 / helper 装没装 + `dumpsys package` 的 `versionName` / `logcat -d -b crash` 的 tombstone）；
  `src/tools/diagnose.ts` 的 `backend` 依赖删除，`include_screenshot` 从「收下但忽略」变成**真的附图**（与路由同一 `[text, image]` 出块规则）；
  任务三件套与诊断的预检门一并改为 `device` 范围 ⇒ **没有任何工具再要求 uv / python / provider 仓库**（这正是「用户无需额外安装配置」的那道门）。
- **提供方清点（本片要顺带答的那一问）**：**`src/artemis/` 已无任何工具消费者**（diagnose 是最后一个），`artemisBackend` 不再被构造。
  仍留着的三样各有去处：① 模块本体与其 `clientHalf` / `mcpBackend` 规格 ⇒ **T4 裁决删除或保留为可选面**；② `Preflight` 的 `provider` 范围 ⇒ 现无调用者，一并裁决；
  ③ 配置字段 `artemisMcpCommand` / `artemisRepoPath` / `uvPath` ⇒ 归 T4 的「配置面收窄」（前置-4）。
- **实测补录**：`logcat -d -b crash -v brief` 里**每一次 `uiautomator dump` 都留下一个 SIGSEGV tombstone**（`Cmdline: uiautomator`，本轮读到数十条）
  ⇒ 这解释了 前置-7 量的「成功也退 139」：dump 写完文件后进程自毁。诊断面因此天然能报告这件事，但**不得**据此判层级读取失败（判据仍是读回的文件）。
  另：`dumpsys package com.artemis.helper` 有 `versionName=1.2.0`（helper APK 确在本机，前置-2 缺的是 token/授权不是 APK）。
- **四条变异（R27）**：Q1 预检文本不再优先 ⇒ 1 红；Q2 空帧仍写附件存储 ⇒ 1 红；Q3 crash 缓冲逐行切块 ⇒ 1 红；Q4 不问 helper 版本 ⇒ 1 红。
  **两条判据卫生自纠**：Q2 与 Q4 **第一次跑是绿的**——因为 `noFrame` 走的是「依赖缺席」而不是「帧缺席」，且 `helperVersion` 只在桩合成报告上断言、没碰探针本体。
  补了这两个用例（帧存在但为空 / `diagnoseDevice` 的真探针）之后变异才红。**这正是 R27 要防的假绿**：有测试不等于测试有牙。
- **verify**：**39 文件 / 425 通过 / 1 跳过**。真机跑 `diagnoseDevice("emulator-5554")`：连接 / 锁态 / 帧 1600x900 / helper `1.2.0` / 若干 tombstone 全部答出；
  坏 serial ⇒ `adbConnected:false` + 两条诚实建议（「adb 没回答」「屏幕态读不到」），helper **不报 false 而是不报**。


### T2 · 动作面 TS 化（**G83**）

> **切片与决策见上方「T2 · 动作面 TS 化（G83）· 方案」**（2026-10-15 立项：前置-1/2 已测、helper 路线不采用、第 0 步是前置-7 的 adb 命令面实测）。下面四条是收尾判据。

- [x] 动作工具面 TS 原生实现（adb CLI + `uiautomator dump`；**不含** helper 协议客户端）
- [x] 与旧实现逐条对照：同一输入同一输出 —— **T4 判定该判据在本分支永不可得**（D19 之后仓内无可跑 py，比对脚本随传输层一起删除），故**换成可离线复跑的分区锁**：`py-action-tools.json` 那份 15 条名单逐项归入「11 条原生 adb / 2 条路由器本地答 / 2 条带理由放弃」，且 11 条**逐个打到 `runNativeAction` 上证明 case 真在** + 一条反向对照（名单外必须被判 unsupported）。变异 N6 / N7 各红一次 ⇒ 新判据会咬。见 §七「T4 收口记录」与 CHANGELOGS **#94**。
- [x] 坐标 / 层级 / 截图三条金标准复测（坐标含 G76 的 `screenSize` 校验 + G90 的 TTL；层级含 XML→节点；截图含 IHDR 与效果差分的同源）—— 离线锁 + 真机读数（T2 各片收口记录）+ 2026-10-15 宿主内会话再跑一遍（#97）
- [x] **Done：不再依赖任何 py 动作面** —— 直呼清单锁为空集禁令、`ActionClient` 与 py 传输脚本已于 T4 删除、覆盖面由分区锁自证

### T3 · 效果差分 TS 化（**G84** 第一片）· 方案（2026-10-14 立项，R22）

**背景**：`compareFrames` 现在把两帧转发给外部动作面的 `compare_ui_frames`（G39 route A），效果判定因此仍依赖 py 动作面 —— 这是 G84 的 py-only 面之一，且是 `runDeviceAction` 路由里**唯一**的判定来源。前置-3 已把移植范围收口为 `check_ui_change` 单条路径（算法/阈值/分支/fail-open/坐标空间五条结论 + 5 条判别用例蓝本齐备）。本片只做**差分**；OCR 与 overlay 留作 G84 后续片。

**R20/R22 第 1 步「查」：查了哪份、事实是什么**（全部转述，不搬文本 —— D20）

| 出处 | 事实 | 对本方案的作用 |
|---|---|---|
| 本文件 §七「前置-3 实测结论」（读归档 blob 得到的**设计事实**：遮罩、模糊、阈值、分支表、ROI 几何、失败方向、坐标空间） | 全局管线：裁顶 10%/底 5% → 绝对差 → 5×5 高斯（σ≈1.1）→ 阈值 25 → 占比 vs `1e-4`；ROI 管线：从**未裁剪**图取景、半径 `max(15, int(50×scale))`（scale=当前帧对角线/1080×2400 对角线）、3×3 高斯（σ≈0.8）、阈值 20 → 占比 vs `0.05`，**未过门限回落全局**；分支：`swipe` 只看全局，`tap`/`long_press_on`/`focus_and_input_text`/`focus_and_clear_text` 且坐标为二元组 ⇒ 先 ROI | 实现蓝本：每个常量都能指回函数+常量名 |
| 本文件 §七 前置-3「H. 判别用例集」 | 5 条用例（同帧不变 / swipe 变 / 中心方块 ROI 触发（该分辨率下 `roi_size≈26`）/ 顶部 50 行被遮罩 / 1080×2400 中心 10×10 + 门限抬到 1e-3 ⇒ 不变——它把「ROI 落空回落全局」钉死） | spec 蓝本，用例 5 最该先落 |
| 现状 TS 触点：`src/index.ts` 的 `compareFrames`（转发 `compare_ui_frames`）、`src/tools/runDeviceAction.ts:831` 传 `payload.coordinates`、`:914-926` 的 `compareFramesSafe`、`:833-836` 的消费（`changed !== false` 放行；`undefined` → effect `unknown`，不进阶梯） | 接口签名与失败语义已经定好，替换只动 `compareFrames` 的**实现** | 契约面不动：签名/消费/回归面保持 |
| 实测（本机 scratch 真帧的 IHDR） | 帧形状 = **1600×900 / depth 8 / colorType 6（RGBA）/ 无隔行** | 解码器范围由实测界定：支持 depth 8 的 type 2/6 即可，其余形状 fail-open |
| 实测（`buildCall` 的 payload 构造，`:937/:942/:964/:954`） | 传给 `compareFrames` 的 `coordinates` 是**像素**（`resolvePixelTarget`→`toPixels`；swipe 是四个像素值） | ROI 取景直接用帧内像素，无需再换算（前置-3「不是错位」的结论在边界处成立） |
| 现有锁：`tests/apply.spec.ts:34/50/371`（route A 转发锁）、`tests/conformance/contracts.spec.ts:65-79`（直呼工具清单含 `compare_ui_frames`）、`tests/mockServer.spec.ts`（mock 面自身形状） | 转发这件事**有锁**，替换后要改成「零 py 调用」锁 | 变异校验的落点 |
| 依赖面：`package.json` 无任何图像库；`node:zlib` 内置（PNG 的 IDAT 就是 zlib 流） | 零新依赖手写解码是可行的 | 依赖决策 |

**What（范围）**
1. 新增 `src/effect/png.ts`：**最小 PNG 解码器**（零新依赖）——IHDR 解析、IDAT 拼接 + `node:zlib` inflate、5 种行滤波反演；支持 depth 8 的 colorType 2/6；其余形状**抛错**（由上层 fail-open 承接）。
2. 新增 `src/effect/diff.ts`：灰度化（cv2 权重 `0.299/0.587/0.114`）→ 全局管线与 ROI 管线（按上表常量）→ 动作分支表 → 返回 `boolean | undefined`。同步纯函数，输入 `Uint8Array`（base64 在边界解）。
3. `src/index.ts` 的 `compareFrames` 改调本地实现；**失败方向**：解码失败/不支持形状 ⇒ 返回 `undefined`（走既有 fail-open；**不发明 `true`**——前置-3 B 已记录「TS 侧的等价语义是 `undefined`」）。
4. 新增 `tests/effectDiff.spec.ts`（5 条判别用例 + 遮罩/ROI 回落/失败方向）；`tests/apply.spec.ts` 的 route A 转发锁改为**零 py 调用**锁；`contracts.spec` 的直呼清单去 `compare_ui_frames`；README Layout 补两个模块行（`readmeLayout.spec` 会咬）。

**非目标**：OCR（G84 另一片）、overlay、`settle` 与重试阶梯（已有）、动作面本身（T2）、把 `compare_ui_frames` 从 provider 面删除（provider 保留该工具，只是**插件不再调用**）。

**How（做法与关键决策）**
- **零新依赖手写解码**，替代方案「引入 `pngjs`/`sharp`」被否：为一个已知窄形状（depth 8、type 2/6、无隔行）引入依赖不划算；`screencap` 免解码的原始 RGBA 路线属 T2 传输面，不在本片。
- 高斯核**按 k 推导**（`σ = 0.3×((k−1)×0.5−1)+0.8` ⇒ k=5 得 1.1、k=3 得 0.8），与 cv2 口径对齐；浮点实现，并在 spec 里用**合成帧逐像素**钉住判定边界。
- 灰度化与通道序：PNG 存储序是 RGB(A)，权重按 `0.299R+0.587G+0.114B`（cv2 的 BGR2GRAY 换算后同值）。
- 大小写与命名：模块放 `src/effect/`，名字用 `judgeEffectChanged` / `decodePng`，README Layout 同步。

**Verify（验收命令）**
- `tests/effectDiff.spec.ts` 全绿：5 条判别用例（含用例 5 的 ROI 落空回落）+ 失败方向（坏字节/不支持形状 ⇒ `undefined`）+ 遮罩边界（顶部 50 行不算变化）。
- **三处变异各红一次**（R27）：① 删「ROI 落空回落全局」⇒ 用例 5 红；② 遮罩顶从 10% 改 1px ⇒ 用例 4 红；③ 把失败方向改成抛错 ⇒ 失败方向用例红。
- **零 py 调用锁**：apply.spec 里断言 `compare_ui_frames` **未被调用**（变异：把转发塞回 ⇒ 该条红）。
- 真实帧冒烟（离线）：用 `scratch/` 的 1600×900 真帧做**同帧自比** ⇒ 必须判「不变」；跨帧 ⇒ 必须给出判定（仅作解码正确性冒烟，**不作 parity 证据**）。
- `pnpm --config.verify-deps-before-run=false run verify` 三段全绿；`node scripts/check-docs.mjs`、`node scripts/check-env.mjs` exit 0。

**诚实边界（🔶，不许写成已完成）**：规格 §三 的 T3 验收写着「TS 与 py 判定一致（对照表留档）」，但本分支 **D19 下仓内无 py、本机也没有解释器与旧 venv**，provider（外部 ARTEMIS）同样未配置 ⇒ **同输入同输出对照在本机 structurally 做不了**。
替代证据是三件：① 每个常量带出处（函数+常量名）；② 5 条判别用例锁行为；③ 失败方向与坐标空间语义锁。**对照表列入延期待办**（与 provider 环境一并解，标 🔶 不勾）。

**Done means**
- [x] `compareFrames` 走本地实现；插件树内不再调用 `compare_ui_frames`（grep + 锁双证：contracts 直呼清单已去该名、apply.spec 的「零 py 调用」锁在）
- [x] 5 条判别用例 + 失败方向 + 遮罩/ROI 边界全绿，且三处变异各红一次（**偏差如实记**：删「回落」的红点是**我补的第 6 条用例**，前置-3 的用例 5 区分不了回落与直接返回——两者都给 false）
- [x] 解码器覆盖实测帧形状；不支持形状走 fail-open（`undefined`）；真实帧冒烟同帧自比全 false
- [x] README Layout 与 `readmeLayout.spec` 同步
- [x] 🔶→**结案（T4 判定）**：与 py/provider 的同输入同输出对照表 —— 该判据在本分支**永不可得**（D19 归零后无可跑 py），不再作为待办挂账；替代证据链 = 判别用例集 + 三处变异 + 真帧冒烟 + **T4 的覆盖面分区锁**（见 §七「T4 收口记录」）
- [x] 台账同步：G84 行标「部分（差分已 TS 化）」，规格 §二 该行状态更新（只写指针）

### T3 · 图像与 OCR TS 化（**G84**）

- [x] 效果差分落 TS（算法与阈值从旧实现读设计）—— **已落地**（提交 `00106f8`；判别用例 + 三处变异 + 真帧冒烟，见上方「T3 · 效果差分 TS 化」的 Done；对照表 🔶 延迟）
- [x] OCR 改 HTTP 直译 —— **本条已从 T3 撤销**：2026-10-14 判「零消费者 ⇒ 推迟（G87）」，2026-10-15 被用户裁定推翻并**换成离线内置形态**，工作移入 **T5**（方案与可行性实测见 §七「T5 · OCR 内置」）。T3 不再欠这条，也不欠任何 py 依赖
- [x] overlay 标注改 TS 图像库 —— **判定不做，改立推迟项 G88**（零消费者；清点与解锁条件见 §七「前置-6」）
- [x] 对照表留档（同输入同输出）—— **同上条：本分支不追求该判据**（无 py 可比对，比对脚本已随传输层删除）。留档的是**替代证据**：效果判定的判别用例集与变异见 §七「T3 · 效果差分 TS 化」，动作面的历史名单对照见 §七「T4 收口记录」的分区锁。
- [x] **Done：效果判定与 OCR 无 py 依赖** —— 判定为**成立**：差分已 TS 原生（`00106f8`，插件不再调 `compare_ui_frames`，contracts 直呼清单与「零 py 调用」锁双证）；OCR / overlay 均**零消费者 ⇒ 不存在依赖**（G87/G88 推迟）。
      ⚠️ 这条 Done 成立**不等于**上面那条对照表完成——Done 说的是「无 py 依赖」。**可复跑判据是锁不是 grep**：`tests/conformance/contracts.spec.ts` 的直呼清单（只匹配 `client.callTool("…")` / `callTransport(client, "…")` 两种调用形状，已不含 `compare_ui_frames`）+ `apply.spec` 的「不再问动作服务器」锁。
      （这里原本我写成「`grep -rn compare_ui_frames src` 为空」——**那条判据是错的**：src 里现有 2 处命中全是注释与说明文字，裸 grep 会把无害散文判红。判据必须只认调用形状，已按此改正。）

### T4 · 收尾与溯源清理（**G85** + **G86**；方案 2026-10-15 展开为四片，R22）

> 本片是**终态收敛片**：把「TS 全栈」说了但没做完的部分收掉，并把每条被删/被留的东西给出**可复跑判据**。
> 权威口径是规格 §一 的五条（尤其 **§一.3**：外部 ARTEMIS「**仅保留 adapter**，能显式指向用户自行安装的那一份」——所以**删的是 py 语义，不是 adapter**）。

**清点实测（2026-10-15，`grep` 全树）**

| 面 | 实测 | 结论 |
|---|---|---|
| `src/artemis/{adapter,mcpBackend,types}.ts`（362 行） | `src/` 内**零 import**（只有两条注释提到）；spec 侧 `adapterEnvGate` / `artemisMcpBackend` / `clientHalf` 共 273 行测的是它自己 | 按 §一.3 **保留**，但必须给它一个**真消费者**，否则 `artemisMcpCommand` 是「有字段无行为」 |
| `src/actionClient.ts`（87 行） | 消费者只剩 `scripts/spike-mcp.mjs`（要活 py 服务才能跑） | **删**（T2-c/d/e 已把路由的 `client` 依赖拆干净，直呼清单锁现为空集禁令） |
| preflight 七项 | `provider` 范围**只剩** `apply()` 里一次 fire-and-forget 热身（`void checkEnv()`），**没有任何工具门走它**；五个工具门全走 `device` | 重画为**两项**（adb / adb-devices），`PreflightScope` 与 `PreflightInput` 随之消失 |
| `ACTION_TO_PY_TOOL` | 路由器**不用它**（每条 action 在 switch 里直接给原生调用名）；只有 contracts 的「键集 == ACTIONS」与 spike-mcp 用它 | **名不副实的第二权威** ⇒ 删映射，覆盖面改由原生动作表自证 |
| `src/scrcpy/{server,input}.ts`（333 行）+ 5 个 `scrcpy*` 配置字段 | `apply()` 里**构造 + dispose，零工具驱动**；`scrcpyServerPath` 默认 `""` ⇒ 要操作者自备 server 二进制；**全 docs 零提及**（无编号、无归属 ⇒ 搬迁-1 带过来后从未被裁决） | 与「零配置」「每个字段都有消费者」两条都冲突 ⇒ **新立 G93 后删除**（镜像若将来要做，属宿主 UI slot / R18 的新能力，不是复活死代码） |
| `scripts/{spike-mcp,mock-action-server,dump-proxy}.mjs` + `tests/mockServer.spec.ts` + `tests/fixtures/py-action-tools.json` | 前两者要**活的 py 动作服务**（本分支按 D19 不存在）；夹具是唯一一份「py 面 15 工具名单」的历史记录 | 夹具**留**（改成「原生覆盖面」的历史权威），需要活服务的脚本与 spec **删** |

**What（范围，四片）**
1. **T4-a 配置面与 preflight 重画**：删 `uvPath` / `artemisRepoPath` 与 uv / python / repo / installed / helper 五项检查；`PreflightRunner.run()` 去参数、去 scope；`PreflightResult.checks` 只剩 `adb` / `adb-devices`；三条失败语义仍不混（注入 fail-open / 体检 gate / 提供方 lazy connect）。
2. **T4-b 提供方链收口**：`artemisMcpCommand` 保留并写明「不内置、不 vendored、不为其开开发依赖」；给 adapter **一个真消费者** —— `autogamer_diagnose` 增 `provider:{configured, command, reachable, tool_count}`，**未配置即 `configured:false` 且完全不连接**（零配置默认态），配置了才 lazy connect 一次列工具，失败只写一行建议（与 OCR 的诊断项同构）。删 `src/actionClient.ts`、`ACTION_TO_PY_TOOL`、`scripts/spike-mcp.mjs`、`scripts/mock-action-server.mjs`、`scripts/dump-proxy.mjs`、`tests/mockServer.spec.ts`、`tests/clientHalf.spec.ts`、`tests/actionClient.spec.ts`。
3. **T4-c 镜像链裁决（G93）**：删 `src/scrcpy/*` + 5 字段 + `tests/scrcpy.spec.ts`；README Layout 与 spec §九 同步；`scrcpyEnabled` 的「关掉就不构造」语义随模块消失。
4. **T4-d 覆盖面锁 + 溯源/D19 自检 + 文档口径**：`py-action-tools.json` 改为**原生覆盖面**的历史权威（每个 py 工具名 → 我们的原生落点，缺一个即红）；D19/D20 五条自检跑一遍并记录读数；`AGENTS.md` / README / 规格 / 本文件口径同步。

**顺带收掉的两条差距（同片内）**
- **G90**（帧/锁态缓存不过期）⇒ 给 `DeviceStateProbe` 的 per-key 结果加 **TTL**（默认 5s，实测一次 `screencap` ≈ 200ms、一次 `dumpsys window` ≈ 150ms，所以短 TTL 既省重复又不粘住转屏）；判据 = 时钟推进过 TTL 后必须重新问。
- **G89**（跨进程设备互斥）⇒ **裁定为已知边界并结案**：本分支的执行模型是「一个宿主进程内的一个插件实例」，per-device FIFO + breaker 在进程内生效；py 侧的文件锁服务的是「多个 python 入口抢同一台」那个场景，该场景随 py 栈在 D19 下不存在。**不做**（不为不存在的并发引入锁生命周期问题），解锁条件 = 真出现两个同时驱动同一设备的宿主进程。

**非目标**：不实现新的提供方客户端；不做镜像/UI slot（G93 的将来若要做，另立编号）；不动 OCR 的召回缺口（**G92** 单独一片）；不动 G88（overlay 维持「零消费者 ⇒ 待需求」）。

**How（关键决策）**
- **删代码的判据是「消费者为零」而不是「看起来旧」**：每条删除上面表里给 grep 实测；删完 `git grep` 被删符号必须零命中。
- **§一.3 的读法**：保留的是「能显式指向外部那一份」的**能力**，不是「一堆没人调的类」。所以 adapter 留下并接上诊断项 —— 否则终态第 3 条只是文字上成立。
- **preflight 不再替提供方说话**：提供方未配置**不是**环境问题（TS 原生路径不需要它），所以那几项从「失败」变成「不存在」，比「跳过」更诚实（跳过仍会让 `ok` 语义含混）。
- **覆盖面锁不许再依赖活服务**：夹具是历史事实，锁的是「我们的原生实现覆盖了当年那张名单」，可离线复跑。

**Verify（验收命令）**
- `pnpm --config.verify-deps-before-run=false run verify` 三段全绿（基线：T5 后 42 文件 / 470 通过 / 1 跳过）。
- `dsh --profile web --patch <abs>/cordis.patch.yml --dump-config` ⇒ exit 0 且 grep 不到 `unmatched`（R6；本片不动 patch，跑它是为了证明配置字段变化没把 preset 行打断）。
- `node scripts/check-env.mjs` exit 0；`node scripts/check-docs.mjs`（含 `--selftest`）exit 0。
- 删除面：`git grep -n -E 'ActionClient|actionClient|ScrcpyManager|scrcpy|ACTION_TO_PY_TOOL|uvPath|artemisRepoPath' -- plugins` **零命中**。
- 变异（R27，逐条证明会红后才当验收）：① preflight 少一项 / 多一项 ⇒ 项数锁红；② `provider.configured` 为真时不连接 ⇒ 诊断提供方锁红；③ 覆盖面锁删掉一个 py 名 ⇒ 红；④ TTL 归零（永不过期）⇒ G90 的锁红；⑤ 把 scrcpy 或 actionClient 的 import 塞回 `src/index.ts` ⇒ 删除面锁红。

**Done means**
- [x] T4-a：preflight 两项、配置面收窄、`contracts` 字段锁同步、变异 ① 红过
- [x] T4-b：actionClient 链消失、adapter 有真消费者、变异 ② 红过
- [x] T4-c：G93 结案（删除 + 记录），变异 ⑤ 红过
- [x] T4-d：覆盖面锁离线可跑（变异 ③ 红过）、G90 结案（变异 ④ 红过）、G89 结案为已知边界、D19/D20 五条自检读数入账、文档口径同步
- [x] **规格 §一 五条全部成立**（§一.3 的读法见下方收口记录），CHANGELOGS 新条目记 T4 与这条读法

#### T4 收口记录（2026-10-15）

**一片做完四件事**（原计划的 a/b/c/d 没有分次提交：它们改的是同一批文件、同一批锁，分开提只会让中间态不可构建）。

**1. 门只问两件真事**。`src/env/preflight.ts` 352→165 行：`uv` / `python` / `artemis-repo` / `artemis-installed` / `helper` 五项**删除而非跳过**，`PreflightScope` 与 `PreflightInput` 随之消失（`run()` 不再要参数）。理由：T2 之后没有任何工具走提供方，「没装 uv」不能成为拒绝一次原生层级读取的理由；而「跳过」会让 `ok` 在不同范围下含义不同。
**2. 按消费者计数删除**：`src/actionClient.ts`(87) / `src/mcpText.ts` / `scripts/{spike-mcp,mock-action-server,dump-proxy}.mjs` / `tests/{actionClient,clientHalf,mockServer}.spec.ts`，以及**镜像链** `src/scrcpy/{server,input}.ts`(333) + 5 个 `scrcpy*` 字段 + `tests/scrcpy.spec.ts`(225) —— 它在 `apply()` 里只被构造与销毁、**零工具驱动**，且 `scrcpyServerPath` 默认空 ⇒ 要操作者自备二进制；**全 docs 零提及**（搬迁-1 带过来后从未裁决）⇒ 新立 **G93** 再删，不留「看起来像功能」的死码。
**3. §一.3 的读法写死在这里**：保留的是「**能显式指向外部那一份**」的能力，不是「一堆没人调的类」。所以 adapter 不删，而是**第一次给它消费者** —— `autogamer_diagnose` 的 `provider{configured,command,reachable,error}`：`artemisMcpCommand` 默认从 `["python","-m","mcp_server"]` 改成 **`[]`**（空 ⇒ 永不 spawn，这才叫「不内置、不假设」），配了才 lazy 连一次问设备态，连不上只写一行建议并声明「插件自己的 adb 路线不需要它」；检查自己抛错也不炸诊断。
**4. 覆盖面锁不再依赖活服务**：`py-action-tools.json` 那份 2026-10-13 的活服务名单成为**历史权威**，锁的是分区 —— 11 条原生 adb + 2 条路由器本地答（`take_screenshot` / `get_ui_hierarchy`）+ 2 条带理由的放弃（`list_devices` T2-a、`compare_ui_frames` T3）= 15，一条不多不少；「原生」那 11 条**逐个打到 `runNativeAction` 上证明 case 真在**（空 payload ⇒ 命中各自的参数错误而非 `unsupported action`），并配**反向对照**（一个不在名单里的名字必须被判 unsupported）—— 没有对照的那条锁就是空的。

**G90 收**：`resolveScreenSize` 的 per-key 缓存加 `SCREEN_SIZE_TTL_MS = 5_000`（实测一次 `screencap` ≈200ms，一回合内复用足够，转屏最多粘 5 秒）。
⚠️ **这条的判据第一版是空的**：时钟跳量写成 `SCREEN_SIZE_TTL_MS + 1`，于是把 TTL 改成 `MAX_SAFE_INTEGER` 的变异 **N2 全绿**（跳量跟着变大，永远「未过期」）。改成**绝对秒数**（1s 内复用 / 6s 后重问）后 N2 才红 —— 与 T2-f 的 Q2/Q4、门禁 M1 是同一类错误：**判据必须被证明会红**（R27）。
**G89 结案为已知边界**：执行模型是「一个宿主进程内一个插件实例」，进程内 FIFO + breaker 生效；py 文件锁守的是「多个 python 入口抢同一台」那个场景，该场景随 py 栈在 D19 下不存在 ⇒ 不做（不为不存在的并发引入锁生命周期问题）。解锁条件写在 `enumerateRoster` 的注释里，与本行互为指针。

**读数（全部当轮实测）**
- `verify`：**38 文件 / 437 通过 / 0 跳过**（T5 后是 42/470+1 skip；文件与用例数同时下降 = 删掉的提供方/镜像锁比新增的多，别把它读成退步）。
- 变异 **N1–N10 全部落地**（`node scratch/mutate-t4.mjs` → `scratch/mutate-t4.txt`；忽略区脚本，可复跑性只由 spec 承担）：N1 门多问一项 / N2 缓存永不过期 / N3 完全不缓存 / N4 提供方检查炸诊断 / N5 未配置被判为故障 / N6 原生 case 丢失 / N7 unsupported 判据消失 / N8 提供方默认指回 python / N9 被删面被重新点名 / N10 被删配置字段复活。
- D19/D20 五条判据：`git ls-files '*.py'` = **0**；`git grep -l 'Google LLC' -- ':!docs'` = **空**；`'Apache License' -- ':!docs'` = **空**；`minitap -- ':!docs'` = **空**；`third_party/` 被跟踪文件 = **0**；`git remote -v` 只有 **origin**；根 `LICENSE` = 自撰 MIT（`Copyright (c) 2026 giveUphope`）；CI 配置 = **无**（本分支无 CI，故「CI 无 python job」以「无 CI」成立，不写成「由 CI 保证」）。
- 删除面：`git grep -E 'ActionClient|ScrcpyManager|scrcpy|ACTION_TO_PY_TOOL|uvPath|artemisRepoPath|mcpText|unwrapText' -- plugins` 只剩**注释与锁自身**（源码零引用），并由 `contracts.spec` 的「stay removed」一条把它钉住（N9 证明会红）。
- R6：`dsh --profile web --patch <abs>/cordis.patch.yml --dump-config` ⇒ **exit 0 / unmatched 0 / autogamer 行 16**（本片不动 patch，跑它是证明配置字段变化没打断 preset 行）。

**仍开着的**：`G94`（宿主内 live 证明 —— 本机阻塞在宿主的 spawn 路径空格缺陷上，见 §零「挂载面清点」）、`G91`（长按语义，与 G94 同批复测）、`G92`（OCR 召回）、`G88` / `G78`（待需求）。

### 交付-1 · packed bundle 交付验证（2026-10-15，B 项）

> 目的：此前全部 live 证据（#97 / G94）都建立在开发期 `link:` 形态上，而 D7 规定的真实交付形态（`install_bundle`）从未跑过。本片验证「packed 产物 → 面板安装 → 启用 → 面板资源」整条链路。

**What（范围）**
1. `pnpm pack` 出 tarball，按 `files` 白名单核验内容（这一步抓出 dist 陈旧产物缺陷 → **CHANGELOGS #101** 已修复）。
2. 用 web profile 侧边栏「添加插件」面板完成真实安装（非 `dsh plugin` 垫片——那是 `pnpm ls` 转发，R2 禁止在 profile 目录跑包管理）。
3. 安装后核验：组件运行态、双语 locale 渲染、icon、R6 组合树、OCR 数据落位。

**How（官方声明 + 实测路径）**
- 官方声明（`github.com/deepseek-ai/deepseek-harness` @ `master`，`packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md` 与 `references/host-plugin.md`，R20 第 1 步原文）：`install_bundle` 的 target 是「**absolute package directory**」；**本地目录安装就是 link checkout，`files` 不过滤链接目录**；「For a packed or published bundle, verify the actual packed file list」；替换已安装包需要**重启**（HMR 只对新装生效）；`approvedBuilds` 仅在用户明确批准 pending build scripts 后才传；安装判据读 `application` / `warnings`，安装后用面板核验 locale 与 icon，禁止「从安装成功推断视觉成功」。
- **路径一（失败实证）**：tarball 解压成独立精简目录 → 面板输入该目录 → 实际执行 `pnpm add <dir>`，结果 `dsh-autogamer link:<dir>` 且 **`Already up to date`、不装依赖**；精简目录无 `node_modules`，profile 的 `node_modules` 里 `tesseract.js` / `zod` / `@modelcontextprotocol/client` / `@deepseek-ai/schemastery` 全部缺失 → 启用报 `1 entry did not activate dsh-autogamer: failed to import`（组件 2 个中只有宿主自带的 preset 行运行中）。**结论：解压目录 link 不是有效交付形态；link 仅适用于自带 `node_modules` 的完整工程 checkout**（#97 的 live 证明正是这种）。
- **路径二（成立）**：面板直接输入 `.tgz` 路径（输入框文案为「包名、GitHub 仓库地址或本地目录路径」，实测接受 tarball）→ 执行 `pnpm add <file.tgz> --registry=…npmmirror.com`，识别为 `file:` **复制安装**，30 个依赖全部下载。唯一阻断点：`tesseract.js@7.0.0` 的 postinstall 被 pnpm 默认拦截，`ERR_PNPM_IGNORED_BUILDS` exit 1；由用户在面板点「允许这些脚本并重试」（**R19 user-only**，授权只存该 profile），随后输出仅为赞助横幅（`Thank you for using tesseract.js!` + opencollective 链接 + `Done`）——**基建-3「postinstall 无产物」裁决的第三来源实锤**（该裁决本体见 §七「基建-3」与 CHANGELOGS **#98**；⚠️ 本行原先写的 `G97` 是一个**在本分支与归档 registry 里都不存在的编号**，已按 R28 就地更正）。
- **替换安装需重启的实证**：第一次 link 版的启用记录仍指向旧 target（精简目录已被移除），file 版装好后报 `ENOENT scandir '…\extracted\dsh-autogamer\locale'`、两组件已停用；重启宿主后从 profile `node_modules` 正确解析，再启用即 **2/2 运行中**。
- 安装后读数：profile 安装位含完整 `dist` / `locale`（en 237B、zh 231B）/ `ocr`（eng 1,984,273B、chi_sim 1,730,011B，字节数与工程一致）/ `skills` / `client.js` / `cordis.patch.yml` / `THIRD_PARTY_NOTICES.md` / `icon.svg`；中文 UI 渲染「AutoGamer 设备执行」+中文描述、切英文渲染「AutoGamer Device」+英文描述（与两 locale JSON 逐字一致），icon 黑底放大镜渲染正常；R6 `dsh --profile web --dump-config` ⇒ **exit 0 / 1324 行 / unmatched 0 / autogamer 行 10**。

**Verify（验收）**
- [x] tarball 47 条目与 `files` 白名单一致，无 `src/` `tests/` `scripts/` `.d.ts` `pnpm-workspace.yaml` lock 等；修复后无陈旧模块（#101）。
- [x] 目录 link 安装在缺依赖时**实测失败**（`failed to import`），失败模式与官方「link checkout」声明吻合。
- [x] `.tgz` file 安装成功、依赖 30 个落位、build script 授权链完整记录、重启后 **2/2 运行中**。
- [x] 双 locale 标题/描述与 icon 渲染经浏览器实测；R6 声明面 exit 0 / unmatched 0。
- [ ] **C：三任务工具宿主内点名（阻塞）** —— 见下方阻塞记录。

**交付流程事实（写给下一次安装）**
1. 对外交付 = 发布 `.tgz`，在面板「添加插件」输入 `.tgz` 路径；**不要**解压后用目录 link（不装依赖）。
2. 每个新 profile 首次安装**必遇** `tesseract.js` build script 授权弹窗（R19 由用户点；脚本无产物，基建-3 / CHANGELOGS **#98** 与本次日志双证）；这是当前 bundle 无法自带跳过的固有授权点（`files` 不能携带 `pnpm-workspace.yaml` 的 `allowBuilds`，R2 禁止手写 profile 配置）。
3. 从旧版本（含 link 版）替换安装后**必须重启宿主**，否则启用记录指向旧 target / 旧模块代。

**阻塞（C 项，2026-10-15 实测）**：本机当前**无 `adb` 且无设备**——PATH 无 `adb`、`winget` 无 `Google.PlatformTools` 记录、无 Android SDK；无模拟器（`C:\Program Files\NetEase` 只有云音乐；D 盘已不在，当前仅 C 盘；5554/5555/16384 等模拟器端口无监听）。`preflight` 闸门要求 `adb` + `adb-devices` 两项（`src/env/preflight.ts`，所有 autogamer_* 工具含 `run_task` 都过 `requireEnv`），故三任务工具 live 点名在设备到位前无法进行。需要用户提供其一：① 安装 Platform Tools 并开启安卓真机无线调试 / USB 连接；② 安装并启动模拟器。离线锁（`runTask` 7 条、`manageTask` 10 条、`inspectTrace` 9 条 + `taskProjection` 9 条）与 #97 的 5 条宿主实跑证据不受影响。

> ⚠️ **2026-10-15 补测：本段「需要用户提供其一」的措辞会误导——本机硬件完全支持模拟器，缺的是安装，不是能力。**
> 实测：① **虚拟化已启用**（`systeminfo`：「要求虚拟化方面的 Hyper-V = 已启用」「固件中已启用虚拟化 = 是」「虚拟机监控程序模式扩展 = 是」；
> `Get-ComputerInfo.HyperVisorPresent = True`）② RAM **32 GB**、C 盘空闲 **712 GB** ③ `winget` 里 `Google.PlatformTools`（37.0.1）与
> `Google.AndroidStudio`（2026.2.1.8）均可安装。
> ⇒ 解锁路径是**装东西**（属 R19 授权面 + 数 GB 下载），不是买设备；成本最低的一条是「Platform Tools（~10 MB）＋ 用户自己的手机开无线调试」。
>
> ⚠️ **本轮踩到一条读数陷阱，留着当 R25 的样本**：`Get-CimInstance Win32_Processor` 报
> `VirtualizationFirmwareEnabled = False` / `SLAT = False` / `VMMonitorModeExtensions = False`，
> **据此会得出「本机跑不了任何模拟器」的结论** —— **那是错的**。该属性在**已有 hypervisor 接管**时按设计返回 False
> （本机 `HyperVisorPresent = True` 即是证据）。**可靠来源是 `systeminfo` 与 `Get-ComputerInfo`**，两者一致。
> 这与本分支已记的「一串错误串只能证明那次失败发生、不能证明因果」是同一条（R25）—— 若照第一个读数作答，
> 会让用户以为必须买设备或租云农场，而事实是本机装一下就能跑。

### G92 · OCR 按区域识别（方案 2026-10-15 立项；探针 A 已完成，B/C 待设备）

> 2026-10-15 立项只立方案（R22）。探针 A（离线机制）于 2026-10-15 完成并跑通真模型，收口记录见条末；真机数据仍引自 T5，不复测。

**背景（T5 已实测，数字不再重跑）**
- 真机桌面帧（1600×900，`emulator-5554`）24 个带文字节点，整帧 OCR 与层级同时认出的只有 **0–3/24**；整帧最近邻放大 1×/1.5×/2×/3× ⇒ **0/1/3/0** 命中（3× 还贵 70%）；同一屏把「游戏中心」所在 **140×70 块裁出 @2×** ⇒ 正确读出「游戏 中 心」。结论：瓶颈是 **tesseract 的整页版面分析**（像素够，混排下小块不被当文字行），不是放大常量。

**核心设计矛盾（本条必须先回答的问题）**
- OCR 的消费点是「**层级未命中**」。若「按区域」的候选框只来自层级 bounds，它恰好覆盖不到层级完全缺席的场景（webview 渲染区、游戏画布、SurfaceView、艺术字图标）——而那才是真正需要 OCR 的地方。所以候选源必须分层，并由探针裁决去留：
  - **P1 层级 bounds 候选**：取叶子节点（`text` 为空但有 `content-desc` / 可点击 / 画面有字的容器）的 bounds，扩边后逐块 OCR。覆盖「层级有结构无文本」（图标标签、自定义控件）。
  - **P2 版面投影分割**（不依赖层级）：解码 RGBA（复用 `src/effect/png.ts`）→ 灰度/二值化（复用现有模糊/阈值原语）→ 水平投影找文字行带 → 垂直投影切行块。覆盖层级缺席场景；是本片**主要新算法风险**。
  - **P3 规则网格兜底**：屏幕切 N×M（带重叠步长），P2 的工程兜底，最简单、召回靠运气。
  - **P4 模型视觉定位**：现状不动，作为最终 fallback。

**What（范围）**
1. 新增纯 TS 图像小工具：PNG **裁剪**、**最近邻放大**、**PNG 编码**。仓内现只有 PNG 解码（`src/effect/png.ts`）；编码用 `node:zlib` deflate + 手写 chunk，**零依赖**（延续 T5 否掉 `sharp`/`pngjs` 的口径）。
2. 新增 `src/ocr/regions.ts`：候选裁剪（bounds + 扩边 padding）→ 逐块 `recognize`（复用单例 worker）→ 块内 bbox 映射回全屏（加偏移、除放大倍数）→ 合并进现有 `OcrPage`/hits，复用 `findNeedleHits` / `matchWindow` / 置信门槛 / 歧义不猜。
3. 阶梯接线：**整帧 OCR（现状）未命中 → 按区域 OCR（P1；P2/P3 视探针）→ 模型视觉（现状）**。区域识别是第二级，不默认跑；fail-open、`target_source` 区分、安全语义不变。
4. 诚实边界：纯画布且 P2 也切不出文字行的（游戏内艺术字）维持 P4，不承诺。

**How（关键决策）**
- needle 文本无法预筛块（识别前不知道块里是什么）⇒ 按区域必须**全扫候选块再内存匹配**，成本与候选数线性；必须设候选数上限与超时（R15 自实现、观测取消信号），常量由探针量。
- 放大倍数与 padding 由探针定，不写死；唯一已有数据点：140×70 @2× 成功。
- 坐标映射：`x_full = x_block / scale + left − padding`（符号在探针 A 用合成图钉死）；裁剪与放大必须和层级 dump 同处**旋转后帧空间**（夹具证明 `uiautomator` bounds 已是帧空间，见 `hierarchy-chrome.xml` 头注释）。
- 候选去重：bounds 大量重叠（根节点全屏），只取叶子节点与面积阈值内的框，避免全屏块与图标块重复识别。
- P2 不硬推：探针 B/C 若证明它在真机上切不出行，本条降级为 P1+P3 并重写范围，不允许带失败算法落地。

**Verify（探针，一次一个变量，R25）**
- **探针 A（离线，现有夹具，机制正确性）**：`screen-chrome-tab-overview.png` + `hierarchy-chrome.xml`（45 节点，bounds 为帧空间）跑 P1：① 裁剪/放大/重编码用合成图做像素级断言；② 逐块结果经坐标映射回全屏后落点不漂（**实测口径见条末收口：P1 候选不覆盖 y≈240 渲染区，故该帧 `TapTap`/`游戏中心` 经 P1 为 undefined——这不是管线缺陷，而是「核心设计矛盾」的离线实证；映射正确性改由「每个命中都落回其候选框内」锁死**）；③ 全屏根节点等候选被过滤。**该帧整帧本就能读，不证召回增益，只证管线**。
- **探针 B（真机，召回增益，需设备）**：重采 T5 桌面难帧 + 同屏 `uiautomator dump`，对 整帧 / P1 / P3 报 24 个文字节点的命中数与总耗时；扫描 padding {0,8,16,24}、scale {1.5,2,3} 与候选过滤规则，定常量。
- **探针 C（真机，无层级场景，需设备）**：采一帧 webview 网页或游戏画面（层级仅一个渲染容器、无文本节点），判 P2 能否切出文字行并读出；这是 G92 真正的目标场景，P2 失败即触发降级。
- （可选）合成难帧：把已知文字缩小/降对比度/贴进混排背景，离线复现「整帧失败、裁剪成功」，只作机制回归，**不替代真机召回数字**。
- 单测锁与变异（R27）：裁剪/放大/编码像素级锁、坐标映射锁、候选过滤锁、阶梯锁（整帧命中不调区域 / 区域命中不回落模型 / 区域失败不阻断动作）；变异：① 映射丢偏移 ⇒ 落点锁红；② 区域永远跑 ⇒ 阶梯锁红；③ 区域失败改抛错 ⇒ fail-open 锁红；④ 候选过滤放行根节点 ⇒ 去重锁红。
- `verify` 全绿、`check-docs`（含 `--selftest`）与 `check-env` exit 0。

**Done means（探针 A 已勾，B/C 与接线待设备/待真机）**
- [x] PNG 裁剪/最近邻放大/编码零依赖落地，像素级锁（`src/ocr/image.ts`，`tests/ocrImage.spec.ts` 10 条）
- [x] `regions.ts` 管线 + 坐标映射 + 候选过滤落地（`src/ocr/regions.ts`，`tests/ocrRegions.spec.ts` 14 条）
- [x] 探针 A 离线绿（真模型夹具 2 条：映射不漂、P1 边界固化，见收口记录）
- [ ] 探针 B 真机召回数字入账（P1/P3 vs 整帧），padding/scale/候选常量定
- [ ] 探针 C 判定 P2 去留：落地或明确降级为 P1+P3
- [ ] 阶梯接线 + 消费路径锁 + 四条变异各红一次（① 映射丢偏移、③ 区域失败改抛错、④ 容器过滤放行根节点 已各红一次；**② 阶梯锁本轮不适用**——探针 A 不接产品阶梯，留待接线）
- [ ] 真机端到端：层级未命中的标签经区域 OCR 命中并点对
- [ ] G92 结案（或按探针结论重写范围，R28）

**非目标**：不引入 `sharp`/`pngjs`/OpenCV 类图像依赖；不做整页排版还原/阅读顺序；不改整帧 OCR 的安全语义；不动 G88（overlay 仍待需求）；不承诺纯画布艺术字场景。

**阻塞**：探针 B/C 与「交付-1」C 项共用同一设备前置（adb + 一台 `device` 状态设备）；探针 A 可离线先行，不等设备。

**探针 A 收口记录（2026-10-15，离线真模型）**

- **落地**：`src/ocr/image.ts`（`cropImage` 行拷贝裁剪 / `upscaleNearest` 支持分数倍、rounded reverse mapping / `encodePng` depth-8 color-type-2 RGB、filter None、`deflateSync`、手写 CRC32 表；`clipBox`/`paddedBox`；解码复用 `src/effect/png.ts`）与 `src/ocr/regions.ts`（`selectRegionCandidates` / `mapHitToFrame` / `recognizeRegions`，导出 `DEFAULT_REGION_OPTIONS`）。
- **默认常量（探针 B 待真机重定）**：paddingPx 8、scale 2、maxAreaRatio 0.25（剔除近全屏容器）、maxRegions 40、totalBudgetMs 30000（墙钟预算，R15 自实现 + 观测 `AbortSignal`）；候选按面积升序、小框先扫，去重同 bounds、丢弃完全包含其他候选的容器；单块 `recognize` 返回 undefined **或抛错**都跳过（fail-open）。
- **夹具真模型实测（`tests/ocrRegionProbe.spec.ts`，2 条真模型锁）**：
  - 候选过滤后 **16 个叶级框，全部落在 y≤204**（顶部标签栏、工具栏、omnibox、状态栏）；`TapTap`/`游戏中心` 所在 **y≈240 缩略图渲染区在层级里只有全屏容器**（`compositor_view_holder` / 网页视图 / NAF clickable view 均为 `[0,31][1600,900]` 级，被面积比/容器规则剔除）。
  - **16 块全扫描 ≈1457ms，整帧 1666ms（94 hits）**；区域扫描在这帧不比整帧贵，且成本与候选数线性。
  - **坐标映射端到端锁**：每个区域命中的全屏坐标都落在产出它的候选框（含 padding）内，无漂移（例：状态栏框 `[0,0][1600,31]` 内读出 `03:27`→[8,9][49,20]；omnibox 框内命中 y∈[145,162]）。
  - **对预期②的修正（R28，不静默保留）**：原方案设想「逐块映射回全屏后 TapTap/游戏中心仍命中」，**实测 P1 对二者均为 undefined**——不是管线错误，而是该帧能读的目标恰在层级缺席的渲染区。这正是「核心设计矛盾」的离线实证：**P1 只覆盖「层级有结构无文本」，对纯渲染区无能为力**；它强化了 P2/P3（投影分割/网格）的必要性，而不是证明 P1 足够。测试据此固化为「P1 边界 + 整帧对照」双断言（P1 undefined、整帧命中 (1206,241)/(1003,240)），不照搬旧坐标写死成功。
- **变异（R27，三处植入均精确锁红，已还原）**：① `mapHitToFrame` 去掉 origin 偏移 ⇒ 3 条坐标映射锁红（含嵌套 words、端到端）；③ 单块 catch 内 `continue` 改抛错 ⇒ 「单块抛错仍扫描其余」红；④ 容器过滤改为放行全部 ⇒ 「丢弃包含候选的容器」红（容器框 `[10,10,200,200]` 漏入）。变异②（阶梯锁）本轮不适用，待接线。
- **门禁**：`verify` **42 文件 / 466 测试全过**（探针 A 新增 3 文件 26 条：image 10 + regions 14 + probe 2；基线 39/440）；`check-docs --selftest` 7 变异无假绿；`check-env` 干净；README Layout 已同步 `image.ts`/`regions.ts`。
- **对 B/C 的输入**：P1 工程面已就绪，唯一未答的是「层级缺席渲染区」的召回——那是探针 B（真机难帧重采、扫 padding/scale/过滤常量）与探针 C（纯 webview 帧判 P2 去留）的范围，均需 adb + 设备。本轮**未接产品阶梯**（`runDeviceAction.ts` 的 hierarchy→整帧 OCR 阶梯未动），接线属探针 B/C 后的 Done 项。

### 文档对齐-1 · 全仓文档面对齐当前实现（2026-10-15 结案；CHANGELOGS #103）

> 性质：**纯文档轮**，不改任何代码。起因是读文档时发现多处「文档说的」与「代码/实测的」已经分叉，而本分支的纪律
> 要求文档是下一个 agent 的唯一现状来源（R28）。分七面逐条核，每条改动都带可复核出处；**不新建编号**，
> 因为这不是一个待办条目，而是一次对齐动作。

**What（范围）** —— 七个文档面：`AGENTS.md`、根 `README.md`、插件 `README.md`、规格 `docs/migration/ts-fullstack-spec.md`、
守则 `docs/migration/plugin-contract-rules.md`、台账 `docs/TODO.md`、变更史 `docs/CHANGELOGS.md`。

**How（做法与关键决策）**

1. **先立判据再动笔**：每条漂移都要有一条「能复跑的核验」（`git grep` 命中数 / 读源码的导出与默认值 / 跑一次门禁），
   拿不出核验的**不算漂移、不改**。本轮每条改动都配了核验，清单在 CHANGELOGS #103 的验收段。
2. **三类漂移分开处置**（不混成一句「更新了一下」）：
   - **① 指向已删/已结案对象**：就地改成现状 + 指针（规格三行的 G91/G94、`artemisRepoPath`、守则 R15/R19）；
   - **② 与实测相反的旧表述**：就地更正并写明「原先那句被什么否证」（规格 §四.1 的「扁平」、`G97` 那个不存在的编号）；
   - **③ 缺失的操作事实**：补上但不复制（`verify` 的真实形状、`clean-dist`、交付形态、`ocr-probe.mjs` 指针）。
3. **单一权威不被破坏**：派生的读数一个都不新增；§四 开放差距表**不动**（本轮不结清任何 `G*`）；
   同一事实只在一处展开，别处一律写指针（例如 `verify` 的形状写进 `AGENTS.md`，`TODO.md` §零只留指针）。
4. **不越权**：本轮**不碰代码**。凡「文档说的」要改代码才成立（如区域 OCR 未接线），写成**边界声明**而不是实现任务。

**Verify（验收命令）**

- `node scripts/check-docs.mjs` 与 `node scripts/check-docs.mjs --selftest` ⇒ exit 0（本轮改了表格行与多段散文，
  C5 表格成形 / C2 链接可解析 / C3 派生计数 / C6 完成度对账都会被牵动，必须全跑）。
- `node scripts/check-env.mjs` ⇒ exit 0（本轮不产生 py）。
- `pnpm --config.verify-deps-before-run=false run verify`（在 `plugins/dsh-autogamer/`）⇒ **42 文件 / 466 通过**，
  与对齐前同读数 —— 证明**只动了文档**；其中 `readmeLayout.spec` 会机械核对插件 README 的 Layout 块与 `src/` 实际文件。
- 悬空编号自查：`git grep -nE "[G]97 第三源实锤|[G]97 与本次日志双证|[G]97「postinstall 无产物」裁决" -- docs AGENTS.md README.md` ⇒ **零命中**（对齐前 3 处活引用）。
  模式写成字符类是刻意的：**零命中型判据不能把自己写进被搜文件里**，否则它在 docs 里就会命中自己而永远红不了（R27 的老坑，本轮第一次写成裸串就踩了）。
  `G97` 这个串现在只剩**记录这次删除**的行（§七 交付-1 的就地标注、本条目、CHANGELOGS #103）——判据只钉「不再当活引用」，不是「文档里不许出现这个串」。

**Done means**

- [x] 规格（§一.1 / §一.3 / §二 四行 / §四.1 与 §四.4）对齐：已结案的 `G91`/`G94` 不再挂在行上、已删配置项不再被当活路径、
      被前置-1 否证的「扁平」表述就地更正
- [x] 守则四条判据（R2 / R15 / R19 / R21）指向的对象与本分支现状一致（删掉的、未随迁的都改成现状 + 落点）
- [x] 插件 README 的 Layout 描述、脚本清单、`verify` 形状与「两个 `src/ocr/` 模块无生产消费者」这条边界写清
- [x] `AGENTS.md`（CHANGELOGS 已存在、T1–T5、门禁脚本形状、`ocr-probe` 与交付指针）与根 `README.md`（现状不再写「从零重建中」）
- [x] 悬空编号 `G97` 的**活引用**清零并按 R28 就地标注更正理由；`verify` 读数不变（纯文档轮）；门禁三条命令全 exit 0
