import { flushPromises, mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createI18n } from 'vue-i18n';

import zhCN from '../../locales/zh-CN';
import SessionTreeDrawer from './SessionTreeDrawer.vue';

/**
 * 组件测试：SessionTreeDrawer（可视化轨迹树，双栏：层级树 + 节点详情）。
 * vi.mock('@/services/api')（保留真实 ApiError）。
 * 覆盖：按传入轮次并行拉取、根层时间正序、节点选中后详情面板（元数据+payload）、
 * llm_call 选中时懒加载、hideLogs 过滤、focusTraceId 全树定位。
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

// 第 1 轮：action（内联 payload）+ llm_call（懒加载）；第 2 轮：空。
const TREE1 = [
  {
    trace_id: 'act1',
    parent_trace_id: null,
    type: 'action',
    name: 'click',
    status: 'success',
    timestamp: 1756152001,
    duration: 0.865,
    payload: { args: { target: '返回按钮' } },
    children: [],
  },
  {
    trace_id: 'llm1',
    parent_trace_id: null,
    type: 'llm_call',
    name: 'chat',
    status: 'success',
    timestamp: 1756152002,
    duration: 1.5,
    payload: null,
    children: [],
  },
];

const ROUNDS = [
  { id: 's1', roundNumber: 1, goal: '第一条', time: '10:00' },
  { id: 's2', roundNumber: 2, goal: '第二条', time: '10:05' },
];

function mountDrawer(props: {
  visible: boolean;
  rounds: Array<{ id: string; roundNumber: number; goal: string; time: string }>;
  focusTraceId?: string | null;
}) {
  return mount(SessionTreeDrawer, {
    props,
    global: {
      plugins: [ArcoVue, i18n],
    },
  });
}

function bodyText(): string {
  return document.body.textContent || '';
}

function selectNode(key: string): void {
  const row = document.querySelector(`.tt-row[data-node-key="${key}"]`) as HTMLElement | null;
  expect(row, `tree row ${key}`).toBeTruthy();
  row!.click();
}

describe('SessionTreeDrawer (可视化轨迹树)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGetMock.mockReset();
    document.body.innerHTML = '';
  });

  it('closed drawer does not fetch; open fetches every round tree once', async () => {
    apiGetMock.mockResolvedValue([]);
    const wrapper = mountDrawer({ visible: false, rounds: ROUNDS });
    await flushPromises();
    expect(apiGetMock).not.toHaveBeenCalled();

    await wrapper.setProps({ visible: true });
    await flushPromises();
    const treeCalls = apiGetMock.mock.calls.map((c) => String(c[0])).filter((u) => u.endsWith('/tree'));
    expect(treeCalls).toEqual(['/api/sessions/s1/tree', '/api/sessions/s2/tree']);
  });

  it('renders chronological round roots and an empty-round fallback', async () => {
    apiGetMock.mockImplementation((url: string) =>
      Promise.resolve(url === '/api/sessions/s1/tree' ? TREE1 : []),
    );
    mountDrawer({ visible: true, rounds: ROUNDS });
    await flushPromises();

    const body = bodyText();
    expect(body.indexOf('第 1 轮 · 第一条 · 10:00')).toBeGreaterThan(-1);
    expect(body.indexOf('第 2 轮 · 第二条 · 10:05')).toBeGreaterThan(
      body.indexOf('第 1 轮 · 第一条 · 10:00'),
    );

    // 第 2 轮为空：展开（点 toggle）后显示兜底叶子
    const head2 = document.querySelector('.tt-row[data-node-key="round:s2"] .tt-toggle') as HTMLElement;
    head2.click();
    await flushPromises();
    expect(bodyText()).toContain('该轮暂无轨迹记录');
  });

  it('selecting a node shows the detail pane with metadata and inline payload', async () => {
    apiGetMock.mockImplementation((url: string) =>
      Promise.resolve(url === '/api/sessions/s1/tree' ? TREE1 : []),
    );
    mountDrawer({ visible: true, rounds: ROUNDS });
    await flushPromises();

    selectNode('act1');
    await flushPromises();

    const body = bodyText();
    expect(body).toContain('action');
    expect(body).toContain('865ms');
    expect(body).toContain('Trace Id');
    expect(body).toContain('act1');
    expect(body).toContain('返回按钮');
    // 内联 payload 不发额外请求
    expect(apiGetMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/api/traces/'))).toHaveLength(0);
  });

  it('lazy-loads llm_call payload on selection', async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/api/sessions/s1/tree') return Promise.resolve(TREE1);
      if (url === '/api/traces/llm1') {
        return Promise.resolve({ payload: { messages: ['你好'], response: ['好的'] } });
      }
      return Promise.resolve([]);
    });
    mountDrawer({ visible: true, rounds: ROUNDS });
    await flushPromises();
    expect(apiGetMock.mock.calls.some((c) => String(c[0]).includes('/api/traces/'))).toBe(false);

    selectNode('llm1');
    await flushPromises();
    expect(apiGetMock).toHaveBeenCalledWith('/api/traces/llm1');
    expect(bodyText()).toContain('你好');
  });

  it('hideLogs filters log nodes out of the tree', async () => {
    apiGetMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/api/sessions/s1/tree'
          ? [
              {
                trace_id: 'log1',
                parent_trace_id: null,
                type: 'log',
                name: 'noisy log',
                status: 'success',
                timestamp: 1756152000,
                duration: 0.01,
                payload: null,
                children: [],
              },
              ...TREE1,
            ]
          : [],
      ),
    );
    mountDrawer({ visible: true, rounds: ROUNDS });
    await flushPromises();
    expect(bodyText()).toContain('noisy log');

    // 抽屉内容 teleport 到 body，用 document 查询勾选框
    const checkbox = document.querySelector('.pane-toolbar input[type=\'checkbox\' i]') as HTMLInputElement;
    expect(checkbox, 'hideLogs checkbox').toBeTruthy();
    checkbox.click();
    await flushPromises();
    expect(bodyText()).not.toContain('noisy log');
    expect(bodyText()).toContain('click');
  });

  it('focusTraceId selects the node and lazy-loads its content', async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/api/sessions/s1/tree') return Promise.resolve(TREE1);
      if (url === '/api/traces/llm1') {
        return Promise.resolve({ payload: { messages: ['定位'], response: [] } });
      }
      return Promise.resolve([]);
    });
    mountDrawer({
      visible: true,
      rounds: ROUNDS,
      focusTraceId: 'llm1',
    });
    await flushPromises();

    expect(apiGetMock).toHaveBeenCalledWith('/api/traces/llm1');
    const body = bodyText();
    expect(body).toContain('请求内容');
    expect(body).toContain('定位');

    // 再次定位同一节点：内容已缓存，不重复拉取
    await flushPromises();
    const traceCalls = apiGetMock.mock.calls.filter((c) => String(c[0]) === '/api/traces/llm1');
    expect(traceCalls).toHaveLength(1);
  });
});
