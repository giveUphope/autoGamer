# ARTEMIS 项目整改记录

> 本文档记录实测过程中发现的问题与整改点，作为后续逐步优化项目的依据。
> 每完成一项，将「状态」更新为 ✅ 已完成，并补充整改说明（改动文件、验证方式）。
> 后续新整改点按 #1 的格式在文末追加。

## 测试环境

| 项 | 说明 |
|---|---|
| 模拟器 | MuMu 模拟器（`adb connect 127.0.0.1:16384`，设备序列号已写入 `.env`） |
| 本地模型服务 | LM Studio，http://127.0.0.1:1234/v1（OpenAI 兼容）；已加载 `qwen3.6-35b-a3b-mtp`（VLM + tool_use） |
| 平台 | Windows / Git Bash |

## 整改后的预期形状（2026-10-06 已落地）

- **端点即配置**：`artemis.jsonc` 的每个节点（`default` / `nodes`）都可用 `api_base` + `api_key`（或 `api_key_env`）声明完整端点；只写 `model` 的节点自动继承部署默认端点（含 fallback）。
- **优先级链**：配置显式指定 > 环境变量（`OPENAI_BASE_URL` 等）> 提供商官方默认端点。
- **零硬编码**：代码中不存在任何按调用点写死的 provider/端点；所有模型构建收敛到 provider 感知工厂。
- **2026-10-07 修订**：`presets` 段从 `config/artemis.jsonc` 与打包副本
  `artemis/resources/config/artemis.jsonc` 中删除——全仓没有任何代码按名字解析过它
  （`load_default_model_cfg` 只读 `default`），注释里的"Switch easily in code or CLI"是空头承诺；
  设置界面可选端点改由端点库 `endpoint_library.json`（`.env` 同级、gitignore）承载，
  运行时读的仍是 `default` 块。
- **2026-10-07 修订（#8）**：**出厂默认端点彻底移除**。不再把 Google 端点作为任何形式的
  fallback——一切端点信息（provider / model / api_base / api_key）都来自用户配置；
  用户没有配置时系统明确不可用（报错附配置指引），有无 Google Key 都不存在零配置可用路径。

---

## 整改点列表

### #1 默认端点不应写死：应支持预设提供商与自定义端点

- **日期**: 2026-10-06
- **状态**: ✅ 已完成
- **优先级**: 高（曾阻塞本地模型实测）
- **来源**: 实测准备阶段

#### 问题描述

模型端点与提供商绑定写死，无法在配置中指定自定义推理端点（本地 LM Studio / Ollama / vLLM 或企业网关）。期望：既支持**预设提供商**（google / openai / anthropic / openrouter / xai，自动使用官方默认端点，零配置可用），也支持**自定义端点**（在配置中覆盖 base_url）。

#### 现状分析（整改前的代码依据）

| 位置 | 整改前现状 |
|---|---|
| `artemis/llm/router.py:93` | `ModelEndpoint.api_base` / `api_key` 字段已存在且路由层优先使用——**底层能力具备，但配置层未暴露** |
| `artemis/services/llm.py`（`_resolve_endpoint`） | 仅透传 provider / model / temperature 等字段，不读取 `api_base` / `api_key` |
| `third_party/mobile_use/config/llm.py`（`LLM` 模型） | 无 `api_base` / `api_key` 字段；pydantic 默认忽略未知字段，配置写了会被**静默丢弃** |
| `third_party/mobile_use/utils/file.py`（`load_jsonc`） | **新发现**：注释剥离正则不感知字符串字面量，URL 中的 `//` 被当作注释截断（`"http://…"` → 解析报 `Invalid control character`）——即使补上字段，配置端点也落不了地 |
| `.env.example` | 未记载 `OPENAI_BASE_URL` 旁路 |

#### 整改方案与实施

1. **配置模型层**（`third_party/mobile_use/config/llm.py`）：`LLM` 新增 `api_base` / `api_key` / `api_key_env` 字段；`validate_provider` 认可配置内凭证（`api_key` 或 `api_key_env` 指向的环境变量），不再强制要求 `.env` 提供商 Key。
2. **解析链路**（`artemis/services/llm.py` `_resolve_endpoint`）：将 `api_base` / `api_key`（经 `api_key_env` 解析）映射进 `ModelEndpoint`；**fallback 端点继承**——fallback 未声明端点字段时自动继承父节点的 `api_base` / `api_key` / `api_key_env`。
3. **继承基准提取**（`artemis/config/llm.py`）：提取 `_resolve_llm_config_path()` 与出厂默认常量 `FACTORY_DEFAULT_MODEL_CFG`，新增 `load_default_model_cfg()` 读取**未被合并的**原始 `default` 条目，避免节点覆盖泄漏进继承基准；`parse_llm_config` 复用同一路径解析。
4. **JSONC 解析修复**（`third_party/mobile_use/utils/file.py`）：`strip_json_comments` 改为字符串感知模式（先匹配并原样保留字符串字面量，再剥离注释，与 `artemis/config/core/engine.py` 的成熟实现同款）；`engine.py` 委托该实现，消除重复。
5. **配置面**：`config/artemis.jsonc` 的 `default` 直接声明 `api_base` + `api_key`（fallback 演示继承）；`local-lmstudio` / `local-ollama` 预设补全端点字段；`.env` 移除 `OPENAI_BASE_URL` 旁路；`.env.example` 补充字段说明与优先级链。

#### 验收标准

- [x] 在 `artemis.jsonc` 中为节点指定 `api_base` 后，请求确实发往该端点——冒烟 6 项全过 + Flash/Pro 实测，守护进程日志确认全部请求命中 `http://127.0.0.1:1234/v1/chat/completions`
- [x] 只配置 `model` 的节点（含 fallback）继承部署默认端点——冒烟 #3/#4 验证 operator 及其 fallback 均继承 `api_base` / `api_key`
- [x] `.env.example` 补充端点字段与优先级说明
- [x] ~~未指定 `api_base` 时走官方端点的线上回归~~ —— 2026-10-07 随 **#8** 作废删除：官方端点回退路径已整体移除（不再有任何内置端点），无需回归

---

### #2 多处调用点硬编码 Google 客户端，配置中的 provider 被忽略

- **日期**: 2026-10-06
- **状态**: ✅ 已完成
- **优先级**: 高（非 Google 部署下 Flash 主链路直接崩溃）
- **来源**: 首次实测（任务启动即失败）

#### 问题描述

`artemis.jsonc` 配置 `"provider": "openai"` 后，Flash 档主链路仍以 `ChatGoogleGenerativeAI` 实例化本地模型名（`API key required for Gemini Developer API`）。根因：`artemis/services/llm.py` 的 `get_google_llm()` 将 provider 硬编码为 `ModelProvider.GOOGLE`，部分节点只透传 model 名。

#### 影响范围与整改结果

| 调用点 | 整改前 | 结果 |
|---|---|---|
| `artemis/agents/flash/summarizer.py`（step_summarizer 显式 model 路径，首次实测崩溃点） | 硬编码 Google | ✅ 改走 `get_default_deployment_llm()`；顺带修复 else 分支误用 utils 访问器（`summarizer` 是 agent 节点，原 `is_utils=True` 必然 AttributeError） |
| `artemis/memory/chunking.py`（chunker 主/备模型） | 硬编码 Google | ✅ 同上 |
| `artemis/agents/flash/runner.py`（operator 构建失败的兜底模型） | 硬编码 `gemini-2.5-flash` + Google | ✅ 兜底改为部署默认端点的默认模型 |
| `artemis/sdk/agent.py`（连接预热） | 硬编码 `ChatGoogleGenerativeAI(gemini-3.8-flash)` | ✅ 预热改走默认端点；Google 专属的 Native GenAI 客户端预热仅在 provider=google 时执行 |

#### 最终形状（工厂收敛）

- 删除 `get_google_llm()` 与过渡期辅助 `get_default_provider()`（全仓 grep 零残留）。
- 统一为三个 provider 感知入口（`artemis/services/llm.py`）：
  - `get_provider_llm(model_name, provider, ..., api_base, api_key)`：显式端点构建；
  - `get_default_deployment() -> DefaultDeployment`：读取部署默认端点（provider / model / api_base / api_key / api_key_env）；
  - `get_default_deployment_llm(model_name=None, ...)`：**只覆盖模型名、继承默认端点**的唯一入口，供「配置里只有裸模型名」的节点（step_summarizer、chunker）与降级兜底使用。

#### 验收标准

- [x] 全仓 grep 确认无 `get_google_llm` 裸调用点与残留引用（仅剩新工厂自身）
- [x] `provider: openai` 配置下 Flash 档跑通真实任务（设置查电量，报告 80%→充电中）
- [x] Pro 档跑通真实任务（关于手机查 Android 版本，LangGraph 多智能体图 + checker 全链路走本地端点，status completed）
- [x] ruff 全部改动文件 lint 通过

---

### #3 失败可观测性不足：CLI 报错信息为空，trace 编译丢失步骤

- **日期**: 2026-10-06
- **状态**: ✅ 已完成
- **优先级**: 中（不影响功能，但显著拉高排障成本）
- **来源**: 首次实测排障过程

#### 问题描述

1. 任务失败时 CLI 仅输出 `✖ Task failed: `（空消息），真实异常只存在于守护进程日志 `%LOCALAPPDATA%\Artemis\logs\daemon-8000.log`，用户无从得知。
2. 会话步骤实际落盘在 SQLite（`steps` 表）与 `<traces>/images/`，而 trace 编译器只扫描空的临时目录（遗留扁平布局），产物恒为 `Found 0 images / 0 steps`。
3. 环境项：scrcpy 未安装导致录屏/回放不可用（`winget install Genymobile.scrcpy` 可解）。
4. 追加观察：`artemis restart` 时 Showcase UI（Angular）增量构建报 `Failed to inline external stylesheet`（预编译产物仍可服务，疑似前端构建链问题，与后端整改无关，待排查）。

#### 整改方案与实施

1. **错误传播链贯通**：`sessions` 表新增 `error_message` 列（ALTER 迁移，`artemis/data_engine/storage.py`）；`SessionMetadata` 增加同名字段并纳入 `update_session`；`DataEngine.end_session(status, error_message=None)` 透传；worker 侧三个收尾点全部写入错误（`third_party/mobile_use/sdk/agent.py` 的 cancelled / except 分支与 `_finalize_tracing`）；CLI（`run.py`）优先读取 `error_message`，失败时附带 `artemis trace view <sid>` 与守护进程日志路径提示。
2. **编译产物修复**：新增 `_materialize_session_trace_artifacts`——编译前把 DataEngine 会话步骤（截图帧 `<n>.jpeg` + 步骤载荷 `<ts>.json`）从 SQLite/图片目录物化进编译目录；GIF 编译改为容错（缺 ffmpeg 只跳过 GIF，不影响 steps.json）。

#### 验收标准

- [x] 故障注入（`api_base` 指向死端口 `127.0.0.1:9`）：CLI 输出 `✖ Task failed: Error running automation: Connection error.` + 定位提示；DB `sessions.error_message` 持久化完整异常
- [x] 正常任务编译产物包含全部步骤与帧（`Materialized N steps → Found N images / N steps → steps.json` 非空 + `trace.gif`）
- [x] 成功会话 `error_message` 保持 NULL，无残留
- [ ] （可选）安装 scrcpy 后录屏回放可用

---

### #4 无 Google Key 时默认环境应为空，不指定任何端点

- **日期**: 2026-10-06
- **状态**: ✅ 已完成
- **优先级**: 中（影响首次部署体验与误导性报错）
- **来源**: 用户要求 + #1 验收遗留项

#### 问题描述

内置出厂默认（`FACTORY_DEFAULT_MODEL_CFG`）隐式指向 Google 官方端点。无 Google Key 的环境里，未显式配置模型时系统会默默构造 Gemini 客户端并以误导性的「API key required」报错失败。期望：无 Google 凭证时默认环境为**空**（不指定任何端点），解析时给出清晰、可操作的配置指引。

#### 整改方案与实施

1. **配置模型容忍空端点**（`third_party/mobile_use/config/llm.py`）：`LLM.provider` / `model` 允许为 None，`LLMWithFallback.fallback` 允许为 None；`validate_provider` 对未配置节点直接跳过；`__str__` 显示 `unconfigured`。
2. **出厂默认门控**（`artemis/config/llm.py`）：新增 `_google_credentials_present()` 与 `_factory_default_cfg()`——仅当 Google 凭证存在时出厂默认才生效，否则默认环境为空；`load_default_model_cfg` / `_expand_default_into_nodes` 统一走该门控；`lightweight_judge_default`（像素安全网/计划校验判官）在无 Google 凭证时改为继承部署默认端点。
3. **清晰报错**（`artemis/services/llm.py`）：`DefaultDeployment` 空默认（provider/model 为空串）；`get_default_deployment_llm` 与 `_resolve_endpoint` 在未配置时抛出带配置指引的 `RuntimeError`（指明设置 `default` 节点或提供 `GEMINI_API_KEY`），不再退回 Google 客户端。
4. **连带修复**：`explorer/run_setup.py` 对未配置 explorer 节点的 `model=None` 兼容（回退 `DEFAULT_EXPLORER_MODEL`，避免 TypeError）。

#### 验收标准

- [x] 无 Google Key + 配置无 `default`：节点展开为未配置、`LLMConfig` 校验通过、解析时报清晰 `RuntimeError`（冒烟 1–4 通过）
- [x] 有显式 `default`（本环境 openai + api_base）：行为完全不受影响（冒烟 5–7 + 实测回归通过）
- [x] ~~Google Key 存在时保留原出厂默认零配置体验~~ —— 2026-10-07 随 **#8** 政策反转：出厂默认彻底移除，有无 Google Key 都以用户配置为准

---

### #5 每次任务弹出空白 python 控制台窗口

- **日期**: 2026-10-06
- **状态**: ✅ 已完成
- **优先级**: 中（体验问题：任务运行时弹出一个内容全空的 `.venv\Scripts\python.exe` 终端）
- **来源**: 实测观察

#### 问题描述

每次任务运行都会弹出一个标题为 `D:\DEV\autoGamer\.venv\Scripts\python.exe` 的控制台窗口，且窗口内无任何输出。

#### 根因

该窗口是 **ImageProcessor 感知工具的 Jupyter 内核**（`ipykernel`，即 `.venv\Scripts\python.exe`）。jupyter_client 的 `launch_kernel` 只在父进程为 `pythonw.exe` 时才追加 `CREATE_NO_WINDOW`（`redirect_out = sys.executable.endswith("pythonw.exe")`）；而 ARTEMIS 的 worker 进程本身是无控制台启动的（`CREATE_NO_WINDOW`），无控制台的父进程再拉起控制台程序时，Windows 会为其**分配一个新的可见控制台**——内核 stdout 又被重定向到 `kernel.log`，于是窗口永久空白。

#### 整改方案与实施

`artemis/utils/python_executor.py` 的 `_start()`：Windows 下向 `KernelManager.start_kernel` 显式传入 `creationflags = CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`，经 `launch_kernel → Popen` 透传生效；内核输出仍按设计落盘到 `session_dir/kernel.log`（满足"或能出现正常 log"的备选预期）。

#### 验收标准

- [x] 从无控制台的父进程启动内核，系统可见窗口前后快照 diff 为空（不再弹窗）
- [x] 内核功能正常：`execute("print(2+3)")` 返回 `5`；输出落盘 `kernel.log`
- [x] ruff lint 通过

---


## 验证记录

| 时间 | 项目 | 结果 |
|---|---|---|
| 10-06 首测 | Flash「设置查电量」 | ❌ 崩溃（`ChatGoogleGenerativeAI` 校验错误）→ 立出 #2 |
| 10-06 二测 | 同任务（#2 热修 + `OPENAI_BASE_URL` 旁路） | ✅ 3 回合，电量 80% 充电中，全程约 50s |
| 10-06 冒烟 | 端点贯通 6 项（原始 default / DefaultDeployment / 节点继承 / fallback 继承 / ChatOpenAI base_url / 实时调用） | ✅ 全过（此时 `.env` 旁路已移除，端点纯来自配置） |
| 10-06 三测 | Flash 同任务（纯配置端点） | ✅ 2 回合，电量 73%，全部请求命中 `127.0.0.1:1234` |
| 10-06 四测 | Pro「关于手机查 Android 版本」（纯配置端点） | ✅ LangGraph 全链路（planner/operator/checker）命中本地端点，status completed |
| 10-06 冒烟 | 空默认行为 4 项（无 google key 展开为空 / LLMConfig 校验 / 节点级清晰报错 / 真实配置不受影响） | ✅ 全过（#4） |
| 10-06 五测 | 故障注入：`api_base` 指向死端口 | ✅ CLI 显示 `Connection error.` + 定位提示；`sessions.error_message` 持久化（#3-1） |
| 10-06 六测 | Flash 回归（恢复配置）+ 编译产物 | ✅ 任务成功；`Materialized N steps`、`steps.json` 非空、`trace.gif` 生成；成功会话 error_message 为 NULL（#3-2） |
| 10-06 七测 | 无控制台父进程启动 Jupyter 内核 + 窗口快照 diff | ✅ 无新窗口弹出；内核执行正常（`print(2+3)`→`5`），输出落盘 `kernel.log`（#5） |
| 10-07 全量 | 后端 pytest 全量套件（Windows 实机，修复前） | ❌ 6 处失败：explorer×9 / video_analyzer×3 / readiness 缓存 / 设备发现 / device_lock 偶发（立出 #7） |
| 10-07 全量 | 后端 pytest 全量套件（修复后，含 device_lock 连跑 10 次） | ✅ 2570 passed / 0 failed，ruff 通过；前端 254 用例 + vue-tsc + 生产构建通过（#7） |
| 10-07 冒烟 | 无出厂默认行为 4 项（假 Key 注入下：缺文件→空默认 / 空配置→未配置节点与判官 / 解析报清晰指引 / 显式配置不受影响） | ✅ 全过，`test_no_google_factory_default` 钉住（#8） |

---

### #6 前端 Web 控制台重构迁移完成（Angular 22 → Vue 3 + Arco Design Vue）

- **日期**: 2026-10-06
- **状态**: ✅ 已完成
- **优先级**: 高（Web 控制台前端工程整体一次性替换）
- **来源**: 前端迁移专项（M0–M6 里程碑收官）

#### 迁移内容

旧 Angular 22 工程（`apps/showcase_ui`）已删除，由 Vue 3 + Arco Design Vue 新工程
（`apps/showcase_ui_v2`）完整承接，M0–M6 全部里程碑完成：

- **SSE 实时流**：任务时间线 / 截图 / 工具调用事件实时推送渲染，替代旧轮询与增量构建链路。
- **回放投屏**：会话回放视图与投屏（cast）桥接层按编译期结构断言对齐真实契约。
- **系统诊断**：连通性 / 就绪度（readiness）诊断接入，联动顶栏在线状态指示。
- **托管切换（决策 D2，一次性替换）**：`server.py` 的静态产物探测候选指向
  `apps/showcase_ui_v2/dist/browser`（源码树托管）；wheel 回退产物
  `artemis/resources/showcase_ui` 经 `npm run sync:resources` 同步为 Vite 产物
  （发布流程可 `make release-ui` 一键构建 + 同步）；无 /v2 并行子路径。

#### 验收标准

- [x] 前端：vitest 198 用例全绿 + vue-tsc 零错误 + 生产构建通过
- [x] 后端：托管链路 66 用例全绿
- [x] 打包：`uv build --wheel` 解包确认 `showcase_ui` 资源完整

---

### #7 Windows 实机全量测试修复：FIFO 预约乱序（真 bug）+ 强刷缓存吞没 + 5 处测试隔离缺失

- **日期**: 2026-10-07
- **状态**: ✅ 已完成
- **优先级**: 高（device_lock 为真产品缺陷：队列顺序随机；其余为测试对环境/平台的隐性依赖，迁移期只跑过子集，全量套件在 Windows 实机长期未绿）
- **来源**: 从断点恢复后跑全量后端套件

#### 问题描述

迁移与端点库特性期间只验证过前端全套与后端托管链路子集；全量 `pytest tests/` 在 Windows 实机上有 6 处失败：

| 失败 | 性质 | 根因 |
|---|---|---|
| `test_device_lock.py::test_submission_reservations_preserve_order_before_workers_start`（偶发，单独跑必过） | **真产品 bug** | `reserve()` 以 `time.time_ns()` 作为票据文件名排序前缀，Windows 时钟约 1ms 才走一格：连续两次 reserve 拿到相同前缀，`sorted()` 退化为按随机 uuid 排序——后提交的任务有 50% 概率插队到先提交的之前，FIFO 预约顺序失效 |
| `test_diagnostics.py::test_readiness_engine_reuses_cache_until_forced` | 真产品边界 bug | `run_all` 合并分支用 `>=` 比较 `_report_cache_time` 与 `request_started`；Windows `time.monotonic()` 刻度约 16ms，强刷请求与上一次刷新落在同一刻度时两值相等，强制刷新被当作「等待期间完成的刷新」吞掉，返回陈旧快照 |
| `test_explorer.py` ×9、`test_video_analyzer.py` ×3 | 测试夹具过期 | 用例只 mock 了 `genai.Client`，但引擎探测收紧后（无 `GOOGLE_API_KEY` 时走 universal 引擎）落到 `_resolve_endpoint`，MagicMock provider 撞上 `ModelProvider.from_string` 校验抛 `ValueError`；同文件后写的用例已改用「预设 `ctx._genai_client` 选 native 引擎」模式，旧用例没跟上 |
| `test_awake_service.py::test_discovery_keeps_only_pool_claimed_devices` | 测试环境泄漏 | 开发机 shell 导出了 `ADB_DEVICE_SERIAL=127.0.0.1:16384`（MuMu 序号），`_discover_connected_device_ids` 的显式 target 优先分支使断言落空返回 `[]` |

#### 整改方案与实施

1. **FIFO 前缀严格递增**（`artemis/runtime/device_lock.py`）：`reserve()` 增加类级 `_reserve_lock`（进程内串行化）+ 前缀占用检测——目标前缀已被任何 `*.wait` 占用时递增 ns 重试，保证前缀唯一且严格按预约完成顺序递增；跨进程残留碰撞由 O_EXCL 兜底。新增确定性回归用例 `test_reserve_prefixes_increase_even_when_the_clock_stalls`。
2. **强刷合并改严格大于**（`artemis/core/diagnostics/engine.py`）：`_report_cache_time > request_started` 才合并——刷新确实在本请求开始之后完成才允许吃掉强制刷新；同刻度歧义一律重建（对强制语义安全）。非强制请求随后的 TTL 缓存检查不受影响。
3. **测试夹具对齐现行引擎探测**（`tests/unit/agents/test_explorer.py`、`test_video_analyzer.py`）：12 个用例在创建 mock client 后补 `mock_ctx._genai_client = mock_client`，与既有 `test_explorer_final_turn_tool_stripping` 同模式，引擎选择不再依赖环境里有没有 Google Key。
4. **测试环境钉死**（`tests/unit/runtime/test_awake_service.py`）：两个 discovery 用例加 `@patch.dict` 钉住 `ARTEMIS_KEEP_DEVICE_AWAKE` / `ARTEMIS_CLOUD_MODE` / `ARTEMIS_DEVICE_ID` / `ADB_DEVICE_SERIAL`，不再受开发机 shell 环境影响。

#### 验收标准

- [x] 全量 `pytest tests/`：2570 passed / 0 failed（修复前 6 failed）
- [x] `test_device_lock.py` 连跑 10 次全绿（修复前 10 次挂 3 次；因果经 12 轮插桩试验确认：6 次前缀碰撞全部对应乱序与提前获得锁）
- [x] ruff 对全部改动文件通过
- [x] 前端回归不受影响：vitest 254 用例 + vue-tsc + 生产构建通过


---

### #8 移除 Google 出厂默认端点：一切端点信息均依靠用户配置

- **日期**: 2026-10-07
- **状态**: ✅ 已完成
- **优先级**: 高（产品决策：Google 端点彻底退出 fallback 体系）
- **来源**: 用户明确要求

#### 决策

不再把 Google 端点作为任何形式的 fallback / 出厂默认：一切端点信息（provider / model /
api_base / api_key）都来自用户配置（`artemis.jsonc` 的 `default`/`nodes` 与端点库）；
用户没有配置时系统**明确不可用**——报错附配置指引，绝不静默假设任何厂商端点。
#1 遗留的「未指定 `api_base` 时走官方端点的线上回归」随之作废删除（官方端点回退路径
已不存在，无可回归）。用户**显式**配置 provider=google 的能力不受影响——移除的是
"默认"，不是"支持"。

#### 整改方案与实施

1. `artemis/config/llm.py`：删除 `FACTORY_DEFAULT_MODEL_CFG`、`_google_credentials_present()`、
   `_factory_default_cfg()`；`load_default_model_cfg` / `_expand_default_into_nodes` /
   `_apply_endpoint_override` 在配置缺失/损坏/为空时统一落空 `default`（不再有任何内置端点，
   有无 Google Key 均如此）；`lightweight_judge_default()` 删除 Google flash-lite 分支——
   判官节点（像素安全网/计划校验）同样只继承用户配置的部署默认端点，未配置即为未配置。
2. `artemis/services/llm.py`：两处未配置报错移除「或提供 GEMINI_API_KEY」指引（仅凭 Key
   已不能使用任何端点），改为明确「没有内置端点，配置前无法运行」；`DefaultDeployment`
   与 `get_default_deployment` 文档同步。
3. `artemis/interfaces/cli/commands/init.py`：`artemis init` 生成的 `.env` 模板移除
   `ARTEMIS_DEFAULT_MODEL=gemini-2.5-flash` 误导项（该变量无消费方），改为注释指回
   `artemis.jsonc` 的 `default` 块。
4. 测试：新增 `test_no_google_factory_default` 钉住策略（环境注入假 Google Key 也不复活
   内置端点：缺文件→空默认 / 空配置→未配置节点与判官 / 解析报清晰错误 / 显式配置不受影响）；
   `test_planner_validation_node_defaults_to_lightweight_judge` 由「断言 flash-lite」改为
   「断言继承部署默认」。

#### 验收标准

- [x] 缺文件 / 空 `{}` 配置：`load_default_model_cfg() == {}`、节点与判官展开为未配置、
      `get_default_deployment_llm()` 抛出带配置指引的 `RuntimeError`（单测覆盖，且在
      GEMINI_API_KEY/GOOGLE_API_KEY 已设的环境变量下验证）
- [x] 显式用户配置（openai + LM Studio 实测环境）行为不受影响；全量 `pytest tests/` 通过
- [x] ruff 通过
