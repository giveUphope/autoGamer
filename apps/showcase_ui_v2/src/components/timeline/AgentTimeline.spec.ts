import { mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';

import zhCN from '../../locales/zh-CN';
import { useSessionStore } from '../../stores/session';
import AgentTimeline from './AgentTimeline.vue';

/**
 * 组件冒烟：AgentTimeline（M2）挂载渲染——空态、步骤时间线、checker 面板、
 * 笔记 tab 与任务报告卡。api mock 与 store 层一致，聚焦渲染路径无运行时错误。
 */
vi.mock('@/services/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

import { apiGet } from '@/services/api';

const apiGetMock = apiGet as unknown as Mock;

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
});

function mountTimeline() {
  return mount(AgentTimeline, {
    global: {
      plugins: [ArcoVue, i18n, createPinia()],
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
    expect(wrapper.text()).toContain('请从右侧任务列表选择一个会话');
  });

  it('renders step cards with action details from the steps snapshot', async () => {
    const wrapper = await mountWithSession();
    // 动作卡与目标 / 坐标（来自 /steps 的 action_taken 实际字段；
    // 动作标题由 util 生成，保持与 Angular 一致的英文文案）
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
