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
| 二 · 能力迁移（T1–T4） | #86, #87, #88, #89, #90 | 判定与执行从 py 面收回到 TS 侧：效果判定差分（T3 第一片 / G84）、设备面本地化（T2-a / G75·G76 结清）、层级读取本地化（T2-b）；以及两条**推迟判定**（OCR / G87 后被 T5 反转、画面标注 overlay / G88）。 |

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