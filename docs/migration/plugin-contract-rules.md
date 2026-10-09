# DSH 插件契约守则（编号红线）

> 用途：`autogamer-device` 后续每一笔改动动手**之前**先对照本表；每条都给「判据」，要求能由命令或产物机器作答，不接受"看着没问题"。
> 依据：上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) @ master 的官方 skill / 包 README / 源码，加上本机 0.2.0-rc.2 实测。逐条标 **文档口径**（官方文字）、**源码口径**（上游源码）、**实测口径**（本机产物）。
> 覆盖范围：R1-R19 已改写 `todo.md` 的 D7 / D15 / D16 / D17 与 S3 / S4 / S5 / S6 / S8 / S9 / S11 / P3，并派生差距条目 G30 / G31 / G32 / G33 / G34。两者冲突时以本守则的编号条款为准并回改 todo，不在两处各留一份说法。

---

## R1 取证只走声明面

不解包 `app.asar`。可用面：`dsh --help`、`dsh --profile <p> --help`、`--dump-config`、`--dump-config-schema`、`--dump-default-config`、随包 README、已安装 npm 包产物、`~/.dsh` 下的真实运行数据、上游公开仓库源码。

- **出处**：用户裁定（D15）。官方同样写明 asar 内文件「只有 Host 进程自己的文件读取能打开」，`ls`/`cat`/`node`/pnpm/glob/ripgrep 一律失败（**文档口径**）。
- **判据**：任何新写进文档的结论，其出处必须能在上面这些面里复现；写不出复现命令的结论降级为"猜测"。

## R2 分三层看「改配置」这件事，不许混用

| 层 | 定位 | 允许吗 |
|---|---|---|
| profile 目录内的 `package.json` / `cordis.patch.yml`，或在 profile 目录跑 pnpm | 常驻用户层 | **禁止**：`install_bundle` 才是执行者（**文档口径** `cordis-plugin-development/SKILL.md:10`） |
| `--patch <path>`（可重复，应用在 profile 层之后） | 官方声明的 overlay 机制 | **允许，作为开发期主路径**（**文档口径** `dsh --help` 的 Options 段） |
| `plugin_manager` 工具 / Web 侧边栏「插件」面板 | 正规引入与启停 | **允许，交付形态走这条**（**文档口径** `dsh-plugin-manager` = 「shared by dsh CLI, Web and agent tools」；`dsh-client-ui-plugin-manager` = 「the sidebar Plugins panel **installs, enables, disables, retries, and composes**」） |

- **判据**：实验用 patch 文件一律放 `plugins/autogamer-device/spike/`，路径里不得出现 `~/.dsh/profiles/**` 的写入。
- **纠正记录**：上一轮我把 `--patch` 也归入"官方禁止的一侧"，过度收敛——被禁的是手写 profile 常驻文件，`--patch` 是 `dsh --help` 里明列的选项。同时我把侧边栏面板误判成只读展示页，实际它具备安装/启停能力。

## R3 preset 只能由 bundle 补丁承载

「Nothing edits a declaration in place」；注册表不扫描目录，也不接受 preset 路径。

- **出处**：**文档口径** `editing-cordis-compositions/SKILL.md`、`agent-preset-registry/README.zh.md:46-48`。
- **判据**：`--dump-config` 输出里必须存在 `- id: preset-<id>` 行且其 `config.plugins` 非空；缺行 = 声明根本没进树。

## R4 preset 声明行的字段约束

`config.id` **必填**，只允许小写字母、数字、连字符；`config.plugins` **必填**；`name` / `description` / `order` 可选；Loader 行 id 约定为 `preset-<config.id>`。**子插件行可以省略 id，由 Loader 分配。**

- **出处**：**文档口径** `editing-cordis-compositions` Where declarations live 段 + `agent-preset/README.zh.md:48`。
- **判据**：`--dump-config-schema` 里 `$defs` 对应节点的 `required` 数组；本机 rc.2 实测 `config97.required == [id, plugins]`。
- **禁止**：把「子项必须自带 id」当约束使用——它没有官方依据，本机那条实测差异另有原因（见 R7）。

## R5 覆盖是整体替换，不是深合并

按 id 覆盖既有行时，给出的字段替换该行的字段，`config` **整体替换**，所以要把该行需要的字段**全部重述**；给了 truthy `name` 是**断言**既有插件名，不是改名。

- **出处**：**文档口径** `cordis-composition-reference/SKILL.md:15`。
- **判据**：覆盖行提交前后各跑一次 `--dump-config`，逐字段 diff 被覆盖行的 `config`，确认没有字段因"没重述"而消失。

## R6 patch 里每一条非 insert 行都必须命中

非 insert 且 id 空，或目标匹配不到行的补丁，会被**警告并跳过**。

- **判据（每次改 patch 必跑）**：
  1. `dsh --profile web --patch <file> --dump-config` 退出码为 0；
  2. stderr/stdout 里 grep `unmatched` 必须为空；
  3. 我们关心的行能在输出里按 id 找到（脚本判，不靠肉眼）。

## R7 改动只影响之后创建的 Agent

「声明会提前加载，修改只影响之后创建的 Agent」；「existing sessions and their children keep the plugin revision they started with；validate changed behavior in **a new session**」。

- **出处**：**文档口径**，两处一致（`agent-preset/README.zh.md:12` + `editing-cordis-compositions` Verify 段）。
- **判据**：复验前确认会话创建时刻**晚于**本次生效时刻（比对会话目录 mtime 与 patch/ dist 时间戳），否则这次复验不作数。
- **血债**：本条是我 01:51 那次"单变量实验"的第二个变量，直接导致我写下过一条错误约束并撤回（[upstream-plugin-forms](upstream-plugin-forms.md) 三）。

## R8 preset 里带服务的插件必须同 realm，否则整个 preset 不挂

preset 的服务提供方与其**全部**消费方要共处一个 `cordis:group` + `isolate` realm；条目局部隔离不沿 Agent 注册 scope 传播，组外的普通 Context 查找（含 `agent.ctx`）仍落到 Host realm。挂载时 `auditRows()` 汇总「从未启动 / 导入失败 / 激活失败」的行，`leakedServices()` 汇总发布进 root realm 的服务，任一非空即 `throw` ——**拒绝整个 preset**。

- **出处**：**源码口径** `agent-preset-registry/src/mount.ts:116,134,193,205,212-213`；**文档口径** `agent-preset-registry/README.zh.md:56-60`、`core/scope/README.zh.md:27,98`。
- **后果形态**：不是"少一个工具"，而是**Agent 完全没有工具面**（请求里连 `tools` 键都不存在）。这条形态特征用来区分「realm/挂载被拒」与「单个插件没装好」。
- **判据**：`inspectCompositions()` 的 `leakedServices`；非空就按官方样板（shipped `minimal.patch.yml` 的 `persistent-shell: name: cordis:group` + `isolate`）把 provider 与消费方包进同一组。

## R9 判「生效」只认官方检查器

`install_bundle` 结果里的 `application` 与 `warnings`；`list_plugins` 的 `enabled` 与 `fiberPhase`；roster 上激活失败行的**诊断文本**；`cordis_inspect_query` 的 `Config.listConfigs`（挂载插件的 Config schema）与 `Tool`（**本 Agent 可调用哪些工具**）；`inspectCompositions()`。

- **明确不认**：进程日志、进程列表、页面 boot payload、`dsh plugin list`（它只是 pnpm 的转发，只证明装了没证明生效）、以及从 LLM wire 反推。
- **出处**：**文档口径** `cordis-plugin-development/SKILL.md:25`（原文点名「not logs, process lists, or the page's boot payload」「Confirm new rows with `cordis_inspect_query`, not `list_plugins`」）、`cordis-composition-reference/SKILL.md:25`。
- **判据**：每个 live 结论都要留一条「哪条命令 / 哪个检查器、返回了什么」的记录；只有 wire/截图支撑的结论必须标注为间接证据。

## R10 插件必须声明原生 Schemastery 的 Config

没有 Config 声明的插件行会被判 `config=absent`，preset 子挂载随之被静默跳过；外来 schema 对象（如 zod）被拒：`Config is not a native Schemastery schema`。

- **出处**：**实测口径**（本机 spike + `--dump-config` 产物）。
- **判据**：`plugins/autogamer-device/tests/conformance/contracts.spec.ts` 的原生性断言 + `tests/apply.spec.ts` 的接线断言（两者都做过删除实验，回退 zod / 退回旧判据会变红）。
- **附带坑（实测口径）**：Schemastery 把未配置的可选 tuple 归一化成**真值 `[undefined, undefined]`**，所以"是否配置过"必须判数值本身，不能判数组真假——已由 `configuredScreenSize()` 承接并锁死。

## R11 版本门禁

本机 spike 全程 `0.2.0-rc.2`；上游已发 `dsh-v0.2.1-alpha.1`（2026-10-03）与 `dsh-v0.2.1-alpha.2`（2026-10-09），alpha.1 主题即「让 Agent 给自己造插件」。

- **判据**：`gh api repos/deepseek-ai/deepseek-harness/releases` 与本机版本号比对；版本不一致时 conformance fixture 一律视为**过期**，升级要重录。

## R12 Host 插件的导出形态二选一，不许混用

`index.js` 只能是这两种之一：① `export function apply(ctx, config) {}` + 可选 `export const inject` 与 `export const Config`；② 一个 service class 作为 default export。**声明了 `Config` 的插件会在 activation 时校验该行的 `config`**，所以写 config 之前要先用 `Config.listConfigs` 查已安装插件的 schema，并**跟着返回文档里的 `$defs` 引用读**（顶层节点常是 `type: null` + `anyOf`，只看顶层会得出"没有字段"的错误结论）。所有资源注册都必须在 `apply` 内用 `ctx.effect` / `ctx.on` 完成并返回清理。

- **出处**：**文档口径** `references/host-plugin.md:59-64`；`$defs` 那条坑是**实测口径**（本机 `--dump-config-schema` 的 `config97` 就是这样）。
- **判据**：`grep -c "^export function apply" dist/index.js` 与 `grep -c "export default" dist/index.js` 之和必须为 1。
- 展示元信息与图标义务（原列在 R12 的待补条目）统一收在 **R19**，本条不重复。

---

## R13 扩展点按「够用即最弱」选，不许把策略内建进工具正文

官方机制强度（弱→强）：`ctx.tools.restrict(filter)` 只能缩小单个 agent 的可见集合（掩码取交集，dispose 时解除）；`ctx.tools.guard(guard)` 是**单调同步拒绝**，加在 `tools/pre-execute` waterfall 之后，后续监听器无法把拒绝变回允许；`tools/pre-execute` 决定允许／拒绝／**询问**；`tools/execute` 给分发加截止时间、重试、指标；`tools/post-execute` 可替换内容或值、阻止结果、附加有序上下文；`tools/result` 只观测冻结后的最终结果。原文规则：**「尽量不要把部署策略内建到工具中」**。

- **出处**：**文档口径** `docs/cookbook/adding-a-tool.zh.md:61`、`packages/core/tools/README.zh.md:85,89,141`。
- **落到本项目**：S4 熔断的「冷却期拒绝」= `ctx.tools.guard()`（同步且单调，正合适）；需要 await 的决策（问用户）只能走 `tools/pre-execute` 返回 `ask`；S3 闸门的串行化属于执行机制，可留在工具内，但**全局并发语义要先与宿主对齐**（见 R14），不许重复实现一套。
- **判据**：写任何"拒绝/审批/限流"逻辑前，先答一句「这该是 guard、pre-execute，还是工具内部」；选工具内部必须写出为什么前两者不够用。

## R14 宿主已有并发约定，工具要声明安全属性

PTC 运行规则写明：**独立只读调用可以并发，变更类调用独占执行并按提交顺序**（「safe calls run concurrently; mutating calls run alone, in submission order」）。`defineTool` 的声明项里含「协作式超时」与「并行安全属性」两个字段。

- **出处**：**文档口径** `packages/core/tools/README.zh.md:12,197`。
- **判据**：`cordis_inspect_query` 查 `Tool` / `Config.listConfigs` 拿到该属性的**真实字段名与取值**再写代码，不许按英文字面猜字段（本守则不给字段名，因为文档正文未列出）。
- **落到本项目**：设备动作天然是变更类，宿主的"独占 + 提交序"已经覆盖我们排队需求的一半；per-device 闸门只该补"同一设备跨会话串行"这另一半，并把只读动作（`take_screenshot` / `get_ui_hierarchy`）标成可并发。

## R15 `timeoutMs` 是装饰，超时要么用包装层要么自己实现

**注册表绝不强制执行定义里的 `timeoutMs`**；要强制必须挂 `@deepseek-ai/dsh-tool-call-timeout-policy` 包装层。取消是协作式且等完全停稳：工具主体必须观测 `exec.signal`；主体前取消记 `ABORTED_BEFORE_DISPATCH`，主体后取消只能把成功替换为 `ABORTED`；超时报 `TOOL_TIMEOUT`；未知工具与抛异常工具都收敛成 `UNKNOWN_TOOL` 结构化错误，**调用失败但不结束轮次**。

- **出处**：**文档口径** `packages/core/tools/README.zh.md:126,235`。
- **判据**：任何"超时已生效"的说法必须指出是谁执行的——包装层，还是我们 `ActionClient` 里的 `Promise.race`（现状是后者，`timeoutMs: 45_000` 只是给模型看的声明）。

## R16 不许自写会话事件类型；可回放状态走 `presentationMeta` 或投影

带新 `type` 的 append 会让 Session 拒开（只有 envelope 带 `ignorable: true` 才被接受，而 live `Session.append()` 设不了它）；`appendPluginRecord()` 写 ignorable 记录但** reserved for DSH 实验包**（格式迁移只尽力保留）。可回放的结果事实走 `output.presentationMeta(args, value)`，它被持久化在 `tool/result` 的 `meta` 上并传给 `presentResult`。每会话状态用 `ctx.sessionProjections` 单元（`apply` 纯同步、`view()` 值不变就返回同一引用），**不要**订阅 `session/event` 再自己重扫；**不要 poll `agent/status`**；等 durable 事件 `turn/end` / `assistant/message` / `tool/result`。

- **出处**：**文档口径** `references/practices.md:21,26-28`、`docs/cookbook/adding-a-tool.zh.md:48`。
- **落到本项目**：S11 的 checker「判定 append-only 落 session log」这条不变量**不能靠自写事件实现**，改走 `presentationMeta` 或 storage service；`whenIdle()` 不代表一个 followup 结束（多个输入可共享同一次运行区间），S3/S9 的等待判据要按此重写。

## R17 注入上下文有两种，唤醒语义不同

`exec.agent` 上 `agent.inject({content, source:{kind}})` **追加持久上下文但不唤醒**（空闲 agent 保持空闲），下一次准入的 step 才看到；定时器要驱动工作就调 `agent.followup()`（会唤醒）。`source.kind` 必须在插件里经 `MessageSourceMap` 声明——session format V4 在消息准入处**拒绝**已退役的 `{kind:'plugin', plugin:'<name>'}` 包装。对已 dispose 的 agent 要 try/catch。`agent/request` 监听者改不了请求消息；加提示词用 `ctx.systemPrompt.section()`，**不要**听 `system-prompt/assemble` 来增删工具或文本。

- **出处**：**文档口径** `docs/cookbook/adding-a-tool.zh.md:49`、`references/practices.md:17-18,28-29`。
- **判据**：S9（中途指导）与 S4（冷却解除）里任何"唤醒"必须写明用的是 `followup` 还是 `inject`，两者后果不同。

## R18 UI 有两条硬路：slot 与拷贝，不许 iframe、不许 import 宿主 Client 包

页面/面板用 React 组件注册进 slot（`ctx.slots.inject(ownerKey, () => ctx.slots.register(...))`，owning 声明塌缩时自动卸载）；**不要**从 Host 发 HTML 塞 iframe（拿不到主题 token、明暗切换与 `ctx.locale`）。**禁止** `require('@deepseek-ai/dsh-client-ui-primitives')` 或任何宿主 Client 包——要长得像就**拷贝**其 markup/CSS/行为并加自己的类名前缀，只保留 `--dsw-alias-*` token 引用；抛错的组件会 blank 掉你的 slot 条目（console: `slot entry crashed`）。Chat 行经 `ctx.uiConversation.events.register()` + `conversation.chat.node` slot（`kind` 即渲染键）。Factory 保持无副作用；样式、定时器、监听器在 `apply` 里经 `ctx.effect`/`ctx.on` 注册并返回清理。**Web Client 不消费 `presentCall`/`presentResult`**：专用卡片必须在 client 插件的 `tool.call.toolview` keyed slot 里按 wire 工具名注册，只定义 Host 展示方法不会增加 Web 卡片；也不许另建一套 Client presenter registry。

- **出处**：**文档口径** `references/practices.md:31-38`、`references/ui-plugin.md`、`docs/cookbook/adding-a-tool.zh.md:69-99`。
- **落到本项目**：P3 的 toolview（录屏/截图展示）只能走 client 插件这条路，G2 早先结论成立且更细；展示器必须是纯函数（实时与回放都会跑），不得做 I/O、读会话状态或用时钟随机数，UI 格式不许混进模型可见规范值。

## R19 命名唯一 + 展示元信息是义务；授权类动作永远 user-only

包与行都要**唯一命名**；官方模板的包名带 scope（`@local/<name>`）。Host-only 或 configuration-only bundle **也有**可见 inventory 条目，「不是豁免」：`locale/en.json` 的 `meta.title` / `meta.description`（并按用户语言补 `locale/zh.json`，别留模板文案）、`exports` 出 `./locale/*.json` 与 `./icon`、`files` 覆盖 patch/locale/icon/每个运行时文件、图标为 SVG/PNG/JPEG/WebP 且 ≤256 KiB 不得越出包目录（绝对路径、URL、越界符号链接一律拒绝）。缺字段回退到 `package.json` 的 name/description，缺图用面板默认插画，元信息畸形会产生诊断。安装后要在面板逐 locale 核验标题/描述/图标；**无浏览器控制时只能核验到已安装资源，必须报告"渲染未验证"，不许从安装成功推断视觉成功**。
另一条授权红线：**授予或确认权限的动作（批准工具调用、回答 agent 的提问、放宽策略）保持 user-only，agent 不得执行也不得授权**；同一操作只实现一次（Host service 方法），UI 与 agent 工具共用它，不许两边各写一份逻辑。

- **出处**：**文档口径** `references/host-plugin.md:3,29-55`、`references/user-actions.md:11`。
- **判据**：`package.json` 里 `exports`/`files` 是否含 locale 与 icon；面板出现默认插画或包名回退即不合格。本项目当前**两项都缺**，已登记为 G32。

---

## 待补（诚实清单）

1. **已逐字读**：三个官方 skill（`cordis-plugin-development` / `editing-cordis-compositions` / `cordis-composition-reference`）及其 `references/host-plugin.md`、`references/practices.md`、`references/ui-plugin.md`、`references/user-actions.md`、`references/verification.md`、`references/mcp-bundle.md`，加上 `agent-preset` 与 `agent-preset-registry` 的 README 与 `src/mount.ts`、`packages/core/scope` README、`docs/cordis-primer.zh.md`、`docs/cli-help.zh.md`、`docs/cookbook/adding-a-tool.zh.md` 与 `adding-a-package.zh.md`、`packages/core/tools/README.zh.md`、shipped `presets/minimal.patch.yml`。**R12-R19 全部来自这些一手文本。**
2. **仍未读，不许凭印象引用**：`docs/capability-seams.md`（63 KB，已取回）、`docs/tool-catalog.md`（102 KB，已取回，官方口径就该按关键词 grep 而非整读）、`docs/dsh-tool-call-timeout-policy`（R15 提到的包装层，其包 README 未读）、`packages/jobs/jobs/README.zh.md`（S2 长任务与 owner 语义）、`docs/subsystems/scope.zh.md`。
3. **一条已定论的悬案**：`install_bundle` 在 CLI 侧没有等价物——本机 `dsh --help` 只列 `dsh`（boot）与 `dsh plugin`（= pnpm 转发，`--help` 打出来是 pnpm 11.7.0 的帮助），上游 `docs/cli-help.zh.md:29,71` 同述。所以 R2 表里第三层的两条可执行路径是**Web 侧边栏「插件」面板**与**在会话里让 agent 调 `plugin_manager`**（D17）；「shared by dsh CLI」那句里的 CLI 部分指的应是 `dsh plugin` 这层 pnpm 垫片，不是 install_bundle。G31 据此收口。
4. **待查的真实字段名**：R14 的「并行安全属性」与 R15 的超时包装层入参，官方文本只给了名称描述没给字段名 —— 必须用 `cordis_inspect_query` 在装好的 Harness 上取真名（R1/R9 的口径），取到之前不许写代码。
