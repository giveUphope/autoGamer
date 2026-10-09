# autogamer-device

AutoGamer device-execution content plugin for DSH (P0 skeleton, `docs/todo.md` R2').

The plugin provides **content only**: the `run_device_action` router tool
(device gate + circuit breaker + error classification inside), the
`report_task_status` end-of-task tool, and the `autogamer` agent preset.
Queueing, scheduling, UI, approvals, and session memory are DSH-native.

## Layout

```
src/gate.ts                 per-device FIFO gate (weak-map promise chain + tracked pending)
src/breaker.ts              device circuit breaker (closed/open/half-open, env-failure counting)
src/classify.ts             tool-layer error classification (environment vs task)
src/actionClient.ts         MCP stdio client wrapper around the upstream py action server
src/tools/runDeviceAction.ts  the single execution tool (S11 router skeleton)
src/tools/reportTaskStatus.ts run_outcome dual-axis report (completed/blocked + tests_failed)
skills/autogamer-flash/     flash execution policy (act/plan/report discipline)
```

## Install (link mode, P0 dev flow)

```bash
# in the DSH profile that should host the plugin
dsh plugin --profile web add file:/D/DEV/autoGamer/plugins/autogamer-device
dsh --profile web --dump-config   # verify the autogamer-device layer is applied
```

Config热重载：改 `cordis.patch.yml` 免重启；改本包代码后需重启 profile 进程。

## P0 spike checklist

- [x] **安装流（已通过，含三处实测修正）**：`dsh plugin add link:...` 成功 + 层进 `dsh.profile.bundles` + `--dump-config` 出现本包层（`# == autogamer-device`）、exit 0。实测修正：①package.json 必须声明 `dsh.bundle.patch`（缺→装成普通依赖不进层）；②bundle patch 是 **`- insert:` 列表**语法（id 定向写法会 unmatched）；③`dsh plugin add` 的 file:/link: 路径要给 **Windows 形态**（pnpm 是原生进程）；④remove→add 才会触发 manifest 重评估
- [x] **MCP 直连（离线段已通过）**：ActionClient ↔ `uv run artemis mcp --type adb` 全链路——13 工具面精确匹配、结果归一化（字符串 Success/Failed/Error、`Error executing tool` 变体）、adb-down 场景正确分类为 environment。真实设备质量对比待跑（需 adb+设备）
- [x] **参数面核对（已完成，以 py 源码为准）**：真实工具名 tap/long_press_on/focus_and_input_text（非 click/input_text）；**legacy 像素坐标契约**——0-1000→px 换算在 TS 侧（`src/coord.ts` + 探针截图取尺寸）；press_key 用 `KEYCODE_*` 全名
- [x] **安装流（已通过，含三处实测修正）**（上一条）
- [x] **headless 平台事实（S10 前置发现）**：headless 树**无 preset registry**，其 agent 组合= dsh-base 基础工具（24 个），root 级 insert 的插件工具**不进 headless agent 工具箱**（实测 4 轮：registry 插入后 preset 激活但 agent 工具面不变）；headless 亦不适合做 S10 测试面——S10 转 web profile（组合已验证：overlay 后 registry/preset/工具层全部就位）
- [ ] **S10 四点（web profile live）**：启动 `dsh --profile web --patch spike/headless-spike.patch.yml --no-open`（LLM 已指 127.0.0.1:1234/v1 + preset default=autogamer + mock action server），用一次性 token URL 认证后发设备任务，观察 run_device_action 首调稳定性/效果验证/Inbox 连发
：①本地廉价模型 + 白名单下首调 `run_device_action` 稳定性；②动作效果验证信号（当前以 ActionResult ok 为准，截图差分待接）；③pending kick；④Inbox 连发串行在 QueueDock 可见（需 live profile + 模型）
- [ ] **Config schema**：当前为 plain-merge 默认值；接入 schemastery 后补 `Config` 导出

## Notes

- DSH ships no type declarations; `src/dsh-types.ts` mirrors the verified
  contract surface (ctx.tools.register / defineTool / exec.signal) — re-check
  that file on every DSH upgrade.
- peerDependencies are pinned to 0.2.0-rc.2 per upstream convention
  (`.npmrc` disables peer auto-install for local dev; the runtime enforces
  the range itself).
- py side needs no changes for this skeleton: the action server is invoked
  as-is. Recording (D12) and helper replication (D13) arrive in P2.
