import { flushPromises, mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia } from 'pinia';
import { reactive } from 'vue';
import { createI18n } from 'vue-i18n';

import zhCN from '../locales/zh-CN';
import type { CredentialEndpointRow, ModelConfigEnvResponse } from '@/types/system.model';
import CommandDock from './CommandDock.vue';

/**
 * 组件测试：CommandDock（工作台常驻命令条）。
 * 覆盖：多行输入常驻（上方输入区 + 下方按钮行）、Ctrl+K 聚焦、Enter 提交带
 * profile、Shift+Enter 与输入法组词中的 Enter 不提交、以及命令条里的模型
 * 选择器与全局共用同一份 system store 状态。
 */

const mockSession = reactive({
  runTask: vi.fn(() => Promise.resolve({})),
  fetchStatus: vi.fn(() => Promise.resolve({})),
  stopTask: vi.fn(() => Promise.resolve()),
  removeQueuedRound: vi.fn(() => Promise.resolve()),
  pauseQueue: vi.fn(() => Promise.resolve()),
  resumeQueue: vi.fn(() => Promise.resolve()),
  submitConversationId: null as string | null,
  currentConversationRunningTaskId: null as string | null,
  threadPendingRounds: [] as Array<{ session_id: string; initial_goal: string }>,
  queueManuallyPaused: false,
  queueHolds: [] as Array<{ device_serial?: string; reason?: string; failure_class?: string; session_id?: string }>,
});

const mockSystem = reactive({
  credentialRows: [] as CredentialEndpointRow[],
  modelConfigEnv: null as ModelConfigEnvResponse | null,
  fetchModelConfigEnv: vi.fn(() => Promise.resolve(null)),
  fetchCredentialEntries: vi.fn(() => Promise.resolve({ rows: [] })),
  useEndpoint: vi.fn(() => Promise.resolve({ status: 'success' })),
});

vi.mock('@/stores/session', () => ({ useSessionStore: () => mockSession }));
vi.mock('@/stores/system', () => ({ useSystemStore: () => mockSystem }));

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } });

function mountDock(attachTo?: HTMLElement) {
  return mount(CommandDock, { global: { plugins: [ArcoVue, i18n, createPinia()] }, attachTo });
}

describe('CommandDock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.submitConversationId = null;
    mockSession.currentConversationRunningTaskId = null;
    mockSession.threadPendingRounds = [];
    mockSession.queueManuallyPaused = false;
    mockSession.queueHolds = [];
    mockSystem.credentialRows = [];
    mockSystem.modelConfigEnv = null;
    localStorage.removeItem('artemis_selected_profile');
  });

  it('renders a multi-line input with the buttons laid out below', async () => {
    const wrapper = mountDock();
    await flushPromises();

    expect(wrapper.find('.dock-capsule').exists()).toBe(false);
    // 多行输入框独占主体；模型选择器与 profile、提交按钮组合在下方控件行
    expect(wrapper.find('.dock-main-row .dock-input textarea').exists()).toBe(true);
    expect(wrapper.find('.dock-main-row .dock-model-select').exists()).toBe(false);
    const bottomRow = wrapper.find('.dock-bottom-row');
    expect(bottomRow.exists()).toBe(true);
    expect(bottomRow.find('.dock-profile-group').exists()).toBe(true);
    expect(bottomRow.find('.dock-model-select').exists()).toBe(true);
    expect(bottomRow.find('button[type="button"].arco-btn-primary').exists()).toBe(true);
    // 选择器自己保证有数据可读，不依赖诊断向导先挂载
    expect(mockSystem.fetchModelConfigEnv).toHaveBeenCalled();
    expect(mockSystem.fetchCredentialEntries).toHaveBeenCalled();
  });

  it('focuses the textarea on Ctrl+K', async () => {
    // 聚焦要求元素在文档里，jsdom 不会给游离节点设 activeElement
    const host = document.createElement('div');
    document.body.appendChild(host);
    const wrapper = mountDock(host);
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.find('.dock-input textarea').element);
    wrapper.unmount();
    host.remove();
  });

  it('submits the typed goal with the persisted profile on Enter', async () => {
    localStorage.setItem('artemis_selected_profile', 'pro');
    const wrapper = mountDock();
    await flushPromises();

    const textarea = wrapper.find('.dock-input textarea');
    await textarea.setValue('打开时钟');
    await textarea.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(mockSession.runTask).toHaveBeenCalledWith('打开时钟', 'pro', {
      conversationId: undefined,
    });
    expect(mockSession.fetchStatus).toHaveBeenCalled();
    expect((wrapper.find('.dock-input textarea').element as HTMLTextAreaElement).value).toBe('');
  });

  it('continues the current conversation thread when one is active', async () => {
    mockSession.submitConversationId = 'conv-abc';
    const wrapper = mountDock();
    await flushPromises();

    const textarea = wrapper.find('.dock-input textarea');
    await textarea.setValue('再看看电量');
    await textarea.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(mockSession.runTask).toHaveBeenCalledWith('再看看电量', 'flash', {
      conversationId: 'conv-abc',
    });
  });

  it('turns the submit button into stop while the thread has a live task', async () => {
    mockSession.currentConversationRunningTaskId = 'live-sid';
    const wrapper = mountDock();
    await flushPromises();

    const submitBtn = wrapper.find('.dock-bottom-row button.arco-btn-primary');
    expect(submitBtn.text()).toContain('停止');
    expect(submitBtn.classes()).toContain('arco-btn-status-danger');

    // 点击按钮 = 停掉线程内运行中的轮次（而非提交）
    await submitBtn.trigger('click');
    await flushPromises();
    expect(mockSession.stopTask).toHaveBeenCalledWith('live-sid', false);
    expect(mockSession.runTask).not.toHaveBeenCalled();
  });

  it('shows the submit button when the current thread has no live task', async () => {
    const wrapper = mountDock();
    await flushPromises();

    const submitBtn = wrapper.find('.dock-bottom-row button.arco-btn-primary');
    expect(submitBtn.text()).toContain('提交');
    expect(submitBtn.classes()).not.toContain('arco-btn-status-danger');
  });

  it('keeps Shift+Enter and IME-composing Enter from submitting', async () => {
    const wrapper = mountDock();
    await flushPromises();

    const textarea = wrapper.find('.dock-input textarea');
    await textarea.setValue('第一行');
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true });
    await textarea.trigger('keydown', { key: 'Enter', isComposing: true });
    await flushPromises();

    expect(mockSession.runTask).not.toHaveBeenCalled();
    expect((textarea.element as HTMLTextAreaElement).value).toBe('第一行');
  });
});

describe('CommandDock — 队列状态条（排队 chips / 暂停 / 继续）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.submitConversationId = null;
    mockSession.currentConversationRunningTaskId = null;
    mockSession.threadPendingRounds = [];
    mockSession.queueManuallyPaused = false;
    mockSession.queueHolds = [];
  });

  it('排队消息以列表呈现且可单独移除', async () => {
    mockSession.submitConversationId = 'conv-1';
    mockSession.threadPendingRounds = [
      { session_id: 'q1', initial_goal: '排队消息一' },
      { session_id: 'q2', initial_goal: '排队消息二' },
    ];
    const wrapper = mountDock();
    await flushPromises();

    const chips = wrapper.findAll('.queue-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].text()).toContain('排队消息一');
    await chips[0].find('.queue-chip-remove').trigger('click');
    expect(mockSession.removeQueuedRound).toHaveBeenCalledWith('q1');
  });

  it('排队消息按提交顺序纵向排列：最新提交的在列表末尾', async () => {
    mockSession.submitConversationId = 'conv-1';
    mockSession.threadPendingRounds = [
      { session_id: 'q1', initial_goal: '最早提交' },
      { session_id: 'q2', initial_goal: '随后提交' },
      { session_id: 'q3', initial_goal: '最新提交' },
    ];
    const wrapper = mountDock();
    await flushPromises();

    const chips = wrapper.findAll('.dock-queue-strip .queue-chip');
    expect(chips.length).toBe(3);
    // FIFO 顺序：先提交的在上方，最新发射的追加在列表末尾
    expect(chips[0].text()).toContain('最早提交');
    expect(chips[1].text()).toContain('随后提交');
    expect(chips[2].text()).toContain('最新提交');
    await chips[2].find('.queue-chip-remove').trigger('click');
    expect(mockSession.removeQueuedRound).toHaveBeenCalledWith('q3');
  });

  it('手动暂停显示暂停态与继续按钮；环境挂起显示挂起原因（悬浮可见）', async () => {
    mockSession.submitConversationId = 'conv-1';
    mockSession.queueManuallyPaused = true;
    let wrapper = mountDock();
    await flushPromises();
    expect(wrapper.find('.queue-state.is-paused').exists()).toBe(true);
    await wrapper.find('.queue-action').trigger('click');
    expect(mockSession.resumeQueue).toHaveBeenCalled();
    wrapper.unmount();

    mockSession.queueManuallyPaused = false;
    mockSession.queueHolds = [
      { device_serial: 'auto', reason: 'Device is not available', failure_class: 'environment', session_id: 'x' },
    ];
    wrapper = mountDock();
    await flushPromises();
    const held = wrapper.find('.queue-state.is-held');
    expect(held.exists()).toBe(true);
    expect(held.attributes('title')).toContain('Device is not available');
    await wrapper.find('.queue-action').trigger('click');
    expect(mockSession.resumeQueue).toHaveBeenCalled();
  });

  it('有任务运行时提供「暂停队列」入口（不影响运行中的任务）', async () => {
    mockSession.currentConversationRunningTaskId = 'run-1';
    const wrapper = mountDock();
    await flushPromises();

    const pauseButton = wrapper.find('.queue-action');
    expect(pauseButton.exists()).toBe(true);
    await pauseButton.trigger('click');
    expect(mockSession.pauseQueue).toHaveBeenCalled();
  });
});
