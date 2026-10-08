import { mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';

import zhCN from '../locales/zh-CN';
import { useSessionStore } from '@/stores/session';
import LauncherView from './LauncherView.vue';

/**
 * 组件冒烟：LauncherView 在 Vue 工程内正常渲染——标题、diagnostics/launcher
 * 双 tab、任务输入、提交按钮与会话数摘要；切换到诊断 tab 渲染三步向导。
 * system store 按导出契约 mock（M5 数据层并行重写中）。
 */

const mockSystem = reactive({
  // M1 连接状态（AppNav 消费）
  online: true,
  lastCheckedAt: null,
  fetchStatus: vi.fn(() => Promise.resolve()),
  start: vi.fn(),
  stop: vi.fn(),
  // M5 契约（诊断向导消费）
  readinessReport: null,
  isLoading: false,
  isRestartingAdb: false,
  adbServerStatus: null,
  launchingAvd: null,
  emulatorLaunchState: null,
  lastCheckedTime: null,
  isSkipCredentialsCheck: false,
  modelConfigEnv: null,
  hasReadinessReport: false,
  isRemoteAdbServer: false,
  isEmulatorLaunching: false,
  probes: [],
  pythonProbe: null,
  configProbe: null,
  toolchainProbe: null,
  adbProbe: null,
  llmProbe: null,
  ocrProbe: null,
  isEnvironmentReady: false,
  isCredentialsReady: false,
  isDeviceReady: false,
  isReady: false,
  passedStepCount: 0,
  totalStepCount: 3,
  connectedDevices: [],
  installedAvds: [],
  emulatorPath: null,
  isEmulatorInPath: true,
  currentApiKey: '',
  apiKeysMap: {},
  activeDevice: null,
  osType: 'windows',
  startAutoPolling: vi.fn(),
  stopAutoPolling: vi.fn(),
  fetchReadiness: vi.fn(() => Promise.resolve({})),
  skipCredentialsCheck: vi.fn(),
  setSkipCredentialsCheck: vi.fn(),
  fetchEmulatorStatus: vi.fn(),
  startEmulatorStatusPolling: vi.fn(),
  stopEmulatorStatusPolling: vi.fn(),
  launchEmulator: vi.fn(() => Promise.resolve({})),
  stopEmulator: vi.fn(() => Promise.resolve({})),
  dismissEmulatorStatus: vi.fn(() => Promise.resolve({})),
  restartAdb: vi.fn(() => Promise.resolve({})),
  connectWirelessAdb: vi.fn(() => Promise.resolve({})),
  fetchAdbServerStatus: vi.fn(() => Promise.resolve({})),
  probeAdbServer: vi.fn(() => Promise.resolve({})),
  connectAdbServer: vi.fn(() => Promise.resolve({})),
  useLocalAdbServer: vi.fn(() => Promise.resolve({})),
  selectDevice: vi.fn(() => Promise.resolve({})),
  fetchModelConfigEnv: vi.fn(() => Promise.resolve({})),
  testApiKey: vi.fn(() => Promise.resolve({ valid: true, provider: 'google', message: 'ok' })),
  updateApiKey: vi.fn(() => Promise.resolve({ message: 'saved' })),
  saveModelConfig: vi.fn(() => Promise.resolve({ message: 'saved' })),
  credentialRows: [],
  fetchCredentialEntries: vi.fn(() => Promise.resolve({ rows: [] })),
  deleteEndpointRecord: vi.fn(() => Promise.resolve({ message: 'removed' })),
});

vi.mock('@/stores/system', () => ({
  useSystemStore: () => mockSystem,
}));

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
});

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/workspace', component: { template: '<div />' } },
  ],
});

function mountView() {
  return mount(LauncherView, {
    global: {
      plugins: [ArcoVue, i18n, createPinia(), router],
    },
  });
}

describe('LauncherView (M1)', () => {
  it('renders the title', () => {
    const wrapper = mountView();
    expect(wrapper.text()).toContain('ARTEMIS 控制台');
  });

  it('renders the diagnostics / launcher mode tabs', () => {
    const wrapper = mountView();
    expect(wrapper.text()).toContain('系统设置与前置条件');
    expect(wrapper.text()).toContain('自主执行');
  });

  it('renders a task textarea and a submit button', () => {
    const wrapper = mountView();
    expect(wrapper.find('textarea').exists()).toBe(true);
    expect(wrapper.text()).toContain('开始执行');
    expect(wrapper.find('.arco-btn').exists()).toBe(true);
  });

  it('renders the session summary statistics', () => {
    const wrapper = mountView();
    expect(wrapper.text()).toContain('全部会话');
    expect(wrapper.text()).toContain('进行中');
    expect(wrapper.text()).toContain('排队中');
    expect(wrapper.text()).toContain('已完成');
  });

  it('counts conversations (threads), not task rounds, in the summary', async () => {
    // 自建 pinia 以便在挂载前激活、挂载后拿到同一份 session store
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mount(LauncherView, {
      global: { plugins: [ArcoVue, i18n, pinia, router] },
    });
    // 3 个轮次、2 个线程：一个多轮线程（1 完成 + 1 运行）+ 一个单轮完成线程。
    const sessionStore = useSessionStore();
    sessionStore.$patch({
      rawSessions: [
        { session_id: 'r1', initial_goal: '多轮线程', start_time: 1, status: 'completed', conversation_id: 'conv-1' },
        { session_id: 'r2', initial_goal: '追问', start_time: 2, status: 'running', conversation_id: 'conv-1' },
        { session_id: 'r3', initial_goal: '单轮线程', start_time: 3, status: 'failed', conversation_id: 'conv-2' },
      ],
    });
    await wrapper.vm.$nextTick();

    const values = [...wrapper.element.querySelectorAll('.summary-row .arco-statistic')].map(
      (el) => el.textContent,
    );
    // 全部会话 = 线程数 2（不是轮次数 3）；多轮线程取最高优先级状态记为进行中；
    // 已完成 = 其余线程 1。（Arco 统计元素文本 = 标签 + 数值）
    expect(values).toEqual(['全部会话2', '进行中1', '排队中0', '已完成1']);
  });
});

describe('LauncherView (M5 诊断 tab)', () => {
  it('renders the diagnostics wizard after switching to the diagnostics tab', async () => {
    const wrapper = mountView();
    // 默认 launcher tab：不渲染向导
    expect(wrapper.text()).not.toContain('系统与环境');

    const diagTab = wrapper.findAll('.mode-tab-btn').find((b) => b.text().includes('系统设置与前置条件'));
    expect(diagTab).toBeTruthy();
    await diagTab!.trigger('click');

    // 三步向导渲染（顶部完成度 + STEP 1 标题）
    expect(wrapper.text()).toContain('系统就绪度');
    expect(wrapper.text()).toContain('系统与环境');
    expect(wrapper.text()).toContain('重新检测');
  });
});
