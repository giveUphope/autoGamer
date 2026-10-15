# dsh-autogamer

AutoGamer 的设备执行插件（DSH 内容插件）。**只提供内容**：`run_device_action` 执行工具、
`report_task_status` 终态汇报、五个 `autogamer_*` 任务工具（启动/管理/轨迹/设备状态/诊断）、
`autogamer` agent 预设，以及设备资源治理。队列、调度、UI、审批、会话记忆全部由宿主提供。

**零配置**：设备面全走本机 `adb`；`{text}` 目标在层级答不出时改由**随包离线 OCR**（`tesseract.js` WASM +
包内中英文语言包）补一次——不需要 API key、不联网、不额外安装。

- 总方案与进度：[`../../docs/TODO.md`](../../docs/TODO.md)（活文档，本分支编号权威）
- 终态规格：[`../../docs/migration/ts-fullstack-spec.md`](../../docs/migration/ts-fullstack-spec.md)
- 动手前必读：[`../../docs/migration/plugin-contract-rules.md`](../../docs/migration/plugin-contract-rules.md)（守则逐条）

## Layout

```
src/index.ts                      插件入口：Config（原生 Schemastery）+ apply() 注册工具
src/tools/runDeviceAction.ts      执行工具：闸门 → 动作执行 → 错误分类 → 路由日志
src/tools/reportTaskStatus.ts     终态汇报（completed / blocked + tests_failed 双轴）
src/tools/getDeviceState.ts       只读设备状态（预检门禁 + 本机 adb 探针；不经外部提供方）
src/tools/runTask.ts              启动任务（500ms 内返回 task_id）
src/tools/manageTask.ts           任务状态/停止/注入
src/tools/inspectTrace.ts         轨迹查看（summary 取边加失败步）
src/tools/diagnose.ts             本机诊断（设备探针 + 本地预检 + OCR / 元素源占用者 / 可选提供方就绪）
src/tools/envGate.ts              任务工具共用的预检门禁
src/artemis/adapter.ts            可选外部提供方的后端工厂（仅 MCP；未配置即不构造）
src/artemis/mcpBackend.ts         外部提供方的 MCP stdio 后端（懒连接，传输失败=environment）
src/artemis/types.ts              外部提供方后端接口
src/effect/png.ts                 最小 PNG 解码（depth 8 / colorType 2·6 / 非隔行）
src/effect/diff.ts                效果差分：遮罩 / 双管线 / ROI 回落（T3/G84）
src/env/preflight.ts              环境预检：只问两件真事（adb 在 PATH + 有设备），60 秒缓存
src/device/adb.ts                 唯一的 adb 出口（自实现超时 + 取消信号 + 二进制安全）
src/device/roster.ts              设备清单：adb devices 解析 + android_id 去重（G75/G65）
src/device/state.ts               设备态本地探针（连接 / 前台 / 屏幕 / 帧 / helper）
src/device/hierarchy.ts           uiautomator dump 读回 + XML 扁平化（T2-b）；`ps -A -o PID,ARGS` 认 UiAutomation 槽位占用者（能力重审-2，三态：occupied / free / **unknown**，读不出绝不答 free）
src/device/act.ts                 动作执行：input / am / monkey 的原生路线与字符串契约（T2-c/d/e）
src/device/diagnose.ts            本机诊断：连接 / 锁态 / helper 版本 / crash 日志（T2-f）
src/ocr/recognize.ts              内置离线 OCR：随包语言数据、单例 worker、命中框收紧、失败即当作没有（T5）
src/ocr/image.ts                  区域 OCR 图像工具：RGB 裁剪 / 最近邻放大 / PNG 编码（零依赖，G92）
src/ocr/regions.ts                区域 OCR 管线：层级叶级候选 → 裁剪放大逐块识别 → 映射回全屏（G92 探针 A）
src/gate.ts                       per-device FIFO 闸门（弱表 promise 链 + tracked pending）
src/devicePool.ts                 闸门之上的调度：parking / 全局并发 / roster 与准入
src/breaker.ts                    设备熔断（closed / open / half-open）
src/turnLedger.ts                 回合账本：动过手却没汇报终态的回合
src/task/fold.ts                  任务状态折叠：任务记录与步迹由会话日志派生（T1/G82）
src/task/cache.ts                 任务读模型缓存：由投影变更流喂入，工具按会话读取
src/task/projection.ts            session 投影单元定义与可选注册（ctx.inject）
src/task/readModel.ts             步迹整形：尾部门限（manage）与取边+失败（inspect）
src/classify.ts                   工具层错误分类（environment / task）
src/coord.ts                      0-1000 归一坐标换算 + 截图取尺寸（含 configuredScreenSize）
src/hierarchy.ts                  层级解析：#N 按节点身份在可达界内跟随到当前位置
src/observations.ts               活观察快照：每 (agent, device) 只存模型最后所见的列表
src/dsh-types.ts                  宿主契约镜像（升级 DSH 必复核）
```

- 测试在 `tests/`（vitest，数十个语义锁 spec；条数是派生事实，权威在 [`../../docs/TODO.md`](../../docs/TODO.md) §零；
  conformance 下为生成式契约与真实 runtime 挂载）
- 脚本在 `scripts/`（`.mjs`）：`clean-dist.mjs`（`build` 前清空 `dist`）、`conformance-live.mjs`（读宿主会话日志的取证工具）、
  `synth-hard-frame.mjs`（生成 G92 的合成难帧夹具；`--scan` 另打印 padding × scale 参数表）
- 执行策略 skill：`skills/autogamer-flash/SKILL.md`

> `src/ocr/image.ts` 与 `src/ocr/regions.ts` **未接线**（只有探针与锁，没有生产消费者）。这不是「还没来得及」：
> P1 的候选框全部来自层级 bounds，而「层级没有框」正是 OCR 存在的唯一理由，所以 P1 在需要它的那些帧上
> **结构性地帮不上**（`regions.ts` 自己的日志就是这么写的）。区域识别是 G92 的第二级阶梯，
> **到期条件 = 真机探针 B 的 needle 命中率 ≥ 整帧基线**；到那天才接线并定常量，没到就保持未接线。
> 别按「没人调用」删掉，也别当成已经在跑的 OCR 路径。

## 命令

```bash
# 在本目录内；改 TS 后必须重新 build 再冷重启宿主（配置可热重载，代码不行）
pnpm --config.verify-deps-before-run=false run build
pnpm --config.verify-deps-before-run=false run test

# 类型门禁：tests/ 也纳入 tsc（tsconfig.spec.json，G81）
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false run verify   # src tsc → spec tsc → vitest

# 每次改 patch 后强制自检（R6）：exit 0 且 grep 不到 unmatched
dsh --profile web --patch <abs>/cordis.patch.yml --dump-config
```

> 本机跑 pnpm 必须带 `--config.verify-deps-before-run=false`，否则会隐式 install 并改写
> `pnpm-lock.yaml`（环境产物，不提交）。dsh 取 PATH，不写死安装盘符。
>
> `verify` **不含** `clean-dist`（那一步只在 `build` 里，CHANGELOGS #101）⇒ **`pnpm pack` / 交付前必须先跑 `build`**；
> 只改测试或只做回归时 `verify` 一条就够。

## 引入与验证

- **三层纪律（R2）**：禁手写 profile 目录内文件、禁在 profile 目录跑包管理；`--patch` 是开发期
  overlay；交付走 `plugin_manager` 的 `install_bundle` 或 Web 侧边栏「插件」面板。
- 判「生效」只认官方检查器（R9）：`list_plugins` 的 `enabled` / `fiberPhase`、roster 诊断、
  `cordis_inspect_query`（`Tool` / `Config.listConfigs`）、`inspectCompositions()`；
  `dsh plugin` 只是包管理垫片，只证明装了、不证明生效。
- 声明只影响之后创建的 Agent（R7）：复验一律开新会话。

**交付形态（实测结论，写给下一次安装的人）**

1. 对外交付 = 发布 `pnpm pack` 出的 `.tgz`，在面板「添加插件」里**直接输入 tarball 路径**。
   解压成目录再输入是 `link` 安装、**不装依赖**，精简目录必然 `failed to import`（已实测失败）。
2. 每个新 profile 首次安装**必遇** `tesseract.js` 构建脚本授权弹窗（**R19：由用户点**）。
   该 `postinstall` 只打印一条赞助横幅、无产物（CHANGELOGS #98），而语言数据随包 vendored。
   bundle 无法自带跳过：`files` 带不了 `pnpm-workspace.yaml`，而 R2 禁止手写 profile 配置。
3. **替换安装后必须重启宿主**（含从开发期 `link:` 换过来），否则启用记录仍指向旧 target。
   重启后在面板核验组件运行中与双语 locale 标题/描述/icon —— 判「生效」只认官方检查器（R9）。
   > 版本限定：这条是 **0.2.0-rc.2 上的实测**。上游 `dsh-v0.2.1-alpha.3`（2026-10-14）的 release notes 称
   > 「修复插件更新或重新安装后仍运行旧代码的问题，启用热重载时可直接生效、不能热重载才提示重启」⇒
   > 升级到该版本后**先按提示判断**，别无条件重启（出处见守则 R11）。

## 契约要点（踩过坑的）

- `Config` 必须是**原生 Schemastery** schema：用 zod 会被拒（`Config is not a native Schemastery
  schema`），缺 Config 声明会让该行被判 `config=absent`、子挂载被静默跳过。由
  `tests/conformance/contracts.spec.ts` 锁。
- 未配置的可选 tuple 会被 Schemastery 归一化成真值 `[undefined, undefined]`，故「是否配置过」
  必须判数值本身，走 `configuredScreenSize()`（`src/coord.ts`）。
- 定义里的 `timeoutMs` **不被注册表执行**（R15）：超时自己实现并观测取消信号 —— adb 侧在
  `src/device/adb.ts`，OCR 侧在 `src/ocr/recognize.ts`，外部提供方后端在 `src/artemis/mcpBackend.ts`。
- 裸 schema 注册合法（官方 MCP 路径也这样），代价是输入校验归我们：非空、正数、跨字段、
  显式对象节点的 `additionalProperties`。
- `src/dsh-types.ts` 是宿主契约的手写镜像（DSH 不随包发 `.d.ts`）：每处镜像须标出处与版本，
  区分「单测证明」与「live 证明」（R21），每次升级 DSH 必复核。
