import { mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia } from 'pinia';
import { reactive } from 'vue';
import { createI18n } from 'vue-i18n';

import zhCN from '../../locales/zh-CN';
import type {
  DeviceInfo,
  EmulatorLaunchState,
  ProbeResult,
  SystemReadinessReport,
} from '../../types/system.model';
import { type CredentialEntry, type ModelConfigEnvResponse } from './contract';
import DiagnosticsWizard from './DiagnosticsWizard.vue';

/**
 * 组件测试：DiagnosticsWizard（M5 诊断向导）。
 * system store 正由数据层并行重写——这里按导出契约 mock（reactive 状态 + vi.fn
 * actions），覆盖：三步完成度渲染、就绪/未就绪分支、一键安装条、emulator 启动
 * 进度与停止、失败卡重试（远程 ADB 禁用）、Wi-Fi 表单提交、凭据测试/保存、
 * 跳过凭据、多设备切换 selectDevice、自定义模式（JSONC / env 表格）。
 */

const DEVICE_A: DeviceInfo = {
  serial: 'emu-5554',
  state: 'device',
  model: 'Pixel_8_API_34',
  product: 'sdk_gphone64',
  android_version: '14',
  screen_resolution: '1080x2400',
  is_locked: false,
  is_emulator: true,
};
const DEVICE_B: DeviceInfo = { ...DEVICE_A, serial: 'usb-x1', model: 'MI 13', is_emulator: false };

function makeProbe(overrides: Partial<ProbeResult>): ProbeResult {
  return {
    id: 'python_runtime',
    category: 'runtime',
    title: 'Python Runtime',
    status: 'pass',
    is_blocker: true,
    summary: 'Python 3.12',
    description: '',
    metadata: {},
    actions: [],
    ...overrides,
  };
}

function makeLaunchState(overrides: Partial<EmulatorLaunchState>): EmulatorLaunchState {
  return {
    avd_name: 'Pixel_8_API_34',
    status: 'booting',
    pid: 4321,
    serial: 'emu-5554',
    stage_message: 'Waiting for device to boot',
    progress_percent: 40,
    started_at: 0,
    elapsed_seconds: 12,
    error: null,
    logs: ['emulator: booting…'],
    can_retry: true,
    ...overrides,
  };
}

const MOCK_ENV: ModelConfigEnvResponse = {
  config_path: 'config/artemis.jsonc',
  config_filename: 'artemis.jsonc',
  config_content: '{\n  "default_model": { "provider": "google", "model": "gemini-flash" }\n}',
  default_model: {
    provider: 'google',
    model: 'gemini-flash',
    api_base: 'http://127.0.0.1:1234/v1',
    thinking_level: 'low',
    fallback: { provider: 'openai', model: 'gpt-4o' },
  },
  presets: { fast: { provider: 'google', model: 'gemini-flash' } },
  env_path: '.env',
  env_filename: '.env',
  env_vars: [
    { name: 'GEMINI_API_KEY', provider: 'google', is_set: true, preview: 'AIza***', description: 'Gemini key' },
    { name: 'OPENAI_API_KEY', provider: 'openai', is_set: false, preview: null, description: 'OpenAI key' },
  ],
};

const CONNECTION_OK = {
  connection_result: {
    success: true,
    message: 'connected',
    endpoint: { host: '127.0.0.1', port: 5038, socket: '', identity: '', mode: 'remote' as const, is_local_default: false },
    devices: [],
  },
};

// 契约 mock：字段名与 useSystemStore() 实例（解包后）逐一对齐。
const mockSystem = reactive({
  readinessReport: null as SystemReadinessReport | null,
  isLoading: false,
  isRestartingAdb: false,
  adbServerStatus: null as never,
  launchingAvd: null as string | null,
  emulatorLaunchState: null as EmulatorLaunchState | null,
  lastCheckedTime: null as Date | null,
  isSkipCredentialsCheck: false,
  modelConfigEnv: null as ModelConfigEnvResponse | null,
  hasReadinessReport: false,
  isRemoteAdbServer: false,
  isEmulatorLaunching: false,
  probes: [] as ProbeResult[],
  pythonProbe: null as ProbeResult | null,
  configProbe: null as ProbeResult | null,
  toolchainProbe: null as ProbeResult | null,
  adbProbe: null as ProbeResult | null,
  llmProbe: null as ProbeResult | null,
  ocrProbe: null as ProbeResult | null,
  isEnvironmentReady: false,
  isCredentialsReady: false,
  isDeviceReady: false,
  isReady: false,
  passedStepCount: 0,
  totalStepCount: 3,
  connectedDevices: [] as DeviceInfo[],
  installedAvds: [] as string[],
  emulatorPath: null as string | null,
  isEmulatorInPath: true,
  currentApiKey: '',
  apiKeysMap: {} as Record<string, string>,
  activeDevice: null as DeviceInfo | null,
  osType: 'windows' as 'linux' | 'darwin' | 'windows',

  startAutoPolling: vi.fn(),
  stopAutoPolling: vi.fn(),
  fetchReadiness: vi.fn((): Promise<SystemReadinessReport> => Promise.resolve({} as SystemReadinessReport)),
  skipCredentialsCheck: vi.fn(),
  setSkipCredentialsCheck: vi.fn(),
  fetchEmulatorStatus: vi.fn(),
  startEmulatorStatusPolling: vi.fn(),
  stopEmulatorStatusPolling: vi.fn(),
  launchEmulator: vi.fn((): Promise<EmulatorLaunchState> => Promise.resolve({} as EmulatorLaunchState)),
  stopEmulator: vi.fn(() => Promise.resolve({})),
  dismissEmulatorStatus: vi.fn(() => Promise.resolve({})),
  restartAdb: vi.fn(() => Promise.resolve({})),
  connectWirelessAdb: vi.fn(() =>
    Promise.resolve({ connect_result: { success: true, message: 'connected' } }),
  ),
  fetchAdbServerStatus: vi.fn(() => Promise.resolve({})),
  probeAdbServer: vi.fn(() => Promise.resolve(CONNECTION_OK)),
  connectAdbServer: vi.fn(() => Promise.resolve(CONNECTION_OK)),
  useLocalAdbServer: vi.fn(() => Promise.resolve(CONNECTION_OK)),
  selectDevice: vi.fn(() => Promise.resolve({})),
  fetchModelConfigEnv: vi.fn(() => Promise.resolve(MOCK_ENV)),
  testApiKey: vi.fn(() => Promise.resolve({ valid: true, provider: 'google', message: 'The API key is valid!' })),
  updateApiKey: vi.fn(() => Promise.resolve({ message: 'API key saved.' })),
  saveModelConfig: vi.fn(() =>
    Promise.resolve({ status: 'success', message: 'Model endpoint configuration saved and applied.' }),
  ),
  credentialEntries: [] as CredentialEntry[],
  fetchCredentialEntries: vi.fn(() => Promise.resolve({ entries: [], bindings_path: 'credential_bindings.json' })),
  saveCredentialEntry: vi.fn(() =>
    Promise.resolve({ status: 'success', message: "Credential 'MY_KEY' saved." }),
  ),
  deleteCredentialEntry: vi.fn(() =>
    Promise.resolve({ status: 'success', message: "Credential 'MY_KEY' removed." }),
  ),
});

vi.mock('@/stores/system', () => ({
  useSystemStore: () => mockSystem,
}));

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
});

function mountWizard() {
  return mount(DiagnosticsWizard, {
    global: {
      plugins: [ArcoVue, i18n, createPinia()],
    },
  });
}

/** 重置数据字段（保留 vi.fn 实现），每个用例独立。 */
function resetSystemMock(): void {
  mockSystem.readinessReport = null;
  mockSystem.isLoading = false;
  mockSystem.isRestartingAdb = false;
  mockSystem.adbServerStatus = null as never;
  mockSystem.launchingAvd = null;
  mockSystem.emulatorLaunchState = null;
  mockSystem.lastCheckedTime = null;
  mockSystem.isSkipCredentialsCheck = false;
  mockSystem.modelConfigEnv = null;
  mockSystem.hasReadinessReport = false;
  mockSystem.isRemoteAdbServer = false;
  mockSystem.isEmulatorLaunching = false;
  mockSystem.probes = [];
  mockSystem.pythonProbe = null;
  mockSystem.configProbe = null;
  mockSystem.toolchainProbe = null;
  mockSystem.adbProbe = null;
  mockSystem.llmProbe = null;
  mockSystem.ocrProbe = null;
  mockSystem.isEnvironmentReady = false;
  mockSystem.isCredentialsReady = false;
  mockSystem.isDeviceReady = false;
  mockSystem.isReady = false;
  mockSystem.passedStepCount = 0;
  mockSystem.totalStepCount = 3;
  mockSystem.connectedDevices = [];
  mockSystem.installedAvds = [];
  mockSystem.emulatorPath = null;
  mockSystem.isEmulatorInPath = true;
  mockSystem.currentApiKey = '';
  mockSystem.apiKeysMap = {};
  mockSystem.activeDevice = null;
  mockSystem.osType = 'windows';
}

function setEnvironmentReady(): void {
  const py = makeProbe({ id: 'python_runtime', status: 'pass', summary: 'Python 3.12.7' });
  const adb = makeProbe({
    id: 'android_adb',
    title: 'Android Platform-Tools',
    status: 'pass',
    summary: 'ADB Installed',
    metadata: { installed: true },
  });
  const cfg = makeProbe({ id: 'system_config', title: 'System Config', status: 'pass', summary: 'Config valid' });
  const tc = makeProbe({ id: 'toolchain', title: 'Video Toolchain', status: 'pass', summary: 'ffmpeg + scrcpy' });
  mockSystem.probes = [py, adb, cfg, tc];
  mockSystem.pythonProbe = py;
  mockSystem.adbProbe = adb;
  mockSystem.configProbe = cfg;
  mockSystem.toolchainProbe = tc;
  mockSystem.isEnvironmentReady = true;
  mockSystem.hasReadinessReport = true;
  mockSystem.passedStepCount = 1;
}

function setCredentialsReady(): void {
  const llm = makeProbe({ id: 'gemini_api_key', category: 'auth', title: 'LLM API Key', status: 'pass', summary: 'Gemini key set' });
  mockSystem.llmProbe = llm;
  mockSystem.isCredentialsReady = true;
  mockSystem.passedStepCount = 2;
}

function setDeviceReady(multiple = false): void {
  const adb = makeProbe({
    id: 'android_adb',
    title: 'Android Platform-Tools',
    status: 'pass',
    summary: '1 device',
    metadata: { installed: true },
  });
  mockSystem.adbProbe = adb;
  mockSystem.isDeviceReady = true;
  mockSystem.isReady = true;
  mockSystem.activeDevice = DEVICE_A;
  mockSystem.connectedDevices = multiple ? [DEVICE_A, DEVICE_B] : [DEVICE_A];
  mockSystem.readinessReport = {
    overall_ready: true,
    blocker_count: 3,
    passed_blocker_count: 3,
    probes: [],
    active_device: DEVICE_A,
    os_type: 'windows',
    timestamp: 0,
  };
  mockSystem.passedStepCount = 3;
}

/** 无设备且无特殊警告 → 连接引导自动展开（对齐 Angular State B-3 条件）。 */
function setNoDevice(): void {
  const adb = makeProbe({
    id: 'android_adb',
    title: 'Android Platform-Tools',
    status: 'warn',
    summary: 'No device detected',
    metadata: { installed: true },
  });
  mockSystem.adbProbe = adb;
  mockSystem.hasReadinessReport = true;
}

describe('DiagnosticsWizard (M5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSystemMock();
  });

  it('renders step progress and the three step titles while not ready', () => {
    const wrapper = mountWizard();
    expect(wrapper.text()).toContain('系统就绪度');
    expect(wrapper.text()).toContain('0/3 步已就绪');
    expect(wrapper.text()).toContain('系统与环境');
    expect(wrapper.text()).toContain('AI 模型配置');
    expect(wrapper.text()).toContain('Android 设备与模拟器连接');
    // 就绪横幅不出现
    expect(wrapper.text()).not.toContain('系统已就绪，可以执行自主任务');
  });

  it('aggregates command actions into the one-click install bar when env is not ready', () => {
    mockSystem.hasReadinessReport = true;
    const py = makeProbe({
      id: 'python_runtime',
      status: 'fail',
      summary: 'Python missing',
      actions: [{ action_type: 'command', label: 'Install Python', payload: 'uv python install 3.12' }],
    });
    mockSystem.probes = [py];
    mockSystem.pythonProbe = py;

    const wrapper = mountWizard();
    expect(wrapper.text()).toContain('自动依赖安装');
    expect(wrapper.text()).toContain('uv python install 3.12');
  });

  it('renders the ready banner and emits proceed when all steps pass', async () => {
    setEnvironmentReady();
    setCredentialsReady();
    setDeviceReady();
    mockSystem.isReady = true;

    const wrapper = mountWizard();
    expect(wrapper.text()).toContain('系统已就绪，可以执行自主任务');
    await wrapper.find('.ready-launch-btn').trigger('click');
    expect(wrapper.emitted('proceed')).toBeTruthy();
  });

  it('re-checks with force refresh from the top bar', async () => {
    const wrapper = mountWizard();
    await wrapper.find('.diag-recheck-btn').trigger('click');
    expect(mockSystem.fetchReadiness).toHaveBeenCalledWith(false, true);
  });

  it('toggles skip-credentials via the checkbox', async () => {
    const wrapper = mountWizard();
    await wrapper.find('.skip-cred-check input[type="checkbox"]').setValue(true);
    expect(mockSystem.setSkipCredentialsCheck).toHaveBeenCalledWith(true);
  });

  it('tracks emulator boot progress and stops the emulator', async () => {
    mockSystem.isEmulatorLaunching = true;
    mockSystem.emulatorLaunchState = makeLaunchState({ status: 'booting', progress_percent: 40 });

    const wrapper = mountWizard();
    // 启动态进入时驱动状态轮询
    expect(mockSystem.startEmulatorStatusPolling).toHaveBeenCalled();
    expect(wrapper.text()).toContain('正在启动 Android 模拟器');
    expect(wrapper.text()).toContain('40% 完成');
    expect(wrapper.text()).toContain('已用时 12s');

    // 日志折叠流
    expect(wrapper.text()).not.toContain('emulator: booting…');
    await wrapper.find('.logs-toggle-btn').trigger('click');
    expect(wrapper.text()).toContain('emulator: booting…');

    await wrapper.find('.emu-stop-btn').trigger('click');
    expect(mockSystem.stopEmulator).toHaveBeenCalledTimes(1);
  });

  it('retries a failed launch locally and disables retry while remote ADB is active', async () => {
    mockSystem.emulatorLaunchState = makeLaunchState({ status: 'failed', error: 'avd crashed' });
    setNoDevice();

    // 本地模式：可重试
    const local = mountWizard();
    const retryBtn = local.find('.emu-retry-btn');
    expect(retryBtn.exists()).toBe(true);
    expect(retryBtn.attributes('disabled')).toBeUndefined();
    await retryBtn.trigger('click');
    expect(mockSystem.launchEmulator).toHaveBeenCalledWith('Pixel_8_API_34');
    local.unmount();

    // 远程 ADB：重试禁用
    mockSystem.isRemoteAdbServer = true;
    mockSystem.launchEmulator.mockClear();
    mockSystem.adbServerStatus = {
      endpoint: { host: '192.168.1.9', port: 5038, socket: '', identity: 'remote-1', mode: 'remote', is_local_default: false },
    } as never;
    const remote = mountWizard();
    const remoteRetry = remote.find('.emu-retry-btn');
    expect(remoteRetry.exists()).toBe(true);
    expect(remoteRetry.attributes('disabled')).toBeDefined();
    await remoteRetry.trigger('click');
    expect(mockSystem.launchEmulator).not.toHaveBeenCalled();

    // 关闭失败卡
    await remote.find('.failed-dismiss-btn').trigger('click');
    expect(mockSystem.dismissEmulatorStatus).toHaveBeenCalledTimes(1);
  });

  it('submits the wireless ADB form', async () => {
    setNoDevice();
    const wrapper = mountWizard();

    // 切到"无线 ADB"方法卡
    const wifiCard = wrapper.findAll('.method-card').find((c) => c.text().includes('无线 ADB'));
    expect(wifiCard).toBeTruthy();
    await wifiCard!.trigger('click');

    await wrapper.find('.wifi-host-input input').setValue('192.168.1.50');
    await wrapper.find('.wifi-connect-btn').trigger('click');
    await flushPromises();

    expect(mockSystem.connectWirelessAdb).toHaveBeenCalledWith('192.168.1.50', 5555);
    expect(wrapper.text()).toContain('已连接到 192.168.1.50:5555！');
  });

  it('renders only the custom path without mode cards or presets', async () => {
    mockSystem.modelConfigEnv = MOCK_ENV;
    const wrapper = mountWizard();
    await flushPromises();

    // 挂载即跳过凭据检查（无模式二选一）
    expect(mockSystem.setSkipCredentialsCheck).toHaveBeenCalledWith(true);
    expect(mockSystem.fetchModelConfigEnv).toHaveBeenCalled();

    // 模式选择卡与预设列表均已移除
    expect(wrapper.findAll('.mode-card').length).toBe(0);
    expect(wrapper.text()).not.toContain('可用预设');
    expect(wrapper.text()).not.toContain('Google Gemini');

    // 端点表单与只读配置卡仍在
    expect(wrapper.find('.endpoint-card').exists()).toBe(true);
    expect(wrapper.text()).toContain('google / gemini-flash');
  });

  it('switches active device through the select', async () => {
    setEnvironmentReady();
    setCredentialsReady();
    setDeviceReady(true);

    const wrapper = mountWizard();
    // 自定义模式默认展示的端点表单里也有 Select，需在设备步骤内定位设备选择器
    const deviceStep = wrapper.findComponent({ name: 'DeviceStep' });
    expect(deviceStep.exists()).toBe(true);
    const select = deviceStep.findComponent({ name: 'Select' });
    expect(select.exists()).toBe(true);
    select.vm.$emit('change', DEVICE_B.serial);
    await flushPromises();
    expect(mockSystem.selectDevice).toHaveBeenCalledWith(DEVICE_B.serial);
  });

  it('shows the jsonc viewer and hides the fixed env table in the default custom mode', async () => {
    mockSystem.modelConfigEnv = MOCK_ENV;
    const wrapper = mountWizard();

    // 默认即自定义模式：跳过凭据检查 + 拉取 model-config-env
    expect(mockSystem.setSkipCredentialsCheck).toHaveBeenCalledWith(true);
    expect(mockSystem.fetchModelConfigEnv).toHaveBeenCalled();

    // 默认模型摘要 + 回退 + JSONC 路径
    expect(wrapper.text()).toContain('google / gemini-flash');
    expect(wrapper.text()).toContain('openai/gpt-4o');
    expect(wrapper.text()).toContain('config/artemis.jsonc');

    // JSONC 查看器（a-collapse 展开）
    await wrapper.find('.jsonc-collapse .arco-collapse-item-header').trigger('click');
    expect(wrapper.text()).toContain('default_model');

    // 固定变量名的 .env 表格已被统一凭据管理取代
    expect(wrapper.find('.env-table').exists()).toBe(false);
  });

  it('fills and saves endpoint details in the default custom mode', async () => {
    mockSystem.modelConfigEnv = MOCK_ENV;
    const wrapper = mountWizard();
    await flushPromises();

    // 自定义为默认模式：端点表单直接可见，并用 modelConfigEnv 预填
    expect(wrapper.find('.endpoint-base-input').exists()).toBe(true);
    expect((wrapper.find('.endpoint-base-input input').element as HTMLInputElement).value).toBe(
      'http://127.0.0.1:1234/v1',
    );
    expect((wrapper.find('.endpoint-model-input input').element as HTMLInputElement).value).toBe('gemini-flash');

    await wrapper.find('.endpoint-key-input input').setValue('sk-test-123');
    await wrapper.find('.endpoint-save-btn').trigger('click');
    await flushPromises();

    expect(mockSystem.saveModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google',
        model: 'gemini-flash',
        api_base: 'http://127.0.0.1:1234/v1',
        api_key: 'sk-test-123',
      }),
    );
    expect(wrapper.text()).toContain('Model endpoint configuration saved and applied.');
  });

  it('manages user-defined credential entries in the unified list', async () => {
    mockSystem.credentialEntries = [
      { name: 'MY_LLM_KEY', provider: 'openai', is_set: true, preview: '****1234' },
    ];
    const wrapper = mountWizard();
    await flushPromises();

    // 已配置项回显：变量名 / 提供商 / 掩码预览
    expect(wrapper.find('.creds-list').exists()).toBe(true);
    expect(wrapper.text()).toContain('MY_LLM_KEY');
    expect(wrapper.text()).toContain('****1234');

    // 新增一条：变量名 + 提供商 + 值 完全由用户定义
    await wrapper.find('.creds-name-input input').setValue('SECOND_KEY');
    await wrapper.find('.creds-provider-input input').setValue('my-provider');
    await wrapper.find('.creds-value-input input').setValue('secret-2');
    await wrapper.find('.creds-add-btn').trigger('click');
    await flushPromises();

    expect(mockSystem.saveCredentialEntry).toHaveBeenCalledWith({
      name: 'SECOND_KEY',
      provider: 'my-provider',
      value: 'secret-2',
    });
    expect(wrapper.text()).toContain("Credential 'MY_KEY' saved.");
  });
});
