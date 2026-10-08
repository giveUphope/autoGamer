import { flushPromises, mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createI18n } from 'vue-i18n';
import { createPinia } from 'pinia';

import zhCN from '../../locales/zh-CN';
import ReplayDrawer from './ReplayDrawer.vue';

/**
 * 组件测试：ReplayDrawer（B6 步骤回放调试）。
 * vi.mock('@/services/api')（保留真实 ApiError），参照 DiagnosticsWizard.spec 风格。
 * 覆盖：replay_steps 404 空态、步骤/设备/工具渲染、确认弹窗拦截 POST（取消不发请求、
 * 确认后才 POST 且 body 含 device_id/user_submits/tool_name/replay_id）、
 * 无设备时回放按钮禁用、查看上次结果。抽屉与弹窗 teleport 到 body。
 */

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});
vi.mock('@/stores/player', () => ({ usePlayerStore: () => ({ openVideoPlayer: vi.fn() }) }));
vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({ currentSession: { video_url: '/videos/s1.mp4' } }),
}));

import { apiGet, apiPost } from '@/services/api';

const apiGetMock = apiGet as unknown as Mock;
const apiPostMock = apiPost as unknown as Mock;

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
});

// 形状对齐 replay_manager.get_replay_steps / list_devices / get_replay_tools / get_replay_config。
const STEPS = [
  {
    step_id: 's3',
    step_number: 3,
    timestamp: 1756152003,
    summary: '点击设置应用图标',
    action_taken: [],
    query: '',
    param_defaults: { ask_explorer: { instruction: '打开设置并查看电量' } },
    pre_screenshot: null,
    post_screenshot: null,
    operator_raw_thinking: null,
    operator_native_thinking: null,
    is_replayed: true,
  },
  {
    step_id: 's4',
    step_number: 4,
    timestamp: 1756152010,
    summary: '滑动屏幕查看更多选项',
    action_taken: [],
    query: '',
    param_defaults: {},
    pre_screenshot: null,
    post_screenshot: null,
    operator_raw_thinking: null,
    operator_native_thinking: null,
    is_replayed: false,
  },
];

const DEVICES = [{ serial: 'dev-1', status: 'online' }];
const TOOLS = [
  { name: 'ask_explorer', display_name: 'Ask Explorer', description: 'Explore the screen' },
];
const TOOL_CONFIG = [
  { name: 'instruction', default: '', input_type: 'textarea' },
  { name: 'max_steps', default: 5, input_type: 'number' },
];

/** 按 URL mock GET；replay_steps 404 场景由用例覆写。 */
function mockBackend(overrides: { steps?: unknown; devices?: unknown } = {}) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/api/devices') return Promise.resolve(overrides.devices ?? DEVICES);
    if (url === '/api/replay/tools') return Promise.resolve(TOOLS);
    if (url === '/api/replay/config') return Promise.resolve(TOOL_CONFIG);
    if (url === '/api/sessions/s1/replay_steps') return Promise.resolve(overrides.steps ?? STEPS);
    if (url === '/api/sessions/s1/steps') {
      const source = (overrides.steps ?? STEPS) as Array<{
        step_number: unknown;
        summary: unknown;
      }>;
      return Promise.resolve(
        source.map((s, i) => ({
          step_number: s.step_number,
          summary: s.summary,
          pre_image_name: i === 0 ? 'pre-hash-1' : null,
          post_image_name: 'post-hash-1',
        })),
      );
    }
    if (url === '/api/sessions/s1/steps/3/replay_traces') {
      return Promise.resolve({ success: true, live: [{ trace_id: 'r1', name: 'ask_explorer' }], preloaded: [] });
    }
    return Promise.resolve({});
  });
}

function mountDrawer() {
  return mount(ReplayDrawer, {
    props: { visible: true, sessionId: 's1' },
    global: { plugins: [ArcoVue, i18n, createPinia()] },
  });
}

function findModalButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.arco-modal-footer button')).find(
    (btn) => (btn.textContent || '').includes(text),
  );
}

/**
 * a-modal 关闭后 DOM（v-show）仍保留在 body：隐藏样式分布在
 * `.arco-modal-container` / `.arco-modal` 上，任一处于 display:none 即视为关闭；
 * 若实现改为卸载式渲染（元素不存在）同样视为关闭。
 */
function isModalHidden(): boolean {
  const els = Array.from(document.querySelectorAll<HTMLElement>('.arco-modal-container, .arco-modal'));
  if (els.length === 0) return true;
  return els.some((el) => el.style.display === 'none');
}

/** 步骤卡上的"回放"按钮（位于 .step-actions，文本恰为"回放"，不匹配"开始回放/查看上次结果"）。 */
function findReplayButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.step-actions button')).filter(
    (btn) => (btn.textContent || '').trim() === '回放',
  );
}

/** 步骤卡上的"查看上次结果"按钮。 */
function findLastResultButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.step-actions button')).filter(
    (btn) => (btn.textContent || '').includes('查看上次结果'),
  );
}

describe('ReplayDrawer (B6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    document.body.innerHTML = '';
  });

  it('shows the empty state when replay_steps returns 404', async () => {
    const { ApiError } = await import('@/services/api');
    mockBackend();
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/api/sessions/s1/replay_steps') {
        return Promise.reject(new ApiError(404, 'HTTP 404', { detail: 'no chunked data' }));
      }
      if (url === '/api/devices') return Promise.resolve(DEVICES);
      if (url === '/api/replay/tools') return Promise.resolve(TOOLS);
      if (url === '/api/replay/config') return Promise.resolve(TOOL_CONFIG);
      return Promise.resolve({});
    });

    mountDrawer();
    await flushPromises();

    const body = document.body.textContent || '';
    expect(body).toContain('该会话没有可回放的步骤数据');
    expect(body).not.toContain('点击设置应用图标');
  });

  it('renders devices, tools, tool params and replay steps', async () => {
    mockBackend();
    mountDrawer();
    await flushPromises();

    const body = document.body.textContent || '';
    expect(body).toContain('回放中心');
    expect(body).toContain('屏幕回放');
    expect(body).toContain('工具参数说明');
    expect(body).toContain('instruction');
    expect(body).toContain('textarea');
    expect(body).toContain('步骤 3');
    expect(body).toContain('点击设置应用图标');
    expect(body).toContain('已回放');
    // 步骤回放按钮可用（设备/工具就绪）
    const replayBtn = findReplayButtons()[0]!;
    expect(replayBtn.hasAttribute('disabled')).toBe(false);
  });

  it('blocks the POST behind the confirm modal: cancel sends nothing', async () => {
    mockBackend();
    mountDrawer();
    await flushPromises();

    findReplayButtons()[0]!.click();
    await flushPromises();

    const body = document.body.textContent || '';
    expect(body).toContain('确认执行回放');
    expect(body).toContain('将在设备 dev-1 上真实执行第 3 步的沙箱回放');
    expect(apiPostMock).not.toHaveBeenCalled();

    const cancelBtn = findModalButton('取消');
    expect(cancelBtn).toBeTruthy();
    cancelBtn!.click();
    await flushPromises();

    expect(apiPostMock).not.toHaveBeenCalled();
    expect(isModalHidden()).toBe(true);
  });

  it('posts the replay only after confirming, then renders the result collapse', async () => {
    mockBackend();
    apiPostMock.mockResolvedValue({
      success: true,
      preloaded: [{ trace_id: 'p1', name: 'preloaded' }],
      live: [{ trace_id: 'l1', name: 'ask_explorer' }],
      replay_id: 'rp-1',
    });
    mountDrawer();
    await flushPromises();

    findReplayButtons()[0]!.click();
    await flushPromises();

    const okBtn = findModalButton('开始回放');
    expect(okBtn).toBeTruthy();
    okBtn!.click();
    await flushPromises();

    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(apiPostMock).toHaveBeenCalledWith('/api/sessions/s1/steps/3/replay', {
      device_id: 'dev-1',
      user_submits: { instruction: '打开设置并查看电量' },
      tool_name: 'ask_explorer',
      replay_id: null,
    });

    const body = document.body.textContent || '';
    expect(body).toContain('第 3 步回放结果');
    expect(body).toContain('实时轨迹（1 条）');
    expect(body).toContain('预载轨迹（1 条）');
  });

  it('disables the replay button when no device is available', async () => {
    mockBackend({ devices: [] });
    mountDrawer();
    await flushPromises();

    expect((document.body.textContent || '')).toContain('未检测到可用设备');
    const replayBtn = findReplayButtons()[0]!;
    expect(replayBtn.hasAttribute('disabled')).toBe(true);
    replayBtn.click();
    await flushPromises();
    expect(apiPostMock).not.toHaveBeenCalled();
    expect(isModalHidden()).toBe(true);
  });

  it('loads the last replay result via replay_traces', async () => {
    mockBackend();
    mountDrawer();
    await flushPromises();

    const lastBtns = findLastResultButtons();
    lastBtns[0]!.click();
    await flushPromises();

    expect(apiGetMock).toHaveBeenCalledWith('/api/sessions/s1/steps/3/replay_traces', {
      params: { tool_name: 'ask_explorer' },
    });
    expect((document.body.textContent || '')).toContain('历史结果');
  });
});
