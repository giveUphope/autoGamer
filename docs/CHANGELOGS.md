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
| 四 · DSH 插件轨道（当前主线） | #9–#28 | `plugins/autogamer-device` 与 py 动作面的接线、契约与真机联调问题。 |
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


### #13 G44 终态强制打通：`turn/end` 要 `{global:true}` 才收得到，而追问必须推迟出 append 边界

- **日期**: 2026-10-11
- **状态**: ✅ 机制闭环（模型服从性另计，见验收最后一条）
- **优先级**: 高（P0 唯一硬阻塞）
- **来源**: 官方声明面 `packages/core/scope/README.zh.md:71,75`、`docs/subsystems/session.zh.md:609,1301`、cordis 4.0.4 `lib/types/events.d.ts:98-105` + `lib/index.js:263`、`packages/goal/goal-round-driver/src/index.ts:322-345`；live 五轮实证

#### 问题描述

`report_task_status` 是 S2 定义的终态出口，但本地模型两次被观察到**达成目标后直接文本收尾、根本不调该工具**，于是双轴终态（`completed/blocked + tests_failed`）压根不存在，还伴随 G41 式的不收敛。要在插件侧强制，就得观察"回合结束"。三轮失败与真因：

1. **v1 普通监听收不到 `turn/end`**：把 `session/event` 监听器注册在 preset 子作用域上，只收到 `tool/call`。当时误判为"必须另写 Host 级插件"。正解在 `packages/core/scope/README.zh.md:75`——事件按 scope 筛选，**带 `{ global: true }` 的监听器绕过筛选**，cordis 4.0.4 的 `EventOptions.global` 就是它（"Receive the event regardless of context filter checks"）。
2. **v2 加了 `global` 仍无追问**：把监听到的事件类型与追问结果做成 wire 可见探针后才发现——追问**触发了但被拒**：`session append cannot reenter while another append is being published`。官方口径 `docs/subsystems/session.zh.md:609`：「在验收/发布边界打开时重入的 append 会在日志变更前被拒绝」。`agent.followup()` 本质是一次 append，**不能在 `session/event` 的 emit 里同步调用**。
3. **对照官方实现佐证**：`goal-round-driver` 的 `case 'turn/end'` 分支**只更新状态、从不 append**，追问发生在边界之外。

#### 整改方案与实施

1. `src/turnLedger.ts`：按 agent（= session id，官方 `ctx.agents.get(session.id)` 同键）记 `acted / reported / nudged`；`consumeTurn()` 决定是否需要追问，**上限 1 次**防死循环。
2. `src/index.ts`：监听以 `ctx.on("session/event", handler, { global: true })` 注册；`turn/end` 且 acted 未 reported 时，**`setTimeout(…, 0)` 推迟出发布边界**再调 `agent.followup()`；追问失败只 warn 不影响动作。
3. 两个工具接入台账：`run_device_action` 记 acted，`report_task_status` 先记 reported 再 `concludeTurn()`。
4. 临时判别探针（`agent=` / `events=` / `nudge=` 上 wire）在定性后**已全部移除**，不留调试代码。

#### 验收标准

- [x] vitest 62/62，其中 5 条锁 G44 行为（含「监听必须以 `{global:true}` 注册」「已汇报不追问」「同一 agent 至多追问一次」「非 turn/end 不动作」）；追问改异步后测试等一个宏任务再断言
- [x] **live 四段全通**：`turn/end` 被 `{global:true}` 收到 → 台账判定 acted&&!reported → 推迟后的 `followup()` **被受理并驱动出第二轮**（只发一条消息却出现 `2 轮 3 步`）→ 追问文本出现在下一请求的 user 消息里（`nudge_present=True`）
- [x] **实验②结案**：自声明 `source.kind: "autogamer"` **通过 session format V4**（消息被受理并送达模型），未用被禁的 `{kind:'plugin', plugin}` 包装
- [x] 探针与调试代码零残留（`grep diag|nudgeOutcome|seenEvents dist/` 全 0）
- [ ] **模型服从性未达成**：本地 `qwen3.6-35b-a3b-mtp` 收到明确指令后，第二轮 1 秒返回空文本、**仍未调用 `report_task_status`**。机制已可强制，服从是模型质量问题——它作为输入进 D9 质量裁决，而不是继续算作 G44 的机制缺口


### #14 G45 指令投递：交付 preset 补上 `persona` 行，flash 契约第一次真的进入模型上下文

- **日期**: 2026-10-11
- **状态**: ✅ 已关闭（skill 随包路径另归 G31）
- **优先级**: 高（它使此前一批「模型不服从」观察全部失效）
- **来源**: 官方声明面 `packages/preset/persona/src/index.ts`（包源注释 + `Config`）、`packages/bundle/web-app/presets/standard.patch.yml`、`docs/subsystems/skills.zh.md`、`packages/core/system-prompt/README.zh.md`、本机 `--dump-config-schema` `$defs/config97`

#### 问题描述

`autogamer` preset 的 `plugins` 只有 `autogamer-device-inner` + `@deepseek-ai/dsh-tool-jobs`：**没有任何指令投递行**。
`skills/autogamer-flash/SKILL.md` 虽然随包出货，却从未被挂进任何会话——preset 既没挂 skill 提供方也没挂消费方；
而 `@deepseek-ai/dsh-agent-preset` 的 config 只有 `id / name / description / order / plugins`（`$defs/config97`），
**根本没有 prompt 字段**。后果是会话的 system 消息只有 3194 字符的宿主默认人设，
`run_device_action` / `report_task_status` 的操作契约一个字都没进模型。

于是这些观察全部作废重测：真机 spike 的「插件侧不如基线」、G41 的「模型收到指令仍不调工具」、
以及把 D9 判成「暂不成立」的那张对照表——两侧比的不是同一件事，**基线有 flash 契约、插件侧根本没有**。

顺带查清两条官方口径，避免以后再猜：
1. **skill 是渐进披露，不是上下文注入**：模型侧目录「仅使用 name 和 description，从不使用正文」，
   正文要模型自己调 `skill({name})` 才拿到。把硬约束放在按需加载路径上，等于把纪律交给一次自愿的工具调用。
2. **`persona` 是 scope-only 行**：包源注释写明「挂进 agent preset 会为那一场会话遮蔽部署 persona」，
   「挂在全局会与注册表自己的注册相撞、fail loud」，并解释该行存在的理由——
   「agent preset 不能自己挂 prompt 注册表，所以没有这一行，preset 只能改 agent 的工具、改不了身份」。

#### 整改方案与实施

1. `cordis.patch.yml`（交付形态）与 `spike/web-live.patch.yml`（live overlay）各加一行
   `persona` / `@deepseek-ai/dsh-persona`，`config.prefix` 写死 5 条硬约束：一次一动作并附 `reason`；
   终态唯一出口是 `report_task_status`、调用后不得再动设备/再 `wait`/再汇报；`#N` 只对当次
   `get_ui_hierarchy` 有效；被拒动作不得原样重试；判断屏幕只认截图。两处文本逐字一致（G37 的教训）。
2. **文本内不出现任何 `{{…}}`**：`system-prompt/README.zh.md` 规定未知引用会在**任何模型请求之前**使组装抛错，
   内置变量只有 `provider` / `model`，且明令自定义 persona 不得依赖 `{{cwd}}`。
3. **本轮故意不挂 skill 行**：D9 要裁的是「插件形态能否替掉 py flash」，把 skill 的成本（多一个 `skill` 工具、
   多一条目录消息）与 persona 的收益混进同一次真机跑就无法归因。skill 接线连同随包路径解析并到 G31。
4. 新增 `spike/headless-real.patch.yml` 的尝试**当场作废并留下结论**：headless profile 的组合里没有
   `@deepseek-ai/dsh-agent-preset-registry`（`--dump-config` 报 `patch insert: entry "@deepseek-ai/dsh-base" not found`），
   旧 `headless-spike.patch.yml` 那套「插进 dsh-base 组」的写法从未命中过——它是 R20 之前的猜测产物。

#### 验收标准

- [x] R6：`--dump-config` 对 `cordis.patch.yml` 与 `spike/web-live.patch.yml` 均 exit 0、0 unmatched，契约文本在合成树里各出现 1/2 次
- [x] **live 前提断言**：新会话（`agentPreset: "autogamer"`）的 wire 里 system 消息 **4052 字符**、
      `You are AutoGamer…` 起于第 **50** 字符，`run_device_action` 与 `report_task_status` 都在 `tools` 里
      ⇒ persona 行虽不在 rc.2 `--dump-config-schema` 名单内，挂载并未 fail-fast（D16 会整条拒绝，表现为工具全没）
- [x] 插件 vitest 62/62 仍绿（本轮零代码改动）
- [x] 重跑真机 spike：T1 **17s / 5 步 / 达成**（基线 77.2s / 6 步）、T2 **22s / 7 步 / 达成且自己收尾**（基线 42.1s / 3 步，上一版插件侧 47 请求失控需人工停止）
- [ ] **重判结果**：接线后模型**依旧不调用 `report_task_status`**——G44 的服从性观察这次前提成立；
      G41 的 `concludeTurn()` live 证据仍缺；兜底追问从未触发，另开 **G46**

### #15 终态闭环：`concludeTurn()` 拿到 live 证据，G44 的兜底追问实证可用（G46 当日撤回）

- **日期**: 2026-10-11
- **状态**: ✅ G41 / G44 关闭；G46 为当日撤回的错误归因
- **优先级**: 高（S2 终态语义是 P0 的最后一块）
- **来源**: 会话日志 `~/.dsh/sessions/--D-DEV-llm-endpoint-probe--/session-{429a5560,ccb9a927}/session.v4.jsonl.zstd` + 临时文件探针（已回退，`grep PROBE dist/` = 0）

#### 问题描述

G45 接线后重跑真机 spike，T1/T2 两轮都"没有调用 `report_task_status`、也没有追问"，据此开了 **G46**
（"未汇报追问在交付形态下从不触发"），并怀疑 `markActed` 用的手镜像访问器 `ctx.agents.currentInitiator()`。

**两条都是错的，根因是取证渠道**：`report_task_status` 带 `concludesTurn`，它若是本轮**最后一个** tool call，
之后不再有模型请求，于是**永远不会出现在任何请求体里**——拿 `proxy-dump.log` 数它就是看不见。
叠加"插件 `ctx.logger` 不进 dsh stdout"（真机动作跑了，但 `[route]`/`[turn]` 各 0 条），
两条无否证力的渠道拼出了一个自洽的假发现。这与同日 G40（按固定 `aria-label` 找发送按钮）是同一类错误。

#### 整改方案与实施

1. **回退猜测**：临时文件探针（`appendFileSync` 打在 `initiator ->` / `event` / `consumeTurn` / `followup` 四个判定点）
   跑一轮真机任务，直接读 `dist/` 确认探针已编译进去，定性后 **`git checkout src/index.ts` + 重新 build**，零残留。
2. **探针结论**：`currentInitiator()` 返回的就是 session id（`initiator -> session-429a5560…`），
   `turn/end` 收得到，`consumeTurn` 判定正确——**G46 不成立，撤回**（登记为撤回条目而非删除，同 G40）。
3. **改读会话日志**（唯一可信渠道）取到两条 live 证据：
   - `session-429a5560`（T1 重跑）：8 次 `run_device_action`（全部用 `{index:N}` 句柄，零坐标回退）
     → `tool/call report_task_status` → **直接 `turn/end {kind:"completed"}`，其后无 `step/start`**
     ⇒ **`concludeTurn()` 真机生效，G41 结案**。
   - `session-ccb9a927`（故意"只截图不汇报"）：turn 1 以文本收尾未汇报 → 会话日志出现
     `user/message` 且 `source {kind:"autogamer", reason:"unreported-turn"}` → `turn/start {turn:2}`
     → 模型在第二轮**调用 `report_task_status`** 并终结 ⇒ **G44 的兜底追问端到端可用**。
4. **守则新增 R24**：判「没发生」只认会话日志；wire 与插件 logger 都无否证力；并记下
   `session.v4.jsonl.zstd` 是 zstd **帧流**，必须用 `stream_reader` 读（`decompress()` 只给第一帧＝1 条记录，
   这正是我一开始误判"会话里没有追问"的第二个坑）。
5. **未解释的残余观察（照实记，不当结论）**：同一份 dist 在 23:12 那个服务实例上两轮都没触发追问，
   在 23:38 / 23:47 两个实例上稳定触发。若再次复现，按新号重开并先查服务实例差异。

#### 验收标准

- [x] 探针代码零残留（`git checkout` + `npm run build`，`grep -c PROBE dist/index.js` = 0，工作树干净）
- [x] **G41 live**：`report_task_status` 的 `tool/call` 之后直接 `turn/end`，无后续 `step/start`（会话日志 `session-429a5560`）
- [x] **G44 live**：未汇报回合被追问（`source.reason:"unreported-turn"` 落进日志）→ 第二轮模型补出 `report_task_status` 并终结（`session-ccb9a927`）
- [x] **G46 撤回**并登记为撤回条目；守则补 **R24**，`registry.md` 同步
- [x] 插件 vitest 62/62 仍绿（本轮无生产代码改动）

### #16 G35：文档门禁脚本的默认文件集不再写死绝对路径

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（顺带修掉一个由它暴露出的自测锚点腐烂）
- **优先级**: 中（门禁不可复现 = 守则形同虚设）
- **来源**: 本机复现（仓库位于其他路径时直接 `FileNotFoundError`）

#### 问题描述

`scripts/check_doc_tables.py` 的 `DEFAULTS` 是七条硬编码 `D:/DEV/autoGamer/...` 绝对路径。
仓库换一台机器、换一个 checkout 位置，门禁脚本本身就跑不起来——而 R6/R9 这些守则的机械判据全靠它。
同目录的 `check_doc_registry.py` 早就用 `ROOT = Path(__file__).resolve().parents[1]` 推导，两者形态不一致。

修它时 `--selftest` 又暴露第二处：**注入锚点写死了 `"| G30 |"`**，而 G30 早已在「已关闭差距拆进 CHANGELOGS」
那轮从 TODO 差距表里移走，于是自测报 `anchor for injection (b) not found - the text moved`。
（这条失败本身是对的——`inject()` 的设计就是「锚点移动就大声失败」，而不是静默跳过；
但它说明**用具体差距编号当锚点会腐烂**，因为差距结案就会从表里删。）

#### 整改方案与实施

1. `DEFAULTS` 改为从 `ROOT` 拼出七条 `Path`；随之把 `unique_flag_for(path)` 从
   `path.endswith("TODO.md")` 改成 `Path(path).name == "TODO.md"`（`Path` 没有 `endswith`），
   `selftest()` 里取 TODO 锚点的那处也改用同一个谓词，不再各写一遍字符串比较。
2. 注入缺陷 (b) 的锚点改成**动态取当前表里第一条 `^| G\d+ |` 行**；取不到就报
   「no gap row to inject into - the gap table moved」。锚点从此不绑定任何具体编号。

#### 验收标准

- [x] 从无关 cwd 调用绝对路径可跑：`cd /c && python -X utf8 "D:/DEV/autoGamer/scripts/check_doc_tables.py"` ⇒ 7 个文件全 `OK:`
- [x] `python -X utf8 scripts/check_doc_tables.py --selftest` ⇒ `SELFTEST: ruler fires on all six injected defects`
- [x] `grep -n "D:/DEV" scripts/check_doc_tables.py` 无命中；`check_doc_registry.py` 门禁仍 OK
- [x] 换锚点后自测仍能抓到「空行把表切断」这一类缺陷（六条全 CAUGHT）

### #17 G32：bundle 补上展示元信息与 icon，插件面板不再回退成技术名

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（英文渲染与 packed file list 两项按官方口径明记为未验，见验收最后两条）
- **优先级**: 中（R19 义务项，且是 G31 真实安装前的前置）
- **来源**: 官方 `packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md:28-55`（"Display metadata and icon" 整节）

#### 问题描述

`package.json` 只有 `name`/`description`，没有 `locale/en.json`、`locale/zh.json`、icon，也没有 `exports`/`files`。
官方口径是：**Plugin Manager 与 Settings 不激活插件就读**导出 locale JSON 里的 `meta.title`/`meta.description`
和导出资源里的 icon；「A Host-only or configuration-only bundle still has a visible inventory entry;
**neither is an exception by itself**」。缺字段的后果是回退——实测就回退了：
面板里我们那行的描述显示成 `package.json.description` 的整段技术文案。

#### 整改方案与实施

1. 新增 `locale/en.json` 与 `locale/zh.json`，各写 `meta.title` + `meta.description`
   （描述讲能力，不讲实现细节；官方禁止「与交付内容无关的模板文案」）。
2. 新增 `icon.svg`（原创，684 字节，远低于官方 256 KiB 上限，且留在包内——
   官方明确「绝对路径、URL、越界符号链接一律拒绝」「仅文件名合规不代表字节能渲染」）。
3. `package.json` 加 `exports`（`.` / `./cordis.patch.yml` / `./locale/*.json` / `./icon` / `./package.json`）
   与 `files`（`dist/**/*.js`、`cordis.patch.yml`、`skills/**/SKILL.md`、`locale/*.json`、`icon.svg`），
   并按官方「package-root 可在 `package.json` 顶层声明 `icon`，它优先于 `./icon`」同时给出顶层 `icon`。
   `./package.json` 一并导出，因为 G31 要用的随包 skill 路径解析正是 `createRequire(...).resolve('<pkg>/package.json')`。
4. **加 `exports` 是有风险的改动**（会限制子路径解析），所以做了 live 复验而非只看声明面。

#### 验收标准

- [x] 静态：三份 JSON 可解析、icon 684 B 且是合法 SVG；R6 对 `cordis.patch.yml` 仍 exit 0 / 0 unmatched；插件 vitest 67/67
- [x] **live 渲染**（新服务实例 + 官方插件面板）：「已安装」区我们那行显示 **`AutoGamer 设备执行`** + 中文能力描述，
      `hasFallbackDesc=false`（旧的 `package.json.description` 回退文案消失），同一行内渲染出我们的 SVG
      （`img.naturalWidth=150`，`atob(src)` 解出 `<svg … viewBox="0 0 64 64" role="img" aria-label="AutoGam…"`）
- [x] **live 挂载未因 `exports` 受损**（R7 新会话 wire）：system 仍 4052 字符、persona 起于第 50 字符，
      工具面仍是 5 个且含 `run_device_action`/`report_task_status`（`plugin_manager` 不在列——D17 那行还没加，符合预期）
- [ ] **未验（照官方口径明记，不宣称成功）**：英文渲染。本机 UI 是中文 locale，只观察到了 `locale/zh.json` 生效；
      `locale/en.json` 仅证明内容合法，未切语言亲眼看过。官方要求是「in English and the user's locale where supplied」。
- [ ] **未验**：packed file list。本机安装是**符号链接到 checkout**（`node_modules/autogamer-device -> D:/DEV/autoGamer/...`），
      官方明说「`files` does not filter a linked directory」，所以 `files` 是否真起作用要等 G31 走一次真实 `install_bundle` 再核。

### #18 G31 引入流：`install_bundle` 端到端走通（用一次性空 bundle 验，不碰在用的）

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（packed file list 一项**证明不了**，理由见验收最后一条，非未做）
- **优先级**: 高（P0 的最后一块「怎么装」）
- **来源**: 官方 `editing-cordis-compositions/SKILL.md:18-52`（两文件 bundle 示例 + 「Install with `plugin_manager`, `action: install_bundle`, `target` set to the **absolute bundle directory**」）、`plugin_manager` 工具自己的 wire schema（action 枚举与 `target` 语义是从我们抓到的请求体里读的，不是猜的）、`packages/boot/plugin-manager/README.md:29-40`

#### 问题描述

交付形态一直靠手工：`dsh plugin add file:`（pnpm 转发垫片，只证明装了不证明生效）+ 启动时 `--patch` overlay。
官方对口径是禁止的：`SKILL.md:10`「Do not write the profile's `package.json` or `cordis.patch.yml` …
**`install_bundle` performs those steps**」、`editing-cordis-compositions:52`「**do not reproduce those steps with shell commands**」。
G45 接线时又留了一项：随包 skill 的根路径当时只能写绝对路径，装到别的机器上就废了。

#### 整改方案与实施

1. **skill 根路径先解决**（`c24ee20`）：抄 shipped `web-app/presets/cordis.patch.yml:134-138` 的官方形态，
   在补丁里用 `!!js` + `createRequire(baseUrl).resolve('autogamer-device/package.json')` 取 dirname 再拼 `skills`。
   `baseUrl` 是宿主注入的 loader 变量，**R6 把 `!!js` 原样打印、也不挂 preset，所以判不了它**——只能 live 证。
2. **再验安装路径**：按官方示例在 `scratch/probe-bundle/`（gitignored）写**只有两个文件**的一次性 bundle，
   声明一个没人选的 inert preset（`probe-noop`），确保即使出问题也影响不到 AutoGamer 会话。
   装之前先对它单独跑 R6（exit 0），避免把一个语法坏的补丁写进 profile。
3. 通过 D17 那行让会话里的 agent 调 `plugin_manager`（`action: install_bundle`，`target` 给绝对目录）。
   本机 Web 会话是用户既设的**完全权限**态，所以没弹审批；这不是我们放宽的（R19）。
4. 验完立刻 `action: remove_bundle` 撤掉，再删 scratch 目录。全程不改我们在用的 bundle。

#### 验收标准

- [x] **安装成功**：工具返回 `{"stage":"enable","target":"@local/dsh-probe-preset","enabled":true,"changed":true,"application":"applied", "packageResult":{"exitCode":0, …}}`
- [x] **注册生效**（官方检查器，非 `dsh plugin list`）：`--profile web --dump-config` 合成树里出现 `- id: preset-probe-noop`；
      profile 的 `package.json` 里 `dependencies` 与 `dsh.profile.bundles` 都加上了该包
- [x] **移除干净**：`remove_bundle` 后 `dependencies` 与 `bundles` 里都没有它，而 `autogamer-device` 原样在位
- [x] **skill 端到端**：`<available_skills>` 列出 `autogamer-flash`；模型调 `skill({name:"autogamer-flash"})`
      拿回 1784 字符正文 + 解析后的 `skill_resources` 基目录 ⇒ bundle 内无绝对路径也能发现并加载随包 skill
- [x] 交付形态与 overlay 两处 preset 一致，由 `tests/deliveryShape.spec.ts` 机械守；插件 vitest 67/67
- [ ] **packed file list 本地证明不了**（不是没做，是**做不到**）：实测 pnpm 把本地目录安装解析成
      `link:D:/DEV/autoGamer/scratch/probe-bundle`，与官方「Local directory installation links the checkout instead …
      `files` does not filter a linked directory」一致。我们在用的 `autogamer-device` 同样是 `link:`。
      ⇒ 要验 `files` 是否真过滤，必须走发布件或 tarball，本轮不假装验过。

### #19 G47：`install_bundle` 的失败回滚与 packed file list，两条都拿到实测

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（顺带钉牢一条 spec 语法与一条残留事实）
- **优先级**: 高（G31 结案时留下的两条「未验」）
- **来源**: 官方源码 `packages/boot/plugin-manager/src/install-spec.ts`（`parseInstallSpec` 全文）与
  `src/index.ts:485-594`（`installBundle` 的快照/回滚出口），加三轮 live 实测

#### 问题描述

G31 结案时明记两条没验：① 失败安装是否真把 profile 的 `package.json`/`pnpm-lock.yaml` 恢复原样；
② `files` 打包清单是否生效（本地目录安装被 pnpm 解析成 `link:`，官方说 `files` 不过滤链接目录）。
本轮把两条都做成了实测，并且**没有发布到任何 registry、也没有 push 仓库**。

#### 整改方案与实施（三个实验，全部用 gitignored `scratch/` 下的一次性包）

1. **失败回滚（官方点名的 `not-bundle` 路径）**：造一个 pnpm 装得上但没有 `dsh.bundle` 的包
   `@local/dsh-not-a-bundle`，`install_bundle` 之。返回
   `{"stage":"install","changed":false,"application":"failed","packageResult":{"exitCode":0,…}}`
   ——pnpm 自己成功了（exitCode 0），是 `installBundle` 在 `manifest?.dsh?.bundle === undefined` 处拒掉的。
   **安装前后对 profile 的 `package.json` 与 `pnpm-lock.yaml` 取 SHA256，两文件完全一致**，
   `dependencies` 与 `dsh.profile.bundles` 都没留下脏条目 ⇒ 源码里 `catch → restoreFiles(files)` 那条出口实测成立。
2. **GitHub 地址形态**：`target` 给 `https://github.com/<不存在的用户>/<不存在的仓库>.git`。
   结果 `application:"failed"`、`changed:false`，pnpm `exitCode:1`，错误输出是
   `Command failed with exit code 128: git ls-remote "git+ssh://git@github.com/…"`
   ⇒ 三点结论：**(a) 普通仓库网页地址被官方接受并路由**（不是 `invalid-spec`）；
   **(b) 一次成功的 git 安装需要一个可达（已 push）的仓库**，push 属用户专属决定（R19），本轮不做；
   **(c) ⚠️ 实测到一个坑**：`https://github.com/…` 会被 pnpm 翻成 **`git+ssh://git@github.com/…`** 去 `ls-remote`，
   本机没有 GitHub SSH 授权时，**连真实公开仓库也可能失败**；`parseInstallSpec` 另外接受显式
   `git+https://…` 形态，将来走这条路要优先用显式 https。
   本例同样完成回滚（两文件 SHA256 不变）。
3. **packed file list**：造一次性包 `@local/dsh-pack-probe`，`files: ["index.js","cordis.patch.yml","kept/"]`，
   另设备选项之外的 `dropped/drop.txt`。`npm pack` 产 tarball（`tar -tzf` 显示只含 4 个文件，`dropped/` 已被过滤），
   再把 **tarball 的绝对路径**交给 `install_bundle`：`application:"applied"`，
   profile 依赖记为 `file:…local-dsh-pack-probe-1.0.0.tgz`（**不是 `link:`**），
   落地树里只有 `cordis.patch.yml` / `index.js` / `package.json` / `kept/keep.txt`，**`dropped/` 不存在**
   ⇒ `files` 白名单端到端生效，且**验它不需要发布件**——`npm pack` 的 tarball 就是过 `files` 的那一步。
4. **顺手钉一条 spec 语法**（`parseInstallSpec` 原文，免得以后再猜）：只认四种形态
   `registry` / `path` / `tarball` / `git`；**本地路径必须绝对**（`a local path must be absolute`，
   `file:`/`link:` 前缀会被剥掉）；git 三种写法 = shorthand `github:|gitlab:|bitbucket:|gist:`、
   `git://`/`git+https://`/scp 式 `git@host:`、普通仓库网页地址 `https://host/user/repo[.git][#ref]`；
   URL 既非 git 亦非 tarball 直接拒（`a URL must point at a git repository or a tarball`）。
   `installBundle` 对 git 形态先跑 `checkGithubConnection`，**只有 network/timeout 才拦**，鉴权与传输回退归 pnpm。

#### 验收标准

- [x] 失败回滚：`not-bundle` 与「不存在的 GitHub 仓库」两例，profile 两文件 SHA256 **前后逐字节相同**，manifest 无脏条目
- [x] packed file list：tarball 安装成功，落地树 = `files` 白名单（`kept/` 在、`dropped/` 无），依赖记为 `file:…tgz`
- [x] 一次性产物全部撤除：`remove_bundle` 后 `@local/dsh-pack-probe` 不在 deps 与 bundles 里，
      `autogamer-device` 仍是 `link:D:/DEV/autoGamer/plugins/autogamer-device` 原样在位
- [x] 官方检查器复核：`--profile web --dump-config` 里 `preset-pack-probe` / `preset-probe-noop` 均已消失
- [ ] **⚠️ 新记一条事实（不是缺陷，是行为）**：**失败的安装与 `remove_bundle` 都会把
      `node_modules/@local/<pkg>` 那个符号链接留在原地**——实测残留过 `dsh-not-a-bundle`（失败装的）与
      `dsh-probe-preset`（上一轮 remove 后源目录已删，链接变悬空），而 `pnpm-lock.yaml` 里 0 处提及。
      与官方 JSDoc「downloaded files can stay」一致。⇒ **G31 说的「移除干净」只在 manifest/lock 层面成立**，
      要清目录得手工删链接（本轮已手工清掉，全部是我自己产生的一次性产物）。
- [ ] **仍缺的证据（明确挂账，不假装）**：一次**成功**的 GitHub 仓库安装。它需要一个已 push 且可达的仓库，
      push 属用户专属决定（R19）；且实测 `https://` 形态会被翻成 `git+ssh://`，真要走通得先解决传输与授权。

### #20 G48：成功的 git 安装拿到证据，`files` 与 `path:` 子目录两问一并解决

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（对 GitHub 走网络那一发另开 **G49**，它需要用户决定）
- **优先级**: 高（#19 留下的「一次成功的 git 安装」缺口）
- **来源**: pnpm 官方 `pnpm add` 文档 "Install from a subdirectory of a Git repository"、
  DSH `install-spec.ts` 的 `parseInstallSpec`、四轮 live 安装

#### 问题描述

#19 只证到「git spec 被接受并路由 + 失败完整回滚」，**从没拿到一次 `application:"applied"` 的 git 安装**。
三件事因此悬着：git 形态到底装不装得上；`files` 白名单在 git 形态下是否还生效（#19 只证了 tarball）；
我们的插件住在 monorepo 子目录 `plugins/autogamer-device`，能不能只装那个子目录。

#### 整改方案与实施

**把「需要 push」这个前提先摘掉**：在 gitignored 的 `scratch/` 里 `git init` 一个本地仓库当真仓库用，
spec 走 `git+file:///…`（`parseInstallSpec` 的 `GIT_URL` 接受 `git+<proto>://`，
`gitHost()` 对 file 协议取到空 host，`checkGithubConnection` 也不拦非 GitHub）。零网络、零第三方代码。

1. **根目录形态**：仓库里放一个完整 bundle。安装返回
   `{"stage":"enable","changed":true,"application":"applied", … "+ @local/dsh-git-probe git+file:///D:/DEV/autoGamer/scratch/git-probe"}`。
2. **`files` 在 git 形态下的行为**：落地树只有 `cordis.patch.yml` / `index.js` / `package.json` / `kept/keep.txt`，
   **`dropped/` 不存在、`.git` 也不存在** ⇒ pnpm 对 git 依赖同样走「按 `files` 打包」这条路。
   ⇒ **#17 里那份 `files` 清单从此是承重的**：`dist/**/*.js`、`cordis.patch.yml`、`skills/**/SKILL.md`、
   `locale/*.json`、`icon.svg` 少写一项，装出去就少一项。
3. **子目录形态**：同一仓库里加嵌套包 `packages/inner/`，spec 用
   `git+file:///…/git-probe#HEAD&path:/packages/inner` ⇒ `application:"applied"`，
   依赖值原样记为该 spec，落地树同样只含白名单文件。
   pnpm 文档给的正是这个语法（`#path:/<subdir>`，多参数用 `&` 组合），
   而 DSH 的 `HOSTED_REPOSITORY_URL` fragment 段是 `#.+$`，**装得下带斜杠的 `&path:`**。
   ⇒ **我们的 monorepo 布局可以从 GitHub 装**：`https://github.com/<owner>/<repo>#<ref>&path:/plugins/autogamer-device`。
4. **踩到一个真坑并定位**：第一次子目录安装被拒——
   `YAMLException: bad indentation of a mapping entry (7:58)`，指向补丁里的 `description` 行。
   根因是**我自己的补丁**：`description: Inert preset used to verify the path: subdirectory spec.`
   含「冒号+空格」却没加引号，YAML 非法。加引号后即通过。
   ⇒ 教训：**补丁里任何带 `: ` 的文本（描述、persona 正文）都要引号包住或用块标量**；
   与 G45 那条「persona 文本禁 `{{}}`」同类——声明面 YAML 的语法陷阱不被 R6 之外的检查兜住。
5. **顺带修正 #19 的一条说法**：这次验证失败后宿主自己打了
   `dsh: restored package.json, pnpm-lock.yaml, and node_modules.`
   ⇒ 被拒的安装**会**连 node_modules 一起还原；#19 看到的残留链接是 `link:`/`file:` 指向我们后来删掉的目录所致，
   不是宿主不清理。

#### 验收标准

- [x] 根目录 git 安装：`application:"applied"`、`changed:true`
- [x] `files` 在 git 形态生效：落地树 = 白名单（`dropped/` 无、`.git` 无）
- [x] `path:` 子目录安装：`application:"applied"`，依赖值原样带 `#HEAD&path:/packages/inner`
- [x] 收尾干净：两个 probe bundle 撤除后不在 deps 与 `dsh.profile.bundles` 里，
      `--dump-config` 里 0 条 probe preset、`preset-autogamer` 在位，`autogamer-device` 仍是原 link；
      一次性仓库与 node_modules 残留已删
- [ ] ~~对 GitHub 走网络的一发仍未做 ⇒ 需要先解决 `https://` 被 pnpm 翻成 `git+ssh://` 的传输选型~~
      **本条的传输判断已被 #21 推翻**：ssh 只是第一次尝试，pnpm 自己回退；真实公开仓库实测走 `git+https://` 且 `exitCode:0`。

### #21 G49 实做：GitHub 发布与 `path:` 子目录都不是障碍，真正的墙是 Windows 符号链接权限

> ⚠️ **本条的根因判断已被后续文档调研推翻（同日，见下方「更正」）**。标题里的「Windows 符号链接权限」
> 是**从一条错误串外推出来的**，不是证据。编号 #21 不变，正文保留原样以便追溯，结论以本块与 TODO 的 G49 行为准。
> 推翻它的三条本地事实：
> 1. profile 里**本来就存在 pnpm 建的跨卷目录符号链接**——`node_modules/autogamer-device -> D:/DEV/autoGamer/plugins/autogamer-device`
>    就是早前 `dsh plugin add file:`（pnpm 转发）建下的。若 Windows 在本机不让建跨卷链接，这条链接不可能在那时成功。
> 2. **`nodeLinker: hoisted` 早就是 profile 的现状**（`profiles/web/pnpm-workspace.yaml` 里写着，
>    `pnpm config get node-linker` 从 profile 目录回 `hoisted`）。⇒ #21 列的「候选②」是**空操作**，
>    我把它当成未试方案推荐了出来。
> 3. 用户级 `C:\Users\78557\.npmrc` 只有一行 `registry=https://registry.npmmirror.com/`，
>    profile 之上也没有杂散的 `pnpm-workspace.yaml`（上游 discussion #1477 记录的那类「pnpm 向上找到 `~` 的
>    `.modules.yaml` 导致 store 版本冲突」的坑，本机**没有**命中）。
>
> **现在能站住的描述只有**：错误原文是
> `ERR_PNPM_EPERM [importPackage C:\…\profiles\web\node_modules\autogamer-device] symlink
> 'D:\DEV\autoGamer\plugins\autogamer-device\node_modules\.pnpm\@deepseek-ai+cordis@4.0.4\…' -> 'C:\…'`
> ——**符号链接的源指向我们仓库自己的 `node_modules/.pnpm`**，而当时 **dsh 服务正在运行并加载着这个包**，
> 且 pnpm 输出里有 `Packages: +17 -1`（要换掉同名旧依赖）。
> ⇒ 未定的候选收敛为两类，且**都还没做判别实验**：
> (a) Windows 的「文件被占用」型 EPERM（运行中的服务锁住同名包目录，替换失败）；
> (b) 同名 `link:` 依赖被 git 依赖就地替换时，pnpm 把旧链接目标的 store 路径带进了新解析。
> 下一步按 **守则 R25** 的要求：先读机制文档定判别实验的设计，**一次只测一个变量**，不许连环试。


- **日期**: 2026-10-12
- **状态**: ✅ 缺口已定性（障碍换了地方，未修）
- **优先级**: 高（它决定「用户怎么装」这条交付路径能不能成立）
- **来源**: 三轮 live 安装（公开示例仓库 / 我们 push 后的仓库）+ `git ls-remote` 对照实验

#### 问题描述与**一条被推翻的错误归因**

#20 里我写了一句：「`https://github.com/…` 会被 pnpm 翻成 `git+ssh://git@github.com/…`，
本机无 GitHub SSH 授权时**连真实公开仓库也会失败**」。**这句是错的**，来源是把两个不相干的观测
拼成了一条因果：那个 `git+ssh` 报错出自**不存在的仓库**，我据此外推到公开仓库。

对照实验直接否证：
- `git ls-remote https://github.com/octocat/Hello-World.git HEAD` ⇒ 通（拿到 sha，rc 0）。
- `git ls-remote git+ssh://git@github.com/octocat/Hello-World.git HEAD` ⇒ `port 22: Connection refused`。
- **但走 `install_bundle`**：`https://github.com/octocat/Hello-World.git` ⇒ pnpm `exitCode:0`、
  `downloaded 1, added 1`，解析值是 **`git+https://github.com/octocat/Hello-World.git`**，
  最后只因 `error.code:"not-bundle"` 被 DSH 拒。
⇒ **ssh 只是第一次尝试，回退由 pnpm 负责**——官方 JSDoc 那句
「only network failures or timeouts stop installation, while **pnpm owns authentication and transport fallback**」
说的就是这个，我先前读了这句话却没把它跟观测对上。

#### 实做与真正的障碍

1. 按用户授权把 `main` push 到公开 fork `giveUphope/autoGamer`（`759af78..a4a0f44`）。
   push 前做了泄露自查：`.env` 未被跟踪、看着敏感的 11 个文件全是应用源码（凭证校验器 / token meter /
   helper 的 TokenReceiver），45 个未推提交的 diff 里 0 处 token 形态字符串、0 个转储或 cookie 文件。
2. `install_bundle` target=`https://github.com/giveUphope/autoGamer#main&path:/plugins/autogamer-device`。
   pnpm **成功抓取仓库并解析出子目录**（`resolved 17, downloaded 4, added 15`，还会 `-1` 换掉旧的 link 安装），
   然后死在：
   `[ERR_PNPM_EPERM] [importPackage C:\Users\…\node_modules\autogamer-device] EPERM: operation not permitted,
   symlink 'D:\DEV\autoGamer\plugins\autogamer-device\node_modules\.pnpm\@deepseek-ai+cordis@4.0.4\…' -> 'C:\Users\…'`
   ⇒ **障碍是 Windows 跨卷创建符号链接的权限**（D: → C:），与 GitHub、与 `path:` 语法、与传输都无关。
3. **回滚第三次被观察到**：失败后 profile 的 `dependencies.autogamer-device` 仍是
   `link:D:/DEV/autoGamer/plugins/autogamer-device`、`dsh.profile.bundles` 未变、
   `node_modules/autogamer-device` 符号链接原样在位、`--dump-config` 里 `preset-autogamer` 仍合成。

#### 结论与下一步（**未修，只是定性**）

- 「发布到 GitHub + 子目录」这条路**语法与传输都成立**，#20 定死的地址形状不用改。
- 要装通得先解决 pnpm 的符号链接权限，候选（**都还没测，不许当结论**）：
  开 Windows 开发者模式或以具备权限的身份运行；给 profile 配 `node-linker=hoisted` 之类不走符号链接的布局；
  或让 profile 与仓库同卷。**下一条做哪个要先定，别又写成猜测实现（R20/R22）。**

#### 验收标准

- [x] 公开仓库经 `install_bundle` 抓取成功（`exitCode:0`，解析为 `git+https://…`），仅因 `not-bundle` 被拒
- [x] 我们 push 后的仓库经 `#main&path:/plugins/autogamer-device` 被正确解析并进入导入阶段
- [x] 障碍定位到 `ERR_PNPM_EPERM` 的跨卷符号链接，且**给出完整错误原文**
- [x] 失败后 profile 三处状态（deps / bundles / 符号链接）与 `--dump-config` 全部原样
- [ ] 权限方案未选定、未验证 ⇒ 交付路径仍不能宣称可用

### #22 G49 根因确认：不是权限也不是传输，是「同名旧链接被 importPackage 顺着走」；同时暴露真正的交付阻塞

- **日期**: 2026-10-12
- **状态**: ✅ G49 结案；**另开 G50**（git 依赖不含构建产物 ⇒ 装出来的 bundle 不可用）
- **优先级**: 高
- **来源**: 三次单变量实验（bundled pnpm 11.7.0，服务停启各一次）+ 磁盘 reparse 属性检查

#### 问题描述与结论

#21 的「更正」把四条候选排除了三条（push / 传输 / Windows 权限 / 用户级配置），剩 (a) 服务占用、(b) 同名依赖就地替换。
本轮按 R25 一次只动一个变量地跑完，结论是：

- **(a) 否证**：**停掉 dsh 服务**后跑同一条命令，报错**逐字相同** ⇒ 与进程占用无关。
- **(b) 成立**，但我上一轮那次「否证 (b)」**是无效的**——我当时只 `pnpm remove` 了 manifest 条目，
  而 **`node_modules/autogamer-device` 那个 junction 仍在磁盘上**（正是 #19/#21 记的「remove 不删链接」行为），
  变量根本没变。用 `os.lstat` 确认它是 reparse point（`st_file_attributes = 0x410` = DIRECTORY|REPARSE_POINT）、
  用 `os.rmdir` **只删链接不碰目标**（删后核对仓库仍 17 项）之后，同一条 spec 立刻
  `Packages: +17 … added 17, done`、**exit 0**。
- **机制**：pnpm 的 `importPackage` 会**顺着这个 junction 走进我们的开发工作区**，把仓库自己的
  `node_modules/.pnpm` 一起纳入，然后在目标路径重建里面的符号链接 → Windows 拒绝 → `ERR_PNPM_EPERM`。
  错误里那个「源指向 `D:\DEV\autoGamer\plugins\autogamer-device\node_modules\.pnpm\…`」就是这么来的。
- ⇒ **对真实用户（干净机器、没有源码 link 安装）这条路径本来就是通的**；
  我们踩的是**开发机特有**的状态：同一个包先被 `link:` 装过，再换成 git 装。

#### 顺带暴露的、更要紧的交付阻塞（→ G50）

装成功之后核对落地的树：`README.md`、`cordis.patch.yml`、`icon.svg`、`locale/{en,zh}.json`、`package.json`、
`skills/autogamer-flash/` 都在，`src`/`tests`/`spike`/`node_modules` 被 `files` 正确过滤——
**但 `dist/` 不存在**，`dist/index.js` 缺失。
原因：git 依赖只含**已提交**的文件，而 `dist/` 是构建产物、被 gitignore；`package.json` 里又**没有 `prepare`/`prepack` 脚本**，
没人会在检出后编译。⇒ **pnpm 层面 `exit 0` 不等于 bundle 可用**。三条候选出路（**都未验证，别当结论**）：
`prepare` 脚本（会与 DSH 的构建脚本审批 `approvedBuilds` 相互作用）、提交 `dist/`（不干净）、
或走 #19 已证可用的 **tarball 路线**（`npm pack` 从已构建的工作目录取文件，天然带 `dist/`）。

#### 环境还原（本轮把开发态改动了两次，全部复原）

- 撤掉 git 安装；`dsh plugin add file:` 恢复时记录值变成 `file:` 且**落地成实体拷贝**（`readlink` 失败、无 reparse 位），
  那样改 `src/` 不生效 ⇒ 删掉拷贝、用备份把 `package.json`/`pnpm-lock.yaml` 逐字节还原成 `link:`、
  再 `pnpm install` 重建，最终核对：`autogamer-device` 是 reparse point 且 `src/index.ts` 可透过它访问、
  仓库 17 项完好、工作树干净、服务重启无错误、`--dump-config` 里 `preset-autogamer` 正常合成。

#### 验收标准

- [x] (a) 否证：服务停止后同一命令报错逐字相同
- [x] (b) 成立：清掉同名 junction 后 `added 17, done`、exit 0
- [x] junction 身份由 `st_file_attributes` 判定，删除用 `os.rmdir`，删后核对仓库完整
- [x] 开发环境精确还原（`link:` 值 + reparse point + 仓库与 git 状态无损）
- [x] 新阻塞有实测清单（`dist/` 缺失、`src/tests/spike/node_modules` 被正确过滤）
- [ ] G50 的三条候选出路未验证 ⇒ 交付形态选哪条要先读文档再定（R25）

### #23 G50 结案：tarball 路线端到端可用（`dist/` 天然在内），git 路线的代价是构建脚本授权

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（路线定稿；GitHub Release 那一发留成用户决定项）
- **优先级**: 高（它决定「别人怎么装到一个能跑的 bundle」）
- **来源**: 本机 `npm pack` + 一次完整「安装 → 加载 → 真机往返」；官方 `plugin-manager/README.md:50,54,64`、`references/host-plugin.md:7`、`install-spec.ts` 的 tarball 分支

#### 问题描述

#22 发现：从 GitHub 装出来的 bundle pnpm 层面 `exit 0`，但落地树**没有 `dist/`**——git 依赖只含已提交文件，`dist/` 是构建产物且被 gitignore，`package.json` 又没有 `prepare`/`prepack`。⇒ 「装成功」不等于「可用」。

#### 整改方案与实施（按 G50 方案的顺序，先做零发布的那一发）

1. **打包**：`npm run build` 后 `npm pack`，产出 20 个文件。实测清单：`dist/` 14 个 js（含 `dist/index.js` 9.5 kB）、`skills/autogamer-flash/SKILL.md`、`locale/{en,zh}.json`、`icon.svg`、`cordis.patch.yml`、`package.json`、`README.md`；`src/`、`tests/`、`spike/`、`node_modules/` **全部被 `files` 正确过滤**。⇒ tarball 从**已构建的工作目录**取文件，`dist/` 天然在内，不需要任何构建脚本授权。
2. **安装**：先按 #22 清掉同名 junction，再 `pnpm add <绝对路径 .tgz>` ⇒ `Packages: +17 … added 17, done`、exit 0，依赖记为 `file:…tgz`；落地树核对 `dist/index.js` 在、`skills/…/SKILL.md` 在、`src/` 不在。
3. **真加载**（这步才算「可用」）：起服务跑一条真机会话 ⇒ 工具面 7 个（`run_device_action`/`report_task_status`/`skill`/`plugin_manager`/`job_*`）、persona 契约在 system、`<available_skills>` 在上下文；会话日志显示 `run_device_action` 返回**带图片附件** → `turn/end` → **G44 的追问真的驱动出第 2 轮** → 模型补 `report_task_status` → 第 2 轮 `turn/end`。⇒ **packed 形态与开发态行为一致**，这是对交付形态最强的验证。
4. **还原**：撤掉 packed 安装、删实体目录、用备份把 `package.json`/`pnpm-lock.yaml` 还原成 `link:`、`pnpm install` 重建，核对 reparse point 恢复且 `src/index.ts` 可透过链接访问。

#### 路线定稿

| 路线 | 结论 | 依据 |
|---|---|---|
| **③b GitHub Release 资产 tarball 的 URL** | **选它作为对外交付形状** | `parseInstallSpec` 把 `https://…x.tgz` 判成 `tarball` 并带 host ⇒ 地址可分享；`dist/` 天然在内；无需构建授权 |
| ③a 本机 tarball | 已验通（本条），作为发布前自检 | 同上 |
| ① `prepare` 脚本（git 自构建） | **不默认选** | 代价是每次都要用户批构建脚本：README:64「can grant permission … **after the user approves those scripts in the conversation**」「Approval … **permits commands with the host user's permissions**」；且 `host-plugin.md:7` 的官方取向是 bundle「needs no … install scripts, or build tool」 |
| ② 提交 `dist/` | 兜底，不推荐 | 与 README:50「Prepare the checkout with `pnpm install` and `pnpm run build`」暗示的开发态习惯冲突，且污染仓库 |

#### 验收标准

- [x] `npm pack` 清单含 `dist/index.js` 与 `skills/**/SKILL.md`，`src`/`tests`/`spike` 被过滤
- [x] `pnpm add <tgz>` ⇒ `added 17, done`、exit 0；落地树三事实核对（dist 在 / skills 在 / src 不在）
- [x] 服务加载 packed 拷贝：7 工具 + persona + `<available_skills>`，真机动作返回图片附件
- [x] 终态链路在 packed 形态下同样成立（未汇报 → 追问 → 第 2 轮补汇报 → 回合终结）
- [x] 开发环境精确还原（`link:` + reparse point + 工作树干净）
- [ ] **③b 的 GitHub Release 那一发未做**：`gh release create` 是 GitHub 端写操作，按 R19 留给用户决定

### #24 G50 ③b 落地：Release 资产发布并从 URL 装通；顺带挖出两个环境级陷阱

- **日期**: 2026-10-12
- **状态**: ✅ ③b 验通；另开 **G51**（本机 Node TLS 信任被本地代理接管）
- **优先级**: 高（交付路径的最后一发）
- **来源**: 一次真实发布 + 一次真实 URL 安装；`gh`/`openssl`/`node fetch` 三方对照

#### 做了什么

1. **发布**：`gh release create autogamer-device-v0.1.0 … --prerelease` ⇒
   `https://github.com/giveUphope/autoGamer/releases/tag/autogamer-device-v0.1.0`，
   资产 `autogamer-device-0.1.0.tgz` 24,162 B。**发布前自查**：无密钥（唯一 `token` 命中是 README 里
   「含 token 的别提交」这句说明）；绝对路径只在 `README.md:37` 的 CLI 示例里，而该文件**本就随仓库公开**；
   **真正会执行的 `cordis.patch.yml` 里 0 处本地绝对路径**。
2. **匿名取回核对**：`gh release download` 取回的字节与我们打包的 **SHA256 逐字节相同**
   （`f978d03cc8ae56fcf9b75c1e…`）。注意 `releases/latest` 端点**故意排除 prerelease**，
   按 tag 查才有——第一次用 `latest` 拿到 404 不是没发布。
3. **从 URL 装通**：`pnpm add <那条 URL>` ⇒ `Packages: +17 … added 17, done`、exit 0，
   `dist/index.js` 在、`skills/…/SKILL.md` 在、`src/` 未泄漏，依赖值就是这条 URL；
   起宿主加载这份安装 ⇒ **0 启动错误**（资产与 #23 已验通的本地 tarball 哈希相同，故不再重跑整轮会话）。

#### 途中挖出的两个陷阱（都跟 DSH 无关，但都会咬人）

**① `gh` 把仓库解析成了上游 `google/artemis`。** 第一次 `gh release create` 报
「Failed to create release, `workflow` scope may be required」，而 `gh auth status` 显示 token **本来就有 `workflow`**——
提示是 gh 的通用猜测，真因是本仓库同时挂了 `origin=giveUphope/autoGamer` 与 `upstream=google/artemis`，
`gh repo view` 默认解析到的是 **upstream**，那次请求打的是**别人的仓库**（因无写权限而失败）。
**已核对上游 0 releases、0 相关 tag，没被写入任何东西。** ⇒ 立守则 **R26**：`gh` 的写操作一律显式 `--repo`。

**② 本机 Node 的 TLS 信任被本地中间代理接管。** 用 URL 装第一次直接 `TypeError: fetch failed`，
完整原因是 `unable to verify the first certificate; … try running Node.js with --use-system-ca`，
而 `openssl s_client` 显示 `api.github.com` 的证书签发者是
**`CN=SteamTools Certificate, O=BeyondDimension`**——本机跑着 TLS 拦截型网络工具，它把根 CA 装进了
**Windows 证书库**，所以 `git`/`gh` 能过，Node 用自己的 CA 列表就不过；`registry.npmmirror.com` 不受影响。
⇒ 解法是 Node 官方开关 **`--use-system-ca`**（实测加上后两个 URL 都 200、安装 exit 0），
**不是** `NODE_TLS_REJECT_UNAUTHORIZED=0`——那等于关掉校验，本仓库明确不用这种"修法"。
这条记成环境前置 **G51**。

#### 验收标准

- [x] Release 与资产存在，按 tag 可查；资产字节与本地打包 **SHA256 相同**
- [x] 发布前泄露自查完成（密钥 0、绝对路径仅在本已公开的 README 示例、`cordis.patch.yml` 干净）
- [x] `pnpm add <URL>` ⇒ `added 17, done` exit 0，落地树三事实核对通过（dist 在 / skills 在 / src 不在）
- [x] 宿主加载 URL 安装出来的 bundle：0 启动错误
- [x] 上游未被误写（0 releases、0 相关 tag）；开发环境精确还原（`link:` + reparse point + `src` 可达 + 工作树干净）
- [x] 两个陷阱都落到台账：R26（`gh` 显式 `--repo`）与 G51（Node TLS 信任）

### #25 G51 复验：TLS 前置在 DSH 自己的 install_bundle 路径上成立，并顺带暴露一个自举死结

- **日期**: 2026-10-12
- **状态**: ✅ G51 结案（前置已写进 README）；⚠️ 记一条**未获得**的证据与一个结构性死结
- **优先级**: 中（环境前置 + 交付路径的可用边界）
- **来源**: 两次真实 DSH 侧 `install_bundle`（带/不带 flag 各一次）、`operations.ts:315` 与
  `subprocess/src/index.ts:66-80` 源码核对

#### 问题描述

#24 的 URL 安装是**我直接用 pnpm 跑的**，没走 DSH 的 `install_bundle`。G51 因此留了两件事：
把 TLS 前置变成可交付说明；以及确认**宿主自己**在这台机器上装不装得动。

#### 机制核对（源码，非推断）

`operations.ts:315`：`const environment = { ...(options.execution === 'cli' ? process.env : scrubbedParentEnv()), ...options.env }`
——CLI 继承环境、服务路径先洗环境。而 `scrubbedParentEnv()`（`subprocess/src/index.ts:66-80`）
只剔除匹配 `/KEY|PASSWORD|SECRET|TOKEN/i` 的名字与 `DSH_*` 前缀，**`NODE_OPTIONS` 不在其中**
⇒ 只要宿主进程自己带着它启动，pnpm 子进程就能继承。这条决定了 README 该怎么写：是**启动前置**，不是随包配置。

#### 两次实测

1. **不带 flag**（宿主默认环境）：`plugin_manager install_bundle <Release URL>` ⇒
   `application:"failed"`、`changed:false`，pnpm 输出
   `[WARN] HEAD … error (UNABLE_TO_VERIFY_LEAF_SIGNATURE). Will retry in 10 seconds. 2 retries left.`
   ⇒ **DSH 自己的路径同样被本机 TLS 信任卡住**，与 #24 的 pnpm 直跑结论一致，不是推断。
2. **带 `NODE_OPTIONS=--use-system-ca` 启动宿主**：同一发 ⇒ **签名验证错误消失**，
   改报 `ERR_PNPM_MISSING_TARBALL_INTEGRITY`（lockfile 条目没有 integrity 字段）。
   这个新错误**是我自己造成的**：前一轮反复倒换 profile 的 `package.json`/`pnpm-lock.yaml` 备份，
   留下了与 URL 对应的无 integrity 条目。
   ⇒ 诚实结论：**Test B 只证明「TLS 这一层被 flag 解决」，没有拿到一发干净的 DSH 路径全流程成功**。

#### 顺带挖到的结构性死结（交付路径的边界，值得记）

> ⚠️ 本节「死结」的说法**被 #26 收窄**：自举的起点是官方 Creator preset（它本来就带 `plugin_manager`），
> 不需要我们的 bundle 先存在；真正剩下的只是「同一 preset 内自装同名新版本会撞 #22 的旧 junction」。

要让 agent 用 `plugin_manager` 自装**同一个包**，前提是 `plugin_manager` 已经在会话里——
而它由我们的 preset 提供，preset 又依赖这个 bundle 已安装。叠加 #22 的结论
（同名旧 `link:` junction 会让 `importPackage` 走进开发工作区并报 `EPERM`），得到：
**在开发机上「agent 自装同名新版本」这条路天然别扭**——先清 junction 就没工具可用，不清就撞 EPERM。
⇒ 真实用户不受影响（首装走 Web 面板或 `install_bundle`，那时没有同名旧链接）；
但这条边界要写进文档，别把自举说成无条件可用。

#### 收尾与验收标准

- [x] 机制有源码出处（`operations.ts:315` + `scrubbedParentEnv`），不是猜测
- [x] 不带 flag 的 DSH 路径失败有**错误原文**（`UNABLE_TO_VERIFY_LEAF_SIGNATURE` + 两次重试）
- [x] 带 flag 后 TLS 错误消失（换成另一个由我 own 的脏 lock 造成的错误，已如实归因）
- [x] README 装上「⚠️ 本机 TLS 前置」段：启动带 `--use-system-ca`，并**明确禁止**用 `NODE_TLS_REJECT_UNAUTHORIZED=0`
- [x] profile 清干净：`pnpm-lock.yaml` 无 URL 残留条目、`autogamer-device` 回到 `link:` 且 `src/index.ts` 可透过链接访问
- [ ] **未获得**：一发从零开始、走 DSH `install_bundle` 的完整成功安装（需要干净 profile 或换机器验证）

### #26 「plugin_manager 不是 DSH 自带的吗，为什么要我们提供」——查完发现我写错了一个开关

- **日期**: 2026-10-12
- **状态**: ✅ 问题澄清 + **修掉 D17 落地的一个真实隐患** + 更正 #25 的一处过度陈述
- **优先级**: 高（隐患会让整条 preset 在非 profile-backed 启动下被拒挂）
- **来源**: `packages/bundle/base/cordis.patch.yml:16-22` 与其头部注释、`packages/bundle/web-app/presets/cordis.patch.yml`、本机 rc.2 `--dump-config` 转储、`plugin-manager/README.md`

#### 问题的直接回答：是我们理解偏了，但偏的方向有讲究

`plugin_manager` **确实是 DSH 自带的**，两样东西都在 `dsh-base` 里随包出货：

```yaml
# packages/bundle/base/cordis.patch.yml
- id: tool-plugin-manager
  name: '@deepseek-ai/dsh-plugin-manager/tools'
  disabled: true                      # ← 工具行：基线给的是「关」
- id: plugin-manager
  name: '@deepseek-ai/dsh-plugin-manager'
  disabled: !!js "!ctx.get('profileContext')"   # ← 服务行：只在 profile-backed 时开
```

我们 preset 里那一行**不是「提供这个功能」，而是「拨我们自己的开关」**。为什么每个 preset 都要各自写一遍——
base 补丁的头部注释给了官方理由：「A patch replaces the targeted row's whole `config` rather than merging into it,
so **a row whose value differs by mode does NOT live here: it belongs to each mode bundle** …
**each mode bundle restates its complete configuration**」。
本机 rc.2 转储对得上：`preset-standard` / `preset-ptc` 各自重述 `disabled: true`，
而 Creator 用的 `preset-cordis` 重述成 `disabled: !!js "!ctx.get('profileContext')"`；
README 那句「Preset-backed sessions use their preset's `tool-plugin-manager` entry」就是这个设计的收口。

#### 顺着这个问题查出的**真隐患**（已修）

D17 落地时我写的是 `disabled: false`——**无条件开**。但服务行自己是有条件的
（`!ctx.get('profileContext')`），而 tools 行要注入 `ctx.pluginManager`（`docs/tool-catalog.md` 那行列出
`ctx.tools`, `ctx.pluginManager`, `ctx.sandboxPolicy`）。⇒ 在**没有 profileContext 的启动**里，
服务是关的、我们的工具行却要它，而 **缺服务会 fail-fast 拒掉整条 preset 挂载（D16）**——
不是这个工具没了，是**整个 AutoGamer preset 挂不上**。

修法就是照抄官方 Creator 的形状，让工具行**跟着服务的条件走**：

```yaml
- id: tool-plugin-manager
  name: "@deepseek-ai/dsh-plugin-manager/tools"
  disabled: !!js "!ctx.get('profileContext')"
```

两份 YAML 同步改（`cordis.patch.yml` 与 `spike/web-live.patch.yml`），并留下注释说明**为什么不能写 `false`**。

#### 同时更正 #25 的一处过度陈述

#25 说「agent 用 `plugin_manager` 自装同名包」存在结构性死结。这句话**只对「用我们自己的 preset」成立**：
Creator preset（`preset-cordis`）本来就带着这个工具，所以**在 Creator 会话里 agent 可以装我们的 bundle，
不需要我们的 bundle 先存在**——自举的起点是官方就有的，不是我们提供的。
真正剩下的边界只有一条：在**同一个 preset 内**自装同名新版本时，#22 那个旧 `link:` junction 仍会撞 `EPERM`。

#### 验收标准

- [x] 声明面：两份 patch 各跑 `--dump-config` ⇒ exit 0、0 unmatched；合成树里我们的行是
      `disabled: !!js '!ctx.get(''profileContext'')'`（与 Creator preset 逐字同形）
- [x] 一致性：`tests/deliveryShape.spec.ts` 3/3 绿（两处 preset 仍同形）
- [x] **live 复验修正没有关掉能力**：web profile（profileContext 存在）新会话工具面仍是 **7 个、含 `plugin_manager`**，宿主 0 启动错误
- [x] #25 的过度陈述已在本条更正，并写清自举的真实起点在 Creator preset

### #27 G5 的副产品：装上真实 DSH 包之后，手镜像的附件引用类型被 tsc 照出来了

- **日期**: 2026-10-12
- **状态**: ✅ 已修（类型层；运行时从未坏过）
- **优先级**: 中——不炸线上，但它是守则 **R21** 明确禁止的那类断言：手抄的宿主类型会随上游静默失真
- **分类**: 四 · DSH 插件轨道

#### 问题描述

G5 Tier 1 要给插件加 4 个真实 `@deepseek-ai/*` devDeps（`dsh-system-prompt` / `dsh-invariants` / `dsh-agent` / `dsh-attachment`）。加完 `npx tsc --noEmit` 从 **0 错** 变成 1 错：

```
src/tools/runDeviceAction.ts(248,7): error TS2322
  ... Type '{ type: "image"; attachment: DshImageAttachment; }' is not assignable to type 'ImageBlock'.
    The types of 'attachment.attachmentId' are incompatible between these types.
      Type 'string' is not assignable to type 'AttachmentId'.
        Type 'string' is not assignable to type '{ readonly [BRAND]: "AttachmentId"; }'.
```

根因在 `src/dsh-types.ts`：`DshImageAttachment` 是**手镜像**，文件头当时的说法是 "DSH ships no type declarations (dist JS only, verified)"。真实声明是 `@deepseek-ai/dsh-attachment` `lib/types/types.d.ts:7` 的 `ImageAttachmentRef`——字段逐个对得上，唯独 `attachmentId` 是品牌类型 `AttachmentId`（`brandString`，仅编译期存在），我们抄成了 `string`。

为什么以前不报：这条品牌在依赖没装齐时无法解析，tsc 把它当宽松类型放过；真包一到，品牌可解析，冲突立刻露出来。**基线实测**（不是推断）：`git stash` 掉 `package.json`/`pnpm-lock.yaml` 后 `pnpm install --frozen-lockfile` + tsc = 0 错，恢复后 = 1 错。

运行时没有受损：`attachmentId` 我们只透传、从不解析（`src/index.ts:182` 的 `saveScreenshot`），所以这是纯类型缺陷。但「抄错一个品牌」正是 G5 要消灭的那种手镜像——上游一升级就变成假的安全感。

#### 整改方案与实施

- `plugins/autogamer-device/src/dsh-types.ts`：`DshImageAttachment` 从自写 interface 改为**真类型的别名**——`import type { ImageAttachmentRef, SaveImageAttachment } from "@deepseek-ai/dsh-attachment"`；`DshAttachments.saveImages` 直接用真签名 `readonly SaveImageAttachment[] → Promise<readonly ImageAttachmentRef[]>`（原镜像的入参形状与真 `SaveImageAttachment` 逐字段相同，行为不变）。
- 同文件头注释改成「两类条目」规则：**凡是公开 `@deepseek-ai/*` 包能声明的，一律 import 不手抄**；只有在 Host 里才看得到的形状才允许手镜像，且必须带版本与出处。旧的「DSH 不发类型」陈述已经作废——包内带 `lib/types/**/*.d.ts`，公开 registry 可取。
- 调用点零改动：`DshImageAttachment["mediaType"]` 的索引访问在别名上仍成立，`runDeviceAction.ts` 四处引用原样。

#### 验收标准

- `cd plugins/autogamer-device && npx tsc -p tsconfig.json --noEmit` ⇒ 0 error
- `npm run build && npx vitest run` ⇒ 75 passed / 1 skipped（skipped 是 `AUTOGAMER_CONFORMANCE_PY=live` 的 opt-in 分支）
- 证伪口径（证明是修好而不是绕开）：把 `DshImageAttachment` 换回 `attachmentId: string` 的手镜像 ⇒ 上面那条 TS2322 立刻回来

### #28 G5 落地后的测试复审：生成的 fixture 里躺着一条错事实

- **日期**: 2026-10-12
- **状态**: ✅ 已修（抽取器 + 三条新守卫 + 两处被证伪的陈述）
- **优先级**: 高（不是格式问题——是**自动化契约测试锁定了一个与自家文档矛盾的事实**）
- **分类**: 四 · DSH 插件轨道
- **来源**: 本轮测试复审子代理报告，逐条自己复核后才动手

#### 问题描述

Tier 2 把旧控制台 SSE 契约改成从源码抽取，抽出来的 `sse-events.json` 写着：

```
frontendSubscribesButServerNeverEmits: ["checker_event"]
```

即「前端订阅 `checker_event`，服务端从不发射」——**假的**。发射点在
`artemis/graph/checkpoints.py`：

```python
CHECKER_EVENT = "checker_event"                                  # :72
publish = getattr(engine, "_publish", None)                      # :166
publish(CHECKER_EVENT, {"ts": now, ...})                         # :174
```

callee 是 `getattr` 绑定的**别名**，首参是**模块常量**——抽取器两个条件都不满足，
于是这个事件根本没进 `serverEventNames`，反过来掉进「死信道」差集。
`docs/migration/inventory/05-frontend-integration.md` 第 41 行早就写明 `checker_event`
是活的（"走通用日志分支入 sessionLogs …二期 Checker 重写时是事件基线"）。

三重放大：① `contracts.spec.ts` 把这条错事实**断言锁定**；② 脚本头注释写着
"会响不会静默漏"，而 `findUnreviewedEmitters` 同样只认字面量首参，对这条**一声不响**；
③ 更结构性的一条——测试是「fixture 对同一个生成器」比，生成器少认一个漏斗时两边一起错，
测试恒绿。

同轮另有两处同类：`contracts.spec.ts` 里 `expect(buildFixture(realTools).pyActionServerTools).toEqual(realTools)`
是自己比自己（恒成立，`56a7996` 已修）；测试注释与 `3507d5c` 提交信息都写「CI 用
`spike-mcp.mjs` 做同一比对」，而 `ci.yml` 里**根本没有那一步**——假出处陈述。

#### 整改方案与实施

- `plugins/autogamer-device/scripts/gen-sse-events.mjs`：抽取从「认字面量」升级为**先解析再匹配**——
  `readConstants`（仓库级 `NAME = "literal"` 常量表）、`readAliases`（`alias = getattr(obj, "<funnel>")`）、
  `CALL_PATTERN`（首参允许字面量或全大写常量）；`findUnreviewedEmitters` 改用同一解析，
  解析不出漏斗的发射形态一律报告；新增 `namesByEmitter` 导出每个漏斗的贡献名字集合。
- `tests/fixtures/sse-events.json` 重新生成：服务端 **25 → 26**（`checker_event` 归位），
  反向死信道由 1 → **0**；notes 里那句「死信道是双向的」随实测改掉（现在是「前端订阅的 17 项
  全部有真实发射方」）。
- 三条新守卫补上「生成器坏了要能红」这一环（`contracts.spec.ts`）：
  ① 服务端事件名数量地板 `>= 20`；② `namesByEmitter()` 的键集合必须恰为三个已核实漏斗、
  **每个至少贡献 1 个名字**、且其名字都在 `serverEventNames` 里；③ `findUnreviewedEmitters()` 为空。
- 覆盖空洞补上：`compare_ui_frames`（G39 路线 A）是 `src/index.ts:174` **直接调用**、不在
  `ACTION_TO_PY_TOOL` 里，此前任何断言都不覆盖它。新增测试从 `src/**/*.ts` 抽出
  `client.callTool("<literal>")` 全集，既断言等于已知清单（新增直接调用必须显式登记），
  又断言每个都在记录的 py 面上。
- 方向补全：`inject` 此前只被证明「声明的服务本图都有」（多写会红），**少写不红**——
  新增 `declares every Host service its own code touches`，从 `src/**/*.ts` 扫 `ctx.<name>`
  消费面（扣掉 cordis 内建），断言等于 `inject` 声明面。
- 两处假陈述就地更正：测试注释与 README 改为「live 比对是本地 opt-in
  （`AUTOGAMER_CONFORMANCE_PY=live` 或 `node scripts/spike-mcp.mjs`），CI 不做」。
- 共用一个 `tests/support/srcFiles.ts` 的递归枚举，避免两份 spec 各写一遍遍历
  （新增源文件时必须一起被看见）。

#### 验收标准

- `node plugins/autogamer-device/scripts/gen-sse-events.mjs` ⇒ `fixture matches the sources (26 server / 17 frontend names)`，exit 0
- `node -e "...namesByEmitter()..."` ⇒ `_publish 14 / _broadcast_event 9 / _record_llm_event 5`；`findUnreviewedEmitters()` ⇒ `[]`
- `cd plugins/autogamer-device && npx vitest run` ⇒ **78 passed / 1 skipped**；`npx tsc --noEmit` ⇒ 0 error
- 变异校验（三条新守卫各自会红，均已实做）：
  从 `EMITTERS` 摘掉 `_record_llm_event` ⇒ 数量地板与键集合两条同红；
  把 `callTool("compare_ui_frames")` 改名 ⇒ 直接调用清单红；
  从 `inject` 摘掉 `attachments` ⇒ 消费面对账红

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
| G45 | 交付 preset 没有指令投递行，flash 契约从未进过模型 | `persona` 行（`config.prefix` 五条硬约束，文本内无 `{{}}`）同时进交付形态与 overlay；新会话 wire 断言 system 4052 字符、契约起于第 50 字符 | 本文件 **#14** |
| G41 | 终态不收敛：`report_task_status` 之后回合继续跑 | `exec.concludeTurn()` live 实证：汇报的 tool/call 之后直接 `turn/end`、无后续 `step/start`（会话日志 `session-429a5560`） | 本文件 **#15** |
| G44 | 模型可以不调 report_task_status 就结束回合 | `{global:true}` 监听 + 边界外 `followup()` 的兜底追问端到端可用：追问落进日志、第二轮模型补出汇报并终结 | 本文件 **#15** |
| G46 | 追问从未触发（**当日撤回的错误归因**） | 拿 wire 请求体数 `report_task_status`——而终结回合的那次调用永不出现在请求体里；改读会话日志后机制完好，据此立守则 R24 | 本文件 **#15** |
| G35 | 文档门禁脚本默认路径写死 | `DEFAULTS` 改从脚本自身位置推导仓库根；自测的注入锚点改为动态取差距表里第一条 G 行，不再绑定任何具体差距编号 | 本文件 **#16** |
| G32 | bundle 展示元信息缺失（locale meta 与 icon） | 补 locale/en.json + locale/zh.json 的 meta.title/description、原创 icon.svg（684 B）、exports 与 files 登记；面板 live 已渲染中文标题与图标 | 本文件 **#17** |
| G31 | 引入流仍靠手工（要迁 install_bundle） | 用一次性空 bundle 端到端验通 `install_bundle`（`application:"applied"`、dump-config 里注册、remove_bundle 干净撤除）；随包 skill 根路径改官方 `!!js` + `createRequire(baseUrl)` 解析 | 本文件 **#18** |
| G47 | `install_bundle` 两项未验（失败回滚 / packed file list） | 三轮一次性包实测：`not-bundle` 与不存在的 GitHub 仓库两例 profile 两文件 SHA256 前后相同；tarball 安装落地树恰等于 `files` 白名单。另记「失败与 remove_bundle 都会留下 node_modules 符号链接」 | 本文件 **#19** |
| G48 | 成功的 git 安装无证据；`files` 与 `path:` 子目录在 git 形态下是否生效未测 | 用 `git+file://` 本地仓库摘掉「需要 push」前提：根目录与 `#HEAD&path:/packages/inner` 两形态都 `application:"applied"`，落地树恰等于 `files` 白名单；对 GitHub 走网络另开 G49 | 本文件 **#20** |
| G49 | GitHub 安装失败于 `ERR_PNPM_EPERM`，根因未定 | 单变量跑完：停服务报错不变（否证占用假说）；清掉同名 junction 后 `added 17` exit 0（成立）。机制=importPackage 顺着旧 link 走进开发工作区重建符号链接被 Windows 拒。真实用户干净机器本就可用（CHANGELOGS **#22**）| 本文件 **#22** |
| G50 | git 形态装出来的 bundle 缺 `dist/`（构建产物不在提交里） | tarball 路线端到端验通：`npm pack` 清单含 dist 与 skills、安装 exit 0、服务加载后 7 工具 + persona + 追问链路完整；对外形状定为 GitHub Release 资产 tarball 的 URL | 本文件 **#23** |
| G51 | 本机 Node TLS 信任被本地中间代理接管，走 https 的依赖安装要 `--use-system-ca` | 机制有源码出处（`scrubbedParentEnv` 保留 `NODE_OPTIONS`）；不带 flag 时 DSH 自己的 install_bundle 报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`，带 flag 后该错误消失；前置已写进 README，并禁止用 `NODE_TLS_REJECT_UNAUTHORIZED=0` | 本文件 **#25** |
