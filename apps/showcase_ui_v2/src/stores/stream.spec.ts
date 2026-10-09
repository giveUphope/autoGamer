import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/services/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

import { apiGet } from '@/services/api';
import { useSessionStore } from './session';
import { useTimelineStore } from './timeline';
import { useStreamStore } from './stream';
import { DEFAULT_STREAM_RESET_MESSAGE } from '@/types/stream.model';

const apiGetMock = apiGet as unknown as Mock;

/**
 * jsdom 无 EventSource：注入可编程的 Fake，捕获 type→listener 映射与 onerror，
 * 暴露 emit() 驱动 SSE 事件；记录实例以断言 URL（/api/stream）与单例语义。
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onerror: ((err: unknown) => void) | null = null;
  private listeners = new Map<string, Array<(ev: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (ev: MessageEvent) => void): void {
    const arr = this.listeners.get(type) || [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }

  removeEventListener(): void {}

  close(): void {
    this.closed = true;
  }

  /** 模拟服务端推送：对象自动 JSON.stringify（与后端 SSE data 序列化一致）。 */
  emit(type: string, data: unknown): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener({ data: payload } as MessageEvent);
    }
  }
}

function lastInstance(): FakeEventSource {
  return FakeEventSource.instances[FakeEventSource.instances.length - 1];
}

function startStream(): { stream: ReturnType<typeof useStreamStore>; es: FakeEventSource } {
  const stream = useStreamStore();
  stream.start();
  return { stream, es: lastInstance() };
}

/** 按路径给出 GET 响应，未配置的路径返回 []（与 session.spec.ts 同风格）。 */
function mockApiRoutes(routes: Record<string, unknown>): void {
  apiGetMock.mockImplementation((url: string) =>
    Promise.resolve(structuredClone(routes[url] ?? [])),
  );
}

describe('stream store — llm_stream 合批与顺序保证（§3.3 条款 1）', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  it('同一 execution_id+stream_type 的多个 chunk 在一次 flush 后合并为一条日志、text 顺序拼接（80ms 前台定时）', () => {
    useSessionStore().selectSession('s1', false);
    const { es } = startStream();
    const timeline = useTimelineStore();

    es.emit('llm_stream', { execution_id: 'e1', stream_type: 'text', chunk: 'Hello' });
    es.emit('llm_stream', { execution_id: 'e1', stream_type: 'text', chunk: ' world' });
    expect(timeline.sessionLogs).toHaveLength(0); // 仍在缓冲

    vi.advanceTimersByTime(79);
    expect(timeline.sessionLogs).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(timeline.sessionLogs).toHaveLength(1);
    const log = timeline.sessionLogs[0];
    expect(log.type).toBe('llm_stream');
    expect(log.data.execution_id).toBe('e1');
    expect(log.data.stream_type).toBe('text');
    expect(log.data.text).toBe('Hello world');
    expect(log.data.isCompleted).toBe(false);
  });

  it('document.hidden=true 时合批延时 500ms', () => {
    useSessionStore().selectSession('s1', false);
    const { es } = startStream();
    const timeline = useTimelineStore();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });

    es.emit('llm_stream', { execution_id: 'e1', chunk: 'slow' });
    vi.advanceTimersByTime(80);
    expect(timeline.sessionLogs).toHaveLength(0);
    vi.advanceTimersByTime(420); // 累计 500ms
    expect(timeline.sessionLogs).toHaveLength(1);
    expect(timeline.sessionLogs[0].data.text).toBe('slow');

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('换道：不同 stream_type 各自成条；新 execution_id 只关闭同泳道的未完成流', () => {
    useSessionStore().selectSession('s1', false);
    const { es } = startStream();
    const timeline = useTimelineStore();
    const byExec = (id: string) => timeline.sessionLogs.filter((l) => l.data.execution_id === id);

    // thinking 与 text 各自成条
    es.emit('llm_stream', { execution_id: 'e1', stream_type: 'thinking', chunk: 'th' });
    es.emit('llm_stream', { execution_id: 'e1', stream_type: 'text', chunk: 'tx' });
    vi.advanceTimersByTime(80);
    expect(timeline.sessionLogs).toHaveLength(2);

    // 新 execution_id（同 stream_type、同 parent 泳道）关闭 e1-text，不动 e1-thinking
    es.emit('llm_stream', { execution_id: 'e2', stream_type: 'text', chunk: 'tx2' });
    vi.advanceTimersByTime(80);
    expect(byExec('e1').find((l) => l.data.stream_type === 'text')?.data.isCompleted).toBe(true);
    expect(byExec('e1').find((l) => l.data.stream_type === 'thinking')?.data.isCompleted).toBe(false);
    expect(byExec('e2')[0].data.isCompleted).toBe(false);

    // 不同泳道（parent_trace_id 不同）互不关闭
    es.emit('llm_stream', { execution_id: 'e3', stream_type: 'text', parent_trace_id: 'checker', chunk: 'c1' });
    vi.advanceTimersByTime(80);
    expect(byExec('e2')[0].data.isCompleted).toBe(false); // 无 parent 泳道仍开
    expect(byExec('e3')[0].data.isCompleted).toBe(false);

    es.emit('llm_stream', { execution_id: 'e4', stream_type: 'text', parent_trace_id: 'checker', chunk: 'c2' });
    vi.advanceTimersByTime(80);
    expect(byExec('e3')[0].data.isCompleted).toBe(true); // 同泳道被关闭
    expect(byExec('e4')[0].data.isCompleted).toBe(false);
    expect(byExec('e2')[0].data.isCompleted).toBe(false); // 异泳道不受影响
  });

  it('顺序：非流事件到达时缓冲文本先落库再追加事件日志，且缓冲不重复落库', () => {
    useSessionStore().selectSession('s1', false);
    const { es } = startStream();
    const timeline = useTimelineStore();

    es.emit('llm_stream', { execution_id: 'e1', chunk: 'buffered text' });
    es.emit('step_recorded', { step_id: 'st1', session_id: 's1', timestamp: 100 });

    expect(timeline.sessionLogs.map((l) => l.type)).toEqual(['llm_stream', 'step_recorded']);
    expect(timeline.sessionLogs[0].data.text).toBe('buffered text');
    // 非流事件落库时未完成的流被标记结束
    expect(timeline.sessionLogs[0].data.isCompleted).toBe(true);

    vi.advanceTimersByTime(500);
    expect(timeline.sessionLogs).toHaveLength(2); // 缓冲已随 flush 清空
  });
});

describe('stream store — llm_stream_reset / llm_retrying', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  it('llm_stream_reset：缓冲文本不残留未重置状态；已有日志标记 isReset/resetMessage', () => {
    useSessionStore().selectSession('s1', false);
    const { stream, es } = startStream();
    const timeline = useTimelineStore();

    es.emit('llm_stream', { execution_id: 'e1', chunk: 'partial' });
    es.emit('llm_stream_reset', { stream_exec_id: 'e1', session_id: 's1', step_id: 'st1' });

    expect(timeline.sessionLogs).toHaveLength(1);
    expect(timeline.sessionLogs[0].data.text).toBe('partial');
    expect(timeline.sessionLogs[0].data.isReset).toBe(true);
    expect(timeline.sessionLogs[0].data.resetMessage).toBe(DEFAULT_STREAM_RESET_MESSAGE);
    expect(stream.streamResetEvent?.stream_exec_id).toBe('e1');
    expect(stream.streamResetEvent?.message).toBe(DEFAULT_STREAM_RESET_MESSAGE);
    expect(stream.streamResetEvent?.action).toBe('discard');
    expect(stream.streamResetEvent?.reason).toBe('mid_stream_failure');

    vi.advanceTimersByTime(500);
    expect(timeline.sessionLogs).toHaveLength(1); // pending 已清空
  });

  it('llm_stream_reset：无已有日志时追加合成重置日志，streamResetEvent 兼容 stream_execution_id 字段', () => {
    useSessionStore().selectSession('s1', false);
    const { stream, es } = startStream();
    const timeline = useTimelineStore();

    es.emit('llm_stream_reset', { stream_execution_id: 'e9', session_id: 's1' });

    expect(timeline.sessionLogs).toHaveLength(1);
    const synth = timeline.sessionLogs[0];
    expect(synth.type).toBe('llm_stream');
    expect(synth.data.execution_id).toBe('e9');
    expect(synth.data.text).toBe('');
    expect(synth.data.isCompleted).toBe(false);
    expect(synth.data.isReset).toBe(true);
    expect(synth.data.resetMessage).toBe(DEFAULT_STREAM_RESET_MESSAGE);
    expect(stream.streamResetEvent?.stream_execution_id).toBe('e9');
  });

  it('llm_retrying：isRetrying/retryInfo 置位并追加重试 trace；同 request_id+scheduled_at 替换不新增', () => {
    useSessionStore().selectSession('s1', false);
    const { stream, es } = startStream();
    const timeline = useTimelineStore();

    const retryEvent = {
      session_id: 's1',
      attempt: 2,
      max_retries: 5,
      delay: 1.5,
      request_id: 'req-1',
      scheduled_at: 1700000000,
      timestamp: 1700000000,
      error: 'rate limited',
    };
    es.emit('llm_retrying', retryEvent);

    expect(stream.isRetrying).toBe(true);
    expect(stream.retryInfo).toEqual({ attempt: 2, max_retries: 5, delay: 1.5 });

    const traces = timeline.sessionLogs.filter((l) => l.type === 'trace_recorded');
    expect(traces).toHaveLength(1);
    expect(traces[0].data.trace_id).toBe('llm-retry-live-req-1-1700000000');
    expect(traces[0].data.name).toBe('llm_retry');
    expect(traces[0].data.type).toBe('llm_call');
    expect(traces[0].data.status).toBe('retrying');
    expect(traces[0].data.payload.request_id).toBe('req-1');

    es.emit('llm_retrying', { ...retryEvent, attempt: 3 });
    const afterRetry = timeline.sessionLogs.filter((l) => l.type === 'trace_recorded');
    expect(afterRetry).toHaveLength(1); // 原位替换
    expect(afterRetry[0].data.payload.attempt).toBe(3);

    // 收到 step 事件后 isRetrying 复位
    es.emit('step_updated', { session_id: 's1', step_id: 'st1' });
    expect(stream.isRetrying).toBe(false);
  });
});

describe('stream store — task_paused / task_resumed', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  function primePausedSession(): void {
    const session = useSessionStore();
    session.$patch({
      rawSessions: [{ session_id: 's1', status: 'running', initial_goal: 'g', start_time: 1 }],
      runningSessionId: 's1',
    });
    session.selectSession('s1', false);
  }

  it('task_paused：置暂停态并合成暂停卡；同 session+error 二次事件不重复追加', () => {
    primePausedSession();
    const { stream, es } = startStream();
    const session = useSessionStore();
    const timeline = useTimelineStore();

    es.emit('task_paused', { session_id: 's1', error: 'boom', timestamp: 1700000000, step_id: 'st9' });

    expect(session.isPaused).toBe(true);
    expect(stream.isRetrying).toBe(false);
    expect(session.agentStatus).toBe('paused');
    expect(session.pausedError).toBe('boom');
    expect(session.runningSessionId).toBe('s1');
    expect(session.rawSessions[0].status).toBe('paused');

    const cards = timeline.sessionLogs.filter((l) => l.type === 'trace_recorded');
    expect(cards).toHaveLength(1);
    expect(cards[0].data.name).toBe('llm_pause');
    expect(cards[0].data.type).toBe('llm_call');
    expect(cards[0].data.status).toBe('failed');
    expect(cards[0].data.payload.error).toBe('boom');
    expect(cards[0].data.step_id).toBe('st9');
    expect(cards[0].data.trace_id).toBe('task-paused-s1-1700000000000');

    es.emit('task_paused', { session_id: 's1', error: 'boom', timestamp: 1700000001 });
    expect(timeline.sessionLogs.filter((l) => l.type === 'trace_recorded')).toHaveLength(1);
  });

  it('task_paused：已存在同错误的 failed llm_call trace 时不追加', () => {
    primePausedSession();
    const { es } = startStream();
    const session = useSessionStore();
    const timeline = useTimelineStore();
    timeline.sessionLogs = [{
      type: 'trace_recorded',
      timestamp: new Date().toISOString(),
      session_id: 's1',
      data: { type: 'llm_call', status: 'failed', payload: { error: 'boom' } },
    }];

    es.emit('task_paused', { session_id: 's1', error: 'boom' });

    expect(timeline.sessionLogs).toHaveLength(1);
    expect(session.pausedError).toBe('boom');
    expect(session.agentStatus).toBe('paused');
  });

  it('task_resumed：复位暂停态并在 runningSessionId 匹配时置 running；暂停卡键清空后可再次成卡', () => {
    primePausedSession();
    const { es } = startStream();
    const session = useSessionStore();
    const timeline = useTimelineStore();

    es.emit('task_paused', { session_id: 's1', error: 'boom' });
    es.emit('task_resumed', { session_id: 's1' });

    expect(session.isPaused).toBe(false);
    expect(session.pausedError).toBeNull();
    expect(session.agentStatus).toBe('running');
    expect(session.rawSessions[0].status).toBe('running');

    // 暂停卡键已随 resume 清空：清掉旧日志后同样的错误再次暂停会再次追加
    timeline.sessionLogs = [];
    es.emit('task_paused', { session_id: 's1', error: 'boom' });
    expect(timeline.sessionLogs.filter((l) => l.type === 'trace_recorded')).toHaveLength(1);
  });
});

describe('stream store — session_started / session_ended', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  it('session_started：更新运行状态与目标；未 pin 时自动跟随', () => {
    const session = useSessionStore();
    const { es } = startStream();

    es.emit('session_started', { session_id: 'new-s', initial_goal: 'Do things' });

    expect(session.agentStatus).toBe('running');
    expect(session.runningSessionId).toBe('new-s');
    expect(session.runningGoal).toBe('Do things');
    expect(session.currentSessionId).toBe('new-s');
  });

  it('session_started：用户已 pin 时不抢走当前选择', () => {
    const session = useSessionStore();
    session.$patch({ userPinnedSessionId: 'pinned', currentSessionId: 'pinned' });
    const { es } = startStream();

    es.emit('session_started', { session_id: 'new-s', initial_goal: 'g' });

    expect(session.runningSessionId).toBe('new-s');
    expect(session.currentSessionId).toBe('pinned');
  });

  it('session_started：他线程的任务启动不得换走当前线程视图（提交目标不被换走）', () => {
    // 「消息进入错误会话队列」的 SSE 路径：用户正在 conv-a 对话，他线程 X 的
    // 任务启动把视图（含 currentConversationId）拽到 X，下一条消息就会误入 X。
    const session = useSessionStore();
    session.$patch({
      rawSessions: [
        {
          session_id: 'a-row',
          initial_goal: 'A 的历史轮',
          conversation_id: 'conv-a',
          start_time: 1,
          status: 'completed',
        },
      ],
    });
    session.selectSession('a-row', false); // 未 pin：纯查看状态
    const { es } = startStream();

    es.emit('session_started', { session_id: 'x-run-sid', initial_goal: 'X 任务' });

    // 运行状态照常同步，但视图与提交目标留在原线程
    expect(session.runningSessionId).toBe('x-run-sid');
    expect(session.currentSessionId).toBe('a-row');
    expect(session.currentConversationId).toBe('conv-a');
    expect(session.submitConversationId).toBe('conv-a');
  });

  it('session_started：当前线程内的任务启动照常跟随', () => {
    const session = useSessionStore();
    session.$patch({
      rawSessions: [
        {
          session_id: 'a-row',
          initial_goal: 'A 的历史轮',
          conversation_id: 'conv-a',
          start_time: 1,
          status: 'completed',
        },
      ],
      pendingQueue: [
        {
          session_id: 'a-run-sid',
          initial_goal: 'A 的新轮',
          start_time: 2,
          status: 'pending',
          conversation_id: 'conv-a',
        },
      ],
    });
    session.selectSession('a-row', false);
    const { es } = startStream();

    es.emit('session_started', { session_id: 'a-run-sid', initial_goal: 'A 的新轮' });

    expect(session.currentSessionId).toBe('a-run-sid');
    expect(session.submitConversationId).toBe('conv-a');
  });

  it('session_ended：status 映射三态（cancelled / failed / completed），未知状态不映射', () => {
    const session = useSessionStore();
    session.$patch({
      rawSessions: ['a', 'b', 'c', 'd'].map((id) => ({
        session_id: id,
        status: 'running',
        initial_goal: 'g',
        start_time: 1,
      })),
    });
    const { es } = startStream();

    es.emit('session_ended', { session_id: 'a', status: 'failed' });
    es.emit('session_ended', { session_id: 'b', was_stopped_manually: true, status: 'running' });
    es.emit('session_ended', { session_id: 'c', status: 'success' });
    es.emit('session_ended', { session_id: 'd', status: 'weird' });

    expect(session.rawSessions.find((s) => s.session_id === 'a')?.status).toBe('failed');
    expect(session.rawSessions.find((s) => s.session_id === 'b')?.status).toBe('cancelled');
    expect(session.rawSessions.find((s) => s.session_id === 'c')?.status).toBe('completed');
    expect(session.rawSessions.find((s) => s.session_id === 'd')?.status).toBe('running');
  });

  it('session_ended：activeTasks 剔除、剩余任务提升 running、回查 sessions/status、当前会话回查 checks', () => {
    const session = useSessionStore();
    session.$patch({
      rawSessions: [
        { session_id: 's1', status: 'running', initial_goal: 'g1', start_time: 1 },
        { session_id: 's2', status: 'running', initial_goal: 'g2', start_time: 2 },
      ],
      activeTasks: [{ session_id: 's1', goal: 'g1' }, { session_id: 's2', goal: 'g2' }],
      runningSessionId: 's1',
      runningGoal: 'g1',
      currentSessionId: 's1',
    });
    const { es } = startStream();

    es.emit('session_ended', { session_id: 's1', status: 'completed' });

    expect(session.rawSessions.find((s) => s.session_id === 's1')?.status).toBe('completed');
    expect(session.activeTasks.map((at) => at.session_id)).toEqual(['s2']);
    // 剩余 activeTasks → 全局保持 running 并切换到 s2
    expect(session.agentStatus).toBe('running');
    expect(session.runningSessionId).toBe('s2');
    expect(session.runningGoal).toBe('g2');
    expect(session.isPaused).toBe(false);

    expect(apiGetMock).toHaveBeenCalledWith('/api/sessions');
    expect(apiGetMock).toHaveBeenCalledWith('/api/status');
    expect(apiGetMock).toHaveBeenCalledWith('/api/sessions/s1/notes');
    expect(apiGetMock).toHaveBeenCalledWith('/api/sessions/s1/checks');
  });

  it('session_ended：无剩余 activeTasks 时回 idle，排队轮不得被提升为运行态', () => {
    // 队列被熔断挂起时（本轮结束、下一轮尚未派发），把队首 pending 轮标成
    // running 会让它所属的其他会话平白显示「运行中」，还会把排队轮渲染成
    // 空运行轮。运行态只属于真正在跑的 activeTasks。
    const session = useSessionStore();
    session.$patch({
      activeTasks: [{ session_id: 's1', goal: 'g1' }],
      pendingQueue: [{ session_id: 'q1', initial_goal: 'queued goal', start_time: 1, status: 'pending' }],
      runningSessionId: 's1',
      agentStatus: 'running',
    });
    const { es } = startStream();

    es.emit('session_ended', { session_id: 's1', status: 'completed' });
    // pending 队列虽非空，但没有真正在跑的任务 → 全局回 idle
    expect(session.agentStatus).toBe('idle');
    expect(session.runningSessionId).toBeNull();
    expect(session.runningGoal).toBeNull();
    // pending 轮保持排队态，不被标成 running
    expect(session.sessions.find((s) => s.session_id === 'q1')?.status).toBe('pending');

    // 全空同样回 idle
    session.$patch({ pendingQueue: [] });
    es.emit('session_ended', { session_id: 'q1', status: 'completed' });
    expect(session.agentStatus).toBe('idle');
    expect(session.runningSessionId).toBeNull();
    expect(session.runningGoal).toBeNull();
  });
});

describe('stream store — 会话过滤与日志事件', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  it('会话过滤：其他会话的日志事件不入 sessionLogs', () => {
    useSessionStore().selectSession('s1', false);
    const { es } = startStream();
    const timeline = useTimelineStore();

    es.emit('trace_recorded', { session_id: 'other', trace_id: 't1', name: 'x' });
    es.emit('step_recorded', { session_id: 'other', step_id: 'st' });

    expect(timeline.sessionLogs).toHaveLength(0);
  });

  it('trace_recorded：同 trace_id 原位替换不新增；note 工具 trace 触发 fetchNotes', () => {
    useSessionStore().selectSession('s1', false);
    const { es } = startStream();
    const timeline = useTimelineStore();

    es.emit('trace_recorded', { session_id: 's1', trace_id: 't1', name: 'action', status: 'running', timestamp: 100 });
    es.emit('trace_recorded', { session_id: 's1', trace_id: 't1', name: 'action', status: 'done', timestamp: 200 });

    expect(timeline.sessionLogs).toHaveLength(1);
    expect(timeline.sessionLogs[0].data.status).toBe('done');
    expect(timeline.sessionLogs[0].timestamp).toBe(new Date(200 * 1000).toISOString());

    apiGetMock.mockClear();
    es.emit('trace_recorded', { session_id: 's1', trace_id: 't2', name: 'save_note' });
    expect(apiGetMock).toHaveBeenCalledWith('/api/sessions/s1/notes');
  });

  it('info：对当前会话触发 steps 快照回填（断线重连对账）', () => {
    useSessionStore().selectSession('s1', false);
    const { es } = startStream();

    es.emit('info', { message: 'subscribed' });

    expect(apiGetMock).toHaveBeenCalledWith('/api/sessions/s1/steps');
  });
});

describe('stream store — startup_progress 与停止语义', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  it('startup_progress：合入对应会话桶且按 stage 幂等；未 pin 且异会话时自动跟随', () => {
    const session = useSessionStore();
    session.$patch({ currentSessionId: 's1' });
    const { es } = startStream();
    const timeline = useTimelineStore();

    es.emit('startup_progress', { session_id: 'sX', stage: 'device_check', message: 'checking', timestamp: 1 });
    es.emit('startup_progress', { session_id: 'sX', stage: 'device_check', message: 'checking again', timestamp: 2 });
    es.emit('startup_progress', { session_id: 'sX', stage: 'device_ready', message: 'ready', timestamp: 3 });

    expect(timeline.startupProgressBySession['sX']).toHaveLength(2); // 同 stage 幂等
    expect(timeline.startupProgressBySession['sX'][0].message).toBe('checking');
    // 未 pin 且异会话 → 自动跟随
    expect(session.agentStatus).toBe('running');
    expect(session.runningSessionId).toBe('sX');
    expect(session.currentSessionId).toBe('sX');
  });

  it('startup_progress：已 pin 时不跟随', () => {
    const session = useSessionStore();
    session.$patch({ currentSessionId: 's1', userPinnedSessionId: 's1' });
    const { es } = startStream();

    es.emit('startup_progress', { session_id: 'sX', stage: 'device_check', message: 'm', timestamp: 1 });

    expect(session.currentSessionId).toBe('s1');
  });

  it('markStoppedSessionStreamsCompleted：flush 缓冲并把未完成流全部置 isCompleted；无未完成流时不产生新引用', () => {
    useSessionStore().selectSession('s1', false);
    const { stream, es } = startStream();
    const timeline = useTimelineStore();

    es.emit('llm_stream', { execution_id: 'e1', chunk: 'a' });
    es.emit('llm_stream', { execution_id: 'e2', stream_type: 'thinking', chunk: 'b' });
    stream.markStoppedSessionStreamsCompleted();

    expect(timeline.sessionLogs).toHaveLength(2);
    expect(timeline.sessionLogs.every((l) => l.data.isCompleted)).toBe(true);

    const before = timeline.sessionLogs;
    stream.markStoppedSessionStreamsCompleted();
    expect(timeline.sessionLogs).toBe(before);
  });
});

describe('stream store — 连接管理', () => {
  beforeEach(startEnv);
  afterEach(stopEnv);

  it('start 创建 /api/stream 单通道连接且幂等；stop 关闭并清空缓冲', () => {
    const { stream, es } = startStream();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(es.url).toBe('/api/stream');

    stream.start(); // 幂等：重复调用不重建连接
    expect(FakeEventSource.instances).toHaveLength(1);

    es.emit('llm_stream', { execution_id: 'e1', chunk: 'x' }); // 进入缓冲
    stream.stop();
    expect(es.closed).toBe(true);

    // 缓冲随 stop 清空：定时器不再触发落库
    vi.advanceTimersByTime(500);
    expect(useTimelineStore().sessionLogs).toHaveLength(0);

    stream.start();
    expect(FakeEventSource.instances).toHaveLength(2);
  });
});

/** 每个用例的公共环境：新 Pinia、注入 FakeEventSource、fake timers。 */
function startEnv(): void {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mockApiRoutes({});
  // 线程键持久化在 localStorage：前序用例的 selectSession 会写入 'round:s1'，
  // 泄漏进后续用例会让自动跟随守卫把它当成"正在查看的线程"
  localStorage.clear();
  FakeEventSource.instances = [];
  (globalThis as Record<string, unknown>).EventSource = FakeEventSource;
  vi.useFakeTimers();
}

function stopEnv(): void {
  useStreamStore().stop();
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).EventSource;
}
