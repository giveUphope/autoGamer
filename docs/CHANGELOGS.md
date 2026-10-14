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
| 二 · 能力迁移（T1–T4） | #86, #87, #88, #89, #90, #91, #92, #93, #94 | 判定与执行从 py 面收回到 TS 侧：效果判定差分（T3 第一片 / G84）、设备面本地化（T2-a / G75·G76 结清）、层级读取本地化（T2-b）、12 条动作与截图本地化（T2-c/d/e）、诊断本地化与提供方清点（T2-f）；两条**推迟判定**（OCR / G87 后被 T5 反转、画面标注 overlay / G88）；OCR 内置离线 WASM 与那条推迟的**反转结案**（T5 / G87 结清、召回缺口新立 G92）；T4 收尾（门收成两项、按消费者计数删除动作面客户端与镜像链、adapter 首次获得消费者、G82/83/84/85/86/89/90/93 八条结案、`notes/plan` 放弃记录）。 |

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
