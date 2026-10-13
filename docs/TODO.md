# TODO · 待办（2026-10-14 已清空，待新方案）

> 2026-10-14 起旧待办一次结清：已完成的 P4 物理收缩阶段 A/B 归档为 CHANGELOGS **#71**，
> 未完成的 10 个差距与 P4 阶段 C/D 直接放弃（去向同见 **#71**）。
> 新方案待用户提供；收到后按守则 R22（查文档 → 写方案 → 才写码）先落自足条目再实现。
> 编号查 [registry](migration/registry.md)，词查 [glossary](migration/glossary.md)，
> 导航查 [导航](migration/README.md)。

## 零、当前状态（2026-10-14 清空，待新方案）

- 当前未关闭差距 **`G72` / `G74` / `G75` / `G76` / `G78` / `G81`**（正文在第四节；**计数只查 `migration/registry.md`**，此处不写数字），无进行中里程碑。本节是状态唯一权威。
  `G77` → CHANGELOGS **#79**，`G73` → **#80**，`G79` + `G80` → **#82**，`G71` → **#83** 均已结案。
- 2026-10-13 **Step 0 现场核实**（用户起了 LM Studio 与 MuMu，本轮只核现场、不写实现）：
  - 设备：`artemis doctor` 判 **Ready**（Python 3.12.13 ✔、设备 `24031PN0DC` / `900x1600` ✔、`scrcpy` 缺 = 可选缺项）。
    `.env:23` 已钉 `ADB_DEVICE_SERIAL=127.0.0.1:16384`；前台 `app.lawnchair`（亮屏未锁）；Android 15。
    **一个 MuMu 实例暴露 4 条 adb 传输**（`emulator-5554`、`127.0.0.1:16384`、`:5555`、`:7555`），
    同机证据 = `settings get secure android_id` 四条全等（`c0021066f3fbaf47`）+ MemTotal/battery 一致；
    `ro.serialno` 四条**都是空串**（MuMu 不设），所以按 serial 分键的闸门会把它们当不同 endpoint、又可能同时落进
    `defaultDeviceKey`——roster 真枚举「一台算几台」列为 Step 1 首要待测（G64/G65 当年是在无真机的机器上验的）。
  - 模型端点：`127.0.0.1:1234` 在听（PID 17476）。`/api/v0/models` 里 `qwen3.6-35b-a3b-mtp`
    **`state: loaded`**、`type: vlm`、`quantization: IQ1_M`、`loaded_context_length: 262144`，
    而 `capabilities` **只列 `[tool_use]`、无 vision 项** → 按 S5 记过的「显式省略 = 负能力」坑，
    图像附件路径在这个端点上是否被降级为文本，属**待实测**，不许当已证。
  - 提供方：入口是 console script（`pyproject.toml:89` → `artemis.interfaces.cli.main:cli`；
    用 `python -m artemis` 会报 `No module named artemis.__main__`，那是调用姿势错，不是功能缺）。
    `uv run artemis --help` 的 Commands = `doctor` / `mcp` / `helper`；`artemis mcp --help` 给
    `--type adb`（默认）/ `mock` / `xml`、`--transport stdio`（默认）/ `sse`（`:8001`）。
    **`mcp_server/` 的 `.py` 计数为 0**（只剩 `__pycache__` 与空目录）⇒ 智能栈确实不在本树，据此立 **G72**。
    - 仍未具备的触发条件：`scrcpy` 不在 PATH（Phase 4 的 20fps / 触摸回传 / 无残留三项继续 live 不可跑）。
- 2026-10-13 **Step 1 动作面实测**（真 MuMu，`uv run artemis mcp --type adb`，`ARTEMIS_MOCK_DRIVER=0` 走真 driver；
  现场用现成客户端 `plugins/dsh-autogamer/scripts/spike-mcp.mjs` + `dist/` 里的 `ActionClient`，未新增仓库内脚手架）：
  - **工具面 15 个与已提交 fixture 逐字一致**（`spike` rc 0；没用 `--write`，fixture `git diff` 为空）——G63 那条
    「fixture 必须在真面上重新比对」第一次是在**有设备的机器上**过的，此前只在 `--type mock` 上验过。
  - **roster 把一台 MuMu 报成 4 台**：`list_devices()` 默认 → `127.0.0.1:16384` / `:5555` / `:7555` / `emulator-5554`
    四条全 `state: device`、`is_emulator: true`、同 `model 24031PN0DC`，而 `settings get secure android_id` 四条全等
    （`c0021066f3fbaf47`）、`ro.serialno` 四条全空 ⇒ **按 endpoint 分键的闸门/并发上限/熔断会 4 倍计数** → 立 **G75**。
  - **锁屏三态**：`include_lock_state=true` 时四条都 `is_locked: false`；默认 false 时**不带该字段**。
    `null`(unknown) 与 `true` 两个分支本轮**未触达**，别当已验。
  - **device state 的真返回形状与 Phase 2 记录不一致**：`take_screenshot` 返回**裸 base64 JPEG**
    （226856 字符，解出 170142 字节，`image/jpeg`），且 py 侧 docstring 自己就写着
    “Returns the screenshot as a base64 encoded JPEG string”；`get_ui_hierarchy` 返回 JSON 数组字符串，
    字段值全是字符串（`"index":"2"`、`clickable:"true"`、`bounds:"[x0,y1][x1,y1]"`）。
    **`file://…` 那条属已删的 pre-contraction 5 工具面** → 映射层要按真面重锁，立 **G74**。
  - **坐标空间陷阱（本轮最重要）**：当前帧空间是 **1600x900**（独立金标准 = `adb exec-out screencap -p` 的 PNG IHDR；
    `dumpsys input` 主视口 `Orientation: Rotation90`），而 `wm size` 报 **Physical size: 900x1600**。
    插件的 `coord.imageSizeFromBase64(真截图)` 得到 `{width:1600,height:900}`，**与金标准一致**（取源路径正确，
    我先前怀疑的「解析器宽高互换」被这条独立测量否证）；`toPixels` 往返精确（归一 `(500,97)` → `(800,87)`）；
    真点 Settings 搜索栏中心 `(800,87)` → driver 打 `input tap 800 87` → 焦点变
    `com.android.settings.intelligence/.search.SearchActivity` 且 `compare_ui_frames` 报 `{"changed": true}`
    ⇒ **tap 吃的就是这个帧空间的像素**；若按 `wm size` 归一，同一点会落到 `(450,827)`，偏 **350x / 362y** → 立 **G76**。
  - `swipe` 生效（Success + `{"changed": true}`）。
  - **「Success ≠ 生效」抓到实例**：`back` 返回 `Success` 而焦点未变、`compare_ui_frames` 报 `{"changed": false}`；
    同一时刻 raw `adb input keyevent 4` **却生效**（焦点回到 `com.android.settings/.Settings`）。
    而 HOME 方向相反：`input keyevent 3` / `KEYCODE_HOME` 当时**未**改变焦点，`am start -a MAIN -c HOME` 生效。
    ⇒ 键事件投递在这台 MuMu 上**可靠性未定性**（每向 n=1~2，样本量不足以定红绿，按 R27 记为待测）。
  - **真机环境级告警**（喂给 classify/熔断 vocabulary 的现场）：`set-wakelock` 不支持（`Unknown command`）、
    USB stay-awake 启用失败（`setting=2`，退回 5 秒宿主心跳）、**accessibility helper 不应答**（device port 18888）
    → 自动降级到 UIAutomator2 并 30 秒重试。`launch_app` 的 smart polling 会打印一大段 foreground-task 归属诊断
    但仍返回 `Success`。
  - 现场已复位：HOME intent → `app.lawnchair/app.lawnchair.LawnchairLauncher`。
- 2026-10-13 **Step 2 · 复审「可验的都验了吗」+ 补调研**（结论：不止没验完，还有两处我记错了）：
  - **py 全套在有设备的机器上仍全绿**：`pytest tests/unit tests/integration -q` = **447 passed / 1 skipped**，rc 0。
    **#77** 记的那次 447/1 是在**无设备**的机器上跑的，所以这条是新增证据：设备在场不改变离线面结果。
  - **层级稀疏是设计行为，不是故障，也早有文档**：`get_ui_hierarchy` → `filter_ui_hierarchy`
    默认 `semantic_pruning="hoist"`（`artemis/utils/ui_filter.py:425-433`），语义空节点被 `return filtered_node.get("children", [])`
    丢弃，而 **UIAutomator2 的 XML 解析是扁平的、没有 `children` 键**（`third_party/mobile_use/clients/ui_automator_client.py:106-145`），
    所以容器与无 text/content-desc/非可点的节点整条消失 → 桌面 5 个、Settings 36 个属预期。
    helper 可用时走**同一个 filter**（`artemis/clients/screen_client_factory.py:221-228` 的降级分支只换来源不换过滤）
    ⇒ **不是 helper 缺位造成的**；口径早已写在 `inventory/03-device-media-diagnostics.md:199`，本轮只是补上真机确认。
  - **更正我自己 G74 的表述**：节点**并非「字段值全为字符串」**——除字符串 `bounds` 外还带
    **`parsed_bounds`（`{left,top,right,bottom}` 整数对象），真机 36/36 全带**。解析层有现成数值可用，不必自解字符串。
  - **键事件定论（n=10，单变量）**：raw `input keyevent KEYCODE_HOME` **0/10 生效**，raw `input keyevent 4`(BACK)
    **10/10 生效**，`am start -a MAIN -c HOME` 每次都生效 ⇒ HOME 注入在这台 MuMu 上**确定性失效**，不是抖动。
    且 `adb_driver.py:372-383` 的 `press_key` 是 `await device.shell(...)` 后**无条件 `return True`**
    ⇒ **py 的按键面没有效果语义**，`Success` 只代表命令发出；按键类动作的效果判定只能走 `compare_ui_frames`（喂 S4/S11 的词汇边界）。
  - **VLM 端点侧风险排除**：向 `1234/v1/chat/completions` 发带 `image_url` 的请求**被接受**
    （`prompt_tokens: 27`，无 vision 拒绝；`finish_reason: length` 是我给的 `max_tokens=8` 太小所致）
    ⇒ 留白 18 的「端点不收图」这一半**否证**；剩下的风险只在 **DSH provider 的 `models[].input` 声明**，仍被 G71 挡。
  - **G77 范围比原记的一行更大（实测取证）**：在有设备的机器上跑真预检（`createPreflight().run({uvPath:"uv", artemisRepoPath:"D:/DEV/autoGamer"})`）
    七项结果 = `uv` PASS（0.12.19）、`python` PASS（python3 3.14）、`artemis-repo` PASS、
    **`artemis-installed` FAIL**（detail 正是 `uv tool list` names no artemis install）、`adb` PASS、`adb-devices` PASS、
    **`helper` FAIL（`no artemis binary on PATH`）** ⇒ 同一个根因打掉**两项**：project-venv / editable 形态不会在 PATH 上
    留下 `artemis` 可执行文件。只修 `installedCheck` 预检仍整体红、每次工具调用仍被拒，所以 G77 的范围含 `helperCheck`。
    另：`adb-devices` 这项把四个 serial 当 fleet 列出（`127.0.0.1:16384, :5555, :7555, emulator-5554`），
    是从预检层对 **G75** 的独立佐证。
    可用的第二种探针已验存在且只读：`uv run --project <repo> --no-sync artemis --version` → 打出
    `ARTEMIS device-action core v1.0`，rc 0（`--no-sync` 保证预检不改动提供方环境）。
  - **新立 G78**：`adb forward --list` 实测残留 **`127.0.0.1:16384 tcp:54254 tcp:18888`**（device 18888 = helper 端口，
    由 py 侧建 forward），而 MCP server 进程已退出 ⇒ Done means 里那句「卸载无残留（adb forward 清理）」
    **不是「等真机」而是已被证伪**，且残留产生方是 py 动作面，插件的 stop/dispose 管不到它。
- 2026-10-13 **Step 3 · 两个修复落地**（`G77` → CHANGELOGS **#79**；`G73` → **#80**；新暴露 `G79`）：
  预检承认 project-venv 形态后，真机真环境跑通 `artemis-installed → PASS  project venv: ARTEMIS device-action core v1.0`；
  插件全套 **32 files / 289 passed / 1 skipped**（+5 锁），三条变异逐条证伪（红点 `preflight.spec.ts:145` / `:166` / `:218`）。
  `doctor` 收尾不再提示已删的 `artemis run`，并补了一条**吃「已注册命令集」的防腐烂锁**（旧文案原本被一条测试锁着，
  谁改谁红）；py 全套 **448 passed / 1 skipped**（+1）。两轮的变异各自注回旧文案/去掉分支，均转红后还原。
  `helper` 项修完仍红，但**原因换了且是真红**：提供方要求 `--serial`（多传输歧义）→ 立 **G79**。
- 2026-10-13 仓库卫生与主线定位（正文见 CHANGELOGS **#78**）：`origin` 上三条死分支已删；本地安全网分支
  `backup-trailer-fix` 已删（4 个提交按 patch-id 证明与 main 里的重写版对偶）；**远端默认分支已从 `main` 改为
  `dsh-plugin-contraction`**，`main` 按用户裁定不再同步；插件本机环境已装并复验（install 未改 lockfile、tsc 通过、
  vitest 32 files / 284 passed / 1 skipped、R6 `--dump-config` rc 0 且非空过）。
- 2026-10-13 **Step 4 · 收益优先级调研**（四路并行：本仓改动面审计 / Android-adb 一手口径 / DSH 交付与 live 路径 / 提供方形状）。
  四件事改变了排序，其中**两条是收回我自己写错的结论**：
  - **收回**：「`dsh plugin remove` 只删依赖、CLI 侧不存在卸载命令」——`operations.ts:88-97` 的 `reconcile()` 在
    pnpm 成功后就把消失的名字从 `dsh.profile.bundles` 剔除（且仅在 `exitCode===0 && !stalled`）。
    ⇒ **G71 存在 0 审批路径**，它不再是"要用户在 UI 里点"的独占门槛，成本评级从「需人 + 需宿主」降到「一条命令」。
  - **收回**：G74 里「`{index}` 改吃 `parsed_bounds`」——`parsed_bounds` **早已被优先采用并有锁**
    （`apply.spec.ts:62`、`dedup.spec.ts:17`）。写待办前没核现状，正是守则 R25 禁的那种事。
  - **新立 G80**：`rulesInjector.ts:16` 读 `<repo>/mcp_server/rules.md`，本分支没有该文件而失败策略是 warn-skip
    ⇒ rules 注入在真环境**静默 no-op**，Phase 5「注入已落地」只在 fake-repo 夹具下成立。
  - **口径纠正**：§四 与 registry 里写的「13 工具动作面」不准 —— 实测与 fixture 都是 **15**；
    13 是 `ACTION_TO_PY_TOOL` 的非 null 映射数（`runDeviceAction.ts:66-81`）。两处已按各自语境改正。
  - **账实不符**：§零 旧行写「`pre-contraction` 为收缩前基线（`3fab0ee`，本地存档，不推送）」，但现在
    `git branch -a --list '*pre-contraction*'` 为空、`git rev-parse pre-contraction` 报 fatal ⇒ 该 ref 现在不可解析。
    等价内容仍可经 **`main`**（同仓，含 23 个 `mcp_server/*.py` 与 `mcp_server/rules.md`）取得——这也是 G72 的第三条路。
- 一处状态更正（别当矛盾）：`--dump-config` 绿而 `--dump-config-schema` 红是**两条独立通道**——
  前者合成 profile 层与 `--patch` overlay、后者还要真的把包解析出来；官方卸载/安装契约与本机实测见
  [upstream-plugin-forms](migration/upstream-plugin-forms.md) 八，carrier 错的归属见同节 Step 5 段。
- 2026-10-13 **Step 5 · G71 走 CLI 路线执行完毕（profile 层），并定案 G59**：
  `dsh plugin --profile web remove autogamer-device` → `add link:D:/DEV/autoGamer/plugins/dsh-autogamer`，
  两条 rc 均 0、**全程 0 次审批**。改前状态已备份（`package.json` / `pnpm-lock.yaml`）。实测结果：
  `dsh.profile.bundles` 现为 `[dsh-base, dsh-web-app, dsh-autogamer]`（旧名消失）、`dependencies` 只剩新名、
  `node_modules/dsh-autogamer -> /d/DEV/autoGamer/plugins/dsh-autogamer` 可解析（含 `dist/` 与 `cordis.patch.yml`）。
  **判据是宿主自己的**：不带 `--patch` 的 `dsh --profile web --dump-config` rc 0、`unmatched` 0，
  且合成树里出现 `# == dsh-autogamer` + `- id: dsh-autogamer`(183) + `preset-autogamer`(184) ⇒ **bundle 由 profile 自身加载**。
  两个残留：**G71 未结案**——R7/R9 要求开新会话用免审批的 `cordis_inspect_query` 证「工具真的在 Agent 面上」，
  这一步要宿主进程起来（现在没在跑），我没代启；以及 pnpm 11（宿主 shim 用的是 11.7.0，不是本仓的 10.12.1）
  删依赖后把死 junction `node_modules/autogamer-device` 留在原地，已按 G49 的机制手动摘除（那是它记过的致害形态）。
  顺带把 **G59** 定案了：schema dump 仍 rc=1，但 5 条 carrier 错里**四个是宿主自带 preset**、第五个才是我们，
  且 headless/desktop 两个 profile 同样 rc=1 却 0 条 carrier ⇒ 属宿主 dumper 走 preset 子项的固有行为，
  **不是本包形状问题**。证据与对位表见 [upstream-plugin-forms](migration/upstream-plugin-forms.md) 八。
- 2026-10-13 **Step 6 · G79 + G80 修复（CHANGELOGS #82）**，并拿到这条链上第一个全绿预检：
  `helperCheck` 在 `defaultDeviceSerial` 非空时给 PATH 与 venv 两条形态都追加 `--serial`（必填字段是刻意的，
  可选就是这次漏传的成因）；`setupRulesInjection` 返回值改结构化结果并由 `autogamer_diagnose` 暴露原因。
  真机对照：`defaultDeviceSerial=""` → `FAIL helper`（仍是那句 fleet 拒绝）；
  `="127.0.0.1:16384"` → **`PASS helper` + 七项 `overall ok: true`**。
  G80 的 live 证据：对本仓路径真跑注入，结果 = **`missing-file`**（可机读，不再是一个被丢掉的 `false`）。
  插件全套 **32 files / 293 passed / 1 skipped**（+4 锁），变异 MA/MB/MC 分别红 1/1/2 条。
  **附带发现立 G81**：改完顺手把 tests 纳入一次 `tsc`，实测 **144 条类型错误** ——
  插件的 spec 从来没被类型检查过，这意味着我这条「必填」守卫只在 `src` 一侧生效。
  helper 现在报的那句是 `Accessibility helper on 127.0.0.1:16384`，但**别把它读成「helper 已装好」**：
  同一次真机动作面运行仍打印 `Accessibility helper unavailable ... serving from UIAutomator2`（§零 Step 1），
  两者关系属未证。
- 2026-10-13 **Step 7 · G71 的宿主侧取证**（用户授权启宿主）：`dsh --profile web --no-open --port 8090`
  起宿主（**URL 带会话 token，不入库**），在 agent 内置浏览器里读官方管理面：
  「插件」页 已安装 **1** = `AutoGamer 设备执行` v0.1.0 / `dsh-autogamer`、启用为开；
  详情页 **包含的组件 共 2 个 · 2 运行中**（`dsh-autogamer` + `preset-autogamer` 均运行中，无 error）；
  预设菜单出现 `AutoGamer` 且可选为新会话预设 ⇒ **挂载层与注册表层都通了**。
  **仍未证的一条**：工具是否真在 AutoGamer agent 的可调用面上——右侧栏没有会话前的工具清单，
  而 G30 的教训正是「注册成功 ≠ Agent 看得见」，故 G71 **不结案**。
  另记一条口径：宿主 stdout 只有 3 行、无报错，但按 **R24** 插件 logger 不进 stdout，
  所以"日志里没有错"**既不能证明也不能否证**，本节全部结论只取管理面读数。
  已推送（`0adb7f5`，run `38371033938`，CI 行为见下）；`pre-contraction` 为收缩前基线
  （`3fab0ee`，本地存档，不推送）—— **该 ref 现已不可解析**（`git rev-parse pre-contraction` = fatal），
  等价内容经 `main` 取得，见本节 Step 4。
- 2026-10-13 **Step 7 的范围更正（重要，别把 G71 读成"本机都修好了"）**：Step 7 的全部读数
  **只属于 `web` 这一个 profile**。本机实际有四个 profile，各自的组合包选择是独立的：
  `desktop`（`base + web-app + experimental-agent-team-profile`，**没有本包**）、
  `headless`（**仍挂着旧名死链** `autogamer-device` → `link:D:/DEV/autoGamer/plugins/autogamer-device`，
  与 G71 修掉的是同一个缺陷，未修）、`sdk`（干净）、`web`（本轮修好的）。
  用户 22:56:27 起的 5 个 `DeepSeek Harness.exe` 进程走的是 **desktop**（其 `cordis.yml` 同一时刻被重写）
  ⇒ **G71 的"生效"证据不适用于用户日常环境**，要装到哪个 profile 得先问。
  另澄清一条排除项：本机**只有一个 dsh 安装**（`D:\DeepSeek Harness`，exe 构建于 Sep 29 18:34，
  CLI `0.2.0-rc.2`），`where.exe dsh` 与 npm/pnpm 全局 bin 均无第二个 dsh ⇒ 不存在"另装了一个 dsh"，
  差异全在 profile 层。
- 2026-10-13 **Step 8 · 本轮收束（用户指示"先不动"，只落文档）**：

  **进度快照**（细节在第四节与各 Step 段，此处只报位置与状态）：
  - 本轮结案 4 条差距：`G77`（#79）、`G73`（#80）、`G79` + `G80`（#82）；外加修掉门禁自测的哑弹变异（#81）。
  - 未关闭 7 条：`G71` / `G72` / `G74` / `G75` / `G76` / `G78` / `G81`。
  - 已验证到 live 的：真机动作面 15 工具面（fixture 逐字一致）、坐标帧空间与 `toPixels` 往返、tap 命中、
    `swipe` 生效、roster 一台报四台、`take_screenshot` 裸 base64、`helper --serial` 后七项预检全绿、
    `web` profile 的挂载层与注册表层（2 组件 2 运行中 + 预设可选）。
  - **仍未验证**的：本包工具是否真在 AutoGamer agent 的可调用面上（G30 教训：注册成功 ≠ Agent 看得见）；
    `run_task` 那条链（缺提供方，G72）；scrcpy 三项（缺二进制）；键事件与锁屏分支的边角（留白 19/20）。
  - **按"先不动"承诺保留的现场**：`desktop` 未装本包、`headless` 旧名死链未清、`web` profile 的安装未回滚、
    我起的 web 宿主（PID 22060 / `127.0.0.1:8090`）仍在运行、wire/模型取证未开始。

  **待用户裁定清单**（每条只留决策点 + 我的建议，正文都在对应行，不在此重述）：
  1. 本包该装进哪个 profile（`desktop` 是日常用的那个；`headless` 那条旧名死链要不要一并清）→ 影响 **G71**。
  2. 提供方走哪条路：外部 checkout / 本树动作面加映射 / **`main` 挂 worktree**（我推荐第三条）→ 影响 **G72**，并连带
     **G74** 的正确形状与 **G80** 的实质。
  3. `G75` 的路线（我建议 ①＋③：钉显式 roster ＋ 明示"计数单位是 adb 传输"）→ 连带 **G79** 的"默认设备从哪来"。
  4. `G76` 与帧空间不一致时的行为：拒绝还是告警（我倾向告警并采用截图值）。
  5. `G78` 的清理归属：py 侧（我推荐，`detach_all` 已存在）还是插件侧兜底。
  6. `G81`（144 条 spec 类型错）现在收还是排队。
  7. `G71` 最后一条证据用哪条路取证：代理抓 `tools` 请求体，或创造模式会话的 `cordis_inspect_query`（我倾向前者）。
  8. 8090 的 web 宿主留着还是关掉。
  已推送（`0adb7f5`，run `38371033938`，CI 行为见下）；`pre-contraction` 为收缩前基线
  （`3fab0ee`，本地存档，不推送）—— **该 ref 现已不可解析**（`git rev-parse pre-contraction` = fatal），
  等价内容经 `main` 取得，见本节 Step 4。

- 2026-10-13 **Step 10 · 取证复测（用户指出上轮「没切模式」，R9 证据降级重取）**：
  - **调研（上游一手）**：会话「模式」= preset 选择（内置 `standard`/`ptc`/`minimal`/`cordis`，
    见 agent-preset-registry README.zh）。`cordis_inspect_query` 由 `@deepseek-ai/dsh-tool-cordis` 提供，
    **只有 `cordis` 预设挂它**；`standard` 与本包 `preset-autogamer` 都没有 ⇒ 上轮 Step 9 的会话面
    **本就不存在检查器**，模型是照自己上下文复述工具清单，不是 R9 取证 —— Step 9 的取证表述**作废**，
    G71 结案依据改由本轮 wire 抓包承接（CHANGELOGS #83 的「官方检查器」字样以本轮实测为准修订）。
  - **What**：不改任何插件代码（验的就是出货形态），用 S10 现成抓包装置
    `scripts/dump-proxy.mjs`（1235→1234 日志代理）+ `spike/wire-tools.py`（数请求体 `tools`）。
  - **How**：旧 proxy-dump.log 移作 .bak → 起 proxy → profile patch 的 `local` baseURL 临时
    1234→1235 → 冷重启宿主（按监听 PID 清）→ AutoGamer 新会话真跑一轮 → `wire-tools.py` 解析
    → 端点改回 1234、宿主恢复（防代理单点：不还原则每轮必死 ECONNREFUSED）。
  - **Done means**：chat/completions 请求体的 `tools` 数组**恰含 7 个本包工具名**
    （`run_device_action` / `report_task_status` / `autogamer_run_task` / `autogamer_manage_task` /
    `autogamer_inspect_trace` / `autogamer_get_device_state` / `autogamer_diagnose`）；
    抓包命令可复跑；结果回写本条并同步 #83 的取证表述。
  - **结果（同日实测，Done means 达成）**：AutoGamer 预设新会话（qwen3.6-35b-a3b-mtp，6 秒无报错）经代理
    落到 `scripts/proxy-dump.log` 的 chat/completions 请求体 **`tools=12`**：本包 **7 个全在 wire 上**
    （`run_device_action` / `report_task_status` / `autogamer_run_task` / `autogamer_manage_task` /
    `autogamer_inspect_trace` / `autogamer_get_device_state` / `autogamer_diagnose`），另 5 个为宿主行
    （`job_kill`/`job_list`/`job_output`＝tool-jobs、`plugin_manager`、`skill`），与出货预设组成一致；
    第二个请求 `tools=0` 为标题生成类，符合预期。G71 结案依据由 **wire 差分**承接（S5/G30 明文认可的
    「插件侧 wire 差分」）。环境已还原：端点回 1234、代理已停、宿主已重启。
- 2026-10-13 **Step 11 · `preset-autogamer` 增挂 `tool-cordis`（用户裁定「可以增加」，R22 方案先行）**：
  - **背景**：Step 10 调研证实 `cordis_inspect_query`/`cordis_inspect_list` 由 `@deepseek-ai/dsh-tool-cordis`
    提供、只有官方 `cordis` 预设挂它 ⇒ AutoGamer 会话无法自查工具面（R9 检查器不可用）。
    官方 `cordis.patch.yml` 的挂法 = 无 config 平行一行，照抄即可。用户 2026-10-13 批准。
  - **What**：给 `preset-autogamer` 加一行 `tool-cordis`（会话面自动多出 `cordis_inspect_list` /
    `cordis_inspect_query` 两工具，wire 面 12→14）。不做：改 `src/`（插件自身仍是七个注册工具）、
    改 `spike/headless-spike.patch.yml`（历史 spike 装置，非出货形状、无锁读它）。
  - **How（两处同步 + 一把锁）**：`cordis.patch.yml` 与 `spike/web-live.patch.yml` 各加同一行
    （位置对齐官方 cordis 预设：skill-filesystem 之前）；`tests/deliveryShape.spec.ts` 加
    `toContain("@deepseek-ai/dsh-tool-cordis")`——G37/G45 的教训：两份文件必须描述同一交付形状。
    README 的「七个工具」指 `apply()` 注册面，不受影响。
  - **Verify**：`pnpm --config.verify-deps-before-run=false run build|test` 全绿；
    R6：`dsh --profile web --patch <cordis.patch.yml 绝对路径> --dump-config` rc 0 且 grep 不到 `unmatched`；
    live（R7）：冷重启宿主后 AutoGamer 新会话按 Step 10 装置复跑 wire 抓包，应见 `tools=14`
    （12 + 检查器两件）——**待 web profile 模型端点就绪后执行**，live 部分挂起不阻塞离线面落地；
    注意冷重启前宿主仍跑旧 preset 代际（配置层只影响之后创建的 Agent，R7）。
  - **Done means**：
    - [x] 两份 patch 各含 tool-cordis 行，deliveryShape 锁更新
    - [x] build 不需要（未改 `src/`，dist 不变）；vitest 全绿 **32 files / 293 passed / 1 skipped**
    - [x] R6 rc 0 且无 `unmatched`（合成树 1420 行含 `dsh-tool-cordis`）
    - [x] **live wire 抓包 `tools=14` 达成（2026-10-13，端点就绪后）**：AutoGamer 新会话（qwen3.6-35b-a3b-mtp，
          10 秒无报错）里 agent **真实调用** `cordis_inspect_list` → `cordis_inspect_query`（UI 工具卡片可见），
          自查清单 14 个 = 本包 7 + `job_*`×3 + `skill` + `plugin_manager` + 检查器两件；wire 侧三个回合请求
          全部 `tools=14` 且名单一致（双侧交叉验证）。R9 检查器从此在本包会话面可用。
          复跑装置 = Step 10 的 dump-proxy + wire-tools.py + 端点临时切 1235
    - [x] 结果回写本条并按方案/实现两次提交（`972845d` 方案 → `5d44cd9` 实现）
  - 环境已还原：端点回 1234、代理已停、宿主已重启在跑（新 preset 代际已生效）。desktop 按用户裁定暂不动。
- 2026-10-13 **Step 12 · G72 路线④：分支本地提供方（用户裁定：不依赖 main、在本分支实现）**：
  - **裁定与定位**：原推荐路线③（`main` 挂 worktree 当提供方）被用户否决——main 不再演进、不得依赖；
    改为把提供方**复活到 `dsh-plugin-contraction` 分支**（`git restore --source=main` 只是复制，main 本身不动）。
    决策增量记档：D8「智能栈不迁移」原指插件不内嵌智能栈；本条按 §六 规格把智能栈以**外部提供方进程**
    形态放回本仓（`artemisMcpCommand` 拉 `python -m mcp_server`），与 S5「插件作 MCP client 转发」一致。
  - **实测依据（2026-10-13 摸底）**：main 的 `mcp_server` 26 文件（含 `rules.md` ⇒ 恢复后 G80 的 rules
    注入同时变真）；它**不直接 import 智能栈**，依赖扇面 = `artemis.runtime`（缺 `trace_store` +
    daemon 四件套：`daemon_client`/`server_lifecycle`/`supervisor` + `runtime/__init__` 收窄的五个导出名
    `ensure_daemon_running`/`submit_task_to_daemon`/`is_daemon_running`/`stop_task_on_daemon`/`process_supervisor`）、
    `artemis.data_engine.history_reader`、`artemis.tools.history`、`artemis.utils.{task_tree,ocr_xml_fusion,ocr_api,visualization}`、
    `artemis.core.diagnostics` 缺件、`artemis.sdk`（9 文件，worker 子进程经 `from artemis.sdk import Agent`
    懒加载）→ `artemis.agents`（67 文件，图与 LLM 栈）。agent 执行 = `background/task_runner.py` 子进程。
    HEAD 现存 72 个 artemis 文件与 main 的 diff 是**删除为主**（删 5.67 万行 / 加 205 行），存活文件基本同源 ⇒
    恢复兼容风险集中在 `runtime/__init__.py`（HEAD 收窄版，保其现有导出、**增补**缺名，不整文件替换）。
    运行时依赖（langgraph/langchain/google 系）在 pyproject **从未被删**；`paths.py` 在；`.env` 与
    `endpoint_library.json`（均 gitignored）在本机还在，缺 `config/artemis.jsonc`（main 跟踪该文件）。
  - **What**：恢复 ≈114 文件到本分支（`mcp_server/**` + `artemis/sdk/**` + `artemis/agents/**` + 上述散件）、
    `runtime/__init__.py` 增补导出、`uv sync` 补环境、`config/artemis.jsonc` 就绪、提供方工具面与
    插件 `types.ts` 契约逐字对齐（run=`task_desc`/`model`→`trace_id`；device_state 必填 `view_type` 答纯文本；
    manage 三动作；inspect 四动作；diagnose 仅 device_serial）。不做：不改 main、不改插件 TS/patch、
    不动 third_party、不迁 UI 控制台。
  - **How**：① `git restore --source=main -- mcp_server artemis/sdk artemis/agents` + 散件清单；
    ② `runtime/__init__.py` 增补五个导出名（保 HEAD 全部现有导出）；③ `uv sync`（uv.lock 变更要提交）；
    ④ import 追链 `uv run python -c "import mcp_server.server"` 迭代到通；⑤ `config/artemis.jsonc`
    default 块指 LM Studio（**本地端点值不提交**，按 main 原文是否含端点定提交形态）；
    ⑥ 起服务探针验 5 工具面（一次性探针脚本放 `$env:TEMP`，不入库）；⑦ py 全套 pytest 基线不回退；
    ⑧ live：profile Config 指本仓（`artemisMcpCommand` 用 `.venv/Scripts/python.exe` 绝对路径 +
    `artemisRepoPath`），`autogamer_diagnose`/`run_task` 真调用各一证（待端点就绪）。
  - **Verify**：`import mcp_server.server` rc 0；工具面清单与 `types.ts` 头注逐字一致；
    `uv run python -m pytest tests/unit tests/integration -q` 基线不回退；
    `mcp_server/rules.md` 在场 ⇒ 插件 rules 注入从 `missing-file` 转 ok（G80 live 面）。
  - **Done means**：
    - [x] 提供方子树恢复完毕且 import 通（`a7b85fd`，260 文件 / +6.4 万行，逐字来自 main；
          `import mcp_server.server` 与 `from artemis.sdk import Agent` 均 rc 0。
          追链修的四处幸存者兼容：`artemis/__init__` PEP 562 惰性出 `Agent`/`Builders`；
          `artemis/config/__init__` 惰性出 agent/llm/output 三组提供方名字（动作面导入仍不拖 LLM 包）；
          `artemis/runtime/__init__` 增补 daemon 五名 + `ProcessSupervisor`；
          `artemis/mcp/action_types.py` 并回 `ObserveResult`（分支重写版原样保留）。
          P4 边界守卫 `test_third_party_boundary.py` 参数随恢复树增长并全绿——它就是这次的判据）
    - [x] py 测试基线不回退：**685 passed / 1 skipped**（原 448 基线含在 内，增量 = 边界守卫新参数）；
          `ruff check` + `ruff format --check` 全绿
    - [x] 5 工具面与契约一致：`mobile_run_task` / `mobile_manage_task` / `mobile_inspect_trace` /
          `mobile_get_device_state` / `mobile_diagnose`（FastMCP `list_tools()` 实测）——与插件
          `mcpBackend.ts` 五处 `call` 名字**逐字一致**（Phase 2 锁的就是这份真面，零映射工作）
    - [x] `config/artemis.jsonc` 恢复为跟踪文件（main 原文：default 块即本机 LM Studio
          `127.0.0.1:1234/v1` + `qwen3.6-35b-a3b-mtp`，无凭据字面量，可直接提交）
    - [ ] live diagnose/run_task 各一证：**装置已齐**（提供方进程 + 配置就绪；`mcp_server/rules.md`
          回归也使 G80 的 rules 注入可转 ok）。挂起点 = profile 侧 Config（`artemisRepoPath` +
          `artemisMcpCommand` 指本仓 venv python）——待用户在宿主侧接好线后跑会话取证
- 2026-10-14 **Step 13 · 提供方收缩（用户裁定：D18 TS 主栈方向重申，py 只能以模块形态存在）**：
  - **背景与认账**：Step 12 的闭包恢复是「保证能 import」的机械方法，**拉回了远超提供方所需的内容**
    （255 文件含死代码）。用户指出这与仓库预期（D18：TS 主栈，py 仅以模块/库形态引入）相差太远。
  - **What**：收缩为**提供方真引用面 + 引擎本体**：删除 38 个零引用文件——旧控制台构建资产
    `artemis/resources/showcase_ui/**`（13）、旧 CLI 命令七件（`cli/commands/{batch,init,run,server,
    server_lifecycle,trace,ui}.py`，HEAD 动作面本就不依赖它们）、`artemis/interfaces/sdk/**`（3，D10
    已裁的 artemis-client 残 world）、legacy 垫片三件（`main.py`/`_legacy_imports.py`/`__main__.py`）、
    旧独立 `mcp/action_server.py`（新 15 工具面 = `adb_server.py`）、`artemis/telemetry/**`（5）、
    `artemis/drivers/cloud/cloud_driver.py`、`artemis/config/core/**`（3）、`third_party/mobile_use/
    {testing,utils/cli_helpers}.py`。**保留**：agents 引用的老动作面执行层（`action_executor`/`action_specs`/
    `action_session`/`action_names`/`observation`——grep 实证它们是引擎本体，flash/validator/operator 直接
    import）、全部 drivers、全部 package `__init__`。
  - **How**：逐 pattern `git grep -E` 零引用验证（含排除自身的负向过滤）后才删；删后四重验证 =
    `import mcp_server.server` + `from artemis.sdk import Agent` + 提供方工具面 + pytest 全套 + ruff 双检。
  - **边界声明（D18 语义落档）**：py 侧 = **按模块引入的 vendored 提供方**（`mcp_server` 进程 +
    其 agent 引擎闭包，代码冻结自上游、不手写演进）；TS 侧（DSH 插件）是主栈与唯一开发面。
    引擎体量（agents/graph/llm ≈ 一百余文件）是「任务执行语义」的最小闭包——再缩只能重定义任务语义
    （如未来 TS agent 替代，属 D18 演进项，另立方案）。
  - **Done means**：
    - [x] **37 文件**（showcase_ui 实数 12，原记 38 误）删除且四重验证全绿（`6ef32f5`，-3264 行）：
          `import mcp_server.server` + `from artemis.sdk import Agent` rc 0、提供方工具面五名不变、
          pytest **664 passed / 1 skipped**（685→664 的差 = 被删文件的边界守卫参数，符合预期）、
          ruff check + format 全绿
    - [x] 边界声明落档本条（见上）
    - [x] 结果回写并提交（`9af4bbe` 方案 → `6ef32f5` 实现）
- 2026-10-13 **Step 11 · `preset-autogamer` 增挂 `tool-cordis`（用户裁定「可以增加」，R22 方案先行）**：
  - **背景**：Step 10 调研证实 `cordis_inspect_query`/`cordis_inspect_list` 由 `@deepseek-ai/dsh-tool-cordis`
    提供、只有官方 `cordis` 预设挂它 ⇒ AutoGamer 会话无法自查工具面（R9 检查器不可用）。
    官方 `cordis.patch.yml` 的挂法 = 无 config 平行一行，照抄即可。用户 2026-10-13 批准。
  - **What**：给 `preset-autogamer` 加一行 `tool-cordis`（会话面自动多出 `cordis_inspect_list` /
    `cordis_inspect_query` 两工具，wire 面 12→14）。不做：改 `src/`（插件自身仍是七个注册工具）、
    改 `spike/headless-spike.patch.yml`（历史 spike 装置，非出货形状、无锁读它）。
  - **How（两处同步 + 一把锁）**：`cordis.patch.yml` 与 `spike/web-live.patch.yml` 各加同一行
    （位置对齐官方 cordis 预设：skill-filesystem 之前）；`tests/deliveryShape.spec.ts` 加
    `toContain("@deepseek-ai/dsh-tool-cordis")`——G37/G45 的教训：两份文件必须描述同一交付形状。
    README 的「七个工具」指 `apply()` 注册面，不受影响。
  - **Verify**：`pnpm --config.verify-deps-before-run=false run build|test` 全绿；
    R6：`dsh --profile web --patch <cordis.patch.yml 绝对路径> --dump-config` rc 0 且 grep 不到 `unmatched`；
    live（R7）：冷重启宿主后 AutoGamer 新会话按 Step 10 装置复跑 wire 抓包，应见 `tools=14`。
  - **Done means**：
    - [x] 两份 patch 各含 tool-cordis 行，deliveryShape 锁更新
    - [x] build 不需要（未改 `src/`，dist 不变）；vitest 全绿 **32 files / 293 passed / 1 skipped**
    - [x] R6 rc 0 且无 `unmatched`（合成树 1420 行含 `dsh-tool-cordis`）
    - [x] **live wire 抓包 `tools=14` 达成**：AutoGamer 新会话（qwen3.6-35b-a3b-mtp，10 秒无报错）里
          agent **真实调用** `cordis_inspect_list` → `cordis_inspect_query`（UI 工具卡片可见），自查清单
          14 个 = 本包 7 + `job_*`×3 + `skill` + `plugin_manager` + 检查器两件；wire 侧三个回合请求全部
          `tools=14` 且名单一致（双侧交叉验证）。R9 检查器从此在本包会话面可用。
    - [x] 结果回写本条并按方案/实现两次提交（`972845d` 方案 → `5d44cd9` 实现）
  - 环境已还原：端点回 1234、代理已停、宿主已重启在跑（新 preset 代际已生效）。desktop 按用户裁定暂不动。
- 2026-10-13 **Step 9 · 用户裁定落地，G71 结案（**#83**）**：待裁清单第 1、7 条已决——headless 死链
  **移除不重装**（rc 0，bundles 现为 `[dsh-base, dsh-headless]`；pnpm 11 又按 G49 机制留死 junction，
  已按 reparse point 摘除）；web 走完取证，desktop 不动；~~取证路用了**免审批的 `cordis_inspect_query`**
  （非代理抓包）~~（**此取证表述已被 Step 10 作废**：该会话面没有检查器，模型只是复述清单）。
  本机 dsh 现状复核：安装唯一（`where.exe dsh` 唯一命中 `D:\DeepSeek Harness`，
  CLI 0.2.0-rc.2），4 profile 并存。
  取证前置修了两处环境：① web profile 的**模型端点**——活配置是每 profile 一份 `cordis.patch.yml`
  （宿主设置投影；`settings.yaml.imported` 只是旧快照），web 的 `local` provider 停在已死的 `8080`，
  真会话首跑 5/5 重试 `Connection error. TRANSPORT`；按用户指示两次同步 desktop 现行值，终态
  `local` → `http://127.0.0.1:1234/v1` + `qwen3.6-35b-a3b-mtp`（`input: [text, image]` 声明随行，
  S5 负能力坑不踩），非模型条目不动。② rc.2 `patchReload` 无实现（D7）⇒ 冷重启生效；且杀 wrapper 后
  exe 子进程仍持 8090（`EADDRINUSE`），须按**监听 PID** 清理后再起。
  ~~取证结果：AutoGamer 预设新会话（qwen3.6-35b-a3b-mtp，18 秒往返、无报错）里 agent 调
  `cordis_inspect_query` 列出的工具面**恰含全部 7 个**~~（同上，复述不算取证；有效部分只剩：
  AutoGamer 预设可被选为新会话预设、模型往返 18 秒无报错——挂载层与传输层证据仍成立）。
  **G71 → CHANGELOGS #83**（正文与验收命令在彼；§四 的 G71 行与两个在办条目已按
  结案协议移除；#83 的取证表述由 Step 10 的 wire 抓包承接）。8090 宿主重启后仍在运行，
  待裁清单第 8 条（留/关）仍留给用户。

- 旧账去向：P4 A/B 归档与放弃清单见 CHANGELOGS **#71**；分支 `dsh-plugin-contraction`
  已推送（`0adb7f5`，run `38371033938`，CI 行为见下）；`pre-contraction` 为收缩前基线
  （`3fab0ee`，本地存档，不推送）—— **该 ref 现已不可解析**（`git rev-parse pre-contraction` = fatal），
  等价内容经 `main` 取得，见本节 Step 4。

- CI 修绿（run `38371033938` 全红之后）：首个 push run 6/6 红，根因全是旧树残留——
  前端/smoke-test 的 setup-node 缓存路径、依赖源门禁的文件 glob、fixture 步调的生成器，
  皆指向 P4 已删之物。修法（CHANGELOGS **#77**，含首绿前又红一次的补记）：删
  frontend/package 两 job、去 gen-sse 步、门禁去 npm 半与 client 行、pyproject 去
  client/workspace/admin/testpaths 并显式声明 `artemis*` + `third_party*` 命名空间包、
  pyright 范围同步、uv.lock 重锁；另修根 `.gitignore` 大小写陷阱（吞过 `src/env/`）。
  另挖出一真因：P4 重写 `artemis/__init__.py` 时丢了 `_legacy_imports` 寻址器（含其模块），
  安装后上下文 `import third_party` 全灭（`python -m`/pytest 因根在 path 上幸免）——
  即 fixture 步在隔离环境红的原因，命名空间映射已代换该机制。
  dispatch-only 那步仍指已删路径（G70 已放弃，不碰）。run `38376354428` 4/4 绿（双 OS），
  收缩后树第一次全绿。
- 下一步：离线实现齐（Phase 0–5，逐阶段条见 §六）；live 验证待条件具备——提供方形状记 **G72**、
  scrcpy 与真机项都在 §六 留白总账里按触发条件登记（**条目数不抄在这里**，那是一份会腐烂的副本），
  或听用户下一步指令。

## 一、最终形态

已清空，见「零、当前状态」。产品方向暂以第二节与第三节的冻结基线为准，新方案到达后改写本节。

## 二、决策记录（冻结基线，D1-D18）

2026-10-14 冻结：清空时保留作基线，新方案到达后按 R22 修订。

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 战略路线 | 项目以 **DSH 插件形态重生**；方案基线 = google/artemis 上游（upstream-rethink） |
| D2 | 队列底座 | 会话队列 = **DSH Inbox**（durable + QueueDock）；禁止自建队列容器/引 Redis；「autogamer-queue」插件概念已取消 |
| D3 | 设备模型 | **共享真机 + 完整闸门**（用户已决）：闸门/熔断/准入 = run_device_action 工具内部逻辑；每会话专属模拟器（上游 playground 模型）= 二期演进项 |
| D4 | 积压策略 | Inbox 无上限原生，零自建 |
| D5 | 重启恢复 | Inbox pending 原生恢复待派 + 插件启动显式 kick（已核实的唯一缺口）；动作无断点续跑（与上游一致） |
| D6 | 版本管控 | peerDependencies 声明 + runtime 强制校验 + conformance 契约测试；自研包精确 pin |
| D7 | 引入形态 | **三层分开**（守则 R2）：① 禁——手写 profile 目录内的 `package.json` / `cordis.patch.yml` 或在 profile 目录跑 pnpm；② 允许且为开发期主路径——`dsh --patch <path>`（`dsh --help` 明列的官方 overlay，可重复）；③ 交付形态——`plugin_manager install_bundle` 或 Web 侧边栏「插件」面板（面板具备 install/enable/disable/retry/compose 能力）。preset 声明由 bundle 补丁承载（注册表不扫目录、不接受路径）；**配置层热重载、代码层冷重启**（`patchReload` 字段 rc.2 无实现）；**声明只影响之后创建的 Agent**，复验必须开新会话（守则 R7） |
| D8 | 技术栈 | 插件 TS；py 复用动作面/驱动/诊断/helper/录屏(后补)；**langgraph 智能栈不迁移**（由 S11 单层替代） |
| D9 | 迁移路径 | **R2' 直通插件**（P0 即插件形态，质量 spike 把关；不过→回退三段式双跑，历史方案见 git）；一期红线=旧控制台**原地只读保留**（不删除） |
| D10 | 产品形态 | 项目=DSH 插件，**无独立外部 HTTP API 面**：不建 HTTP→SDK 桥、artemis-client 直接删、webhook 通知按需再建 |
| D11 | 审批 | 常规动作 never；**run_adb_command 整工具 ask**（allowed-once，唯一授权粒度）起步；headless 需显式 `policy: never` |
| D12 | 录屏 | 后续补齐（一期无录像） |
| D13 | helper | 二期 TS 复刻（保留与 Mobly/Appium 共存差异化能力） |
| D14 | 智能层 | **单层执行路由（S11）**：单 agent + 代码强制路由器 + validator/checker 只读 subagent；pro 一期内实现、调用逻辑保真；不做反思式自检（业界 SOTA 立场） |
| D15 | 契约核实口径 | **只用声明面**：`dsh --dump-config-schema` / `--help` / 随包 README / 已安装 npm 包产物；**禁止解包 app.asar** 去读宿主内部代码（2026-10-10 用户裁定）。既有 [dsh-verification](migration/dsh-verification.md) 里 37 处包内代码行引用属旧口径，沿用前须按声明面重验；README 与 CLI 旗标类证据（28 处）本已合规 |
| D16 | 插件分层与 realm | 官方口径（[upstream-plugin-forms](migration/upstream-plugin-forms.md) 二.6）：Host 插件提供共享服务（tools registry、agent loop、sessions 等），**preset 插件只向这些 registry 贡献 scoped tools / persona / prompt 片段 / policy**；preset 内提供服务的插件**必须与其全部消费方同处一个 `cordis:group` + `isolate` realm**，条目局部隔离不沿 Agent 注册 scope 传播；注册表 `mountRevision` 对「行激活失败」与「服务泄漏进 root realm」都是**直接拒绝整个 preset 挂载**（源码口径 `mount.ts:193,212-213`） |
| D17 | 自举引入 | 给 `preset-autogamer` 挂 `@deepseek-ai/dsh-plugin-manager/tools`（官方 shipped preset 里该行的 disabled 写作 `!!js '!ctx.get('profileContext')'`，即 UI 会话中可用），让 AutoGamer agent 能对自己执行 `install_bundle`。这是上游「让 Agent 给自己造插件」的现成路径，也是把引入流从手工迁到自动的落点；执行细节与红线见 [守则 R2 / R9](migration/plugin-contract-rules.md)。**2026-10-12 已落地**：preset 的 plugins 加 `- id: tool-plugin-manager`，`disabled: !!js "!ctx.get('profileContext')"`（**先写成 `false` 是错的，见 CHANGELOGS #26**：服务行 `plugin-manager` 自己就是 `!ctx.get('profileContext')`，工具行无条件开会要求一个不存在的服务，而缺服务按 D16 拒挂整条 preset；官方 Creator preset 用的正是这个表达式）（**不是**原设想照抄 `!!js '!ctx.get("profileContext")'`——官方 README 给的启用形状就是 `disabled: false`，且写明「Preset-backed sessions use their preset's tool-plugin-manager entry」；shipped `standard`/`ptc` 都是 `disabled: true`。⚠️ 但「照抄 `false`」的写法已在 #26 修成跟随服务条件）。live 已证：R7 新会话工具面从 5 个变 7 个、多出 `plugin_manager` 与 `skill`。⚠️ 代价按官方原文记在案：「installed Host code executes in-process outside the workspace sandbox」，且 plugin_manager 的**每个**动作（含 list_plugins/list_bundles）都要 danger-full-access 或该次审批；本仓库不替用户放宽权限模式（R19）。 |
| D18 | 长期技术栈方向 | **用户 2026-10-12 定：以 TS 为主，py 仅在「特定库成熟度高于 TS 同类库」时保留**（典型如 adb/uiautomator2 等设备库、视觉/CV 库）。新增与重构逻辑默认落 TS；py 是「库成熟度占优」的例外而非默认。本次 P4 收缩**不触发** py→TS 重写，只把保留 py 压缩到最小设备能力面（动作为主、零智能栈），作为未来 TS 迁移前的可验证基线。是 D8 之后的演进方向，不改变 D8 当下的动作面保留 |

## 三、对接语义（冻结基线，S1-S11）

2026-10-14 冻结：清空时保留作基线，新方案到达后按 R22 修订。

**S1 会话映射**
- ARTEMIS `conversation_id` ≡ DSH `SessionId`（✅ 核实：外部指定 + 幂等 create-or-adopt；id 会转义为磁盘目录名）
- 用户消息 = `followup` 进 Inbox（原生会话 FIFO + QueueDock 排队 UI）；会话记忆 = DSH 原生对话延续（py notes 继承机制消失）

**S2 任务 = turn 内动作序列（R2' 修订，取代「任务=job」）**
- 不再 spawn py worker job（R1 遗产）：设备动作 = `run_device_action` 工具调用，内部转发 py action server
- 长任务 = 单 turn 内多动作（工具内 await）；kill = `agent.cancel`（工具经 exec.signal 取消转发、释放闸门）
- 终态 = 汇报工具的 `completed/blocked + tests.failed`（run_outcome 双轴语义，盘点 04）

**S3 设备闸门（工具内的执行机制；策略出工具）**
- 闸门 = per-device 弱表 promise 链（官方样板 tool-bash-persistent：WeakMap<owner,Promise> + tracked pending 支持取消）+ `dsh-deque`；lockKey = endpoint+serial
- 阻塞获取（排队以 turn 进行中呈现）；parking（auto 单 ticket park 一台空闲设备）与全局并发上限（G28）内部化
- **与宿主并发约定对齐（守则 R14）**：官方已经规定「独立只读调用可并发，变更类调用独占执行并按提交顺序」，所以我们只补「同一设备跨会话串行」这半边；`take_screenshot` / `get_ui_hierarchy` 已声明为可并发，字段名为 `isConcurrencySafe`（`@deepseek-ai/dsh-tools` 类型原文，G33 落地时从已安装产物取得）

**S4 设备熔断（状态在插件，拒绝出口用 guard）**
- closed →open（连续环境级失败 ≥ allowed_fails，工程默认 1）→ half-open（下一条真实消息动作即探测）→ 成功 closed
- 环境级判定（R2' 改写）：**工具层错误分类**——action server 连接失败/adb 不可达/设备离线/锁屏 = 环境级；模型语义失败 = 任务级；枚举不确定→继续熔断（fail-safe）、探测失败→不挂（fail-open）不对称保留
- **冷却期的拒绝走 `ctx.tools.guard()`**（守则 R13：它是加在 `tools/pre-execute` waterfall 之后的单调同步守卫，后续监听器无法把拒绝翻回允许，且不受注册顺序影响）；只有需要 await 的决策才在 `tools/pre-execute` 返回 `ask`。官方原文「尽量不要把部署策略内建到工具中」，所以熔断**状态**归插件、**拒绝出口**归 guard
- 挂起期间新消息保留在 Inbox（QueueDock 可见）；解除矩阵（旧 inventory/01 四路径的无队列映射，矩阵轮定稿）：
  ①探测成功关（`recordSuccess`）②冷却到期半开（单探测，`probeInFlight`）③探测环境失败重挂新窗（非永久，时间必再开；
  此处的 fail-open 指**判定失败**——internal/unknown 不记（G38）——而非探测失败）④新提交/显式 resume**不旁路**健康态
  （与旧世界及本条旧句的显式偏差：健康态非批次态；半开保证冷却后首动作即探测，消息永不饿死；旧 resume 为逃永挂而设，
  此处无永挂故不需要）；cancel 不碰健康态（中止无健康信息；重启即 fresh breaker = 旧 stop 效果）。
  省略/空 serial 一律落 `defaultDeviceKey`（`deviceKeyOf` 三处同源）；`allowed_fails` 默认 1（contracts 锁死）。

**S5 执行层契约（py action server，原样复用）**
- 载体：`artemis mcp --server adb` 动作面（13 工具：tap/long_press/swipe/back/launch_app/stop_app/open_link/focus_and_input_text/focus_and_clear_text/erase_one_char/press_key/take_screenshot/get_ui_hierarchy）
- autogamer TS 工具内部作 MCP client 转发（**不裸用 dsh-mcp-client patch**——会绕过闸门）；进程由插件生命周期管理
- env 极简（对齐上游容器契约）：`ADB_DEVICE_SERIAL`/`ADB_HOST/PORT/SERVER_SOCKET`/`ARTEMIS_HIERARCHY_BACKEND` + helper 相关
- 返回契约：ActionResult（`isError=False + ok=False` = 设备拒绝，观察非异常）；0-1000 归一坐标（G24）；**超时不许指望 `timeoutMs`**——注册表绝不强制执行定义里的它（守则 R15），现状是由 `ActionClient` 的 `Promise.race` 自实现并观测 `exec.signal`（主体前取消 = `ABORTED_BEFORE_DISPATCH`，主体后取消只能把成功换成 `ABORTED`，超时为 `TOOL_TIMEOUT`）；要交给宿主执行须挂 `dsh-tool-call-timeout-policy` 包装层，其入参官方文本未列（守则待补 2）
- **裸 schema 注册是合法形态，但前提是给的东西已经是完整 JSON Schema**（守则 R12/R13 补正 + G30 实证修正）：`ctx.tools.register()` 直接收 schema 定义，官方自己就这么接 MCP——「MCP 服务器发现工具后，用服务器的 schema 调用 `ctx.tools.register()`」；`defineTool` 是类型化 DSL 糖，**但命名 spec 映射 → object schema 的编译只发生在 `defineTool` 里**（`parameterSchemaSpecToJsonSchema`）。我们曾用命名 spec 直接裸注册，LLM API 以 `parameters.type` 非 `"object"` 拒绝整个请求（400）。现状：两处定义都走 `defineTool()`，object 节点显式 `additionalProperties`（G34）。代价照旧成立：**工具自己负责输入校验**，非空字符串、正数、跨字段也要自查——现在的 `target` / `text` / `key` 校验就是这部分
- **宿主服务依赖与图像结果（G36 实证）**：`inject` 是**属性 GET 的闸门**，不是启动偏好——没声明的服务读一下就抛 `cannot get property "attachments" without inject`（不是返回 undefined）。工具要让模型看图的正道：`ctx.attachments.saveImages([{data: Uint8Array, mediaType, name}])` 换内容寻址引用，结果 `render` 成 `[text 信封, image 块]`（官方 `read_image` 就是这个形状），**字节绝不进 value / 会话日志**；宿主会自行把图提升成带真实 base64 的后续 user 消息，**不需要**给 preset 挂 fs 或 `read_image` 去开那个只读路径。两个必踩的坑：provider 配置 `models[].input` 的 schema 默认 `[]`，而声明面口径是「absent=unknown，显式省略=负能力」，于是图被替成 `[image omitted because this model accepts text only]`——要显式写 `[text, image]`；附件准入有上限（单边 8192px / 64M 像素 / 单图 20MiB，宿主还会重编码成 JPEG），被拒时降级成文本而不是失败整个动作
- **注册可见性（G30，已定性并关闭）**：`ctx.tools.register()` 返回 disposer **不等于 Agent 能看见该工具**——真正的坑不在 scope，而在**注册的生命周期**：cordis `effect()` 是「回调立即执行、返回值才是清理函数」，把 teardown 当回调体传进去，工具就在注册后数毫秒内被自己注销，而 roster/插件页/清单一切正常（G30 根因 ①，changelogs #10）。判「生效」仍只认官方检查器（`cordis_inspect_query` 的 `Tool` 项、roster 的 `enabled`/`fiberPhase`/诊断、`inspectCompositions()` 的 leakedServices），但**最快的一步是插件侧 wire 差分**：看新会话里「哪几个工具在/不在」，比读挂载诊断收敛得快

**S6 审批映射**
- 常规动作 never；破坏性面全部集中在 run_adb_command → **整工具 ask**（D11）；helper APK 安装/Chrome 强制标志 = 任务前置隐式授权（ARTEMIS_HELPER_AUTO_INSTALL 可关）；fail-closed 默认
- **授权红线（守则 R19）**：批准工具调用、回答 agent 提问、放宽策略这类「授予或确认权限」的动作**永远 user-only**，不得做成 agent 可调的工具，也不许由插件代答；同一操作只在 Host service 方法里实现一次，UI 动作与 agent 工具共用它（官方「one operation, two callers」），不许两边各写一份逻辑
- 附带观测口径：普通工具失败要收敛成结果返回，**不能中止本轮**（`UNKNOWN_TOOL` 等都是结构化错误而非 throw 出轮次）

**S7 重启对账**
- 插件启动：拉起/校验 action server → 扫 pending inbox 非空会话显式 kick（D5）→ 无孤儿 worker 概念（R1 遗产消失）

**S8 版本门禁**：conformance 契约测试锁事件/工具面/session 格式，接 `dsh plugin` 升级流。**版本差要盯住**：spike 全程跑 `0.2.0-rc.2`（2026-09-29），上游已发 `dsh-v0.2.1-alpha.1`（10-03）与 `dsh-v0.2.1-alpha.2`（10-09），alpha.1 的主题就是「让 Agent 给自己造插件」（即本次调研引用的两个 skill）；升级前 conformance fixture 视为过期

**S9 中途指导注入**：py 机制消失；DSH 侧 = `steer`/`followup` 原生（已核实）。按守则 R17 分两种唤醒语义：`agent.inject({content, source:{kind}})` 追加持久上下文但**不唤醒**（空闲 agent 保持空闲，下一次准入的 step 才看到），定时器要驱动工作必须调 `agent.followup()`；`source.kind` 要在插件里经 `MessageSourceMap` 声明——session format V4 在消息准入处**拒绝**已退役的 `{kind:'plugin', plugin:'<name>'}` 包装；对已 dispose 的 agent 要 try/catch。另注意 `whenIdle()` 不等于一个 followup 结束（多个输入可共享同一次运行区间），S3/S4 的等待判据要按此写

**S10 turn 执行（已裁定乙）**：用户消息 → Inbox → agent turn → 工具直调。R2' 下无 shim 需求（无 job、无 py worker 分支）；已核实的通用前提仍然有效：composition 挂 `dsh-tool-jobs`、`maxConcurrentJobsPerOwner`（默认 10）、创建 agent 不强制 model

**S11 单层执行路由（D14）**
- 结构：单 agent loop + `run_device_action` 路由工具 + validator/checker 只读 subagent + goal 工具（可选计划脚手架）
- 路由器按序判定（**代码强制，模型不可绕过**）：
  1. 目标置信：元素索引可解析且无歧义 → 短路径直执行（3-5s/步保持）
  2. 风险等级：破坏性/不可逆 → validator 前置 + approval ask
  3. 执行后效果确认（✅ 业界采纳 action-effect verification）：屏幕差分/dHash 确认生效 → 未生效 → validator 自愈梯（XML→坐标→pixel）→ 连败达阈值 → checker 审计通过才许重试
  4. 计划检查点：有 plan（goal 工具）→ 里程碑 checker 审计；无 plan = 仅出口审计
  5. 严格度梯级 off/final/checkpoints/strict = 路由器配置（run_device_task 入参）
- 保真对照（盘点 04 = 验收清单）：validator 升级梯原样；checker 三不变量按守则 R16 落地——**「判定 append-only 落 session log」不许用自写事件类型实现**（带新 `type` 的 append 会让 Session 拒开，`appendPluginRecord()` 虽写 ignorable 记录但 reserved for DSH 实验包），改走 `output.presentationMeta(args, value)` 把判定持久化进 `tool/result` 的 `meta`（可回放、且 `presentResult` 能重建卡片）或 storage service；只读与「释放与判定分离」两条不变；run_outcome 双轴；预算 = goal `maxGoalRounds` + checker 重试上限
- **PTC 让三期能力提前到一期可选**（守则 R14/R18 的 `mode: ptc`）：每个可见已注册工具都能 `await tools.<name>(args)` 直接调用并重入正常执行流水线，成功返回**策略处理后的规范 JSON 值**而非渲染文本，失败以 `ToolCallError` reject（只能读 `name` / `toolName` / `message`）→ validator 的确定性升级梯与 checker 的结构化复核都有现成载体；但呈现方式**按 agent 而非按工具**，同一 agent 内不能让一个工具只用 Native、另一个只用 PTC，且 PTC 中间值不落日志、无法回放
- 业界对齐（dsh-verification §八）：单 agent + 外部确定性控制是收敛方向，反对反思式自检；DSH workflow/PTC = 三期确定性 burst 现成机制

## 四、差距清单

| 编号 | 差距 | 阻塞点 / 下一步 |
|---|---|---|
| G72 | 本机提供方形状未定：插件默认 `artemisMcpCommand = ["python","-m","mcp_server"]`（`src/index.ts:76,179`，按 Phase 2 重核的 pre-contraction 5 工具面落的），而**本分支 `mcp_server/` 的 `.py` 计数为 0**，只有 `uv run artemis mcp --type adb` 的 **15 工具动作面**（13 是 `ACTION_TO_PY_TOOL` 的非 null 映射数，两者不是一回事） | 三条路，**②已被证据排除一半**：① Config 指到仍含 `mcp_server` 的外部 checkout；② 给本树动作面加映射层——动作面**没有 task/trace 类工具**（fixture 15 个里无 `run`/`status`/`stop`/`inject`/`view_summary`），`run_task`/`manage_task`/`inspect_trace` 三个工具无处可接，本分支也没有 REST 兜底（`git ls-files apps` = 0）；③ **用同仓的 `main` 挂一个 worktree 当提供方**（`main:mcp_server` 有 23 个 `.py`，含那 5 个工具模块与 `rules.md`），零外部依赖，代价是要为它单独 `uv sync` 一份环境并吃智能栈的重依赖。2026-10-13 Step 0/4 实测 |
| G74 | **映射层按已删的 5 工具面锁形状**，与本树动作面真返回不符：`take_screenshot` 实测是裸 base64 JPEG（226856 字符 / 170142 字节 / `image/jpeg`，py docstring 亦写 “base64 encoded JPEG string”），Phase 2 却记成 `file://…` 纯文本 | **只有 provider 那半边要改**：`artemis/mcpBackend.ts:170-196`（`view_type` 与 `screenshotPath: text`）、`artemis/types.ts:22-30`、`tools/getDeviceState.ts:105` + 两个 spec（`artemisMcpBackend.spec.ts:60-87`、`getDeviceState.spec.ts:36-48,104-117`），约 60 LOC。**`{index}` 侧不重复做**——它早已优先吃 `parsed_bounds` 并有锁（`apply.spec.ts:62`、`dedup.spec.ts:17`），上一轮把这条写成待办是我没核现状（R25）。**先定 G72 走哪个面**，两面的形状本就不同 |
| G75 | **一台 MuMu 被 roster 报成 4 台**：`list_devices()` 返回 `127.0.0.1:16384` / `:5555` / `:7555` / `emulator-5554`，四条 `android_id` 全等（`c0021066f3fbaf47`）、`ro.serialno` 全空 ⇒ 按 endpoint 分键的闸门、全局并发上限与熔断**4 倍计数** | **R20 已查证：两个上游都没有这个口径**（详见 [upstream-plugin-forms](migration/upstream-plugin-forms.md) 九），且 §十 补了一条更硬的约束：adb 文档里**只有 `emulator-5554` 的 console↔adb 端口配对有身份含义**，`127.0.0.1:*` 是裸 TCP 传输、端口可能随启动变化 ⇒ **钉 TCP serial 的白名单会静默丢设备**。三条诚实路线（钉 roster / py 增发身份 / 只明示计数单位）与代价在 §九；路线 ① 的改动面极小（`cordis.patch.yml` 加 `devices`，`devicePool.ts:166` 已实现「钉住就不枚举」），但要接受"多实例时操作者手工维护"。待裁定后按 R22 写方案再动码 |
| G76 | **坐标空间口径缺一道防护**：本机主视口 `Rotation90`，帧空间 **1600x900**（独立金标准 = `screencap` 的 PNG IHDR），而 `wm size` 报 **900x1600**；插件从截图取尺寸这条路已验正确（`imageSizeFromBase64` → `{1600,900}`，`toPixels` 往返精确，真点 `(800,87)` 命中搜索栏），但 Config 的 `screenSize` 手填项（`configuredScreenSize`）若按 `wm size` 填，同一点偏 **350x / 362y** | 二选一：删掉/显式标注该手填项「必须是帧空间尺寸」，或加一致性校验（与截图 IHDR 比对后拒绝或告警）。测量见 §零 Step 1 |
| G81 | `tsconfig.json` 的 `include` 只含 `src` ⇒ 插件的 **32 个 spec 从未被类型检查**。把 tests 纳入一次 `tsc` 实测 **144 条错误**（`apply.spec.ts` 独占 45、`preflight.spec.ts` 21、`conformance/contracts.spec.ts` 15）；vitest 只转译不查类型，所以「必填字段」这类守卫在测试里不咬人 —— G79 正是靠必填才成立的守卫，它的守卫强度现在只在 `src` 一侧 | 先量后修：加一个 `check:tests` 脚本（临时配置需覆盖 `rootDir`，否则 TS6059 全量爆），144 条不可能一把改完 ⇒ 按文件分批收敛并同步 CI；**不要在 G79/G80 的收尾提交里顺手改** |
| G78 | **`adb forward` 残留已实测证实**：`adb forward --list` → `127.0.0.1:16384 tcp:54254 tcp:18888`（18888 = helper 端口），而 MCP server 进程早已退出 ⇒ Done means 的「卸载无残留」**不是待验，是已被证伪**；建 forward 的一方是 py 动作面，插件 stop/dispose 管不到它 | 归属待定：插件侧兜底按 `host:port` 精确删（`--remove-all` 会误伤别处），还是 py 侧在自己生命周期内清（更接近 canonical 契约）。scrcpy 那一半仍缺二进制（留白 6/7） |

旧表 10 项的去向见 CHANGELOGS「已关闭差距史」（9 项放弃 + G36 行同步 UI 侧放弃），编号权威仍是 [registry](migration/registry.md)。

## 五、文档索引

已清空，改读 [导航](migration/README.md)（导航唯一权威）。

## 六、新方案：dsh-autogamer（用户方案，待核实后实施）

背景：用户 2026-10-14 提供完整规格（原标题 DSH-ARTEMIS，实现名已更正为 dsh-autogamer；
2026-10-14 修订版同步工具名前缀 `artemis_*` → `autogamer_*`，与插件命名空间一致，
description 注明底层由 Google ARTEMIS 驱动；此为用户定稿，推翻需明示）。
定位：不是另起插件，而是对当前实现（`plugins/dsh-autogamer`）的矫正；规格内 `dsh-artemis`
一律读作 `dsh-autogamer`（插件 id 已由 `autogamer-device` 改名，见本条 Phase 0 结论）。

### What（做 / 不做）

做：工具注册、配置投影、环境预检、任务生命周期管理、UI 卡片、设备画面、rules 注入。
不做：重写 py 逻辑、改 ARTEMIS 源码、内嵌 ARTEMIS Web 控制台、复制 ARTEMIS 代码。
形态：TS Host 半 + 浏览器半；ARTEMIS 作外部进程/服务调用，适配器统一 MCP 与 CLI 两后端，
运行时按可用性选择；插件自身 Apache-2.0 并在 README 致谢 ARTEMIS。
工具面（5 个，前缀 `autogamer_*`）：`autogamer_run_task`（500ms 内返回 task_id，不阻塞）、`artemis_manage_task`
（`status`/`stop`/`inject_instruction`，`recent_actions` 默认 5 步）、`autogamer_get_device_state`、
`autogamer_inspect_trace`（summary 默认首尾各 3 步加失败步）、`autogamer_diagnose`。
Config：仓库路径/uv 路径、默认 profile 与超时与设备、`injectRules`/`autoPreflight` 开关、
scrcpy 三参数、`traceRetentionDays`；全部经设置区声明，不碰原生设置页代码。
预检 `runPreflight`：uv、Python 3.12 以上、仓库路径、已安装、adb、设备、Helper 七项；
失败不阻断加载，工具调用时返回带修复命令的结构化错误；结果缓存 60 秒。
rules 注入：每次加载重读外部 `rules.md`，不缓存；主路径为系统提示贡献 API，
降级为工具描述尾部摘要（前 2000 字符）。
浏览器半：任务进度卡片（2 秒轮询、终态停）、设备画面（scrcpy H.264 加 WebCodecs，
降级 PNG 流，触摸回传转 adb input）、设置卡片（含预检面板）。

### How（顺序不可跳，R22）

Phase 0 核实（先做，无代码）：规格 §12 十项对照官方一手资料逐项确认，输出每项
「确认/降级/砍掉」结论回写本条；下述硬冲突未解不进 Phase 1。
Phase 1 骨架与预检 → Phase 2 完整工具集与配置 → Phase 3 对话流 UI →
Phase 4 设备实时画面 → Phase 5 rules 注入与打磨；每阶段独立验证通过再进下一阶段。
已知硬冲突（Phase 0 必须裁决）：
1. 浏览器半槽与 RPC/流通道（规格 §8 的对话卡片槽、设置槽、`autogamer.taskStatus` 轮询、二进制通道）
   与守则 R18 冲突——R18 只认 keyed toolview 槽，Web 不消费 Host 展示方法；
   未经官方出处证实的槽一律不得实现，先证实或走降级。
2. rules 注入 API 与 R16——证实不存在则按规格降级路径走。
3. settings 区 API 与 R19——同上，先证实。
4. `defineTool` 签名、description 国际化形态、`output.schema` 字段——以 G30 教训为准，
   schema 必须是完整 JSON Schema，否则 wire 400；先对已安装产物核实。
5. ARTEMIS 作外部依赖与本仓是其 fork 的现实冲突——规格 §1 的 5 个 MCP 工具面即已删的顶层
   MCP 面；MCP/CLI 后端需要外部 ARTEMIS 提供方（路径配置），本分支 uv 破损，
   CLI 路径的 JSON 输出格式一并在 Phase 0 核实。
6. 插件 id 改名（`autogamer-device` → `dsh-autogamer`）已执行（用户定稿）：目录、包名、
   patch 根行与 inner 行、MCP 客户端名、测试与脚本路径、CI 路径、文档引用同步改，R6 重跑。
全程门禁：改 patch 跑 R6，新会话验跑 R7，判生效只认 R9；任何降级必须在 UI 或错误信息中明示，
不静默失败。

### Phase 0 核实结论（分批回写，2026-10-14）

浏览器半轨道（上游 master 一手：包产物、slots.md 全树、三个官方 skill、扩展 README）：
- 包形态（规格 §12-6）：确认。`dsh.client`（platform/immediately/inject）加 `./client` export，
  有模板与 ui-cordis 实证；bundle patch 本身无 client 行（manifest 驱动）；`dsh.bundle.patch`
  字段存在。
- 槽（规格 §8.1）：`conversation.card` 不存在（slots 全树、slot-catalog、ui-cordis 注册均无），
  规格 §8.1/§8.2/§8.4 原样不可实现。可用：`tool.call.toolview`（按 wire 工具名 keyed，
  与 R18 一致）加 `tool.call.images`、`conversation.chat.node`（经事件注册加 kind）、
  `conversation.composer.dock`、`shell.overlay`、`sidebar.footer.action`。卡片落点 Phase 3 定。
- 数据通道（规格 §8.2）：`ctx.rpc.*` 不存在；改走 Typert Remote（`ctx.remote` 命名空间加
  @Remote 方法）或 `host.call`/`invoke`，或 `wire.view` 投影加事件订阅；2 秒轮询可用 remote
  方法实现。
- 画面通道（规格 §8.3）：H.264/二进制推送不存在（stream 与事件限 JSON）；可用 unary
  Uint8Array（multipart）与 exact Fetch routes。DeviceMirror 降级为截图轮询卡；
  触摸回传有 uplink stream（256KB 上限），Phase 3 定。
- 设置槽（规格 §8.4）：`settings.plugin.item` 不存在；可用 `settings.section`、
  `settings.general.item`、`settings.plugins.tab`、`plugins.item` 系。落点 Phase 2 定。
- ClientContext 即 `@deepseek-ai/cordis` 的 Context（用处别名）。
- 硬冲突 1 裁决：§8 原样砍掉，改用上述已证实通道（R18 保持）。

ARTEMIS 侧（本仓 git 历史，一手）：
- 后端启动（规格 §12-7）：`python -m mcp_server`，stdio 默认、SSE 8001 可选，FastMCP 标准协议；
  5 工具名与规格一致；工具返回字符串化 JSON，插件侧需解析层；提供方须为外部 checkout
 （本树已删对应智能栈）。
- CLI 路径（规格 §12-8）：旧 `artemis run` 无 JSON 契约（`--json` 仅 doctor/helper 有），
  「解析 CLI 的 JSON 输出」无契约可依 → CLI 后端按规格不可实现，砍掉（适配器只留 MCP 后端）。
- scrcpy（规格 §12-9）：仓内无 server 获取链，版本约束未知 → 用用户 PATH 的 scrcpy 或官方
  release 加 SHA 校验，Phase 4 定。
- rules 路径纠正：fork 实证在 `mcp_server/rules.md`（非仓库根）；外部上游根有无待提供方确定后复核。

### Phase 0 核实结论（续，2026-10-14：工具/设置/提示三路，已安装产物与上游一手）

工具定义（dsh-tools 0.2.0-rc.2 的类型产物）：
- `defineTool` 确认：选项含 name/description/parameters/output/execute，另有
  isConcurrencySafe、deferLoading、timeoutMs（声明 only，R15 不执行）、output 内 render
  与 presentationMeta。description 为纯 string，无 en/zh 对象形态 → 规格 §3.2/§4/§5 的
  description 对象写法砍掉，改纯 string（语言 Phase 1 定）。
- output 字段名即 output（含 schema），与规格一致。
- 硬冲突 4 裁决：确认（按真实签名实现；schema 须完整 JSON Schema，G30 不变）。

设置区（上游 settings 包一手）：
- `installSection` 查无；真实 API 为 configure（页面策略）加 revisioned form edits，
  Config 表单元由投影自动渲染。规格 §5 的 installSection 写法砍掉；预检面板改用已证实的
  settings 系槽（Phase 2 落点）。
- 硬冲突 3 裁决：确认（改用真实 API；R19 义务不变）。

系统提示（dsh-system-prompt 0.2.0-rc.2 加上游 practices 一手）：
- `contribute` 查无；真实 API 为 section（name/order/text，数字 order 排序）。rules 注入
  改用 section()，每次加载重读外部文件（规格 §7 主路径成立，仅 API 名修正）；这是官方
  提示扩展位，非自写会话事件，与 R16 不冲突。
- 硬冲突 2 裁决：确认（改用 section()）。

服务与生命周期（已安装 typings 与 cordis 4.0.4 一手）：
- inject 服务表确认：tools、systemPrompt、sessions、agents、attachments、llm、sandbox、
  invariants（settings、skills 只在上游）；pluginManager 不是服务（是 agent 工具名），
  不影响既有 tool-plugin-manager 工具行。规格 §3.1 的 tools/settings 组合可用
 （settings 类型来源 Phase 1 定）。
- `ctx.on('ready')`/`ctx.on('dispose')` 在 typings 里查无（Events 仅 internal 成员）；
  生命周期改用 `ctx.effect` 清理函数，预检保持首次工具调用时懒执行。规格 §3.1 入口形状
  据此改写。
- 插件 id 改名（`autogamer-device` → `dsh-autogamer`）已执行，用户定稿，见本条 Done means。

Phase 0 总账：§12 十项全部有结论——确认 6（包形态、defineTool、settings 真实 API、
systemPrompt section、inject 服务表、MCP 启动），砍掉 4（对话卡片槽系、RPC、H.264
推送、CLI 后端），降级 2（DeviceMirror 改截图轮询、scrcpy 外部提供），纠正 4
（description 纯 string、installSection 改真实 API、contribute 改 section()、
ready/dispose 改 effect）。六条硬冲突全部裁决完毕。

### Phase 1 偏差与落地（2026-10-14）

相对规格的偏差（均有出处，均已落锁）：
1. CLI 后端砍掉（Phase 0 已裁决，此处归档）：旧 `run` 无 JSON 契约，适配器只留 MCP 后端。
2. Config 无 description：schemastery builder 形态未证实，设置自动页不依赖它。
3. 预检暖机经 apply 内 fire-and-forget（typings 无 ready 事件）；失败只进缓存，工具调用时重判。
4. Helper 经 PATH 的 `artemis` 探测（非 `uv run artemis`，后者在调用方目录执行，探错环境）。
5. settings inject 与 section 推迟到 Phase 2（待 live 挂载证明，G30 形态风险）。
6. 后端接口最小化（其余 4 方法 Phase 2 随工具落地，不写抛错桩）。
7. 新增 `artemisMcpCommand` 字段（规格假设固定启动命令，提供方安装形态各异）。
8. live 验收推迟：无外部 ARTEMIS 提供方，真实设备状态与 R7 新会话验证待提供方配置后补；
   mock/单测覆盖全部新路径（预检 7 项、后端映射与错误词汇、工具门禁与渲染）。
新文件：`src/artemis/types.ts`、`src/artemis/mcpBackend.ts`、`src/env/preflight.ts`、
`src/tools/getDeviceState.ts`；既有三处锁同步更新（双 conformance 断言、Config 全字段、
G30 寿命断言）+ README Layout。

### Phase 2 偏差与落地（2026-10-14）

动工前重核旧 face（`pre-contraction:mcp_server/tools/*.py`），规格 §4 的后端假设多处不成立，
映射一律按真 face 落锁（出处逐条写进 `src/artemis/types.ts` 头注）：
1. run 取 `task_desc`/`model`（Flash/Pro），答 `trace_id`；`timeout_seconds`/`max_steps`
   无提供方对应——承认但不转交（含注释与单测）。
2. device state 取必填 `view_type`（screenshot/hierarchy），答纯文本（`file://…`/
   层级转储/`Error: …`）而非 JSON —— Phase 1 的 JSON 映射已按真契约重写，旧断言同步修正。
3. manage 即 status/stop/inject_instruction over `trace_id`（与规格一致）。
4. inspect 固定调 `view_summary`，summary/full 在工具侧切片（首尾 3 加未覆盖失败步，
   按 index 去重；失败启发式：fail/error 状态或显式 false）。
5. diagnose 只转交 device_serial（旧 face 无 logcat/screenshot 开关）；工具合并本地预检
   修复进 recommendations，不抛环境错（诊断即手动预检入口）；双坏时预检文本优先。
6. settings：Host 侧无需代码（Config 投影即全部）；`installSection` 已裁，client 设置卡片
   并入 Phase 3（client 基建在那里一次落地）。
7. 适配器退化为工厂（CLI 已砍，仅剩一种后端；选择规则留给第二后端）。
新文件：`src/artemis/adapter.ts`、`src/tools/envGate.ts`、`src/tools/runTask.ts`、
`src/tools/manageTask.ts`、`src/tools/inspectTrace.ts`、`src/tools/diagnose.ts`；
三处旧锁同步到七工具（双 conformance、G30 寿命、Phase 1 新增断言）+ README Layout。
live 仍缺外部提供方（映射 refinements 待真证据）。

### Phase 3 偏差与落地（2026-10-14）

浏览器半按上游一手原文落地（decoration 模板、slots.md、client 构建面）：
1. `dsh.client`（platform/immediately/inject）加 `./client` export，缺一不可；bundle patch
   本来就没有 client 行（manifest 驱动）。
2. client.js 手写 ModuleLoader 形态（tsc 发不出该格式；部署侧 tsdown 链未被文档为插件
   API，不盲接）：React 取自浏览器模块表，`inject: ['slots']` 为模板证实的最小集。
3. 卡片全部落在已证实的 `tool.call.toolview`（keyed，按 wire 工具名），五个任务工具各一格；
   DeviceMirror 即设备状态格（path 行占位，无二进制通道即无真画面）。
4. 卡片只渲染调用自带 args/result（owner props 宽容读取）；轮询、控制、设置卡片无已证实
   通道，全部推迟到挂载实证之后（远程服务挂载路径同样未证实，不自建）。
5. 零样式属性（token 名未证实，纯元素继承宿主主题）；除 react 外零 require。
单测：manifest 形态、ModuleLoader 形态、五 key、import 白名单、六项 cut-API 否定锁。
live 缺挂载实证（槽解析、key 生效、卡片渲染均需真会话）。

### Phase 4 偏差与落地（2026-10-14）

动工前先读 scrcpy 一手文档（README 许可证与官方源警告、`doc/develop.md` 执行章、
`Options.java` 开关表），再定诚实子集：
1. 推送序列即文档原样：push 到 `/data/local/tmp/scrcpy-server.jar`、forward
   `tcp:{port}`（默认 27183）到 `localabstract:scrcpy`、CLASSPATH app_process 加版本
   首参（严格一致，不兼容即拒跑）加 key=value 开关。
2. 只用文档证实的开关：tunnel_forward/audio/control/cleanup/raw_stream/max_size/
   max_fps/video_bit_rate；control=false（画面-only，走文档 raw recipe），触摸走
   `adb shell input` 降级（`src/scrcpy/input.ts` 纯函数）。
3. `stream.ts` 不存在（无 DSH 二进制通道，写了就是死代码）；`fetch-*.ts` 不存在
   （无已核实分发端点，手动安装见 README）；stop 的 pkill 为最佳努力（上游无 kill
   文档，warn-only）；启动 forward/握手竞态如实标注未解（需真机）。
4. 版本来源：显式路径文件名，无版本名则拒；sidecar 先读 jar 文件名，读不出再读同级
   `scrcpy --version`（绝不猜）。
新文件：`src/scrcpy/server.ts`（resolve/start/stop/dispose 全懒）、`src/scrcpy/input.ts`；
Config 加 `scrcpyServerPath`；index 只构造加析构（无工具驱动，注释写明）。
live 全部推迟（本机无 scrcpy/adb，20fps/触摸/无残留均需真机）。

### Review（P5 前，2026-10-14）

账实核对（全绿 276/1 前提下）：修 4 处 stale——index 头注 P0 字样、Config 注释 scrcpy
已接线、settings 注释 Phase 2 已过、README 的 `disabled: false`（#26 早已改跟随条件）；
补 5 条覆盖（stop-warn、structured 非对象、无文本载荷、uv 双坏、helper 缺二进制）。
有意未覆盖：各模块的真执行器（defaultRun/defaultWhich/spawnDetached）——环境相关，
mock 侧全覆盖，单测跑在无 adb 无 scrcpy 的机器上仍全绿。
两次编辑差点吃掉相邻用例头（锚定只取头行是大忌，见本次两个修复提交意外的 diff 习惯：
新 `it` 必须连同被挤的旧头一起重写）。

留白总账（定位用，补白时直达；触发条件写明）：
1. 外部提供方缺席 → 七工具真调用与 R7（触发：artemisRepoPath 指向可用 checkout。**2026-10-13 Step 0：本树只剩
   15 工具动作面（`uv run artemis mcp --type adb`），`mcp_server/` 的 `.py` 计数为 0 → 形状之争已立 G72**）。
2. toolview 挂载实证：槽解析、key 生效、卡片渲染（client.js；触发：真会话 R7/R9）。
3. 轮询/控制/设置卡片通道（触发：挂载实证 + remote 挂载路径证明）。
4. H.264 转发：无通道，砍（重开条件：DSH 二进制通道出现）。
5. scrcpy 下载脚本：不建（手动安装见插件 README；重开条件：已核实分发端点）。
6. 无残留进程：stop 的 pkill 最佳努力（server.ts；触发：真机 **且 scrcpy 装好**——2026-10-13 Step 0：MuMu 已就位，
   但 `scrcpy` 不在 PATH，`artemis doctor` 报 `Missing: scrcpy`，此项与 7 仍不可跑）。
7. forward/握手竞态（server.ts start 注释；触发：真机 + scrcpy）。
8. 后端映射 refinements（P2 记录；触发：真提供方证据）。
9. run_task 500ms 对真提供方（触发：真提供方）。
10. `uv tool list` 解析假设（preflight.ts installedCheck；触发：真输出）。
11. defaultTimeoutSeconds 无消费者（Config；P5 定去留）。
12. traceRetentionDays 无消费者（Config；P5 定去留）。
13. scrcpyEnabled 无读取处（manager 按需启动；P5 定去留）。
14. settings inject/section 活证明（触发：真会话挂载）。
15. README release URL 旧名（历史资产，保持；下版本换新）。
16. dsh.client 挂载实证（package.json；触发：真会话）。
17. ~~roster 真枚举「一台算几台」~~ **已测（Step 1）：一台 MuMu 报成 4 台**，后果与去重方案记 **G75**。
18. ~~图像附件是否被降级成文本~~ **端点侧已排除（Step 2）**：真发一次带 `image_url` 的请求被接受（`prompt_tokens: 27`，
    无 vision 拒绝），`capabilities` 不列 vision ≠ 不收图。**剩余风险只在 DSH provider 的 `models[].input` 声明**
    （S5 的负能力坑），触发条件仍是真会话 → 被 **G71** 挡。
19. ~~键事件投递可靠性未定性~~ **已定论（Step 2，n=10 单变量）**：raw `keyevent KEYCODE_HOME` **0/10**、
    raw `keyevent 4`(BACK) **10/10**、HOME intent 每次都生效 ⇒ HOME 注入在这台 MuMu 上**确定性失效**，不是抖动。
    根因不在设备也在契约：`adb_driver.py:372-383` 的 `press_key` 发完 shell **无条件 `return True`**
    ⇒ py 按键面**没有效果语义**，按键类动作的判定只能靠 `compare_ui_frames`（S4/S11 词汇边界，已据此收窄）。
20. **锁屏三态**（Step 2 定性）：真机只到 `is_locked:false`，但 `true`/`null` 两个**判定分支两边单测都锁死了**
    （py `tests/unit/core/test_diagnostics.py:83-104`、`tests/unit/mcp/test_device_listing.py:127`；
    插件 `tests/devicePool.spec.ts:267,272,282`）⇒ 诚实表述是「live 未触达、分支已锁」。
    **真洞在 unknown 的成因**：dumpsys 超时 / `returncode!=0` / 异常 三条通往 `None` 的路径**两侧都无测**
    （只有 monkeypatch 级的上层假数据）—— 触发：造一次 adb 不可答的同屏复测。
21. ~~层级面稀疏度差异极大~~ **已答（Step 2，属设计行为）**：`filter_ui_hierarchy` 默认
    `semantic_pruning="hoist"`（`artemis/utils/ui_filter.py:425-433`）丢语义空节点，而 UIAutomator2 的解析是
    **扁平无 `children`**（`third_party/mobile_use/clients/ui_automator_client.py:106-145`）⇒ 容器整条消失；
    helper 可用时**走同一个 filter**（`artemis/clients/screen_client_factory.py:221-228` 只换来源不换过滤），
    所以稀疏**不是 helper 缺位造成**。口径早已在 `inventory/03-device-media-diagnostics.md:199`，本轮补真机确认
    （桌面 5→36 随屏内容变化，Settings 36）。对 `{index}` 的后果转记 **G74**（改吃 `parsed_bounds`）。

### Phase 5 偏差与落地（2026-10-14）

rules 注入走 Phase 0 核实的真 API 全程可测：
1. `systemPrompt.contribute` 不存在 → 改 `section({name, order, text})`（order 取规格的 50）。
2. 路径纠正：`<repo>/mcp_server/rules.md`（fork 实证，非仓库根）。
3. inject 加 `systemPrompt`：可解性由 Tier-1 真 runtime 挂载实证（boot 真服务 + 本插件
   真 inject 表，挂载即证明，G30 机理反用为锁）；文本到达模型上下文仍需真会话。
4. 失败策略：缺旗标/缺路径/缺文件/读失败/空内容一律 warn 跳过，永不抛，永不阻断挂载。
5. 无消费者 Config 去留：`scrcpyEnabled` 接通（关则不建 manager）；`defaultTimeoutSeconds`
   与 `traceRetentionDays` 保留（规格必填，无消费者，注释写明）。
新文件：`src/prompt/rulesInjector.ts`；dsh-types 加 systemPrompt 镜像（含出处）；
README 加段落与 Layout 行。
错误路径补齐见 Review（本条 P5 前一节）。

### Verify

每阶段按规格 §10 对应条目验收；外加文档双门禁 exit 0；插件 tsc exit 0、vitest 全绿；
R6 exit 0 且无 `unmatched`；mock 后端支撑全部单测，无需真机；真机项（20fps、触摸延迟、
长任务轮询）留 live 验收，需用户授权。

### Done means

- [x] Phase 0：十项核实结论回写本条，六条硬冲突逐条裁决（确认/降级/砍掉）
- [x] 插件 id 改名定案并同步（`dsh-autogamer`，用户定稿）
- [x] Phase 1–5 按验收逐阶段落地（离线面；live 见留白总账）
- [ ] 卸载无残留进程：scrcpy 那一半仍缺二进制（留白 6/7）；**adb forward 那一半 Step 2 已实测证伪**
      （server 退出后残留 `tcp:54254 → tcp:18888`）→ 转 **G78**
- [ ] README 完整化（Phase 5 已加段落与 Layout 行，双向锁在 `#61/#64`；仍待随 G71 的交付形态更新安装流一节）
