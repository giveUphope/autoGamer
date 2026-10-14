# autoGamer

一个 **DSH（DeepSeek Harness）插件**：让 agent 在真实 Android 设备上执行动作。

本项目在设计上受 [`google/artemis`](https://github.com/google/artemis) 启发，但**独立重实现**——
不保留上游任何内容（代码、文本、文档），`LICENSE` 为本项目自撰的 MIT 许可（版权人 giveUphope）。见 `AGENTS.md` 的 D20。

## 现状

**从零重建中**。终态是 **TS 全栈、py 归零**（D19）：

- 计划与终态规格：[`docs/migration/ts-fullstack-spec.md`](docs/migration/ts-fullstack-spec.md)
- 执行流程与开放项：[`docs/TODO.md`](docs/TODO.md)
- 宿主契约守则：[`docs/migration/plugin-contract-rules.md`](docs/migration/plugin-contract-rules.md)

旧 fork 的两版尝试在归档分支：**`legacy-fork-v2-dsh-plugin`**（DSH 插件形态，含完整实现与调研台账，不再演进）
与 **`legacy-fork-v1`**（初版二开）。

## 许可

MIT License，版权归 giveUphope，见 [`LICENSE`](LICENSE)。
