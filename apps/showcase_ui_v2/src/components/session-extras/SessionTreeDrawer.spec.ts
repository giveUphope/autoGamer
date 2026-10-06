import { flushPromises, mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createI18n } from 'vue-i18n';

import zhCN from '../../locales/zh-CN';
import SessionTreeDrawer from './SessionTreeDrawer.vue';

/**
 * 组件测试：SessionTreeDrawer（B6 轨迹树抽屉）。
 * vi.mock('@/services/api')（保留真实 ApiError），参照 DiagnosticsWizard.spec 风格。
 * 覆盖：关闭状态不拉取（仅点击时拉取）、节点摘要渲染、空态、加载失败（detail 透传）、
 * 会话切换重开重拉。抽屉内容 teleport 到 body，断言走 document.body。
 */

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});

import { apiGet } from '@/services/api';

const apiGetMock = apiGet as unknown as Mock;

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
});

// 节点形状对齐 trace_repo.get_trace_tree（trace_repository.py）。
const TREE = [
  {
    trace_id: 't1',
    parent_trace_id: null,
    type: 'span',
    name: 'operator',
    status: 'success',
    timestamp: 1756152001,
    duration: 1.234,
    payload: null,
    children: [
      {
        trace_id: 't2',
        parent_trace_id: 't1',
        type: 'tool',
        name: 'tap',
        status: 'success',
        timestamp: 1756152002,
        duration: 0.5,
        payload: { args: { target: '设置' } },
        children: [],
      },
    ],
  },
  {
    trace_id: 't3',
    parent_trace_id: null,
    type: 'span',
    name: 'validator',
    status: 'failed',
    timestamp: 1756152003,
    duration: 0.25,
    payload: null,
    children: [],
  },
];

function mountDrawer(props: { visible: boolean; sessionId: string | null }) {
  return mount(SessionTreeDrawer, {
    props,
    global: {
      plugins: [ArcoVue, i18n],
    },
  });
}

describe('SessionTreeDrawer (B6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGetMock.mockReset();
    document.body.innerHTML = '';
  });

  it('does not fetch while closed (no auto fetch)', async () => {
    const wrapper = mountDrawer({ visible: false, sessionId: 'sess-1' });
    await flushPromises();
    expect(apiGetMock).not.toHaveBeenCalled();

    await wrapper.setProps({ visible: true });
    await flushPromises();
    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(apiGetMock).toHaveBeenCalledWith('/api/sessions/sess-1/tree');
  });

  it('renders normalized trace nodes as tree titles', async () => {
    apiGetMock.mockResolvedValue(TREE);
    mountDrawer({ visible: true, sessionId: 'sess-1' });
    await flushPromises();

    const body = document.body.textContent || '';
    // title 摘要 = name · type · status · duration
    expect(body).toContain('会话轨迹树');
    expect(body).toContain('operator · span · success · 1234ms');
    expect(body).toContain('validator · span · failed · 250ms');
  });

  it('shows the empty state for an empty tree payload', async () => {
    apiGetMock.mockResolvedValue([]);
    mountDrawer({ visible: true, sessionId: 'sess-1' });
    await flushPromises();

    expect(document.body.textContent || '').toContain('该会话暂无轨迹数据');
  });

  it('shows the backend detail when loading fails', async () => {
    const { ApiError } = await import('@/services/api');
    apiGetMock.mockRejectedValue(new ApiError(500, 'HTTP 500', { detail: 'db broken' }));
    mountDrawer({ visible: true, sessionId: 'sess-1' });
    await flushPromises();

    const body = document.body.textContent || '';
    expect(body).toContain('轨迹树加载失败');
    expect(body).toContain('db broken');
  });

  it('re-fetches when the session changes while the drawer stays open', async () => {
    apiGetMock.mockResolvedValue(TREE);
    const wrapper = mountDrawer({ visible: true, sessionId: 'sess-1' });
    await flushPromises();
    expect(apiGetMock).toHaveBeenCalledTimes(1);

    await wrapper.setProps({ sessionId: 'sess-2' });
    await flushPromises();
    expect(apiGetMock).toHaveBeenCalledTimes(2);
    expect(apiGetMock).toHaveBeenLastCalledWith('/api/sessions/sess-2/tree');
  });
});
