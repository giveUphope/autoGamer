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
 * 覆盖：输入框常驻（不再有折叠胶囊）、Ctrl+K 聚焦、回车提交带 profile、
 * 以及命令条里的模型选择器与全局共用同一份 system store 状态。
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

  it('renders a persistent input row instead of a collapsed capsule', async () => {
    const wrapper = mountDock();
    await flushPromises();

    expect(wrapper.find('.dock-capsule').exists()).toBe(false);
    expect(wrapper.find('.dock-input input').exists()).toBe(true);
    expect(wrapper.find('.dock-model-select').exists()).toBe(true);
    // 选择器自己保证有数据可读，不依赖诊断向导先挂载
    expect(mockSystem.fetchModelConfigEnv).toHaveBeenCalled();
    expect(mockSystem.fetchCredentialEntries).toHaveBeenCalled();
  });

  it('focuses the input on Ctrl+K', async () => {
    // 聚焦要求元素在文档里，jsdom 不会给游离节点设 activeElement
    const host = document.createElement('div');
    document.body.appendChild(host);
    const wrapper = mountDock(host);
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await flushPromises();

    expect(document.activeElement).toBe(wrapper.find('.dock-input input').element);
    wrapper.unmount();
    host.remove();
  });

  it('submits the typed goal with the persisted profile', async () => {
    localStorage.setItem('artemis_selected_profile', 'pro');
    const wrapper = mountDock();
    await flushPromises();

    const input = wrapper.find('.dock-input input');
    await input.setValue('打开时钟');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(mockSession.runTask).toHaveBeenCalledWith('打开时钟', 'pro');
    expect(mockSession.fetchStatus).toHaveBeenCalled();
    expect((wrapper.find('.dock-input input').element as HTMLInputElement).value).toBe('');
  });
});
