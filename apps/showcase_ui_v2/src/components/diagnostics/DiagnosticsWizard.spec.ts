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
import { type CredentialEndpointRow, type ModelConfigEnvResponse } from './contract';
import DiagnosticsWizard from './DiagnosticsWizard.vue';
import EndpointSwitcher from './EndpointSwitcher.vue';

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
    provider_label: 'lmstudio',
    model: 'gemini-flash',
    api_base: 'http://127.0.0.1:1234/v1',
    thinking_level: 'low',
    fallback: { provider: 'openai', model: 'gpt-4o' },
  },
  env_path: '.env',
  env_filename: '.env',
  env_vars: [
    { name: 'GEMINI_API_KEY', provider: 'google', is_set: true, preview: 'AIza***', description: 'Gemini key' },
    { name: 'OPENAI_API_KEY', provider: 'openai', is_set: false, preview: null, description: 'OpenAI key' },
  ],
};

/** 端点库里的一条已保存记录（当前生效的那条，表格与切换行共用）。 */
const SAVED_ROW: CredentialEndpointRow = {
  provider: 'deepseek',
  api_format: 'openai',
  api_base: 'http://127.0.0.1:1234/v1',
  model: 'qwen3.6-35b-a3b-mtp',
  api_key: '****udio',
  is_active: true,
  source: 'library',
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
  useEndpoint: vi.fn(() =>
    Promise.resolve({ status: 'success', message: 'Endpoint applied.' }),
  ),
  credentialRows: [] as CredentialEndpointRow[],
  fetchCredentialEntries: vi.fn(() => Promise.resolve({ rows: [] })),
  deleteEndpointRecord: vi.fn(() =>
    Promise.resolve({ status: 'success', message: 'Saved endpoint information removed from artemis.jsonc.' }),
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
  mockSystem.credentialRows = [];
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

  it('renders only the custom path without mode cards', async () => {
    mockSystem.modelConfigEnv = MOCK_ENV;
    mockSystem.credentialRows = [SAVED_ROW];
    const wrapper = mountWizard();
    await flushPromises();

    // 挂载即跳过凭据检查（无模式二选一）
    expect(mockSystem.setSkipCredentialsCheck).toHaveBeenCalledWith(true);
    expect(mockSystem.fetchModelConfigEnv).toHaveBeenCalled();

    // 模式选择卡已移除（API 格式下拉的选项标签可合法含 "Google Gemini"）
    expect(wrapper.findAll('.mode-card').length).toBe(0);
    expect(wrapper.find('.mode-cards').exists()).toBe(false);
    expect(wrapper.find('.cred-box').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('可用预设');

    // 端点表单、当前配置卡（内含端点切换行）与端点库表格都在
    expect(wrapper.find('.endpoint-card').exists()).toBe(true);
    expect(wrapper.find('.inspector-card .endpoint-switch').exists()).toBe(true);
    // 配置卡逐项显示 default 块里的真实值（端点名与端点地址都可见）
    const card = wrapper.find('.inspector-card').text();
    expect(card).toContain('lmstudio');
    expect(card).toContain('http://127.0.0.1:1234/v1');
    expect(card).toContain('gemini-flash');
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

    // 端点名 / 协议 / 端点地址 / 模型 / 回退 逐项来自 default 块，协议走文案映射
    const card = wrapper.find('.inspector-card').text();
    expect(card).toContain('lmstudio');
    expect(card).toContain('Google Gemini');
    expect(card).toContain('http://127.0.0.1:1234/v1');
    expect(card).toContain('openai/gpt-4o');
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

    // 提供商为文本框（回显 provider_label），API 格式为独立下拉栏（回显 provider）
    expect((wrapper.find('.endpoint-provider-input input').element as HTMLInputElement).value).toBe('lmstudio');
    expect(wrapper.find('.endpoint-format-select').exists()).toBe(true);
    expect((wrapper.find('.endpoint-base-input input').element as HTMLInputElement).value).toBe(
      'http://127.0.0.1:1234/v1',
    );
    expect((wrapper.find('.endpoint-model-input input').element as HTMLInputElement).value).toBe('gemini-flash');

    await wrapper.find('.endpoint-key-input input').setValue('sk-test-123');
    await wrapper.find('.endpoint-save-btn').trigger('click');
    await flushPromises();

    expect(mockSystem.saveModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'lmstudio',
        api_format: 'google',
        model: 'gemini-flash',
        api_base: 'http://127.0.0.1:1234/v1',
        api_key: 'sk-test-123',
      }),
    );
    expect(wrapper.text()).toContain('Model endpoint configuration saved and applied.');
  });

  it('renders saved endpoints as a table with form fields as columns', async () => {
    mockSystem.credentialRows = [SAVED_ROW];
    const wrapper = mountWizard();
    await flushPromises();

    // 一行一条端点记录，列名 = 表单字段，末列为操作
    expect(wrapper.find('.creds-table').exists()).toBe(true);
    const headers = wrapper.findAll('.creds-table th').map((h) => h.text());
    expect(headers).toEqual(['提供商', 'API 格式', 'API 端点地址', '模型名称', 'API Key（可选）', '操作']);
    const cells = wrapper
      .findAll('.creds-table tbody td')
      .map((c) => c.text().replace(/\s+/g, ' ').trim());
    expect(cells).toEqual([
      '当前 deepseek',
      'OpenAI Chat Completions',
      'http://127.0.0.1:1234/v1',
      'qwen3.6-35b-a3b-mtp',
      '****udio',
      '',
    ]);

    // 纯展示之外的操作列：编辑回填上方表单，删除经确认后调用删除接口
    expect(wrapper.find('.creds-edit-btn').exists()).toBe(true);
    expect(wrapper.find('.creds-delete-btn').exists()).toBe(true);
  });

  it('fills the endpoint form when clicking edit on a saved row', async () => {
    mockSystem.credentialRows = [SAVED_ROW];
    const wrapper = mountWizard();
    await flushPromises();

    await wrapper.find('.creds-edit-btn').trigger('click');
    await flushPromises();

    // 行值回填到上方表单（掩码 Key 不回填，留空沿用现值）
    expect((wrapper.find('.endpoint-provider-input input').element as HTMLInputElement).value).toBe('deepseek');
    expect(
      (wrapper.find('.endpoint-format-select .arco-select-view-value')?.element as HTMLElement)?.textContent?.trim(),
    ).toBe('OpenAI Chat Completions');
    expect((wrapper.find('.endpoint-base-input input').element as HTMLInputElement).value).toBe(
      'http://127.0.0.1:1234/v1',
    );
    expect((wrapper.find('.endpoint-model-input input').element as HTMLInputElement).value).toBe('qwen3.6-35b-a3b-mtp');
    expect((wrapper.find('.endpoint-key-input input').element as HTMLInputElement).value).toBe('');
  });

  it('deletes the row it was clicked on so the store can pick the route', async () => {
    mockSystem.credentialRows = [SAVED_ROW];
    const wrapper = mountWizard();
    await flushPromises();

    await wrapper.find('.creds-delete-btn').trigger('click');
    await flushPromises();

    // Popconfirm 弹层挂在 body 上，从 document 里找确认按钮
    const okButton = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === '确定',
    );
    expect(okButton).toBeTruthy();
    okButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushPromises();

    // 库记录与 default 行的删除语义不同，store 需要拿到这一行才能分流
    expect(mockSystem.deleteEndpointRecord).toHaveBeenCalledWith(SAVED_ROW);
  });

  it('lists the endpoint library inside the config card and switches to the chosen record', async () => {
    mockSystem.modelConfigEnv = MOCK_ENV;
    mockSystem.credentialRows = [
      SAVED_ROW,
      {
        provider: 'my-gateway',
        api_format: 'openai',
        api_base: null,
        model: 'gateway-1',
        api_key: '****9876',
        is_active: false,
        source: 'library',
      },
    ];
    const wrapper = mountWizard();
    await flushPromises();

    // 切换行在「当前模型配置」卡内部，不再自立一张卡
    const switcher = wrapper.findComponent(EndpointSwitcher);
    expect(wrapper.find('.inspector-card .endpoint-switch').exists()).toBe(true);
    const select = switcher.findComponent({ name: 'Select' });
    expect((select.props('options') as { label: string }[]).map((o) => o.label)).toEqual([
      'deepseek · 当前 · openai/qwen3.6-35b-a3b-mtp · http://127.0.0.1:1234/v1',
      'my-gateway · openai/gateway-1 · 提供商官方端点',
    ]);

    select.vm.$emit('update:modelValue', 'my-gateway');
    await flushPromises();
    await switcher.find('.switch-apply-btn').trigger('click');
    await flushPromises();

    expect(mockSystem.useEndpoint).toHaveBeenCalledWith('my-gateway');
    expect(switcher.text()).toContain('Endpoint applied.');
  });

  it('offers only saved library records and never re-applies the active one', async () => {
    const implicit: CredentialEndpointRow = {
      ...SAVED_ROW,
      provider: 'in-use-but-unsaved',
      source: 'default',
    };
    const other: CredentialEndpointRow = { ...SAVED_ROW, provider: 'other', is_active: false };
    mockSystem.modelConfigEnv = MOCK_ENV;
    mockSystem.credentialRows = [implicit, other, SAVED_ROW];
    const wrapper = mountWizard();
    await flushPromises();

    const select = wrapper.findComponent(EndpointSwitcher).findComponent({ name: 'Select' });
    const labels = (select.props('options') as { label: string }[]).map((o) => o.label);
    expect(labels).toEqual([
      'other · openai/qwen3.6-35b-a3b-mtp · http://127.0.0.1:1234/v1',
      'deepseek · 当前 · openai/qwen3.6-35b-a3b-mtp · http://127.0.0.1:1234/v1',
    ]);

    const applyBtn = wrapper
      .findComponent(EndpointSwitcher)
      .find('.switch-apply-btn')
      .element as HTMLButtonElement;

    // 当前那条不许再点一次：记录里没有 fallback 时，重复应用会把现存 fallback 清掉
    select.vm.$emit('update:modelValue', 'deepseek');
    await flushPromises();
    expect(applyBtn.disabled).toBe(true);

    select.vm.$emit('update:modelValue', 'other');
    await flushPromises();
    expect(applyBtn.disabled).toBe(false);
  });

  it('drops a selection whose record left the library', async () => {
    const other: CredentialEndpointRow = { ...SAVED_ROW, provider: 'other', is_active: false };
    mockSystem.modelConfigEnv = MOCK_ENV;
    mockSystem.credentialRows = [SAVED_ROW, other];
    const wrapper = mountWizard();
    await flushPromises();

    const switcher = wrapper.findComponent(EndpointSwitcher);
    switcher.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', 'other');
    await flushPromises();
    expect((switcher.find('.switch-apply-btn').element as HTMLButtonElement).disabled).toBe(false);

    // 选中的那条被删了、库里还剩别的：选择必须清空，按钮不许继续对着不存在的端点
    mockSystem.credentialRows = [SAVED_ROW];
    await flushPromises();

    expect((switcher.find('.switch-apply-btn').element as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks the config as 未配置 instead of inventing an endpoint when there is none', async () => {
    mockSystem.modelConfigEnv = { ...MOCK_ENV, default_model: {} };
    mockSystem.credentialRows = [];
    const wrapper = mountWizard();
    await flushPromises();

    const card = wrapper.find('.inspector-card').text();
    expect(card).toContain('未配置');
    // 旧实现把 google / gemini-3.8-flash 当兜底常量写死在模板里，配置文件为空时会显示假配置
    expect(card).not.toContain('gemini-3.8-flash');
    expect(card).not.toContain('Google Gemini');
    // 端点库为空时不出现切换行
    expect(wrapper.find('.endpoint-switch').exists()).toBe(false);
  });
});
