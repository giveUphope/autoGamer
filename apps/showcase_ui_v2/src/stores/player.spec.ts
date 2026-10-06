import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/services/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

import { apiGet } from '@/services/api';
import { usePlayerStore } from './player';
import { useSessionStore } from './session';
import { useTimelineStore, type SessionLog } from './timeline';
import type { Session } from '@/types/session.model';

const apiGetMock = apiGet as unknown as Mock;

/** 按路径给出 GET 响应，未配置的路径返回 []（与 session.spec.ts 同风格）。 */
function mockApiRoutes(routes: Record<string, unknown>): void {
  apiGetMock.mockImplementation((url: string) =>
    Promise.resolve(structuredClone(routes[url] ?? [])),
  );
}

/** requestSessionVideo 的响应经 .then 微任务落库；10 轮足够链式微任务排空。 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function completed(id: string): Session {
  return { session_id: id, status: 'completed', initial_goal: `Goal ${id}`, start_time: 1 };
}

function running(id: string): Session {
  return { session_id: id, status: 'running', initial_goal: `Goal ${id}`, start_time: 2 };
}

function processingPayload(retryAfterMs: number): Record<string, unknown> {
  return {
    session_id: 'x',
    status: 'processing',
    has_video: false,
    video_url: null,
    video_segments: [],
    retry_after_ms: retryAfterMs,
  };
}

function readyPayload(url: string): Record<string, unknown> {
  return {
    session_id: 'x',
    status: 'ready',
    has_video: true,
    video_url: url,
    video_segments: [
      { url: 'http://media/seg0.mp4', start: 0, duration: 5, width: 1080, height: 2400 },
    ],
  };
}

/** 产生一个回放帧的最小步进日志（pre_image_name 经 formatImageUrl 可解析）。 */
function stepLog(stepId: string, stepNumber: number, imageName: string): SessionLog {
  return {
    type: 'step_updated',
    timestamp: new Date().toISOString(),
    session_id: 's1',
    data: { step_id: stepId, step_number: stepNumber, pre_image_name: imageName },
  };
}

describe('player store — openVideoPlayer', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  it('running/paused 会话 → live 态，不发起录像轮询', () => {
    useSessionStore().$patch({ rawSessions: [running('s-live')] });
    const player = usePlayerStore();

    player.openVideoPlayer('s-live');

    expect(player.isVideoWindowOpen).toBe(true);
    expect(player.isVideoMinimized).toBe(false);
    expect(player.recordingPlaybackStatus).toBe('live');
    expect(player.isVideoLoading).toBe(false);
    expect(player.activeVideoUrl).toBeNull();
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it('历史会话无 video_url → processing + 轮询启动', () => {
    useSessionStore().$patch({ rawSessions: [completed('s1')] });
    const player = usePlayerStore();

    player.openVideoPlayer('s1');

    expect(player.recordingPlaybackStatus).toBe('processing');
    expect(player.isVideoLoading).toBe(true);
    expect(player.activeVideoUrl).toBeNull();
    expect(player.shouldAutoplayVideo).toBe(true);
    expect(apiGetMock).toHaveBeenCalledWith('/api/sessions/s1/video');
  });

  it('无 video_url 但当前会话有 step frames → playerMode 预置 steps（Angular L1824-1828）', () => {
    const timeline = useTimelineStore();
    timeline.sessionLogs = [stepLog('st1', 1, '/pre.jpg')];
    useSessionStore().$patch({ rawSessions: [completed('s1')] });
    const player = usePlayerStore();

    expect(player.hasCurrentSessionStepFrames).toBe(true);
    player.openVideoPlayer('s1');

    expect(player.playerMode).toBe('steps');
    expect(player.recordingPlaybackStatus).toBe('processing');
  });
});

describe('player store — requestSessionVideo 四态', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  it('ready：segments 落库、url 更新，并同步 session store rawSessions（Angular L1892-1896）', async () => {
    mockApiRoutes({
      '/api/sessions/s1/video': readyPayload('http://media/v.mp4?v=1'),
    });
    const session = useSessionStore();
    session.$patch({ rawSessions: [completed('s1')] });
    const player = usePlayerStore();

    player.openVideoPlayer('s1');
    await flushMicrotasks();

    expect(player.recordingPlaybackStatus).toBe('ready');
    expect(player.activeVideoUrl).toBe('http://media/v.mp4?v=1');
    expect(player.activeVideoSegments).toHaveLength(1);
    expect(player.isVideoLoading).toBe(false);
    expect(player.recordingPlaybackMessage).toBe('');
    expect(player.playerMode).toBe('video');
    expect(session.rawSessions.find((s) => s.session_id === 's1')?.video_url).toBe('http://media/v.mp4?v=1');
    expect(session.rawSessions.find((s) => s.session_id === 's1')?.recording_status).toBe('ready');
  });

  it('processing：按 retry_after_ms 重试并钳制到 [500, 3000]ms', async () => {
    const session = useSessionStore();
    session.$patch({ rawSessions: [completed('s1'), completed('s2')] });
    const player = usePlayerStore();

    // 钳制下限：retry_after_ms=100 → 500ms 后才重试
    mockApiRoutes({ '/api/sessions/s1/video': processingPayload(100) });
    player.openVideoPlayer('s1');
    await flushMicrotasks();
    expect(apiGetMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(apiGetMock).toHaveBeenCalledTimes(2);

    // 钳制上限：retry_after_ms=99999 → 3000ms 后才重试（打开新会话会取消旧重试链）
    mockApiRoutes({ '/api/sessions/s2/video': processingPayload(99999) });
    player.openVideoPlayer('s2');
    await flushMicrotasks();
    const callsAfterOpen = apiGetMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(2999);
    expect(apiGetMock.mock.calls.length).toBe(callsAfterOpen);
    await vi.advanceTimersByTimeAsync(1);
    expect(apiGetMock.mock.calls.length).toBe(callsAfterOpen + 1);
  });

  it('failed：message 透传；unavailable 无 message 时为空（文案由 UI i18n）；有帧时 playerMode 转 steps', async () => {
    const timeline = useTimelineStore();
    timeline.sessionLogs = [stepLog('st1', 1, '/pre.jpg')];
    useSessionStore().$patch({ rawSessions: [completed('s1'), completed('s3')] });
    const player = usePlayerStore();

    mockApiRoutes({
      '/api/sessions/s1/video': {
        session_id: 's1', status: 'failed', has_video: false, video_url: null,
        video_segments: [], message: 'boom finalization',
      },
    });
    player.openVideoPlayer('s1');
    await flushMicrotasks();

    expect(player.recordingPlaybackStatus).toBe('failed');
    expect(player.recordingPlaybackMessage).toBe('boom finalization');
    expect(player.isVideoLoading).toBe(false);
    expect(player.activeVideoUrl).toBeNull();
    expect(player.playerMode).toBe('steps');

    mockApiRoutes({
      '/api/sessions/s3/video': {
        session_id: 's3', status: 'unavailable', has_video: false, video_url: null, video_segments: [],
      },
    });
    player.openVideoPlayer('s3');
    await flushMicrotasks();

    expect(player.recordingPlaybackStatus).toBe('unavailable');
    expect(player.recordingPlaybackMessage).toBe('');
  });

  it('HTTP 错误且 processing 中 → 1s 后重试而不判死', async () => {
    apiGetMock.mockRejectedValue(new Error('network down'));
    useSessionStore().$patch({ rawSessions: [completed('s1')] });
    const player = usePlayerStore();

    player.openVideoPlayer('s1');
    await flushMicrotasks();

    expect(player.recordingPlaybackStatus).toBe('processing');
    expect(apiGetMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(apiGetMock).toHaveBeenCalledTimes(2);
  });
});

describe('player store — 120s 超时', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  it('推进 fake timers 跨过 120s → failed（超时文案由 UI 按 status i18n）', async () => {
    mockApiRoutes({ '/api/sessions/s1/video': processingPayload(3000) });
    useSessionStore().$patch({ rawSessions: [completed('s1')] });
    const player = usePlayerStore();

    player.openVideoPlayer('s1');
    await flushMicrotasks();
    expect(player.recordingPlaybackStatus).toBe('processing');

    let guard = 0;
    while (player.recordingPlaybackStatus === 'processing' && guard < 60) {
      await vi.advanceTimersByTimeAsync(3000);
      guard += 1;
    }

    expect(player.recordingPlaybackStatus).toBe('failed');
    expect(player.isVideoLoading).toBe(false);
    expect(player.recordingPlaybackMessage).toBe('');
    // 120s 内一直在 3s 节奏上重试（约 41 轮），未提前放弃
    expect(guard).toBeLessThanOrEqual(45);
    expect(apiGetMock.mock.calls.length).toBeGreaterThanOrEqual(40);
  });
});

describe('player store — generation 守卫', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  /** apiGet 返回手工 resolve 的挂起 Promise，按调用顺序捕获。 */
  function pendingResponses(): Array<(v: unknown) => void> {
    const resolvers: Array<(v: unknown) => void> = [];
    apiGetMock.mockImplementation(() => {
      return new Promise((resolve) => {
        resolvers.push(resolve);
      });
    });
    return resolvers;
  }

  it('openVideoPlayer 二次调用后旧 generation 的响应不落库', async () => {
    useSessionStore().$patch({ rawSessions: [completed('s1')] });
    const player = usePlayerStore();
    const resolvers = pendingResponses();

    player.openVideoPlayer('s1'); // gen1
    player.openVideoPlayer('s1'); // gen2（守卫递增）
    expect(apiGetMock).toHaveBeenCalledTimes(2);

    resolvers[0](readyPayload('http://old/v.mp4'));
    await flushMicrotasks();
    expect(player.activeVideoUrl).toBeNull();
    expect(player.recordingPlaybackStatus).toBe('processing');

    resolvers[1](readyPayload('http://new/v.mp4'));
    await flushMicrotasks();
    expect(player.activeVideoUrl).toBe('http://new/v.mp4');
    expect(player.recordingPlaybackStatus).toBe('ready');
  });

  it('closeVideoPlayer 后响应不落库', async () => {
    useSessionStore().$patch({ rawSessions: [completed('s1')] });
    const player = usePlayerStore();
    const resolvers = pendingResponses();

    player.openVideoPlayer('s1');
    player.closeVideoPlayer();
    expect(player.isVideoWindowOpen).toBe(false);

    resolvers[0](readyPayload('http://x/v.mp4'));
    await flushMicrotasks();
    expect(player.activeVideoUrl).toBeNull();
    expect(player.recordingPlaybackStatus).toBe('processing');
  });
});

describe('player store — beginRecordingFinalization', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  it('非 active 会话直接 return（不请求、不改状态）', () => {
    useSessionStore().$patch({ rawSessions: [completed('s1')] });
    const player = usePlayerStore();

    player.beginRecordingFinalization('s1');

    expect(apiGetMock).not.toHaveBeenCalled();
    expect(player.recordingPlaybackStatus).toBe('idle');
    expect(player.isVideoLoading).toBe(false);
  });

  it('active 会话：重置 url/segments、置 processing + autoplay 并重新轮询', async () => {
    const session = useSessionStore();
    session.$patch({
      rawSessions: [completed('s1'), running('s-live')],
      agentStatus: 'running',
      runningSessionId: 's-live',
    });
    const player = usePlayerStore();

    player.openVideoPlayer('s-live');
    expect(player.recordingPlaybackStatus).toBe('live');
    expect(apiGetMock).not.toHaveBeenCalled();

    mockApiRoutes({ '/api/sessions/s-live/video': processingPayload(750) });
    player.beginRecordingFinalization('s-live');

    expect(player.recordingPlaybackStatus).toBe('processing');
    expect(player.isVideoLoading).toBe(true);
    expect(player.shouldAutoplayVideo).toBe(true);
    expect(player.activeVideoUrl).toBeNull();
    expect(player.activeVideoSegments).toEqual([]);
    expect(apiGetMock).toHaveBeenCalledWith('/api/sessions/s-live/video');

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(750);
    expect(
      apiGetMock.mock.calls.filter((c) => c[0] === '/api/sessions/s-live/video').length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('player store — autoplay / seek 契约', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  it('consumeVideoAutoplay 消费后复位；requestVideoSeek/requestStepSeek 的 requestId 递增', () => {
    useSessionStore().$patch({ rawSessions: [completed('s1')] });
    const player = usePlayerStore();

    expect(player.consumeVideoAutoplay()).toBe(false);
    player.openVideoPlayer('s1');
    expect(player.shouldAutoplayVideo).toBe(true);
    expect(player.consumeVideoAutoplay()).toBe(true);
    expect(player.shouldAutoplayVideo).toBe(false);
    expect(player.consumeVideoAutoplay()).toBe(false);

    player.requestVideoSeek(5);
    expect(player.videoSeekRequest).toEqual({ seconds: 5, requestId: 1 });
    player.requestVideoSeek(Number.NaN); // 非 finite 忽略
    expect(player.videoSeekRequest).toEqual({ seconds: 5, requestId: 1 });
    player.requestVideoSeek(-3); // 钳制为 0
    expect(player.videoSeekRequest).toEqual({ seconds: 0, requestId: 2 });

    player.requestStepSeek(7);
    expect(player.stepSeekRequest).toEqual({ index: 7, requestId: 1 });
    player.requestStepSeek(9);
    expect(player.stepSeekRequest).toEqual({ index: 9, requestId: 2 });
  });
});

describe('player store — currentSessionStepFrames 引用稳定语义', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  it('llm_stream 日志到达不触发帧重提取（等价 Angular stepLogsForReplay 的自定义 equal）', () => {
    const timeline = useTimelineStore();
    const player = usePlayerStore();

    timeline.sessionLogs = [stepLog('st1', 1, '/pre.jpg')];
    const frames1 = player.currentSessionStepFrames;
    expect(frames1).toHaveLength(1);

    // 追加 llm_stream：sessionLogs 引用变化，但步进日志子列（长度 + 逐元素引用）不变
    timeline.sessionLogs = [...timeline.sessionLogs, {
      type: 'llm_stream',
      timestamp: new Date().toISOString(),
      data: { execution_id: 'e1', text: 'hello', stream_type: 'text', isCompleted: false },
    }];
    const frames2 = player.currentSessionStepFrames;
    expect(frames2).toBe(frames1);

    // 新步进日志到达 → 重提取
    timeline.sessionLogs = [...timeline.sessionLogs, stepLog('st2', 2, '/pre2.jpg')];
    const frames3 = player.currentSessionStepFrames;
    expect(frames3).not.toBe(frames1);
    expect(frames3).toHaveLength(2);
  });
});

/** 每个用例的公共环境：新 Pinia、fake timers（覆盖 Date.now）。 */
function startEnv(): void {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mockApiRoutes({});
  vi.useFakeTimers();
}

function stopEnv(): void {
  vi.useRealTimers();
}
