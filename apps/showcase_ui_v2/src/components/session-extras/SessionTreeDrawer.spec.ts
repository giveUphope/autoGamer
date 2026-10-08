import { flushPromises, mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createI18n } from 'vue-i18n';

import zhCN from '../../locales/zh-CN';
import SessionTreeDrawer from './SessionTreeDrawer.vue';

/**
 * 组件测试：SessionTreeDrawer（对话轨迹树，覆盖全部轮次）。
 * vi.mock('@/services/api')（保留真实 ApiError）。
 * 覆盖：按传入轮次并行拉取各轮 /tree、根层时间正序的轮分组、空轮兜底、
 * thinking 内联 payload 的内容子节点、llm_call 展开时懒加载请求内容。
 * 抽屉内容 teleport 到 body，断言走 document.body。
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
// 第 1 轮：thinking（内联 payload，直接展开内容）+ llm_call（懒加载请求内容）。
const TREE1 = [
  {
    trace_id: 't1',
    parent_trace_id: null,
    type: 'thinking',
    name: 'thinking',
    status: 'success',
    timestamp: 1756152001,
    duration: 0.2,
    payload: { thought: '先打开设置' },
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

/** 展开指定 key 的树节点：直接在 Arco Tree 组件上 emit expand
 * （点击→emit 的接线由 Arco 自己的测试覆盖，这里驱动我们的处理逻辑）。 */
async function expandNode(
  tree: { vm: { $emit: (e: string, ...a: unknown[]) => void } },
  keys: string[],
): Promise<void> {
  // Arco 的 expand 事件携带合并后的完整展开集（父链全展开）
  tree.vm.$emit('expand', keys, {});
  await flushPromises();
}

function findTreeComponent(wrapper: ReturnType<typeof mount>) {
  const tree = wrapper.findComponent({ name: 'Tree' });
  expect(tree.exists(), 'arco tree component').toBe(true);
  return tree;
}

describe('SessionTreeDrawer (对话轨迹树)', () => {
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

  it('renders one chronological root per round with fallback leaves', async () => {
    apiGetMock.mockImplementation((url: string) =>
      Promise.resolve(url === '/api/sessions/s1/tree' ? TREE1 : []),
    );
    const wrapper = mountDrawer({ visible: true, rounds: ROUNDS });
    await flushPromises();

    const body = bodyText();
    // 根层按轮次时间正序：第 1 轮在最前
    expect(body.indexOf('第 1 轮 · 第一条 · 10:00')).toBeGreaterThan(-1);
    expect(body.indexOf('第 2 轮 · 第二条 · 10:05')).toBeGreaterThan(
      body.indexOf('第 1 轮 · 第一条 · 10:00'),
    );
    // 第 1 轮节点摘要；第 2 轮为空 → 兜底叶子（展开第 2 轮才渲染子节点）
    expect(body).toContain('thinking · thinking · success · 200ms');
    await expandNode(findTreeComponent(wrapper), ['round:s1', 'round:s2']);
    expect(bodyText()).toContain('该轮暂无轨迹记录');
  });

  it('renders inline payload content for thinking nodes on expand', async () => {
    apiGetMock.mockImplementation((url: string) =>
      Promise.resolve(url === '/api/sessions/s1/tree' ? TREE1 : []),
    );
    const wrapper = mountDrawer({ visible: true, rounds: ROUNDS });
    await flushPromises();

    await expandNode(findTreeComponent(wrapper), ['round:s1', 't1']);
    expect(bodyText()).toContain('请求内容');
    expect(bodyText()).toContain('先打开设置');
    // 内联 payload 不发额外请求
    expect(apiGetMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/api/traces/'))).toHaveLength(0);
  });

  it('lazy-loads llm_call request payload only when expanded', async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/api/sessions/s1/tree') return Promise.resolve(TREE1);
      if (url === '/api/traces/llm1') {
        return Promise.resolve({ payload: { messages: ['你好'], response: ['好的'] } });
      }
      return Promise.resolve([]);
    });
    const wrapper = mountDrawer({ visible: true, rounds: ROUNDS });
    await flushPromises();
    expect(apiGetMock.mock.calls.some((c) => String(c[0]).includes('/api/traces/'))).toBe(false);

    await expandNode(findTreeComponent(wrapper), ['round:s1', 'llm1']);
    expect(apiGetMock).toHaveBeenCalledWith('/api/traces/llm1');
    expect(bodyText()).toContain('"messages"');
    expect(bodyText()).toContain('你好');
  });
});
