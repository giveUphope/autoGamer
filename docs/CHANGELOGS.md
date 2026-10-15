# autoGamer 变更历史（CHANGELOGS）

> 只记**已经发生并结案**的变更：每条是一个 `### #N` 条目，含「问题描述 / 整改方案与实施 / 验收标准」三段。
> 在办事项、差距与方案在 [`TODO.md`](TODO.md)，不写在这里。
> **编号一经发布不得改写**：本分支从 **#84** 起续号（归档分支 `legacy-fork-v2-dsh-plugin` 的 CHANGELOGS 用到 #83）——
> 继续编号而不是从 #1 重开，是为了让「某个 #N 指某件事」在整仓历史里唯一，避免新旧两套编号同名不同事。
> 本文件建立**之前**已结清的事项（搬迁-1、基建-1、G81、前置-3、前置-4、基建-2）不在此追记：它们的记录在 `TODO.md` §七 各自条目，这里只留指针。

## 索引

| 分类 | 条目 | 范围 |
|---|---|---|
| 一 · 插件边界与溯源 | #84, #85 | 外部来源的切断（rules 链拆除）与被判定不迁移能力的放弃记录（录屏/视频分析）。 |
| 二 · 能力迁移（T1–T4） | #86, #87, #88, #89, #90, #91, #92, #93, #94, #96, #97, #102 | 判定与执行从 py 面收回到 TS 侧：效果判定差分（T3 第一片 / G84）、设备面本地化（T2-a / G75·G76 结清）、层级读取本地化（T2-b）、12 条动作与截图本地化（T2-c/d/e）、诊断本地化与提供方清点（T2-f）；两条**推迟判定**（OCR / G87 后被 T5 反转、画面标注 overlay / G88）；OCR 内置离线 WASM 与那条推迟的**反转结案**（T5 / G87 结清、召回缺口新立 G92）；T4 收尾（门收成两项、按消费者计数删除动作面客户端与镜像链、adapter 首次获得消费者、G82/83/84/85/86/89/90/93 八条结案、`notes/plan` 放弃记录）；以及 #93 交付后测出的一条崩溃路径修复（不可读帧先验再交给 worker，#96）。 宿主内 live 证明（R6/R7/R9/R24 四条读数齐）与 G91 长按语义复测结案，含一条一直报假的取证判据被修好（#97）。 G92 区域 OCR 的离线管线（探针 A：裁剪/放大/编码 + 候选逐块识别 + 坐标映射）落地，真模型实测同时固化了 P1 对纯渲染区无效的边界（#102）。 |
| 三 · 门禁与基建 | #95, #98, #99, #100, #101, #103, #104, #105 | 文档门禁自身的可信度：变异锚点一律落到文档结构上，`--selftest` 进 `pre-commit`（两次 BLIND 的复发记录）；依赖安装策略定案：`tesseract.js` 的 `postinstall` 明写 `allowBuilds: false`，安装不再非零退出、不再改写被跟踪的 `pnpm-workspace.yaml`（#98）；包管理器版本钉死 `packageManager` + `pmOnFail: error`，版本不符一律 exit 1，把「不同机器结论不同」变成「响」（#99）；`autoInstallPeers` 搬进设置真正被读的那份文件并删掉哑掉的 `.npmrc`，裸 `pnpm install --frozen-lockfile` 从 exit 1 复绿（#100）；构建前清空 `dist` 并加陈旧产物守卫，消除 tsc 增量输出把已删除模块打进交付 tarball 的洞（#101，packed 交付验证发现）；一次纯文档的全面对齐，各处漂移各带一条核验清掉，其中一处是**指向不存在编号**的悬空引用（#103）；补第七条检查 C7「§四 编号唯一性」并把另一条盲区**判定为不写**（当前零样本，写了就是永不红的假判据，#104）；守则自身两条时效校正——R11 版本门禁已过期（上游发了 alpha.3，而门禁里没有一条检查查版本）、待补清单里一条凭印象写的路径实测 404（#105）；读完上游五份未读文档并回写，顺带推翻 #103 刚写下的「包装层未接」（#106）；恢复 `client.js` 的浏览器半边锁，一次 T4 混称导致的连坐删除，六条断言原样复绿（#107）；G92 合成难帧 —— 三种造法否掉两种、第三种成立，落成一条成对真模型机制锁，变异把参数扫描的结论变成了会红的判据（#108）；设备前置调研：三项逐一查实 mock 顶不到哪一层（三任务工具全过 requireEnv ⇒ 交付-1 C 项无法替代），并修正「需要设备」这个前提——本机虚拟化已启用，缺的是安装不是能力（#109）。 |


## 写入规则

1. **判归属**：问题已修好并有验收证据 → 写这里；还没修 → 写 `TODO.md` 差距行；只是方案/验收清单 → 写 `TODO.md` 主题条目。
2. **取号**：`### #N` 取当前最大号 +1，**永不复用、永不重排**。
3. **写三段**：`#### 问题描述`（含实测证据与出处）/ `#### 整改方案与实施`（改了哪些文件、为什么这么改）/ `#### 验收标准`（可复跑的命令或勾选项）。
4. **与 TODO 的交接**：条目若关闭某个 `G*` 或主题项，正文写在这里，`TODO.md` 只保留一行指针——**同一事实只在一处展开**。
5. **防膨胀**：单条超过约 60 行时，把调研正文移进 `docs/migration/`，本文件留结论 + 链接。

---

## 一 · 插件边界与溯源

### #84 rules 注入链拆除（D20 红线；主题项 rules-1）

#### 问题描述

- `rulesInjector` 把 `<artemisRepoPath>/mcp_server/rules.md` —— 一个**外部 ARTEMIS 仓库里的文件** —— 读进 `systemPrompt.section()`，每次挂载重读。外部仓库的目录约定与其中文本因此进入本插件的模型面。
- 取证：**前置-4 §三** 判定这条链同时踩 D19（仓内不承载 py 约定）与 D20（上游 prompt 正文不得进本项目模型面），归属 G85+G86，要求 T4 定案。
- 形式调研（随包文档 `@deepseek-ai/dsh-system-prompt/README.zh.md`，R1 允许面）：**「部署方编写的提示词文本只来自配置／组合……不存在终端用户提示词编辑 API」**；
  且 persona 与插件文本「在每次请求中重复」（常驻文本有每请求成本，过程性知识更适合按需形态）。
- 现状清点：本 bundle 的 `cordis.patch.yml` persona 行（常驻、agent 作用域）与 `skills/autogamer-flash/SKILL.md`（按需）**本就承载同族操作纪律** —— 外部文件那条是重复的第三条链。

#### 整改方案与实施

- **拆除而非「改指向」**（改指向会引入第三份重复文本，并把 agent 作用域的纪律放大成 profile 全局的 `section()`）。
- 删除面：`src/prompt/rulesInjector.ts`、`src/index.ts` 的 `injectRules` 配置与调用点、`src/tools/diagnose.ts` 的 rules 项及其文案、
  `tests/rulesInjector.spec.ts`、`tests/fixtures/fake-repo/`、`tests/apply.spec.ts` 与 `tests/conformance/contracts.spec.ts` 的相关断言、插件 `README.md` 的 Layout 行。
- 连带：`systemPrompt` 缝（`src/dsh-types.ts` 的手镜像、`inject` 条目、`runtimeBoot.spec.ts` 的 Tier-1 断言）随链一并消失。
  **引导图保留 `@deepseek-ai/dsh-system-prompt`**：agent loop 经它解析，删掉会让挂载失败——五条 mount 测试变红即证。
- 不加替代实现；规则文本的载体是 persona（常驻）与 skill（按需）。

#### 验收标准

- `grep -rn 'rulesInjector\|injectRules\|rulesFilePath\|mcp_server/rules' plugins/ | grep -v node_modules` → **0 命中**（含 `dist/`；陈旧构建产物已清）。
- R27 变异：把 `injectRules` 塞回 Config schema ⇒ `tests/conformance/contracts.spec.ts` 的字段锁**恰好那一条变红**；撤回复绿。
- `pnpm --config.verify-deps-before-run=false run verify` 三段全绿；`node scripts/check-docs.mjs` 与 `node scripts/check-env.mjs` exit 0。
- 提交：方案 `011a642`（R22 先方案后实现）→ 实现 `01de3b2`。

### #85 录屏 / 视频分析不迁移（D12 放弃记录）

#### 问题描述

- 规格 §一.4 要求：任何被判定不迁移的能力必须在**本分支**留下明确的放弃记录，不允许静默消失。
- 上游的录屏 / 视频分析能力（py `ffmpeg` 系）在 **D12** 已判「一期无录像」，但本分支新建 CHANGELOGS 之前一直没有落点。

#### 整改方案与实施

- 不实现任何替代载体；规格 §二 矩阵该行标注放弃并指向本条。本条即该放弃记录的落点（CHANGELOGS 于本分支首次结案时新建，见 #84）。

#### 验收标准

- 规格 §二「录屏 / 视频分析」行的状态列含 **已砍（CHANGELOGS #85）**；`node scripts/check-docs.mjs` exit 0。

## 二 · 能力迁移（T1–T4）

### #86 效果判定改为 TS 原生差分（D19；主题项 T3 第一片 / G84）

#### 问题描述

- `run_device_action` 的 `effect` 三态由 `compareFrames` 决定，而它当时把两帧**转发**给外部动作面的 `compare_ui_frames`——判定因此仍依赖 py 动作面（py 侧实际执行 `check_ui_change`），这是 G84 的 py-only 面之一，也是路由里唯一的判定来源。
- 前置-3（TODO §七）已读归档 blob 把设计事实取齐：遮罩比例、两条管线及其阈值、分支表、ROI 几何、失败方向、坐标空间，并把移植范围收口为这一条路径。

#### 整改方案与实施

- 新增 `src/effect/png.ts`：**最小 PNG 解码**（零新依赖，`node:zlib`）——支持 depth 8 的 colorType 2/6、非隔行；形状由**实测帧**界定（1600×900 RGBA）；其余抛错。
- 新增 `src/effect/diff.ts`：灰度化 → 全局管线（裁顶 10%/底 5%、5×5 高斯 σ=1.1、阈值 25、门限 1e-4）与 ROI 管线（**未裁剪**图取景、半径 `max(15,int(50×scale))`、3×3 高斯 σ=0.8、阈值 20、门限 0.05、**未过门限回落全局**）；动作分支表（`swipe` 直走全局；`tap` 族且有像素二元组先 ROI）。每个常量带出处（函数+常量名）。
- `src/index.ts` 的 `compareFrames` 改调本地实现；失败方向 = 返回 `undefined`（既有 fail-open；不发明 `true`）。
- 锁：新增 `tests/effectDiff.spec.ts`（判别用例 7 + 失败方向 + 解码器，含合成帧编码器 `tests/support/pngEncode.ts`）；`apply.spec` 的 route-A 转发锁改成「不再问动作服务器 + 仍取两帧」；`contracts.spec` 的直呼清单去 `compare_ui_frames`；README Layout 补两行。

#### 验收标准

- `pnpm --config.verify-deps-before-run=false run verify` 三段全绿（35 files / 332 passed / 1 skipped）；`check-docs`、`check-env` exit 0。
- **三处变异各红一次**：删「ROI 落空回落」⇒ 补的回落用例红；遮罩改成 1px ⇒ 用例 4 红；fail-open 改抛错 ⇒ 失败方向用例红。
  偏差如实记：删回落的红点是**本片补的第 6 条用例**——前置-3 的用例 5 区分不了「回落」与「直接返回 ROI 判定」，两者都给 `false`。
- 真帧冒烟（**本机一次性，未入库**）：对 `scratch/` 里的 1600×900 RGBA 真截图跑 `judgeEffectChanged` → 解码成功；**同帧自比全 `false`**；跨帧给出判定。`scratch/` 与真帧都不在仓库里，所以这条**不是可复跑判据**——入库的证据是上面那 7 条用例与三处变异。
- 🔶 **未做**：与 py 的同输入同输出对照表（仓内无 py、本机无解释器与旧 venv、provider 未配置）——列延迟项，见 `TODO.md` §七。
- 提交：方案 `6d03b6f` → 实现 `00106f8`。

### #87 OCR 判为推迟（G87；T3 收尾的「做不做」判定）

#### 问题描述

- T3 的 Done 写「效果判定与 OCR 无 py 依赖」，差分那片已落地，剩下的问题是 **OCR 这片到底做不做**。
- 消费者清点（实测）：插件树 `grep -rniE 'ocr|vision|text_detect|find_text'` → **零命中**；动作面夹具 `py-action-tools.json` 的 15 个工具里**没有 OCR 工具**。
- 上游侧（只读归档 blob）：OCR 的实现与调用**全在 `artemis/agents/**`（checker / explorer / screen_index / tiers / runners）**——即 py 智能栈的感知层；而该栈按 **D8 不迁移**、按 **T1** 已由 S11 单层路由 + agent loop 取代。

#### 整改方案与实施

- **不实现**，判为**推迟**并新立 **G87**：给没有消费者的功能加 HTTP 客户端、密钥配置面与「OCR 盒子 vs 层级元素」的融合策略，是净增复杂度，违反「不为假想需求设计」。
- **不是放弃**：画布类 UI（层级取不到文字）的文字发现是真实缺口；本分支对该场景的现有支撑是「模型自看截图 + 归一坐标 `[x,y]`」——**能做但更弱**，这条短板写明而非抹掉。
- 顺手把**设计事实一次取齐**（七面：端点结构、密钥回退与「未配置即返回空」、跳过整图合并文本、顶点→包围盒、**XML 优先**的融合与 `is_ocr` 标记、重叠率分母取 OCR 面积、三类低价值文本过滤），每条带函数/常量名出处，落在 `TODO.md` §七「前置-5」——将来解锁不必重查。

#### 验收标准

- `TODO.md` §四 有 **G87** 行（归属「待需求」，不在 T1–T4 排期内）；§七「前置-5」四条 Done 全勾；§二 的 OCR 行状态为「推迟（非放弃）」。
- 解锁条件成文：出现真实消费者（层级为空的画布界面反复失败）⇒ 另立实现条目，形态按已取证事实落（零依赖 `fetch`、密钥走我们自己的配置项、未配置即空、XML 优先融合、三条质量过滤）。
- `node scripts/check-docs.mjs` exit 0（新行、新表仍成形）。

### #88 画面标注 overlay 判为推迟（G88；T3 收尾的同一次消费者清点）

#### 问题描述

- 规格 §二 列了「画面标注 overlay（py `PIL`/`cv2` → sharp/libvips）」为待迁移能力，T3 收尾要回答做不做。
- 清点（实测）：插件树 `grep -rniE 'overlay|annotat|drawbox|draw_text|label_image|标注'` 只有两处命中，且都是 **dsh patch 的 overlay 语义**（`tests/deliveryShape.spec.ts:6`、`README.md:73`），与图像标注无关；截图路径 `saveScreenshot` 是把原帧交给 `ctx.attachments.saveImages`，插件**从不产出标注图** ⇒ **零消费者**。
- 上游侧（只读 blob）：标注只出现在 `artemis/agents/**` 的调试产物与 `artemis/data_engine/**` 的存档可视化里。

#### 整改方案与实施

- **不实现**，判**推迟**并新立 **G88**：为「给人看的调试图」引入 libvips 原生依赖，换来的是零消费者的产物。
- 上游那两个消费者各自已被别的决议覆盖：agents 感知层按 **D8** 不迁移；`data_engine` 存档按规格 §二 改由 **DSH session log** 承载（T1 已落）。
- **不是放弃**：若将来做 Web toolview 的「把命中元素画出来」类展示（P3/G2 轨道），那才是消费者出现之时；届时形态必须走 **R18**（client 插件的 `tool.call.toolview` keyed slot，不 iframe、不 import 宿主 Client 包），依赖选择重新评估。

#### 验收标准

- `TODO.md` §四 有 **G88** 行（归属「待需求」）；§七「前置-6」三条 Done 全勾；§二 的 overlay 行状态为「推迟」；G84 行同步写明「OCR / overlay 判为推迟」。
- `node scripts/check-docs.mjs` exit 0。
- 附带记录一条判据卫生问题：本条立案时我先写过「`grep -rn compare_ui_frames src` 为空」当作 T3 Done 的判据——**那是错的**（src 里两处命中都是注释文字，裸 grep 会把无害散文判红）；正确判据是只匹配调用形状的 `contracts.spec` 直呼清单 + apply 的零调用锁。已改正并在 `TODO.md` §七 T3 条目里留下这段来处。

### #89 T2-a 设备面本地化：roster / 设备态 / screenSize 校验改走 adb（G75、G76 结清；G89、G90 新立）

> 编号提示：本条是 CHANGELOGS 的 **#89**，与 §四 新立的差距 **G89**（跨进程设备互斥）只是同号不同事，互不指代。

#### 问题描述

- 设备面三条都靠外部提供方回答：`list_devices` 问「谁在场」、`get_device_state` 问「连着吗 / 前台是谁 / 屏幕锁没锁 / helper 装没装」、坐标换算问「屏多大」。D19 的终态是这些都能在 TS 侧自己回答。
- 取证（`TODO.md` §七「前置-7」「前置-8」两张表，2026-10-15 同一台 Android 15 模拟器）里三条改写设计的实测事实：
  - **`dumpsys window displays` 一行 `screenState` 都没有**（258 行 0 命中），而无参数的 `dumpsys window`（671 行）恰有 1 行 ⇒ 问错参数不报错，只得到「unknown」，按 G65 一律拒 —— 每台设备都会被自己的探针判成不可用。argv 本身因此必须有锁。
  - **`wm size` 与帧空间差一次转置**：`wm size`=900x1600 而同一时刻 `exec-out screencap -p` 的 IHDR=1600x900（`accelerometer_rotation=1`）⇒ 手填 `screenSize` 若照抄 `wm size`，每次点击都偏半屏，而**原先没有任何校验拦得住**（G76）。
  - **一条模拟器三传输**（`emulator-5554` / `127.0.0.1:7555` / `127.0.0.1:16384`），而 `ro.serialno` 与 `ro.boot.serialno` 都是空串，`settings get secure android_id` 三行同值 ⇒ 去重键只能是 `android_id`（G75）。
- 连带一条：已经走本地 adb 的只读工具仍被 `provider` 形状的预检（uv / python / repo / helper 七项）把关，会在「没装提供方」的机器上被拒 —— 那是预检在说谎。

#### 整改方案与实施

- 新增 `src/device/adb.ts`（全插件唯一 adb 出口：自实现超时、观测 `AbortSignal`、`exec-out` 走二进制安全通道、`adbArgs` 统一「命名 / 不命名设备」两种 argv）、`src/device/roster.ts`（`devices -l` 解析 + `android_id` 折叠 + `canonicalSerial` 优先 `emulator-*` + 锁态三值）、`src/device/state.ts`（六个本地探针与各自的 parse 纯函数）。
- `src/index.ts`：`enumerateRoster` 由这三件拼出（`undefined` 仍表示「没问到」，不许塌成空舰队）；`resolveScreenSize` 改问帧 IHDR，手填值与帧不符 ⇒ `environment:` 拒并给出该填的值；`autogamer_get_device_state` 的 backend 依赖整条摘掉，截图改走宿主附件存储（render 仍按 `[text, image]` 出图块）。
- `src/devicePool.ts`：`PoolDevice.aliases` + `canonicalKey` 把别名折回**同一把闸门锁** —— 只折 roster 不折键的话，计数翻倍照样发生。
- `src/env/preflight.ts`：`run(input, scope)`，`device` 范围只查 adb + 在线设备，缓存按范围分键（否则 warm 过的 device 结果会冒充 provider）。
- 测试面：`vitest.config.ts` 新增 `setupFiles: tests/support/adbMock.ts` 全局装 adb 双件套（`src/device/adb.ts` 是唯一出口，一处替换即可，而 adb 输出的解析仍跑真实文本），`tests/support/fakeAdb.ts` 提供规则式双件套与实测形状夹具；新增 `deviceRoster.spec` / `deviceState.spec`，重写 `getDeviceState.spec`，`apply.spec` 加「设备态来自帧」+ G76 拒绝 + roster 胶水，`contracts.spec` 直呼清单由 3 条收敛为 2 条（`list_devices` 出局）。

#### 验收标准

- `pnpm --config.verify-deps-before-run=false run verify` ⇒ **37 文件 / 374 通过 / 1 跳过**（本片前为 35 / 332）。
- 真机复跑 `node scratch/live-device.mjs`：本地探针全套 **455ms**，`get_device_state` 答出 `connected` / 前台组件 / 锁态 / 帧 `1600x900` / helper 已装；坏 serial ⇒ 三处都诚实回答「没答案」而不是 `false`。
- 变异（R27，`node scratch/mutate-t2a.mjs`）：M1 去掉 G76 校验 ⇒ `apply.spec` 恰 1 红；M2 去掉别名折叠 ⇒ `devicePool.spec` 2 红；M3 dumpsys 参数改回 `window displays` ⇒ `deviceRoster.spec` 恰 1 红；M4 停止 `android_id` 折叠 ⇒ `deviceRoster.spec` 恰 1 红；M5「没答的 helper」报成 `false` ⇒ `getDeviceState.spec` 恰 1 红。五条全部跑到红，无一条假绿。
- `node scripts/check-docs.mjs` 与 `node scripts/check-env.mjs` exit 0；`TODO.md` §四 的 G75 / G76 两行移除（结清不留开放行），新立 G89（跨进程互斥）与 G90（缓存不随转屏失效）。
- 仍 🔶：形状只在**这一台** Android 15 模拟器上量过（其它 ROM 缺 `screenState` 时有回落，但未实测）；挂载后的真机 `get_device_state` 与完整任务未跑（用户授权面）。

### #90 T2-b 层级本地化：`uiautomator dump` 读回 + 自带 XML 解析（G83 内）

#### 问题描述

- `get_ui_hierarchy` 是动作面里最核心的一条：模型的 `{index}` 句柄、`{text}` 目标和执行后的身份复核全都吃它。此前它问的是 py 动作服务器，而 py 给的那份 JSON 是**把设备的 XML 树拍平后自造**的产物（`parsed_bounds` 这个字段名就是 py 造的）。
- 复测（`node scratch/probe-hierarchy2.mjs`，2026-10-15 同一台 Android 15）：`uiautomator dump` **code=139 / 2439ms** 且照旧打印成功消息；读回的树 **45 节点 / 每节点 19 属性 / 21 自闭合 + 24 成对标签 / bounds 全 `[l,t][r,b]`（45/45）/ `rotation` 在 `<hierarchy>` 根上（本机 = 1）**。`rotation=1` 也正是 #89 里 `wm size`(900x1600) 与帧空间(1600x900) 转置失配的来源。
- 两条测量自身的错当轮记下（R27 判据 6）：① 第一版探针把 `exec-out cat` 当 utf8 字符串再 `latin1` 转 Buffer ⇒ CJK 全乱码、`bounds` 正则 0 命中，看着像设备行为其实是解码口径错，改成按字节读后 0 个替换字符；② 「深度 15」是探针计数口径的产物（自闭合也算了一层），实现的祖先栈给出 **14**，并用构造已知的三行树独立证明栈本身正确。

#### 整改方案与实施

- 新增 `src/device/hierarchy.ts`：dump 到 `/sdcard/dsh-autogamer-hierarchy-<pid>.xml`（**带 pid**，两个插件实例不得互读）→ `exec-out cat` 按字节读回 → `isHierarchyXml` 校验（要求同时出现 `<hierarchy` 与 `<node `）→ best-effort `rm`。**退出码与成功消息一概不看**（实测两者都会撒谎）。
- `src/hierarchy.ts`：`parseVisibleElements` 增 XML 入口，产出**与 JSON 入口逐字段相同**的元素记录；`#N` 仍按文档序位置编号、句柄仍按身份解析（G42 / G67 的锁一字未动）。真机 dump 含容器节点，所以列表里会出现无标签容器行 —— 与提供方那份 77 节点的树同构，不是新引入的噪声（旧夹具只有两行是因为 py 那份 JSON 本身是简化的）。
- `src/tools/runDeviceAction.ts`：`hierarchy` 依赖改为**必填**并**删除 provider 的 JSON 层级路径**，`get_ui_hierarchy` 从此不过传输；读失败冠 `environment:` 前缀（G33：读挂了是设备/宿主的事，不许算 internal 让熔断关着）。
- 空树（`<hierarchy></hierarchy>`）判为「读不到」而非「屏幕是空的」，沿用 前置-1 的 fail-closed 口径。
- 测试面：`tests/fixtures/hierarchy-chrome.xml`（真机原文逐字 + 来路头注）、新增 `tests/hierarchyXml.spec.ts`、`tests/support/hierarchyXml.ts`（把 ladder/observation/dedup 三份 JSON 夹具改为同形 XML，并把层级依赖补进各 spec 的路由构造），`contracts.spec` 直呼清单收敛为 `take_screenshot` 一条。

#### 验收标准

- `pnpm --config.verify-deps-before-run=false run verify` ⇒ **38 文件 / 390 通过 / 1 跳过**（#89 后为 37 / 374）。
- 真机端到端（走 `dist/device/hierarchy.js`）：**2038ms** 拿到 45 节点、11 个 clickable，CJK 文本与 resource-id 完好，元素按文档序编号。
- 变异（R27，`node scratch/mutate-t2b.mjs`）：N1 去掉读回校验 ⇒ 2 红；N2 弃用祖先栈 ⇒ 1 红；N3 把成对标签当自闭合 ⇒ 1 红；N4 读失败丢前缀 ⇒ `validatorLadder.spec` 1 红；N5 层级退回传输 ⇒ `apply.spec` 4 红。
- `node scripts/check-docs.mjs` / `check-env.mjs` exit 0。
- 仍 🔶：XML 只在**这一台**设备上量过；`uiautomator` 与宿主 appium 路线的对照、以及 `--compressed`（实测更慢，不采用）之外的大屏层级代价未评估。

### #91 T2-c/d/e 动作面本地化：12 条动作与截图全部走 adb（动作面直呼清单归零；G91 新立）

> 编号提示：本条是 CHANGELOGS 的 **#91**；正文里出现的 **G91** 是 §四 新立的「长按语义未证实」差距，两者互不指代。

#### 问题描述

- 到 T2-b 为止，插件还剩一条动作服务器调用（`take_screenshot`）与一整批经传输执行的动作（tap / long_press / swipe / keyevent / back / 文本 / 清字段 / launch / stop / open_link / wait）。D19 的终态要求 `artemis mcp --type adb` 不再是任何路径的运行时依赖。
- 本轮实测（`TODO.md` §七「T2-c/d/e 动作面收口记录」）补了四条**改写设计**的事实：
  - `cmd package resolve-activity <不存在的包>` ⇒ **code=0 + stdout `No activity found`**（退出码撒谎的第二例）⇒ 启动必须按文本早退；
  - `input keyevent 67 67 67` 一次调用**恰好删 3 个字符**（真机 `MARKER9` → `MARK`）⇒ 清字段不必逐字符 spawn；
  - `input text` 落在**光标处**，而 `keyevent 123`（MOVE_END）在 Chrome omnibox **不生效**（文本插到字符串中间）⇒ 「单向删除即视为清空」是幻觉，必须双向删 + 读回校验；
  - 长按的三种形态（零距离 swipe / `motionevent DOWN…UP` / 普通 tap 对照组）在真机上**反应完全一致** ⇒ 对照实验不成立，只能把语义复测挂 **G91**，不许把「没报错」当「已证实」。
- 安全面：`adb shell` 把参数交给**设备 shell 再切一次**（前置-7 量过 monkey 逐参数回显），所以 argv 数组不免疫；模型可控的文本 / URL / 包名必须有引号或形状白名单。

#### 整改方案与实施

- 新增 `src/device/act.ts`：`runNativeAction(call, serial, {signal, readFieldText})`，按工具产出**旧字符串契约**（`Success` / `Failed` / `Error: …`），因此 `classify.ts` 的 environment/task 分面、validator 阶梯、熔断与全部既有锁**一字不改**地继续有效；设备侧失败文本按测量形状取首行并截 200。
- 文本注入防线：`input text` / `am start -d` 的参数走 `quoteForDeviceShell`（POSIX 单引号转义）；包名 `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$`、URL 只允许 `http(s)` 且不含空白 —— **不合格就不 spawn**（不是 spawn 后再看输出）。
- 清字段：读回层级里 focused/EditText 的文本长度（实测 `dumpsys input_method` 在 Android 15 已无 `mText:`，层级是唯一文本源），一次 keyevent 调用带 N 个 `KEYCODE_DEL`，再反向一次 `KEYCODE_FORWARD_DEL`，最后**读回校验**，仍非空则报 `Error: field still holds …`。
- `src/tools/runDeviceAction.ts`：`client` 依赖删除，换成 `execute(call, key, signal)` 与 `capturePng(key, signal)`；`take_screenshot` 分支改吃 PNG 字节（不再 base64 往返），顺带修掉「一次截图抓两遍」的旧浪费；设备调用抛错按前缀分类，无前置缀仍判 internal（G33 同一条规则）。
- `src/index.ts`：不再构造 `ActionClient`，配置面删 `actionServerCommand` / `actionServerEnv`；`src/env`、`src/device/*` 成为设备面的全部出口。
- 测试面：新增 `tests/deviceAct.spec.ts`（22 条，含三条注入防线与「沉默即成功」「stdout 上的失败」两类形状）；`apply.spec` 的假动作服务器整体换成 adb 双件套并按 argv 断言；`contracts.spec` 的直呼清单锁由「还剩哪些」改成 `toEqual([])` 的**禁止式**；`breakerGuard` / `runtimeBoot` / `router-errors` / `dedup` / `liveObservation` / `validatorLadder` 随依赖面同步。

#### 验收标准

- `pnpm --config.verify-deps-before-run=false run verify` ⇒ **39 文件 / 412 通过 / 1 跳过**（#90 后为 38 / 390）。
- `contracts.spec`：`src/` 内动作面直呼清单**为空** ⇒ §四 T2 Done 判据第一条达成（该锁本身经变异可红）。
- 真机逐条（`node scratch/live-acts.mjs`）：back / launch / swipe / tap / input text / erase_one_char / press_key / open_link / stop_app / long_press 全 `Success`，`capturePng` 1,281,952 bytes / IHDR 1600x900；三条**该拒的**（`javascript:alert(1)`、`com.no.such.pkg`、`com.x; rm -rf /sdcard/*`）都拒了且**零子进程**。
- 变异（R27，`node scratch/mutate-t2cde.mjs`）：P1 放开 URL ⇒ 1 红；P2 包名不校验 ⇒ 1 红；P3 文本不转义 ⇒ 2 红；P4 只看退出码 ⇒ 1 红；P5 swipe 丢 duration ⇒ `apply.spec` 1 红；P6 清字段不校验 ⇒ 1 红。
- 仍 🔶 / 仍欠：长按语义（G91）；本轮 live 的 tap 落点不是输入框，「文本落到字段」只在 前置-7 量过、argv 形状有单测；`ActionClient` 与其夹具**已无生产消费者**，删除裁决属 T4；挂载后的宿主内实跑（R7 / R9 / R24）仍待用户放行。

### #92 T2-f 诊断本地化：报告由本地探针合成，提供方清点答案为「无消费者」（T2 除挂载证明外收口）

#### 问题描述

- `autogamer_diagnose` 是提供方剩下的**最后一个**工具消费者（`backend.diagnose()`），而它问的六件事没有一件需要 uv / python / ARTEMIS 仓库：连着吗、屏幕锁没锁、helper 装没装、崩过什么、屏多大、该怎么办。
- 它的 `include_screenshot` 参数长期是「收下但忽略」（说明文字写着 the provider decides），模型 asks 一张图却拿不到 —— 一个自称能诊断的界面把最有诊断价值的一帧丢掉，本身就说不过去。
- 本轮实测（`TODO.md` §七「T2-f 诊断本地化与提供方清点」）两条：
  - `dumpsys package com.artemis.helper` 有 `versionName=1.2.0`（helper 版本文本上是设备侧读的，不是提供方报告的）；
  - `logcat -d -b crash -v brief` 里**每一次 `uiautomator dump` 都留一个 SIGSEGV tombstone**（`Cmdline: uiautomator`）⇒ 这解释了 前置-7 的「成功也退 139」：写完文件后进程自毁。**层级判据不变**（仍只认读回的文件），但这件事现在会主动报告出来。

#### 整改方案与实施

- 新增 `src/device/diagnose.ts`：`diagnoseDevice()` 并行问连接态 / 窗口态 / helper / 帧，装了 helper 才去问版本，再读 `crash` 环形缓冲；建议文案只在证据真的在那时才写（`offline` 就说 offline，锁态读不到就说读不到）。
- `parseCrashLogcat`：按**块**切而不是按行切 —— `-v brief` 每一行都带 `F/DEBUG (pid):` 前缀，逐行判会把一个 tombstone 切成 7 条。块起点只认 `Timestamp:` 开的首行、`F libc : Fatal signal` 与 `*** ***` 分隔行。
- `src/tools/diagnose.ts`：`backend` 依赖删除；输出键**一个不动**（`recent_crashes` 仍是 `package` / `timestamp` / `stack_excerpt`），`helper_version` 与 `logcat_path` 之类按实测有无；`include_screenshot` 走 `exec-out screencap -p` + 宿主附件存储，render 按 `[text, image]` 出块；**没帧就不写存储**（宁可少一张图，不存空字节）。
- `src/index.ts`：不再构造 `artemisBackend`；`run_task` / `manage_task` / `inspect_trace` / `diagnose` 的预检门改为 `device` 范围 ⇒ 装了 adb 和一个设备就能用，**不再要求 uv / python / 提供方仓库**（这是「用户无需额外安装配置」的最后一道门）。
- 清点答案落账：`src/artemis/`（含 `clientHalf` / `mcpBackend` 两份规格）与 `ActionClient` 现在**零工具消费者**；模块与 `artemisMcpCommand` / `artemisRepoPath` / `uvPath` 配置字段的去留是 **T4** 的裁决，本片不擅自动手。

#### 验收标准

- `pnpm --config.verify-deps-before-run=false run verify` ⇒ **39 文件 / 425 通过 / 1 跳过**（#91 后为 412）。
- 真机 `diagnoseDevice("emulator-5554")`：`adbConnected` / 锁态 / 帧 1600x900 / `helperVersion 1.2.0` / 多条 tombstone 全数答出；坏 serial ⇒ `adbConnected:false` 与两条诚实建议，helper **不报 false 而是不报**（问了没答 ≠ 答了没有）。
- 变异（R27，`node scratch/mutate-t2f.mjs`）：Q1 预检文本不再优先 ⇒ 1 红；Q2 空帧仍写附件存储 ⇒ 1 红；Q3 crash 缓冲逐行切块 ⇒ 1 红；Q4 跳过 helper 版本探测 ⇒ 1 红。
  **Q2 / Q4 第一次跑是绿的**，原因是断言落在了桩身上而不是探针身上（`noFrame` 抽掉的是依赖、`helperVersion` 只测映射）——补出「帧存在但为空」和 `diagnoseDevice` 真探针两条后才红。**这条自纠比结果本身重要**：它又是 R27 说的「判据必须被证明会红」。
- 仍 🔶：诊断的 crash 解析只在**这一台**设备的 tombstone 形状上量过；挂载后的宿主内实跑待用户放行（R7 / R9 / R24）。

### #93 T5 · OCR 内置（G87 反转结案）：备用文字元素源改为随包离线 WASM，用户零配置

#### 问题描述

- #87 判 OCR「零消费者 ⇒ 推迟」的前提在 2026-10-15 被用户裁定推翻：目标要求「将 OCR 功能**内置到插件本体**，使用户使用时无需额外安装配置」。消费者由本项目自建 —— `run_device_action` 的 `target:{text}` 在**层级答不出**时没有第二条路（画布 / WebView 界面的文字压根不是节点），这才是那片能力真正的缺口。
- 上游形态不可照搬：py 侧是 `httpx` → Google Cloud Vision + **用户 API key**，未配置就返回空。要用户先去申请密钥，与「零配置」直接冲突 ⇒ **只取其用途，换其形态**。
- 落地前的一次性可行性实测（`TODO.md` §七「T5」方案表）用的是 **standard** 语言数据，得到「双语 1964ms、整帧 conf 35、约 4.5 MB」；实施期换 `4.0.0_fast` 后同帧 **657ms / 3.5 MB**，且**整帧 conf 这个口径本身被证明是错的判据**（见下）。

#### 整改方案与实施

- 新增 `src/ocr/recognize.ts`：`createOcrEngine()` 懒建**单例** worker（实测 boot 168ms、次帧 594ms），`recognize()` 任何失败一律返回 `undefined`（fail-open：OCR 只可能**多给**一个答案，绝不可能把一个能成的动作弄失败）；超时自实现（R15）+ 观测 `AbortSignal`；disposer 挂在 `apply()` 的 `ctx.effect` 上。
- **离线三件套**：`langPath` 指包内 `ocr/`、`cacheMethod:"none"`、`gzip:true`。语言数据 `ocr/{eng,chi_sim}.traineddata.gz`（1,984,273 / 1,730,011 B）随包发布并加进 `files`；`THIRD_PARTY_NOTICES.md` 登记来源、版本、许可与体积（tesseract.js MIT、tessdata_fast Apache-2.0）。
- **命中模型由实测逼出**（方案只写了 `{text, confidence, bbox}`）：tesseract 把一整排桌面图标读成**一行** —— 夹具里行框 `x0=4..x1=1441`、行中心 **(723,245) 落在两个图标中间的空白**，而行均值 conf 只有 **60**；「游戏中心」是这一行里的三个词（96/93/92，合并框中心 **(1003,240)**）。⇒ `matchWindow()` 把命中**回填到实际匹配的那串词**，置信度门槛按**该串词的最弱词**判（`OCR_MIN_CONFIDENCE = 60`，实测标签 72–96 / 噪声 0–47）。**偏离方案 How-3 的字面「不高于 35」**，因为 35 是整帧口径、不是命中口径；按行判会把真标签拒掉、把噪声放进来，两个方向都有锁。
- 消费点（`src/tools/runDeviceAction.ts`）：只有 `{text}` 且层级答不出才 `ocr(key, signal)`；`{index}` / `{coordinate}` 永不走；多命中或低置信 ⇒ 保持原层级错误文案（歧义不猜，与 G67 同向）；命中记 `target_source: "hierarchy"|"ocr"` 并复制进 `presentationMeta`（T1 折叠侧只读 `meta`，天然继承）。每轮阶梯各看一次新帧（不缓存）—— 阶梯的本意就是「屏幕可能还在动」。
- 配置面 `ocrEnabled`（默认 **true**）/ `ocrLanguages` / `ocrTimeoutMs`；诊断项 `ocr_ready` + `ocr{enabled,langs,missing_data,frame?}`，缺语言包或引擎问不出时写进 `recommendations`，**不进 preflight 门**、检查自身抛错也只记一行（`ocrEnabled:false` 算选择不算故障）。

#### 验收标准

- `pnpm --config.verify-deps-before-run=false run verify` ⇒ **42 文件 / 470 通过 / 1 跳过**（#92 后为 39/425）。新增 `tests/ocrRecognize.spec.ts`（23）、`tests/ocrConsumer.spec.ts`（9）、`tests/ocrPackaging.spec.ts`（5），`tests/diagnose.spec.ts` +8。
- **`ocrPackaging.spec` 里有一条真跑包内模型的**：读版本库内的真夹具帧、断言 `TapTap`→(1206,241) 与 `游戏中心`→(1003,240)、且跑完 `ocr/` 与 cwd **一个文件都不多**（这是「零配置且不留垃圾」的唯一可复跑判据；单元 spec 仍全用注入假件，不碰模型）。
- `node scripts/ocr-probe.mjs`（版本化探针，吃仓库内夹具）离线复跑：`boot=168ms recognize=657ms second=594ms`、`cwd pollution: []`、`ocr dir extras: []`。
- 变异（R27，`node scratch/mutate-t5.mjs` → `scratch/mutate-t5.txt`）**M1–M14 全部落地**：M1 OCR 抢先于层级 / M2 `{index}` 也走 OCR / M3 命中不回填框 / M4 门槛归 0 / M5 按行置信度判 / M6 `files` 去掉语言包 / M7 `cacheMethod:"write"` / M7b 去掉 `langPath` / M8 OCR 检查炸整条诊断 / M9 建议不落地 / M10 `ocr_ready` 不看缺数据 / M11 render 丢字段 / M12 缺数据判定反了 / M13 `status()` 谎报 worker 已起 / M14 `tesseract.js` 降级为 devDependency。
  ⚠️ **M7 第一次是绿的**：断言原本只比「本次运行前后目录差集」，而上一轮变异已把两个 `traineddata` 落在插件目录 ⇒ 脏机器上失明。改成**绝对 + 相对**双断言后才咬住，并清掉那两枚遗留文件（4.1 MB / 2.5 MB）。
- ⚠️ **一条实测否证了「可用」的强口径**（真机 `emulator-5554` 桌面页，跑 `dist/` 产物）：帧 1,279,741 B、层级 83 节点其中 **24 个带文字**、OCR 79 命中 / 754ms，但**两侧同时答得出的只有 2/24**；逐条查因显示 `游戏中心` 这帧被读成 `只@45 / 本@34 / wep@33`（**不是被门槛挡掉，是没认出字形**），dock 的 `设置/图库/文件` 附近零命中。⇒ **安全面（fail-open、只补不抢、歧义不猜、零配置、不落垃圾）已锁；召回面在 1600×900 小字浅色 CJK 上不成立 ⇒ 新立 G92**。同一屏的夹具帧反而认得出（92–96），说明逐帧方差大，G92 的候选解法（识别前 2× 放大 / 换 standard 或 best 数据 / 按区域裁剪重试）本片**一条都没选**。
- 仍 🔶：OCR 从未在**挂载后的宿主内**跑过（与 T1 / T2 的挂载证明同一批）；`chi_sim` 的召回只在两帧上量过。

### #94 T4 收尾：门只问两件真事，被删的面按消费者计数删除（G82/G83/G84/G85/G86/G89/G90/G93 结案）

#### 问题描述

- `src/env/preflight.ts` 还在问七件事（uv / python / 提供方仓库 / 提供方安装 / adb / 设备 / helper），但 T2 之后**没有任何工具走提供方**：设备面、层级、帧、效果判定、诊断、OCR 全在 TS 侧与本机 adb 上完成。于是一次原生层级读取会因为「没装 uv」被拒 —— 门在**替一件不存在的事说话**。
- 三处「有代码没消费者」的面一直没人裁决：`src/actionClient.ts` 与三个需要活 py 服务的脚本（T2-c/d/e 之后零调用）、`src/mcpText.ts`（只剩死分支可达）、以及**整条镜像链** `src/scrcpy/*` + 5 个 `scrcpy*` 配置字段 —— 它在 `apply()` 里只被构造与销毁、**零工具驱动**，且 `scrcpyServerPath` 默认空 ⇒ 要操作者自备 server 二进制。**全 docs 对 `scrcpy` 零提及**：它是搬迁-1 带过来的，从未经裁决（清点后新立 **G93**）。
- `ACTION_TO_PY_TOOL` 是**名不副实的第二权威**：路由器早就不读它（每条 action 在 switch 里直接给原生调用名），只剩 contracts 与需要活服务的 `spike-mcp.mjs` 引它；而 contracts 的「与 py 面逐字同名同参」判据在本分支**不可满足**（D19 之后没有可跑的 py 可比）。
- 规格 §一.3 要求「保留 adapter 能显式指向用户自行安装的外部 ARTEMIS」，但 T2-f 之后**没有任何工具构造它** ⇒ 该条只在文字上成立；`artemisMcpCommand` 的默认值仍是 `["python","-m","mcp_server"]`，即「默认假设有一台 python 提供方」。
- **G90**：手填/探得的 `screenSize` 按 key 缓存且**永不过期** ⇒ 会话中途转屏后所有坐标落在旧空间里，直到插件重启。

#### 整改方案与实施

- **门收成两项**：`preflight.ts` 352→165 行，只问 `adb` 与「有设备」；提供方五项**删除而非跳过**（跳过会让 `ok` 在不同范围下含义不同），`PreflightScope` 与 `PreflightInput` 随之消失，`run()` 不再要参数。G77 的两形态安装探测与 G79 的 `--serial` 规则随其检查一起退场。
- **按消费者计数删除**：`src/actionClient.ts`(87) / `src/mcpText.ts` / `scripts/{spike-mcp,mock-action-server,dump-proxy}.mjs` / `tests/{actionClient,clientHalf,mockServer}.spec.ts`；镜像链 `src/scrcpy/{server,input}.ts`(333) + `scrcpyEnabled|ServerPath|MaxFps|MaxWidth|BitrateMbps` 五字段 + `tests/scrcpy.spec.ts`(225)。`ctx.effect` 的清理面从「两个 MCP 客户端」缩成「一个 OCR worker」，注释同批改对（它此前已在说谎）。
- **§一.3 的读法落进代码**：adapter 不删，**第一次给它消费者** —— `autogamer_diagnose` 增 `provider{configured,command,reachable,error}`：默认 `artemisMcpCommand: []`（**空 ⇒ 永不 spawn**），配了才 lazy 连一次问设备态；连不上只写一行建议并声明「插件自己的 adb 路线不需要它」，检查自己抛错也不炸诊断（与 OCR 的诊断项同构）。
- **覆盖面锁换成可离线复跑的形态**：`py-action-tools.json`（2026-10-13 活服务名单）成为**历史权威**，锁的是分区 —— 11 条原生 adb + 2 条路由器本地答（`take_screenshot` / `get_ui_hierarchy`）+ 2 条带理由的放弃（`list_devices` T2-a、`compare_ui_frames` T3）= 15，一条不多不少；「原生」那 11 条**逐个打到 `runNativeAction` 上证明 case 真在**（空 payload ⇒ 命中各自参数错误而非 `unsupported action`），另加**反向对照**（名单外的名字必须被判 unsupported），否则覆盖面锁可以是空的。
- **两条差距就地收**：G90 —— `resolveScreenSize` 的缓存加 `SCREEN_SIZE_TTL_MS = 5_000`（实测一次 `screencap` ≈200ms，一回合内复用足够，转屏最多粘 5 秒）；G89 —— **裁定结案为已知边界**：执行模型是「一进程一插件实例」，进程内 FIFO + 熔断生效，py 文件锁守的是「多个 python 入口抢同一台」那个已随 D19 消失的场景，解锁条件写进 `enumerateRoster` 注释与本行互指。
- **又一条放弃记录（§一.4 要求的落点）**：`notes / plan` 语法实测**零消费者**（那两个消费者 checker/explorer 按 D8 本就不迁；插件树里 `notes`/`plan` 只出现在一句给模型的提示文案中）⇒ **不迁移**，规格 §二 该行由「未开工」改为「已砍」。
- 文档口径同步：README（Layout 少 4 行、脚本清单、R15 超时落点、零配置一段）、规格 §二 六行、本文件 §零/§四/§七。

#### 验收标准

- `pnpm --config.verify-deps-before-run=false run verify` ⇒ **38 文件 / 437 通过**（T5 后是 42/470+1 skip；文件与用例数同时下降 = 删掉的提供方/镜像锁多于新增，别读成退步）。
- 变异 **N1–N10 全部落地**（`node scratch/mutate-t4.mjs` → `scratch/mutate-t4.txt`）：N1 门多问一项 / N2 缓存永不过期 / N3 完全不缓存 / N4 提供方检查炸诊断 / N5 未配置被判故障 / N6 原生 case 丢失 / N7 unsupported 判据消失 / N8 提供方默认指回 python / N9 被删面被重新点名 / N10 被删配置字段复活。
  ⚠️ **N2 第一次是绿的**：G90 判据的时钟跳量当初写成 `SCREEN_SIZE_TTL_MS + 1`，于是「把 TTL 改成永远」的变异把跳量一起放大 ⇒ **判据自我失效**。改成绝对秒数（1s 内复用 / 6s 后重问）后才红。这是本分支第三次撞上同一条：**判据必须被证明会红**（R27），前两见 #92（Q2/Q4 落在桩上）与 §零（门禁 M1 锚点腐烂）。
- D19/D20 判据读数：`git ls-files '*.py'` = **0**；`git grep -l 'Google LLC' -- ':!docs'`、`'Apache License'`、`minitap` 同形过滤后 = **空**；`third_party/` 被跟踪 = **0**；无 CI 配置（本分支无 CI ⇒ 不写「由 CI 保证」）；`git remote -v` 只有 **origin**；根 `LICENSE` 为自撰 MIT。
- 删除面：`git grep -E 'ActionClient|ScrcpyManager|scrcpy|ACTION_TO_PY_TOOL|uvPath|artemisRepoPath|mcpText|unwrapText' -- plugins` 只剩注释与锁自身，并由 `contracts.spec`「stay removed」一条钉住（N9 证明会红）。
- R6：`dsh --profile web --patch <abs>/cordis.patch.yml --dump-config` ⇒ exit 0 / `unmatched` 0 / `autogamer` 行 16（本片不动 patch，跑它是证明配置面收窄没打断 preset 行）。
- 仍开：**G94**（宿主内 live 证明 —— 本机阻塞在宿主 spawn 路径含空格的缺陷上，R1 不许解包 `app.asar` 继续查）、**G91**（长按语义，与 G94 同批）、**G92**（OCR 召回）、**G88 / G78**（待需求）。

## 三 · 门禁与基建

### #95 门禁自检进 pre-commit，七条变异全部改为结构锚点（基建-2 的复发收口）

#### 问题描述

- `check-docs --selftest` 的变异用例**锚在正文文字上**，而正文会被它记录的实测改掉：
  - **第一次（M1-C1）**：锚点是 §四 G78 那一行的字面文字，前置-2 改写该行措辞后变异不再落地，`--selftest` 报 BLIND（当时只记录、未动门禁范围，见 `TODO.md` §零）。
  - **第二次（M5-C5 / M6-C5，本次）**：两条都锚在 §四 **G86 行**的文字上，而 **T4 正是结案并删除 G86 那一行**的那次改动 —— 于是同一批提交里两条变异同时失明，而门禁本体仍 `OK / exit 0`（它自己不知道自己已经少证了两条）。
- 结构性原因：**「锚点腐烂」与「判据失灵」是同一件事的两种说法**（R27），而 `--selftest` 只在人想起来手跑时才说话。本分支无 CI，手跑就是没有。

#### 整改方案与实施

- `scripts/check-docs.mjs`：抽出 `insertIntoGapTable()`（在 §四 表头的 `|---|` 分隔行之后插行）与 `untickFirstBoxAfter(text, "### 前置-4")`（**先按行首定位小节、把范围截到下一个 `### ` 之前，再在该小节内找 `**Done means**`，翻转其中第一个 `- [x]`**），**七条变异全部改用结构锚点**；把这条规则写成文件里的注释（MUTATIONS 段头部），不再靠人记。
- ⚠️ **改造程中自己踩到第二种锚点病**：`untickFirstBoxAfter` 的第一版用裸子串 `indexOf('### 前置-4')` 定位小节 —— 而 §零 的台账正文里**就引用了这串标题文字**（正是本次改动写进去的），于是变异落到了**前一个小节**的 Done 块上，C6 仍绿、`--selftest` 报 BLIND。锚点光「结构化」不够，还得**按行首匹配并限定作用域**；这条也写进注释。
- `.githooks/pre-commit`：门禁通过后**再跑 `--selftest`**（实测 87ms，代价可忽略），触发条件除文档路径外**加上 `scripts/check-docs.mjs` 本身** —— 改门禁的人必须在当场看到自己的用例是否还落地。
- `AGENTS.md`「文档门禁」段同步为现状，并把锚点规则写进去。

#### 验收标准

- `node scripts/check-docs.mjs --selftest` ⇒ `OK (6 checks, 7 mutations, none blind)`。
- **A/B 实测两道拦截**（都是「先造出该拦的情形，提交被拒、HEAD 不动，再恢复」）：
  - 门禁条款：向 `docs/TODO.md` 追加一行三列表格（表头两列）⇒ 拒，`C5 docs/TODO.md:1219 -> row 3 has 3 cells, header has 2`。
  - 自检条款：把 M1 的锚点改成不存在的标题 ⇒ 拒，`the gate's own mutations did not all land - a check has gone blind`；恢复后 `--selftest` 七条全落地。
- 已知边界：`--selftest` 证明的是「七条变异各自会红」，**不证明**检查覆盖了下一次会出现的新漂移形态；新增检查时仍须自带一条会红的变异（R27）。

### #96 OCR 的不可读帧会带崩宿主：识别前先验帧（#93 的后续修复）

#### 问题描述

- 量 G92 时（`TODO.md` §七「T5 收口记录」的放大补测）把一张**自己生成的、leptonica 读不了的 PNG** 交给 `worker.recognize`，进程直接死掉：
  `Error in pixReadStream: Unknown format: no pix returned` → `Error: Error attempting to read image.` → 栈顶是 `node:internal/event_target … process.nextTick(() => { throw err; })`。
- 关键在于**有两路错误**：awaited promise 会 reject（`createOcrEngine` 的 try/catch 接得住，返回 `undefined`），而 tesseract.js **另外**在 worker 上抛一个**无人处理的 error 事件** —— 这一路接不住，Node 视未捕获异常终止进程。
- 落到本插件就是真路径：`ocr(key)` 读的是 `exec-out screencap -p` 的字节，**截断/半帧是 adb 会发生的事**（T2-b 已实测过「退出码与消息都会撒谎，只有读回的字节可信」）。也就是说 #93 交付的「fail-open」在这一点上并不成立：**设备侧一次异常可能变成宿主进程崩溃**。

#### 整改方案与实施

- `src/ocr/recognize.ts`：`recognize()` 第一步用**坐标空间用的同一个 IHDR 读取器**（`parseImageSize`，`src/coord.ts`）验帧 —— 读不出尺寸就 `logger.warn` 并返回 `undefined`，**worker 根本不起**。放在懒建之前，所以坏帧既不 spawn 也不下载任何东西（`langPath` 那半边不变）。
- 判据落在两层，各证明一次：
  - `tests/ocrRecognize.spec.ts`（注入假件）：坏字节 ⇒ `undefined`、`workerFactory` **一次都没被调用**、warn 文案含 `not a readable PNG`；
  - `tests/ocrPackaging.spec.ts`（真 worker、真语言包）：截断 PNG ⇒ `undefined` 且 `status().workerStarted === false`，测试文件本身活着跑完。
- 顺带把单元 spec 里所有 `Buffer.from("png")` 换成带真头的帧（`pngHeaderOnly`）—— 它们之前测的是「假 buffer 也能过」这件事，而这件事现在恰恰不成立了。

#### 验收标准

- `pnpm --config.verify-deps-before-run=false run verify` ⇒ **38 文件 / 439 通过**（#94 后为 437）。
- 变异 **M15**（`node scratch/mutate-t5.mjs`，现共 15 条，全落地）：删掉验帧那段 ⇒ 包内那条锁红（真 worker 收到坏帧后进程被未处理 error 打断），证明这条判据会失灵。
- 已知边界：修的是「**我们能把字节交给 worker 之前**」这一段。若 tesseract.js 在别的场景（wasm 自身崩溃、语言数据损坏）仍抛未处理事件，本层无法通过公开接口挂 handler —— 该残留记在 `TODO.md` §七「T5 收口记录」，不在本片假装已解决。

### #97 宿主内 live 证明完成（G94、G91 结案；顺带修好一条一直报假的取证判据）

#### 问题描述

- T1–T4 的每一条判据都留了同一个尾巴：工具面**从未在跑起来的 DSH 进程里被真会话调用过**（R7 新会话、R9 官方检查器、R24 会话日志三件都缺）。此前记为「阻塞」，依据是 `dsh headless "…"` 一 spawn 就报 `'D:\DeepSeek' 不是内部或外部命令`（宿主为 profile 起子进程时路径含空格未加引号），而再往下查要解包 `app.asar`（R1 禁止）。
- **那条「阻塞」结论是错的**：它把 headless 一条路的故障当成了整个宿主的不可用。`dsh --profile web --no-open --port <p>` 能把宿主当本地服务起，浏览器带启动日志里的 token 进去就是正常界面。
- **G91（长按语义）** 此前不成立的原因是靶子不可区分（对照组与实验组反应一致 ⇒ 不是阴性结果，是无效实验）。
- 取证脚本 `scripts/conformance-live.mjs` 一直报 `tools invoked: none`。

#### 整改方案与实施

- **live 证明（2026-10-15 05:07–05:18，`emulator-5554`）**：
  - R9：插件面板「已安装 1 · AutoGamer 设备执行 v0.1.0」、启用开关 on、「包含的组件 共 2 个 · **2 运行中**」（`dsh-autogamer` + `preset-autogamer`）；Agent 预设选择器里出现 **AutoGamer**。
  - R7：新建会话并选该预设，跑三轮任务。
  - R24：会话 `session-f07d997c…` 共 **65 条记录**，`tool/call=7`、`tool/result=7`、`turn/end=3`（reason 全 completed），工具计数 `autogamer_get_device_state=1 / run_device_action=4 / report_task_status=2`。关键原文：`device_serial=emulator-5554; connected=true; …frame 1600x900…`；`hierarchy=#0 [800,450] pkg=app.lawnchair android.widget.FrameLayout …`（我们的 `#N` 编号在宿主里成立）；**`result=Success; target_source=hierarchy; effect=changed`**（闸门 + 原生 adb 动作 + 本地效果判定 + T5 的 `target_source` 同落一条结果）；`task outcome recorded: completed`。
  - R6：同 profile `--dump-config` exit 0、`unmatched` 0。
- **G91 复测（换成可区分的靶子：桌面 `设置` 图标 —— tap 会打开应用，long-press 会弹 Lawnchair 的快捷菜单）**：基线 `menu=[]`；`input motionevent DOWN → sleep 1.5 → UP` ⇒ `menu=["应用信息"]`；**现行实现 `input swipe x y x y 1500` ⇒ 同样 `menu=["应用信息"]`**。⇒ 长按语义成立，实现不动。此前那次「两形态都 code=0 且反应一致」的实验，是因为它跑在**已经被上一次 tap 打开的 Settings 里**（宿主会话日志里能看到 `pkg` 已变成 `com.android.settings.intelligence`），不是手势无效。
- **修取证判据**：`readSession()` 改为**按 zstd 帧魔数逐帧解压**（Node 的解压器不跨帧，无论 stream 还是 sync），并跳过仍在写入的帧。同一文件：**1 条记录 → 65 条**。原注释写着「multi-frame」而代码做不到，属注释说谎；这条改完，`conformance-live.mjs` 对本会话给出 `declared=ok live=ok`。

#### 验收标准

- `node plugins/dsh-autogamer/scripts/conformance-live.mjs --cwd "D:\DEV\autoGamer" --expect-tool run_device_action --expect-tool report_task_status --expect-tool autogamer_get_device_state` ⇒ 三个 expect 全部 `called Nx`、`verdict: declared=ok live=ok`（复跑需宿主里有那几次调用；日志是持久件，故本条可离线复跑）。
- 反向自证：修复前同一命令对同一会话报 `tools invoked: none` —— 判据失灵过一次即不算判据（R27），这也是为什么这次先把读数抄进台账再改代码。
- 复现 live 的路径（新机器/将来复跑）：`dsh --profile web --no-open --port 8731` → 打开日志里带 `?token=` 的地址 → 插件面板核 `运行中` → 新建会话选 AutoGamer 预设 → 让它调 `autogamer_get_device_state` 与一次 `run_device_action`。
- 遗留：`G92`（OCR 整页召回，形态是「按区域识别」，新设计另立条目）、`G88` / `G78`（待需求，非待办）。**T1–T4 的功能面至此没有未验证项。**

### #98 依赖构建脚本策略定案：tesseract.js 的安装脚本不执行（基建-3 结案）

#### 问题描述

- T5 把 `tesseract.js` 带进依赖面后，`pnpm install --frozen-lockfile` 在本机 **退出码 1**：`[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: tesseract.js@7.0.0`（附一句 `Run "pnpm approve-builds"`）。
- **仓库不钉 pnpm 版本**：根无 `package.json`、插件包无 `packageManager` 字段、根无 `.npmrc`；本机实测 **pnpm 11.21.0**。新版 pnpm 把「被拦截的构建脚本」当**错误**退出，旧版只当告警 ⇒ 新 clone 的机器会先撞上一次**没有任何文档能解释**的 exit 1。
- **更硬的一条**：那次安装**改写了被跟踪文件** —— `plugins/dsh-autogamer/pnpm-workspace.yaml` 被写入 `tesseract.js: set this to true or false`。安装动作不该改仓库文件，而且这不能靠「记得 `git checkout`」兜住：下一个新增依赖会再发生一次。
- 该脚本的实质（读安装后的包元数据）：`postinstall = "opencollective-postinstall || true"` —— 打印一条赞助横幅，**无任何功能性产物**。OCR 的语言数据是**随包 vendored** 的（`ocr/*.traineddata.gz` 已进 `files`、`langPath` 指包内，见 #93），所以「必须构建才有产物」这件事对本依赖不成立。

#### 整改方案与实施

- `plugins/dsh-autogamer/pnpm-workspace.yaml`：`allowBuilds` 增 **`tesseract.js: false`**，沿用文件里既有的键与 `esbuild: true` 的写法（不引入新键名）。
- **取显式 `false` 而不是删键**：删键等于回到「每次安装改仓库文件 + 非零退出」的老形状；显式键才有表态 —— pnpm 只对 `true` 执行。
- 保留 `esbuild: true`（vitest 依赖它的原生二进制，那条确实要构建）。本条只处置「**无产物、只出网打印**」这一类，不顺手放宽别的依赖。
- 解锁条件随判定一起写进台账：将来某个依赖的 `postinstall` **确有产物**（要编译原生模块之类）⇒ 该条必须改 `true`，并在台账与本文件同时记明依据。本条否掉的是这一类脚本，不是对 `tesseract.js` 的永久否决。

#### 验收标准

- 在 `plugins/dsh-autogamer/`：`pnpm --config.verify-deps-before-run=false install --frozen-lockfile --config.autoInstallPeers=false` ⇒ **exit 0**、输出无 `ERR_PNPM_IGNORED_BUILDS`；仓库根 `git status --short` 中 `pnpm-workspace.yaml` **不出现**。
- **A/B（R27）**：同一台机器、同一 lockfile、同一条命令 —— 占位形态（`tesseract.js: set this to true or false`）**exit 1**，定案形态 **exit 0**。本条「问题描述」里那次安装的读数就是占位形态的原始证据，唯一变量就是这一行。
- 回归：`pnpm --config.verify-deps-before-run=false run build` ⇒ exit 0；`… run test` ⇒ **38 文件 / 439 通过**；`node scripts/check-docs.mjs`（6 checks / 9 tracked md）与 `node scripts/check-env.mjs` ⇒ exit 0。
- 提交：方案 `2fb1982`（R22 先方案后实现）→ 实现 `9dea904`。

> **本条记的那笔债（pnpm 版本未钉）已由 #99 结清**，`pmOnFail: error` 现在会在版本不符时 exit 1。下面这段保留作当时的读数。

### #99 包管理器版本钉死：版本不符一律 exit 1（基建-4 结案；结清 #98 记的那笔债）

#### 问题描述

- #98 结案时按规矩记了一笔债：**仓库不钉 pnpm 版本**（根无 `package.json`、插件包无 `packageManager`、根无 `.npmrc`；本机实测 11.21.0），所以「#98 那条策略在更新版本上是否仍被支持」**未验**。
- 债的根子是 #98 的问题描述里那件事本身：**pnpm 各版本对「依赖的构建脚本被拦截」处理不一致**（新版非零退出，旧版只告警）。同一条安装命令在不同机器上结论不同，而仓库里没有任何一处能解释这个差异。
- 取证面（R20 第 1 步，官方文档，转述不搬文本）：
  - `pnpm.io/settings/cli` 的 `pmOnFail`（Added in v11.0.0，**默认 `download`**）定义版本不符时的四种行为 `download` / `error` / `warn` / `ignore`，并**取代已被移除的** `managePackageManagerVersions`、`packageManagerStrict`、`packageManagerStrictVersion`；错误信息自带绕过方式。
  - `pnpm.io/package_json` 的 `devEngines.packageManager`（Added in v11.0.0）支持**版本范围**，但解析出的版本会写进 `pnpm-lock.yaml` 的 `packageManagerDependencies`；同页说明 legacy `packageManager` 字段在声明 pnpm 12 时才会把解析信息写进 lockfile。
  - `pnpm.io/settings` 写明 v11 起**只有 auth/registry 从 `.npmrc` 读**，其余设置一律在 `pnpm-workspace.yaml`。
  - 本机实测：`pnpm -v` = 11.21.0；**`corepack` 未安装**（Node 24.14.1）⇒ 钉法必须走 pnpm 自带机制。

#### 整改方案与实施

- `plugins/dsh-autogamer/package.json` 增 `"packageManager": "pnpm@11.21.0"`；同目录 `pnpm-workspace.yaml` 增 `pmOnFail: error`。
- **精确版本而不是范围**：范围会把 #98 那个洞重新打开 —— 11.5 与 12.x 对「构建脚本被拦截」的处理不同，非零退出与否会随范围漂移。
- **legacy 字段而不是 `devEngines.packageManager`**：后者按官方文档会把解析版本写进 lockfile；前者在本版本下 lockfile 零变化（实测 `pnpm-lock.yaml` 不出现在 `git status` 里）。本仓库把 lockfile 变动视为需要解释的产物。
- **`error` 而不是默认的 `download`**：默认行为是**下载并改用**声明版本 —— 一次静默的网络动作加一次版本切换；判据要求不一致时立刻暴露。
- **不写 hash**（`pnpm@11.21.0+sha512.…`）：hash 校验的是下载物，而 `error` 模式下不会下载；corepack 缺席也生成不出来。
- **边界（如实写进 `AGENTS.md`）**：钉在插件工程 —— 全仓唯一的 `package.json`，也是所有文档命令的工作目录；**从仓库根跑 pnpm 不受本钉约束**（根无 manifest，那也不是文档化的用法）。误配时的临时绕过（`--pm-on-fail=ignore|warn`）、正解与升版流程一并写进 `AGENTS.md`。

#### 验收标准

- 匹配态：`pnpm --config.verify-deps-before-run=false install --frozen-lockfile --config.autoInstallPeers=false` ⇒ **exit 0**，且 `pnpm-lock.yaml` **不出现在** `git status --short` 里。
- **A/B（R27）**：`packageManager` 改成 `pnpm@9.15.0` ⇒ 那条安装命令 **exit 1**，报 `[ERROR] This project is configured to use 9.15.0 of pnpm. Your current pnpm is v11.21.0`，且失败**发生在任何下载/改动之前**（`node_modules` 与 lockfile 均无变化）；改回即复绿。`pnpm -v` 同样 exit 1 —— 即**每条命令都受约束**，不只安装。
- 回归：`pnpm --config.verify-deps-before-run=false run verify` ⇒ 三段全绿（**38 文件 / 439 通过**）；`node scripts/check-docs.mjs`（6 checks / 9 tracked md）与 `node scripts/check-env.mjs` ⇒ exit 0。
- **判据的边界**：它证明的是「版本不符会响」，**不证明 11.21.0 本身是正确选型** —— 那是选定值，升版由人决定，流程在 `AGENTS.md`。
- 提交：方案 `8f7c835` → 实现 `6e30db2`。
- **顺带发现（同轮落账，未修）**：`plugins/dsh-autogamer/.npmrc` 里的 `auto-install-peers=false` 在 pnpm 11 已不被读取（实测 `pnpm config get auto-install-peers` → `undefined`，而同目录 `allowBuilds` 从 `pnpm-workspace.yaml` 读得到）。今天无害（文档命令显式带该旗标，且两个 peer 都在 `peerDependenciesMeta` 里标了 `optional`），但**未验裸 `pnpm install` 的 peer 行为**，不夹带进本条，记账在 `TODO.md` §七「基建-4」。

> ⚠️ **上面那条「无害」的判断已被本轮实测推翻，并由 #100 结清**：它不是无害 —— lockfile 记着 `autoInstallPeers: false` 而有效默认是 `true`，于是裸 `pnpm install --frozen-lockfile` 直接 exit 1。权威记录见 **#100**。

### #100 peer 设置搬进 pnpm-workspace.yaml：一条最朴素的命令从 exit 1 复绿（基建-5 结案；结清 #99 记的那笔发现）

#### 问题描述

- #99 的「顺带发现」把 `plugins/dsh-autogamer/.npmrc` 里那行 `auto-install-peers=false` 记成「今天无害，只是没验」。本轮把它量到底，**那个判断是错的**：
  - pnpm 11 只从 `.npmrc` 读 auth 与 registry（官方文档），所以那行**从未生效**；
  - 而 pnpm **11.21.0 的有效默认是 `true`**（实测，见下）；
  - 仓内 lockfile 记着 `settings.autoInstallPeers: false`（每条文档命令都带 `--config.autoInstallPeers=false`）。
  - 两边对不上 ⇒ **`pnpm install --frozen-lockfile`（不带任何旗标）直接失败**：`[ERR_PNPM_LOCKFILE_CONFIG_MISMATCH] Cannot proceed with the frozen installation. The current "settings.autoInstallPeers" configuration doesn't match the value found in the lockfile`，**exit 1**。
- 即「无害的死配置」实际是一枚**已经上膛的雷**：最朴素的那条命令今天是坏的，而仓库里没有一处文档说它坏在哪。

#### 整改方案与实施

- `plugins/dsh-autogamer/pnpm-workspace.yaml` 增 **`autoInstallPeers: false`**（v11 的设置家，与既有 `allowBuilds` / `pmOnFail` 同文件）。
- **删除** `plugins/dsh-autogamer/.npmrc`：全文只有那一行（25 字节），留着等于同一个设置两处声明而其中一处哑。已核对它**不在** `package.json` 的 `files` 里 ⇒ 不进交付 tarball，宿主 `dsh plugin` 走 link/pack 也不读它，删除不影响宿主。
- **值不变**（仍是 `false`）：本条是搬迁 + 让它生效，不是改策略。文档里那些命令的旗标**一律保留** —— 它们仍有效且与文件一致，去掉会波及整本台账的历史读数且没有收益。
- `AGENTS.md` 写明「设置的家是 `pnpm-workspace.yaml`；`.npmrc` 只留给 auth/registry」，并把「设错地方 ⇒ 朴素命令变红」这一具体后果写在旁边。

#### 验收标准

- 设置真的被读到：插件目录 `pnpm config get autoInstallPeers` ⇒ **`false`**（改前 `undefined`）。
- **A/B（R27）**：裸 `pnpm install --frozen-lockfile` ⇒ 改前 **exit 1** + `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`，改后 **exit 0**；两次之后 `git status --short` 都**不出现** `pnpm-lock.yaml`。
- **单变量隔离（不只证「一起改完是绿的」）**：把 `.npmrc` 那行临时写回（未跟踪）⇒ 裸安装**仍 exit 0** ⇒ 生效的是文件里的设置，那行从未参与；删除它是去掉重复声明，不是「碰巧同时修好」。
- **两向证明该设置有牙**（临时区最小工程，`react-dom@19.0.0` + 非可选 peer `react ^19`，不入库）：默认时 lockfile 记 `settings.autoInstallPeers: true` 且虚拟 store 里有自动装入的 `react@19.3.0`、快照写成 `react-dom@19.0.0(react@19.3.0)`；写 `false` 后 lockfile 记 `false`、`react` **不在树里**、快照不带 peer 后缀。
- 回归：文档那条安装命令 exit 0；`pnpm --config.verify-deps-before-run=false run verify` ⇒ 三段全绿（**38 文件 / 439 通过**）；`node scripts/check-docs.mjs` 与 `node scripts/check-env.mjs` ⇒ exit 0；`git grep 'auto-install-peers' -- plugins` ⇒ **零命中**。
- **方法上的自纠（R27）**：探针第一版判据看的是 `node_modules/react` 存不存在 ⇒ **两种情况都「不存在」，是假绿** —— 自动装入的 peer 只进虚拟 store、不做顶层链接。改成读 lockfile 的 `settings:` 与快照后缀才咬住。这是本分支同类事故的第四次（#92 两条落在桩上、T4 一次判据自我失效、门禁锚点两次腐烂），**判据要落在记录事实的地方，不是落在你以为的路径上**。
- 提交：方案 `9a07618` → 实现 `d524739`。

### #101 构建前清空 dist：交付 tarball 曾携带五个已删除模块（packed 交付验证发现）

#### 问题描述

- 第一次做 packed 交付验证（`pnpm pack` 出 `dsh-autogamer-0.1.0.tgz`，验证过程见 `TODO.md` §七「交付-1」），列出 tarball 内容发现 **5 个 `src` 已删除模块的陈旧编译产物仍在分发**：
  `dist/actionClient.js`、`dist/mcpText.js`（T4 按消费者计数删除）、`dist/prompt/rulesInjector.js`（#84 / D20 红线拆除的链）、`dist/scrcpy/input.js`、`dist/scrcpy/server.js`（G93 删除的镜像链）。
- 根因：`tsc` 向 `outDir` 增量写、**从不删除已无源文件的产物**；而 `package.json` 的 `files` 白名单是 `dist/**/*.js`，于是每次删除源文件后，旧 `.js` 仍原样进 tarball。`dist/` 在 `.gitignore` 里、`git status` 始终干净，所以工作树层面完全看不见这堆死重——只有真正 pack 一次才暴露。
- 为什么 link 形态没发现：宿主 `link:` 安装时运行时 import 图无人引用这些模块，功能不受影响；但它们是**被裁决删除**的模块（其中 `rulesInjector` 属 D20 红线），以编译形态继续随交付物分发即违背删除裁决。

#### 整改方案与实施

- 新增 `plugins/dsh-autogamer/scripts/clean-dist.mjs`（零依赖，`rmSync(dist)`）；`build` 脚本由 `tsc -p tsconfig.json` 改为 `node scripts/clean-dist.mjs && tsc -p tsconfig.json`，让每次构建的输出树只能镜像 `src`。
- 新增 `tests/distStaleness.spec.ts` 守卫：`dist` 存在时，每个 emitted `.js` / `.d.ts` 必须有对应的 `src/**/*.ts`，违例即红；`dist` 不存在（vitest 直读 `src` 的场景）时该组 skip，不强制先构建。
- 清理旧 `dist` 后重建、重新 pack 核验。

#### 验收标准

- 重新 pack 的 tarball 不含上述 5 个模块（`dist/prompt/`、`dist/scrcpy/` 目录不再出现），条目与 `files` 白名单逐一对应。
- **变异（R27，两条都证明会红/会清）**：① 手工放 `dist/__stale__.js` 与 `dist/prompt/rulesInjector.js` 后跑守卫 ⇒ 测试**红**，且精确报出这两个文件名；② 放假产物后跑 `pnpm build` ⇒ clean 步骤把它们删掉，守卫复绿。
- 回归：`pnpm --config.verify-deps-before-run=false run verify` ⇒ 三段全绿（**39 文件 / 440 通过**，上一绿态 38/439，新增守卫 1 条）。
- 注：`scripts/clean-dist.mjs` 是开发期工具、不进交付 tarball（`files` 白名单未列 `scripts/`，符合预期）。

### #102 G92 探针 A：区域 OCR 管线落地（P1 候选裁剪/放大/逐块识别/坐标映射）

#### 问题描述

- T5 已实测（数字见 `TODO.md` G92）：整帧 OCR 的瓶颈是 tesseract 的**整页版面分析**而非像素——真机桌面 24 个文字节点整帧只认出 0–3 个，而把「游戏中心」所在 140×70 块裁出 @2× 即正确读出。G92 立项的「按区域识别」需要先有一条**可验证的区域管线**：裁剪候选框、放大、逐块喂给现有单例 worker、把块内 bbox 映射回全屏。仓内此前只有 PNG 解码，无裁剪/放大/编码。
- 探针 A 的目标是离线证明**机制正确**（坐标不漂、候选过滤对、失败 fail-open），不证明召回增益（增益要真机难帧，探针 B/C）。

#### 整改方案与实施

- 新增 `src/ocr/image.ts`（零依赖）：`cropImage`（行拷贝裁剪 + 越界 clip）、`upscaleNearest`（最近邻，支持分数倍、rounded reverse mapping 不丢源像素）、`encodePng`（depth-8 / color-type-2 RGB / filter None / `deflateSync` / 手写 CRC32 表）、`clipBox`/`paddedBox`；解码复用 `src/effect/png.ts`，延续 T5 否掉 `sharp`/`pngjs` 的口径。
- 新增 `src/ocr/regions.ts`：`selectRegionCandidates`（有效 bounds、非零、不越界、面积比 ≤0.25、同 bounds 去重、丢弃完全包含其他候选的容器、面积升序、cap 40）、`mapHitToFrame`（块内 bbox 经 scale 与裁剪 origin 映射回全屏，含嵌套 words）、`recognizeRegions`（逐块裁剪→padding 8→@2×→编码→`recognize`，合并进 `OcrPage`；墙钟预算 30s + `AbortSignal`，单块返回 undefined 或抛错都跳过 = fail-open）。导出 `DEFAULT_REGION_OPTIONS`，常量留待探针 B 真机重定。
- **探针 A 不改产品阶梯**（`runDeviceAction.ts` 的 hierarchy→整帧 OCR 阶梯未动）；区域识别是未来的第二级，接线属探针 B/C 后。
- **真模型实测修正了原方案预期（R28）**：夹具帧（Chrome tab overview）候选过滤后 16 个叶级框**全部落在 y≤204**（标签栏/工具栏/omnibox/状态栏），而整帧能读的 `TapTap`→(1206,241)、`游戏中心`→(1003,240) 在 y≈240 的缩略图渲染区，层级里只有全屏容器 ⇒ **P1 对二者 undefined**。这不是管线缺陷，而是 G92「核心设计矛盾」的离线实证：P1 只覆盖「层级有结构无文本」，纯渲染区要靠 P2/P3。16 块全扫 ≈1457ms（整帧 1666ms），且每个区域命中都落回其候选框内（坐标映射端到端证据）。

#### 验收标准

- 新增测试 3 文件 26 条：`tests/ocrImage.spec.ts`（10，像素级裁剪/放大/编码 + 编码往返 `decodePng` 像素一致）、`tests/ocrRegions.spec.ts`（14，候选过滤/容器去重/坐标映射/预算/signal/fail-open）、`tests/ocrRegionProbe.spec.ts`（2，真模型：命中落回候选框、P1 边界 + 整帧对照）。
- **变异（R27，三处植入均精确锁红后还原）**：① `mapHitToFrame` 丢 origin ⇒ 3 条坐标映射锁红；③ 单块 catch 由 `continue` 改抛错 ⇒ fail-open 锁红；④ 容器过滤放行全部 ⇒ 「丢弃容器」红（容器框漏入）。变异②（阶梯锁）因本轮不接阶梯而不适用，留待接线。
- `pnpm --config.verify-deps-before-run=false run verify` ⇒ **42 文件 / 466 全过**（基线 39/440，新增 3 文件 26 条）；`node scripts/check-docs.mjs --selftest` 7 变异无假绿；`node scripts/check-env.mjs` 干净；README Layout 已同步 `image.ts`/`regions.ts`。
- 未闭环（不静默）：探针 B（真机难帧召回、定 padding/scale/过滤常量）与探针 C（纯 webview 帧判 P2 去留）均阻塞在 adb + 设备，与「交付-1」C 项同一前置；G92 不结案。

### #103 文档对齐-1：七个文档面逐条对齐当前实现（纯文档轮；含一处指向不存在编号的悬空引用）

#### 问题描述

读文档准备下一片时，发现**文档说的**与**代码/实测的**已经分叉，而本分支的纪律把文档当作下一个 agent 的唯一现状来源（R28）——
分叉本身就是负债。逐面核出的漂移分三类：**指向已删或已结案的对象**、**与实测相反的旧表述**、**缺失的操作事实**；
逐条清单与核验都在本条的「验收标准」段，不在这里复述（避免同一份清单有两处）。最刺眼的一条是悬空编号：
交付-1 三处引用的 `G97`（「postinstall 无产物」裁决），**在本分支与归档 `registry.md` 里都不存在**。

#### 整改方案与实施

- **规格 `ts-fullstack-spec.md`**：§二 三行（设备动作 / 任务编排 / 轨迹持久化）仍挂着已结案的 **G91 / G94** ⇒ 改成实测结论并指向 **#97**，
  同时把「**三任务工具的宿主内点名仍未做**」如实留给 `TODO.md` §七「交付-1」C 项（#97 的会话里实跑的是执行路由与设备态那几条）；
  §一.3 仍把已删的 `artemisRepoPath` 写成活路径 ⇒ 改为「配置面只剩 `artemisMcpCommand`（默认 `[]`），唯一消费者是 `autogamer_diagnose`」；
  §一.1 的「CI 无 python job」补上「本分支无 CI」这个前提；§四.1 那句「py 侧已知为扁平」是**前置-1 已否证**的旧表述（设备侧是嵌套树，
  「扁平」是解析产物）⇒ 就地更正；§四.4 的提供方边界补上「T4 已全部完成」。
  OCR 行补记区域化第二级已落地但**未接产品阶梯、当前无生产消费者**（G92 探针 A）。
- **守则 `plugin-contract-rules.md`**：四条判据指向的对象与本分支现状不符 ⇒ R15（`ActionClient` 的 `Promise.race` 随 T4 删除，
  超时改由 `src/device/adb.ts` / `src/ocr/recognize.ts` / `src/artemis/mcpBackend.ts` 自实现）、R19（「两项都缺，已登记为 G32」——locale 与 icon 早已在位并经面板核验）、
  R21（引的「宿主交互实现审查」表属归档分支，未随迁）、R2（`spike/` 目录未随迁）；文首的编号权威由 `registry.md` 改指 `../TODO.md`。
- **插件 `README.md`**：Layout 里 preflight 仍写「7 项 / 可按 provider·device 范围取」（实际 `run()` 无参数、只两项）、
  `getDeviceState` 写「外部 ARTEMIS 透传」（透传已删，provider 唯一消费者是诊断）、脚本清单漏 `clean-dist.mjs`；
  补一条边界声明：`src/ocr/{image,regions}.ts` **没有生产消费者**（别当已在跑的 OCR 路径，也别按「没人调用」删掉）；
  「引入与验证」新增**交付形态三条**（面板输入 `.tgz` / 每个新 profile 首次安装必遇 `tesseract.js` 构建脚本授权（R19 用户点）/ 替换安装后必须重启宿主）。
- **`AGENTS.md`**：「已结案变更 → 本分支尚无 CHANGELOGS 文件」不成立（该文件 #84 起就在用）、「四期路线」实为 T1–T5；
  新增 `verify` 的真实形状（`tsc → tsc → vitest`，**不含** `clean-dist`，那步只在 `build` ⇒ 交付/pack 前必须先 `build`）、
  `scripts/ocr-probe.mjs` 与交付形态的指针。
- **根 `README.md`**：「现状」还停在「从零重建中」⇒ 改写为已落地 + 唯一真待办（G92，区域识别未接线、等真机探针），G88/G78 标为待需求。
- **`TODO.md`**：清掉三处 `G97`（改指 §七「基建-3」/ **#98**，并按 R28 就地标注更正理由）；§零「复测」那行的 `verify` 描述改为指向 `AGENTS.md`；
  新增 §七「文档对齐-1」条目（What/How/Verify/Done）与 §零 指针行。

#### 验收标准

- **逐条可复核**（本轮每条改动都配了核验，而不是「看着顺眼」）：preflight 两项与无 scope 参数 ⇒ 读 `src/env/preflight.ts`
  （`PREFLIGHT_CHECK_IDS = ["adb","adb-devices"]`、`run()` 无参）；`getDeviceState` 无 provider ⇒ 读 `src/tools/getDeviceState.ts` 的 deps；
  `artemisRepoPath` 已删 ⇒ `git grep -n artemisRepoPath -- plugins/dsh-autogamer/src` **零命中**（且 `tests/conformance/contracts.spec.ts` 有「stay removed」锁）；
  `verify` 不含 clean ⇒ 读 `package.json` 的 `scripts`（`build` 有、`verify` 没有）；locale/icon 在位 ⇒ 读 `locale/{en,zh}.json` 与 `icon.svg`。
- **悬空引用的活引用清零**：`git grep -nE "[G]97 第三源实锤|[G]97 与本次日志双证|[G]97「postinstall 无产物」裁决" -- docs AGENTS.md README.md` ⇒ **零命中**（对齐前 3 处）。
  模式写成字符类 `[G]97` 是因为**零命中型判据一旦把自己写进被搜文件就会命中自己**（第一版写成裸 `G97…`，一跑就红，当场改口径，R27）。
  `G97` 这个串本身仍出现在**记录这次删除**的行里（`TODO.md` 的就地标注与文档对齐-1 条目、本条），这是 R28 要求的「就地标注」而不是残留活引用——
  判据因此只钉「不再当活引用」，不写成「全文不得出现该串」。
- **纯文档轮证明**：`pnpm --config.verify-deps-before-run=false run verify`（在 `plugins/dsh-autogamer/`）⇒ **42 文件 / 466 通过**，
  与对齐前同读数；其中 `tests/readmeLayout.spec.ts` 机械核对插件 README 的 Layout 块与 `src/` 实际文件（Layout 行描述被改，文件名列表未动）。
- 门禁：`node scripts/check-docs.mjs` 与 `node scripts/check-docs.mjs --selftest` ⇒ exit 0（本轮动了表格行、散文与两处清单）；
  `node scripts/check-env.mjs` ⇒ exit 0。
- 不结清任何 `G*`、不动 §四 开放差距表、不新增任何派生读数（§零那条只写「读数不变」并给复测命令）。
- 提交：方案与结案同一条 commit（本条是文档动作，无实现可分；方案先行（R22）适用于**代码**改动，文档轮的做法记录在 `TODO.md` §七「文档对齐-1」的 How-1）。

### #104 文档门禁补第七条检查 C7；另一条盲区判定为不写（基建-6 结案）

#### 问题描述

- 基建-2 结案时对自己做过一次门禁盲区自测，把两条**实测确认会漏**的形状记进 §零 并写「属后续项」：
  ①「同一事实的两处状态不一致」（§零 状态行说未开工、而 §七 跟踪行已勾完成）抓不住；②「§四 表内编号唯一性」不查 —— 把 §四 一行的编号重复一次，门禁仍 `OK` / exit 0。
- ② 的根因值得单独记：**C1 把 §四 的编号收进 `Set`** —— Set 正是去重结构，也就是**结构上不可能看见重复**。这不是漏写一个分支，是数据选型本身看不见它。
- 本片不预设「两条都写掉」，按 R20 先清点（只读探针，`scratch/`，不入库）。

#### 整改方案与实施

- **清点结论（决定了只写一条）**：
  - §四 今天 **3 行 / 3 个不同编号，零重复** ⇒ 判据零歧义、且有实测过的历史违例 ⇒ **C7 可写**（与 C5 同性质：守住结构不变式，不是抓现存漂移）。
  - ① 在 HEAD 上**零样本**：26 个 §七 条目里只有两个未全勾 —— **交付-1 4/5**（C 项阻塞）、**G92 3/8**（探针 B/C 等），而 §零 的指针行**都如实写了**「阻塞 / 探针 B/C 待设备」。**没有样本的检查是永不红的假判据**（R27）⇒ **不写**。
  - 另外两条让「按名配对」天然脆的事实（所以更不该现在写）：条目名**两种形状并存**（`### 小节` vs §七 顶部 `- [x]` 清单项）；`T1` / `T2` / `T3` **各有两个同名小节** ⇒ 「名字 → Done means」不是单射。
  - ①在历史上唯一的真实样本（基建-2 自己那行）**已被 C6 覆盖**（自称完成 vs 未勾验收项）。
- **实现**：`scripts/check-docs.mjs` 增 `checkGapIdUniqueness`（登记 **C7 / `gap-id-uniqueness`**）并进 `CHECKS`；编号形状 `/^G\d+$/` **与 C1 完全一致**（两条检查不会在「什么算一个编号」上分叉）；finding 指向**第二次出现**的行并带上首次出现的行号；锚点缺失与 C1 同款报错，不静默跳过。
- **`--selftest` 增 M8-C7**，锚点是**表结构**：读出 §四 第一行数据行并**整行复制**（不点任何编号、不碰散文；整行复制还保证单元格数不变，所以颜色只归 C7）。
- **§零 基建-2 的 ⚠️ 就地更新**（R28）：两条盲区分头标注 —— ② 已补为 C7、① 判定不写并附清点证据；那句「属后续项」标作废。
- `AGENTS.md` 的门禁描述由「六条机械检查」改为**七条**。

#### 验收标准

- `node scripts/check-docs.mjs` ⇒ **7 checks / 9 files，exit 0**（先证明对现状不误报：今天 §四 无重复）。
- `node scripts/check-docs.mjs --selftest` ⇒ **8 变异，无假绿**；其中 `M8-C7 ok -> C7 1 finding(s)`。
- **真实文件手工变异（R27，`--selftest` 只证明内存副本会红）**：把 §四 里 `G78` 行的编号改成表内已有的 `G92` ⇒ **exit 1**，输出
  `C7 docs/TODO.md:165 -> G92 already holds an open-gap row at line 164` ⇒ **finding 指的正是被改的那一行**；改回 ⇒ exit 0 且 `git diff` 对该文件**零差异**。
- **顺带确认职责边界**：那次变异**没有**触发 C1（C1 只对「§四 之外带结清措辞」的编号响，被改那行讲的是「退出前置」、无结清词）⇒ 两条检查互相不代偿。
- 回归：`node scripts/check-env.mjs` exit 0；插件 `pnpm --config.verify-deps-before-run=false run verify` ⇒ **42 文件 / 466 通过**（本片不动插件代码，读数不变）。
- 提交：方案 `0e74e9e` → 实现与结案（本提交）。

### #105 守则自身两条时效校正：R11 版本门禁已过期、一处路径凭印象写成 404

#### 问题描述

用户问「还有哪些无需设备 / 需要调研的内容」，我按 R25 先清点而不是凭印象答。清点时跑了守则 **R11 的版本判据本身**，结果它当场报了两条**守则自己**的问题：

1. **R11 已过期**：本行只记到 `dsh-v0.2.1-alpha.2`（2026-10-09），而上游 **2026-10-14 就发了 `dsh-v0.2.1-alpha.3`**。而 `check-docs` 的七条检查里**没有一条查版本** ⇒ 这条判据没有任何机械兜底，只能靠人记得跑 —— 这正是它腐烂的原因。
2. **待补清单第 3 项有一条路径是凭印象写的**：`docs/dsh-tool-call-timeout-policy` 实测 **404**；真实路径 `packages/guard/timeout-policy/README.zh.md`。而那一条标题恰恰是「**不许凭印象引用**」—— 清单自己违反了自己的规矩。

#### 整改方案与实施

- **R11** 补记该事实与两条**直接触及本插件**的 alpha.3 release notes：
  - 「修复插件更新或重新安装后仍运行旧代码的问题，启用热重载时可直接生效、不能热重载才提示重启」
    ⇒ `TODO.md` §七「交付-1」的「替换安装后必须重启宿主」是 **rc.2 上的实测**，在 alpha.3 上很可能不再必要；插件 README 那条已加版本限定，避免在新版上无条件重启（上一轮刚写进去的那条，正好被这条新闻打中）。
  - 「子智能体可通过配置选用独立 Agent Preset 预设」—— 与本插件的 preset 面相关。
  - **升不升 alpha.3 留给人决定**：按 R11 判据，升则全部 conformance fixture 视为过期、live 证据要在新版本上重跑。
- **待补清单第 3 项**：更正第五份的路径（**包名 `@deepseek-ai/dsh-tool-call-timeout-policy` 未变**，只是仓库路径挪到 `packages/guard/` 下，该包 `version` 已到 `0.2.1-alpha.3`），并把这五条**逐个用 `gh api contents` 核实存在**、记下实测字节数 ⇒ 结论是「五份里四份可取回、第五份路径更正后也可取回」，纯读、零设备。
- **待补清单第 5 项**（R14/R15 的真实字段名）：补一条**更省的路** —— 台账原写「必须用 `cordis_inspect_query` 在装好的 Harness 上取真名」，而开宿主会话要模型凭据；上游公开仓库的 `packages/guard/timeout-policy/types` 与 `packages/core/tools` 可能直接写着 ⇒ **先读声明面，查不到才回到 `cordis_inspect_query`**（顺序反过来能省一整轮带凭据的会话）。

#### 验收标准

- 版本判据本身可复跑：`gh api repos/deepseek-ai/deepseek-harness/releases --jq '.[].tag_name'` ⇒ 首条 `dsh-v0.2.1-alpha.3`；`--jq '.[].published_at'` ⇒ 首条 `2026-10-14`。
- 路径失效的证据：`gh api repos/deepseek-ai/deepseek-harness/contents/packages/dsh-tool-call-timeout-policy/README.zh.md` ⇒ **404 Not Found**；改为 `.../contents/packages/guard/timeout-policy/package.json` ⇒ 取到，其 `name` 字段 = `@deepseek-ai/dsh-tool-call-timeout-policy`、`version` = `0.2.1-alpha.3`（**包名对、路径错**）。
- 四份文档存在性：`contents/docs/capability-seams.md` → 65092；`contents/docs/tool-catalog.md` → 102356；`contents/packages/jobs/jobs/README.zh.md` → 10059；`contents/docs/subsystems/scope.zh.md` → 3763（字节数写进守则，便于日后发现上游改动）。
- 本条**只改文档**：插件 `verify` 读数不变；`check-docs`（含 `--selftest`）与 `check-env` exit 0。
- 未做（留给下一轮，且都不需要设备）：把上述四份文档真读一遍、按结论回写 R14 / R15 / S2 相关条款。

### #106 上游五份未读文档读完并回写；顺带推翻我上一轮写下的「包装层未接」（调研-1 结案）

#### 问题描述

用户问「还有哪些无需设备的内容 / 需要调研的内容」。守则末尾那份「待补（诚实清单）」本身就是答案的一半：**五份上游文档从未读过**，而且上一轮（#105）已经查出其中一条路径是凭印象写的（404）。
本轮把它们读完并回写。回写过程里出现了本轮最重要的一条：**我自己在上一轮文档对齐中写下的判断被实测推翻**。

#### 整改方案与实施

- **读到的（转述，不搬原文，D20）**：上游 `packages/guard/timeout-policy/`（README + `src/index.ts`）、`packages/core/tools/README.zh.md`、`docs/subsystems/scope.zh.md`、`packages/jobs/jobs/README.zh.md`、`docs/capability-seams.md`、`docs/tool-catalog.md`。副本只落忽略区 `scratch/upstream/`，不入库。
- **⚠️ 被推翻的判断（正是 #103 刚写下的）**：#103 把守则 R15 的现状写成「**包装层未接**」。实测**相反**：
  - 上游 README 写明 `@deepseek-ai/dsh-tool-call-timeout-policy` **零配置、随 `dsh` 基础组合包默认启用** ⇒ 不存在「我们选择不接」；
  - 本机 `dsh --profile web --dump-config` 的组合树里确有 `- id: timeout-policy` / `name: '@deepseek-ai/dsh-tool-call-timeout-policy'`，**无 `disabled`**。
  ⇒ 已就地更正为「**外层兜底 + 内层自实现的嵌套**」：外层对声明了 `timeoutMs` 的工具设 deadline（我们 `run_device_action` 45s、`report_task_status` 5s），内层 adb / OCR / provider backend 三处仍各自自实现。
- **🔶 明确标注还欠着的**：两层同时计时的情形**一次都没量过**（#97 的 live 里七个工具都正常返回）⇒ **在量到之前不许写「两层不冲突」**，实测需设备。
- **⚠️ 核验时踩到 R25 的老坑**：紧邻上一行 `@deepseek-ai/dsh-tool-workflow` 带 `disabled: true`。不读上下文就 grep，很容易把那个 `disabled` 错安到 `timeout-policy` 头上、得出**相反**结论 —— 这是本分支同一条纪律的又一次复发，当场记下。
- **顺带结清**：
  - **R14 / R15 的真实字段名取到**（`executionMode()` / 包装层根本没有入参）⇒ 台账原写「必须用 `cordis_inspect_query` 取真名」**多余**，且省掉一轮需要模型凭据的宿主会话；
  - 包装层的结构化错误 code 在 **`error.info.code`**（不是 `error.code`）——将来要在 `classify.ts` 分类超时时判据取这里；
  - scope 是**库原语**（`ScopeKey` 按对象身份比对、`Scope.dispose()` 是完全停稳边界）⇒ 印证我们 `{ global: true }` 的用法符合官方原语；
  - `dsh-jobs` 归属当前 agent 会话、跨 agent 不可见不可停 ⇒ 我们挂 tool-jobs 但**没用它跑任务**，任务走会话投影，语义方向一致；
  - 服务图谱交叉验证：我们 inject 的 `tools`/`attachments`/`agents` **都真实存在**（R8 的 waiting-for-services 风险在**宿主侧**当前不成立）；
  - 官方工具目录里**没有 adb / 设备执行类工具** ⇒ 本插件能力**无官方重叠**。
- **⚠️ 本轮我自己犯了一次 R25（跨作用域外推），当轮作废并留证**：`capability-seams.md` 里 `ctx.slots` **0 命中**，我据此写下「将来做 UI 必须重新查真名」，差一步就推出「client 插件可能挂不上」。
  错在：该图谱画的是**宿主侧** `ctx.*`，而 `client.js` 跑在**浏览器**里、client 侧有自己的 `ctx` ⇒ **「宿主图谱查不到」不是「该服务不存在」的证据**；正确查证方向是 client 侧（浏览器 console / `cordis_inspect what:"client"`）。
  而 `client.js` 的形状本就**逐字取自官方 decoration 模板** ⇒ 有官方出处。守则里那条错误表述已就地划掉。
- **⚠️ 但这次外推意外挖出一个真缺口（G95）**：`git grep -n "clientHalf.spec" -- plugins` 只命中 `client.js` 自己的注释 ⇒ **那个 spec 已在 T4（`3677a49`）随 provider 链被删**，
  而 `client.js` **仍在交付面里**（`files` / `exports` / `dsh.client`）并为 5 个工具注册 `tool.call.toolview` 卡片 ⇒ **零自动化锁，且注释指向一个已不存在的文件**。
  **删它的理由不适用** —— `client.js` 不是 provider 链成员，它在交付面里、且是 R18 路线的唯一实现。⇒ 新立 **G95**（§四），无需设备可做。
- **一处笔误当场改**：初稿把包名打成 `dsh-tool-call-timeout-plugin`，写完复核字符串时发现并改回 `…-policy`（R28：写下的每个标识符都要核）。

#### 验收标准

- `node scripts/check-docs.mjs` 与 `--selftest` ⇒ exit 0；`node scripts/check-env.mjs` ⇒ exit 0（上游副本只在忽略区 `scratch/`）。
- 取证命令可复跑：`dsh --profile web --dump-config` ⇒ exit 0、组合树含 `- id: timeout-policy`，且该行块内**无** `disabled`（对照项：紧邻的 `@deepseek-ai/dsh-tool-workflow` **有** `disabled: true`）。
- `git grep -n "clientHalf.spec" -- plugins` ⇒ **只命中 `client.js` 自己的注释**（那个 spec 已随 T4 删除）⇒ **G95** 的判据起点。
- 插件 `verify` 读数不变（本条只改文档）；`.githooks/pre-commit` 在暂存 `docs/**` 时照旧跑门禁。
- **未做**：不接那个包装层（自实现超时保留）、不动 `classify.ts`（`error.info.code` 的分类口径已记进 R15，等真有超时再落）、不因 `ctx.slots` 未命中就动 G88。

### #108 G92 合成难帧：整帧读不出、区域读得出，落成一条会红的机制锁

#### 问题描述

G92 的方案 Verify 里有一条标着「（可选）合成难帧」：离线造一张已知答案的难帧，复现「整帧失败、裁剪成功」，**只作机制回归、不替代真机召回数字**。它一直没做，理由是「不知道能不能造出来」。
按 R20 先量「能不能」，而不是先写方案 —— 量出**三种造法里两种被否证**，第三种成立。

#### 整改方案与实施

- **三条否定结论（先立在前头，免得下一个人重试）**：
  1. **把好帧的标签缩小再贴** ❌ 全档 miss，连「只缩不降对比」（shrink=2、keep=1）都 miss。缩小在**像素层**摧毁字形，@2× 救不回来。这与 T5 真机实测不矛盾 —— 那块 140×70 本来就有 70px 高。
  2. **直接用夹具自带难帧** ❌ 夹具上**区域命中的 needle 整帧全都有** ⇒ 夹具是「整帧 ⊇ 区域」，而 G92 要「区域 ⊋ 整帧」，**方向相反**。
  3. **原尺寸标签贴进混排背景** ✅ 整帧 MISS、区域 @2× HIT —— 整帧失败来自版面分析而非细节丢失，正是 G92 认定的瓶颈。
- **落地**：`scripts/synth-hard-frame.mjs`（零依赖，生成器 + `--scan` 参数探针）、`tests/fixtures/screen-synth-hard.png`（41 KB，真夹具 1.28 MB）、
  `tests/fixtures/hierarchy-synth-hard.xml`（根 + **恰好一个**叶级候选框）、`tests/ocrSyntheticFrame.spec.ts`（2 条**成对**真模型锁：
  ① 帧确实是难的 ② 区域扫到且映射回全屏的落点落在那个候选框内）。**生成器字节级可复跑**（连跑两次 SHA-256 相同）。
- **参数表 = 探针 B 的离线预演**：`scale=1.5` 在每个 padding 都 miss、`pad=24` 全 miss、当前默认 `scale=2` 依赖 `pad≥8`。
  ⇒ **不改默认值**：一块标签一个位置的读数不构成改常量的依据，它的用处是缩小探针 B 的搜索空间、并给这条锁挑一组已知可行的参数。
- ⚠️ **第三条否定结论是计划外的**：我本想让「整帧可读」通过**放大标签**实现（用作对照），实测**放大 5 倍整帧仍然读不出** ——
  在散乱色块背景上，tesseract 面对**单个**文字块时整页版面分析直接放弃，**与字号无关**。对照因此改用真夹具（它整帧确实读得出 `游戏中心`）。
  **由此收窄这条夹具的代表性**：它复现的是「散乱背景 + 孤立文字块」，**与真机满屏图标+标签混排不同构** ——
  这不削弱用途（它证明**机制可用**），但再次确认它**不能**替代探针 B/C 的真机召回数字。

#### 验收标准

- **三条变异各红一次**：
  | 变异 | 结果 |
  |---|---|
  | ① `DEFAULT_REGION_OPTIONS.scale` 改成 **1.5**（扫描表里的全 miss 档） | **第一版全绿** —— spec 把 `scale: 2` 写成字面量、根本没引用默认值，改默认值对它零影响；改成从 `DEFAULT_REGION_OPTIONS` 取参后 ⇒ **红**（`region scan found no needle in the one candidate`） |
  | ② `mapBox` 去掉 `origin` 偏移 | 红：`expected 99 to be greater than or equal to 612` |
  | ③ 夹具换成**整帧可读**的真夹具 | 红：「难帧」断言变红 ⇒ **证明它不是空断言** |
- 变异①的教训写进 spec 注释与本条：**R27 判据 6** 的教科书形态 —— 变异跑了却什么都没变，可能是锁虚，**也可能只是改动没进到被执行的路径**；
  我第一反应是「这条锁大概不行」，真相是 spec 没走产品要走的那条路。**不真跑这一次，就会照错误结论去「重写一条好锁」**。
- ⚠️ 合成 XML 的**第一版是无效 XML**（叶节点重复了 `clickable`/`focusable` 属性）。已修，但**没有任何测试抓到它** —— 测试是在夹具生成之后才写的；
  写夹具时顺手核一遍 XML 合法性是更早的防线。
- 生成器可复跑性：连跑两次，`Get-FileHash` 对两个夹具均相同。
- `pnpm --config.verify-deps-before-run=false run verify` ⇒ **44 文件 / 474 通过**（上一绿态 43/472，+1 文件 +2 条）；三次变异还原后已跟踪文件**零差异**。
  `node scripts/check-docs.mjs`（含 `--selftest`）与 `node scripts/check-env.mjs` ⇒ exit 0。
- **未做**：不改默认常量；不接产品阶梯（接线属探针 B/C 后的 Done 项）；不做 P2 投影分割；不引入字体/图像依赖。

### #109 设备前置调研：mock 顶不到哪一层，以及「需要设备」这个前提本身要改

#### 问题描述

用户问「现在没有设备是否可以设计 mock 来完善这三项」（G92 探针 B、探针 C、交付-1 C 项）。这条只出结论与路径，不动代码。
调研过程中先撞上一个**会误导决策的读数陷阱**，它的代价比本条原本的问题更大。

#### 整改方案与实施

- **逐项查实 mock 能顶到哪**（每条带源码/命令出处，不推测）：
  - **探针 B（真机召回数字）顶不到** —— 探针 A 已把工程面做完，B 剩下的只有真机数字，字体渲染与设备对比度不是 mock 能造的。
  - **探针 C 只能一半** —— 「P1 在无层级场景必然失效」可离线锁；「P2 能不能救」必须真实渲染帧。
  - **交付-1 C 项顶不到** —— **`runTask.ts:110` / `manageTask.ts:114` / `inspectTrace.ts:95` 三个工具全部过 `requireEnv`**，
    没有设备必被 preflight 闸门挡。这是本条最硬的一条否定结论，也纠正了「有 mock 就有路」的想当然。
  - **超时两层机制有条件可行** —— `report_task_status` **不过 preflight** 且声明 `timeoutMs: 5000`，
    可在 conformance 里用**真实 timeout-policy 包**离线验机制；代价是加一个 devDependency（R19 授权面）。
- **「需要设备」这个前提本身修正**：台账与对话一直写成「需要用户提供设备」，读起来像本机做不到。实测不是 ——
  虚拟化**已启用**（`systeminfo` 两项「是」＋ `HyperVisorPresent=True`）、RAM **32 GB**、C 盘空闲 **712 GB**、
  `winget` 源内 `Google.PlatformTools` 37.0.1 与 `Google.AndroidStudio` 2026.2.1.8 均在、CPU 支持 VT-x。
  ⇒ **卡的是「安装」（R19 + 数 GB 下载），不是硬件能力。** 台账两处措辞已就地更正。
- **四条解锁路径**按成本/授权/解锁范围列表，**推荐 Platform Tools（~10 MB）＋ 用户自己的手机开无线调试**（成本最小、不依赖用户在场装几 GB 软件）。
- **⚠️ 本轮踩到的读数陷阱（R25 新样本，已就地留证）**：`Get-CimInstance Win32_Processor` 报
  `VirtualizationFirmwareEnabled=False` / `SLAT=False` / `VMMonitorModeExtensions=False`，
  **照它作答会得出「本机跑不了任何 Android 模拟器」，而那是错的** —— 该属性在**已有 hypervisor 接管**时按设计返回 False
  （`HyperVisorPresent=True` 即反证），可靠来源是 `systeminfo` 与 `Get-ComputerInfo`（两者一致）。
  与本分支已记的「一条错误串只能证明那次失败发生、不能证明因果」同源；**这次的区别是：错误读数会让人去买设备或租云农场，代价更高。**

#### 验收标准

- 每条结论可复跑：`Get-CimInstance Win32_Processor`（反例）与 `systeminfo` / `Get-ComputerInfo`（正例）对照；
  `Get-Command adb`；`winget search --id Google.PlatformTools`；`git grep -n "requireEnv" -- src/tools`。
- 本条**只改文档**：`check-docs`（含 `--selftest`）与 `check-env` exit 0，插件 `verify` 读数不变。
- **未做**：不装任何东西（属 R19 授权面，等用户决定）；不加 devDependency；不改产品行为（阶梯接线仍是单独一条）。

### #107 `client.js` 的浏览器半边锁恢复（G95 结案；一次 T4 混称导致的连坐删除）

#### 问题描述

`git grep -n "clientHalf.spec" -- plugins` **只命中 `client.js` 自己的注释** ⇒ 那条注释在撒谎：它声称由 `tests/clientHalf.spec.ts` 锁着，而那个 spec 已在 T4（`3677a49`）被删。
于是**留在交付面里的 `client.js` 零自动化锁**，而它为 5 个工具注册 `tool.call.toolview` 卡片，是 R18 路线的唯一实现（G88 将来解锁时的起点）。

根因不是「顺手删过头」，是一次**混称**：

1. T2-f 的提供方清点写下「模块本体与其 `clientHalf` / `mcpBackend` 规格 ⇒ T4 裁决删除或保留为可选面」；
2. **那一句把两个不同的东西并称了** —— `mcpBackend` 的规格锁 `src/artemis/mcpBackend.ts`（确属 provider 链），而 `clientHalf.spec.ts` 锁 `client.js`；
3. T4 据此把 `clientHalf.spec.ts` 与 `actionClient` / `mockServer` / `scrcpy` 三个**确属**该删的并列删除。

#### 整改方案与实施

- **R20 第 1 步先查两处一手原文**：上游 decoration 模板（HTTP 200，686 B）逐字确认 `window.__ModuleLoader__.load` + `require('react')` + `inject:['slots']` + `ctx.slots.inject(slot, () => ctx.slots.register({name,id,order}, C))`
  ⇒ **同时彻底排除了上一轮那个怀疑**（`capability-seams.md` 只画宿主侧 `ctx.*`，它对 `ctx.slots` 的沉默从来不是证据）；模板的 `register` 不含 `key`，我们多传的 `key` 依据在 **R18**。
  另读本仓历史 `3677a49^:tests/clientHalf.spec.ts`（77 行）⇒ 它锁的四组今天**全部仍成立**。
- **恢复，不重写**：`git checkout 3677a49^ -- plugins/dsh-autogamer/tests/clientHalf.spec.ts`。**六条断言一条没改即全绿**
  ⇒ 反证 `client.js` 与 manifest 半边自 T4 以来未动。方案里「不许假设恢复就绿、不许为绿改 `client.js`」的约束**做了且未被触发**。
- **改 `client.js` 头注释**：原句现在成真，并**补上这条锁的边界** —— 它锁结构，**不证明卡片在浏览器里渲染过**；
  后者要一次真会话，而五个工具全过 `requireEnv` ⇒ **需设备**，标 🔶。R21：别把「有锁」读成「验过 live」。

#### 验收标准

- **三条变异各红一次，且恰好一条红**（R27）：① `CELLS` 删掉 `autogamer_diagnose` ⇒ 「五个 wire key」红（报 `toolview key for autogamer_diagnose`）；
  ② 加 `const _ = require('lodash');` ⇒ 「imports nothing but react」红（**这正是 R18「不许第二个框架/宿主 Client 包」的机械形态**）；
  ③ `package.json` 的 `files` 去掉 `client.js` ⇒ manifest 那条红。三次均 `1 failed | 5 passed`；还原后 `git status --short` 对 `plugins/` **零差异**。
- `pnpm --config.verify-deps-before-run=false run verify` ⇒ **43 文件 / 472 通过**（上一绿态 42/466，+1 文件 +6 条）；`node scripts/check-docs.mjs`（含 `--selftest`）与 `node scripts/check-env.mjs` ⇒ exit 0。
- ⚠️ **两处当场自纠**：
  1. 恢复时用 PowerShell 的 `git show … > file` 重定向，PowerShell 5 把文件写成 **UTF-16**，esbuild 报解析失败 —— **报错长得像代码问题，实际是编码问题**（R25：一条错误串只能证明那次失败发生）。正解 `git checkout <commit> -- <path>`（按字节写文件）。
  2. 方案里那条闭环判据我写成「`git grep clientHalf.spec -- plugins` ⇒ 命中**两处**」—— **实测只有 1 处**，因为 spec 内部不自指文件名。
     判据改成两条并列且都要能红：`git grep` 命中注释 + **`Test-Path plugins/dsh-autogamer/tests/clientHalf.spec.ts`** ⇒ 修复前 **False**（注释在撒谎）、修复后 **True**。
- **非目标**：不删 `client.js`；不做 live 渲染验证（需设备）；不扩 UI 能力（G88 仍待需求）；不动 manifest 形状（它就是被锁的对象）。
- 提交：方案 `a3578ac` → 实现与结案（本提交）。
