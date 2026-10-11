# autogamer-device

AutoGamer 的设备执行插件（DSH 内容插件）。**只提供内容**：`run_device_action` 执行工具、
`report_task_status` 终态汇报、`autogamer` agent 预设，以及设备资源治理。队列、调度、UI、
审批、会话记忆全部由宿主提供。

- 方案与进度：[`../../docs/TODO.md`](../../docs/TODO.md)（活文档）
- **动手前必读**：[`../../docs/migration/plugin-contract-rules.md`](../../docs/migration/plugin-contract-rules.md)（守则 R1-R19）
- 编号查表：[`registry.md`](../../docs/migration/registry.md)｜术语查表：[`glossary.md`](../../docs/migration/glossary.md)
- 当前状态（2026-10-10）：🔴 **P0 未完，卡在 G30**——工具 `register()` 成功但没进 agent 工具面

## Layout

```
src/index.ts                      插件入口：Config（原生 Schemastery）+ apply() 注册两个工具
src/tools/runDeviceAction.ts      执行工具：闸门 → MCP 转发 → 错误分类 → 路由日志
src/tools/reportTaskStatus.ts     终态汇报（completed / blocked + tests_failed 双轴）
src/gate.ts                       per-device FIFO 闸门（弱表 promise 链 + tracked pending）
src/breaker.ts                    设备熔断（closed / open / half-open）
src/classify.ts                   工具层错误分类（environment / task）
src/coord.ts                      0-1000 归一坐标换算 + 截图取尺寸（含 configuredScreenSize）
src/actionClient.ts               py action server 的 MCP stdio 客户端包装
src/mcpText.ts / src/hierarchy.ts 文本解包 / 层级索引定位
skills/autogamer-flash/           flash 执行策略 skill
scripts/mock-action-server.mjs    离线 mock action server（take_screenshot 回真 PNG 头）
scripts/spike-mcp.mjs             真 py 动作面取证 + fixture 生成（--write）
scripts/gen-sse-events.mjs        从 py 发射漏斗与前端订阅抽取旧 SSE 契约（--write）
scripts/conformance-live.mjs      live 取证：declared（dump-config）与 live（会话日志）两层
spike/                            live overlay 与取证现场（多数已 gitignore，含 token 的别提交）
tests/                            vitest：gate / breaker / classify / coord / apply /
                                  conformance（contracts=生成式 fixture，runtimeBoot=真实 DSH runtime 挂载）
```

## 引入与验证（按守则 R2 的三层）

```bash
# 开发期：代码改了必须重新构建，再冷重启宿主（配置层可热重载，代码层不行）
npm run build && npm run test

# 把本包挂进 web profile（pnpm 垫片：只证明「装了」，不证明「生效」）
"D:/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd" plugin --profile web \
  add file:/D/DEV/autoGamer/plugins/autogamer-device

# 每次改 patch 后的强制自检（R6）：exit 0 且 grep 不到 unmatched
dsh --profile web --patch <abs>/spike/web-live.patch.yml --dump-config
```

- **禁止**手写 profile 目录内的 `package.json` / `cordis.patch.yml`，也不要在那目录跑 pnpm
  （官方口径：`install_bundle performs those steps` / `do not reproduce those steps with shell commands`）。
- **交付形态**：走 `plugin_manager` 的 `install_bundle`，或 Web 侧边栏「插件」面板。已发布的资产是
  `https://github.com/giveUphope/autoGamer/releases/download/autogamer-device-v0.1.0/autogamer-device-0.1.0.tgz`
  （prerelease；`npm pack` 的产物，因此带 `dist/` 与 `skills/`——**git 依赖只含已提交文件，装 git 地址会缺 `dist/`**）。
  D17 已落地：本包 preset 里挂着 `tool-plugin-manager`（`disabled: false`），会话里的 agent 能自装。
- ⚠️ **本机 TLS 前置（实测）**：如果这台机器的 HTTPS 被本地拦截型工具接管（`openssl s_client` 会看到
  它的根 CA 签发者），那么宿主与 pnpm 取 Release 资产会报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`，
  而 `git`/`gh` 照常工作（它们信任 Windows 证书库）。解法是**启动宿主时带上 Node 官方开关**：
  `NODE_OPTIONS=--use-system-ca dsh --profile web …`（`scrubbedParentEnv` 会把它传给 pnpm 子进程）。
  **不要**用 `NODE_TLS_REJECT_UNAUTHORIZED=0`——那是关掉校验，不是修问题。
- 判「生效」只认官方检查器（R9）：`list_plugins` 的 `enabled` / `fiberPhase`、roster 诊断、
  `cordis_inspect_query`（`Tool` = 本 agent 能调用哪些工具、`Config.listConfigs`）、
  `inspectCompositions()`。
- **声明只影响之后创建的 agent**（R7）：验证一律开新会话，旧会话保留其启动时的 revision。

## 契约要点（踩过坑的）

- **fixture 是生成物，不是手抄本**（G5）。升级 DSH 后按这三条重取，别再照文档手写：
  ```bash
  ARTEMIS_MOCK_DRIVER=1 node scripts/spike-mcp.mjs --write      # py 动作面（期望面由 ACTION_TO_PY_TOOL 推出）
  node scripts/gen-sse-events.mjs --write                       # 旧控制台 SSE：从发射漏斗/订阅抽取
  AUTOGAMER_CONFORMANCE_PY=live npm test                        # 带真 action server 的比对分支
  ```
  版本 pin 读**实际装好的** `@deepseek-ai/dsh-*` 版本（必须彼此一致且等于 peer pin），有桌面版时再与
  `$DSH_HOME/dsh-runtimes/*/runtime.json` 的 `desktopVersion` 交叉校验；`turn/end` 这类事件名改由
  `@deepseek-ai/dsh-session` 的 `KNOWN_SESSION_EVENT_TYPES` 判定。⚠️ 公开包的 `latest` 标签是陈旧的
  `0.0.1-rc.1`，正确代际在 `next`——devDeps 要写死精确版本。
- `Config` 必须是 **原生 Schemastery** schema；用 zod 会被宿主拒（`Config is not a native
  Schemastery schema`），而**缺 Config 声明会让该行被判 `config=absent`，preset 子挂载被静默
  跳过**——这就是 missing-tools 的根因。已锁死：`tests/conformance/contracts.spec.ts`。
- 未配置的可选 tuple 会被 Schemastery 归一化成**真值 `[undefined, undefined]`**，所以
  `if (config.screenSize)` 恒真。判定数值本身走 `configuredScreenSize()`（`src/coord.ts`），
  接线由 `tests/apply.spec.ts` 钉住——它断言 action server 真收到的坐标。
- 定义里的 `timeoutMs` **不会被注册表执行**（R15）；超时由 `src/actionClient.ts` 的
  `Promise.race` 自实现，并观测 `exec.signal`。
- 裸 schema 注册合法（官方 MCP 路径也这样），代价是**输入校验归我们**：非空、正数、跨字段、
  显式对象节点的 `additionalProperties`（差集登记为 G34）。
- `src/dsh-types.ts` 是宿主契约的镜像（DSH 不随包发 `.d.ts`）。**每次升级 DSH 都要复核这个文件。**

## 已知债务（编号见 registry）

| 编号 | 一句话 |
|---|---|
| G30 | 工具不进 agent 工具面（P0 阻塞点）；头号候选是 `inject` 的服务在该 realm 不可解析 |
| G31 | 引入流仍靠手工；交付要迁 `install_bundle` |
| G32 | 缺 `locale/en.json` / `locale/zh.json` 的 `meta.title`/`meta.description` 与 icon（R19） |
| G33 | 闸门/熔断/审批策略内建在工具正文里，与官方「不要内建策略」相反（R13） |
| G34 | 裸 schema 的输入自校验缺口 |

py 侧对本包**零改动**：action server 原样调用。录屏（D12）与 helper 复刻（D13）在 P2。
