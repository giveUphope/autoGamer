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

- [ ] **安装流**：`dsh plugin add` 成功 + `--dump-config` 出现本包层 + preset child-entry 形状验证（`cordis.patch.yml` 的 preset 声明是按 README 推写的，需对照真实加载结果）
- [ ] **S10 四点**：①本地廉价模型 + 白名单下首调 `run_device_action` 稳定性；②动作效果验证信号（当前以 ActionResult ok 为准，截图差分待接）；③pending kick；④Inbox 连发串行在 QueueDock 可见
- [ ] **MCP 直连质量**：`actionServerCommand` 指向 py action server（`ARTEMIS_MOCK_DRIVER=1` 可离线先跑）→ flash skill 跑 2-3 个真实任务对比上游 flash 质量——**spike 过 = 直通，不过 = 回退三段式（git 历史）**
- [ ] **参数面核对**：`src/tools/runDeviceAction.ts` 的 PY_TOOL 映射与 py action server 实际参数名逐个核对（来源：盘点 03 §1.8，未逐一实测）
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
