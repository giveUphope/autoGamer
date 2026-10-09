# 迁移盘点 · 设备驱动、媒体与诊断

> 范围: `artemis/drivers/**`、`artemis/mcp/**`、`artemis/controllers/**`、`artemis/clients/**`、`artemis/core/diagnostics/**`、`artemis/utils/**`(概述)、`apps/admin_console/services/media_service.py` + `routers/media.py`(媒体对外面)、相关测试。基线: **cc6b20c**; 日期: **2026-10-09**。
> 目的: 找出 docs/todo.md 没写、但迁移中若无人记录就会丢失的行为、不变量与契约。已覆盖项只标注决策号/表格行, 不展开重复。

---

## 1. 行为与不变量

### 1.1 Mock driver 行为面(TS mock 插件的复刻基线)

todo.md 状态: 已覆盖「mock driver 转 TS 插件」(剩余自建清单 ⑤, todo.md:153), **但无行为契约**。以下为二期复刻必须逐条对齐的最小行为面:

| 行为 | 语义 | 证据 |
|---|---|---|
| 构造默认值 | `device_id="mock-device-001"`, `width=1080, height=2400`, `initial_package="com.android.settings"` | artemis/drivers/mock/mock_driver.py:29-35 |
| 截图 | **全尺寸**纯黑 PNG(注意: 源码注释写 "1x1 black image" 是错的, 实际 `Image.new("RGB", (width, height))`), 同时缓存 base64 | mock_driver.py:44-49 |
| 层级 XML | 固定字符串 `<hierarchy><node text='Settings' class='android.widget.TextView'/></hierarchy>` | mock_driver.py:50-52 |
| 元素列表 | 单元素 `{"text": "Settings", "bounds": [0, 0, width, 100]}` | mock_driver.py:73 |
| 动作记录 | 每个动作(tap/long_press/swipe/swipe_direction/input_text/press_key/launch_app/stop_app/execute_shell)追加 dict 到 `action_history` 并恒返回 `True` —— 这是测试断言缝(tests/unit/test_drivers.py、tests/unit/mcp/test_actuators.py 依赖) | mock_driver.py:79-191 |
| execute_shell | 返回 `"mock_output: {command}"` | mock_driver.py:184-191 |
| 录屏 | start 置 `recording=True`; stop 恒返回 **`"/tmp/mock_recording.mp4"`**(POSIX 风格路径, Windows 上也是这个字面量) | mock_driver.py:193-198 |
| ScreenData.platform | `"mock"` | mock_driver.py:76; drivers/types.py:62 |
| 连接态 | `connected`/`recording` 两个裸 bool, connect/disconnect 仅翻转 | mock_driver.py:40-66 |
| **激活方式** | driver 自身不读环境变量; 由 factory 判定 `ARTEMIS_MOCK_DRIVER=1` **或** `ctx.device.mobile_platform == "mock"`(优先级在 cloud 之后) | artemis/drivers/factory.py:49-58 |
| **隐藏坑: `is_mock`** | `UnifiedMobileController` 三处用 `getattr(self._driver, "is_mock", False)` 判 mock, 但 `MockDeviceDriver` **从未定义 `is_mock`** —— 恒为 False, 实际全部走 env/platform 分支。TS 复刻时若"修复"此属性会改变行为; 若照抄会继承死代码 | artemis/controllers/unified_controller.py:98, 406, 526 vs mock_driver.py 全文 |
| MockActuator | 测试用 actuator **故意继承 AdbActuator**(同一坐标换算/控制器派发路径), 只把 driver 换成内存实现, 经 `ctx._active_driver` 缓存缝注入 | artemis/mcp/actuators/mock.py:32-58; factory.py:75-80 |

处置建议: 契约表**写入 autogamer-device/mock TS 插件的设计文档**(二期); `is_mock` 死检查标注为"复刻时二选一: 修复并同步改 controller 判定, 或不实现"。

### 1.2 设备驱动能力清单(AndroidAdbDriver —— autogamer-device TS 重写的功能基线)

todo.md 状态: 模块级已覆盖(映射表 `drivers/` 行, todo.md:116; P2, todo.md:205), 能力细目**缺失**。

连接与构造:
- 构造参数: `device_id`、`adb_client`(adbutils `AdbClient(host, port)`)、`ui_adb_client`(可为 None)、`width=1080`、`height=2400`(artemis/drivers/android/adb_driver.py:75-88)。
- `connect()` 仅校验 `get_state()`, 异常只 warning 不抛(adb_driver.py:106-112); `disconnect()` 停录屏 + ui client disconnect(114-119)。

观察:
- `get_screen_data(skip_settling)`: 非 skip 时固定 `asyncio.sleep(0.3)` 稳定窗(adb_driver.py:123-124); 截图三级降级: ① ui client `get_screen_data()`(base64+尺寸回写 `self._width/_height`) ② adbutils `device.screenshot`→PNG bytes ③ **1x1 PNG 占位 base64 硬编码常量**(adb_driver.py:174, 211)——截图全败仍返回"成功"的 ScreenData; 层级走 `get_hierarchy()`(XML→`parse_hierarchy_xml_to_elements`)或 `get_ui_elements()`; 最后经 `filter_ui_hierarchy` 清洗(adb_driver.py:203-207)。
- 消费方(-smoke test)以 **`< 512 字节` 判定"截图是占位图"**(diagnostics/device_smoke.py:72-74)——占位契约被两处共享。

输入:
- `tap`: `duration_ms>=500` 降级为 `input swipe x y x y duration`(长按路径); `times>1` 用 `&&` 链 + `sleep delay_ms/1000`; 每条命令打 `[ADB] {cmd}` 日志(adb_driver.py:229-252)。
- `long_press` = `tap(duration_ms)`(254-255)。
- `swipe`: `input swipe x1 y1 x2 y2 duration_ms`(257-272)。
- `swipe_direction`: 智能滚动向量 —— 横向锁 60% 宽(避边缘手势/字母快速滚动条), up=0.7→0.3 高、down 反向(800ms 防 fling, ~50-60% 重叠)、left/right=0.75→0.25 宽(274-305)。
- `input_text`(四层, adb_driver.py:307-370): 清空 = `keyevent 123`(MOVE_END)+`--meta 1 122`(Shift+Home 全选)+`67`+**20 连发 `67`**(DEL); 追加 = 先 `123`; 文本先归一 `\r\n|\n|\r`→`\n`; Tier1 剪贴板注入(ui client `set_clipboard` + `keyevent 279` PASTE, 多行/全字符集零 IME 干扰); Tier2 检测默认 IME 含 "adbkeyboard" 则 `am broadcast -a ADB_INPUT_B64 --es msg '{b64}'`; Tier3 逐行 `input text {escaped}` + 行间 `keyevent 66`(Enter)。转义表 `_escape_for_adb_text`: 17 个字符 + 空格→`%s`(50-69)。
- `press_key`: 8 键映射表 `ANDROID_KEYCODE_MAP` home=3/back=4/enter=66/delete=67/power=26/app_switch=187/volume_up=24/volume_down=25(38-47); 未知 key 原样透传(372-383)。

App 管理:
- `launch_app`: `monkey -p {pkg} -c android.intent.category.LAUNCHER 1`(385-392); 注意 actuator 层另有 `launch_app_with_retries`(智能轮询, third_party/mobile_use/utils/app_launch_utils.py, adb_server.py:330、actuators/adb.py:289-307 两条路径都用它)。
- `stop_app`: `am force-stop {pkg}`(394-400)。
- `get_current_package`: `device.current_app` → 失败降级 `dumpsys window displays | grep -E 'mCurrentFocus|mFocusedApp'` token 解析(402-427)。
- `execute_shell`: 默认超时 **15s**, 失败返回 `"Error: {e}"` 字符串而非抛错(429-436)。

录屏(driver 侧独立路径, 与 controller 侧并存):
- `start_video_recording(output_dir)`: 默认 `get_temp_dir("recordings")`, 目标 `recording.mkv` + `recording.mp4`; `find_scrcpy()` + `build_scrcpy_record_command(..., lock_capture_orientation=False)`(**注意: controller 路径传 True, 见 §1.4**); spawn 后 `sleep 0.5`(438-460)。
- `stop_video_recording`: `terminate()` + `wait(5s)`(Windows: **残留 scrcpy 会锁住 MKV 文件** —— 源码注释); ffmpeg `-c copy -movflags +faststart` remux, 成功即删 mkv; 全败回退返回 mkv(462-507)。

抽象基类契约(drivers/base.py): `ScreenData` 模型(bytes+base64+xml+elements+w/h+timestamp+platform, 52-66); **0-1000 归一化坐标** `tap_normalized`/`swipe_normalized`(clamp 到 width-1/height-1, 194-223); `find_element` 匹配语义 = resource_id 子串包含 OR text 大小写不敏感子串包含 + index, tap 点**优先从活 bounds 算中心**(注释: 预计算 center 可能落后一个布局过渡), bounds 支持三种形态(parsed_bounds dict/list/`[x,y][x,y]` 字符串正则)(225-279); `KeyCode` 枚举 8 键(41-49); 默认 `swipe duration_ms=800`、`tap duration_ms=100`、`long_press 1000`、`execute_shell 15s`(109-177)。

死代码(无任何消费方, 二期不迁移): `drivers/android/recorder.py` `ScreenRecorder`(adb screenrecord→/sdcard/artemis_record.mp4→pull 的旧路径)、`drivers/android/input_ime.py` `AndroidInputIME`(逻辑已被 adb_driver 吸收)、`drivers/cloud/cloud_driver.py` `CloudDeviceDriver`(全 stub, cloud 实际走 RemoteAdbClient/RemoteUIAutomatorClient, factory.py:39-47)。grep 全仓无引用。

处置建议: 本清单+§1.4 产物契约 = **autogamer-device 的验收基线**(二期); 死代码三个文件标「删除」。

### 1.3 Driver factory 与环境变量契约

- 优先级: cloud(`ARTEMIS_CLOUD_MODE=1` → RemoteAdbClient/RemoteUIAutomatorClient) > mock(`ARTEMIS_MOCK_DRIVER=1` 或 platform=="mock") > 默认 AndroidAdbDriver(artemis/drivers/factory.py:34-72)。
- ADB endpoint: `settings.ADB_HOST/ADB_PORT`(默认 **127.0.0.1:5037**, artemis/config/constants.py:111-112)。
- driver 缓存在 `ctx._active_driver`(factory.py:75-80)——也是测试注入缝。
- 完整 driver 级 env 清单(todo.md S5 只列了 worker 的 3 个, **这些没写**): `ARTEMIS_MOCK_DRIVER`、`ARTEMIS_CLOUD_MODE`、`ARTEMIS_HIERARCHY_BACKEND`(auto/helper/uiautomator)、`ARTEMIS_DEVICE_ID`、`ADB_DEVICE_SERIAL`、`ADB_HOST`/`ADB_PORT`、`ADB_SERVER_SOCKET`(tcp:host:port, 子进程与 py client 的真实寻址通道)、`ADB_VENDOR_KEYS`、`ARTEMIS_IPC_PORT`(mcp stdio 模式置空防 SQLite WAL 竞争, artemis/mcp/adb_server.py:84-86)、`ARTEMIS_DISABLE_ORIGIN_GUARD`(security.py:113)、`ARTEMIS_TRACES_DIR`(paths.py:112)。

处置建议: env 契约表并入 todo.md S5(worker 契约)或 G7 外部接入迁移清单——**DSH 侧 spawn py worker 时必须透传**。

### 1.4 录屏管线(触发/分段/编解码/产物)

todo.md 状态: 已覆盖「录屏栈留 py(D8 例外); 录屏经 spillPath 交接; mp4 托管/路由转 autogamer-media」(映射表 media_service 行, todo.md:117; S5, todo.md:68)。**产物格式契约与时间线语义缺失**——没有它 autogamer-media/前端无法消费。

触发: worker 内 `third_party/mobile_use/sdk/agent.py:540-558`, 由 `video_recording_tools_enabled` 门控(= scrcpy 且 ffmpeg 同时存在, artemis/utils/video.py:567-569; 缺失时 prompt 不 advertise 视频工具, artemis/agents/operator/prompts.py:203-207, graph/graph.py:1013)。输出目录 = `{traces}/{trace_name}/`。

scrcpy 命令(artemis/utils/video.py:48-76): `--serial {id} --no-window --record {path} --record-format mkv --video-bit-rate 2M`(+锁定朝向时 `--capture-orientation=@`)。

首帧锚定(video.py:79-113): 等 stdout 出现 `"Recording started"` 标记(超时 **6s**), 回退 spawn+**0.75s**; `session.start_time` 被改写为首帧时刻——**录像 t=0 ≈ 首帧**, 是所有分段偏移/剪辑对齐的锚(controller 注释, unified_controller.py:461-464)。

分段看门狗(unified_controller.py:361-393): 每 0.5s 轮询 `dumpsys window displays`(rotation 变化, video.py:331-357)与段龄 ≥ **1800s**(`ANDROID_RECORDING_SEGMENT_SECONDS`)或进程崩溃 → 停当前段 → finalize(异步 remux)→ 起下一段 `recording_{NNN}.mkv`。**一个段永不包含多种编码尺寸**(旋转即切段, video.py:55-61)。

停止(unified_controller.py:519-646): 停 scrcpy(**先 `CTRL_BREAK_EVENT`(Windows)/`SIGINT` 让 recorder flush, 等 8s, 再 terminate 5s**, 69-80)→ finalize 当前段 → 等全部 remux 任务 → 应急兜底(无任何段 mp4 时整文件 remux, 输出名防覆盖守卫 `recording_converted.mp4`, 593-605)→ 写 manifest → `record_video_stop` 入 DataEngine。

产物命名(unified_controller.py:252-256): 第一段 `recording.mp4`, 后续 `recording_{index:03d}.mp4`; 原始 `recording.mkv`/`recording_{NNN}.mkv` remux 成功后删除。

**manifest v2 契约**(video.py:360-433): `recording.json`, 原子写(`recording.part.json`→replace), 字段: `{version:2, duration, session_offset_ms, session_end_ms, segments:[{file, start, duration, offset_ms, duration_ms, width, height}]}`。`start/duration` 是段间背靠背的 legacy 时间线; `offset_ms/duration_ms` 携带**会话相对时间轴**(DataEngine start anchor − 录像 anchor 的 shift, unified_controller.py:299-322)——UI 据此跨 scrcpy 重启间隙按步骤时间 seek(media_service.py:407-411 消费)。无已知 offset 的段假定无缝衔接。

剪辑/抽帧(video.py): `render_timeline_clip` 720x1280@15fps, 间隙补黑帧(lavfi color), **concat 后必须显式 `fps=`**(否则 ffmpeg 回落 25fps CFR 破坏 `start_time + frame_index/fps` 映射, 源码注释 516-518); remux 双级: `-c copy +genpts +faststart` 失败 → `libx264 ultrafast +discardcorrupt`; 全部经 `.part` 临时文件原子发布(211-289)。`extract_keyframes_from_video`(cv2, 1fps/最多45帧/最长边1080/JPEG q80)、`extract_frames_at_timestamps`(30帧/q85)。

编解码栈: ffmpeg 来自 `imageio_ffmpeg.get_ffmpeg_exe()`, 否则 PATH `ffmpeg`(video.py:124-131); ffprobe 取段元数据(134-136); cv2(opencv)用于抽帧——D8 例外确指 **imageio-ffmpeg + opencv-python** 两个包。

处置建议: 产物契约(manifest v2 + 文件命名 + `_PASS_/_FAIL_/_TESTFAIL_` 目录命名, 见 §1.5)+ 首帧锚定语义 → **写入 autogamer-media TS 插件 spec**; 录屏 py 栈保留(D8), 但 `write_recording_manifest`/`render_timeline_clip` 的语义文档必须随交接落地。

### 1.5 media_service(623 行)行为面

todo.md 状态: 已覆盖拆分方向(todo.md:117)。**逐项职责与安全契约未记录**:

- **MKV→MP4 按需转换**(`ensure_browser_playable_video`, media_service.py:44-98): mp4 直通; mkv/webm 转 mp4(两级: 15s copy remux → 30s ultrafast 重编码, 100-149); **liveness 门**: mtime 距今 < **10s**(`LIVE_RECORDING_GRACE_SECONDS`)判定 scrcpy 仍在写, 不转(否则把几秒的残片冻结成 recording.mp4, 151-167); 陈旧 mp4(早于源 mtime)判为中跑扫描残片, 重转(65-78)。转换结果缓存 `_playable_cache`(含**失败缓存**), 防 `/api/sessions` 轮询每跳 45s ffmpeg(37-41 注释)。
- **孤儿恢复**(`recover_orphaned_recording`, 205-258): 硬杀 worker 留下 `recording.mkv`(可播但未 remux)+ 可能的中跑残片 mp4; 恢复 = remux 覆盖残片→删 raw→**把临时 trace 目录改名成 worker 会用的终态名**(无状态标记时 `{name}_FAIL_{yyyy-mm-ddTHH-MM-S}`, 179-203)。调用方两处: ① 任务结束时 task_queue_service.py:883; ② **服务启动时** `recover_orphaned_recordings_on_launch`(task_queue_service.py:1947-1985, server.py:158 spawn)——输入是 DB `video_recordings` 中 status ∈ recording/finalizing 的行(session_repository.py:175-199), 成功后 `mark_recording_ready`。**liveness 门同样适用**(还活着就不碰, media_service.py:237-239)。
- **视频索引与解析**(`build_video_index`/`resolve_video_url`/`resolve_video_segments`, 270-415): 扫描三个根: `TRACES_PATH`、`WORKSPACE_ROOT/artemis-traces`、`.benchmarks/diagnoser/outputs/artifacts`; 每目录找 `recording.{mp4,mkv,webm}`; 索引键含目录名 + 去状态后缀前缀(`strip_trace_status_suffix`, 标记 `_PASS_/_FAIL_/_TESTFAIL_`, 152, 174-177)。URL 解析五级链: `video_filepath` → DB rec map → 索引(目录名/前缀) → 索引(session_id) → 直扫 `TRACES/{sid}/recording.*` → goal 里 `"Task: "` 提示(312-378)。segments 解析带**路径逃逸守卫**(segment 必须与 manifest 同目录, 394-399)。
- **trace payload 解包**(`unwrap_payload`, 417-479): 字符串疑似 JSON 则递归; `data:image/*;base64` 或 `iVBORw0KGgo`/`/9j/` 前缀 → 解码存 **`IMAGES_DIR/{sha256}.jpg`** → 返回引用 `"image://{hash}"`(= DataEngine 步骤截图的落盘协议); >2000 字符截断为首尾 100 字符预览; >20 元素且含 bounds/resource-id 的列表 → `<XML UI List ...truncated>` 占位。**这是 trace 库里图片引用格式的隐性契约**。
- **本地文件安全**(`get_safe_local_file`, 492-527): resolve(strict) 后必须位于 `WORKSPACE_ROOT` 或 `TRACES_PATH` 之内 **且** 扩展名在媒体白名单(jpg/jpeg/png/gif/webp/mp4/webm/mkv)——注释明示"永不能递出 .env/数据库/源码"。
- plan/notes/checks 读取(529-620): `task_plan.md`(会话级→全局回退)、notes 目录(md/txt/json/yaml)、`check_ledger.jsonl`+`check_streams.jsonl`+`run_outcome.json`。

处置建议: 「托管/路由转 autogamer-media」时**逐项拆**: 录屏转换/孤儿恢复留 py(强依赖 ffmpeg 栈与 worker 生命周期, D8); URL 解析/索引/unwrap 跟 DataEngine trace 语义绑定——一期随 worker 黑盒保留; `/videos`、`/images`、`/local_file` 的 HTTP 面二期由 autogamer-media 的 `ctx.connection.fetch` 承接(需实现 §2.1 白名单语义)。

### 1.6 媒体对外路由与鉴权

todo.md 状态: 「mp4 托管/HTTP 服务无原生」已覆盖方向(todo.md:117), **路由清单与鉴权模型未记录**。

| 路由 | 行为 | 证据 |
|---|---|---|
| `GET /images/{name}`、`/api/images/{name}` | 只服务 `IMAGES_DIR`(`{traces}/images`)下 `*.jpg`(自动补后缀), resolve 后校验仍在 images root 内 | apps/admin_console/routers/media.py:88-101 |
| `GET /videos/{path:path}` | mp4/webm/mkv, 路径必须 resolve(strict) 在 workspace/traces 根内+扩展白名单 | media.py:31-35, 49-71, 104-107 |
| `GET /api/sessions/{sid}/video` | 返回 `{status: processing|failed|ready|unavailable, video_url, video_segments}`; processing 携带 `retry_after_ms: 750`; ready 时 URL 追加 cache-bust `?v={end_time*1000}`; 失败但找到可播文件会回写 ready | media.py:110-176 |
| `GET /local_file?path=` | `get_safe_local_file` 守卫后的 FileResponse | media.py:179-182 |
| `GET /api/sessions/{sid}/plan|notes|checks` | plan/notes/checks 文本读取 | media.py:185-198 |
| `GET /admin`、`/debug` | legacy admin HTML | media.py:74-85 |
| SPA fallback 排除 | `api/ images/ videos/ local_file docs openapi.json redoc` 不被 SPA 捕获 | apps/admin_console/server.py:279-293 |

鉴权: **无 token**, 全部走 `SameOriginBoundaryMiddleware`(纯 ASGI): Host 头必须在 localhost/IP/`ARTEMIS_ALLOWED_HOSTS` 白名单; 带 Origin 的请求必须同源; `ARTEMIS_DISABLE_ORIGIN_GUARD=1` 整体旁路(apps/admin_console/core/security.py:100-138)。mp4 的"鉴权"= **路径逃逸守卫 + 扩展白名单**, 不是身份验证——DSH 侧 autogamer-media 复刻时须保留同样的"只能拿到媒体文件"保证。

处置建议: 路由表+守卫语义并入 todo.md media_service 行的交接说明; 二期 autogamer-media 验收含"恶意路径拿不到非媒体文件"用例。

### 1.7 诊断(diagnostics)

todo.md 状态: E 区已列模块并定向「一期保留 py doctor; 二期部分转 autogamer-queue admission 探测」(todo.md:144-145, 180-181)。**检查项清单/阈值/机制细节缺失**。注: todo.md:144 写 "~3000 行"、todo.md:180 写 "~2400 行", 实测约 **4300 行**, 两处自相矛盾且均偏低(见 §4)。

**doctor 检查项全集**(ReadinessEngine 默认探针 + doctor 专属, artemis/core/diagnostics/engine.py:64-82, readiness.py:30-60):
1. `python_runtime`(阻断): Python 版本。
2. `system_config`(阻断): 系统配置。
3. `toolchain`(非阻断): adb/scrcpy/ffmpeg/emulator 解析(artemis/toolchain)。
4. `gemini_api_key`(阻断): google/openai/anthropic/openrouter/xai 五家凭据占位符检测(credentials_probe.py:49-110)。
5. `vision_ocr_key`: OCR 凭据。
6. `android_adb`(阻断): 见下。
7. `integration_host`(仅 doctor/`mobile_diagnose` 显式跑, 不进默认探针集): MCP 宿主进程环境——解释器是否项目 venv、.env 位置、traces 可写(**唯一阻断项**)、守护端口占用; 识别 9 种 MCP 客户端(claude/cursor/windsurf/vscode/cline/roo/openclaw/codex/antigravity, 按 env 前缀, host_probe.py:15-118)。

判定: `overall_ready` = 存在阻断项且全部 PASS(engine.py:210-212); verdict 三级 `blocked`(无阻断项或任一阻断非 PASS)/`degraded`(仅可选失败)/`ready`(readiness.py:63-75)。修复顺序 CHECK_ORDER: runtime→config→host→gemini→adb→toolchain→ocr(屏蔽语义: runtime 问题遮蔽其后, 凭据遮蔽设备, readiness.py:38-46)。

**android_adb 探针语义**(probes/adb_probe.py):
- 仪表盘路径: `adb devices -l` 解析 serial/state/model/product; `emulator-*`/`127.0.0.1`/`localhost` 判模拟器(514-518); 富化缓存 **60s**(`getprop ro.build.version.release`、`wm size`、`pm list packages`, 44, 534-580); AVD 清单扫 `~/.android/avd/*.ini`(104-116)。
- **锁屏状态**(136-253): `dumpsys window policy`(`KeyguardServiceDelegate.showing` + 旧字段 mShowingLockscreen 等)⊕ `dumpsys trust`(current-user `deviceLocked`); 现代信号优先、任一阳性即锁、**阳性需二次采样确认**(防单次抖动翻 UI); 仪表盘允许 15s TTL 的旧值平滑(255-281), **提交门禁不允许**(注释明示 fail-closed, 260-265)。
- **提交快路径**(`probe_submission_readiness`, 354-475): `adb devices -l` 限时 **1s** → 无 ready 设备 WARN(Unauthorized/No Device); 偏好 serial 不可用/锁定时**自动切换到其它已解锁 ready 设备**; 锁定检测限时 1s(确认双采样); 判定 PASS 仅当 `is_locked is False`, 未知= WARN。
- adb 缺失 → 平台化安装动作(WinGet/Homebrew/apt + 下载链接, 594-653)。

**adb_keys 自愈**(adb_keys.py): 路径 = `ADB_VENDOR_KEYS`(os.pathsep 分隔取首个)否则 `~/.android/adbkey(.pub)`(56-65); 损坏判据: 私钥 0 字节 / <100 字节 / 无 PEM `BEGIN...PRIVATE KEY` 头 / 公钥 0 字节(88-150); **机制背景**(模块 docstring): 键损坏时设备静默停留 unauthorized 且**永不弹授权框**; heal = 备份 `adbkey.corrupted.{ts}` → 删键 → `kill-server/start-server/devices`(剥离 ADB_SERVER_SOCKET, 各 5s 超时)→ 复检(164-270)。doctor --fix 与 engine.restart_adb_server 共用; restart 仅限本地默认 endpoint(远程 endpoint 时 skip, engine.py:300-315)。

**emulator_manager**(emulator_manager.py): 管**本地 AVD 的后台启动生命周期**(非通用模拟器池)。状态机 idle→starting(15%)→waiting_for_adb(35%)→booting(65%, 渐进到 95)→ready(100%) / failed / stopped(38-63); 二进制定位 = toolchain → PATH → 8 个 SDK 候选目录(ANDROID_HOME/ANDROID_SDK_ROOT/~/Android/Sdk/~/Library/.../LOCALAPPDATA/.../usr/lib//opt/, 92-121); **总超时 180s**; 前 5s 早崩检测(日志含 lock/already running → "被另一实例锁定", panic → 原样带出, 257-281); 轮询 `adb devices -l` 抓 `emulator-*` serial → `getprop sys.boot_completed == 1` 即 ready 并把 readiness 焦点切到该 serial(404-413); 停止 = `adb -s {serial} emu kill`(5s)→ terminate(3s)→ kill(451-491); 日志环形缓冲 deque(100)。**Windows 进程隔离**: `CREATE_NEW_PROCESS_GROUP|CREATE_NO_WINDOW`(CtrlC 不殃及), POSIX `start_new_session`(77-90)。

**device_smoke**(device_smoke.py): 端到端"设备可见但 ARTEMIS 观察不到"烟雾测试——复刻 `mobile_get_device_state` 的观察路径(`adb_server._get_controller` → `controller.get_screen_data()`)。要点: ① 忙判定——设备被 `DeviceExecutionLock` 活 owner 持有时**跳过探测**(u2.connect 会重启对端 UIAutomator server, 打断在跑任务, docstring 40-43); ② **专属线程+独立事件循环**执行(同步 u2 跑在事件循环线程上, `asyncio.wait_for` 永远打不中, 33-39); ③ 截图 < **512 字节** = 占位图判定(72-74); ④ 修复建议映射 busy/unauthorized/offline/no device/timeout→uiautomator(强制 stop `com.github.uiautomator{,.test}`、purge+init)(67-96, 99-141); ⑤ 默认 20s; ⑥ uiautomator2 异常继承 BaseException 且常带空消息(152-158)。

**hierarchy_parity**(hierarchy_parity.py): helper 与 u2 真机对拍——有标签元素双向匹配(bounds IoU ≥ **0.5**), recall ≥ **0.9**、precision ≥ **0.8**; helper 不得产出负坐标/越界 bounds; **两个后端不能同时跑**(u2 的 UiAutomation 连接会让 helper 掉线), 顺序 = 先 helper 后 u2, 收尾 `stop_server=True` 还原(184-204); CLI `artemis helper parity`。

**adb_server_connection**(adb_server_connection.py): 进程级 ADB endpoint 管理——发现顺序: `ADB_SERVER_SOCKET`(tcp:host:port)无显式 HOST/PORT 时优先 → settings; activate = 写 settings + 进程 env; persist = `dotenv set_key` 写 **`{repo}/.env` + `{app_dir}/.env` 两处**(305-326); probe = 子进程 `adb devices -l` 8s 超时、**剥离 ADB_SERVER_SOCKET 的干净 env**(274-278); 设备解析 serial/state/model/product; 错误文案映射(cannot connect/version mismatch, 259-272); import 即 `synchronize_environment()`(330)。

处置建议: 一期整体保留 py(D8/一期黑盒); 二期 autogamer-queue admission(S4/G4)**必须继承**: ① 锁屏确认探测语义(fail-closed)与多设备自动切换; ② 环境级失败判定已有(ENVIRONMENT_ERROR_MARKERS, todo G4 已写); ③ adb_keys 自愈可留 doctor CLI。行为细节建议压缩成一页"admission 探测规格"附在 autogamer-queue。

### 1.8 mcp 动作执行层(action_server/executor/session/specs/manifest/actuators)

todo.md 状态: 「一期保留(worker 内), 二期 → autogamer-device 工具执行管线承接」已覆盖(todo.md:141, 177-178)。**协议语义与教训未记录**:

- **进程内 MCP**: `build_action_server(actuator)` 造 FastMCP("artemis_actions"), 只注册 actuator `capabilities()` 声明的工具——缺的工具对消费者不可见(artemis/mcp/action_server.py:69-201)。返回协议: `CallToolResult.structuredContent = ActionResult`; `isError=False` 保留给协议级失败, **设备拒绝动作 = isError=False + ok=False**(作为观察到达模型而非异常, 15-31)。
- **ActionResult 语义**(action_types.py): ok/code/message/detail(`detail` 给诊断不进 LLM)+ normalized_coordinates/duration_ms; ActionCode 枚举 OK/INVALID_ARGS/TARGET_NOT_FOUND/DEVICE_ERROR/PACKAGE_NOT_FOUND/TIMEOUT/UNSUPPORTED(31-40)。`ObserveResult.hierarchy_ok=False` 时调用方**必须保留旧元素索引不得清空**(83-87)。
- **动作全集**(action_manifest.py:68-135): REQUIRED = `click_sequence`(唯一——Flash prompt 结构性依赖); OPTIONAL = click/long_press/input_text/swipe/press_key/manage_app/wait_for_delay/wait_for_text/open_link/erase_one_char/focus_and_clear_text(11); INTERNAL(不进 LLM, 适配器专用) = observe_screen/take_screenshot/get_ui_hierarchy。另有 BACKEND_INDEPENDENT 15 个(笔记/子代理/诊断/终止哨兵: read_note...report_task_status)不随 actuator 变。扩展工具描述 ≥ **40 字符**(manifest 149-151), 与已知工具重名即拒。
- **三方言单源**(action_specs.py docstring 15-56): `operator`(agent 方言, target = **元素索引 int 或 0-1000 归一 [x,y]**, 索引由**客户端执行器**对"Visible UI Elements"列表解析——wire 只见坐标; 坐标 target 必须带 `target_description`, 只记录不上 wire)+ `declaration`(JSON-only, 仅 click_sequence 独享)+ `wire`(actuator 一一对应)。`long_press` 双拼写 `duration`(agent)/`duration_ms`(wire), 执行器两者都收(402-409)。历史措辞锁定: EXCEPTION_PREFIXES("Error during click" 等, 696-706), 有专门测试钉死(tests/unit/mcp/test_action_specs.py, 14 用例)。
- **动作名归一**(action_names.py): Operator 内部动词 tap/long_press_on/focus_and_input_text/launch_app/stop_app/back → canonical click/long_press/input_text/manage_app/press_key; `KEYCODE_` 前缀剥离, 已知裸词集 {home,back,enter,delete,tab,search,menu,app_switch}, 其余**原样透传**(任意 KEYCODE_*/数字)(148-155)。
- **ActionSession 单 owner 任务串行**(action_session.py): in-memory MCP 传输的 anyio cancel-scope 必须同任务进出 → 全部传输调用经请求队列在 owner 任务内执行; **调用串行化 = 单设备策略的强制点**(阻止 Validator 与子代理交错操作设备, 44-47); **超时教训**(两次实况): 传输级 read_timeout 或调用方 wait_for → mcp-1.29 客户端迟响应崩溃、会话全灭 → **超时必须作为 `timeout_ms` 参数在服务端工具内部生效**(action_server.py:136-142); 传输死亡 → `started=False` → 下次自动重建; aclose 5s。
- **AdbActuator 参考实现**(actuators/adb.py): 归一→像素 clamp(122-131); `ensure_focus_at_coords` = 找包含点的**最小面积可聚焦元素**(focusable/clickable/EditText), 已 focused 则跳过 tap, tap 后固定 **1.0s** 等键盘弹起(45-98); `manage_app` 显示名→包名解析(`find_package`) + `launch_app_with_retries`(286-332); `wait_for_text` 0.5s 轮询 UI 树, 默认 5000ms(343-372)。
- **adb_server(stdio 外部 MCP, "Android_ADB_Controller")**(adb_server.py): 13 个 **legacy 像素坐标**工具(tap/long_press_on/swipe/back/launch_app/stop_app/open_link/focus_and_input_text/focus_and_clear_text/erase_one_char/press_key/take_screenshot/get_ui_hierarchy)——注释明示 stdio 服务器保留像素契约、元素/聚焦逻辑与进程内 actuator 单实现共享(206-211); `_get_controller` 按 serial 懒缓存; 串选择 = 显式参数 > `ARTEMIS_DEVICE_ID` > `ADB_DEVICE_SERIAL` > 首个设备; cloud 模式专用分支; stdio 模式 = 日志重定向 `traces/mcp_server.log` + `ARTEMIS_IPC_PORT=""` + awake 服务(482-490); 入口 `artemis mcp --server adb`(stdio/SSE)(interfaces/cli/commands/mcp.py:836-847); 工具描述做 **py3.12/3.13 docstring dedent 归一**(92-111); FastMCP/pydantic Settings model_rebuild 兼容 shim(35-41)。契约由 tests/unit/mcp/test_adb_server_contract.py + tests/fixtures/action_surfaces/adb_server_manifest.json 钉住。
- **xml_search_server**("Android_XML_Fuzzy_Search"): `search_ui(image_hash, query, threshold=0.6)` 按 SHA-256 从 DataEngine 取 UI 数据做模糊搜索(artemis/mcp/xml_search_server.py:41, 95+)。同样经 `artemis mcp --server xml` 提供。
- **McpActionExecutor**(action_executor.py): Flash 侧执行器——索引解析、target_description 记录、智能滑动(经 utils/coordinates)、后观察、trace 全在这层; AGENT_TOOL_NAMES(note/ask_*/video_analyzer/history)不进 action server(72-78)。

处置建议: 一期黑盒保留; 二期重写时**必带三件行李**: ① 0-1000 归一化坐标 + target_description 记录契约(agent 方言↔wire 的分界); ② "设备拒绝=观察非异常"的 ActionResult 语义; ③ 超时在工具内生效的教训(DSH 工具同样适用——DSH 侧超时若在调用方 abort 也会产生迟响应类问题, 需在 spike 验证)。

### 1.9 controllers / clients

todo.md 状态: 「二期进 autogamer-device(TS 重写或 CLI 间接调用); 一期保留」已覆盖(todo.md:142, 183-184)。依赖关系未记录:

- **UnifiedMobileController**(controllers/unified_controller.py, 649 行)抽象两件事: ① 驱动无关的输入/观察面(继承 third_party 基类, 真实动作都委派 driver); ② **完整录屏生命周期**(§1.4)——所以它的二期去向其实是两半: 控制面进 autogamer-device, 录屏半留 py。分段缓存按 `(video_id, generation, start, end)` 键控(57, 113-132)。
- **screen_client_factory**(clients/screen_client_factory.py): 层级三后端 `ARTEMIS_HIERARCHY_BACKEND`= auto(默认)/helper/uiautomator; auto = helper 优先 + **逐调用** u2 兜底; 健康的 helper 永不触发 `u2.connect`(**u2.connect 会推送自家 APK 并卸载 Maestro**, docstring 20-23); helper 失败后 **30s 降级窗**内直接走 u2(`retry_after`, 133-160); 降级前先 `adb get-state` 快判(5s 超时)——**手机不在手时绝不浪费 u2 多次重连超时**(DeviceOfflineError, 60-75, 206-210); 回 helper 前**必须停 u2 server**(其 UiAutomation 连接让所有 a11y 服务解绑, 231-238); `disconnect(stop_server=True)` 同理(为下一个任务/进程还回 helper, 277-285)。后端切换史(backend_history+listener)进报告。
- **AccessibilityClient**(clients/accessibility_client.py): 设备侧 **Artemis Accessibility Helper**(com.artemis.helper)的 loopback HTTP 客户端——**与 u2 互补的关键设计: 不占用 UiAutomation 单例, 与 Mobly/Appium/Espresso 共存**(docstring 15-19)。端口: 设备固定 **18888**, 宿主经 `adb forward tcp:0` 动态分配(跨进程共享 forward, helper_manager.py:27-35, 87-92); 鉴权 = 会话 token, 头 `X-Artemis-Token`(70-71); 请求超时 6s(/snapshot 8s); **自愈语义**: HTTP 401 → 重推 token 重试一次; **读**操作传输失败 → 重建隧道重试一次; **动作不重放**(可能已执行, 211-251); 接口: `/dump_xml`、`/dump?fields=xml,elements`、`/snapshot?fields=xml`(Android 11+ 原子带回截图)、`/action {cmd}`; 截图兜底 `adb exec-out screencap -p`(10s); connect 时 `ensure_device_awake`(runtime/awake_service)。元素形状与 u2 **逐字节一致**(同一 parser + normalize_helper_elements 把 bool flag 转 "true"/"false"——下游到处比较字符串 "true", 107-137)。
- **uiautomator2 关系**(third_party/mobile_use/clients/ui_automator_client): `UIAutomatorClient` 是 u2 的包装; u2.connect 三次尝试且会在认为 server 不健康时**重启对端 server**——这正是 smoke test 忙判定与 factory 注释的根因。

处置建议: 二期 TS 若不复刻 helper(决策待定), **互斥不变量必须写进 autogamer-device spec**: 任何占用 UiAutomation 的层级方案会杀掉 helper/其它 a11y 工具; 30s 降级窗与"离线快判"是防超时雪崩的经验参数。

### 1.10 utils/CV/OCR 栈(职责概述)

todo.md 状态: 「D8 例外整区保留(opencv/scipy 强依赖)」已覆盖(todo.md:174-175), 无需展开。职责速览(迁移时知道谁被谁调即可):
- `coordinates.py`(606): swipe 参数解析(direction/target/gesture 兼容)、智能滑动向量(40% 重叠锚)、0-1000 归一/反归一、action dict 归一——**actuator/executor 的坐标大脑**。
- `ui_filter.py`(651): 层级清洗——越界/最小尺寸(短边 0.5% 动态下限, 385-389)、语义空节点、父子冗余剪枝、固定系统条(状态栏/导航栏)钳制; adb_driver 与 observe 共用。
- `task_tree.py`(1174)、`plan_grammar.py`(513): 任务计划 md 的双通道语法(机器通道解析); `notes.py`(470): 笔记工具后端。
- `visualization.py`(802)+`cv_canvas.py`: 元素索引渲染/截图标注(→ DataEngine 图像); `ocr_xml_fusion.py`(318): OCR×XML 融合; `ocr_api.py`: OCR API 客户端; `image_diff.py`(335): 屏幕变化判定; `image_hash.py`: dHash 相似度; `element_hit_test.py`: 像素点→元素命中(Explorer 去重); `video.py` 见 §1.4; `python_executor.py`/`cython_compat.py`: 沙盒执行/兼容。
处置建议: 维持 D8; 仅提示 `coordinates.py`+`ui_filter.py` 的语义(智能滑动向量/清洗规则)是**模型行为质量的一部分**——二期若 agent 重写, 这两个文件的语义规格需要随行。

### 1.11 Windows/平台 quirk 汇总(注释中的边界经验)

| quirk | 证据 |
|---|---|
| 残留 scrcpy 在 Windows 上锁住 MKV 文件 | adb_driver.py:468-471 |
| 停 scrcpy 先发 CTRL_BREAK_EVENT(Windows)/SIGINT 让 recorder flush, 再 terminate | unified_controller.py:69-80; spawn 加 CREATE_NEW_PROCESS_GROUP(60-67) |
| 模拟器进程隔离: Windows CREATE_NEW_PROCESS_GROUP\|CREATE_NO_WINDOW, POSIX start_new_session | emulator_manager.py:77-90 |
| Windows monotonic 时钟 ~16ms 粒度 → 缓存合并判断必须严格大于 | engine.py:156-162 |
| Windows 并发提交下超时后 kill 可能 ProcessLookupError, 需吞掉 | adb_probe.py:342-348 |
| mcp-1.29 客户端: 迟响应进已关闭 response stream → 客户端收环崩溃、会话全灭 | action_server.py:136-142; action_session.py:28-47 |
| py3.12 vs 3.13 docstring dedent 差异 → 工具描述归一 | adb_server.py:92-111 |
| FastMCP/pydantic 版本漂移 → Settings model_rebuild shim | adb_server.py:35-41 |
| uiautomator2 异常继承 BaseException、常带空消息 | device_smoke.py:152-158 |
| 同步 u2 在事件循环线程上 asyncio.wait_for 打不中 → 专属线程+独立 loop | device_smoke.py:33-39, 192-233 |
| ADB restart/heal 必须剥离 ADB_SERVER_SOCKET, 否则打到远程 endpoint | engine.py:327-335; adb_keys.py:213-228; adb_server_connection.py:274-278 |

处置建议: 这些是**跨语言有效的经验**, 应在二期 spike(尤其 G6 Windows 落地)时作为检查单; 建议把此表并入 todo.md G6。

---

## 2. 外部契约清单

### 2.1 文件格式与目录

| 契约 | 规格 | 证据 | todo 状态 |
|---|---|---|---|
| 录像段文件 | `{trace_dir}/recording.mkv`→`recording.mp4`; 第 N 段 `recording_{NNN}.mkv`→`recording_{NNN}.mp4`(N 从 1 起 3 位零填充; 第一段 mp4 固定名 `recording.mp4`) | unified_controller.py:252-256, 340 | **缺失**(todo 仅"录屏栈留py/spillPath") |
| 录像清单 | `recording.json` v2: `{version, duration, session_offset_ms, session_end_ms, segments:[{file,start,duration,offset_ms,duration_ms,width,height}]}`; 原子写 | video.py:360-433 | **缺失** |
| trace 目录终态名 | 未完成目录被孤儿恢复改名为 `{原名}_FAIL_{yyyy-mm-ddTHH-MM-S}`; 状态标记 `_PASS_/_FAIL_/_TESTFAIL_` | media_service.py:152, 179-203 | **缺失**(前端/测试依赖) |
| 步骤截图引用 | trace payload 内图片落盘 `{traces}/images/{sha256}.jpg`, 引用串 `image://{hash}` | media_service.py:446-456; paths.py:257-262 | **缺失** |
| ADB 键 | `~/.android/adbkey(.pub)` / `ADB_VENDOR_KEYS`; 损坏备份 `adbkey.corrupted.{ts}` | adb_keys.py:56-65, 187 | 缺失(机制级) |
| ADB endpoint 持久化 | `{repo}/.env` + `{app_dir}/.env` 双写 ADB_HOST/ADB_PORT | adb_server_connection.py:305-326 | **缺失** |
| 剪辑产物 | `get_temp_dir("trimmed_videos")/video_trimmed_*/segment.mp4` | unified_controller.py:187-191 | 缺失 |
| mcp stdio 日志 | `{traces}/mcp_server.log` | adb_server.py:60-79 | 缺失(可弃) |

### 2.2 HTTP 路由(§1.6 表)——todo「mp4 托管转 autogamer-media」已覆盖方向, 逐路由清单+安全语义缺失。

### 2.3 协议与端口

| 契约 | 值 | 证据 | todo 状态 |
|---|---|---|---|
| ADB server | 127.0.0.1:5037(默认), env ADB_HOST/ADB_PORT/ADB_SERVER_SOCKET 可覆盖 | constants.py:111-112 | 缺失 |
| Helper 设备端口 | 固定 18888(设备 loopback HTTP, X-Artemis-Token); 宿主端口 = adb forward tcp:0 动态 | helper_manager.py:87-92 | **缺失** |
| 无线 adb | adb connect {host}:5555(默认), 8s 超时 | engine.py:400-437 | 缺失 |
| MCP stdio | `artemis mcp --server adb|xml|agent`(stdio/SSE) | cli/commands/mcp.py:828-860 | 缺失(G7 只提 mcp_server 通知面) |
| 归一化坐标 | 全设备动作 0-1000(输入与动作记录), 内部换算 clamp | base.py:194-223; actuators/adb.py:122-131 | **缺失**(TS 重写的核心契约) |
| MCP 动作返回 | CallToolResult.structuredContent=ActionResult, isError=False 恒定 | action_server.py:55-66 | 缺失 |
| mock 录屏路径 | 字面量 `/tmp/mock_recording.mp4` | mock_driver.py:198 | 缺失 |

### 2.4 关键数值常量

| 常量 | 值 | 证据 |
|---|---|---|
| 截图稳定窗 | 0.3s(driver)/400ms 默认 observe settle | adb_driver.py:124; action_server.py:98 |
| 占位截图 | 1x1 PNG 常量 + smoke 判定阈值 512B | adb_driver.py:174; device_smoke.py:74 |
| input_text 清屏 backspace | 20 连发 keyevent 67 | adb_driver.py:315 |
| 长按判定阈值 | tap duration_ms ≥ 500 → swipe 实现 | adb_driver.py:238 |
| 智能滚动向量 | 横向 60% 宽; 纵向 0.7↔0.3 高; 横扫 0.75↔0.25 宽; 800ms | adb_driver.py:274-305 |
| execute_shell 默认超时 | 15s | adb_driver.py:429 |
| scrcpy 码率/分段 | 2M / 1800s | video.py:52; unified_controller 常量 video.py:38 |
| scrcpy 首帧 | 标记 "Recording started"; 回退 +0.75s; 超时 6s | video.py:41-43 |
| scrcpy 停止 | flush 信号等 8s → terminate 5s(driver 路径: terminate 5s) | unified_controller.py:69-80; adb_driver.py:467 |
| 剪辑时间线 | 画布 720x1280@15fps; 间隙容差 0.05s | video.py:467-474, 45 |
| 抽帧 | keyframes 1fps/45帧/1080px/JPEG q80; 按时间戳 30帧/q85 | video.py:593-685 |
| ffmpeg 转换 | remux 15s / 重编码 30s(media_service); 录制活窗 10s | media_service.py:122, 146, 151 |
| unwrap 截断 | 字符串 >2000; XML 列表 >20 元素 | media_service.py:462-477 |
| 提交门禁 | devices 1s; 锁检测 1s×2 确认; (仪表盘 2s×2 + 15s 旧值 TTL) | adb_probe.py:425, 289, 200, 44-45 |
| 富化缓存 | 60s | adb_probe.py:44 |
| 探针总超时/报告缓存 | 30s / 2s | engine.py:53-60 |
| 模拟器 | boot 总超时 180s; emu kill 5s; terminate 3s; 日志环 100 | emulator_manager.py:255, 466-481, 72 |
| 无线连接 | 8s | adb_server_connection.py:172; engine.py:419 |
| smoke | 默认 20s; <512B 占位判定 | device_smoke.py:263, 74 |
| parity | recall≥0.9 / precision≥0.8 / IoU≥0.5 / 3 轮取中位 | hierarchy_parity.py:39-40, 109, 167 |
| helper | 请求 6s(/snapshot 8s); 设备端口 18888; u2 降级窗 30s | accessibility_client.py:151-156, 304; screen_client_factory.py:147 |
| focus 后等待 | 1.0s 键盘弹起 | actuators/adb.py:97 |
| wait_for_text | 0.5s 轮询 / 默认 5000ms | actuators/adb.py:346-360 |
| ActionSession | aclose 5s | action_session.py:208 |
| 扩展工具描述 | ≥40 字符 | action_manifest.py:151 |
| 录像上限 | DEFAULT_MAX_DURATION_SECONDS=900(15min, 基类默认参数; 实际由分段机制接管) | third_party/mobile_use/utils/video.py:42 |
| DataEngine 图片上限 | 500MB(Gemini File API 2GB 限) | third_party/mobile_use/utils/video.py:46-49 |

---

## 3. 漂移风险 Top 10(按风险排序)

1. **录像产物契约整体未成文**(manifest v2/分段命名/首帧锚定/trace 目录 FAIL 改名): autogamer-media 或任何 TS 侧接管托管时, 格式猜错 = 前端时间线/回放/step-seek 全断, 且 py worker(一期保留)继续按 py 格式写——双端漂移概率最高。→ §1.4/2.1 全表交接。
2. **0-1000 归一化坐标 + target_description 契约未写**: 这是 agent 方言↔wire↔trace 记录三方的共同语言; 二期 autogamer-device 换坐标体系(如改像素)会让历史 trace 回放与 prompt 教学全部失配。→ §1.8。
3. **helper/u2 互斥不变量**: 任何新层级实现若占用 UiAutomation 单例(或忘记 u2 用后 stop_server), 会静默杀死 helper 并表现为"偶发全设备层级失败"。→ §1.9。
4. **mock 行为契约 + `is_mock` 死检查**: TS mock 插件若实现 is_mock 或改截图尺寸/路径字面量, 现有断言缝(action_history、/tmp/mock_recording.mp4)与下游判定(smoke 512B)一起漂。→ §1.1。
5. **MCP 会话串行化=单设备策略 + 超时必须工具内生效**: 二期把动作层搬进 DSH 工具时, 若在调用方加超时/重试, 会复刻"迟响应崩会话"或引入设备动作重入(设备任务不重入是 D5 领域约束)。→ §1.8。
6. **提交门禁的锁屏确认语义(fail-closed)与多设备自动切换**: todo G4 只定义了 env 级失败判定; admission 若只查 `adb devices` 不查 Keyguard, 会向锁屏设备派任务(现状明确视为不可提交)。→ §1.7。
7. **媒体 HTTP 面的安全模型**: 现有保证=根约束+扩展白名单, 无鉴权 token; autogamer-media 用 `ctx.connection.fetch` 重写时若只做静态挂载, 会把 workspace 内任意文件(含 .env/db)暴露出去。→ §1.6。
8. **环境变量契约清单不全**: S5 只列 3 个 worker env; `ARTEMIS_MOCK_DRIVER/HIERARCHY_BACKEND/DEVICE_ID/CLOUD_MODE`、`ADB_SERVER_SOCKET/VENDOR_KEYS` 等是双跑期 DSH 侧 spawn/观测 py worker 的必要透传集。→ §1.3。
9. **`image://{hash}` 截图引用协议**: unwrap_payload 是 DataEngine trace 内图片的落盘协议; DSH 承接 trace/回放(映射表"session log 原生")后, 若无人实现该引用的解析, 历史步骤图全丢。→ §1.5。
10. **platform quirk 检查单**(CTRL_BREAK flush/Windows 文件锁/16ms 时钟/stdio 日志静默): 都是注释级知识, 无人携带就会在 Windows 上以"偶现挂死/文件占用"复发。→ §1.11。

---

## 4. 对 docs/todo.md 的修订建议

1. **新增差距 G8 · 录像产物与 trace 媒体契约**: manifest v2 字段、`recording{,_NNN}.(mkv|mp4)` 命名、首帧锚定(session.start_time=首帧)、trace 目录 `_PASS_/_FAIL_/_TESTFAIL_` 终态命名与孤儿改名、`image://{sha256}` 截图引用——绑定到「剩余自建清单 ③ autogamer-media」与 S5 spillPath 交接, 作为其验收规格。(来源 §1.4/1.5)
2. **新增差距 G9 · 设备工具坐标与结果契约**: 0-1000 归一化坐标域、元素索引 client 端解析、target_description 记录不上 wire、ActionResult(ok/code/message/detail, 设备拒绝≠异常)、动作名归一表——绑定 P2/autogamer-device。(来源 §1.8)
3. **新增差距 G10 · 层级后端互斥与降级语义**: helper(18888/X-Artemis-Token)与 u2 的 UiAutomation 单例互斥、auto 模式 30s 降级窗、u2 用后 stop_server、离线快判——绑定 P2; 若二期决定不复刻 helper, 需显式决策并记录对 Mobly/Appium 共存能力的放弃。
4. **映射表修正**: ① `media_service 568 行` → 实为 **623 行**(media_service.py 实测); ② diagnostics 行数 todo.md:144(~3000)与 todo.md:180(~2400)自相矛盾, 实测约 **4300 行**(含 probes 1963/engine 441/smoke 364/emulator 501/keys 270/endpoint 330/parity 216); ③ E 区"提交前就绪检查"建议点名 **submission gate 的锁屏确认+多设备切换语义**为 admission 必须继承项(现 G4 只覆盖 env 级判定)。
5. **S5 环境变量契约补全**: 在 S5 清单追加 driver/观察面 env: `ARTEMIS_MOCK_DRIVER`、`ARTEMIS_CLOUD_MODE`、`ARTEMIS_HIERARCHY_BACKEND`、`ARTEMIS_DEVICE_ID`、`ADB_DEVICE_SERIAL`、`ADB_HOST/PORT/SERVER_SOCKET/VENDOR_KEYS`、`ARTEMIS_DISABLE_ORIGIN_GUARD`(双跑期 DSH→py worker 透传集)。
6. **checklist P2 补充验收基线引用**: autogamer-device/mock 的验收 = 本草稿 §1.1-1.2 能力清单 + §1.9 互斥不变量 + §2 契约表; `koffi/隐藏桌面` 之外补"Windows MKV 文件锁、CTRL_BREAK flush"两条已有经验(并入 G6 检查单)。
7. **删除项确认**: `drivers/android/recorder.py`、`drivers/android/input_ime.py`、`drivers/cloud/cloud_driver.py` 全仓无消费方(§1.2), 可在映射表标注「死代码, 直接删除, 不迁移」。
