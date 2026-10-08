import { mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { createI18n } from 'vue-i18n';

import zhCN from '../locales/zh-CN';
import SessionListPanel from './SessionListPanel.vue';
import { useSessionStore } from '../stores/session';

/**
 * 组件测试：SessionListPanel 的「新建会话」接线。
 * 4fa5d29 之后，新建会话必须取消旧会话选中并进入草稿线程（store 层语义在
 * session.spec 已覆盖）；本 spec 锁定按钮到 store 的接线层。
 */

vi.mock('@/services/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }));

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
});

describe('SessionListPanel — 新建会话进入草稿线程', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    localStorage.clear();
    vi.clearAllMocks();
  });

  function mountPanel() {
    return mount(SessionListPanel, {
      global: { plugins: [ArcoVue, i18n, pinia] },
    });
  }

  it('点击新建会话：取消旧会话选中、进入草稿线程，提交目标指向新线程', async () => {
    const wrapper = mountPanel();
    const store = useSessionStore();
    store.rawSessions = [
      {
        session_id: 'old-1',
        initial_goal: '旧任务',
        conversation_id: 'conv-old',
        start_time: 1,
        status: 'completed',
      },
    ];
    store.selectSession('old-1');
    await vi.waitFor(() => expect(store.currentSessionId).toBe('old-1'));
    expect(wrapper.findAll('.conversation-item').length).toBeGreaterThan(0);

    await wrapper.find('.new-btn').trigger('click');

    expect(store.currentSessionId).toBeNull();
    expect(store.isDraftConversation).toBe(true);
    expect(store.submitConversationId).toBeTruthy();
  });
});
