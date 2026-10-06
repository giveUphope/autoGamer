import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/services/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

import { apiGet, apiPost } from '@/services/api';
import { useSystemStore } from './system';
import type {
  DeviceInfo,
  EmulatorLaunchState,
  ModelConfigEnvResponse,
  ProbeResult,
  ProbeStatus,
  SystemReadinessReport,
} from '@/types/system.model';

const apiGetMock = apiGet as unknown as Mock;
const apiPostMock = apiPost as unknown as Mock;

const READINESS_URL = '/api/system/readiness';
const EMULATOR_STATUS_URL = '/api/system/emulator/status';

const remoteEndpoint = {
  host: '10.0.0.5',
  port: 5037,
  socket: '10.0.0.5:5037',
  identity: 'remote',
  mode: 'remote' as const,
  is_local_default: false,
};
const localEndpoint = {
  host: '127.0.0.1',
  port: 5037,
  socket: '127.0.0.1:5037',
  identity: 'local',
  mode: 'local' as const,
  is_local_default: true,
};

function makeProbe(
  id: string,
  status: ProbeStatus,
  metadata: Record<string, unknown> = {},
  isBlocker = true,
): ProbeResult {
  return {
    id,
    category: 'runtime',
    title: id,
    status,
    is_blocker: isBlocker,
    summary: '',
    description: '',
    metadata,
    actions: [],
  };
}

function makeReport(overrides: Partial<SystemReadinessReport> = {}): SystemReadinessReport {
  return {
    overall_ready: false,
    blocker_count: 3,
    passed_blocker_count: 0,
    probes: [],
    active_device: null,
    os_type: 'win32',
    timestamp: 1000,
    ...overrides,
  };
}

function makeEmulatorState(overrides: Partial<EmulatorLaunchState> = {}): EmulatorLaunchState {
  return {
    avd_name: 'Pixel_7',
    status: 'starting',
    pid: 4321,
    serial: null,
    stage_message: 'starting',
    progress_percent: 30,
    started_at: 1700000000,
    elapsed_seconds: 1,
    error: null,
    logs: [],
    can_retry: false,
    ...overrides,
  };
}

function makeDevice(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    serial: 'emu-5554',
    state: 'device',
    model: 'Pixel_7',
    product: null,
    android_version: null,
    screen_resolution: null,
    is_locked: null,
    is_emulator: true,
    ...overrides,
  };
}

function makeModelConfigEnv(): ModelConfigEnvResponse {
  return {
    config_path: '/cfg/artemis.jsonc',
    config_filename: 'artemis.jsonc',
    config_content: '{}',
    default_model: { provider: 'google', model: 'gemini-2.0-flash' },
    presets: {},
    env_path: '/cfg/.env',
    env_filename: '.env',
    env_vars: [
      {
        name: 'GEMINI_API_KEY',
        provider: 'google',
        is_set: true,
        preview: '****abcd',
        description: 'gemini key',
      },
    ],
  };
}

function emulatorStatusCallCount(): number {
  return apiGetMock.mock.calls.filter((c) => c[0] === EMULATOR_STATUS_URL).length;
}

function cleanupTimers(): void {
  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
}

describe('system store — M1 最小连通性轮询', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });
  afterEach(cleanupTimers);

  it('后端可达时 online=true', async () => {
    apiGetMock.mockResolvedValue({ status: 'idle' });
    const store = useSystemStore();

    await store.fetchStatus();

    expect(store.online).toBe(true);
    expect(store.lastCheckedAt).not.toBeNull();
  });

  it('后端不可达时 online=false（顶栏小圆点数据源）', async () => {
    apiGetMock.mockRejectedValue(new Error('down'));
    const store = useSystemStore();
    store.online = true;

    await store.fetchStatus();

    expect(store.online).toBe(false);
  });

  it('轮询在页面隐藏时跳过、可见时恢复', async () => {
    vi.useFakeTimers();
    apiGetMock.mockResolvedValue({ status: 'idle' });
    const store = useSystemStore();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    apiGetMock.mockClear();

    // 模拟页面隐藏：连通性与 readiness 轮询均跳过
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(apiGetMock).not.toHaveBeenCalled();

    // 模拟恢复可见 → 立即刷新（M5 起 readiness 也会一并静默刷新）
    hiddenSpy.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    const statusCalls = apiGetMock.mock.calls.filter((c) => c[0] === '/api/status').length;
    expect(statusCalls).toBe(1);
    expect(apiGetMock).toHaveBeenCalledWith(READINESS_URL);

    store.stop();
    vi.useRealTimers();
    hiddenSpy.mockRestore();
  });
});

describe('system store — M5 readiness', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });
  afterEach(cleanupTimers);

  it('fetchReadiness silent=true 不置 isLoading；非静默置位并在完成后复位', async () => {
    let resolveFn!: (v: SystemReadinessReport) => void;
    apiGetMock.mockImplementationOnce(
      () => new Promise<SystemReadinessReport>((res) => (resolveFn = res)),
    );
    const store = useSystemStore();

    const p = store.fetchReadiness();
    expect(store.isLoading).toBe(true);
    resolveFn(makeReport());
    await p;
    expect(store.isLoading).toBe(false);

    apiGetMock.mockResolvedValueOnce(makeReport());
    await store.fetchReadiness(true);
    expect(store.isLoading).toBe(false);
  });

  it('forceRefresh 时请求带 ?force=true 的 URL', async () => {
    apiGetMock.mockResolvedValue(makeReport());
    const store = useSystemStore();

    await store.fetchReadiness(false, true);
    expect(apiGetMock).toHaveBeenCalledWith(`${READINESS_URL}?force=true`);

    await store.fetchReadiness(true, false);
    expect(apiGetMock).toHaveBeenLastCalledWith(READINESS_URL);
  });

  it('timestamp 单调守卫：旧报告被丢弃', async () => {
    apiGetMock.mockResolvedValue(
      makeReport({ timestamp: 2000, probes: [makeProbe('python_runtime', 'pass')] }),
    );
    const store = useSystemStore();
    await store.fetchReadiness();
    const first = store.readinessReport;

    apiGetMock.mockResolvedValue(makeReport({ timestamp: 1000, probes: [] }));
    await store.fetchReadiness(true);

    expect(store.readinessReport).toBe(first);
    expect(store.readinessReport?.timestamp).toBe(2000);
  });

  it('内容签名去重：同内容不同 timestamp 不触发响应式更新（引用不变）', async () => {
    apiGetMock.mockResolvedValue(makeReport({ timestamp: 1000 }));
    const store = useSystemStore();
    await store.fetchReadiness();
    const first = store.readinessReport;
    expect(first).not.toBeNull();

    apiGetMock.mockResolvedValue(makeReport({ timestamp: 2000 }));
    await store.fetchReadiness(true);

    expect(store.readinessReport).toBe(first);
  });

  it('并发多次 fetchReadiness 共享同一 in-flight 请求（只发一次）', async () => {
    let resolveFn!: (v: SystemReadinessReport) => void;
    apiGetMock.mockImplementation(
      () => new Promise<SystemReadinessReport>((res) => (resolveFn = res)),
    );
    const store = useSystemStore();

    const p1 = store.fetchReadiness();
    const p2 = store.fetchReadiness(true);
    const p3 = store.fetchReadiness(); // 非静默加入同样共享
    resolveFn(makeReport());
    await Promise.all([p1, p2, p3]);

    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(store.isLoading).toBe(false); // finalize 复位
  });

  it('startAutoPolling 每 3s 静默拉取 readiness', async () => {
    vi.useFakeTimers();
    apiGetMock.mockResolvedValue(makeReport());
    const store = useSystemStore();
    store.startAutoPolling();
    await vi.advanceTimersByTimeAsync(0);
    apiGetMock.mockClear();

    await vi.advanceTimersByTimeAsync(3000);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(apiGetMock).toHaveBeenCalledWith(READINESS_URL);
    expect(store.isLoading).toBe(false); // 静默轮询不触发全局 loading

    store.stopAutoPolling();
  });

  it('自动轮询在页面隐藏时跳过', async () => {
    vi.useFakeTimers();
    apiGetMock.mockResolvedValue(makeReport());
    const store = useSystemStore();
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    store.startAutoPolling();

    await vi.advanceTimersByTimeAsync(9000);
    expect(apiGetMock).not.toHaveBeenCalled();

    hiddenSpy.mockRestore();
    store.stopAutoPolling();
  });

  it('visibilitychange 恢复可见时静默刷新 readiness', async () => {
    vi.useFakeTimers();
    apiGetMock.mockResolvedValue(makeReport());
    const store = useSystemStore();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    apiGetMock.mockClear();

    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    expect(apiGetMock).toHaveBeenCalledWith(READINESS_URL);
    expect(store.isLoading).toBe(false);
    store.stop();
  });

  it('fetchReadiness 失败联动 online=false，成功恢复 true（v2 增强）', async () => {
    apiGetMock.mockRejectedValueOnce(new Error('down'));
    const store = useSystemStore();

    await expect(store.fetchReadiness(true)).rejects.toThrow('down');
    expect(store.online).toBe(false);

    apiGetMock.mockResolvedValue(makeReport());
    await store.fetchReadiness(true);
    expect(store.online).toBe(true);
  });
});

describe('system store — M5 emulator', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });
  afterEach(cleanupTimers);

  it('launchEmulator 先置乐观初始态，POST 成功后开启 1s 轮询', async () => {
    vi.useFakeTimers();
    apiPostMock.mockResolvedValue(makeEmulatorState({ status: 'starting' }));
    const store = useSystemStore();

    const p = store.launchEmulator('Pixel_7');
    // 乐观初始态同步可见（母本 L321-334）
    expect(store.launchingAvd).toBe('Pixel_7');
    expect(store.emulatorLaunchState?.status).toBe('starting');
    expect(store.emulatorLaunchState?.progress_percent).toBe(15);
    expect(store.emulatorLaunchState?.stage_message).toBe('Spawning emulator process...');
    expect(apiPostMock).toHaveBeenCalledWith('/api/system/emulator/launch', {
      avd_name: 'Pixel_7',
    });

    await p;
    apiGetMock.mockResolvedValue(
      makeEmulatorState({ status: 'waiting_for_adb', progress_percent: 45 }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(emulatorStatusCallCount()).toBe(1);
    expect(store.emulatorLaunchState?.progress_percent).toBe(45);
    expect(store.launchingAvd).toBe('Pixel_7');

    store.stopEmulatorStatusPolling();
  });

  it('轮询中 status=ready → 停轮询并刷新 readiness', async () => {
    vi.useFakeTimers();
    apiPostMock.mockResolvedValue(makeEmulatorState({ status: 'starting' }));
    const store = useSystemStore();
    await store.launchEmulator('Pixel_7');

    apiGetMock.mockImplementation((url: string) =>
      url === EMULATOR_STATUS_URL
        ? Promise.resolve(
            makeEmulatorState({ status: 'ready', serial: 'emu-5554', progress_percent: 100 }),
          )
        : Promise.resolve(makeReport({ timestamp: 5000, overall_ready: true })),
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.emulatorLaunchState?.status).toBe('ready');
    expect(store.launchingAvd).toBeNull();
    expect(store.isEmulatorLaunching).toBe(false);
    expect(apiGetMock).toHaveBeenCalledWith(READINESS_URL); // ready 后刷新 readiness

    await vi.advanceTimersByTimeAsync(5000);
    expect(emulatorStatusCallCount()).toBe(1); // 轮询已停
  });

  it('轮询中 status=failed/stopped/idle → 停轮询', async () => {
    vi.useFakeTimers();
    apiPostMock.mockResolvedValue(makeEmulatorState({ status: 'starting' }));
    const store = useSystemStore();
    await store.launchEmulator('Pixel_7');

    apiGetMock.mockResolvedValue(makeEmulatorState({ status: 'stopped' }));
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.launchingAvd).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(emulatorStatusCallCount()).toBe(1); // 轮询已停
  });

  it('POST 失败 → 合成失败态并透传错误', async () => {
    apiPostMock.mockRejectedValue({ detail: 'AVD not found', message: 'HTTP 500' });
    const store = useSystemStore();

    await expect(store.launchEmulator('Pixel_7')).rejects.toEqual({
      detail: 'AVD not found',
      message: 'HTTP 500',
    });
    expect(store.launchingAvd).toBeNull();
    expect(store.emulatorLaunchState?.status).toBe('failed');
    expect(store.emulatorLaunchState?.error).toBe('AVD not found'); // detail 优先于 message
    expect(store.emulatorLaunchState?.progress_percent).toBe(0);
    expect(store.emulatorLaunchState?.can_retry).toBe(true);
  });
});

describe('system store — M5 ADB', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });
  afterEach(cleanupTimers);

  it('connectAdbServer 成功时更新 adbServerStatus 与 report；失败时均不更新', async () => {
    apiGetMock.mockResolvedValue(makeReport({ timestamp: 1000 }));
    const store = useSystemStore();
    await store.fetchReadiness();
    expect(store.readinessReport?.timestamp).toBe(1000);

    // connection_result.success=false → 状态与报告均不更新
    apiPostMock.mockResolvedValue({
      connection_result: {
        success: false,
        message: 'refused',
        endpoint: remoteEndpoint,
        devices: [],
      },
    });
    await store.connectAdbServer('10.0.0.5', 5037);
    expect(store.adbServerStatus).toBeNull();
    expect(store.readinessReport?.timestamp).toBe(1000);

    // 成功 → 更新 endpoint + report
    apiPostMock.mockResolvedValue({
      connection_result: {
        success: true,
        message: 'ok',
        endpoint: remoteEndpoint,
        devices: [],
      },
      report: makeReport({ timestamp: 2000, overall_ready: true }),
    });
    await store.connectAdbServer('10.0.0.5', 5037);
    expect(store.adbServerStatus?.endpoint.mode).toBe('remote');
    expect(store.isRemoteAdbServer).toBe(true);
    expect(store.readinessReport?.overall_ready).toBe(true);
  });

  it('useLocalAdbServer 以 query 传 persist 并更新 endpoint 与 report', async () => {
    apiPostMock.mockResolvedValue({
      connection_result: {
        success: true,
        message: 'ok',
        endpoint: localEndpoint,
        devices: [],
      },
      report: makeReport({ timestamp: 3000 }),
    });
    const store = useSystemStore();

    await store.useLocalAdbServer(false);
    expect(apiPostMock).toHaveBeenCalledWith('/api/system/adb/server/local?persist=false', {});
    expect(store.adbServerStatus?.endpoint.mode).toBe('local');
    expect(store.isRemoteAdbServer).toBe(false);
    expect(store.readinessReport?.timestamp).toBe(3000);
  });

  it('probeAdbServer 只测不切：不改任何状态', async () => {
    apiPostMock.mockResolvedValue({
      connection_result: {
        success: true,
        message: 'ok',
        endpoint: remoteEndpoint,
        devices: [],
      },
    });
    const store = useSystemStore();

    const res = await store.probeAdbServer('10.0.0.5', 5037);
    expect(apiPostMock).toHaveBeenCalledWith('/api/system/adb/server/probe', {
      host: '10.0.0.5',
      port: 5037,
      persist: false,
    });
    expect(res.connection_result.success).toBe(true);
    expect(store.adbServerStatus).toBeNull();
    expect(store.readinessReport).toBeNull();
  });
});

describe('system store — M5 凭据', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });
  afterEach(cleanupTimers);

  it('updateApiKey 成功后应用 report 并刷新 modelConfigEnv', async () => {
    apiPostMock.mockResolvedValue({
      status: 'success',
      report: makeReport({ timestamp: 2000, overall_ready: true }),
    });
    apiGetMock.mockResolvedValue(makeModelConfigEnv());
    const store = useSystemStore();

    await store.updateApiKey('google', 'key-123', false);
    expect(apiPostMock).toHaveBeenCalledWith('/api/system/credentials', {
      provider: 'google',
      api_key: 'key-123',
      persist_to_env: false,
    });
    expect(store.readinessReport?.overall_ready).toBe(true);
    expect(store.modelConfigEnv?.config_filename).toBe('artemis.jsonc');
    expect(store.modelConfigEnv?.env_vars[0]?.name).toBe('GEMINI_API_KEY');
  });

  it('testApiKey 不落库且不改状态', async () => {
    apiPostMock.mockResolvedValue({ valid: true, provider: 'google', message: 'ok' });
    const store = useSystemStore();

    const res = await store.testApiKey('google', 'key-123', 'https://proxy.example');
    expect(apiPostMock).toHaveBeenCalledWith('/api/system/credentials/test', {
      provider: 'google',
      api_key: 'key-123',
      base_url: 'https://proxy.example',
    });
    expect(res.valid).toBe(true);
    expect(store.readinessReport).toBeNull();
    expect(store.modelConfigEnv).toBeNull();
  });

  it('skipCredentialsCheck 旁路 isCredentialsReady', async () => {
    apiGetMock.mockResolvedValue(makeReport({ probes: [makeProbe('llm_api_key', 'fail')] }));
    const store = useSystemStore();
    await store.fetchReadiness();

    expect(store.isCredentialsReady).toBe(false);
    store.skipCredentialsCheck();
    expect(store.isCredentialsReady).toBe(true);
    store.setSkipCredentialsCheck(false);
    expect(store.isCredentialsReady).toBe(false);
  });
});

describe('system store — M5 三步引导 computed', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });
  afterEach(cleanupTimers);

  it('全部 fail：passedStepCount=0、isReady=false', async () => {
    apiGetMock.mockResolvedValue(
      makeReport({
        timestamp: 1000,
        probes: [
          makeProbe('python_runtime', 'fail'),
          makeProbe('system_config', 'fail'),
          makeProbe('toolchain', 'fail'),
          makeProbe('android_adb', 'fail'),
          makeProbe('llm_api_key', 'fail'),
        ],
      }),
    );
    const store = useSystemStore();
    await store.fetchReadiness();

    expect(store.totalStepCount).toBe(3);
    expect(store.isEnvironmentReady).toBe(false);
    expect(store.isCredentialsReady).toBe(false);
    expect(store.isDeviceReady).toBe(false);
    expect(store.passedStepCount).toBe(0);
    expect(store.isReady).toBe(false);
  });

  it('isEnvironmentReady 四条件：py/cfg 通过但 adb installed=false 仍不就绪', async () => {
    apiGetMock.mockResolvedValue(
      makeReport({
        timestamp: 1000,
        probes: [
          makeProbe('python_runtime', 'pass'),
          makeProbe('system_config', 'pass'),
          makeProbe('toolchain', 'pass'),
          makeProbe('android_adb', 'pass', { installed: false }),
          makeProbe('gemini_api_key', 'pass'),
        ],
      }),
    );
    const store = useSystemStore();
    await store.fetchReadiness();

    expect(store.isDeviceReady).toBe(true); // adb status=pass
    expect(store.isCredentialsReady).toBe(true);
    expect(store.isEnvironmentReady).toBe(false); // installed=false 拦下
    expect(store.passedStepCount).toBe(2);
  });

  it('toolchain warn 但 is_blocker=false 仍算通过 → 三步全就绪 + 元数据/osType 归一', async () => {
    apiGetMock.mockResolvedValue(
      makeReport({
        timestamp: 2000,
        overall_ready: true,
        probes: [
          makeProbe('python_runtime', 'pass'),
          makeProbe('system_config', 'pass'),
          makeProbe('toolchain', 'warn', {}, false), // is_blocker=false
          makeProbe('android_adb', 'pass', {
            installed: true,
            devices: [makeDevice()],
            installed_avds: ['Pixel_7'],
            emulator_path: '/opt/emulator',
            is_emulator_in_path: true,
          }),
          makeProbe('gemini_api_key', 'pass'),
          makeProbe('vision_ocr_key', 'warn'),
        ],
        active_device: makeDevice(),
      }),
    );
    const store = useSystemStore();
    await store.fetchReadiness(true);

    expect(store.isEnvironmentReady).toBe(true);
    expect(store.isCredentialsReady).toBe(true);
    expect(store.isDeviceReady).toBe(true);
    expect(store.passedStepCount).toBe(3);
    expect(store.isReady).toBe(true);
    expect(store.hasReadinessReport).toBe(true);
    // 设备 / AVD 元数据（取自 adbProbe.metadata）
    expect(store.connectedDevices).toHaveLength(1);
    expect(store.installedAvds).toEqual(['Pixel_7']);
    expect(store.emulatorPath).toBe('/opt/emulator');
    expect(store.isEmulatorInPath).toBe(true);
    expect(store.activeDevice?.serial).toBe('emu-5554');
    expect(store.osType).toBe('windows'); // win32 → windows 归一
  });

  it('llmProbe 双 id 兼容与 currentApiKey/apiKeysMap；ocrProbe 双 id 兼容', async () => {
    apiGetMock.mockResolvedValue(
      makeReport({
        timestamp: 1000,
        probes: [
          makeProbe('gemini_api_key', 'pass', {
            current_key: 'sk-abc',
            api_keys: { google: 'sk-abc', ocr: 'ocr-1' },
          }),
        ],
      }),
    );
    const store = useSystemStore();
    await store.fetchReadiness();

    expect(store.llmProbe?.id).toBe('gemini_api_key');
    expect(store.currentApiKey).toBe('sk-abc');
    expect(store.apiKeysMap).toEqual({ google: 'sk-abc', ocr: 'ocr-1' });

    // ocr 双 id：vision_ocr_key 或 ocr_api_key
    apiGetMock.mockResolvedValue(
      makeReport({ timestamp: 2000, probes: [makeProbe('ocr_api_key', 'fail')] }),
    );
    await store.fetchReadiness(true);
    expect(store.ocrProbe?.id).toBe('ocr_api_key');
    expect(store.currentApiKey).toBe(''); // 无 llm probe 时取 ''
    expect(store.apiKeysMap).toEqual({});
  });
});

describe('system store — 生命周期', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });
  afterEach(cleanupTimers);

  it('stop() 清空连通性 / readiness / emulator 全部定时器', async () => {
    vi.useFakeTimers();
    apiGetMock.mockResolvedValue(makeReport());
    apiPostMock.mockResolvedValue(makeEmulatorState({ status: 'starting' }));
    const store = useSystemStore();

    store.start(); // 连通性 5s + readiness 3s
    await vi.advanceTimersByTimeAsync(0);
    await store.launchEmulator('Pixel_7'); // emulator 1s 轮询
    expect(emulatorStatusCallCount()).toBe(0); // 尚未到 1s

    apiGetMock.mockClear();
    store.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(apiGetMock).not.toHaveBeenCalled();
  });
});
