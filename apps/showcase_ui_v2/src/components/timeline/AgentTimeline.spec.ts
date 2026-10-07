import { mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';
import { createI18n } from 'vue-i18n';

import zhCN from '../../locales/zh-CN';
import appI18n from '@/locales';
import { useSessionStore } from '../../stores/session';
import { useTimelineStore } from '../../stores/timeline';
import type { LLMStreamResetEventData } from '../../types/stream.model';
import AgentTimeline from './AgentTimeline.vue';

/**
 * 组件冒烟：AgentTimeline（M2/M3）挂载渲染——空态、步骤时间线、checker 面板、
 * 笔记 tab 与任务报告卡；M3 追加实时流状态（planning loader、LLM 重试警示条、
 * 任务暂停卡、断流重置提示）。api mock 与 store 层一致，聚焦渲染路径无运行时错误。
 */
vi.mock('@/services/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

// stream store 由 M3 数据层并行开发：按导出契约 mock（isRetrying / retryInfo /
// streamResetEvent），测试只消费契约不依赖其实现细节。
const mockStreamState = reactive({
  isRetrying: false,
  retryInfo: null as { attempt: number; max_retries: number; delay: number } | null,
  streamResetEvent: null as LLMStreamResetEventData | null,
});

vi.mock('@/stores/stream', () => ({
  useStreamStore: () => mockStreamState,
}));

import { apiGet } from '@/services/api';

const apiGetMock = apiGet as unknown as Mock;

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
});

// 动作标题等由 util 生成的语义文案走 app 级 i18n 实例（src/utils/i18n.ts）。
// 本 spec 将该实例固定在 en-US，使 util 产出的英文断言与迁移前行为逐字节一致；
// 组件自身的界面文案仍使用上方 zh-CN 实例，不受影响。
appI18n.global.locale.value = 'en-US';

// B5：planning loader 轮换短语（zh-CN 消息）——loader 文案断言不再依赖单一静态文案
const PLANNING_PHRASES: string[] = zhCN.workspace.timeline.planningPhrases ?? [];

function planningLoaderText(wrapper: VueWrapper<any>): string {
  const loader = wrapper.find('.planning-loader');
  return loader.exists() ? loader.text().trim() : '';
}

function mountTimeline() {
  // 测试代码与组件必须共用同一个 pinia 实例：否则 rawSessions/selectSession
  // 塞进测试侧 store，组件读的是 mount 插件里的另一个实例，渲染永远卡加载态。
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(AgentTimeline, {
    global: {
      plugins: [ArcoVue, i18n, pinia],
    },
  });
}

const SESSION = {
  session_id: 'sess-1',
  initial_goal: '打开设置，查看电池电量',
  start_time: 1756151995,
  end_time: 1756152400,
  status: 'completed',
};

function mockBackend() {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/api/sessions') return Promise.resolve([SESSION]);
    if (url === '/api/sessions/sess-1/steps') {
      return Promise.resolve([
        {
          step_id: 's1',
          step_number: '1',
          timestamp: 1756152001,
          operator_raw_thinking: 'I see the home screen with **Settings** icon.',
          action_taken: {
            action: 'click',
            args: { target_description: '设置应用图标' },
            normalized_coordinates: [319, 909],
          },
          pre_image_name: 'prehash',
          post_image_name: 'posthash',
          generic_tools: [],
          token_usage: { prompt_tokens: 3095, completion_tokens: 1, total_tokens: 3096 },
          total_tokens: 3096,
          duration: 5,
        },
        {
          step_id: 's2',
          step_number: '2',
          timestamp: 1756152010,
          action_taken: { action: 'report_task_status', args: { status: 'completed', explanation: 'Battery is 80%' } },
          generic_tools: [
            { trace_id: 't1', type: 'tool', name: 'save_note', status: 'success', payload: { args: { key: 'task_plan' } } },
          ],
        },
      ]);
    }
    if (url === '/api/sessions/sess-1/checks') {
      return Promise.resolve({
        records: [
          {
            attempt_id: 'final#1',
            checkpoint_id: 'final',
            subgoal_text: "Final review against the user's original goal",
            kind: 'verify',
            status: 'passed',
            item_text: 'Battery level visible',
            evidence: 'The screenshot shows 80%.',
            ts: 1756152020,
          },
        ],
        streams: [],
        run_outcome: { task_status: 'completed', tests: { passed: 1, failed: 0 } },
      });
    }
    if (url === '/api/sessions/sess-1/notes') {
      return Promise.resolve({
        notes: {
          'task_plan.md': '# Plan\n- [x] Open settings\n  - verify: battery level visible\n',
          'output.md': '# Report\n- [x] Done\n',
        },
      });
    }
    if (url === '/api/sessions/sess-1/usage') {
      return Promise.resolve({
        session_id: 'sess-1',
        llm_calls: 4,
        prompt_tokens: 16370,
        completion_tokens: 2751,
        total_tokens: 19121,
        cached_tokens: 0,
        operator_context_tokens: null,
        operator_context_window_tokens: 1000000,
        profile: 'flash',
        run_tuning: null,
      });
    }
    if (url === '/api/sessions/sess-1/startup_progress') return Promise.resolve([]);
    return Promise.resolve({});
  });
}

describe('AgentTimeline (M2)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    apiGetMock.mockReset();
    mockBackend();
  });

  async function mountWithSession() {
    const wrapper = mountTimeline();
    const sessionStore = useSessionStore();
    sessionStore.rawSessions = [SESSION];
    sessionStore.selectSession('sess-1', false);
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('已执行'),
    );
    return wrapper;
  }


  it('renders the empty state when no session is selected', () => {
    const wrapper = mountTimeline();
    expect(wrapper.text()).toContain('未选择会话活动');
    expect(wrapper.text()).toContain('在下方输入框描述要执行的操作即可开始');
  });

  it('renders step cards with action details from the steps snapshot', async () => {
    const wrapper = await mountWithSession();
    // 动作卡与目标 / 坐标（来自 /steps 的 action_taken 实际字段；
    // 动作标题由 util 生成——app 级 i18n 实例在本 spec 中固定 en-US，保持迁移前英文断言）
    await vi.waitFor(() => expect(wrapper.text()).toContain('Tapping Element'));
    expect(wrapper.text()).toContain('设置应用图标');
    expect(wrapper.text()).toContain('[319, 909]');
    // markdown 流文本（Work 段）
    expect(wrapper.text()).toContain('I see the home screen with Settings icon.');
  });

  it('renders the task report card and checker panels from checks snapshot', async () => {
    const wrapper = await mountWithSession();
    await vi.waitFor(() => expect(wrapper.text()).toContain('任务已完成'));
    // checker 回填：最终核查 + 结论 + run_outcome
    await vi.waitFor(() => expect(wrapper.text()).toContain('最终核查'));
    expect(wrapper.text()).toContain('The screenshot shows 80%.');
    expect(wrapper.text()).toContain('目标完成');
  });

  it('renders notes tabs and opens them from the toolbar', async () => {
    const wrapper = await mountWithSession();
    await vi.waitFor(() => expect(wrapper.text()).toContain('笔记与计划'));
    // 点击工具栏的笔记按钮打开 popover（Arco 弹层 teleport 到 body）
    await wrapper.find('.notes-btn').trigger('click');
    await vi.waitFor(() => expect(document.body.textContent || '').toContain('battery level visible'));
    expect(document.body.textContent || '').toContain('Plan');
  });
});

describe('AgentTimeline (M3 实时流)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    apiGetMock.mockReset();
    // 空后端：任意会话的 steps/checks/notes/startup_progress 均为空
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/api/sessions') return Promise.resolve([]);
      if (url.startsWith('/api/sessions/')) return Promise.resolve([]);
      return Promise.resolve({});
    });
    mockStreamState.isRetrying = false;
    mockStreamState.retryInfo = null;
    mockStreamState.streamResetEvent = null;
  });

  /** 挂载并选中运行中的空会话（无任何日志）。 */
  async function mountRunningEmptySession() {
    const wrapper = mountTimeline();
    const sessionStore = useSessionStore();
    sessionStore.agentStatus = 'running';
    sessionStore.runningSessionId = 'sess-empty';
    sessionStore.selectSession('sess-empty', false);
    return wrapper;
  }

  it('shows the planning loader while running with no logs', async () => {
    const wrapper = await mountRunningEmptySession();
    // B5：loader 文案为轮换短语之一，断言容器出现即可，不依赖具体短语
    await vi.waitFor(() => expect(wrapper.find('.planning-loader').exists()).toBe(true));
    wrapper.unmount();
  });

  it('displays one of the rotating planning phrases in the loader', async () => {
    const wrapper = await mountRunningEmptySession();
    await vi.waitFor(() => expect(wrapper.find('.planning-loader').exists()).toBe(true));
    // B5：随机起点 + 2.8s 轮换的可见结果——起始文案必为 planningPhrases 之一
    expect(PLANNING_PHRASES).toContain(planningLoaderText(wrapper));
    wrapper.unmount();
  });

  it('hides the planning loader while an llm_stream chunk is incomplete', async () => {
    const wrapper = await mountRunningEmptySession();
    await vi.waitFor(() => expect(wrapper.find('.planning-loader').exists()).toBe(true));
    const timelineStore = useTimelineStore();
    timelineStore.sessionLogs.push({
      type: 'llm_stream',
      timestamp: new Date().toISOString(),
      session_id: 'sess-empty',
      data: { execution_id: 'e1', text: 'partial answer', stream_type: 'text', isCompleted: false },
    });
    await vi.waitFor(() => expect(wrapper.find('.planning-loader').exists()).toBe(false));
    wrapper.unmount();
  });

  it('hides the planning loader after session_ended', async () => {
    const wrapper = await mountRunningEmptySession();
    await vi.waitFor(() => expect(wrapper.find('.planning-loader').exists()).toBe(true));
    const timelineStore = useTimelineStore();
    timelineStore.sessionLogs.push({
      type: 'session_ended',
      timestamp: new Date().toISOString(),
      session_id: 'sess-empty',
      data: {},
    });
    await vi.waitFor(() => expect(wrapper.find('.planning-loader').exists()).toBe(false));
    wrapper.unmount();
  });

  it('shows the paused card with resume action while viewing the paused task', async () => {
    const wrapper = await mountRunningEmptySession();
    const sessionStore = useSessionStore();
    sessionStore.agentStatus = 'paused';
    sessionStore.isPaused = true;
    sessionStore.pausedError = 'AI model request failed. The task is paused.';
    await vi.waitFor(() => expect(wrapper.text()).toContain('任务已暂停'));
    expect(wrapper.text()).toContain('AI model request failed. The task is paused.');
    expect(wrapper.text()).toContain('继续任务');
    expect(wrapper.text()).toContain('任务已暂停 · 没有正在执行的步骤');

    // 查看非当前运行会话时恢复卡不显示（isViewingPausedTask 条件）
    sessionStore.selectSession('sess-other', false);
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('继续任务'));
  });

  it('renders the retrying banner assembled from retryInfo', async () => {
    const wrapper = mountTimeline();
    // 重试警示条属于选中任务的轮身：先选中一个会话（多轮对话流信息架构）
    const sessionStore = useSessionStore();
    sessionStore.rawSessions = [SESSION];
    sessionStore.selectSession('sess-1', false);
    mockStreamState.isRetrying = true;
    mockStreamState.retryInfo = { attempt: 2, max_retries: 5, delay: 2.5 };
    await vi.waitFor(() => expect(wrapper.text()).toContain('AI 服务暂时繁忙'));
    expect(wrapper.text()).toContain('（第 2/5 次尝试）');
    expect(wrapper.text()).toContain('将在 2.5s 后重试');

    // 整数延迟不带 .0
    mockStreamState.retryInfo = { attempt: 1, max_retries: 3, delay: 2 };
    await vi.waitFor(() => expect(wrapper.text()).toContain('将在 2s 后重试'));
  });

  it('renders the stream reset notice on a reset llm_stream block', async () => {
    const wrapper = mountTimeline();
    const sessionStore = useSessionStore();
    sessionStore.rawSessions = [SESSION];
    sessionStore.selectSession('sess-1', false);
    // 等待会话装载完成（adoptSession 为异步 watch，先等轮身稳定再注入 live 日志）
    await vi.waitFor(() => expect(wrapper.text()).toContain('打开设置，查看电池电量'));
    const timelineStore = useTimelineStore();
    timelineStore.sessionLogs.push({
      type: 'llm_stream',
      timestamp: new Date().toISOString(),
      session_id: 'sess-1',
      data: {
        execution_id: 'e1',
        text: 'The model was interrupted mid answer',
        stream_type: 'text',
        isCompleted: false,
        isReset: true,
      },
    });
    // resetMessage 缺省时回退 DEFAULT_STREAM_RESET_MESSAGE（后端语义文案，不做 i18n）
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('A request error occurred during output generation'),
    );
  });
});

describe('AgentTimeline 回合级折叠', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    apiGetMock.mockReset();
    mockBackend();
  });

  async function mountWithSession() {
    const wrapper = mountTimeline();
    const sessionStore = useSessionStore();
    sessionStore.rawSessions = [SESSION];
    sessionStore.selectSession('sess-1', false);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已执行'));
    return wrapper;
  }

  /** v-show 的直接效果：收起态 body 带 display:none 内联样式（isVisible 在 jsdom
   *  下依赖 getComputedStyle，跨文件行为不稳，断言落到实现解耦的 style/类上）。 */
  function isBodyShown(container: ReturnType<VueWrapper<any>['find']>): boolean {
    const style = container.find('.phase-body').attributes('style') ?? '';
    return !style.includes('display: none');
  }

  it('历史会话（全部块完成）默认收起所有回合，头部显示步骤数', async () => {
    const wrapper = await mountWithSession();
    const containers = wrapper.findAll('.phase-container');
    expect(containers.length).toBeGreaterThan(0);
    for (const container of containers) {
      expect(container.classes()).toContain('collapsed');
      expect(isBodyShown(container)).toBe(false);
    }
    // 步骤计数（两个 step 块分属不同回合，各 1 步）
    expect(wrapper.findAll('.phase-step-count').some((el) => el.text().includes('1 步'))).toBe(true);
  });

  it('点击回合头部手动展开，再次点击收起', async () => {
    const wrapper = await mountWithSession();
    const first = wrapper.findAll('.phase-container')[0]!;
    expect(isBodyShown(first)).toBe(false);

    await first.find('.phase-header').trigger('click');
    expect(first.classes()).not.toContain('collapsed');
    expect(isBodyShown(first)).toBe(true);

    await first.find('.phase-header').trigger('click');
    expect(first.classes()).toContain('collapsed');
    expect(isBodyShown(first)).toBe(false);
  });

  it('输出中的回合自动展开：注入未完成的 live 块后新回合展开，旧回合保持收起', async () => {
    const wrapper = await mountWithSession();
    const timelineStore = useTimelineStore();
    timelineStore.sessionLogs.push({
      type: 'llm_stream',
      timestamp: new Date().toISOString(),
      session_id: 'sess-1',
      data: {
        execution_id: 'e-live',
        text: '正在输出中的内容…',
        stream_type: 'text',
        isCompleted: false,
      },
    });
    await vi.waitFor(() => {
      const containers = wrapper.findAll('.phase-container');
      // live 块归属最后一个回合；该回合的 body 处于展示状态（未带 display:none）
      const last = containers[containers.length - 1]!;
      expect(last.classes()).not.toContain('collapsed');
    });
    const containers = wrapper.findAll('.phase-container');
    const last = containers[containers.length - 1]!;
    expect(isBodyShown(last)).toBe(true);
    // 旧回合保持收起
    for (const container of containers.slice(0, -1)) {
      expect(container.classes()).toContain('collapsed');
      expect(isBodyShown(container)).toBe(false);
    }
  });

  it('活动回合输出完毕后自动收起', async () => {
    const wrapper = await mountWithSession();
    const timelineStore = useTimelineStore();
    timelineStore.sessionLogs.push({
      type: 'llm_stream',
      timestamp: new Date().toISOString(),
      session_id: 'sess-1',
      data: { execution_id: 'e-live', text: '一段输出', stream_type: 'text', isCompleted: false },
    });
    await vi.waitFor(() => {
      const containers = wrapper.findAll('.phase-container');
      expect(containers[containers.length - 1]!.classes()).not.toContain('collapsed');
    });

    // 流完成：补一条同 execution_id 的 isCompleted 日志
    timelineStore.sessionLogs.push({
      type: 'llm_stream',
      timestamp: new Date().toISOString(),
      session_id: 'sess-1',
      data: { execution_id: 'e-live', text: ' 输出完毕。', stream_type: 'text', isCompleted: true },
    });
    await vi.waitFor(() => {
      const containers = wrapper.findAll('.phase-container');
      expect(containers[containers.length - 1]!.classes()).toContain('collapsed');
    });
  });
});

describe('AgentTimeline 轮级开合', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    apiGetMock.mockReset();
    mockBackend();
  });

  function mountWithSessions() {
    const wrapper = mountTimeline();
    const sessionStore = useSessionStore();
    // 同一会话线程内的两轮（提交时带同一 conversation_id）
    const second = {
      ...SESSION,
      session_id: 'sess-2',
      initial_goal: '回到主页列出主页内容',
      start_time: SESSION.start_time + 60,
      conversation_id: 'conv-spec',
    };
    const first = { ...SESSION, conversation_id: 'conv-spec' };
    sessionStore.rawSessions = [first, second];
    sessionStore.selectSession('sess-1', false);
    return { wrapper, sessionStore };
  }

  it('点击已选中轮头收起轮身，再点展开', async () => {
    const { wrapper } = mountWithSessions();
    await vi.waitFor(() => expect(wrapper.find('.round-block.active .round-body').exists()).toBe(true));

    const activeHead = wrapper.find('.round-block.active .round-head');
    await activeHead.trigger('click');
    // 收起：选中态保持（active 类仍在），轮身移除
    expect(wrapper.find('.round-block.active').exists()).toBe(true);
    expect(wrapper.find('.round-block.active .round-body').exists()).toBe(false);
    expect(wrapper.find('.round-block.active .round-head').attributes('aria-expanded')).toBe('false');

    await wrapper.find('.round-block.active .round-head').trigger('click');
    expect(wrapper.find('.round-block.active .round-body').exists()).toBe(true);
    expect(wrapper.find('.round-block.active .round-head').attributes('aria-expanded')).toBe('true');
  });

  it('收起后切换到其他轮再切回，轮身恢复展开', async () => {
    const { wrapper, sessionStore } = mountWithSessions();
    await vi.waitFor(() => expect(wrapper.find('.round-block.active .round-body').exists()).toBe(true));

    await wrapper.find('.round-block.active .round-head').trigger('click');
    expect(wrapper.find('.round-block.active .round-body').exists()).toBe(false);

    // 从右栏等来源切换选中（绕过轮头点击），再切回
    sessionStore.selectSession('sess-2', true);
    await vi.waitFor(() => expect(wrapper.find('.round-block.active .round-goal').text()).toContain('回到主页'));
    sessionStore.selectSession('sess-1', true);
    await vi.waitFor(() => {
      const body = wrapper.find('.round-block.active .round-body');
      expect(body.exists()).toBe(true);
    });
  });

  it('点击未选中轮头即选中展开', async () => {
    const { wrapper, sessionStore } = mountWithSessions();
    await vi.waitFor(() => expect(wrapper.findAll('.round-block').length).toBe(2));

    expect(wrapper.findAll('.round-block')[1]!.find('.round-body').exists()).toBe(false);
    await wrapper.findAll('.round-block')[1]!.find('.round-head').trigger('click');
    await vi.waitFor(() => {
      expect(sessionStore.currentSessionId).toBe('sess-2');
      // v-for 重渲染会替换节点，断言前实时查询
      const block = wrapper.findAll('.round-block')[1]!;
      expect(block.classes()).toContain('active');
      expect(block.find('.round-body').exists()).toBe(true);
    });
  });
});

describe('AgentTimeline 动作卡展开图标语义', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    apiGetMock.mockReset();
    mockBackend();
  });

  it('动作卡：展开显示下箭头（可收起），收起显示右箭头（可展开）', async () => {
    const wrapper = mountTimeline();
    const sessionStore = useSessionStore();
    sessionStore.rawSessions = [SESSION];
    sessionStore.selectSession('sess-1', false);
    await vi.waitFor(() => expect(wrapper.text()).toContain('已执行'));

    // 展开选中轮的第一个回合
    const phaseHeader = wrapper.find('.round-block.active .phase-container .phase-header');
    await phaseHeader.trigger('click');
    await vi.waitFor(() => expect(wrapper.find('.action-card').exists()).toBe(true));

    const card = wrapper.find('.action-card');
    const icon = card.find('.expand-icon');
    // 动作卡默认展开：下箭头（点击收起）
    expect(icon.classes()).not.toContain('rotated');
    await card.find('.card-header').trigger('click');
    // 收起后：右箭头（点击展开）
    expect(icon.classes()).toContain('rotated');
  });
});
