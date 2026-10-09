# 上游插件形态与工具形态调研（2026-10-10）

> 来源口径：`github.com/deepseek-ai/deepseek-harness` @ `master` 的公开文档与源码，符合 [todo.md](../todo.md) 的 D15（声明面 + 公开上游，不解包 app.asar）。每条标 **文档口径** / **源码口径**；本机尚未复验的写 **未实测**。
> 取用方式：`gh api repos/deepseek-ai/deepseek-harness/...`（仓库确认为 public、default branch `master`，描述「DeepSeek Harness: Everything is a Plugin」）。原文副本落在 `plugins/autogamer-device/spike/sandbox/`（gitignored，只作取证现场，不作引用依据）。

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
8. **我们的 inner 写法与官方 shipped 形态同构，不是格式问题**（源码口径）：`packages/bundle/web-app/presets/minimal.patch.yml` / `standard.patch.yml` 里工具插件就是裸子项 `- id: tool-fs` / `- id: tool-jobs` + `name: '@deepseek-ai/dsh-…'`，与我们的 `- id: autogamer-device-inner / name: autogamer-device / config: {actionServerCommand: […]}` 同形。带服务的官方样板则包在 `name: cordis:group` + `group: true` + `isolate: {terminals: true}` 里（minimal 的 `persistent-shell`）。外部 bundle 的插件确实可出现在 patch 中（composition-reference:29「Plugins outside this list come from installed bundles」）。
9. **版本差**：上游 releases 已有 `dsh-v0.2.1-alpha.2`（2026-10-09）与 `dsh-v0.2.1-alpha.1`（2026-10-03），本机 spike 跑的是 `0.2.0-rc.2`（2026-09-29）。alpha.1 的主题按公开报道是「让 Agent 给自己造插件」，即上面那两个 skill 的落地。

## 三、收回上一轮的两条结论

- **收回「外部插件名不能进 preset 子项」**：没有任何官方文档这样说；相反 composition-reference:29 承认 installed bundles 的插件。而 01:51 那次 `tools=16` **同时变了两个量**（plugins 集合 + 旧会话→新会话），按事实 4，光「换成新会话」这一项就足以解释「此前无 `tools` 键」。所以那次的正确读法是：**旧会话沿用其启动时的 preset revision**，与外部性无关。
- **收回「裸 `- name:`（无 id）子项产不出工具」**：与 `agent-preset/README.zh.md:48` 直接冲突——「**子插件可省略行 ID，由 Loader 分配**」。这条实测差异的真实原因还没定性（可能同样是 revision 混淆），不许再当作约束写进方案。

两条都是我自己写进 `todo.md` 并已提交的（`1f05039`），现在按本节修订。

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

- `docs/capability-seams.md`（63 KB）、`docs/cookbook/adding-a-tool.md`、`docs/tool-catalog.md`（102 KB）、`docs/tool-execution-pipeline.md`、`references/host-plugin.md`、`references/verification.md`、`references/practices.md`、`cordis-composition-reference/references/packages.md`：**已取回本地但未逐字读**。`practices.md` 被官方列为「选择扩展点之前必读」，下一轮优先。
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
