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
| 四 · DSH 插件轨道（当前主线） | #9–#55 | `plugins/autogamer-device` 与 py 动作面的接线、契约与真机联调问题；#30/#31 是文档层自身的漂移与它的机械看守；#45 是同一条规则的第二次漂移，以及量它的那把尺子本身绑在 checkout 换行符上；#46/#47 把这条规则接进 CI 并让行尾成为仓库事实；#48 更正 #47 一处勾早了的验收；#49 是判据命令本身没牙（管道吞退出码）；#50 是离线 action 面少了第 14 个工具，#51 更正它发明的 `ratio`，#52 让 py 实现本身离线可跑（G62 结案）。 |
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

### #29 G5 结案：conformance 契约改吃真实 DSH runtime，fixture 全部变成生成物

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（三层全部落地，CI 两个 OS 实测绿）
- **优先级**: 高（P1 的每一条宿主契约断言都建立在这上面）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「G5 conformance 吃真实 DSH runtime（2026-10-12 按 R22 三步序）」住在 `TODO.md`，结案即删，演进查 git 历史

#### 问题描述

`tests/conformance/contracts.spec.ts` 的头部自述就是差距本身：

> "These tests lock the externally observable contracts this plugin depends on, using **fixtures recorded from live verification**. Re-capture the fixtures whenever the DSH runtime or the py action server upgrades"

也就是**手镜像**：上游一升级就静默过期，而 S8 已写明上游发到 `0.2.1-alpha.2`。同一份 py 动作面声明当时存在**三处副本**（fixture JSON、`scripts/spike-mcp.mjs` 里的 `REAL_TOOLS` 字面量、`src/tools/runDeviceAction.ts` 的 `ACTION_TO_PY_TOOL`）。而 `ci.yml` 只有 `python-quality` / `frontend` / `package` 三个 job——**插件的契约测试从未在 CI 上跑过**。

官方一手依据（声明面 + 公开包，未碰 asar）：`dsh --help` 给出 `--dump-config` / `--patch` 与 `dsh headless --json`；`docs/tool-catalog.md` 的生成器说明原文是 "this generator **BOOTS each tool plugin on a real context and reads `ctx.tools.schemas()`**, because a tool schema is not statically knowable"——**in-process 起真 runtime 读注册表是上游自己的做法**；`docs/subsystems/core.zh.md` 标明 "`scope/` 是这里唯一的非服务包"、"`dsh-base` 是默认产品组合，`dsh-sdk-minimal` 则声明一棵更小的独立配置树"。

#### 整改方案与实施

- **Tier 1 `tests/conformance/runtimeBoot.spec.ts`**：`new Context()` 上挂真实 DSH 服务包（`dsh-invariants` / `dsh-system-prompt` / `dsh-tools` / `dsh-agent` / `dsh-attachment`，均精确 `0.2.0-rc.2`）再挂本插件，契约由真 `ctx.tools.schemas()` 把关——工具名集合、`parameters.type === "object"`、`required ⊆ properties`、`ctx.tools.get` 可解析、**坏 config 必须由 loader reject**；再加一条从 `src/**/*.ts` 扫 `ctx.<name>` 消费面与 `inject` 对账。全程无模型、无网络、无设备，约 40ms。
- **Tier 2 三条 fixture 全部改成生成物**：py 动作面由 `scripts/spike-mcp.mjs --write` 从真实 MCP server 生成（期望面 = `ACTION_TO_PY_TOOL`，`REAL_TOOLS` 副本删除）；旧控制台 SSE 由 `scripts/gen-sse-events.mjs` 从三个已核实发射漏斗（读实现确认：`engine.py:541` / `task_queue_service.py:256` / `llm.py:231`）与前端订阅面抽取；版本 pin 读**实际装好的** `@deepseek-ai/dsh-*` 版本并交叉校验 `$DSH_HOME/dsh-runtimes/*/runtime.json` 的 `desktopVersion`；事件词汇改读 `@deepseek-ai/dsh-session` 的 `KNOWN_SESSION_EVENT_TYPES`（59 项）与 `SESSION_FORMAT_VERSION`（=4）。
- **Tier 3 `scripts/conformance-live.mjs`**：declared（`--dump-config`）与 live（`session.v4.jsonl.zstd`，R24）两层分开输出，注册与否明确标注只能靠 `cordis_inspect_query`/roster（R9）。
- **CI 新增 `plugin-contracts` job**（ubuntu + windows）：`pnpm install --frozen-lockfile` → `gen-sse-events.mjs` 漂移检查 → `build` → `test`。
- 落地过程中被真实包照出并一并修掉的：附件引用手镜像（**#27**）、抽取器看不见别名+常量导致 fixture 锁住假事实（**#28**）。
- ⚠️ 两个坑写在这儿的理由：公开 `@deepseek-ai/*` 包的 `latest` 标签停在 `0.0.1-rc.1`，正确代际在 **`next`**——devDeps 必须写死精确版本；`pnpm` 装包在本机需要 `NODE_OPTIONS=--use-system-ca`（G51）。

#### 验收标准

- `cd plugins/autogamer-device && pnpm install --frozen-lockfile && pnpm run build && pnpm test` ⇒ **78 passed / 1 skipped**，`npx tsc --noEmit` ⇒ 0 error
- `node scripts/gen-sse-events.mjs` ⇒ exit 0（`fixture matches the sources (26 server / 17 frontend names)`）；`ARTEMIS_MOCK_DRIVER=1 node scripts/spike-mcp.mjs` ⇒ exit 0；`AUTOGAMER_CONFORMANCE_PY=live npx vitest run tests/conformance` ⇒ 15 passed（真服务比对）
- **CI 证据**：run `38167498398`（commit `5232265`）的 `DSH plugin contracts / ubuntu-latest` 与 `/ windows-latest` 均 **success**。⚠️ 该 run 是 `gh workflow run` 手动派发的——本 fork 的 `on: push` 从不触发 run（派发前历史 `total_count=0`），已按 **G54** 另立差距；同 run 里两个 `Python 3.12` job 失败于 `check_dependency_sources`（前端 lockfile 全镜像 URL），属既有状态，按 **G53** 另立，与本条无关
- 变异校验（五条，各自确实变红）：`inject` 多写本图没有的服务 ⇒ 挂载红；摘掉 `Config` 导出 ⇒ reject 红；映射值改成不存在的工具名 ⇒ fixture 档与 live 档都红；`EMITTERS` 摘掉一个漏斗 ⇒ 覆盖守卫红；`inject` 少写 `attachments` ⇒ 消费面对账红

### #30 文档漂移：入口页与索引把「编号范围」和「当前状态」各抄了一份第二权威

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（描述性复述改成引用，体量数字全表重测）
- **优先级**: 中（不阻塞实现，但入口页会把新人直接导到已结案的差距上）
- **分类**: 四 · DSH 插件轨道
- **关联**: 守则 R25（一次只测一个变量、先读机制）、`TODO.md` §五「文档索引」与 `migration/README.md` §五 改文档规则

#### 问题描述

拉取 `61f23a1` 后通读文档层，机械对照查出**六处**描述与现实不符，全部出自同一个形状——**可推导的事实被抄成了第二份权威**：

1. `TODO.md` 文档索引的 registry 行写「D1-D17 / S1-S11 / **G1-G44（含 18 条已关闭）** / **R1-R19**」。实测：registry 里最大 `G54` / 最大 `R26`，`CHANGELOGS.md` 的「已关闭差距史」表有 **33** 行。
2. 同一张索引表的守则行写「插件契约守则 **R1-R22**」，而 `AGENTS.md` 已按 R1-R26 引用。
3. `migration/README.md` §二「这个项目现在在做什么」第 3 句写「**当前卡在 G30**：工具注册成功但没进 agent 的工具面」。G30 早在 **#10** 结案（双根因：`effect()` 语义反转 + 裸注册未编译）。入口页把进度抄了一份，结案时没人回改。
4. 同页 §三 文档清单 11 行的体量数字全是旧快照：`TODO.md` 写 177 行 / 34.9 KB，实测 **410 行 / 76.0 KB**；`plugin-contract-rules.md` 写 166 行，实测 248 行——且**整张表缺 `docs/CHANGELOGS.md` 这一行**（`TODO.md` 与守则都按「已关闭差距的正文去处」引用它）。
5. `plugin-contract-rules.md` 首行「覆盖范围：**R1-R19** 已改写 TODO.md 的 …」把那一轮的回写清单写成了条款全集，R20-R26 的同批回写在结构上无处可寻。
6. `TODO.md` 状态表「下一步（按序）」那一格内存在**两套 `2)/3)/4)`**：前一套是 G5 结案后的现行序列，后一套是结案前的旧序（还写着「G35、G32 已结」这种当时算新消息的尾巴），读者无法判断哪套作数。

另查出 `inventory/03-device-media-diagnostics.md` 有 **15 处** `TODO.md:NNN` 行号引用，指向 2026-10-09 基线 `cc6b20c` 那一版；`TODO.md` 是活文档，行早已错位。

**为什么两份门禁都没拦住**：`check_doc_registry.py` 只验「引用能否解析 + 本表与来源集合是否一致」，`check_doc_tables.py` 只验表格形状。两者都不读「描述文字里复述的范围」，所以范围类漂移在机制上是**无人看守**的一类。

#### 整改方案与实施

原则：**范围只写 `registry.md`，进度只写 `TODO.md` §零；其它地方一律改成引用，不复制值。**

- `TODO.md` 文档索引两行改成「全部 D / S / G / R 编号一览」「现行范围以 registry 为准」，并把 R20-R26 的要点补进守则行的枚举里（枚举的是**稳定 id + 一句话**，不是范围数字）；§五「P0 执行状态」里那条 2026-10-10 的历史记录保留事实，只把「R1-R19」改成「那一轮成文到 R19；现行条款数看 registry」。
- `TODO.md` 「下一步（按序）」删掉结案前遗留的第二套序号尾段，保留 1)-5) 现行序列（含 G52/G53/G54、G43、低成本债、P1、两条未闭环观察）。
- `migration/README.md`：§二 第 3 句不再写「当前卡在 X」，改成「P0 已收官 / D9 成立」这一里程碑级事实 + 「进度与阻塞看 `TODO.md` §零」，并把这次事故本身写进 §五 新增的「编号范围与当前阻塞点各只在一处写」规则；§三 全表体量按 `wc -l -c` 重测，**补上 `docs/CHANGELOGS.md` 行**，registry / 守则两行的描述改范围无关；页首「体量数字是 `check_doc_registry.py` / 尺子实测」那句改成实际做法（`wc`），因为它虚指了脚本能力。
- `plugin-contract-rules.md` 首行改成「R1-R19 那一轮成文时改写了 …；R20-R26 是此后陆续新增，回写位置记在各条自己的「判据」段」，并声明现行范围只看 registry。
- `inventory/03` 顶部按既有「编号警示」的同形加一条**行号警示**，不去逐条改写那 15 个指针——逐条改写会造出第三份需要维护的映射，而盘点文档的可信度口径本就是「内容可用、引用不可照用」。
- 顺手补上一处**门禁本身的缺口**：`scripts/check_doc_tables.py` 的 `DEFAULTS` 里没有 `docs/CHANGELOGS.md`——它是「已关闭差距史」表的所在，`check_doc_registry.py` 按它读结案编号，它的表格形状却从未被尺子量过（§五 的规则本就要求表格文档进 DEFAULTS）。加入后 `--selftest` 六条注入缺陷仍能全部报警。

#### 验收标准

- 复测命令（数字即事实，可直接重跑）：

  ```bash
  python - <<'PY'
  import re
  reg=open('docs/migration/registry.md',encoding='utf-8').read()
  cl=open('docs/CHANGELOGS.md',encoding='utf-8').read()
  closed=re.findall(r'^\|\s*(G\d+)\s*\|',cl.split('## 已关闭差距史')[1],re.M)
  print('max G',max(int(x) for x in re.findall(r'G(\d+)',reg)),
        'max R',max(int(x) for x in re.findall(r'R(\d+)',reg)),
        'closed G',len(closed))
  PY
  ```
  ⇒ `max G 54 / max R 26 / closed G 33`
- **范围复述归零**（描述性文档不再自称条款全集）：
  `grep -rn "R1-R[0-9]\|G1-G[0-9]" docs/TODO.md docs/migration/README.md docs/migration/plugin-contract-rules.md` ⇒ **无输出**（改前 5 处）。
  两个刻意保留的形状要写清：**①** 指向性写法 `R2-R8` / `R6-R15`（「去做这类事前读这几条」）引用的是具体条款，不是全集，保留；**②** 守则首行改成 `R1…R19 首轮成文` 这种**点名那一轮**的省略号形态，同句已声明「不是条款全集，范围只看 registry」，故不入本判据的连字符形态。`CHANGELOGS.md`（本文件）与 `registry.md` 不在判据范围内——前者要原样引用改前文字，后者本就是权威处。
- **`AGENTS.md` 是已知的例外，不是漏网**：它还写着「守则 R1-R26」。该行当前为真，且它把 R20-R26 的要点整段内联给 agent（作业入口要自足），所以本次不动它；**新增条款时必须同步这一行**——它是唯一被有意维护的复述处。
  ⚠️ **这条豁免已被 `#31` 撤回**：把例外留给「人工记得去改」正是它腐烂的方式；现在 `AGENTS.md` 也改成指向 registry，并由门禁机械拦。
- **入口页不再自称当前阻塞点**：`grep -rn "当前卡在" docs/migration/README.md` ⇒ **无输出**（事故经过只留在本条，§五 的规则行改引 `changelogs #30`）。
- **旧计数不再出现**：`grep -rn "含 18 条已关闭" docs/ AGENTS.md | grep -v CHANGELOGS` ⇒ **无输出**。
- `docs/migration/README.md` §三 表新增 `docs/CHANGELOGS.md` 行（行数 11 → 12），且**每一行体量数字须与实测对上**：
  `wc -l -c docs/TODO.md docs/CHANGELOGS.md docs/migration/registry.md docs/migration/glossary.md docs/migration/plugin-contract-rules.md docs/migration/upstream-plugin-forms.md docs/migration/dsh-verification.md docs/migration/feature-inventory.md docs/migration/upstream-rethink.md plugins/autogamer-device/README.md AGENTS.md`；`inventory/01…05` 按五份求和。KB = 字节 / 1024，见同表下「体量口径」。
- **`inventory/03` 的行号警示在场**：`grep -c "行号警示" docs/migration/inventory/03-device-media-diagnostics.md` ⇒ 1（声明那 15 处 `TODO.md:NNN` 是 2026-10-09 `cc6b20c` 版快照，按段名定位）。
- **状态表只剩一套序号**：`grep -o "\\*\\*[0-9])\\*\\*" docs/TODO.md | sort | uniq -c` ⇒ `**1)**`…`**5)**` **各恰好一次**（改前 `**2)**` / `**3)**` / `**4)**` 各两次，两套序号在同一段里并存）。
- 两份门禁脚本均 exit 0：`python -X utf8 scripts/check_doc_registry.py`、`python -X utf8 scripts/check_doc_tables.py`（表格行数变了，尺子必须重跑）。
- **尺子现在也量 CHANGELOGS 自己**：`python -X utf8 scripts/check_doc_tables.py` 的输出含 `OK: …\docs\CHANGELOGS.md`（8 table block(s) checked）；`python -X utf8 scripts/check_doc_tables.py --selftest` ⇒ `SELFTEST: ruler fires on all six injected defects`（证明加文件没把报警能力加钝）。
- `uv run ruff check scripts/check_doc_tables.py` / `uv run ruff format --check scripts/check_doc_tables.py` 通过。
- `TODO.md` 状态表「下一步（按序）」内 `**2)**` 恰好出现一次：`grep -o "\*\*2)\*\*" docs/TODO.md | wc -l` ⇒ 该行计数为 1。

### #31 把 #30 的教训做成规则与判据：派生事实只有一处权威

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（规则入 `AGENTS.md`，两条判据入门禁，现存复述全部拆除）
- **优先级**: 中（不修就会每轮复发：#30 一轮修了六处，实现本条的过程中又冒出五处）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「文档层经验固化：派生事实只有一处权威，且必须有机械看守」住在 `TODO.md` §五（spec 提交 `6e2bfb8` 早于实现提交，按 R22），结案即删

#### 问题描述

#30 修的是症状：六处复述被逐个改回引用，但**没有任何东西阻止下一轮再长出六处**。判据面缺位的证据在本条实现过程中当场出现：

- 我在 #30 里手工重测了一遍体量数字，随后自己写方案、改守则，README 的数字**又错了 5 行**——新加的体量校验第一次运行即抓到：`docs/TODO.md` 写 410 行（实测 438）、`AGENTS.md` 写 175 行（实测 191）、守则 KB 少算、`inventory` 求和差 1 行，外加一处**路径基准不成立**：表里写 `../plugins/autogamer-device/README.md`，从 `docs/migration/` 出发指向 `docs/plugins/`，根本不存在。
- `AGENTS.md` 与 `plugins/autogamer-device/README.md` 各自持有一份「条款全集」和一份「当前状态」。包 README 那条尤其说明问题：它写着「当前状态（2026-10-10）：🔴 **P0 未完，卡在 G30**」——G30 在 **#10** 就结案了，P0 也已收官，而包首页一直挂着它。
- #30 的验收里我把 `AGENTS.md` 判成「有意维护的例外」，理由是它要自足。**这条判断被本条撤回**：自足靠的是指向权威 + 内联单条 id（`R6`/`R20` 这种），不是抄一个会腐烂的总数。

**共同形状**：可推导的值被抄成第二份权威，而两份门禁只验「引用能否解析」和「表格形状」——抄来的值即使与源头不符也照样全绿。

#### 整改方案与实施

1. **规则成文**（`AGENTS.md` 新增一节 "Docs: a derived fact has exactly one authority"）：可推导的东西（编号范围/条数、文档体量、当前阻塞点）只许存在一处，别处一律指针；并给出四条去处（范围→`registry.md`、状态→`TODO.md` §零、结案正文→`CHANGELOGS.md`、体量→生成）与两条门禁名。
2. **`scripts/check_doc_registry.py` 判定 6**：`\b([DSGR])1-\1?(\d+)` 命中的「从 1 号到当前最大号」全集形态，只允许出现在 `registry.md`（权威）、`CHANGELOGS.md`（存档须原样引用改前文字）、以及**定义该序列的 `## ` 标题行**（如 `## 二、决策记录（现行有效，D1-D17）`）；其余按 `相对路径:行号` 报错。
   指向性写法 `R2-R8`、`R6-R15` 不在此列——它们引用具体条款而非总数，文本稳定。例外走**文件级白名单**，不设行内标记：标记清单本身会变成第二份要维护的东西。
3. **`scripts/check_doc_tables.py` 接管体量**：新增 `check_sizes()`，默认运行即逐行核对 `docs/migration/README.md` §三 的「N 行 / X KB」与真实 stat（KB 统一一位小数）；`--refresh-sizes` 直接改写该列，从此**没有人手抄数字**。表内路径统一改成仓库根相对并在「体量口径」note 里写明约定；解析不到的行是 FAIL 而不是跳过。
4. **现存复述全部拆除**：`AGENTS.md` 文档地图两行（`D1-D17`/`S1-S11`/`R1-R26` → `D*`/`S*` + 指向 registry）、包 README 的守则范围行与「当前状态」行（状态改指针）、`migration/README.md` §一 的规则提示行。
5. **报警能力自证**：registry selftest 加第三条注入（`CAUGHT [total-range restatement]`，锚点从差距表现取，不写死具体编号——沿 #16 的教训）；tables selftest 加 (g) 体量数字过期、(h) 体量表整块消失两类注入，末行改为 `all {FIRED} injected defects` 用计数器而非硬编码条数。

#### 验收标准

- `python -X utf8 scripts/check_doc_registry.py` ⇒ exit 0，输出含 `total-range restatements outside the authority: 0`；`--selftest` ⇒ `SELFTEST: reference gate fires on all 3 injected defects` 且 registry/TODO 均字节级还原
- `python -X utf8 scripts/check_doc_tables.py` ⇒ exit 0 含 `12 size row(s) checked`；`--selftest` ⇒ `SELFTEST: ruler fires on all 8 injected defects`；`--refresh-sizes` ⇒ 无漂移时 `0 of 12 row(s) rewritten`
- **判据真的会红（实做）**：临时把 `AGENTS.md` 的指向写法改回「从 1 号到当前最大号」的全集形态 ⇒ `PROBLEM: AGENTS.md:31 restates the total id range ...`，exit 1，随后字节级还原（`restored identical: True`）
- **不再有第二份状态**：`grep -rn "当前状态" plugins/autogamer-device/README.md` ⇒ 只命中指针句；`grep -rn "体量数字用" docs/migration/README.md` ⇒ 无输出（旧口径已换成脚本口径）
- `uv run ruff check scripts/` ⇒ All checks passed；`uv run ruff format --check scripts/check_doc_registry.py scripts/check_doc_tables.py` ⇒ already formatted。
  **但 `uv run ruff format --check scripts/` 整体仍有 1 处红**——那是既有债（`scripts/check_dependency_sources.py:55` 过长，非本轮引入，本轮未顺手改以免混进无关提交），已按 **G55** 登记
- **偏差如实记**：① 体量数字第一次跑就纠正了我自己在 #30 手抄的值，KB 口径由「整数与一位小数混用」统一为一位小数（`inventory` 行 217 → 216.9 KB）；② #30 关于「`AGENTS.md` 是有意例外」的判断已由本条撤回，#30 原文加了一行取代标注；③ 未新增守则条款——文档卫生的作用域是全仓库而非插件契约，按 `registry.md` 的规则不占 `R*` 号

### #32 G52 结案：追问路径改吃真实 `turn/end`，并摘掉追问消息的手镜像

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（新 Tier 1 五条全绿，插件测试面 78 → 83）
- **优先级**: 高（P1 的终态与熔断判据都建立在这条路径真的能被宿主触发上）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「G52 修复轮：追问路径补进真实 runtime」住在 `TODO.md` §五（spec 提交 `63bd39c` 早于实现提交，按 R22），结案即删

#### 问题描述

G44 的兜底追问（`turn/end` → 至多一次 `followup`）此前只有一种证据：`apply.spec.ts` 自己造的假 ctx，`emit("turn/end")` 由测试亲手调用，`ctx.agents.get` 是返回固定对象的假函数。宿主里真正决定成败的三件事一件没被证过：① `dsh-session` 提交的 `turn/end` 会不会派发到插件监听；② `session/event` 的 scope 筛选会不会把它挡掉（G44 v1 正是死在这儿）；③ `ctx.agents.get(session.id)` 那句「agent id 就是 session id」的键值假设。

查声明面（R20：先官方一手资料；全部为已安装的 rc.2 包）时另出三条：

- `Agent.followup` **确实在声明面**——`@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:139-212` 的模块扩展里（`followup/steer/inject/send/cancel/whenIdle/runMaintenance`）。首轮 grep 报「声明面没有 followup」是**取证方法错**：pnpm 的 `node_modules` 全是指向 `.pnpm/` 的符号链接而 `grep -r` 默认不跟随。
- G52 原句「agent handle 需 `ctx.agents.setFactory`」**是错的**：`setFactory` 只服务 `create/resume`（注释写明 factory 由 `dsh-agent-loop` 提供），自带句柄走 `AgentRegistry.register(agent)` 即可，且「Await the registration before using the agent」。
- 真 `UserMessage` 的 `MessageBase` 要求 `id: MessageId`（branded）与 `source: MessageSource`；`MessageSourceMap` 官方原文「Merge-extensible sum type — **each producer declares its own `kind` in its own module**; there is no shared catch-all `plugin` kind」。我们的 `DshUserMessage` 手写镜像**没有 `id`**，`kind:'autogamer'` 也从没按官方形态声明——live 里宿主容忍了它（#15 的追问确实落进日志），但「碰巧能用」不是契约。

#### 整改方案与实施

- **新增 `tests/conformance/followup.spec.ts`（5 条）**：真实服务图（六个 `@deepseek-ai/*` 包，含 `dsh-session`）→ **两个 realm**（agent realm 进入会话、preset realm 挂对照监听）→ 真 `ToolRuntime.execute` 套在 `ctx.agents.withInitiator(...)` 里标记 acted → 真 `session.append("turn/end", { turn: 1, reason: { kind: "completed" } })`。断言四件：追问恰一次；**同步阶段绝不追问**（R23 第一次在真 emit 路径上被证）；消息满足真 `UserMessage`（含 `id`）；同 realm 的非 global 对照监听收不到而 global 收到——`{global:true}` 从此是「观察到的机制」而不是「被锁的选项」。
- **`src/dsh-types.ts` 去镜像**：`DshAgent = Pick<Agent, "id" | "followup">`、`DshUserMessage = UserMessage`、`DshSessionRef.id: SessionId`；`kind:'autogamer'` 用 `declare module "@deepseek-ai/dsh-llm"` 扩展 `MessageSourceMap`。全部 `import type`，**运行时零新增依赖**：官方 `createUserMessage` / `MessageId()` 是运行时导入，会把 devDep 变成宿主依赖，所以本地铸 id 后按 R21 在注释里标「单测证明 / live 证明」分级。
- **`src/index.ts`**：追问消息补 `id: autogamer-nudge-<session>-<seq>`（进程内单调，跨 agent 唯一）。
- **`AGENTS.md`**：记本机 pnpm 11 的两条必需旗标。本轮撞到过一次代价：不带 `--config.verify-deps-before-run=false` 时每次 `pnpm run` 前会隐式 install 并**重写 `pnpm-lock.yaml`**（实测 +507 行、`autoInstallPeers` 由 false 翻成 true），已回滚、未提交。
- **偏差与连带新差距（如实记）**：方案原设想「把插件挂进 preset realm」以直接证 `{global:true}`，实测该形态下 `ctx.tools.schemas()` 在 realm 与 root **都返回空**（挂载不报错但注册不落）⇒ 开 **G57**（测试台装配问题，不影响已 live 验证的 bundle 挂载形态），`{global:true}` 的注册选项锁因此仍留在 `apply.spec.ts`。另开 **G56**：`scripts/mock-action-server.mjs` 与 `ActionClient` 握手超时（mock 自己打出 `ready`，客户端首个请求却 `SdkError: Request timed out`，随后熔断进冷却）⇒  acted 的标记改用「立即退出的桩命令」；探针同时证了 `markActed` 发生在 `execute` 入口、与设备结果无关。

#### 验收标准

- `cd plugins/autogamer-device && npx tsc --noEmit -p tsconfig.json` ⇒ 0；`npx vitest run` ⇒ **83 passed / 1 skipped**（G52 净增 5）
- 三条变异校验各自会红（均已实做、验完还原）：`setTimeout(…, 0)` 改同步 ⇒ 新 spec 的「同步阶段绝不追问」红；删 `id:` ⇒ `nudge carries no message id` 红；摘 `{ global: true }` ⇒ `apply.spec.ts` 选项锁红
- 对照断言在场：同 realm 的 plain 监听长度为 0，global 监听含 `g52-session/turn/end`
- 门禁：`python -X utf8 scripts/check_doc_registry.py` 与 `check_doc_tables.py` exit 0；G52 在 `registry.md` 已关闭表与本文件「已关闭差距史」各一行；`spike/probe-g52*.mjs` 三个探针已删除，`git status` 无遗留

### #33 G34/G38：输入语义校验补齐，内部错误不再记成任务失败

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（纯离线：无 VLM、无设备；G33 的 guard 迁移另行）
- **优先级**: 中（校验缺口是模型误用时的体验问题；归类污染的是熔断语义正确性）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「G34/G38 修复轮」住在 `TODO.md`（spec 提交早于实现提交，按 R22），结案即删

#### 问题描述

G34：S5 的代价条款写明裸 schema 注册的工具「自己负责输入校验」，但 `buildCall` 只判了
`target.coordinate` 元素是否为 number——`text` 未判空、`duration_ms` 未判正、`key` 未判枚举成员、
`swipe` 起止只判数组不断言对、残缺 coordinate 会静默回退到层级搜索（调用方 typo 做出意外动作）。
G38：`dispatch` 的 `buildCall` catch 按 `environment:` 前缀二分，无前缀一律 task——插件自身的缺陷
（如无前缀抛错）被记成任务级失败、进熔断语义，实测模型连试三次（TODO §四 G38）。

#### 整改方案与实施

1. `plugins/autogamer-device/src/tools/runDeviceAction.ts`：加 `isNormalizedPair`/`assertNormalizedPair`/
   `assertNonEmptyString`/`assertPositiveDuration`；`resolvePixelTarget` 入口对在场的 coordinate 存在即判；
   `input_text`/`press_key`/`swipe`/`launch-stop-app`/`open_link`/`wait` 各补对应断言（失败一律 `task:`，
   在任何设备往返之前抛出）。`DispatchResult` 加 `"internal"`：`buildCall` catch 里无前缀异常走 internal；
   `execute` 把 `dispatch` 逃逸的意外抛出转 internal（`signal.aborted` 时仍报取消），internal 不记 breaker、
   抛 `internal:` 并带“插件缺陷、勿原样重试”信号。传输层 catch 保持 environment（S4 fail-safe，不确定继续熔断）。
   `classify.ts` 不动（它是设备文本分类）。
2. `plugins/autogamer-device/tests/router-errors.spec.ts`（新建，11 条）：直调 `defineRunDeviceAction` 配真
   `DeviceGate`/`DeviceBreaker` + 记账 stub client——不走 `apply()` 的 `defineTool` DSL（DSL 自带形状校验会抢先）。
   G34 每条断言 `rejects /^task:/` 且零设备调用；G38 断言 `rejects /^internal:/`、文案含 do-not-retry、
   `breaker.stateOf` 仍 closed、随后 `wait` 仍可执行。

#### 验收标准

- [x] `pnpm run build` 0 error；`pnpm test` ⇒ **94 passed / 1 skipped**（此前 83/1，净增 11）
- [x] 变异校验（均已实做、验完还原）：删掉 `text` 校验 ⇒ 空 text 单测红（且暴露出无校验时会走到层级分支报另一个 task 错）；
      把 internal 改回 task ⇒ 两条 G38 单测红
- [x] `contracts.spec.ts` 不受影响（无 schema 改动）；文档门禁双 exit 0

### #34 G57：裸 scope 注册本就生效，“双空”是无 scope 读法

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（测试台问题，零产品代码改动；纯离线）
- **优先级**: 低（Tier 1 现有 root 装配本就保真；结论是 D16 realm 与 P3 的前置知识）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「G57 判别轮」住在 `TODO.md`（spec 提交早于实现提交，按 R22），结案即删

#### 问题描述

G52 探针（已删）留下一句未判定的观察：`presetScope.ctx.plugin(...)` 挂载不报错，但 scope 与 root 的
`schemas()` 双空，而裸 `new Context()` 挂载双工具齐在。按字面会导向「`createScope` 的 realm 里注册不落」
这个机制结论——但探针的读法从未经审查：`scope.ctx.tools` 直接 GET 会抛
`cannot get property "tools" without inject`（读法无效），经 `inject` 读仍无参（见下）。

#### 整改方案与实施

1. 单变量判别探针六步（`spike/probe-g57*.mjs`，gitignored 现场，用完即删）：
   复现双空（有效读法下）→ counter 插件 apply 跑 1 次（`plugin()` 机能好）→ ours apply 跑 1 次
   （激活执行了）→ 同 scope trivial 注册亦双空（非 ours 特有）→ 圈内传 `scopeOf(ctx)` 即见双工具。
2. 机制点名（已安装产物，R1 允许）：`dsh-tools/lib/index.js:2886` 的 `register()` 经
   `layers.effect(this.ctx, …)` 把条目打上调用方 scope 标签；而 `schemas(scope)`/`get(name, scope)`
   无参即全局视图（`:3023-3025`、`:2995-2997`）。`dsh-scope/README.zh.md` §父链：注册视图沿链向下继承。
   ⇒ 注册一直生效；root 空是 D16 隔离语义（正确）；旧 scope 空是读法——无参调用读的是全局视图。
3. 测试台定论：Tier 1 的 root 挂载仍是全局工具面的保真装配，无需 realm 挂载；realm 挂载须 scope-keyed 读。
   新增 `tests/conformance/scopeVisibility.spec.ts` 锁死：scope-keyed 见双工具、全局视图为空。

#### 验收标准

- [x] `pnpm test` ⇒ **95 passed / 1 skipped**（净增 1）；`pnpm run build` 0 error
- [x] 变异校验：读法去 `key` 即红——恰好复刻旧探针的误读（已还原）
- [x] 探针六个文件已删，`git status` 无遗留；文档门禁双 exit 0

### #35 G56：mock 应答缺 `jsonrpc` 帧字段，真 SDK 读侧拒收致握手超时

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（纯离线；`ActionClient` 未动）
- **优先级**: 高（S10 ③ 与熔断矩阵的无设备后端被它堵着，Tier 1 靠桩命令绕行）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「G56 修复轮」住在 `TODO.md`（spec 提交早于实现提交，按 R22），结案即删

#### 问题描述

`scripts/mock-action-server.mjs` 手拼 `initialize`/`tools/list`/`tools/call` 应答且 stderr 打出 `ready`，
但真 SDK client 首个请求即 `SdkError: Request timed out`，随后熔断进冷却（TODO §零 G56）。
根因在 SDK 读侧：`@modelcontextprotocol/client@2.0.0/dist/src-D_zzAWoS.mjs:6655-6676` 的
`ReadBuffer.readMessage()` 对每行跑 `JSONRPCMessageSchema.parse`，catch 里**只有 `SyntaxError` 才跳过**；
消息 schema 要求 `jsonrpc: z.literal("2.0")`（`:3179`），而 mock 的三个应答都没有该字段——zod 拒收、
`throw` 出读循环，挂起的 `initialize` 永不 resolve。py 真服务走官方 SDK 自带该字段，故只有 mock 超时。

#### 整改方案与实施

1. `scripts/mock-action-server.mjs`：`handle()` 四个返回分支（`initialize`/`tools/list`/`tools/call` 同步分支/
   `ping`，含 `MOCK_DELAY_MS` 异步回写与默认 `method not found`）统一铺 `jsonrpc: "2.0"`——唯一改动。
2. `tests/mockServer.spec.ts`（新建，3 条）：真 `ActionClient` + 真 stdio transport 直连 mock——`listTools`
   含 13 工具、`take_screenshot` 解出 1080x2400 真 PNG 头、`tap` 回 `Success`。`apply.spec.ts` 的
   `vi.mock(actionClient)` 按文件隔离，不影响本文件。

#### 验收标准

- [x] `pnpm test` ⇒ **98 passed / 1 skipped**（净增 3）；`pnpm run build` 0 error
- [x] 变异校验：帧字段删掉 ⇒ 三条全挂（mock 只打 `ready`、无请求完成，即 G56 原样复现；已还原）
- [x] 文档门禁双 exit 0

### #36 G33：熔断拒绝对迁 guard，只读动作声明可并发

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（纯离线；超时与审批不在本轮：前者 R15 明许自实现，后者无 ask 路径）
- **优先级**: 中（R13 义务项；顺带挖出两个真 bug）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「G33 迁移轮」住在 `TODO.md`（spec 提交早于实现提交，按 R22），结案即删

#### 问题描述

`run_device_action` 正文内同时做三件事：闸门串行（执行机制，应留）、熔断记录（状态，应留，S4）与
冷却期拒绝 `throw environment: …cooling down`（部署策略，按 R13 该出工具）。另 `defineTool` 的并发
分类器位一直空着（S3 只读可并发未声明，R14 欠真名）。

#### 整改方案与实施

1. `src/index.ts`：注册 `ctx.tools.guard`——只看 `run_device_action`（别家与 `report_task_status` 永不拦），
   key 取 `device_serial` 或 default，`canAdmit` 假则拒（文案沿用）；`src/tools/runDeviceAction.ts` 删拒绝分支
   （记录保留），加 `isConcurrencySafe: take_screenshot/get_ui_hierarchy → true`；真名出自已安装产物
   （`dsh-tools` types：`ToolGuard`、`DefineToolOptions.isConcurrencySafe`），S3 落字。
   `DshContext.tools` 补 `guard` 镜像（`import type ToolGuard`）；`apply.spec.ts` fake 补 guard stub。
2. 测试：`tests/conformance/breakerGuard.spec.ts`（真 registry：坏命令开闸→同 key 拒 `cooling down`、
   异 key 放行报传输失败、report 直通、分类器四断言）+ fake 侧注册/放行两锁。
3. 偏差（实施中按 R25 单变量查清的两个真 bug，同轮修掉、各有变异签名）：
   - `ActionClient.start()` 失败不清 `starting` 缓存→此后每次重抛同一 stale `Connection closed`（注释称会重建，
     实则失败路径永不）：catch 里清缓存 + 关 transport。锁 `tests/actionClient.spec.ts`（计数文件 `xx`；去修法即 `x`）。
   - 组装期三处直调传输（层级取值、截图分支）绕过 environment 分类→误走 internal：加 `callTransport` 包
     `environment:` 前缀。锁即异 key 用例（修前报 `internal: Connection closed`）。
   - 另：`defineTool` 对分类器先验参（非法入参直接 false）——分类测试须传合法参，另加非法参断言锁 fail-closed。

#### 验收标准

- [x] `pnpm test` ⇒ **105 passed / 1 skipped**（净增 7）；`pnpm run build` 0 error
- [x] 变异校验：摘 guard 注册 ⇒ 拒测红；分类器改全 true ⇒ 分类测红；`starting` 不清 ⇒ 计数 `x`；
      `contracts.spec.ts` 的直接调用提取器同步跟进 `callTransport` 拼写（#28 守卫按设计变红一次）
- [x] `grep -n "cooling down" src/tools/runDeviceAction.ts` 无命中；文档门禁双 exit 0

### #37 G53：前端 lockfile 221 个镜像 resolved 改回官方域

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（纯离线；版本/integrity 零漂移）
- **优先级**: 中（既有状态，CI 首次真跑才暴露；`check_dependency_sources` 门禁红）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「G53 修复轮」住在 `TODO.md`（spec 提交早于实现提交，按 R22），结案即删

#### 问题描述

`apps/showcase_ui_v2/package-lock.json` 的 221 个 `resolved` 全是 `https://registry.npmmirror.com/…`，
`scripts/check_dependency_sources.py:55-58` 要求 `registry.npmjs.org`——CI `python-quality` 第一步即红。
写入来源是用户级 npm registry（无项目级 `.npmrc`），lockfile 自 `f9a7081` 未动。

#### 整改方案与实施

不断言整份重取（`npm install --package-lock-only` 会抖版本与元数据）：文本级只换 host，
`npmjs` 同路径等价（镜像原样代理）且 `integrity` 221/221 全在、取包内容不变。解析级断言钉死：
包集合、字段集合一致，221 处变更全为 host swap，其余逐字节相同。

#### 验收标准

- [x] `python scripts/check_dependency_sources.py` ⇒ `Dependency sources use public PyPI and npm registries.` exit 0
- [x] `git diff --stat` 仅 1 文件（221+/221-）；`npmmirror` 全仓该文件零残留
- [x] 前端 `npm test`（`node_modules` 已在）⇒ **305 passed**，零影响
- [x] 复发条件记案：带镜像 registry 跑 `npm install` 会再次写回（本次不加项目级 `.npmrc`，不做网络策略决策）

### #38 G55：`check_dependency_sources.py` 单行格式修复关账

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（实现提交 `e1de835` 早在本轮，本条只关账；与 G53 各有证据，不合并）
- **优先级**: 低（一行）
- **分类**: 四 · DSH 插件轨道

#### 问题描述

`scripts/check_dependency_sources.py:55` 过长，`ruff format --check scripts/` 报
`1 file would be reformatted`，而 CI `python-quality` 跑的是仓级 `ruff format --check .`。

#### 整改方案与实施

`uv run ruff format scripts/check_dependency_sources.py` 一条命令（`e1de835`）。

#### 验收标准

- [x] `uv run ruff format --check scripts/` 全绿；`uv run ruff check scripts/` 全绿
- [x] 如实注明：仓级 `ruff format --check .` 另有 9 处既有红（`apps/admin_console` 2 / `artemis` 3 /
      `setup.py` / `tests` 2 / `third_party` 1），已按偶发规则另立 **G58**，不在本条内

### #39 G4 熔断矩阵落定：键同源、四解除、不对称引用既有锁

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（纯离线；G3 auto 池/parking 仍归 P2）
- **优先级**: 高（P1 设备治理闭环；旧盘点 drift 风险 #7 的对应项）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「熔断矩阵轮」住在 `TODO.md`（spec 提交早于实现提交，按 R22），结案即删

#### 问题描述

`inventory/01-console-queue.md:70-74` 的旧矩阵（解除 4 路径 + fail-safe/fail-open 不对称 + auto 默认键 +
`allowed_fails` 未决）在 R2' 后只有 S4 一句设计稿承载。单变量核实现状：核心迁移（open/half-open/单探测/
重挂/成功关/key 隔离、默认 1/30s、guard 拒/放、internal 不记）全已有锁；真缺口仅三处——键推导两处分叉
（空串在 execute 落空键、在 guard 回 default）、`reset()` 与 `allowedFails:2` 计数无锁、S4 解除句未修订。

#### 整改方案与实施

1. 导出 `deviceKeyOf(args, fallback)`（省略/非字符串/空串→fallback），`execute` 与 guard 同源；
   `tests/deviceKey.spec.ts`（3 断言）+ Tier1 空串调用点锁（空串开闸→省略 serial 见同 hold；回退 `??` 即红，
   签名恰为分叉复现）。
2. `breaker.spec.ts` 加 `reset()` 清开闸（重启即 fresh = 旧 stop 效果）与 `allowedFails:2` 两次才开。
3. S4 解除句修订：①探测成功关②冷却到期半开③探测环境失败重挂新窗④新提交/显式 resume 不旁路健康态
   （与旧世界及 S4 原句的显式偏差，理由见 TODO）⑤cancel 不碰；marker 差集记为设备工具域内有意差集，不改代码。

#### 验收标准

- [x] `pnpm test` ⇒ **111 passed / 1 skipped**（净增 6）；`pnpm run build` 0 error
- [x] 变异校验：调用点回 `??` ⇒ Tier1 空串锁红；`reset` 删 ⇒ 新增红
- [x] 文档门禁双 exit 0

### #40 P1 智能层离线片：validator 梯 + prompt 级 checker + skills

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭离线片（ checker 载体用户已决：prompt 级；live 服从验收另行；无 G 号，属 checklist 分片）
- **优先级**: 高（P1 质量主体）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「P1 智能层方案」住在 `TODO.md`（spec 提交早于实现提交，按 R22），结案即删

#### 问题描述

S11 的单层路由只有骨架：目标找不到即失败、无执行后升级、无连败 incident、无严格度开关；
checker 审计无纪律文本、无可回放事实；skill 无梯级与脚手架。上游保真数：
预检 3 次/`XML_BYPASSED` 转 pixel/burst 与 `launch_app` 不重试/连败 3 开 incident/
`disappeared/shifted/occupied` 分类；checker 三不变量。

#### 整改方案与实施

1. P1-a（`src/tools/runDeviceAction.ts` + `src/index.ts`）：预执行 index/text 解析失败重取层级共 3 次，
   不可解析层级速败、无 target 零取数速败；`effect=unchanged`（仅变更类）→ 新层级坐标重解一次
   （index/text 专属；坐标/无目标动作沿上游不重试）→ 仍 unchanged → `pixel_guidance` + category
   （`disappeared`/其余 `general`；`shifted/occupied` 需像素信号，留位）；同设备连败计数到 3 挂
   `incident` + 审计文本（`checkpoints`/`strict` 加里程碑措辞），成功清零，`unknown`/cancel/环境/内部不碰计数；
   `strictness` Config（`off/final/checkpoints/strict`，默认 `final` 对齐上游；`off` 单次无梯无 incident；
   `strict` 变更成功带 `self_check`）。`tests/validatorLadder.spec.ts` 17 条。
2. P1-b：两工具 `output.presentationMeta` 落 verdict/终局（R16，unknown 形状投 `{}` 不抛）；
   两处 preset `persona` 加规则 6 审计纪律（逐字一致，`deliveryShape` 锁）；`JsonValue` 用结构相同的
   本地别名（`dsh-util-values` 非直接依赖，pnpm 解析不到；封闭通用形，不腐）。
3. P1-c：`SKILL.md` 加严格度四档 + plan 里程碑/`verify`/incident 脚手架；`deliveryShape` 锁文本。
   不建 goal 工具（S11 可选，另立项）。

#### 验收标准

- [x] `pnpm test` ⇒ **132 passed / 1 skipped**（净增 21）；`pnpm run build` 0 error
- [x] 变异校验：预 3→1（2 红）、阈值 999（3 红）、去 meta（1 红）、`JsonValue` 命名导入（构建红两次，
      一次是具名实为他物、一次是默认导出他物——本地别名终解）
- [x] R6 未跑（本环境无 DSH 宿主，`D:` 盘不存在）：YAML 改动以 `deliveryShape` 字节一致 + 单测为据，
      live 复验待补；`contracts.spec.ts` 仅增字段/默认值断言，无 schema 形变；文档门禁双 exit 0

### #41 测试同步审查跟进：三处实现 bug 与覆盖锁

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（AGENTS 测试同步习惯的跟进提交；无 G 号）
- **优先级**: 高（含一处 load-bearing：incident 永不到阈值）
- **分类**: 四 · DSH 插件轨道

#### 问题描述

按 AGENTS 习惯派 review 子代理扫本轮触及的插件单测（`ses_ed0b26b6`，只读审查、未改文件），
全量当时 132/1 绿。报告三处有证据的实现 bug + 若干覆盖缺口：

- **D1（load-bearing）**：`unchangedVerdict` 计了 incident，但 `execute` 成功分支无条件 `noteSuccess`
  （`effect !== "unknown"` 即清）——unchanged 连败每次被清零，`incident` 永不到 3，checker persona 的
  incident 回放永不触发。
- **D2**：`reresolveAsCoordinate` 内的传输死（`callTransport`/`requireScreenSize` 抛 `environment:`）
  发生在 `buildCall` 的 try 之外，直达 `execute` catch 判成 `internal`（双前缀 `internal: environment: …`，
  模型被告知勿重试、熔断不记）。
- **D3**：`index.ts` 探针截图直调传输，死机时无前缀抛错→ `internal`，默认配置（无 `screenSize`）下首动作
  报 internal 且熔断不开。
- 另：`defineTool` 对分类器先验参（非法直返 false）——分类测试须传合法参；legacy `"Failed"` → environment
  属 S4 fail-safe 已有语义，值得钉死。

#### 整改方案与实施

1. D1：成功分支 `effect` 为 `unchanged` 时跳过 `noteSuccess`（`unknown` 早已跳过）。
2. D2：`reresolveAsCoordinate` 调用包 try/catch——`environment:` 前缀转环境失败返回，真无前缀才重抛走 internal。
3. D3：探针截图传输异常返回 `undefined`（探针 miss），由 `requireScreenSize` 按既有 `environment` 文案分类开闸。
4. 锁：unchanged 累积到 incident（Tier1 同形已有 G33 底）、mid-ladder/截图分支/D3 探针三处传输死 environment、
   `Failed`→environment fail-safe 钉、`swipe` 缺 target/`stop_app` 空包/未知动作/合法 key 映射四组、
   incident 里程碑正反、前缀钉死（`task:`/`environment:`，cooling 无前缀系 guard 原生形态，不断言它）。

#### 验收标准

- [x] `pnpm test` ⇒ **141 passed / 1 skipped**（净增 9）；`pnpm run build` 0 error
- [x] 变异校验：D1 回退（成功分支无条件清零）⇒ 两红（恰为 D1 签名）；D2 去 catch ⇒ `internal: environment:` 红；
      D3 去 catch ⇒ `internal: Connection closed` 红
- [x] 未做项（如实记）：review 提的 harness 四合一收敛、假定时器、py 侧 FastMCP 面行为测试、
      超时-dispose-respawn 锁—— Consolidation 计划见 review 会话记录，TODO 测试债行已覆盖方向，不另开工；
      `classify.spec.ts` 成功断言 vacuous 状况保留（改函数超出本轮）

### #42 G43：spike 复位与判据固化成脚本（live deferred）

- **日期**: 2026-10-12
- **状态**: ✅ 脚本交付并锁定；live 跑通 deferred（本机无 adb/模拟器，P1-live 接）
- **优先级**: 高（判据错会颠倒黑白；P1 多任务验收的前置）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「G43 固化轮」住在 `TODO.md`（spec 提交早于实现提交，按 R22），结案即删

#### 问题描述

spike 复位用 `adb shell settings put secure ui_night_mode`，在 MuMu ROM 上根本不生效；
`settings get` 读 2 而屏已深——判据错把成功记成失败。且复位/判据散在对话与 TODO 里，无可复跑载体。

#### 整改方案与实施

1. `scripts/spike_reset.py`（stdlib only）：`reset-home`（am start HOME + `LawnchairLauncher`
   断言）、`reset-light`（`cmd uimode night no`，`settings put` 刻意缺席）、`shot`（`exec-out screencap`）、
   `oracle`（只打 `settings get` 旁证 + 截图核对清单，不判像素）；`--serial`（默认 `$ADB_DEVICE_SERIAL`）、
   `--dry-run`（CI/无设备可跑）；T1/T2 目标文本逐字进 `--help`。
2. `tests/unit/scripts/test_spike_reset.py`（3 条）：dry-run 全命令在场、`settings put` 永不出现、
   缺 serial 非 dry-run 报 2。

#### 验收标准

- [x] `--help`/`--dry-run` exit 0；`ruff check` + `format --check` 绿；pytest 3 passed
- [x] live 未跑（如实记）：本机无 adb；P1-live 用此脚本复位
- [x] 文档门禁双 exit 0

### #43 G58：9 文件纯格式 churn 关账

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（另 3 处 E731 同轮顺手修，见下）
- **优先级**: 低（CI 门禁）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 无独立 spec（机械改写，查现状即方案：221 域现状见 #37 轮；本轮 `format --check` 点名 9 文件）

#### 问题描述

锁内 ruff 下 9 文件报 would-be-reformatted（`apps/admin_console` 2 / `artemis` 3 / `setup.py` /
`tests` 2 / `third_party` 1），CI `python-quality` 的仓级格式检查必红。另 `ruff check .` 在
`test_task_queue_service.py` 报 3 处 E731（HEAD 版字节级核对，`capture = lambda` 既有）。

#### 整改方案与实施

1. `uv run ruff format .`（9 文件，零语义）；3 处 lambda 改 `def`（同文件已动，零语义；否则 lint job 仍红）。
2. 受影响 py 面回归：`tests/unit/admin_console/test_task_queue_service.py` + `tests/unit/mcp`。

#### 验收标准

- [x] `ruff format --check .` 663 绿；`ruff check .` 全绿
- [x] pytest ⇒ **279 passed / 1 skipped**（上两文件集）
- [x] 文档门禁双 exit 0

### #44 细碎六项联关：G8/G11/G14/G24 验锁直关，G10 信号透传，G13 在飞去重

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（G26 PID 语义另立项；spec 提交 `36f5205` 早于实现，关账时段落已随结案删除）
- **优先级**: 中（收尾；含一次真实现 bug 修法过程见下）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「细碎收尾轮」住在 `TODO.md`（spec 提交早于实现提交，按 R22），结案即删

#### 问题描述

- G8/G11/G14/G24 是收缩/保留语义，实现早已存在：G8 = 汇报双轴 + `concludeTurn`（G41 锁），
  exit-code 映射随 worker 消失（无残留）；G11 = 工具层错误分类（`classify.ts` + G38/G33/callTransport 锁）；
  G14 = 汇报 enum + 值锁；G24 = 归一域/端侧索引（`coord`/`hierarchy` + G42 七锁 + 真机/mock 双证）。
- G10：`exec.signal` 只事后判，取消要等应答或自超时；SDK 2.0.0 `callTool(params, options?)` 承 signal。
- G13：同 goal 短防抖在工具内无载体；逐动作 1s 窗会误伤合法连击，故取 in-flight 去重。

#### 整改方案与实施

1. G10：`signal` 穿透 `dispatch → buildCall/resolvePixelTarget/callTransport → ActionClient.callTool → SDK`
   （`index.ts` 无 exec 的探针/帧路径不动）；`mockServer` + router 两层取消锁。
2. G13：`execute` 内 in-flight Set（变更类专属，同 agent 同签名在飞即拒，`finally` 清；只读与串行重复永不误伤；
   `agentIdOfCall` 经 RouterOptions 进，缺省 anonymous）。`tests/dedup.spec.ts` 五锁。
3. G8/G11/G14/G24：验锁直关，不动码。

#### 验收标准

- [x] `pnpm test` ⇒ **148 passed / 1 skipped**（净增 7）；`pnpm run build` 0 error
- [x] 变异校验：信号不透传 ⇒ 取消用例 5s 红；去重摘 ⇒ 并发用例双成（超时红）
- [x] 修法过程如实记：实现中漏写 `finally` 清理致一切重复（合法串行亦）被拒—— admit 系单测全红定位
  （并发拒对、串行/异 agent/异 target 全错），补 `delete` 后转绿；另 admit 系两测初版误把闸门排队读成
  拒绝，已改按“排队非拒绝”断言
- [x] 文档门禁双 exit 0

### #45 派生事实第三处漂移：抄件是陈的，而量它的尺子绑在 checkout 的换行符上

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（抄件按实测更正 + 量法与 EOL 解耦并两处锁死）；**G60/G61 新立未办**
- **优先级**: 中（不改产品行为，但它是 `#30`/`#31` 那条规则自己的失效）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「偏差关账轮」住在 `TODO.md`（spec 提交 `4f7868a` 早于实现提交，按 R22），结案即删

#### 问题描述

拉取 29 个提交（`61f23a1` → `419b9df`）后逐条核对状态页，量出三处**已发布文档里的不符**：

1. `docs/TODO.md` §零「测试面」行写插件 vitest `83 passed / 1 skipped`；同一份 `419b9df` 上实跑
   `pnpm --config.verify-deps-before-run=false test` 得 **148 passed / 1 skipped（18 个 test file）**。
   `#40` 净增 21、`#44` 净增 7，两轮都写了自己的验收数却没有回抄 §零——即 `#31` 立规则要防的那种抄件。
   py 侧同一行写 `tests/unit/mcp` `224 passed`，实跑为 **224 passed + 1 skipped**（漏了 skipped 那格）。
2. `docs/migration/README.md` §三 体量表 **9 行**与实测不符，`scripts/check_doc_tables.py` 在 HEAD
   `419b9df` **就是红的**（FAIL: size table）。而 `#44` 的验收框写着「文档门禁双 exit 0」——
   **那条框在它自己的提交上即假**。#44 正文按「编号一经发布不得改写」保持原样，错记在此。
3. ②为什么刷一次还会漂：`measured()` 取的是**工作树字节数**，而工作树换行符取决于最后写它的进程——
   本机 `core.autocrlf=true`、仓库无 `.gitattributes`，实测 `docs/migration/inventory/03-*.md`
   工作树 46472 字节 / blob 46162 字节（差 310 个 CR），其余文件工作树与 blob 相同。
   表里的数字出自 `2ab17cb`（体量改为脚本生成那次）的 **CRLF 工作树**，之后那些文件以 LF 重写，
   1406 行 ≈ 1.4 KB 就差了出。**同一条 commit 在两台机器量出两个数**——规范化后复测，
   `inventory/01…05` 那一格从 215.9 KB 变成 215.6 KB，正是那 310 个 CR。
4. 附带查出**为什么没人发现**：两枚文档门禁（`check_doc_registry.py` / `check_doc_tables.py`）
   在两处文档里被称做「门禁」，但 `.github/workflows/*` 里**没有任何 step 跑它们**（搜索命中 0）。
   红的体量表可以存活两日，靠的就是人工自证。登记为 **G60**。
5. 同一根因在测试面也咬了一口：`uv run ruff format --check` 报 `tests/unit/test_config_package.py`
   「would be reformatted」，而该文件 blob 是**纯 LF**（37083 字节、CR=0），工作树却是 37932 字节、
   849 个 CR 与 57 行 LF **混在同一文件里**——CI 检出纯 LF 所以不报，这条红是本机独有的，
   不是代码缺陷。登记为 **G61**（根因层：仓库无 `.gitattributes`，字节口径随 checkout 变）。
   本轮**没有**顺手 `ruff format` 那个文件：那会把 849 行换行符一起写进提交，属未登记的越界改动。

#### 整改方案与实施

- **`scripts/check_doc_tables.py`**：`measured()` 先 `raw.replace(b"\r\n", b"\n")` 再数行与字节，
  把派生量与 checkout 换行符解耦——只 `--refresh-sizes` 是把漂移推到下一台机器上，不换量法修不好。
  模块 docstring 补上这条口径与出处；`--selftest` 增 **(i) 不变量例**（同一内容写成 CRLF 与 LF 两份临时文件，
  必须量出同一行数与 KB，且行数仍为 4——防「剥 CR」把行数也剥错）。
- **两处可执行判据**：`--selftest` 的 (i) 是一处；另一处是新增 `tests/unit/scripts/test_doc_table_sizes.py`
  三条（EOL 无关 / 多文件行求和 / 改旧值必报），走 CI 已有的 `uv run pytest tests/unit`——这是本口径目前唯一进得了 CI 的路径。
- **`docs/migration/README.md`**：§三 表下「体量口径」那句原文是「**KB** 按文件**真实**字节数除以 1024」，
  「真实」正是把工作树绑进度量的那个词，改为「按 **LF 规范化后**的字节数」；9 行由 `--refresh-sizes` 生成，不手打
  （上一回合 `e7f3589` 就是手打了 `TODO.md` 一格，其余没动）。
- **`docs/TODO.md`**：§零 测试面行按实测改写并保留复测命令；§零「下一步」补第 7 条（本轮结案 + G60 指针）；
  §四 差距清单加 **G60** 行，`docs/migration/registry.md` 现行在册同步一行（取号按 registry）。

#### 验收标准

- [x] `uv run python -X utf8 scripts/check_doc_tables.py` ⇒ 全 OK（含 `(size table)` 那一行）
- [x] `uv run python -X utf8 scripts/check_doc_tables.py --selftest` ⇒ 注入缺陷全过 + `OK [i]` 不变量例
- [x] **变异校验**：把 `measured()` 改回 `len(raw)` ⇒ 新 pytest 两条变红
      （`test_size_does_not_track_line_endings`、`test_multi_file_row_is_a_sum_across_line_endings`），
      `--selftest` 的 (i) 报 `((200, '1.0') vs (200, '1.2'))`——做出一次才恢复
- [x] **变异校验顺手照出两处「虚锁」，都已修**：① 第一版两处判据都用 4 行样本，KB 只保留一位小数
      （一步 = 102.4 字节），于是 CRLF 与 LF **量出同一个数**，摘掉规范化也照样绿——样本加宽到 200/400 行才咬得住；
      ② (i) 原先排在 (a)–(h) 之后，而未规范化的测量会让前面那些读真实文档的检查先红先退出，
      **根本走不到 (i)**——已提到 `selftest()` 开头。两处都是「测试通过但不证明任何东西」的形态
- [x] `uv run python -X utf8 scripts/check_doc_registry.py` ⇒ OK（现行 114 号，registry 行数与来源一致）
- [x] `uv run python -X utf8 -m pytest tests/unit/scripts -q` ⇒ 绿；`uv run ruff check` ⇒ 干净
- [x] `git grep -n "83 passed" -- docs/TODO.md AGENTS.md plugins docs/migration/README.md` ⇒ 空
      （陈旧值只可能留在已结案条目的正文里：`#32` 那格记的是它当时的实测数，编号不得改写，属正确保留）；
      §零 的两个数与实跑一致
- [ ] **G60 未办**：两枚门禁接进 CI 需改 `.github/workflows/*`，且要先定「deterministic Python tests」那条
      `if: github.event_name == 'workflow_dispatch'` 的门槛（受 **G54** 牵制）——**待用户决策**

### #46 G60：两枚文档门禁接进 CI（此前它们只存在于人工自证里）

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（step 已落 `python-quality` job，无 `if`；真 run 尚未观测到，受 G54 限制，如实写明）
- **优先级**: 中（不改产品行为，但它决定 `#31`/`#45` 那两条规则是否真的有人守）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「G60 + G61 实施轮」住在 `TODO.md`（spec 提交 `9479b38` 早于实现提交，按 R22），结案即删

#### 问题描述

`#45` 量出：`scripts/check_doc_registry.py` 与 `scripts/check_doc_tables.py` 在 `AGENTS.md` 与两份迁移文档里
被称做「门禁」，但 `.github/workflows/ci.yml` 里**没有任何 step 跑它们**（搜索命中 0）。后果不是理论上的：
体量表按 blob 内容（与 checkout 换行符无关）复测，自它**被脚本生成的那次提交** `2ab17cb` 起就从未在任何 LF 检出上匹配过
（`inventory/01…05` 写 216.9 KB 而内容 215.6 KB，`upstream-plugin-forms.md` 写 11.8 而内容 11.7），
而 `#32`–`#44` 里 6 条验收勾着「文档门禁双 exit 0」——**没有机器执行、又没有复跑命令的自证，可以连续假两日**。

#### 整改方案与实施

- `.github/workflows/ci.yml`：在 `python-quality` job 的 `Lint Python` 之后、`Enforce quality ratchets` 之前
  新增一步 `Check documentation gates`，依次跑
  `check_doc_registry.py` / `check_doc_tables.py` / `check_doc_tables.py --selftest`（三条都带 `-X utf8`，与 `AGENTS.md` 口径一致）。
- **不加 `if`**（用户已决「沿用 dispatch」= 不动现有那条 `if: github.event_name == 'workflow_dispatch'`）：
  门禁本身对所有能产出 run 的事件都执行；**G54 未解时该 fork 只有手动派发会产出 run**，
  所以本轮的真实收益是「派发时有机器复核 + 验收可引用 run id」，不是 push 拦截——这句必须写在这里，
  否则就是把 `#45` 批评过的「写成由 CI 保证」重犯一遍（**R27 第 4 条**）。
- 顺序不可颠倒：门禁进 CI 的前提是它在 LF 检出下也绿，而这是 `#45` 把体量改成 LF 规范化测量才成立的
  （改之前它是绿的 Windows、红的 Linux——把它接进 CI 只会天天假红）。

#### 验收标准

- [x] YAML 可解析，且新 step 确实落在 `python-quality`、`if` 为空：
      `uv run python -c "import yaml,io; ..."` ⇒ `job: python-quality | step: Check documentation gates | if: (none)`
- [x] 三条命令本地各自 exit 0（`check_doc_registry.py` 现行 116 号、`check_doc_tables.py` 12 行体量、`--selftest` 8 例全触发）
- [x] **R27 变异校验**：把任一文档改一个字节而不 `--refresh-sizes` ⇒ `check_doc_tables.py` 变红
      （此路由 `--selftest` 的 (g) 例常驻守着，且新增的 `tests/unit/scripts/test_doc_table_sizes.py` 会随
      CI 既有的 `uv run pytest tests/unit` 一起执行）
- [ ] **未验证到真 run**：本轮不推送（推送须用户明示），且 G54 使 `on: push` 不产出 run；
      下一次 `gh workflow run` 派发才是这条 step 的第一手证据，届时须把 run id 记进台账

### #47 G61：`.gitattributes` 让行尾成为仓库事实（本机 `ruff format --check` 的假红到此为止）

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（`.gitattributes` 落地；实测 renormalize 对文本 blob **零改动**）
- **优先级**: 中（与 #46 同轮；它是 #45 那个「同一条 commit 两台机器两个数」的根因）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 与 **#46** 共用 `TODO.md` 那条「G60 + G61 实施轮」（spec 提交 `9479b38`），结案即删

#### 问题描述

`#45` 的根因是量法把工作树字节当事实，而**工作树换行符由机器决定**：本机 `core.autocrlf=true`、
仓库没有 `.gitattributes`。动手前先量了波及面（不按「renormalize 会炸全仓」的想象决策）：

- `git ls-files --eol`：**757 个 `i/lf w/crlf`、147 个 `w/lf`、2 个 `w/mixed`、28 个 `-text`**；
- 逐 blob 查 CR：**带 CR 的 blob 恰为那 28 个，且全是二进制**（png/jpg/ico/gif/mp4/mp3/apk/keystore）
  ⇒ 文本 blob 本来就是纯 LF；
- 混行尾只存在于 2 个本机文件：`docs/migration/README.md`（48 个 CR）与
  `tests/unit/test_config_package.py`（849 个 CR 与 57 行 LF 混在同一文件），
  后者就是 `uv run ruff format --check` 唯一报红的那一个——**CI 上是纯 LF 检出，从来不红**。

#### 整改方案与实施

- 新增 `.gitattributes`：`* text=auto eol=lf`；`*.bat`/`*.cmd` 显式 `eol=crlf`
  （仓库里有 `start.bat` 与 `plugins/autogamer-device/spike/run-headless.cmd`，cmd.exe 对 LF 批处理的标签/`goto` 有已知故障面）；
  8 种实际存在的二进制扩展显式 `binary`。
- `git add --renormalize .` 后**先看暂存区再提交**：`git diff --cached --stat HEAD` 只有 `.gitattributes` 一个新增文件
  ⇒ **实测零个文本 blob 被重写**，历史与既有分支不受影响（这条是本项改动安全性的关键证据）。
- 那 2 个混行尾的工作树副本按 blob 规范化（剥 CR），`git diff` 显示**内容无变化**（blob 本就是 LF），
  `git ls-files --eol` 的 `w/mixed` 计数 2 ⇒ 0。

#### 验收标准

- [x] `git ls-files --eol | grep -c "w/mixed"` ⇒ **0**（原先 2）
- [x] `uv run ruff format --check` ⇒ **本机转绿**：`666 files already formatted`（原为 1 个假红文件）
- [x] `git diff --cached --stat HEAD` ⇒ 仅 `.gitattributes`（+18 行），**无文本 blob 变化**
- [x] 两枚文档门禁 + `--selftest` 仍绿；`uv run python -X utf8 -m pytest tests/unit/scripts tests/unit/mcp -q` ⇒ **230 passed, 1 skipped**
- [x] `git ls-files --eol` 里 28 个仍为 `-text`，`*.bat`/`*.cmd` 为 `w/crlf`
- [ ] 遗留（不在本轮范围）：757 个 `w/crlf` 的本机副本要等**重新检出**才变 LF，
      本轮不强推（`git restore`/`checkout-index -f` 对"内容已等同 blob"的文件是 no-op）；
      新克隆与 CI 从此固定为 LF

### #48 更正 #47 验收里一条勾早了的框：`*.cmd` 并非都是 `w/crlf`

- **日期**: 2026-10-12
- **状态**: ✅ 已更正（提交 `03993bf` 落地后立即实测发现）
- **优先级**: 低（一条验收判据的精确性，无产品影响）
- **分类**: 四 · DSH 插件轨道

#### 问题描述

#47 的验收勾了「`git ls-files --eol` 里 `.bat`/`.cmd` 显示 `w/crlf`」，实测只有一个成立：

```
i/lf  w/crlf  attr/text eol=crlf    start.bat
i/lf  w/lf    attr/text eol=crlf    plugins/autogamer-device/spike/run-headless.cmd
```

`run-headless.cmd` 的**工作树副本是 LF**（早前有工具就地写过它），而属性要求 CRLF——
按 R27 第 1 条，这条勾当时不该打：它没有对应的一条已跑命令。#47 编号已发布，正文不改写，错记在此。

#### 整改方案与实施

不新增代码改动，只把判据改成**可复跑且当前为真**的形式：`attr/text eol=crlf` 已对两个文件生效
（属性侧正确，这是 `.gitattributes` 真正的交付物），工作树副本何时变 CRLF 属"重新检出"那一条遗留项
（#47 已勾 `[ ]` 写明：757 个 `w/crlf` 与这 1 个反向差异都要等新检出）。
顺带记下这条观察：spike 的 `.cmd` 在 LF 下由 cmd.exe 执行，标签/`goto` 有已知故障面——
若 spike 复跑出现"文件能跑但流程不对"，先看这里。

#### 验收标准

- [x] `git ls-files --eol | grep -E "\.(bat|cmd)$"` ⇒ 两行都是 `attr/text eol=crlf`（属性生效，与检出状态无关）
- [x] `git ls-files --eol | grep -c -- "-text"` ⇒ 28（在库二进制未被误当文本）
- [x] `git ls-files --eol | grep -c "w/mixed"` ⇒ 0
- [x] 复跑命令写进本条，后续任何人可自行核对

### #49 判据红了却照样提交：表格行里写了换行，而我的命令链用管道吞掉了退出码

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（表格修复 + 判据命令形状改成可看退出码，并补进 R27 第 5 条）
- **优先级**: 中（不是产品缺陷，但它让 #46 刚接进 CI 的那类门禁在人工路径上失效）
- **分类**: 四 · DSH 插件轨道

#### 问题描述

改 `docs/TODO.md` 的 G54 行时，我把一段带**换行**的长文本贴进了 markdown 表格单元：
表格行不能跨物理行，于是那一行被劈成 **8 个物理行**，`scripts/check_doc_tables.py` 立刻报两条——

```
PROBLEM: docs/TODO.md: line 119 does not close with a pipe
PROBLEM: docs/TODO.md: block at line 127 row 2 is not a separator row
FAIL: docs/TODO.md
```

**门禁是对的，是我的调用方式没牙**：那条链写成
`uv run python -X utf8 scripts/check_doc_tables.py docs/TODO.md 2>&1 | tail -1 && ... && git commit ...`，
管道末端的退出码属于 `tail`（0），`&&` 于是按"通过"继续走，**塌掉的表被提交进 `a311bb9`**。
这正是 R27 批评过的形态，只不过这次红的是执行判据的那只手。

#### 整改方案与实施

- `docs/TODO.md`：把 G54 行折叠回**单一物理行**（脚本按 `| G54 |` 起点到首个以 `|` 结尾的行合并），
  复核该单元格仍是 **3 cells**、`**` 计数 60（偶）、反引号计数 104（偶），无残留换行。
- 命令形状统一改为 `cmd > /tmp/out 2>&1; echo "exit=$?"` 再读输出；本轮起所有门禁复跑都用这个形状。
- 把这条教训补进 [守则 R27](migration/plugin-contract-rules.md) 的**判据第 5 条**：
  判据命令不许拿过滤器/分页器的退出码当判据（`set -o pipefail` 或重定向后读 `$?`）。

#### 验收标准

- [x] `uv run python -X utf8 scripts/check_doc_tables.py; echo $?` ⇒ **exit=0**（不带管道）
- [x] `uv run python -X utf8 scripts/check_doc_registry.py; echo $?` ⇒ **exit=0**
- [x] `uv run python -X utf8 scripts/check_doc_tables.py --selftest; echo $?` ⇒ **exit=0**，8 例注入全触发
- [x] G54 行单物理行、3 cells；`git status` 干净
- [x] **变异校验**：同一行内再插一个换行 ⇒ `check_doc_tables.py` 报 `does not close with a pipe`
      且 `echo $?` 为 1（证明修复后的判据仍有牙，且这次不会被管道吃掉）

### #50 离线 action 面悄悄少了 `compare_ui_frames`：漂移锁改吃生成的 fixture

- **日期**: 2026-10-12
- **状态**: ✅ 已关闭（mock 补第 14 个工具 + 三种判定分支，锁换成吃生成的 fixture 并做过变异校验）
- **优先级**: 中（不影响真机，但影响「离线能验的东西」与 P2 的 mock 交付）
- **分类**: 四 · DSH 插件轨道

#### 问题描述

为把离线端到端演练真跑一遍，用插件自己的 `ActionClient` 打了两遍同一个脚本：

```
ARTEMIS_MOCK_DRIVER=1 node plugins/autogamer-device/scripts/spike-mcp.mjs
  [spike] tools (14): back, compare_ui_frames, ... tap          ← 真 py 面
  take_screenshot → environment error: connect to adb server failed [WinError 10061]

SPIKE_COMMAND="node plugins/autogamer-device/scripts/mock-action-server.mjs" node .../spike-mcp.mjs
  [spike] tools (13)                                            ← mock 面（修之前）
```

两件事一起暴露：① **`ARTEMIS_MOCK_DRIVER=1` 并不能让 `artemis mcp --type adb` 离线**——那一面仍要连
adb server（`127.0.0.1:5037` 被拒即环境级失败），所以「离线 action 面」的唯一去处是插件自带的
`scripts/mock-action-server.mjs`；② 那个 mock 只列 **13 个工具，缺 `compare_ui_frames`**，而 py 面自
**#12**（G39 路线 A）起就是 14 个。也就是说**效果验证这条路径在离线环境里根本不存在**，而
`tests/mockServer.spec.ts` 当初的断言是一份**手抄的 13 名列表**，与 mock 一起腐在同一处——
正是 `#30`/`#45` 反复处理的那类「第四份抄件」。

#### 整改方案与实施

- `scripts/mock-action-server.mjs`：TOOLS 补 `compare_ui_frames`；新增 `effectVerdict()`，
  按 py 契约形状返回 `{"changed": bool, "ratio": number}`（插件 `compareFrames` 就 `JSON.parse` 后读布尔
  `changed`，见 `src/index.ts:204`），判定由 `MOCK_EFFECT=changed|unchanged|error` 选，**默认 changed**。
  这样离线也能跑正例、反例与拒绝分支，不再只能验「有管道」。
- `tests/mockServer.spec.ts`：把那份手抄列表换成**吃生成的 fixture**
  `tests/fixtures/py-action-tools.json`（唯一权威是 `spike-mcp.mjs --write` 从真 py 面抓的 14 项），
  比较两侧排序后的集合；另加两条锁：mock 返回形状符合 G39 契约、`unchanged` 与 `error` 两分支。
  `MOCK_EFFECT` 经构造器 `env` 传（`ActionClient` 是**替换**子进程 env 而非合并，第一版我用
  `process.env` 赋值，测出来 verdict 仍是 `true`，据此改成显式传 env）。

#### 验收标准

- [x] `SPIKE_COMMAND="node plugins/autogamer-device/scripts/mock-action-server.mjs" node plugins/autogamer-device/scripts/spike-mcp.mjs` ⇒
      `[spike] tools (14): …`、`take_screenshot → OK: iVBOR…`、exit 0（全程离线）
- [x] `pnpm --config.verify-deps-before-run=false test` ⇒ **150 passed / 1 skipped**（18 文件，净增 2）
- [x] **变异校验**：从 mock 的 TOOLS 里摘掉 `compare_ui_frames` ⇒
      `expected [ 'back', 'erase_one_char', …(11) ] to deeply equal [ 'back', 'compare_ui_frames', …(12) ]`
      该锁变红（`exit=1`），恢复后转绿——证明这条锁真在观察
- [x] `pnpm run build` ⇒ exit 0
- [x] 两枚文档门禁 + `--selftest` ⇒ exit 0（按 **#49** 的形状跑，不拿管道退出码当判据）
- [ ] 未做（明确留白）：真机那一侧未复跑（本机无设备/无 `dsh`）；mock 的 PNG 仍是 33 字节 IHDR 桩，
      不含真实像素，所以像素级 ROI 分支在离线路径上仍只能靠单测

### #51 更正 #50：JS stub 给 `compare_ui_frames` 发明了 py 没有的 `ratio` 键

- **日期**: 2026-10-13
- **状态**: ✅ 已更正（stub 与 py 逐字同形，断言改锁精确键集合）
- **优先级**: 低（不改变产品行为，但它是一条被测试锁住的**假契约**）
- **分类**: 四 · DSH 插件轨道

#### 问题描述

`#50` 给插件自带 JS stub 补 `compare_ui_frames` 时，返回写成 `{changed, ratio}` 并加了一条
`typeof parsed.ratio === "number"` 的断言。读 py 源码后发现**真实形状只有一个键**：
`artemis/mcp/adb_server.py` 里 `return json.dumps({"changed": changed})`，
失败分支是 `Error: frame decode failed: …` 与 `Error: {e}`。既有
`tests/unit/mcp/test_adb_server_contract.py` 早就把 `{"changed": False}` / `{"changed": True}` 逐字锁住。
⇒ stub 与它自己那条测试**共同虚构了一份 py 从不产生的契约**，与 `#28`（fixture 锁住假死信道）同类。
#50 编号已发布，正文不改写，错记在此。

#### 整改方案与实施

- `plugins/autogamer-device/scripts/mock-action-server.mjs`：`effectVerdict()` 改为
  `JSON.stringify({ changed: mode !== "unchanged" })`，注释写明「extra field = inventing contract」并指回本条。
- `plugins/autogamer-device/tests/mockServer.spec.ts`：断言由「读 `changed` + 判 `ratio` 是数字」
  改为 `toEqual({ changed: true })`——**键集合相等**，多一个键就会红。

#### 验收标准

- [x] `pnpm --config.verify-deps-before-run=false test` ⇒ **150 passed / 1 skipped**（数量不变：本条是改判形状，不是加测）
- [x] 与 py 侧实测对齐：`--type mock` 的 `compare_ui_frames` 同帧返回 `{"changed": false}`（见 **#52** 的端到端跑）
- [x] **变异校验**：`py` 侧 `{"changed": …}` 之外若将来多出任何键，`toEqual` 立刻红；
      stub 侧手工塞回 `ratio` 时该测试也红（做过一次才恢复）
- [x] 两枚文档门禁 + `--selftest` ⇒ exit 0

### #52 G62 结案：`artemis mcp --type mock` —— 插件终于能吃 py 实现，而不是 JS 桩

- **日期**: 2026-10-13
- **状态**: ✅ 已关闭（新增 1 个 py 文件 + CLI 一个分支，**未改任何现有 py 文件的行为**）
- **优先级**: 高（P2「mock driver」栏目的真实交付；也是本机无设备/无宿主时唯一还能推进的主干）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「G62 离线 action 面」住在 `TODO.md`（spec 提交 `3fccb4f` 早于实现提交，按 R22），结案即删

#### 问题描述

`artemis mcp --type adb` 在没有 adb server 的机器上**列得出工具、调不动**：
`_get_controller` 在 `adb_server.py:155-159` 无条件 `AdbClient(host, port)` + `device_list()`，
无设备即 `raise`。`ARTEMIS_MOCK_DRIVER=1` 也救不了——该 env 在旧 py 栈的 `drivers/factory.py:52` 生效，
而 adb 面此前没有任何入口用到它（实测：`take_screenshot` 仍报
`Controller lazy initialization failed: connect to adb server failed: [WinError 10061]`）。
⇒ 14 工具契约与效果验证此前**只能在插件自带的 JS stub 上验**，py 实现本身离线跑不起来。

#### 整改方案与实施

- **新增 `artemis/mcp/mock_server.py`**：`seed_mock_controllers()` 用仓库现成的 `MockActuator`
  （`actuators/mock.py:32`，即「`AdbActuator` 绑 `MockDeviceDriver`，走同一段生产坐标换算与 controller 分发」）
  造出 controller，塞进 `adb_server` 的两条缓存短路。
  **关键坑（探针第一版栽过，如实记）**：只置 `_GLOBAL_CONTROLLER` 不生效——应用自己加载 `.env`，
  本机 `ADB_DEVICE_SERIAL=127.0.0.1:16384` 恒有值，`_get_controller` 走的是 `_CONTROLLERS[serial]` 那条。
  ⇒ 实现把 `ARTEMIS_DEVICE_ID` 钉成 `MOCK_SERIAL`（它在查找链里**先于** `ADB_DEVICE_SERIAL`），
  并同时登记 `MOCK_SERIAL` 与现有 `ADB_DEVICE_SERIAL` 两个键，使 mock 与 `.env` 内容无关。
- **`artemis/interfaces/cli/commands/mcp.py`**：加 `elif st == "mock"`（复用同一个 `adb_mcp` 对象与
  `configure_stdio_mode`，后者只做 logging 改写与 `ARTEMIS_IPC_PORT=""`，**不探设备**），
  并更新 `--type` 帮助文本与不支持类型的报错。
- **`tests/unit/mcp/test_mock_server.py`（4 条）**：fixture 里把 `AdbClient` 换成
  `pytest.fail("mock surface reached real adb")`，于是「离线」不是靠机器恰好没设备，而是**被强制证明**。
  未预置 ⇒ 解析设备即红；预置 ⇒ 截图/点击/返回键全通，`action_history` 记到坐标；
  并把 **mock 设备自己产出的帧**喂给真比较器（`compare_ui_frames` 的形状本身已由
  `test_adb_server_contract.py` 锁死，这里刻意**不重复锁**，见「同一事实只在一处」）。
- **顺带更正 #51**（stub 的 `ratio` 假契约）。

#### 验收标准

- [x] 等价性（同一权威，不是另起一个面）：同一个 spike 分别打两面，工具清单**逐字节相同**——
      `[spike] tools (14): back, compare_ui_frames, … tap`（`--type adb` 与 `--type mock` 的输出行 `=` 比较通过）
- [x] `SPIKE_COMMAND="uv run artemis mcp --type mock" node plugins/autogamer-device/scripts/spike-mcp.mjs` ⇒ exit 0；
      `take_screenshot → OK` 解出来是**真 PNG**：magic `89504e470d0a1a0a`、`IHDR 1080x2400`；
      `get_ui_hierarchy → [{"text": "Settings", "bounds": [0, 0, 1080, 100]}]`。对照：同机 `--type adb` 只得 adb 拒连
- [x] `uv run pytest tests/unit/mcp -q` ⇒ **228 passed + 1 skipped**（基线 224+1，净增 4）
- [x] `uv run pytest tests/unit -q` ⇒ **2597 passed, 7 skipped**（基线 2593/7 + 4，**零回归**）
- [x] **变异校验**：摘掉 `_CONTROLLERS[MOCK_SERIAL]` 那一行 ⇒ 3 条测试红并报 `mock surface reached real adb`（做出一次才恢复）
- [x] 插件侧 `pnpm test` ⇒ 150 passed / 1 skipped；`run build` exit 0；`uv run ruff check` 干净、`ruff format --check` 668 files 全净
- [x] G62 从 `TODO.md` §四 移除、`registry.md` 已关闭表加行、§五「一期改造登记」第 2 项落地、两枚文档门禁重跑 exit 0
- [ ] 留白（如实）：mock 帧是驱动给的占位图（75 字节合法 PNG，尺寸真、内容空），
      所以**像素级 ROI 分支**在离线路径上仍只能靠单测；真机正反例仍待设备在场时复跑

### #53 更正 §零：「CI 用 `spike-mcp.mjs` 做同一比对」是一条从没成立过的陈述

- **日期**: 2026-10-13
- **状态**: ✅ 已更正（并由此立 **#54** 把它变成真的）
- **优先级**: 中（它是插件契约唯一那份 py 工具面产物的可信度问题）
- **分类**: 四 · DSH 插件轨道

#### 问题描述

`docs/TODO.md` §零「测试面」行写着：skipped 那条是 `AUTOGAMER_CONFORMANCE_PY=live` 的 opt-in 比对，
「**CI 用 `node scripts/spike-mcp.mjs` 做同一比对**」。核对工作流后为假：

- `.github/workflows/ci.yml` 里 `spike-mcp` **命中 0 次**；
- `plugin-contracts` job 的步骤只有 `pnpm install --frozen-lockfile` → `node scripts/gen-sse-events.mjs`
  → `pnpm run build` → `pnpm test`，**没有任何 Python/uv 环境**，根本跑不动那条命令。

⇒ `plugins/autogamer-device/tests/fixtures/py-action-tools.json`（插件路由转发的 14 个 py 工具名）
一直是**人工带着走的产物**：它由 `spike-mcp.mjs --write` 从活服务导出，但没有任何机器在之后重新对过它。
这条假陈述的来源与 `#45` 同族——把「应该如此」写成了「已经如此」；也与 **G60** 相互印证：门禁与比对
不在 CI 里，人工自证就会漂。#50/#52 的行文没有引用它，故无需改写已发布条目。

#### 整改方案与实施

§零 该行改为如实描述（CI 不重导 py 面），并由 **#54** 把这句话变成真的。
不在本轮悄悄改掉文字就完事：先按 registry 取号 **G63** 登记为未关差距，再在同轮结案，
这样「何时为假、何时为真」在台账里可查。

#### 验收标准

- [x] `grep -n "spike-mcp" .github/workflows/ci.yml`（修 #54 **之前**）⇒ 无命中，假陈述证实
- [x] `grep -n "CI 用 .node scripts/spike-mcp" docs/TODO.md` ⇒ 空（虚假表述已撤）
- [x] G63 先登记后结案：`registry.md` 现行在册与已关闭表各一行、本文件已关闭差距史一行
- [x] 两枚文档门禁 + `--selftest` ⇒ exit 0

### #54 G63 结案：py 动作面 fixture 由 CI 每次重导比对，不再是人工产物

- **日期**: 2026-10-13
- **状态**: ✅ 已关闭（CI 步骤已落 `python-quality`，本地用同一条命令验过，变异校验做过）
- **优先级**: 高（它把 #50/#52 那类「面与实现漂移」变成机器可拦）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「G63 把 py 动作面的 fixture 变成 CI 机器可验」住在 `TODO.md`（spec 提交 `06da044` 早于实现提交，按 R22），结案即删

#### 问题描述

见 **#53**：那份 fixture 从未在 CI 被重新比对。此前想接也接不了——
`artemis mcp --type adb` 在 runner 上没有 adb 也没有设备，`tools/list` 可以、任何调用都环境级失败，
把它接进 CI 只会得到一个天天红的步骤。**#52** 之后这条路才成立。

#### 整改方案与实施

- `.github/workflows/ci.yml` 的 `python-quality` job 新增两步（都**不带 `if`**）：
  `Set up Node.js`（显式 `22.22.3`，与 `plugin-contracts` 同一版本；不依赖 runner 预装的 node），
  以及 `Check the py action surface against the plugin fixture`：
  `SPIKE_COMMAND="uv run artemis mcp --type mock"` + `node plugins/autogamer-device/scripts/spike-mcp.mjs`。
  **不改 `spike-mcp.mjs`**：它的默认模式本来就是漂移检查（不匹配即 `console.error` + 非零退出，只有 `--write` 才重写）。
- 为什么用 `--type mock`：runner 无 adb 无设备，`--type adb` 只能列面；而 `--type mock` 全部 14 个工具都跑得动，
  且两面工具清单**逐字节相同**（同一个 `adb_mcp` 对象，#52 已实测）⇒ 校验的是 py 实现本身，不是第二个面。
- 为什么放 `python-quality` 而不是给 `plugin-contracts` 再装一套 uv：语义上这是 py 面的事，且该 job 已有
  `uv sync --dev --locked`，重复安装只是浪费时间。

#### 验收标准

- [x] YAML 可解析，两步确实落在 `python-quality` 且无 `if`：`step: Check the py action surface against the plugin fixture | if: (none) | env: {'SPIKE_COMMAND': 'uv run artemis mcp --type mock'}`
- [x] **本地跑 CI 将要执行的同一条命令** ⇒ exit 0，`[spike] tools (14): back, compare_ui_frames, … tap`
- [x] **变异校验**：从 fixture 删掉 `compare_ui_frames` ⇒ 同一条命令 **exit=1** 并报
      `fixture is out of date with the live server: compare_ui_frames — re-run with --write`；还原后转绿
- [x] 还原后 `git status` 只剩预期改动（fixture 未被这次改动写过）
- [x] 两枚文档门禁 + `--selftest` ⇒ exit 0
- [ ] 留白：这一步**尚未在真 run 里执行过**（G54 使 `on: push` 不产出 run；本轮推送与否不改变这一点），
      首次派发跑绿之前，它的效力是「本地已证 + 命令与 CI 逐字相同」，不得写成「CI 已保证」（R27 第 4 条）

### #55 G3 + G28 A 片：设备池闸门（parking / claimed-only / 全局并发 N）

- **日期**: 2026-10-13
- **状态**: ✅ A 片已关闭（机制在 TS、roster 由 config 注入）；**G64（roster 真来源）留在 §四**
- **优先级**: 高（D3「共享真机 + 完整闸门」的设备治理主体；P1 live 之前的最后一块离线大头）
- **分类**: 四 · DSH 插件轨道
- **方案原文**: 本节曾以「G3 + G28 设备调度 A 片」住在 `TODO.md`（spec 提交 `93cc463` 早于实现提交，按 R22），结案即删

#### 问题描述

`run_device_action` 只有一把 per-key FIFO 闸门，而键是 `deviceKeyOf(args, defaultDeviceKey)`
（`src/tools/runDeviceAction.ts:131`）：**没有 `device_serial` 的调用全部落到同一个 `default` 键上串行**。
G3 与 G28 要的空闲池 / parking / 全局并发上限因此一直不存在。三条权威口径都点名这件事不能被简化掉：

- `glossary.md:65` **parking** =「没有指定设备时，让一条消息先占住一台空闲设备」（G28）；
- `glossary.md:66` **auto 走空闲池，显式走 serial 队列**（G3）；
- py `artemis/runtime/device_lock.py:332` 原文「unclaimed `pending`/`any` ticket is *parked* on at most
  one device … **was counted into every device's queue**, so a single unclaimed [ticket blocked them all]」，
  `inventory/02-runtime-persistence.md:265` 要求这条**必须有回归测试**，
  `inventory/02:236` 又把「auto-serial fail-open 与 claimed-only」列为 TS 重写最容易被顺手 clean 掉的防事故语义。

#### 整改方案与实施

- **新增 `src/devicePool.ts`**（包一层 `DeviceGate`，不替换它）：显式 serial 走该设备链；auto 从 roster 里
  挑**第一台未冷却、未被占用、gate 空闲**的设备并只占这一台；`pump()` 按到达序扫描但**跳过当下不可满足的
  票据继续发牌**——这正是 `device_lock.py:332` 那条反面教训的直接对应（一个未认领票据不占全局槽、
  也不 idle 掉别的设备）。全局上限 `maxConcurrentDevices` 计的是**已 admit 的设备数**（显式与 auto 同计），
  达上限时新票据留在队列里、不预占槽。
- **配置面两个新键**（`src/index.ts`）：`devices`（默认 `[]`）与 `maxConcurrentDevices`（默认 `0`）——
  **两个默认值都等于现状**，不配 roster 的部署行为逐字不变，由 `contracts.spec.ts` 的默认值断言与
  池测试第一条锁住。
- **S4 拒绝出口跟着改**（`ctx.tools.guard`）：显式 serial 仍按该设备冷却拒绝；auto 在**所有** roster 设备
  都冷却时才拒绝（措辞也不同），因为 auto 在入队前根本没有设备——原来拿 `deviceKeyOf` 的预设键当设备判定，
  配了池之后会误拒。
- **路由器的 `key` 改为「实际分配到的设备」**：日志与 G13 dedup 用预设键（发牌前尚无设备），
  熔断记账用真设备——比原先记预设键更准（失败的是那台机器，不是配置里的第一个名字）。
- **顺手修掉一处 G13 真泄漏**（实现时才发现，不是重构）：`inflight.add(dedup)` 之后 `gate.acquire` 若在
  排队中被 abort，原代码的 `finally` 还没进入，**dedup 标记永久滞留**，此后同 agent 的同一动作都被当成
  「duplicate」永远拒绝。改为 acquire 包 try/catch，异常路径同样 `inflight.delete`。
- **测试装配收敛**：5 处手写的 `gate: new DeviceGate()` 装配换成 `tests/support/pool.ts` 的 helper，
  顺手还掉 §零 记着的一条测试债。

#### 验收标准

- [x] `pnpm --config.verify-deps-before-run=false test` ⇒ **156 passed / 1 skipped**（19 文件；基线 150/1，净增 6 条池锁）
- [x] `pnpm run build` ⇒ 0 error；`uv run ruff format --check` ⇒ 668 files 全净（纯 TS 改动，py 面未动）
- [x] 六条语义锁：空 roster 退回 default 键（现状不变）/ auto 至多占一台 / **未认领不 idle 掉车队**
      （含 `pool.busyDevices === 2` 证明它没预占槽）/ 全局上限 / 跳过冷却设备 / 释放后归最早排队者
- [x] **变异校验三条都做出红**（脚本跑完即还原，还原后 exit 0）：
      ① auto 改回一律占 default ⇒ 3 条池测试超时红；② 摘掉全局上限计数 ⇒
      `honours the global concurrency ceiling` 红（`expected true to be false`）；
      ③ 把到达序扫描改成反序 ⇒ 排队序那条锁红
- [x] **如实记：第三条变异第一次是绿的**——我先写的 claimed-only 锁在反序下发不了言（只有一个排队票据），
      是虚锁。补写成「两台占满 + 两个 auto 排队 + 只释放一台」才咬得住。
      与 **#49**（样本太小跨不过口径步长）、**#45**（判据绑机器）同一类，本条是第三次撞到同一堵墙
- [x] 既有闸门锁与 S10 ③ 的跨会话串行结论未被削弱（`tests/gate.spec.ts` 全绿）
- [ ] 明确未做：**G64** roster 真来源（py 已有 `device_pool.py` 的 `list_devices_async` + 缓存 + 超时 +
      fail-open；重复实现＝多一份抄件，加只读 py 工具＝D8 须登记的 py 改动，等用户点头）；
      多设备 live 未验（本机无设备无宿主），A 片的正确性目前只由单测与内存设备支撑

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
| G5 | conformance 需要真实 DSH runtime（CI 起 DSH 跑契约测试） | 三层：Tier 1 在裸 cordis Context 上挂真实 DSH 服务包与本插件、契约由真 `ctx.tools.schemas()` 把关；Tier 2 三条 fixture 全改为生成物（live 抓取 / 源码抽取 / 真实安装态）；Tier 3 live 取证脚本；并新增 `ci.yml` 里此前不存在的 `plugin-contracts` job（ubuntu + windows 实测 success） | 本文件 **#29**（过程与变异校验见 #27/#28） |
| G52 | 追问路径仍只有 fake 事件总线的证据 | 新增 Tier 1：真 `dsh-session` 提交 `turn/end`、真 `AgentRegistry.register/get` 解析句柄、真 `ToolRuntime.execute` 标记 acted，并用两个 realm 的对照监听观察到 scope 筛选本身；顺带摘掉追问消息的手镜像（补 `UserMessage.id`，`kind:'autogamer'` 改官方 merge-extensible 声明） | 本文件 **#32** |
| G34 | 裸 schema 注册的输入自校验缺口 | 输入语义校验入工具（coordinate 存在即判、不静默回退，text 非空、duration 正数、key 可解、swipe 起止成对、package/url 非空），11 条单测锁死 | 本文件 **#33** |
| G38 | 插件内部错误被归类成任务级失败 | 第三类 `internal`：无前缀异常与逃逸抛出走 internal，不记 breaker，抛 `internal:` 并带勿重试信号；传输层保持 environment（fail-safe） | 本文件 **#33** |
| G57 | 插件挂进 `createScope` realm 后其工具对注册表视图不可见 | 裸 scope 注册本就生效：`register()` 经 `layers.effect` 打 scope 标签，`schemas()/get()` 须传 scope 读；旧「双空」是无参全局视图误读，root 空是 D16 隔离语义 | 本文件 **#34** |
| G56 | mock 与 `ActionClient` 握手超时（`SdkError: Request timed out`） | 手拼应答缺 `jsonrpc` 字段被 SDK 读侧 zod 拒收；补帧字段后真 SDK 握手通过（list/call/截图尺寸三锁） | 本文件 **#35** |
| G33 | 策略内建在工具正文里，与官方「不要内建策略」相反 | 冷却拒绝迁 `ctx.tools.guard()`（只看本工具，终态出口永不拦），只读动作声明 `isConcurrencySafe`；顺带修掉 `starting` 失败缓存与组装期传输分类两 bug | 本文件 **#36** |
| G53 | 前端 lockfile 全镜像 URL，`check_dependency_sources` 门禁红 | 221 个 `resolved` 只换 host（版本/integrity 零漂移，解析级断言），门禁绿，前端 305 用例绿 | 本文件 **#37** |
| G55 | `check_dependency_sources.py` 不合 `ruff format` | 一条 `ruff format` 命令（`e1de835`）；仓级另 9 处既有红另立 G58 | 本文件 **#38** |
| G43 | spike 复位与判据不可靠（`settings put` 无效） | `scripts/spike_reset.py`（UI/平台复位 + 截图判据 + dry-run 锁；live deferred） | 本文件 **#42** |
| G58 | 仓级另 9 处格式红 | `ruff format .` 零语义；同文件 3 处 E731 顺手改 `def` | 本文件 **#43** |
| G8 | 终态权威（收缩） | 汇报双轴 + `concludeTurn`（G41 锁）；exit-code 映射随 worker 消失 | 本文件 **#44** |
| G10 | 动作中断语义 | `exec.signal` 穿透到 SDK 请求（闸门释放早已在 `finally`） | 本文件 **#44** |
| G11 | 熔断判定信号 | 工具层错误分类（`classify` + G38/G33/callTransport 锁） | 本文件 **#44** |
| G13 | 幂等/去抖 | in-flight 去重（变更类专属，只读与串行重复不误伤） | 本文件 **#44** |
| G14 | 状态词汇 | 汇报 `completed/blocked + tests.failed`（enum + 值锁） | 本文件 **#44** |
| G24 | 坐标契约 | 归一域/端侧索引（`coord`/`hierarchy` + G42 锁 + 双机证） | 本文件 **#44** |
| G4 | 熔断探测体（矩阵落定） | 键同源 `deviceKeyOf`（空串分叉修掉，Tier1 调用点锁），`reset`/计数锁，S4 解除句修订（新提交不旁路等显式偏差） | 本文件 **#39** |
| G47 | `install_bundle` 两项未验（失败回滚 / packed file list） | 三轮一次性包实测：`not-bundle` 与不存在的 GitHub 仓库两例 profile 两文件 SHA256 前后相同；tarball 安装落地树恰等于 `files` 白名单。另记「失败与 remove_bundle 都会留下 node_modules 符号链接」 | 本文件 **#19** |
| G48 | 成功的 git 安装无证据；`files` 与 `path:` 子目录在 git 形态下是否生效未测 | 用 `git+file://` 本地仓库摘掉「需要 push」前提：根目录与 `#HEAD&path:/packages/inner` 两形态都 `application:"applied"`，落地树恰等于 `files` 白名单；对 GitHub 走网络另开 G49 | 本文件 **#20** |
| G49 | GitHub 安装失败于 `ERR_PNPM_EPERM`，根因未定 | 单变量跑完：停服务报错不变（否证占用假说）；清掉同名 junction 后 `added 17` exit 0（成立）。机制=importPackage 顺着旧 link 走进开发工作区重建符号链接被 Windows 拒。真实用户干净机器本就可用（CHANGELOGS **#22**）| 本文件 **#22** |
| G50 | git 形态装出来的 bundle 缺 `dist/`（构建产物不在提交里） | tarball 路线端到端验通：`npm pack` 清单含 dist 与 skills、安装 exit 0、服务加载后 7 工具 + persona + 追问链路完整；对外形状定为 GitHub Release 资产 tarball 的 URL | 本文件 **#23** |
| G51 | 本机 Node TLS 信任被本地中间代理接管，走 https 的依赖安装要 `--use-system-ca` | 机制有源码出处（`scrubbedParentEnv` 保留 `NODE_OPTIONS`）；不带 flag 时 DSH 自己的 install_bundle 报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`，带 flag 后该错误消失；前置已写进 README，并禁止用 `NODE_TLS_REJECT_UNAUTHORIZED=0` | 本文件 **#25** |
| G60 | 两枚文档门禁从未接进 CI，抄件漂移只靠人工自证 | `ci.yml` 的 `python-quality` job 新增**无 `if`** 的 `Check documentation gates` step（registry + tables + `--selftest` 三条）。前提是先按 **#45** 把体量口径做成 LF 规范化，否则接进 CI 只会天天假红。**真 run 未观测**：G54 使 `on: push` 不产出 run，本轮不推送 | 本文件 **#46** |
| G61 | 仓库无 `.gitattributes`，工作树字节随 checkout 变，字节类判据在本机不可信 | 新增 `.gitattributes`（`* text=auto eol=lf`、`.bat`/`.cmd` 显式 `eol=crlf`、8 种在库二进制显式 `binary`）；实测 renormalize **零个文本 blob 被重写**（带 CR 的 28 个 blob 全是二进制），2 个混行尾文件按 blob 规范化后 `w/mixed` 归 0，本机 `ruff format --check` 假红转绿 | 本文件 **#47** |
| G62 | py action 面无「无设备可跑」路径，离线契约只能吃插件的 JS 桩 | 新增 `artemis/mcp/mock_server.py`（`MockActuator` + 预置 `adb_server` 两条缓存短路绕开 adb I/O）与 CLI `--type mock` 分支，未改任何现有 py 文件行为；与 `--type adb` 工具清单逐字相同、截图为真 PNG | 本文件 **#52**（含 **#51** 的 stub 更正） |
| G3 | auto-serial 闸门缺口（显式 serial 队列 + auto 空闲池） | A 片落地：`src/devicePool.ts` 包一层现有 `DeviceGate`，auto 从 roster 挑第一台「未冷却 + 未占用 + gate 空闲」的设备且只占一台；显式 serial 仍走该设备链；roster 由 config 注入（默认空＝现状不变）。真枚举来源另立 **G64** 未决 | 本文件 **#55** |
| G28 | parking + 全局并发上限的内部语义 | parking 按 `device_lock.py:332` 的口径实现（未认领票据不占全局槽、不 idle 掉别的设备），全局上限按已 admit 设备数计；六条语义锁 + 三条变异校验（其中一条第一版是虚锁，已如实记） | 本文件 **#55** |
| G63 | py 动作面 fixture 从未在 CI 被重新比对（§零 的旧表述是假陈述，见 #53） | `python-quality` 加 `Set up Node.js` + 一步用 `--type mock` 重导比对；`spike-mcp.mjs` 未改（默认模式本就是漂移检查） | 本文件 **#54** |
