# autoGamer

一个 **DSH（DeepSeek Harness）插件**：让 agent 在真实 Android 设备上执行动作。

本项目在设计上受 [`google/artemis`](https://github.com/google/artemis) 启发，但**独立重实现**——
不保留上游任何内容（代码、文本、文档），`LICENSE` 为本项目自撰的 MIT 许可（版权人 giveUphope）。见 `AGENTS.md` 的 D20。

## 现状

功能面已落地：插件工程在 [`plugins/dsh-autogamer/`](plugins/dsh-autogamer/)，
设备动作、层级、截图、效果判定、诊断、任务三件套与**随包离线 OCR** 全部在 TS 侧（D19：仓内无 py）。
宿主内 live 证明（执行路由 + 预设 + 工具可见性 + 会话日志）与 packed bundle 交付验证都已完成
（记录见 [`docs/CHANGELOGS.md`](docs/CHANGELOGS.md)）；三任务工具的宿主内点名仍待设备。

仍开着的事：**G92** —— 内置 OCR 在真机小字浅色 CJK 上的**召回**不足，解法形态是「按区域识别」，
离线管线已落地、**尚未接进产品阶梯**（不接线的依据是结构性的：区域候选来自层级 bounds，层级无框时它帮不上；
到期条件 = 真机探针 B 的命中率 ≥ 整帧基线）。**G88 / G78** 是清点后判为无消费者的**待需求**，不是没做完。
2026-10-15 一轮**能力重审**（六面只读调研）之后另外立了三项并结清（CHANGELOGS **#111 / #112 / #113**：
宿主 abort 的分类、UiAutomation 槽位占用者、被宿主替换掉的工具结果），其余候选与**等你拍板的三件**
（装 adb + 设备 / provider 自我循环的取舍 / 是否加一个离线 conformance 依赖）都在 `docs/TODO.md` §零 与 §七「重审综合」。
开放差距表、进度与阻塞只认下面这一份台账。

- 执行流程、开放差距与实测读数：[`docs/TODO.md`](docs/TODO.md)（本分支编号权威）
- 终态规格与能力矩阵：[`docs/migration/ts-fullstack-spec.md`](docs/migration/ts-fullstack-spec.md)
- 已结案变更：[`docs/CHANGELOGS.md`](docs/CHANGELOGS.md)
- 宿主契约守则：[`docs/migration/plugin-contract-rules.md`](docs/migration/plugin-contract-rules.md)

旧 fork 的两版尝试在归档分支：**`legacy-fork-v2-dsh-plugin`**（DSH 插件形态，含完整实现与调研台账，不再演进）
与 **`legacy-fork-v1`**（初版二开）。

## 许可

MIT License，版权归 giveUphope，见 [`LICENSE`](LICENSE)。
