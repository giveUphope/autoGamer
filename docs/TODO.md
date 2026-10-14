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
- **基建-2 已落地（2026-10-14，提交 `f9434cf`）**：`scripts/check-docs.mjs` 六条检查（结清一致性 / 链接可解析 / 派生计数只认权威 / 编号范围自算 /
  表格成形 / 自称完成不得留未勾验收项）+ 内置 `--selftest` 变异（7 例，含 C5 的合法 `\|` 反向例，全不盲）+
  版本化 `.githooks/pre-commit`（**仅文档暂存时**触发；A/B 实测：带漂移提交被拒 `exit 1`，`--no-verify` 才通过）。
  **手工变异**一次五处并行（C2–C6）→ 恰好 5 条 finding、各对应一条检查；C1 另单独变异一次（注入 G81 行 → 1 条、指向正确行）。
  `AGENTS.md` 的「**文档门禁暂缺**」已改写为现状——门禁是**本地钩子 + 手跑**，本分支无 CI，**不许写成「由 CI 保证」**（R27）。
  ⚠️ 已知盲区（本轮实测）：门禁**抓不住**「§零 状态行说未开工、而跟踪行已勾完成」这类**同一事实的两处状态不一致**（它就是本行上一版的样子）；**也不查 §四 表内编号唯一性**——已实测：把 §四 一行的编号重复一次，门禁仍 `OK` / exit 0，撤掉后照旧，所以这是**真的会漏**的判据缺口。要覆盖这两类须各加一条检查，属后续项。
  （自我更正一笔：这句初稿引的是「我改 G76 时造出重复行、门禁全绿」——但那次我**并没有在重复行还在的时候跑过门禁**，属自己反对过的未证 claims；已改成上面这种实测过的口径。）
  范围与取证见 §七「基建-2」。
- **rules-1 已落地（2026-10-14，提交 `01de3b2`）**：`rulesInjector` 整链拆除（模块 / `injectRules` 配置 / 诊断项 / 5+2+2+1 条相关锁 / 夹具 / README Layout），
  `systemPrompt` 缝（手镜像 + `inject` 条目 + Tier-1 断言）随链消失；**引导图保留 `dsh-system-prompt`**（agent loop 经它解析，删了会挂载失败——五条 mount 测试变红即证）。
  插件树内 `rulesInjector|injectRules|rulesFilePath|mcp_server/rules` **零命中**；R27 变异（`injectRules` 塞回 schema ⇒ contracts 字段锁红）已闭环。
  规则文本由 persona（常驻）+ skill（按需）承载；不迁移记录见 **CHANGELOGS #84**。
- **T3 第一片已落地（2026-10-14，提交 `00106f8`）**：`compareFrames` 改为 **TS 原生差分** —— `src/effect/png.ts`（最小解码：depth 8 / colorType 2·6 / 非隔行，其余抛错）+ `src/effect/diff.ts`（双管线 + 遮罩 + ROI 回落 + 分支表，常量各带前置-3 出处）。
  验证：判别用例 7 条（前置-3 的 5 条 + 我补的 2 条判别性用例）+ 失败方向 + 解码器，**三处变异各红一次**；另有真实帧冒烟（1600×900 RGBA）**同帧自比全 false**、跨帧检出——但那是**本机一次性探针，未入库**（`scratch/` 是忽略区，真帧也不在仓库里）；**已入库的锁只有那 7 条 spec + 三处变异**，别把冒烟当可复跑判据。
  ⚠️ **与 py 的同输入同输出对照在本机做不了**（仓内无 py、无解释器，provider 未配置）⇒ 列**延迟项**（🔶 不勾）。见 §七「T3 · 效果差分 TS 化」。
- **OCR 判为推迟（2026-10-14，新立 G87）**：T3 收尾查「OCR 这片做不做」——**本分支零消费者**（插件树 grep 零命中；动作面 15 工具无 OCR；上游的 OCR 只服务 py 智能栈感知层，而那套按 D8 不迁移）。
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
- **顺带查出门禁自己盲了一条（2026-10-15，R28 当轮回写）**：`check-docs --selftest` 的 **M1-C1 在 HEAD 上就已 BLIND** —— 它的锚点是 §四 G78 那一行的**字面文字**，
  而那行在 前置-2 改写后措辞变了，变异不再落地（其余六条当时仍绿，所以没人看见）。已把锚点改成**结构定位**（§四 表头分隔行后插行），`--selftest` 现 7 例全落地。
  这条不是新问题而是**同类错误的复发**：变异用例的锚点用散文，散文一漂移判据就静默失效 —— 与 §五「测试用词不许当判据」是同一条纪律。
  仍存的同类风险：M2/M3/M4/M7 的锚点也是字面文字，将来改措辞同样会盲；把「selftest 落地数」纳入 pre-commit 是 T4 的候选（本条只记录，不擅自动门禁范围）。
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
| G89 | 跨进程设备互斥缺失：原生 roster 只能报 `isBusy:false`，py 的文件锁（多进程同抢一台）无替代 | **T2-a 新立**（不静默：`enumerateRoster` 的注释与本行互为指针；单进程内的闸门/熔断仍生效，跨进程才失守） |
| G90 | 帧尺寸与锁态按 key 缓存且不过期 ⇒ 会话中途转屏后停在旧帧上（缓存早于本片存在，非本片引入） | **T2-a 新立**（G76 结案后剩下的那一半；判据需真机转屏，属挂载期动作 🔶） |
| G91 | `long_press` 的**长按语义未在真机上证实**：零距离 swipe 与 `motionevent DOWN/UP` 都 code=0 无报错，但对照组（普通 tap）与它们反应完全一致 ⇒ 那次实验**不成立**，不是阴性结果 | **T2-c/d/e 新立**（实现取「零距离 swipe + duration」这一标准形态；判据需一个有长按菜单且对照组可区分的目标，属挂载期复测 🔶） |
| G78 | `adb forward` 生命周期归属未定 —— **随 helper 路线不采用而退出 T2 前置**（口径是「不需要设计」，不是「已解决」） | 待需求（复刻 helper 时重查，见 §七「前置-2」） |
| G82 | py 引擎仍被 `run_task` / `manage_task` / `inspect_trace` 消费 → 须由 S11 路由器替代 | **T1** |
| G83 | 15 工具动作面是 py-only → 须 TS 原生实现并与现面逐条对照 | **T2** |
| G84 | 效果判定 `compare_ui_frames` / OCR / overlay 是 py-only → 须 TS 化 | **T3**（差分已 TS 化；OCR / overlay 判为推迟 ⇒ G87 / G88；与 py 的对照表仍缺 🔶） |
| G85 | py 归零收尾：删 py 树、清 CI 与依赖、更新文档口径 | **T4** |
| G86 | 溯源清理：copyright 头、vendored 第三方、派生文档、致谢文案、git 元数据 | **T4**（约束贯穿 T1–T3） |
| G87 | OCR 备用元素源（画布类 UI 的文字发现）—— ~~本分支无消费者，判为推迟~~ **2026-10-15 反转为内置**（用户裁定：零配置可用）⇒ 见 §七「T5 · OCR 内置」 | **T5**（设计事实见 §七「前置-5」） |
| G88 | 画面标注 overlay（在截图上画元素框与标签）——**本分支无消费者，判为推迟**；清点与解锁条件见 §七「前置-6」 | 待需求（不在 T1–T4 排期内） |

> G72（提供方形状）与 G74（映射层按旧 5 工具面锁形状）**不在本分支跟踪**：它们随 T4 消解。
> **G81（插件 spec 从未被类型检查）已于 2026-10-14 结清**，权威记录在下方「新分支特有」的 G81 行与其量化小节，故不再列进开放差距表。
> 顺带更正本行原先写着的「实测 144 条错误」：它与量化小节的基线 **124** 是同一件事的两个数，且 144 无从复核——结清后只保留 124 那一份读数（R28：一个派生事实只留一个权威）。

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
| **互斥**（决定选型的一条） | Android 在 UiAutomation 连接存活期间**解绑所有 accessibility 服务** ⇒ **helper 与 uiautomator 天生互斥**，旧实现的做法是发现 uia2 服务器占着就把它停掉（Appium 的从不动，只在错误里点名） |

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

**推迟的解锁条件（G87）**：出现真实消费者（例如层级为空的画布界面反复失败）⇒ 另立实现条目，形态按已取证的事实落：
`fetch` 直译（零依赖）、密钥走我们自己的配置项（不复活 `.env` 约定）、**未配置即返回空而非报错**、跳过整图合并文本、XML 优先的融合与上面那三条质量过滤——并给每条常量带出处。

**Done means**
- [x] 消费者清点（grep + 动作面夹具）为 0
- [x] 设计事实七面取齐且各带函数/常量名出处
- [x] 判定与解锁条件落账，新立 **G87**；规格 §二 该行改「推迟」
- [x] 结案记录进 CHANGELOGS #87（放弃/推迟记录是规格 §一.4 要求的落点）

### T5 · OCR 内置（**G87 反转**；方案，2026-10-15 立项，R22）

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
- [ ] `src/ocr/recognize.ts` + 配置项 + 诊断项落地；包内 `ocr/` 双语语言包在位
- [ ] 消费点接线：层级未命中才 OCR，`target_source` 进 `presentationMeta`（折叠侧自然继承）
- [ ] 版本化探针可离线复跑且证明无网络；三条变异各红一次
- [ ] `THIRD_PARTY_NOTICES.md` 登记语言数据来源与许可，并加进 `files`
- [ ] 台账/规格同步：G87 结案、规格 §二 OCR 行改「内置（离线 WASM）」、CHANGELOGS 新条目记这条**反转**（不重写 #87，编号永不复用）

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

**范围外**：helper APK 的 TS 复刻（D13 二期，另立）；OCR / overlay（G87 / G88 已推迟）；删除 provider 适配层本身（§一.3 保留为可选外部提供方，T4 定夺）。

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
- [ ] `run_device_action` 全链在 TS 侧跑通一次真机（🔶 挂载需用户放行，未放行前不勾）
- [x] **Done（前半）：`artemis mcp --type adb` 不再是任何路径的运行时依赖** —— T2-c/d/e 清零动作面直呼、T2-f 拆掉最后一个 provider 消费者（diagnose），`ActionClient` 与 `src/artemis/` **均无工具消费者**（模块删除与配置面收窄归 T4）
- [ ] **Done（后半）：15 工具全在 TS 侧「可跑」的真机证明** —— 离线面全部有锁（425 通过），但「挂进宿主后一次跑完」仍待用户放行（🔶 R7 / R9 / R24）

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

- [ ] 动作工具面 TS 原生实现（adb CLI + `uiautomator dump`；**不含** helper 协议客户端）
- [ ] 与旧实现逐条对照：同一输入同一输出 —— **本机做不了**（无 py 运行时、provider 未装）⇒ 替代证据是字符串契约锁 + 设备实测形状；本条留开 🔶，不许以「都能跑」代勾
- [ ] 坐标 / 层级 / 截图三条金标准复测（坐标含 G76 的 `screenSize` 校验；层级含 XML→节点；截图含 IHDR 与效果差分的同源）
- [ ] **Done：不再依赖任何 py 动作面**

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
- [ ] 🔶 与 py/provider 的同输入同输出对照表 —— **阻塞于 py 运行时/provider 环境，本项不勾**
- [x] 台账同步：G84 行标「部分（差分已 TS 化）」，规格 §二 该行状态更新（只写指针）

### T3 · 图像与 OCR TS 化（**G84**）

- [x] 效果差分落 TS（算法与阈值从旧实现读设计）—— **已落地**（提交 `00106f8`；判别用例 + 三处变异 + 真帧冒烟，见上方「T3 · 效果差分 TS 化」的 Done；对照表 🔶 延迟）
- [x] OCR 改 HTTP 直译 —— **本条已从 T3 撤销**：2026-10-14 判「零消费者 ⇒ 推迟（G87）」，2026-10-15 被用户裁定推翻并**换成离线内置形态**，工作移入 **T5**（方案与可行性实测见 §七「T5 · OCR 内置」）。T3 不再欠这条，也不欠任何 py 依赖
- [x] overlay 标注改 TS 图像库 —— **判定不做，改立推迟项 G88**（零消费者；清点与解锁条件见 §七「前置-6」）
- [ ] 对照表留档（同输入同输出）—— **本机做不了**（无 py 运行时 / provider 未配置）：效果判定的替代证据见 §七「T3 · 效果差分 TS 化」，此条留开（🔶）
- [x] **Done：效果判定与 OCR 无 py 依赖** —— 判定为**成立**：差分已 TS 原生（`00106f8`，插件不再调 `compare_ui_frames`，contracts 直呼清单与「零 py 调用」锁双证）；OCR / overlay 均**零消费者 ⇒ 不存在依赖**（G87/G88 推迟）。
      ⚠️ 这条 Done 成立**不等于**上面那条对照表完成——Done 说的是「无 py 依赖」。**可复跑判据是锁不是 grep**：`tests/conformance/contracts.spec.ts` 的直呼清单（只匹配 `client.callTool("…")` / `callTransport(client, "…")` 两种调用形状，已不含 `compare_ui_frames`）+ `apply.spec` 的「不再问动作服务器」锁。
      （这里原本我写成「`grep -rn compare_ui_frames src` 为空」——**那条判据是错的**：src 里现有 2 处命中全是注释与说明文字，裸 grep 会把无害散文判红。判据必须只认调用形状，已按此改正。）

### T4 · 收尾与溯源清理（**G85** + **G86**）

- [ ] **按前置-4 结论收窄配置面**（**G85+G86 交叉，不可当小事放过去**）：
      删 `artemisRepoPath` 的 cwd / `pyproject.toml` 探测 / `uv project` 三种 py 语义与 `uvPath`；
      `artemisMcpCommand` 保留但写明「不内置、不 vendored、不为其开开发依赖」；
      ~~rules 注入必须改指向我们自己拥有的来源（插件内固定文本，或我们自己定义的外部文件项）~~ —— **已提前完成（rules-1，CHANGELOGS #84）**：
      整链拆除，规则文本由 persona + skill 承载，不再读 `<外部仓库>/mcp_server/rules.md`（D20：上游 prompt 正文不得进本项目模型面）
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
