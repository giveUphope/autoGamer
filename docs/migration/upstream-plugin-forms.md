# 上游插件形态与工具形态调研（第一轮 2026-10-10 · 第二轮 2026-10-13）

> 来源口径：`github.com/deepseek-ai/deepseek-harness` @ `master` 的公开文档与源码，符合 [TODO.md](../TODO.md) 的 D15（声明面 + 公开上游，不解包 app.asar）。每条标 **文档口径** / **源码口径**；本机尚未复验的写 **未实测**。
> 取用方式：`gh api repos/deepseek-ai/deepseek-harness/...`（仓库确认为 public、default branch `master`，描述「DeepSeek Harness: Everything is a Plugin」）。原文副本落在 `plugins/dsh-autogamer/spike/sandbox/`（gitignored，只作取证现场，不作引用依据）。

## 一、为什么要查

S10 live 复验给出两个事实：AutoGamer 会话发给模型的请求里**连 `tools` 键都不存在**；而把 `preset-autogamer` 的 plugins 换成「standard 的全套顶层工具插件 + 我们的 inner」并在**新会话**里发，请求变成 `tools=16`，16 个全是内置工具，`run_device_action` / `report_task_status` 一个都不在。

上一轮我据此写下结论「内置 `@deepseek-ai/dsh-*` 名字作为 preset 子项能解析，而 profile 级 link 安装的外部插件名不被解析」。**这条归因不成立**，第四节逐条收回。

## 二、硬事实（会影响方案的九条）

1. **preset 只能是 bundle 补丁**（文档口径，`editing-cordis-compositions/SKILL.md`）：「Agent presets are ordinary `@deepseek-ai/dsh-agent-preset` declarations carried by bundle patches. Nothing edits a declaration in place」；注册表 README 第 48 行补充「新建 preset 或覆盖内置 preset 都是 bundle 补丁……再用 `plugin_manager` 安装到 profile」，并明确「**注册表不扫描目录，也不接受 preset 路径**」。
2. **安装正道是 `install_bundle`，且明令禁止手写 profile 文件**（文档口径，`cordis-plugin-development/SKILL.md:8-10`）：「Do not write the profile's `package.json` or `cordis.patch.yml`, create packages under `$DSH_HOME`, or run pnpm in the profile directory: `install_bundle` performs those steps」。→ 我们现在这套 `dsh plugin add file:` + 手写 patch 的做法，正落在被禁止的那一侧。
3. **覆盖是整体替换 config**（文档口径，`cordis-composition-reference/SKILL.md:15`）：「`config` is replaced wholesale, never deep-merged, so restate every field the row needs」；且「A truthy `name` **asserts** the existing plugin name rather than renaming it」。非 insert 且 id 匹配不到行的补丁会 **warn 并跳过**（同页 16 行）。
4. **声明只影响之后创建的 Agent**（文档口径，两处一致）：`agent-preset/README.zh.md:12`「声明会提前加载，**修改只影响之后创建的 Agent**」；`editing-cordis-compositions` Verify 段「Existing sessions and their children **keep the plugin revision they started with**; validate changed behavior in a new session」。
5. **挂载会被整体拒绝**（源码口径，`packages/preset/agent-preset-registry/src/mount.ts`）：`auditRows()`（:134）收集「Rows that never started or whose import or activation rejected」（:116）；`mountRevision` 里 `:193` 注释「**Failed rows and root-realm service leaks reject the mount**」，`:212-213` 分别 `throw` 出失败行清单与 `Preset services require isolate realms: ...`。`leakedServices()`（:69）读的是「子树把实现发布进 **root realm**」的服务名。
6. **isolate realm 是硬约束**（文档口径，注册表 README 第 58 行）：「preset 的服务提供方及其消费方必须共享同一个 `cordis:group` 隔离 realm。**条目局部隔离不会沿 Agent 注册 scope 传播：组外的普通 Context 查找（包括 `agent.ctx`）仍选择 Host realm**」。`editing-cordis-compositions` 的 placement 段（:78-80）给出分层约定：Host 插件提供共享服务（含 tools registry、agent loop、sessions…），**preset 插件向这些 registry 贡献 scoped tools / persona / prompt 片段 / policy**。
7. **官方给了现成的活门禁**（文档口径，三处）：`list_plugins` 报告每行的 `enabled` 与 `fiberPhase`，`set_plugin` / `set_bundle` 在有上层胜出时回答 `overridden`（composition-reference:25）；「A declaration whose activation fails **stays on the roster with its diagnostic** and cannot compose a session until the bundle is fixed and reinstalled」（editing skill Verify 段）；`inspectCompositions()` 返回 preset ID、活动模块引用与解析基址、**以及泄漏的服务名**（注册表 README:62）；`cordis_inspect_query` 能直接问「**the Tools this Agent can call**」（development SKILL 第 30 行的 Tool 项）。
8. **我们的 inner 写法与官方 shipped 形态同构，不是格式问题**（源码口径）：`packages/bundle/web-app/presets/minimal.patch.yml` / `standard.patch.yml` 里工具插件就是裸子项 `- id: tool-fs` / `- id: tool-jobs` + `name: '@deepseek-ai/dsh-…'`，与我们的 `- id: dsh-autogamer-inner / name: dsh-autogamer / config: {actionServerCommand: […]}` 同形。带服务的官方样板则包在 `name: cordis:group` + `group: true` + `isolate: {terminals: true}` 里（minimal 的 `persistent-shell`）。外部 bundle 的插件确实可出现在 patch 中（composition-reference:29「Plugins outside this list come from installed bundles」）。
9. **版本差**：上游 releases 已有 `dsh-v0.2.1-alpha.2`（2026-10-09）与 `dsh-v0.2.1-alpha.1`（2026-10-03），本机 spike 跑的是 `0.2.0-rc.2`（2026-09-29）。alpha.1 的主题按公开报道是「让 Agent 给自己造插件」，即上面那两个 skill 的落地。

## 三、收回上一轮的两条结论

- **收回「外部插件名不能进 preset 子项」**：没有任何官方文档这样说；相反 composition-reference:29 承认 installed bundles 的插件。而 01:51 那次 `tools=16` **同时变了两个量**（plugins 集合 + 旧会话→新会话），按事实 4，光「换成新会话」这一项就足以解释「此前无 `tools` 键」。所以那次的正确读法是：**旧会话沿用其启动时的 preset revision**，与外部性无关。
- **收回「裸 `- name:`（无 id）子项产不出工具」**：与 `agent-preset/README.zh.md:48` 直接冲突——「**子插件可省略行 ID，由 Loader 分配**」。这条实测差异的真实原因还没定性（可能同样是 revision 混淆），不许再当作约束写进方案。

两条都是我自己写进 `TODO.md` 并已提交的（`1f05039`），现在按本节修订。

## 四、对方案的冲击（改哪条、为什么）

| 位置 | 冲击 | 处置 |
|---|---|---|
| D7 引入形态 | 「`dsh plugin add` + 手写 patch」是官方禁止面，且 preset 声明必须由 bundle 承载 | 改写为 `plugin_manager install_bundle` 正道，CLI `--patch` 降级为临时实验层 |
| 决策表 | 缺「Host 提供共享服务 / preset 贡献 scoped tools」这条分层约定与 isolate realm 约束 | 新增 D16 |
| S5 执行层契约 | 原契约只讲「工具注册成功」，没讲注册落在哪个 realm、Agent 看不看得到 | 补作用域可见性一条，并把判据从 wire 换成官方检查器 |
| S8 版本门禁 | conformance fixture 录自 0.2.0-rc.2，上游已两版在前 | 补版本差与重录触发条件 |
| 差距清单 | P0 真实阻塞点是「preset 挂载被整体拒绝」这一族失败，原先没有对应条目 | 新增 G30 |
| P0 状态 | 上一轮两条归因要作废 | 按本节改写，不删历史记录（走 git） |

## 五、下一步判据（按成本排序，全部是官方给的）

1. **roster 诊断**（零成本）：Web「插件」页 / `list_plugins` 看 `preset-autogamer` 行的 `enabled`、`fiberPhase` 与诊断文本——官方明说激活失败会留在列表里带诊断。这一步能直接判「是 mount 被整体拒绝」还是「挂上了但工具不在 Agent 面上」。
2. **`cordis_inspect_query` 的 `Tool` 项**：列出「本 Agent 可调用哪些工具」。这替代我们目前靠 wire 反推的做法。
3. **`inspectCompositions()`**：若返回 `leakedServices`，即命中 mount.ts:213 那条 `throw`，修法就是按事实 6 把 provider 与消费方放进同一个 `cordis:group` + `isolate`。
4. 以上三条都要求**改完在新会话里验**（事实 4）。

## 六、未读与待查（别当已证）

- **状态更新（同日第二轮）**：上一版列在这里的「已取回未逐字读」清单——`references/practices.md`（官方列为「选择扩展点之前必读」）、`host-plugin.md`、`ui-plugin.md`、`user-actions.md`、`verification.md`、`docs/cookbook/adding-a-tool.zh.md`、`packages/core/tools/README.zh.md`、`packages/bundle/web-app/presets/minimal.patch.yml`——**已逐字读完**，成果写成守则 R13-R19 并据此改写了 S3/S4/S5/S6/S9/S11/P3，本文不再重述（避免两处平行口径）。**仍未读**：`docs/capability-seams.md`（63 KB）、`docs/tool-catalog.md`（102 KB，官方口径本就要求按关键词 grep 而非整读）、`docs/tool-execution-pipeline.md`、`packages/jobs/jobs/README.zh.md`、`dsh-tool-call-timeout-policy` 的包 README、`docs/subsystems/scope.zh.md`。
- 第三方站（`deepseekdocs.com`、`dshplugin.store`、`awesome-deepseek-harness-plugins`、`dsh-plugin-radar`）：**未读**，只在搜索结果里出现，不作为任何结论的依据。
- 0.2.1-alpha.2 相对 rc.2 的 breaking change：未读 CHANGELOG，未实测。

## 七、出处

- 仓库与发布流：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（`gh api repos/deepseek-ai/deepseek-harness`、`.../releases`）
- [editing-cordis-compositions/SKILL.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md)
- [cordis-plugin-development/SKILL.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md) 及其 [references/mcp-bundle.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset/skills/cordis-plugin-development/references/mcp-bundle.md)、[templates/decoration/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/cordis.patch.yml)
- [cordis-composition-reference/SKILL.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset/skills/cordis-composition-reference/SKILL.md)
- [packages/preset/agent-preset/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset/README.zh.md)、[packages/preset/agent-preset-registry/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset-registry/README.zh.md)、[src/mount.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset-registry/src/mount.ts)
- [packages/core/scope/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/scope/README.zh.md)
- shipped preset 模板：[presets/minimal.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/presets/minimal.patch.yml)、[presets/standard.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/presets/standard.patch.yml)
- [docs/cordis-primer.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md)、[docs/cookbook/adding-a-package.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-package.zh.md)
- 搜索结果里出现但未读的第三方站：[Plugin Ecosystem - deepseekdocs.com](https://deepseekdocs.com/en/ecosystem)、[awesome-deepseek-harness-plugins](https://github.com/walkinglabs/awesome-deepseek-harness-plugins)、[dshplugin.store](https://www.dshplugin.store/)

## 八、第二轮调研（2026-10-13）：插件管理面的安装 / 卸载契约

> 触发：插件改名 `autogamer-device` → `dsh-autogamer`（提交 `70cc7af`）后，本机 web profile 的组合包选择仍指旧名，
> `--dump-config-schema` 直接 rc=1。为定「按官方路径怎么卸载旧名插件」而查。
> 版本：本机宿主 `dsh 0.2.0-rc.2`（`where.exe dsh` → `D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`，动态解析、不写死盘符）；
> 上游 `deepseek-ai/deepseek-harness` @ `master`，2026-10-13 经 `gh api repos/.../contents/...` 取。
> 口径标注沿用本文头的约定；本节另有**本机实测**一类，按 R21 与「单测证明 / live 证明」分开记。

1. **`dsh plugin` 只是 pnpm 转发，`remove` 清不掉组合包选择**（文档口径，`docs/cli-help.zh.md` 的 `dsh plugin` 段）：自述
   「manage a profile's plugins by **forwarding the remaining arguments to pnpm** in the profile directory」，参数示例
   `add <pkg>`, `remove <pkg>`, `why <pkg>`。`dsh.profile.bundles` 是 dsh 自己的字段，pnpm 不触碰它——所以 CLI 卸载只删依赖，
   bundle 选择会留着，故障照旧。**CLI 侧不存在卸载命令。**
2. **`remove_bundle` 才是把两步一起做掉的那个**（源码口径，`packages/boot/plugin-manager/src/index.ts:645-669`）：
   `listBundles()` → 要求 `bundle.removable` → `if (bundle.enabled) await this.selectBundle(name, false)`（**这一步才清
   `dsh.profile.bundles`**，`README.zh.md` 原文「组合包开关修改 `package.json` 的有序 `dsh.profile.bundles` 列表」）
   → `runPnpm(['remove', name])` → `refreshPackages()`。pnpm 那步非 0 或超时即抛。
3. **可移除性判据**（源码口径 `index.ts:315`）：`removable = owned || (enabled && !installed && !shipped)`，其中
   `owned = installed && !shipped`；而 `installed` **只表示 profile 是否声明该依赖**（文档口径 `README.zh.md`）。清单读不到的包
   （我们的死链正是）在 `index.ts:324-327` 仍会被列出并带 `error`，`removable` 照算；`README.zh.md` 另写明「插件页面显示错误并
   **允许取消选择**」。
4. **三个会挡住卸载的失败码**（源码口径 `index.ts:649-665`）：`not-removable`、`stop-profile`（`hmr` 未开且该包在
   `startedBundles` 里——本 profile 写了 `patchReload: "live"`）、`bundle-in-use`。
5. **入口只有两个**（文档口径 `README.zh.md`「使用本包」段）：Web 侧边栏**插件**页，或会话里的 `plugin_manager` 工具
   （`src/tools.ts:23` 的 action 枚举：`list_plugins` / `list_bundles` / `set_plugin` / `set_bundle` / `install_bundle` /
   `remove_bundle` / `list_version_exemptions` / `set_version_exemption`）。**每个动作都要求 `danger-full-access` 或该次调用的批准**，
   批准不改变会话权限模式；改动影响该 profile 的全部会话。
6. **`link:` 交付本身官方认可，违规的只是手改 profile 文件**（文档口径 `README.zh.md`：「开发目标保留普通 `link:` 依赖……
   链接包使用该 checkout 的依赖与 peer；**代码改变后仍需重新构建并重启**」）。与本文**二.2**（`cordis-plugin-development/SKILL.md:8-10`
   禁手写 profile `package.json` / 禁在 profile 目录跑 pnpm）合读：本机该走的是 `install_bundle` 带 `link:<绝对目录>`，
   而不是当初手改 `package.json` 那条。

**本机实测（2026-10-13，live 证据）**

- `dsh --profile web --patch <插件绝对路径> --dump-config`：**rc 0**，输出含 6 处 `dsh-autogamer`，其中有
  `# == D:\DEV\autoGamer\plugins\dsh-autogamer\cordis.patch.yml` 与 `- id: dsh-autogamer`。⇒ **`--patch` overlay 与组合包选择是两条
  独立通道，旧名死链不阻塞 R6 自检**（这解释了为什么 R6 绿而 schema 红）。
- `--dump-config-schema` 同参数：**rc 1**，错误原文
  `dsh: error: Selected profile bundle "autogamer-device" could not be loaded; repair or remove its bundle selection.` 与
  `dsh: error: [/183] Cannot find package 'dsh-autogamer' imported from C:\Users\78557\.dsh\profiles\web\cordis.yml`。
- 死链现场：`~/.dsh/profiles/web/node_modules/autogamer-device -> /d/DEV/autoGamer/plugins/autogamer-device`；
  `web/package.json` 的 `dsh.profile.bundles` 仍含 `"autogamer-device"`，`dependencies` 仍是
  `link:D:/DEV/autoGamer/plugins/autogamer-device`，`pnpm-lock.yaml` 同一 specifier。
- **断链时点**：改名提交 `70cc7af` 把 `package.json` 从旧目录移走，检出该分支时旧目录只剩 `dist/ node_modules/ scripts/ spike/`
  （无 `package.json`）——link 在**切分支那刻**已解析失败，本会话删除残骸只是清了现场，不是致因。
- 自检没有改写宿主配置：`web/package.json` mtime 仍是 `2026-10-12 02:10`；只有生成的 `web/cordis.yml`（内容 `[]`，
  注释写明「Edit cordis.patch.yml, not this file」）在每次 `dsh` 调用时重写。

**未证（别当已证）**

- `G59` 记的是本机 `--dump-config-schema` **常驻**失败，那一定论在断链之前；本节只解释**当前这次** rc=1 的直接成因，
  能不能回收 G59 的「常驻」二字**未复现**——要在一个 link 完好、bundles 指现存包名的 profile 上重跑才可判。
- `remove_bundle` 对「带 `error` 的死链组合包」能否一路走完（`enabled → selectBundle(false) → pnpm remove`），只读过源码，
  **本机未执行**。→ 在办工作记 `G71`。
- 0.2.1-alpha.\* 相对 rc.2 在这个面上的变化：未读 CHANGELOG，未实测。

**本节出处**（补入 §七 之外的增量）

- [docs/cli-help.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.zh.md)（`dsh plugin` 段）
- [packages/boot/plugin-manager/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.zh.md)、
  [src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/src/index.ts)、
  [src/tools.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/src/tools.ts)
- 撤回一条来源：本轮曾对一个**非上游**的第三方代理 URL 取证，两次抓取返回互相矛盾的「官方口径」，已整条弃用；
  本节全部结论只来自公开仓库 `gh api` 与本机实测。

## 九、设备身份口径查证（R20，2026-10-13）

> 起因：**G75** —— 一台 MuMu 被 `list_devices()` 报成 4 台。守则要求「遇行为问题先查官方一手资料，不许先写猜测实现」，
> 所以先问：**两个上游里到底有没有「同一物理设备的多条传输要合并」这个口径**。查证结果决定 G75 的解法边界。

1. **DSH 侧没有 Android 设备身份概念**（源码口径，`deepseek-ai/deepseek-harness` @ `master`，全树路径检索）。
   `device|roster|fleet` 命中 24 处但语义全部无关：DSH 的 **roster 指 preset / 工具行清单**
   （`.agents/notes/archived/bug-fix/2026-08-09-broken-preset-roster-rows.md`、
   `apps/cli/tests/profiles/web/tests/runtime-roster*.ts`），`device` 命中是
   `apps/desktop/src/device-info.ts`（**桌面主机自身**信息）与 `device-local-shortcut-preferences`（本机快捷键）。
   ⇒ **在 DSH 里找设备去重口径是找错仓库**，这条归因先纠正再往下走。
2. **artemis 上游（canonical 设备契约）同样没有去重 / 身份口径**（源码口径，`google/artemis`）：
   `artemis/runtime/device_pool.py` 里 `dedup|unique|identity|android_id` **零命中**，只有
   `serial.startswith("emulator-") or "127.0.0.1" in serial or "localhost" in serial`（:309，判 `is_emulator`）
   和 `DeviceExecutionLock._normalize_device_id`——它把 serial 洗成 filesystem-safe（非字母数字→`_`），
   **不做跨传输合并**。上游 `tests/unit/runtime/test_device_pool.py` 的 12 条测试全是 snapshot / single-flight /
   warm-up 一族，**没有一条测同设备多传输**。
3. **本仓与上游逐字相同**：`diff artemis/runtime/device_pool.py <上游同路径>` = **0 行差异**（两边都 478 行）
   ⇒ G75 **不是 fork 丢了东西**，是上游 canonical 行为；要按物理身份合并，只能改上游契约或在我们这一侧显式绕开枚举。
4. **插件现状已有两层缓解，但都不解决身份问题**（源码口径 `plugins/dsh-autogamer/src/devicePool.ts`）：
   - 构造期 `this.devices = [...new Set(options.devices)]`，注释原话「A serial listed twice would be two pool
     entries for one device」（:93-94）——**只去字面重复**。
   - `refreshRoster()`：`if (this.devices.length > 0) return;`（:166，注释「操作者钉了 roster 就整跳 RPC」），
     发现出来的 roster 也**只按 serial 字面**建 Map（:175-179）。
     ⇒ 敞口条件被代码限定得很干净：**Config 钉住 `devices` 时不引入误计数；不钉时才会**。
5. **插件侧拿不到机器身份**（源码口径）：本树 15 工具动作面**没有**任意 adb 执行入口（无 `run_adb_command`），
   所以插件无法自行读 `settings get secure android_id`。本轮实测的同机证据（四条传输 `android_id` 全等
   `c0021066f3fbaf47`）是在本机 adb 上量的，**不是插件走得通的路**。要让 `list_devices` 带身份，得在 py 面新增字段。

**由此 G75 只剩三条诚实路线**（不许写猜测实现）：

| 路线 | 代价 | 是否碰 canonical 契约 |
|---|---|---|
| ① 交付默认钉显式 roster（`Config.devices`），自动枚举降级为「操作者明确接受按传输计数」时才开 | 改动最小 | **不碰** |
| ② py 的 `list_devices` 增发机器身份字段 | 需与上游对齐 | **碰**（D6/D18 的稳定面） |
| ③ 只在文档与 UI 明示「计数单位是 adb 传输，不是设备」 | 零代码 | 不碰 |

选 ②③ 之前不得自造指纹：`is_emulator` + model 在多实例场景不可区分（实测四条 model 全同）。
