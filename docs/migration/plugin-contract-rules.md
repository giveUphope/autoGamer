# DSH 插件契约守则（编号红线）

> 用途：`autogamer-device` 后续每一笔改动动手**之前**先对照本表；每条都给「判据」，要求能由命令或产物机器作答，不接受"看着没问题"。
> 依据：上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) @ master 的官方 skill / 包 README / 源码，加上本机 0.2.0-rc.2 实测。逐条标 **文档口径**（官方文字）、**源码口径**（上游源码）、**实测口径**（本机产物）。
> 本守则是 [todo.md](../todo.md) 的 D7 / D15 / D16 / S5 / S8 / G30 的执行细则；两者冲突时以本守则的编号条款为准并回改 todo。

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

## R12 bundle 的展示元信息是义务，不是装饰

外部 bundle 应提供 `locale/en.json` 的 `meta.title` / `meta.description`、图标，以及 `dsh.bundle.patch` 声明。

- **出处**：**文档口径** `docs/cookbook/adding-a-package.zh.md` 第 5 节 + `host-plugin.md`（**已取回未逐字读**）。
- **判据**：`--dump-config` 与安装结果里出现元信息诊断即为不合格；细则待读 `references/host-plugin.md` 后补编号条款，不得凭印象先写。

---

## 待补（诚实清单）

1. `references/host-plugin.md`、`references/practices.md`（官方列为「选扩展点前必读」）、`references/ui-plugin.md`、`references/user-actions.md`、`docs/capability-seams.md`、`docs/cookbook/adding-a-tool.md`、`docs/tool-catalog.md`：**已取回未逐字读**。R12 与「扩展点怎么选」两节要等读完再定，不许先写结论。
2. `install_bundle` 在 CLI 侧是否真的只有 pnpm 一条路：本机 `dsh --help` 只有 `dsh` 与 `dsh plugin` 两种用法（**实测口径**），但上游 `dsh-plugin-manager` 自称「shared by dsh CLI, Web and agent tools」——两者尚未对齐，需要读 `packages/*/dsh-plugin-manager` 的 README 或试 Web 面板路径来定论。
