# ARTEMIS 变更历史（CHANGELOGS）

> 本文档只记**已经发生并结案**的变更：每条是一个 `### #N` 条目，含「问题描述 / 整改方案与实施 / 验收标准」三段。
> **在办事项、差距、方案与验收清单在 `TODO.md`，不要写在这里**；两者的分工与追加规则见下方「写入规则」与 `AGENTS.md`。
> **条目编号 `#N` 一经发布不得改写**——`AGENTS.md`、`TODO.md`、`migration/registry.md` 与守则都按 `changelogs #N` 引用它，分类只移动块的位置，不动编号。

## 索引

| 分类 | 条目 | 范围 |
|---|---|---|
| 一 · 模型端点与配置 | #1, #2, #3, #4, #8 | 出厂端点不写死、provider 感知工厂、失败可观测性、零配置路径的移除。 |
| 二 · 前端 Web 控制台 | #6 | Angular 22 → Vue 3 + Arco Design Vue 的整仓迁移与收尾。 |
| 三 · 实机与测试环境 | #5, #7 | Windows 真机全量测试暴露的问题：控制台弹窗、FIFO 预约乱序、缓存强刷、测试隔离。 |
| 四 · DSH 插件轨道（当前主线） | #9, #10, #11, #12 | `plugins/autogamer-device` 与 py 动作面的接线、契约与真机联调问题。 |
| 已关闭差距史 | G* | `TODO.md` 差距清单里结案条目的去处 |

## 写入规则（如何新增一条变更历史）

1. **判归属**：问题已修好并有验收证据 → 写这里；还没修 → 写 `TODO.md` 差距行并按 `registry.md` 编号；只是方案/验收清单 → 写 `TODO.md` 主题条目。
2. **取号**：`### #N` 取当前最大号 +1，**永不复用、永不重排**；分类只影响块的位置。
3. **写三段**：`#### 问题描述`（含实测证据与原文/出处）、`#### 整改方案与实施`（改了哪些文件与为什么这么改）、`#### 验收标准`（可复跑的命令/测试勾选项）。
4. **与 TODO 的交接**：条目若关闭某个 `G*`，本文件写正文，`registry.md` 的已关闭表写一行结论，`TODO.md` 只保留一行指针或直接从差距表移除——**同一事实只在一处展开**。
5. **防膨胀**：单条超过 ~60 行时，把调研正文移进 `docs/migration/` 对应文档，本文件留结论 + 链接；分类小节只增不改，新增分类须同步更新上方索引表。

---

## 附录 · 早期整改背景（2026-10-06 前后）

### 测试环境
| 项 | 说明 |
|---|---|
| 模拟器 | MuMu 模拟器（`adb connect 127.0.0.1:16384`，设备序列号已写入 `.env`） |
| 本地模型服务 | LM Studio，http://127.0.0.1:1234/v1（OpenAI 兼容）；已加载 `qwen3.6-35b-a3b-mtp`（VLM + tool_use） |
| 平台 | Windows / Git Bash |

### 整改后的预期形状
（2026-10-06 已落地）

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

### 早期验证记录（2026-10-06 端点整改）

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

---

## 一 · 模型端点与配置

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


## 二 · 前端 Web 控制台

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


## 三 · 实机与测试环境

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


## 四 · DSH 插件轨道（当前主线）

### #9 live 复验连带的两个插件缺陷：截图取尺寸栈溢出与 `screenSize` 真值陷阱

- **日期**: 2026-10-10
- **状态**: ✅ 已完成
- **优先级**: 中（截图取尺寸路径整体不可用；默认配置下坐标静默错误并报成功）
- **来源**: P0 live 复验顺带发现（`plugins/autogamer-device`）

#### 问题描述

1. `src/coord.ts` 的 `parseImageSize` 对任何输入都栈溢出：`byteAt` 自己调自己——截图取尺寸（PNG IHDR / JPEG SOFn 解析）这条路本来就是死的，坐标换算拿不到任何设备尺寸。
2. `src/index.ts` 的 `apply()` 里 `if (config.screenSize)` 被判据骗过——Schemastery 把未配置的可选 tuple 归一化成**真值 `[undefined, undefined]`**，于是「操作者配置了尺寸」误判成立，默认配置下的 0-1000 → 像素换算一路 `NaN` 发给 action server 还报成功。

#### 整改方案与实施

1. `src/coord.ts`：`byteAt` 修为 `bytes[index] ?? 0`（不再自递归）；新增 `configuredScreenSize()` 纯函数——按数字判定（类型 / 有限性 / 正值），`[undefined, undefined]`、`[null, null]` 一律视作未配置。
2. `src/index.ts`：`resolveScreenSize` 改调 `configuredScreenSize(config.screenSize)`；未配置时退回探针截图解析（`imageSizeFromBase64`），解析结果按设备键缓存。

#### 验收标准

- [x] `tests/coord.spec.ts`：`configuredScreenSize` 对 `[1080, 2400]` / `[undefined, undefined]` / `[null, null]` 的断言
- [x] `tests/apply.spec.ts` wiring lock：驱动经 `apply()` 注册的工具，断言 action server 真收到的坐标；删除实验：退回旧判据 ⇒ 2 条红，实测打出 `[null,null]` 形态的 payload
- [x] vitest 全绿；mock action server 的 PNG 截图实测解析为 1080x2400（live 证据）


### #10 G30 双根因：cordis effect 语义反转自注销工具面 + 裸注册 schema 未编译上 wire

- **日期**: 2026-10-10
- **状态**: ✅ 已完成
- **优先级**: 高（P0 唯一阻塞 G30）
- **来源**: 联网源码调研（deepseek-ai/deepseek-harness@master）+ 官方检查器分级实证（`plugins/autogamer-device`）

#### 问题描述

1. **effect 语义反转**（注册生命周期）：`apply()` 里 `ctx.effect?.(() => { disposers 逐个执行; client.dispose() })` 把 teardown 当成了回调体。cordis 的 `effect()` 语义是**回调立即执行、返回值才是清理函数**（官方源码 mount.ts:208、agent-preset-registry/src/index.ts:112、app-boot service.ts:110 同式）——于是两个工具在注册后数毫秒内被自己注销，而行状态、Config、注册计数一切正常。测试假 context 干脆没有 `effect` 方法，缺陷在 CI 里不可见。
2. **裸注册 schema 未编译**（wire 契约）：裸 `ctx.tools.register()` 走官方 MCP 路径，`parameters` 必须已是完整 JSON Schema（根节点 `type: "object"`）；我们传的是命名 spec 映射，map→object schema 的编译只存在于 `defineTool()` DSL（`parameterSchemaSpecToJsonSchema`）。结果 LLM API 以 400 拒绝整个请求（zod: `parameters.type` 期望 "object"）。

#### 整改方案与实施

1. `src/index.ts`：工具注册交还注册表自持所有权（与官方 tool-jobs 同形、不再包 effect）；effect 只包 ActionClient 清理并**返回**清理函数。`src/dsh-types.ts` 的 `effect` 类型改为 `setup: () => unknown` 并注记语义出处。
2. 注册改走官方 `defineTool()`（新增 devDependency `@deepseek-ai/dsh-tools@0.2.0-rc.2` 及其值导入所需的 4 个 peer——运行时仍经 linked-root peer 拦截解析宿主副本）；`src/dsh-types.ts` 删除手镜像 spec 类型，直接使用官方包类型产物（`DefineToolOptions`）。两处定义补官方方言缺口：object 节点显式 `additionalProperties`（G34）、输出 schema 的 required 数组改 per-property `required: true`、render 返回 `ContentBlock[]`；run_device_action 的输出 schema 改显式开放对象（payload 按动作而异）。
3. `tests/apply.spec.ts`：fakeContext 按真实 cordis 语义实现 `effect`（立即执行回调、收下返回的清理函数），新增 G30 回归锁两条——effect 必须返回清理函数而非就地执行、清理只作用于 ActionClient。

#### 验收标准

- [x] vitest 38/38（含 2 条新回归锁；删除实验：回退 effect 写法 ⇒ 两条红）
- [x] 离线自证：加载 dist 跑 `apply()`，注册产物 `parameters.type === "object"`、required 为数组、render 返回 ContentBlock
- [x] live 实证（R7 新会话）：模型真实调用 `run_device_action` 三次、入参合法、按次调整重试；上一轮的 400 / 「没有这个工具」签名全部消失（mock 后端超时为另一问题，见 todo S5 跟进）


### #11 G36 截图媒体展示：附件服务漏声明 inject，且模型模态默认是「负能力」

- **日期**: 2026-10-11
- **状态**: ✅ 已完成（模型侧打通；UI 卡片侧按官方形态归 P3，见 todo G36）
- **优先级**: 高（S10 ② 效果验证的视觉前置）
- **来源**: 真机 live 三轮 + 上游声明面（`docs/subsystems/attachment.zh.md`、`--dump-config-schema` 的 `providers.*.models[].input`、`@deepseek-ai/dsh-llm` 的 `inputModalities`）

#### 问题描述

1. **截图不进模型**：`take_screenshot` 分支主动 withhold base64，只回尺寸。wire 实录：模型拿到 `screenshot=captured 1600x900 (base64 withheld…)` 后**自己退到 `get_ui_hierarchy`**，用 XML 里的 `content-desc` 拼出「屏幕内容」——看起来像看懂了图，其实一个像素都没见。
2. **附件服务不是可选依赖**：首版按「拿不到就降级」写，直接读 `ctx.attachments` 被 cordis 在**属性 GET 处**抛 `cannot get property "attachments" without inject`；该错误没有 `environment:` 前缀，被 dispatch 归类成 **task 级失败**，模型连试三次后 `report_task_status=blocked`。
3. **模态默认值是负数**：声明 inject 后附件确实落盘（`~/.dsh/attachments/v1/objects/…`，宿主把 PNG 重编码成 JPEG），但请求里模型看到的仍是 `[image omitted because this model accepts text only; attachment sha256:…]`。声明面口径：`inputModalities` **absent = unknown，显式省略 = 负能力**，而 provider 配置 `models[].input` 的 schema 默认就是 `[]`。

#### 整改方案与实施

1. `src/coord.ts`：新增 `decodeImageBase64`（全量解码）与 `imageMediaTypeOf`（PNG/JPEG 头部嗅探），`atLeast` 与它共用 strip/binary 助手。
2. `src/tools/runDeviceAction.ts`：take_screenshot 改成「解码 → `saveScreenshot` → value 里只放引用」；`output.render` 按官方工具图像结果形态返回 `[text 信封, image 块]`（宿主 `read_image` 就是这个形状）。base64 绝不进 value——会话日志只记内容寻址引用。
3. `src/dsh-types.ts`：镜像 `DshAttachments.saveImages` / `DshImageAttachment` 并标出处。不引官方包当类型源：`@deepseek-ai/dsh-attachment` 在 npm 上是 `0.0.1-rc.1`，与本机宿主 rc.2 不同版（D6 精确 pin 不允许混版）。
4. `src/index.ts`：`inject = ["tools", "attachments"]`；`saveImages` 被拒（字节/像素/单边上限、解码失败）只 warn 并降级成文本，不失败整个动作。
5. `spike/web-live.patch.yml`：收回交付形态（G37）+ 给本地模型补 `input: [text, image]`。

#### 验收标准

- [x] vitest 41/41，新增 3 条 G36 锁：附件收到 1080x2400 的 PNG 字节并回引用、render 出 `[text, image]`、**结果 value 内不含 base64**、store 拒绝时仍报尺寸
- [x] R6：overlay 三个版本各跑一次 `--dump-config`，均 exit 0 且 0 unmatched
- [x] live（R7 新会话、纯交付形态 `tools=5`）：一次 `take_screenshot` → 附件落盘 → 宿主把图**提升为带真实 base64 的 user 消息**（wire 请求体 12KB→296KB、`image_url`×2）→ 模型答出「太空星球主题壁纸 + 顶部时间 17:06」；17:06 是本轮真实时刻，而上一轮从 XML 读到的是 14:30，证明确实读到了像素
- [x] **否证一条猜测**：不需要给 preset 挂 `@deepseek-ai/dsh-tool-fs` 让模型用 `read_image` 去开那个只读路径——宿主自己完成提升。带 fs 的那轮验完已收回，overlay 仍是 `inner + tool-jobs`


### #12 G39 路线 A：效果判定落到 py 动作面（真机 JPEG 让 TS 侧解码器失效）

- **日期**: 2026-10-11
- **状态**: ✅ 已完成
- **优先级**: 高（S10 ② 效果验证的判定依据）
- **来源**: 真机 live 一轮 `effect=unknown` + 仓库内上游实现盘点（`artemis/utils/image_diff.py`）

#### 问题描述

1. **TS 侧自研差分在真机上必然失效**：`artemis mcp --type adb` 的 `take_screenshot` 文档串自己写着返回 base64 **JPEG**（uiautomator2 路径），而 #11 之后补的 `src/frame.ts` 只会解 PNG。离线与 vitest 全绿，live 一轮 `back` 直接报 `result=Success; effect=unknown`。
2. **加错了面**：`compare_ui_frames` 最初被加到 `artemis/mcp/action_server.py`（py 智能栈内部面），但插件消费的是 `artemis/mcp/adb_server.py`（`--type adb`）。靠 `tests/unit/mcp` 的 fixture 快照测试暴露（它只锁了内部面，说明**快照锁不住"哪个面被消费"这件事**）。
3. **权威实现本来就在仓库里**：`check_ui_change`（cv2 灰度解码、遮状态栏 10%/导航栏 5%、全屏变化比例阈值 1e-4、tap 类走按屏对角缩放的 ROI、**解码失败按「有变化」兜底**）。且它在本 fork 里**没有活调用点**——只有定义与 validator 测试里的 mock，所以它的语义权威是那份测试而不是线上流量。

#### 整改方案与实施

1. `artemis/mcp/adb_server.py` 新增**只读**工具 `compare_ui_frames(before_b64, after_b64, action="tap", coordinates=None)` → `'{"changed": bool}'`；**不自己截图**（actuation 与 observation 上游刻意拆开，取帧时机归调用方），判定原样委托 `check_ui_change`，连"假定有变化"的兜底一起继承。
2. 两份 pin 住的快照同步：`tests/fixtures/action_surfaces/adb_server_manifest.json`（13→14 工具）与插件侧 `tests/fixtures/py-action-tools.json` + `contracts.spec.ts` 的计数锁；重抓命令写回 fixture 的 `source` 字段。
3. TS 侧删掉 `src/frame.ts` 及其解码器测试：`captureFrame` 改回吐 base64，新增 `compareFrames` 调 py 工具（传 **py 动作名**与**像素坐标**，好让 tap-ROI 规则真的生效）；`effect_diff` 随契约取消——判定是布尔。
4. 中途否证一条自己的断言：曾写测试要求"坏 base64 返回 `Error:`"，实际 `b64decode("!!!")` 不抛错、空字节走 cv2 解码失败 → 兜底 `changed=true`。该契约不存在，测试删除而不是改代码去凑。

#### 验收标准

- [x] py：`tests/unit/mcp` 224 passed（新增 3 条行为锁：同帧→unchanged、半屏翻转→changed、坏字节→兜底 changed）；`ruff check` 对改动文件干净
- [x] 插件：vitest 46/46（效果锁改为「调用 py 判定」的形状，含「tap 坐标必须传给 compare_ui_frames」一条）
- [x] live（R7 新会话、真机）：`back` 从 Settings 回桌面 → `effect=changed`；再按一次 `back`（已在桌面）→ `effect=unchanged`。**正反两例都有**，且 MuMu 的动态壁纸没有造成假阳性
- [x] 字节等值路线被实测排除的结论保留在案：静态三帧哈希全不同（动态壁纸），而真换屏灰度均值差 0.69 vs 动画噪声 ≤0.015


## 已关闭差距史（G*）

> 编号唯一权威仍是 `migration/registry.md`；本节承载「当初是什么问题、怎么关掉的、证据在哪」，由 `scripts/check_doc_registry.py` 作为已关闭编号的定义来源之一。

| 编号 | 原短语 | 关闭方式 | 出处 |
|---|---|---|---|
| G1 | 模式矛盾 | 随 R2' 定稿消失 | git 历史 + 三份研究文档 |
| G2 | UI 降级 | 随 DSH 原生 roster/QueueDock 与旧控制台只读消失；**只覆盖展示降级面，未覆盖 catch-up（那是 G20）** | 同上 |
| G6 | Windows 沙箱 | 随 R2' 不 spawn job 消失 | 同上 |
| G7 | 双跑 | 转为 D9 的回退件 | 同上 |
| G9 | worker env | 随 R1 遗产消失 | 同上 |
| G12 | LLM 暂停 | 随 py 智能栈不迁移消失 | 同上 |
| G15 | 共享锁 | 由 D3 裁定吸收 | 同上 |
| G16 | notes | 由 D2/S1 的 DSH 原生会话记忆承接 | 同上 |
| G18 | SSE | 随 D10 收缩；事件名全集保留为 conformance fixture（`tests/fixtures/sse-events.json`） | 同上 |
| G19 | 轮次视图 | 旧控制台只读，DSH 原生承接 | 同上 |
| G20 | catch-up | 核实为 DSH 原生支持（`readSessionState` 等），无需自建 | `docs/migration/dsh-verification.md` |
| G21 | 通知 | 改为按需再建（D10） | 同上 |
| G22 | SDK | 随 D10 删除 artemis-client | 同上 |
| G29 | 注入 | 由 S9 以 DSH 原生承接 | 同上 |
| G30 | preset 工具可见性（曾是 P0 阻塞点） | 双根因修复：cordis `effect()` 语义反转自注销 + 裸 `register()` 未经 `defineTool()` 编译 | 本文件 **#10** |
| G36 | 截图媒体展示（模型侧半边） | 附件服务 `saveImages` + `[text, image]` 结果 + provider `input: [text, image]` 模态声明；UI 卡片半边仍开放并归 P3 | 本文件 **#11** |
| G37 | live overlay 停在二分实验形态 | overlay 收回 `inner + tool-jobs` 交付形态，R6 exit 0 且 R7 新会话实测工具面恰为 5 个 | 本文件 **#11** |
| G39 | 效果判定归属层（真机回 JPEG 令 TS 侧 PNG 差分失效） | 裁定路线 A：py 动作面新增只读 `compare_ui_frames`，判定委托仓库内上游实现 `check_ui_change` | 本文件 **#12** |
| G40 | 运行中 UI 不接受第二条消息（**当日撤回的错误归因**） | 探针按固定 `aria-label="发送消息"` 找按钮，把运行中主按钮切成「排队发送」误读成入口消失；改按按钮位 class 枚举后实测 QueueDock 原生可用、回合结束按序执行 | TODO「S10 ③/④」条 + 守则 R20 取证方法 |
| G42 | `{index}` 元素定位整条不可用 | 按数组位置统一编号（模型所见与解析同源）+ 修掉 render 的 200 字符截断；7 条单测 + live 两轮命中 `#28`/`#17` | 本文件 **#11** 之后的修复轮（TODO「G41/G42 修复轮」条） |
