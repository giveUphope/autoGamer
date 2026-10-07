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

    expect(mockSession.runTask).toHaveBeenCalledWith('打开时钟', 'pro');
    expect(mockSession.fetchStatus).toHaveBeenCalled();
    expect((wrapper.find('.dock-input textarea').element as HTMLTextAreaElement).value).toBe('');
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
