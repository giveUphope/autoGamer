/**
 * 系统 store —— M5 完整平移 Angular SystemService
 * （apps/showcase_ui/src/app/services/system.service.ts，610 行）。
 *
 * M1 已交付的连通性契约保持兼容：
 * - `online` / `lastCheckedAt` / `fetchStatus()` / `start()` / `stop()` 导出名不变；
 * - `start()` 升级为：/api/status 连通性轮询(5s) + readiness 自动轮询(3s) + visibilitychange 恢复刷新；
 * - `stop()` 清空全部定时器（连通性 + readiness + emulator 1s 轮询）。
 *
 * 平移语义对照：
 * - Angular signal/computed → ref/computed；Observable 管道 → async/await Promise；
 * - `readinessRequest$ shareReplay(1)` → 共享 in-flight Promise（finalize 后仅当仍是当前请求才清空）；
 * - `applyReadinessReport` 的 timestamp 单调守卫 + 内容签名去重原样保留（母本 L249-263）；
 * - emulator 1s 轮询定时器非响应式（setup 内 let，母本 L52/L296-305）；
 * - v2 增强：fetchReadiness 成功恢复 online=true、失败置 online=false（联动 M1 顶栏小圆点，报告已注明）。
 */

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { apiDelete, apiGet, apiPost } from '@/services/api';
import type { ApiError } from '@/services/api';
import type {
  AdbServerConnectionResponse,
  AdbServerStatus,
  CredentialEntriesResponse,
  CredentialEndpointRow,
  DeviceInfo,
  EmulatorLaunchState,
  ModelConfigEnvResponse,
  ModelConfigUpdatePayload,
  ModelConfigUpdateResult,
  SystemReadinessReport,
} from '@/types/system.model';

const POLL_INTERVAL_MS = 5000;
const READINESS_POLL_INTERVAL_MS = 3000; // 母本 L162/L181：startAutoPolling(3000)
const EMULATOR_POLL_INTERVAL_MS = 1000; // 母本 L296-305：1s 轮询

export const useSystemStore = defineStore('system', () => {
  // ---------------------------------------------------------------------------
  // M1 兼容：/api/status 连通性轮询（顶栏小圆点）
  // ---------------------------------------------------------------------------
  /** 后端连通性（顶栏小圆点）。 */
  const online = ref<boolean>(true);
  const lastCheckedAt = ref<number | null>(null);

  async function fetchStatus(): Promise<void> {
    try {
      await apiGet('/api/status');
      online.value = true;
      lastCheckedAt.value = Date.now();
    } catch {
      online.value = false;
    }
  }

  // ---------------------------------------------------------------------------
  // M5 状态（母本 L37-53、L76、L527）
  // ---------------------------------------------------------------------------
  const readinessReport = ref<SystemReadinessReport | null>(null);
  const hasReadinessReport = computed(() => readinessReport.value !== null);
  const isLoading = ref<boolean>(false);
  const isRestartingAdb = ref<boolean>(false);
  const adbServerStatus = ref<AdbServerStatus | null>(null);
  const isRemoteAdbServer = computed(() => adbServerStatus.value?.endpoint.mode === 'remote');
  const launchingAvd = ref<string | null>(null);
  const emulatorLaunchState = ref<EmulatorLaunchState | null>(null);
  const isEmulatorLaunching = computed(() => {
    const s = emulatorLaunchState.value?.status;
    return s === 'starting' || s === 'waiting_for_adb' || s === 'booting';
  });
  const lastCheckedTime = ref<Date | null>(null);
  const isSkipCredentialsCheck = ref<boolean>(false);
  const modelConfigEnv = ref<ModelConfigEnvResponse | null>(null);
  const credentialRows = ref<CredentialEndpointRow[]>([]);

  /**
   * 当前生效端点的端点库记录名，提交任务时作为 pin 随 /api/run 发出。
   * 正在用着但从未存入库的端点没有名字可 pin，返回 null 让任务跟随全局默认
   * ——后端按名字查库，前端不许编一个名字出来。
   */
  const activeEndpointName = computed<string | null>(() => {
    const row = credentialRows.value.find((entry) => entry.is_active && entry.source === 'library');
    return row?.provider || null;
  });

  // 非响应式定时器与 in-flight 缓存（母本 L52/L151-152/L154）
  let connectivityTimer: ReturnType<typeof setInterval> | null = null;
  let readinessPollTimer: ReturnType<typeof setInterval> | null = null;
  let emulatorPollTimer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let readinessInFlight: Promise<SystemReadinessReport> | null = null;
  let lastAppliedReportJson: string | null = null;

  // ---------------------------------------------------------------------------
  // Probe lookups（母本 L55-61、L107）
  // ---------------------------------------------------------------------------
  const probes = computed(() => readinessReport.value?.probes ?? []);
  const pythonProbe = computed(() => probes.value.find((p) => p.id === 'python_runtime') ?? null);
  const configProbe = computed(() => probes.value.find((p) => p.id === 'system_config') ?? null);
  const toolchainProbe = computed(() => probes.value.find((p) => p.id === 'toolchain') ?? null);
  const adbProbe = computed(() => probes.value.find((p) => p.id === 'android_adb') ?? null);
  // gemini_api_key || llm_api_key 双 id 兼容（母本 L59-60）
  const llmProbe = computed(
    () => probes.value.find((p) => p.id === 'gemini_api_key' || p.id === 'llm_api_key') ?? null,
  );
  const geminiProbe = computed(() => llmProbe.value); // 母本 L60 别名
  const ocrProbe = computed(
    () => probes.value.find((p) => p.id === 'vision_ocr_key' || p.id === 'ocr_api_key') ?? null,
  );

  // ---------------------------------------------------------------------------
  // 三步引导 computed（母本 L64-114）
  // ---------------------------------------------------------------------------
  const isEnvironmentReady = computed(() => {
    const py = pythonProbe.value;
    const cfg = configProbe.value;
    const adb = adbProbe.value;
    const tc = toolchainProbe.value;
    const pyOk = py?.status === 'pass';
    const cfgOk = cfg?.status === 'pass';
    const adbInstalled = adb?.metadata?.['installed'] ?? (adb?.status !== 'fail');
    const tcOk = tc?.status === 'pass' || tc?.is_blocker === false;
    return pyOk && cfgOk && adbInstalled && tcOk;
  });

  const isCredentialsReady = computed(() => {
    if (isSkipCredentialsCheck.value) {
      return true;
    }
    return llmProbe.value?.status === 'pass';
  });

  const isDeviceReady = computed(() => adbProbe.value?.status === 'pass');

  const totalStepCount = computed(() => 3);
  const passedStepCount = computed(() => {
    let count = 0;
    if (isEnvironmentReady.value) count++;
    if (isCredentialsReady.value) count++;
    if (isDeviceReady.value) count++;
    return count;
  });

  const isReady = computed(
    () => isEnvironmentReady.value && isCredentialsReady.value && isDeviceReady.value,
  );
  const blockerCount = computed(() => totalStepCount.value); // 母本 L105 别名
  const passedBlockerCount = computed(() => passedStepCount.value); // 母本 L106 别名

  // ---------------------------------------------------------------------------
  // 其余派生数据（母本 L108-148、L519-525）
  // ---------------------------------------------------------------------------
  const activeDevice = computed(() => readinessReport.value?.active_device ?? null);
  const osType = computed<'linux' | 'darwin' | 'windows'>(() => {
    const raw = readinessReport.value?.os_type;
    if (raw === 'windows' || raw === 'win32') return 'windows';
    if (raw === 'darwin' || raw === 'macos' || raw === 'mac') return 'darwin';
    return 'linux';
  });

  const connectedDevices = computed<DeviceInfo[]>(() => {
    const meta = adbProbe.value?.metadata;
    if (meta && Array.isArray(meta['devices'])) {
      return meta['devices'] as DeviceInfo[];
    }
    return [];
  });

  const installedAvds = computed<string[]>(() => {
    const meta = adbProbe.value?.metadata;
    if (meta && Array.isArray(meta['installed_avds'])) {
      return meta['installed_avds'] as string[];
    }
    return [];
  });

  const emulatorPath = computed<string | null>(
    () => (adbProbe.value?.metadata?.['emulator_path'] as string) || null,
  );

  const isEmulatorInPath = computed<boolean>(
    () => (adbProbe.value?.metadata?.['is_emulator_in_path'] as boolean) ?? true,
  );

  const currentApiKey = computed<string>(
    () => (llmProbe.value?.metadata?.['current_key'] as string) || '',
  );

  const apiKeysMap = computed<Record<string, string>>(
    () => (llmProbe.value?.metadata?.['api_keys'] as Record<string, string>) || {},
  );

  // ---------------------------------------------------------------------------
  // Readiness（母本 L212-263）
  // ---------------------------------------------------------------------------
  /** 应用 readiness 报告：timestamp 单调守卫 + 内容签名去重（母本 L249-263）。 */
  function applyReadinessReport(report: SystemReadinessReport): void {
    const current = readinessReport.value;
    if (current && report.timestamp < current.timestamp) {
      return; // 旧报告丢弃
    }
    lastCheckedTime.value = new Date(report.timestamp * 1000);
    // 3s 轮询通常返回同内容报告：timestamp 归零后签名一致则不 set，避免零意义的响应式抖动。
    const serialized = JSON.stringify({ ...report, timestamp: 0 });
    if (serialized === lastAppliedReportJson) {
      return;
    }
    lastAppliedReportJson = serialized;
    readinessReport.value = report;
  }

  /**
   * 拉取系统 readiness 报告（母本 L212-247）。
   * - silent=true 不触发 isLoading（轮询 / visibilitychange 用）；
   * - forceRefresh=true 加 `?force=true`（只留给手动刷新按钮）；
   * - 共享 in-flight：初始化/轮询/焦点/手动刷新共用同一请求，防止慢探针排队。
   * 错误透传给调用方；轮询等内部调用方自行静默 catch（console.error 已在链内执行）。
   */
  function fetchReadiness(
    silent: boolean = false,
    forceRefresh: boolean = false,
  ): Promise<SystemReadinessReport> {
    if (!silent) {
      isLoading.value = true;
    }
    if (readinessInFlight) {
      return readinessInFlight;
    }
    const url = forceRefresh ? '/api/system/readiness?force=true' : '/api/system/readiness';
    const request: Promise<SystemReadinessReport> = apiGet<SystemReadinessReport>(url)
      .then((report) => {
        online.value = true; // v2 增强：readiness 成功即视为后端可达
        applyReadinessReport(report);
        return report;
      })
      .catch((err: unknown) => {
        console.error('Failed to fetch system readiness:', err);
        online.value = false; // v2 增强
        throw err;
      })
      .finally(() => {
        // shareReplay 语义：finalize 后仅当仍是当前请求才清空 in-flight
        if (readinessInFlight === request) {
          readinessInFlight = null;
        }
        isLoading.value = false;
      });
    readinessInFlight = request;
    return request;
  }

  /** 启动 readiness 自动轮询（母本 L181-196）：页面隐藏时跳过，默认 3s。 */
  function startAutoPolling(intervalMs: number = READINESS_POLL_INTERVAL_MS): void {
    if (readinessPollTimer) {
      clearInterval(readinessPollTimer);
    }
    readinessPollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      void fetchReadiness(true).catch(() => {}); // 静默后台检查
    }, intervalMs);
  }

  function stopAutoPolling(): void {
    if (readinessPollTimer) {
      clearInterval(readinessPollTimer);
      readinessPollTimer = null;
    }
  }

  function skipCredentialsCheck(): void {
    isSkipCredentialsCheck.value = true;
  }

  function setSkipCredentialsCheck(skip: boolean): void {
    isSkipCredentialsCheck.value = skip;
  }

  // ---------------------------------------------------------------------------
  // Emulator（母本 L268-397）
  // ---------------------------------------------------------------------------
  /** 拉取 emulator 启动进度快照（母本 L268-291）。 */
  async function fetchEmulatorStatus(): Promise<EmulatorLaunchState> {
    try {
      const state = await apiGet<EmulatorLaunchState>('/api/system/emulator/status');
      emulatorLaunchState.value = state;
      if (state.status === 'ready') {
        launchingAvd.value = null;
        stopEmulatorStatusPolling();
        void fetchReadiness().catch(() => {}); // ready → 停轮询 + 刷新 readiness（母本 L276）
      } else if (
        state.status === 'failed' ||
        state.status === 'stopped' ||
        state.status === 'idle'
      ) {
        launchingAvd.value = null;
        stopEmulatorStatusPolling();
      } else if (state.avd_name) {
        launchingAvd.value = state.avd_name; // 其余状态更新 launchingAvd
      }
      return state;
    } catch (err) {
      console.error('Failed to fetch emulator status:', err);
      throw err;
    }
  }

  /** 1s 间隔轮询 emulator 启动进度（母本 L296-305）。 */
  function startEmulatorStatusPolling(): void {
    if (emulatorPollTimer) {
      clearInterval(emulatorPollTimer);
    }
    emulatorPollTimer = setInterval(() => {
      void fetchEmulatorStatus().catch(() => {});
    }, EMULATOR_POLL_INTERVAL_MS);
  }

  function stopEmulatorStatusPolling(): void {
    if (emulatorPollTimer) {
      clearInterval(emulatorPollTimer);
      emulatorPollTimer = null;
    }
  }

  /** 后台启动 AVD 并持续跟踪启动进度（母本 L320-366）。 */
  async function launchEmulator(avdName: string): Promise<EmulatorLaunchState> {
    // 乐观初始态（母本 L321-334）
    launchingAvd.value = avdName;
    emulatorLaunchState.value = {
      avd_name: avdName,
      status: 'starting',
      pid: null,
      serial: null,
      stage_message: 'Spawning emulator process...',
      progress_percent: 15,
      started_at: Date.now() / 1000,
      elapsed_seconds: 0,
      error: null,
      logs: [`Initiating launch for AVD: ${avdName}...`],
      can_retry: true,
    };
    try {
      const state = await apiPost<EmulatorLaunchState>('/api/system/emulator/launch', {
        avd_name: avdName,
      });
      emulatorLaunchState.value = state;
      if (state.status === 'failed') {
        launchingAvd.value = null;
      } else {
        startEmulatorStatusPolling(); // 非失败即开轮询
      }
      return state;
    } catch (err) {
      console.error('Failed to launch emulator:', err);
      launchingAvd.value = null;
      // 错误合成失败态（母本 L346-363）
      const errorMsg =
        (err as ApiError)?.detail || (err as Error)?.message || 'Failed to start emulator process.';
      emulatorLaunchState.value = {
        avd_name: avdName,
        status: 'failed',
        pid: null,
        serial: null,
        stage_message: 'Failed to initiate launch.',
        progress_percent: 0,
        started_at: null,
        elapsed_seconds: 0,
        error: errorMsg,
        logs: [errorMsg],
        can_retry: true,
      };
      throw err;
    }
  }

  /** 终止运行中的 emulator（母本 L371-382）。 */
  async function stopEmulator(): Promise<any> {
    const res = await apiPost<any>('/api/system/emulator/stop', {});
    launchingAvd.value = null;
    stopEmulatorStatusPolling();
    void fetchEmulatorStatus().catch(() => {});
    void fetchReadiness().catch(() => {});
    return res;
  }

  /** 清除并关闭 emulator 启动跟踪状态（母本 L387-397）。 */
  async function dismissEmulatorStatus(): Promise<any> {
    const res = await apiPost<any>('/api/system/emulator/dismiss', {});
    emulatorLaunchState.value = null;
    launchingAvd.value = null;
    stopEmulatorStatusPolling();
    return res;
  }

  // ---------------------------------------------------------------------------
  // ADB（母本 L402-517）
  // ---------------------------------------------------------------------------
  /** 重启本地 ADB 并应用返回的 readiness（母本 L402-418）。 */
  async function restartAdb(): Promise<any> {
    isRestartingAdb.value = true;
    try {
      const res = await apiPost<any>('/api/system/adb/restart', {});
      if (res?.report) {
        applyReadinessReport(res.report);
      }
      return res;
    } catch (err) {
      console.error('Failed to restart ADB server:', err);
      throw err;
    } finally {
      isRestartingAdb.value = false;
    }
  }

  /** Wi-Fi 连接 Android 设备（母本 L423-433）。 */
  async function connectWirelessAdb(host: string, port: number = 5555): Promise<any> {
    const res = await apiPost<any>('/api/system/adb/connect', { host, port });
    if (res?.report) {
      applyReadinessReport(res.report);
    }
    return res;
  }

  /** 拉取当前进程使用的 ADB server 端点（母本 L438-442）。 */
  async function fetchAdbServerStatus(): Promise<AdbServerStatus> {
    const status = await apiGet<AdbServerStatus>('/api/system/adb/server');
    adbServerStatus.value = status;
    return status;
  }

  /** 只测不改：探测 ADB server 端点，persist:false（母本 L447-455）。 */
  function probeAdbServer(
    host: string,
    port: number,
  ): Promise<AdbServerConnectionResponse> {
    return apiPost<AdbServerConnectionResponse>('/api/system/adb/server/probe', {
      host,
      port,
      persist: false,
    });
  }

  /** 校验并激活 ADB server 端点：connection_result.success 时才更新状态与 report（母本 L460-478）。 */
  async function connectAdbServer(
    host: string,
    port: number,
    persist: boolean = true,
  ): Promise<AdbServerConnectionResponse> {
    const response = await apiPost<AdbServerConnectionResponse>('/api/system/adb/server/connect', {
      host,
      port,
      persist,
    });
    if (response.connection_result.success) {
      adbServerStatus.value = { endpoint: response.connection_result.endpoint };
      if (response.report) {
        applyReadinessReport(response.report);
      }
    }
    return response;
  }

  /** 切回标准本地 ADB server；persist 走 query（母本 L483-496；v2 apiPost 无 params 故拼 URL）。 */
  async function useLocalAdbServer(persist: boolean = true): Promise<AdbServerConnectionResponse> {
    const response = await apiPost<AdbServerConnectionResponse>(
      `/api/system/adb/server/local?persist=${persist}`,
      {},
    );
    adbServerStatus.value = { endpoint: response.connection_result.endpoint };
    if (response.report) {
      applyReadinessReport(response.report);
    }
    return response;
  }

  /** 选择活动设备串号：isLoading + 应用 report（母本 L501-517）。 */
  async function selectDevice(serial: string): Promise<any> {
    isLoading.value = true;
    try {
      const res = await apiPost<any>('/api/system/devices/select', { serial });
      if (res?.report) {
        applyReadinessReport(res.report);
      }
      return res;
    } catch (err) {
      console.error('Failed to select active device:', err);
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  // ---------------------------------------------------------------------------
  // 凭据与 model-config-env（母本 L519-578）
  // ---------------------------------------------------------------------------
  /** 拉取 artemis.jsonc 与 .env 状态（母本 L532-543）。 */
  async function fetchModelConfigEnv(): Promise<ModelConfigEnvResponse> {
    try {
      const data = await apiGet<ModelConfigEnvResponse>('/api/system/model-config-env');
      modelConfigEnv.value = data;
      return data;
    } catch (err) {
      console.error('Failed to fetch model config and env:', err);
      throw err;
    }
  }

  /** 不落库验证 API key（母本 L548-554）。 */
  function testApiKey(
    provider: string,
    apiKey: string,
    baseUrl?: string,
  ): Promise<{ valid: boolean; provider: string; message: string }> {
    return apiPost<{ valid: boolean; provider: string; message: string }>(
      '/api/system/credentials/test',
      { provider, api_key: apiKey, base_url: baseUrl },
    );
  }

  /** 更新并配置 API key：成功应用 report + 刷新 modelConfigEnv（母本 L559-578）。 */
  async function updateApiKey(
    provider: string,
    apiKey: string,
    persistToEnv: boolean = true,
  ): Promise<any> {
    try {
      const res = await apiPost<any>('/api/system/credentials', {
        provider,
        api_key: apiKey,
        persist_to_env: persistToEnv,
      });
      if (res?.report) {
        applyReadinessReport(res.report);
      }
      void fetchModelConfigEnv().catch(() => {}); // 刷新 model config & env
      void fetchCredentialEntries().catch(() => {}); // 掩码后的 Key 列同样要跟着变
      return res;
    } catch (err) {
      console.error(`Failed to update credentials for ${provider}:`, err);
      throw err;
    }
  }

  /**
   * 保存默认模型端点配置（provider/model/api_base/可选 api_key）：后端写入
   * artemis.jsonc default 块与 .env，填了提供商名还会存成一条端点库记录；
   * 成功后同时刷新配置卡与端点库列表（两者读的是同一个 default 块，漏一个就
   * 会出现「保存成功但页面没变」）。
   */
  async function saveModelConfig(
    payload: ModelConfigUpdatePayload,
  ): Promise<ModelConfigUpdateResult | null> {
    try {
      const res = await apiPost<ModelConfigUpdateResult>('/api/system/model-config', payload);
      void fetchModelConfigEnv().catch(() => {}); // 刷新 model config & env
      void fetchCredentialEntries().catch(() => {}); // 刷新端点库列表
      return res;
    } catch (err) {
      console.error('Failed to save model config:', err);
      throw err;
    }
  }

  /**
   * 选用端点库里的一条记录作为当前默认：后端按名字从库里取端点写入 default 块
   * （密钥只在后端流转），成功后刷新配置卡与端点库列表。
   */
  async function useEndpoint(name: string): Promise<ModelConfigUpdateResult | null> {
    try {
      const res = await apiPost<ModelConfigUpdateResult>('/api/system/endpoints/use', { name });
      void fetchModelConfigEnv().catch(() => {});
      void fetchCredentialEntries().catch(() => {});
      return res;
    } catch (err) {
      console.error('Failed to use endpoint:', err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // 端点库（表格：一行一条记录，字段作列名；当前生效的那条带 is_active）
  // ---------------------------------------------------------------------------
  /** 拉取端点库记录（API Key 仅掩码回显）。录入走端点信息表单，生效走 useEndpoint。 */
  async function fetchCredentialEntries(): Promise<CredentialEntriesResponse> {
    try {
      const data = await apiGet<CredentialEntriesResponse>('/api/system/credentials/entries');
      credentialRows.value = data.rows;
      return data;
    } catch (err) {
      console.error('Failed to fetch credential entries:', err);
      throw err;
    }
  }

  /**
   * 删除一行端点记录：库记录走 `/api/system/endpoints/{name}`（只删记录，不动
   * 运行时正在用的配置）；「用了但没存」的 default 行走 `/api/system/model-config`
   * （清空 default 块，回到出厂配置）。两条路都刷新列表与配置卡。
   */
  async function deleteEndpointRecord(
    row: CredentialEndpointRow,
  ): Promise<{ status?: string; message?: string } | null> {
    const url =
      row.source === 'library' && row.provider
        ? `/api/system/endpoints/${encodeURIComponent(row.provider)}`
        : '/api/system/model-config';
    try {
      const res = await apiDelete<{ status?: string; message?: string }>(url);
      void fetchCredentialEntries().catch(() => {});
      void fetchModelConfigEnv().catch(() => {});
      return res;
    } catch (err) {
      console.error('Failed to delete endpoint record:', err);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // 生命周期（M1 兼容 + M5 readiness 轮询；母本 L155-206）
  // ---------------------------------------------------------------------------
  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && !document.hidden) {
      void fetchStatus();
      // 恢复可见时静默刷新 readiness（母本 L155-159）
      void fetchReadiness(true).catch(() => {});
    }
  };

  function start(intervalMs: number = POLL_INTERVAL_MS): void {
    if (started) return;
    started = true;
    void fetchStatus();
    connectivityTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      void fetchStatus();
    }, intervalMs);
    startAutoPolling(); // M5：readiness 3s 自动轮询（对应母本 L162 构造期启动）
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
  }

  function stop(): void {
    if (connectivityTimer) {
      clearInterval(connectivityTimer);
      connectivityTimer = null;
    }
    stopAutoPolling();
    stopEmulatorStatusPolling();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    started = false;
  }

  return {
    // M1 兼容
    online,
    lastCheckedAt,
    fetchStatus,
    start,
    stop,
    // M5 状态
    readinessReport,
    hasReadinessReport,
    isLoading,
    isRestartingAdb,
    adbServerStatus,
    isRemoteAdbServer,
    launchingAvd,
    emulatorLaunchState,
    isEmulatorLaunching,
    lastCheckedTime,
    isSkipCredentialsCheck,
    modelConfigEnv,
    // probe lookups
    probes,
    pythonProbe,
    configProbe,
    toolchainProbe,
    adbProbe,
    llmProbe,
    geminiProbe,
    ocrProbe,
    // 三步引导
    isEnvironmentReady,
    isCredentialsReady,
    isDeviceReady,
    isReady,
    passedStepCount,
    totalStepCount,
    blockerCount,
    passedBlockerCount,
    // 设备 / emulator / 凭据派生
    activeDevice,
    osType,
    connectedDevices,
    installedAvds,
    emulatorPath,
    isEmulatorInPath,
    currentApiKey,
    apiKeysMap,
    // actions
    startAutoPolling,
    stopAutoPolling,
    skipCredentialsCheck,
    setSkipCredentialsCheck,
    fetchReadiness,
    fetchEmulatorStatus,
    startEmulatorStatusPolling,
    stopEmulatorStatusPolling,
    launchEmulator,
    stopEmulator,
    dismissEmulatorStatus,
    restartAdb,
    connectWirelessAdb,
    fetchAdbServerStatus,
    probeAdbServer,
    connectAdbServer,
    useLocalAdbServer,
    selectDevice,
    fetchModelConfigEnv,
    testApiKey,
    updateApiKey,
    saveModelConfig,
    useEndpoint,
    credentialRows,
    activeEndpointName,
    fetchCredentialEntries,
    deleteEndpointRecord,
  };
});
