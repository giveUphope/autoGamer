import { mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { createI18n } from 'vue-i18n';

import zhCN from '../locales/zh-CN';
import type { StepReplayFrame } from '../types/stream.model';
import FloatingPlayer from './FloatingPlayer.vue';
import StepCard from './timeline/StepCard.vue';

/**
 * 组件测试（M4）：FloatingPlayer 三模式（live / processing / failed / steps / video）
 * 的渲染与契约消费——player store 按导出契约 mock 为 reactive 对象（与
 * AgentTimeline.spec 的 stream store mock 风格一致），录像时间轴 util（真实实现）
 * 与 action/image-overlay util 直接消费。附 StepCard 视频分析 pill 的局部测试。
 */

// ---- player store 契约 mock（stores/player.ts 导出契约的 reactive 影子） ----
const openVideoPlayer = vi.fn();
const setPlayerMode = vi.fn();
const retryVideoRecording = vi.fn();

const mockPlayerStore = reactive({
  // state
  isVideoWindowOpen: true,
  isVideoMinimized: false,
  activeVideoUrl: null as string | null,
  activeVideoSegments: [] as Array<{ url: string; start: number; duration: number; width: number; height: number }>,
  activeVideoTitle: '任务：打开设置',
  isVideoLoading: false,
  recordingPlaybackStatus: 'idle' as 'idle' | 'processing' | 'ready' | 'failed' | 'unavailable' | 'live',
  recordingPlaybackMessage: '',
  shouldAutoplayVideo: false,
  videoSeekRequest: null as { seconds: number; requestId: number } | null,
  stepSeekRequest: null as { index: number; requestId: number } | null,
  playerMode: 'video' as 'video' | 'steps',
  // computed
  currentSessionStepFrames: [] as StepReplayFrame[],
  hasCurrentSessionStepFrames: false,
  currentSessionVideoUrl: null as string | null,
  currentSessionRecordingStatus: undefined as string | undefined,
  // actions
  openVideoPlayer,
  closeVideoPlayer: vi.fn(),
  toggleVideoPlayer: vi.fn(),
  toggleVideoMinimized: vi.fn(),
  retryVideoRecording,
  consumeVideoAutoplay: vi.fn(() => false),
  requestVideoSeek: vi.fn(),
  requestStepSeek: vi.fn(),
  setPlayerMode,
});

vi.mock('@/stores/player', () => ({
  usePlayerStore: () => mockPlayerStore,
}));

// StepCard 消费的 session / timeline store：最小 reactive 契约
const mockSessionStore = reactive({ currentSessionId: 'sess-1' as string | null, resumeTask: vi.fn() });
const mockTimelineStore = reactive({ consolidatedBlocks: [] as unknown[], selectNoteKey: vi.fn() });

vi.mock('@/stores/session', () => ({
  useSessionStore: () => mockSessionStore,
}));

vi.mock('@/stores/timeline', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

// jsdom 未实现媒体元素行为：mock 播放控制避免 "not implemented" 噪音
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockReturnValue(undefined);
  mockPlayerStore.isVideoWindowOpen = true;
  mockPlayerStore.isVideoMinimized = false;
  mockPlayerStore.activeVideoUrl = null;
  mockPlayerStore.activeVideoSegments = [];
  mockPlayerStore.activeVideoTitle = '任务：打开设置';
  mockPlayerStore.isVideoLoading = false;
  mockPlayerStore.recordingPlaybackStatus = 'idle';
  mockPlayerStore.recordingPlaybackMessage = '';
  mockPlayerStore.shouldAutoplayVideo = false;
  mockPlayerStore.videoSeekRequest = null;
  mockPlayerStore.stepSeekRequest = null;
  mockPlayerStore.playerMode = 'video';
  mockPlayerStore.currentSessionStepFrames = [];
  mockPlayerStore.hasCurrentSessionStepFrames = false;
});

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
});

function mountPlayer() {
  return mount(FloatingPlayer, {
    global: {
      plugins: [ArcoVue, i18n],
    },
  });
}

describe('FloatingPlayer (M4)', () => {
  it('renders the MJPEG live stream image with a LIVE badge in live mode', () => {
    mockPlayerStore.recordingPlaybackStatus = 'live';
    const wrapper = mountPlayer();
    const img = wrapper.find('.live-img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toContain('/api/stream/device-live');
    expect(wrapper.find('.live-badge').text()).toBe('LIVE');
    expect(wrapper.text()).toContain('设备实时画面');
  });

  it('shows the spinner and the i18n processing text while the recording is processing', () => {
    mockPlayerStore.recordingPlaybackStatus = 'processing';
    mockPlayerStore.playerMode = 'video';
    const wrapper = mountPlayer();
    expect(wrapper.find('.loading-state').exists()).toBe(true);
    expect(wrapper.find('.loading-state .spin-icon').exists()).toBe(true);
    expect(wrapper.text()).toContain('正在准备屏幕录像…');
  });

  it('prefers the backend passthrough message over the fixed i18n text', () => {
    mockPlayerStore.recordingPlaybackStatus = 'processing';
    mockPlayerStore.recordingPlaybackMessage = 'Finalizing segment 2/3';
    const wrapper = mountPlayer();
    expect(wrapper.find('.loading-state').text()).toContain('Finalizing segment 2/3');
  });

  it('shows the retry button on failure and calls retryVideoRecording on click', async () => {
    mockPlayerStore.recordingPlaybackStatus = 'failed';
    mockPlayerStore.playerMode = 'video';
    const wrapper = mountPlayer();
    expect(wrapper.find('.fallback').exists()).toBe(true);
    expect(wrapper.text()).toContain('录像播放失败');
    await wrapper.find('.retry-btn').trigger('click');
    expect(retryVideoRecording).toHaveBeenCalledTimes(1);
  });

  it('renders step replay with frame navigation and consumes stepSeekRequest', async () => {
    mockPlayerStore.recordingPlaybackStatus = 'ready';
    mockPlayerStore.playerMode = 'steps';
    mockPlayerStore.hasCurrentSessionStepFrames = true;
    mockPlayerStore.currentSessionStepFrames = [
      {
        index: 0,
        stepNumber: 1,
        stepId: 's1',
        title: 'Tapping Element',
        imageUrl: '/images/a.jpg',
        preImageUrl: '/images/a-pre.jpg',
        postImageUrl: '/images/a-post.jpg',
        action: { action: 'click', args: { target_description: '设置' } },
        actionText: 'Tapping Element',
        coords: '[319, 909]',
        status: 'dispatched',
      },
      {
        index: 1,
        stepNumber: 2,
        stepId: 's2',
        title: 'Swiping Up',
        imageUrl: '/images/b.jpg',
        preImageUrl: '/images/b-pre.jpg',
        action: { action: 'swipe', args: {} },
        actionText: 'Swiping Up',
        status: 'failed',
      },
    ];

    const wrapper = mountPlayer();
    await vi.waitFor(() => expect(wrapper.find('.step-replay').exists()).toBe(true));
    expect(wrapper.find('.time-display').text()).toBe('1 / 2');

    // 下一帧 → 2 / 2，且失败帧显示 failed 标记
    const buttons = wrapper.findAll('.controls-row .ctrl-btn');
    await buttons[2].trigger('click');
    await vi.waitFor(() => expect(wrapper.find('.time-display').text()).toBe('2 / 2'));
    expect(wrapper.find('.badge-status').text()).toContain('失败');

    // stepSeekRequest（requestId 变化）→ 跳回第一帧
    mockPlayerStore.stepSeekRequest = { index: 0, requestId: 1 };
    await nextTick();
    await vi.waitFor(() => expect(wrapper.find('.time-display').text()).toBe('1 / 2'));
  });

  it('consumes videoSeekRequest and seeks across segments on the session axis', async () => {
    mockPlayerStore.recordingPlaybackStatus = 'ready';
    mockPlayerStore.playerMode = 'video';
    mockPlayerStore.activeVideoUrl = '/videos/a.mp4';
    mockPlayerStore.activeVideoSegments = [
      { url: '/videos/a.mp4', start: 0, duration: 60, width: 1080, height: 2400 },
    ];
    const wrapper = mountPlayer();
    const video = wrapper.find('video').element as HTMLVideoElement;
    Object.defineProperty(video, 'readyState', { value: 1, configurable: true });

    mockPlayerStore.videoSeekRequest = { seconds: 30, requestId: 1 };
    await nextTick();
    // 会话轴 30s → 无 v2 offset 时按时间轴映射回第一段 30s
    await vi.waitFor(() => expect(video.currentTime).toBe(30));
  });

  it('seeks across segments: a time in the next segment switches the active segment', async () => {
    mockPlayerStore.recordingPlaybackStatus = 'ready';
    mockPlayerStore.playerMode = 'video';
    mockPlayerStore.activeVideoUrl = '/videos/a.mp4';
    mockPlayerStore.activeVideoSegments = [
      { url: '/videos/a.mp4', start: 0, duration: 10, width: 1080, height: 2400 },
      { url: '/videos/b.mp4', start: 10, duration: 20, width: 1080, height: 2400 },
    ];
    const wrapper = mountPlayer();
    const video = wrapper.find('video').element as HTMLVideoElement;
    Object.defineProperty(video, 'readyState', { value: 1, configurable: true });

    mockPlayerStore.videoSeekRequest = { seconds: 15, requestId: 1 };
    await nextTick();
    // 15s 落在第二段（localTime=5）：切 activeSegment → <video> src 换为 b.mp4，
    // pendingLocalTime 在该段 loadedmetadata 时应用（jsdom 无真实元数据事件）
    await vi.waitFor(() => expect(wrapper.find('video').attributes('src')).toBe('/videos/b.mp4'));
    expect(video).toBeDefined();
  });

  it('guides to step replay when the recording is unavailable but frames exist', async () => {
    mockPlayerStore.recordingPlaybackStatus = 'unavailable';
    mockPlayerStore.playerMode = 'video';
    mockPlayerStore.hasCurrentSessionStepFrames = true;
    mockPlayerStore.currentSessionStepFrames = [
      { index: 0, stepNumber: 1, stepId: 's1', title: 'Tapping', imageUrl: '/images/a.jpg' },
    ];
    const wrapper = mountPlayer();
    expect(wrapper.find('.fallback').exists()).toBe(true);
    expect(wrapper.text()).toContain('切换到步骤回放');
    await wrapper.find('.retry-btn').trigger('click');
    expect(setPlayerMode).toHaveBeenCalledWith('steps');
  });

  it('closes the player via the header close button', async () => {
    const wrapper = mountPlayer();
    await wrapper.find('.header-btn.close-btn').trigger('click');
    expect(mockPlayerStore.closeVideoPlayer).toHaveBeenCalledTimes(1);
  });
});

// ---- StepCard 局部测试：video_analysis 工具行 pill → openVideoPlayer ----

describe('StepCard video analysis pill (M4)', () => {
  function mountCard(tool: any) {
    return mount(StepCard, {
      props: {
        block: {
          id: 'b1',
          type: 'step',
          data: {
            generic_tools: [tool],
          },
        } as any,
        sessionActive: false,
      },
      global: {
        plugins: [ArcoVue, i18n],
      },
    });
  }

  it('opens the recording at the requested range when the pill is clicked', async () => {
    const tool = {
      trace_id: 'v1',
      type: 'tool',
      name: 'video_analysis',
      status: 'success',
      payload: {
        args: { start_time: 12, end_time: 30 },
        result: 'Analysis complete',
      },
    };
    const wrapper = mountCard(tool);
    const pill = wrapper.find('.video-pill');
    expect(pill.exists()).toBe(true);
    expect(pill.text()).toContain('00:12–00:30');
    await pill.trigger('click');
    expect(openVideoPlayer).toHaveBeenCalledWith('sess-1', undefined, undefined, 12);
  });
});
