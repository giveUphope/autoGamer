import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/services/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiGet, apiPost } from '@/services/api';
import { useSessionStore } from './session';
import { useSystemStore } from './system';

const apiGetMock = apiGet as unknown as Mock;
const apiPostMock = apiPost as unknown as Mock;

const SESSIONS_KEY = 'artemis.sessions.v1';

function statusPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'idle',
    session_id: null,
    goal: null,
    queue: [],
    active_tasks: [],
    ...overrides,
  };
}

/** 按路径给出 GET 响应，未配置的路径返回 []。每次调用深拷贝，保证引用每次都不同。 */
function mockApiRoutes(routes: Record<string, unknown>): void {
  apiGetMock.mockImplementation((url: string) =>
    Promise.resolve(structuredClone(routes[url] ?? [])),
  );
}

/** 生成一个可手工 resolve 的挂起 POST，用于验证乐观更新（后端响应返回前的本地状态）。 */
function pendingPost(): { promise: Promise<unknown>; resolve: (v: unknown) => void } {
  let resolve!: (v: unknown) => void;
  const promise = new Promise<unknown>((r) => {
    resolve = r;
  });
  apiPostMock.mockReturnValue(promise);
  return { promise, resolve };
}

/** 平移自 agent.service.spec.ts 的用例 + 针对平移算法（合并/签名/轮询）的补充用例。 */
describe('session store — 停止 / 恢复 / 提交（用例平移自 agent.service.spec.ts）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
    mockApiRoutes({});
    apiPostMock.mockResolvedValue({});
  });

  it('stops a specific session by passing its session_id（平移：另一个任务仍在运行时全局状态不置 idle）', async () => {
    const store = useSessionStore();
    store.$patch({
      rawSessions: [
        { session_id: 'sess-1', status: 'running', initial_goal: 'Goal 1', start_time: 1 },
        { session_id: 'sess-2', status: 'running', initial_goal: 'Goal 2', start_time: 2 },
      ],
      activeTasks: [{ session_id: 'sess-1' }, { session_id: 'sess-2' }],
      agentStatus: 'running',
      runningSessionId: 'sess-1',
      runningGoal: 'Goal 1',
      currentSessionId: 'sess-2',
    });
    // POST 挂起：验证后端响应返回前的乐观更新
    const post = pendingPost();
    const stopping = store.stopTask('sess-2', false);

    expect(apiPostMock).toHaveBeenCalledWith(
      '/api/stop?all=false&session_id=sess-2',
      expect.objectContaining({ all: false, session_id: 'sess-2' }),
    );
    // sess-1 仍在运行 → 全局状态不得重置为 idle
    expect(store.agentStatus).toBe('running');
    // sess-2 被乐观移出 activeTasks
    expect(store.activeTasks.map((at) => at.session_id)).toEqual(['sess-1']);
    // sess-2 被乐观置为 cancelled（防止 completed → cancelled 闪烁）
    expect(store.rawSessions.find((s) => s.session_id === 'sess-2')?.status).toBe('cancelled');

    post.resolve({});
    await stopping;
  });

  it('stopTask(all=true) 重置全局状态并清空 pending 队列', async () => {
    const store = useSessionStore();
    store.$patch({
      pendingQueue: [{ session_id: 'q1', initial_goal: 'queued', start_time: 1, status: 'pending' }],
      agentStatus: 'running',
      runningSessionId: 'sess-1',
    });

    await store.stopTask(true);

    expect(apiPostMock).toHaveBeenCalledWith('/api/stop?all=true', { all: true });
    expect(store.agentStatus).toBe('idle');
    expect(store.runningSessionId).toBeNull();
    expect(store.pendingQueue).toEqual([]);
  });

  it('keeps the paused state when the backend says there is nothing to resume（平移）', async () => {
    const store = useSessionStore();
    store.$patch({
      rawSessions: [{ session_id: 'session-1', status: 'paused', initial_goal: '', start_time: 1 }],
      agentStatus: 'paused',
      runningSessionId: 'session-1',
      // Angular 对应用例（agent.service.spec.ts L192）桩掉了 fetchStatus；
      // 这里放行真实回查，需选中该会话避免自动跟随触发切换（M3 起切会话会重置暂停态）。
      currentSessionId: 'session-1',
      isPaused: true,
      pausedError: '503 unavailable',
    });
    apiPostMock.mockResolvedValue({ status: 'not_paused' });
    // 回查的状态仍是 paused，保证断言与内部 fetchStatus 的结果一致
    mockApiRoutes({ '/api/status': statusPayload({ status: 'paused', session_id: 'session-1' }) });

    await store.resumeTask();

    expect(store.agentStatus).toBe('paused');
    expect(store.isPaused).toBe(true);
    // 后端无可恢复任务时必须回查真实状态
    expect(apiGetMock).toHaveBeenCalledWith('/api/status');
  });

  it('moves the active session to running only after resume succeeds（平移）', async () => {
    const store = useSessionStore();
    store.$patch({
      rawSessions: [{ session_id: 'session-1', status: 'paused', initial_goal: '', start_time: 1 }],
      agentStatus: 'paused',
      runningSessionId: 'session-1',
      isPaused: true,
      pausedError: '503 unavailable',
    });
    apiPostMock.mockResolvedValue({ status: 'resumed' });
    mockApiRoutes({ '/api/status': statusPayload({ status: 'running', session_id: 'session-1' }) });

    await store.resumeTask();
    // 等待内部 fetchStatus 的回查完成，断言不被竞态影响
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    expect(store.agentStatus).toBe('running');
    expect(store.isPaused).toBe(false);
    expect(store.rawSessions[0].status).toBe('running');
  });

  it('runTask 提交 /api/run payload 并在空闲时自动选中新会话（平移：follows a just-started task）', async () => {
    const store = useSessionStore();
    store.$patch({
      agentStatus: 'running',
      runningSessionId: 'new-session',
      userPinnedSessionId: null,
      rawSessions: [{ session_id: 'new-session', status: 'running', initial_goal: '', start_time: 1 }],
    });
    apiPostMock.mockResolvedValue({ tasks: [{ session_id: 'new-session' }] });

    await store.runTask('test goal');

    expect(apiPostMock).toHaveBeenCalledWith('/api/run', { goal: 'test goal', profile: 'flash' });
    expect(store.currentSessionId).toBe('new-session');
  });

  it('runTask 把提交时刻生效的端点库记录名一起发出（pin 住本次任务的模型）', async () => {
    const store = useSessionStore();
    const system = useSystemStore();
    system.credentialRows = [
      {
        provider: 'mine',
        api_format: 'openai',
        api_base: 'http://127.0.0.1:1234/v1',
        model: 'pinned-model',
        api_key: null,
        is_active: true,
        source: 'library',
      },
    ];
    apiPostMock.mockResolvedValue({ tasks: [] });

    await store.runTask('test goal');

    expect(apiPostMock).toHaveBeenCalledWith('/api/run', {
      goal: 'test goal',
      profile: 'flash',
      model_endpoint: 'mine',
    });
  });

  it('runTask 不为未存入库的当前端点编造 pin 名字', async () => {
    const store = useSessionStore();
    const system = useSystemStore();
    system.credentialRows = [
      {
        provider: 'hand-edited',
        api_format: 'openai',
        api_base: null,
        model: 'm',
        api_key: null,
        is_active: true,
        source: 'default',
      },
    ];
    apiPostMock.mockResolvedValue({ tasks: [] });

    await store.runTask('test goal');

    // 后端按名字查库，名字不存在会 400；没存入库就应当让任务跟随全局默认
    const payload = apiPostMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('model_endpoint');
  });

  it('runTask 在其他任务运行中时不抢走当前选择', async () => {
    const store = useSessionStore();
    store.$patch({
      agentStatus: 'running',
      runningSessionId: 'old-session',
      rawSessions: [{ session_id: 'old-session', status: 'running', initial_goal: 'Old', start_time: 1 }],
    });
    apiPostMock.mockResolvedValue({ tasks: [{ session_id: 'new-session' }] });

    await store.runTask('test goal');

    expect(store.currentSessionId).toBeNull();
    // 提交动作会清掉用户的 pin（跟随下一次运行）
    expect(store.userPinnedSessionId).toBeNull();
  });
});

describe('session store — 多轮会话线程（conversation）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
    mockApiRoutes({});
    apiPostMock.mockResolvedValue({});
  });

  it('runTask 把 /api/run 响应里的线程 id 回写为当前线程', async () => {
    const store = useSessionStore();
    apiPostMock.mockResolvedValue({
      status: 'started',
      tasks: [{ session_id: 'sid-1', conversation_id: 'conv-1' }],
    });

    await store.runTask('第一条消息');

    // 新会话行尚未经 6s 轮询回填进 rawSessions 时，selectSession 只能拿到
    // 合成 round 键；响应里的真实线程 id 必须最后回写胜出，下一条消息才
    // 能续上同一线程而不是各起新线程。
    expect(store.currentConversationId).toBe('conv-1');
    expect(store.submitConversationId).toBe('conv-1');
  });

  it('首条消息不带线程 id，后端指派后连续提交沿用同一线程', async () => {
    const store = useSessionStore();
    apiPostMock.mockResolvedValue({
      status: 'started',
      tasks: [{ session_id: 'sid-1', conversation_id: 'conv-new' }],
    });

    await store.runTask('第一条', 'flash', { conversationId: undefined });
    expect(apiPostMock.mock.calls[0]![1]).not.toHaveProperty('conversation_id');

    apiPostMock.mockResolvedValue({
      status: 'queued',
      tasks: [{ session_id: 'sid-2', conversation_id: 'conv-new' }],
    });
    await store.runTask('第二条', 'flash', {
      conversationId: store.submitConversationId ?? undefined,
    });

    expect(apiPostMock.mock.calls[1]![1]).toHaveProperty('conversation_id', 'conv-new');
  });

  it('submitConversationId 不暴露合成 round 键（旧会话无真实线程时为 null）', () => {
    const store = useSessionStore();
    store.$patch({
      rawSessions: [
        { session_id: 'legacy-sid', initial_goal: '旧任务', start_time: 1, status: 'completed' },
      ],
    });

    store.selectSession('legacy-sid');

    // 合成键仅用于线程过滤展示，绝不能作为提交参数发给后端
    expect(store.currentConversationId).toBe('round:legacy-sid');
    expect(store.submitConversationId).toBeNull();
  });

  it('「新建会话」生成的空线程 id 可以作为提交线程', () => {
    const store = useSessionStore();
    store.selectConversation('conv-fresh');
    expect(store.submitConversationId).toBe('conv-fresh');
  });

  it('新建草稿线程后取消旧会话选中：提交目标不再续到旧线程，且豁免自动跟随', async () => {
    const store = useSessionStore();
    store.$patch({
      rawSessions: [
        {
          session_id: 'old-sid',
          initial_goal: '旧任务',
          conversation_id: 'conv-old',
          start_time: 1,
          status: 'completed',
        },
      ],
    });
    store.selectSession('old-sid');
    expect(store.submitConversationId).toBe('conv-old');

    // 模拟「新建会话」：取消选中 + 切到草稿线程
    store.selectSession(null);
    store.selectConversation('conv-draft');

    // 提交目标回落到草稿线程，而不是续接旧线程
    expect(store.currentSessionId).toBeNull();
    expect(store.submitConversationId).toBe('conv-draft');
    expect(store.isDraftConversation).toBe(true);

    // 有任务运行时，状态轮询不得把视图拽回运行会话（草稿豁免自动跟随）
    mockApiRoutes({
      '/api/status': statusPayload({ status: 'running', session_id: 'old-sid' }),
      '/api/sessions': [],
    });
    await store.fetchStatus();
    expect(store.currentSessionId).toBeNull();

    // 首条消息提交后 pending 表示带真实线程 id，草稿态自动解除
    mockApiRoutes({
      '/api/status': statusPayload({
        status: 'pending',
        session_id: null,
        queue: [{ session_id: 'new-sid', conversation_id: 'conv-draft', goal: '新消息' }],
      }),
      '/api/sessions': [],
    });
    await store.fetchStatus();
    expect(store.isDraftConversation).toBe(false);
  });

  it('stopTask 清除未落库任务的 tracking 桥接，不留 running 幽灵', async () => {
    // 任务仅在 active_tasks 表示中存在（DB 行尚未落库）
    mockApiRoutes({
      '/api/status': statusPayload({
        status: 'running',
        session_id: 'ghost',
        active_tasks: [{ session_id: 'ghost' }],
      }),
      '/api/sessions': [],
    });
    const store = useSessionStore();
    await store.fetchStatus();
    expect(store.sessions.some((s) => s.session_id === 'ghost')).toBe(true);

    await store.stopTask('ghost', false);
    // 冲刷 stopTask 内部未 await 的补偿轮询（仍用旧载荷），避免与下一步竞态
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    // 下一次轮询：worker 已停（idle、active 清空）——幽灵不得复活，
    // 否则命令条会永远停在「停止」态
    mockApiRoutes({
      '/api/status': statusPayload(),
      '/api/sessions': [],
    });
    await store.fetchStatus();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(store.sessions.some((s) => s.session_id === 'ghost')).toBe(false);
    expect(store.currentConversationRunningTaskId).toBeNull();
  });

  it('选中行未回填且带真实线程 id 的 pending 表示时，提交线程取自合并后的会话', () => {
    const store = useSessionStore();
    store.selectConversation('conv-current');

    // 刚提交的任务行还没落库，但 /api/status 的 queue 映射已带着真实线程 id
    store.$patch({
      pendingQueue: [
        {
          session_id: 'fresh-submitted-sid',
          initial_goal: '刚提交',
          start_time: Date.now() / 1000,
          status: 'pending',
          conversation_id: 'conv-current',
        },
      ],
    });
    store.selectSession('fresh-submitted-sid');

    // 多轮连发场景：SSE 自动跟随在行落库前切换选中，线程 id 必须取自
    // pending/active 表示，而不是退化成合成 round 键把时间线过滤成空
    expect(store.currentConversationId).toBe('conv-current');
    expect(store.submitConversationId).toBe('conv-current');
  });

  it('选中的 pending 表示无线程 id 且行未回填时，才退化成合成过滤键', () => {
    const store = useSessionStore();
    store.$patch({
      pendingQueue: [
        {
          session_id: 'legacy-queued',
          initial_goal: '无线程任务',
          start_time: Date.now() / 1000,
          status: 'pending',
        },
      ],
    });

    store.selectSession('legacy-queued');

    expect(store.currentConversationId).toBe('round:legacy-queued');
    expect(store.submitConversationId).toBeNull();
  });

  it('currentConversationRunningTaskId 取当前线程内运行中的轮次', () => {
    const store = useSessionStore();
    store.$patch({
      rawSessions: [
        { session_id: 'done-round', initial_goal: '已完成轮', start_time: 1, status: 'completed', conversation_id: 'conv-1' },
        { session_id: 'live-round', initial_goal: '运行轮', start_time: 2, status: 'running', conversation_id: 'conv-1' },
        { session_id: 'other-live', initial_goal: '别的线程', start_time: 3, status: 'running', conversation_id: 'conv-2' },
      ],
    });

    store.selectSession('done-round');
    // 选中已完成轮，但同线程有运行轮 → 暴露它（提交按钮多态为停止）
    expect(store.currentConversationRunningTaskId).toBe('live-round');

    store.selectSession('other-live');
    expect(store.currentConversationRunningTaskId).toBe('other-live');

    // 无运行轮的线程 → null
    store.$patch({
      rawSessions: [
        { session_id: 'quiet', initial_goal: '安静线程', start_time: 4, status: 'completed', conversation_id: 'conv-3' },
      ],
    });
    store.selectSession('quiet');
    expect(store.currentConversationRunningTaskId).toBeNull();
  });
});

describe('session store — 状态轮询与签名去重（§3.3 条款 4）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
    apiPostMock.mockResolvedValue({});
  });

  it('payload 不变时 pendingQueue / activeTasks / activeModel 引用保持稳定（UI 不抖）', async () => {
    const model = { name: 'Flash', id: 'flash', provider: 'x' };
    const status = statusPayload({
      status: 'running',
      session_id: 's1',
      goal: 'g',
      queue: [{ session_id: 'q1', goal: 'queued' }],
      active_tasks: [{ session_id: 's1', device_id: 'd1' }],
      model_info: model,
    });
    mockApiRoutes({ '/api/status': status, '/api/sessions': [] });
    const store = useSessionStore();

    await store.fetchStatus();
    const firstQueue = store.pendingQueue;
    const firstActive = store.activeTasks;
    const firstModel = store.activeModel;
    expect(firstQueue.map((s) => s.session_id)).toEqual(['q1']);

    await store.fetchStatus();

    expect(store.pendingQueue).toBe(firstQueue);
    expect(store.activeTasks).toBe(firstActive);
    expect(store.activeModel).toBe(firstModel);
    expect(store.agentStatus).toBe('running');
  });

  it('payload 变化时签名失效，队列重新映射', async () => {
    mockApiRoutes({
      '/api/status': statusPayload({
        status: 'running',
        session_id: 's1',
        queue: [{ session_id: 'q1', goal: 'first' }],
      }),
      '/api/sessions': [],
    });
    const store = useSessionStore();
    await store.fetchStatus();
    const firstQueue = store.pendingQueue;

    mockApiRoutes({
      '/api/status': statusPayload({
        status: 'running',
        session_id: 's1',
        queue: [{ session_id: 'q1', goal: 'first' }, { session_id: 'q2', goal: 'second' }],
      }),
      '/api/sessions': [],
    });
    await store.fetchStatus();

    expect(store.pendingQueue).not.toBe(firstQueue);
    expect(store.pendingQueue.map((s) => s.session_id)).toEqual(['q1', 'q2']);
  });

  it('乐观更新会使签名失效：stopTask 后即使 payload 未变也会重新应用（不回写旧状态）', async () => {
    const status = statusPayload({
      status: 'running',
      session_id: 'sess-1',
      active_tasks: [{ session_id: 'sess-1' }],
    });
    mockApiRoutes({ '/api/status': status, '/api/sessions': [] });
    const store = useSessionStore();
    await store.fetchStatus();
    const afterFirstPoll = store.activeTasks;

    // 停止后后端 payload 未变（仍报告 running）——失效的签名强制下一次轮询重新应用
    await store.stopTask('sess-1', false);
    await store.fetchStatus();

    expect(store.activeTasks).not.toBe(afterFirstPoll);
    expect(store.activeTasks.map((at) => at.session_id)).toEqual(['sess-1']);
  });

  it('queue 的字符串元素映射为 task-queued-N 占位会话', async () => {
    mockApiRoutes({
      '/api/status': statusPayload({ queue: ['First goal'] }),
      '/api/sessions': [],
    });
    const store = useSessionStore();

    await store.fetchStatus();

    expect(store.pendingQueue[0]).toMatchObject({
      session_id: 'task-queued-0',
      initial_goal: 'First goal',
      status: 'pending',
    });
  });

  it('状态拉取失败时置为 offline（顶栏指示的数据源）', async () => {
    apiGetMock.mockImplementation(() => Promise.reject(new Error('boom')));
    const store = useSessionStore();
    store.$patch({ runningSessionId: 's1' });

    await store.fetchStatus();

    expect(store.agentStatus).toBe('offline');
    expect(store.runningSessionId).toBeNull();
  });
});

describe('session store — 删除 / 清空（乐观更新）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
    mockApiRoutes({});
    apiPostMock.mockResolvedValue({ status: 'ok' });
  });

  it('deleteSession 先乐观移除再请求 /delete，并回查会话与状态', async () => {
    const store = useSessionStore();
    store.$patch({
      rawSessions: [
        { session_id: 's1', initial_goal: 'keep', start_time: 1 },
        { session_id: 's2', initial_goal: 'drop', start_time: 2 },
      ],
      pendingQueue: [{ session_id: 's2', initial_goal: 'drop', start_time: 3, status: 'pending' }],
      currentSessionId: 's2',
    });
    // POST 挂起：验证后端响应返回前的乐观更新
    const post = pendingPost();
    const deleting = store.deleteSession('s2');

    expect(store.rawSessions.map((s) => s.session_id)).toEqual(['s1']);
    expect(store.pendingQueue).toEqual([]);
    // 选中回落（无运行中会话）
    expect(store.currentSessionId).toBeNull();

    post.resolve({ status: 'ok' });
    await deleting;

    expect(apiPostMock).toHaveBeenCalledWith('/api/sessions/s2/delete', {});
    // 请求完成后回查会话与状态
    expect(apiGetMock).toHaveBeenCalledWith('/api/sessions');
    expect(apiGetMock).toHaveBeenCalledWith('/api/status');
  });

  it('clearAllHistory 乐观清空并请求 /api/cleanup', async () => {
    const store = useSessionStore();
    store.$patch({
      rawSessions: [{ session_id: 's1', initial_goal: 'g', start_time: 1 }],
      pendingQueue: [{ session_id: 'q1', initial_goal: 'g', start_time: 2, status: 'pending' }],
      userPinnedSessionId: 's1',
      currentSessionId: 's1',
    });

    await store.clearAllHistory();

    expect(store.rawSessions).toEqual([]);
    expect(store.pendingQueue).toEqual([]);
    expect(store.currentSessionId).toBeNull();
    expect(store.userPinnedSessionId).toBeNull();
    expect(apiPostMock).toHaveBeenCalledWith('/api/cleanup', {});
  });

  it('deleteConversation 单次批量请求删除线程内全部轮次（不再逐条串行）', async () => {
    const store = useSessionStore();
    const b1 = { session_id: 'b1', initial_goal: '线程B', start_time: 3, status: 'completed', conversation_id: 'conv-B' };
    store.$patch({
      rawSessions: [
        { session_id: 'a1', initial_goal: '线程A', start_time: 1, status: 'completed', conversation_id: 'conv-A' },
        { session_id: 'a2', initial_goal: '追问', start_time: 2, status: 'failed', conversation_id: 'conv-A' },
        b1,
      ],
      currentSessionId: 'a1',
    });
    apiPostMock.mockResolvedValue({ status: 'success', deleted_count: 2 });
    // 删除后的真实服务端状态：只剩线程 B
    mockApiRoutes({ '/api/sessions': [b1], '/api/status': statusPayload() });

    const group = store.conversationGroups.find((g) => g.id === 'conv-A')!;
    await store.deleteConversation(group);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    // 有且仅有一次删除请求，走批量端点、携带线程内全部轮次 id
    const deleteCalls = apiPostMock.mock.calls.filter((c) => String(c[0]).includes('delete'));
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]![0]).toBe('/api/sessions/delete-batch');
    expect([...(deleteCalls[0]![1] as { session_ids: string[] }).session_ids].sort()).toEqual([
      'a1',
      'a2',
    ]);
    // 乐观移除生效（刷新回写后同样只剩线程 B；被删的是当前选中线程，
    // 会话列表的初始自动选中逻辑会选上仅剩的线程 B）
    expect(store.rawSessions.map((s) => s.session_id)).toEqual(['b1']);
    expect(store.currentSessionId).toBe('b1');
  });
});

describe('session store — 轮询节奏与缓存（§3.3 条款 6）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('2s 轮询 status、每 3 个周期（6s）刷新 sessions', async () => {
    vi.useFakeTimers();
    mockApiRoutes({ '/api/status': statusPayload(), '/api/sessions': [] });
    const store = useSessionStore();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    apiGetMock.mockClear();

    await vi.advanceTimersByTimeAsync(6000);
    await vi.advanceTimersByTimeAsync(0);

    const statusCalls = apiGetMock.mock.calls.filter((c) => c[0] === '/api/status').length;
    const sessionCalls = apiGetMock.mock.calls.filter((c) => c[0] === '/api/sessions').length;
    expect(statusCalls).toBe(3); // 2s / 4s / 6s
    expect(sessionCalls).toBe(1); // 仅 6s 一次
    store.stop();
  });

  it('visibilitychange 恢复可见时立即刷新 status 与 sessions（§3.3 条款 6）', async () => {
    vi.useFakeTimers();
    mockApiRoutes({ '/api/status': statusPayload(), '/api/sessions': [] });
    const store = useSessionStore();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    apiGetMock.mockClear();

    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    expect(apiGetMock.mock.calls.map((c) => c[0])).toEqual(['/api/status', '/api/sessions']);
    store.stop();
  });

  it('fetchSessions 结果写入 localStorage 缓存，新 store 实例启动时恢复', async () => {
    vi.useFakeTimers();
    const rows = [{ session_id: 'cached-1', initial_goal: 'cached goal', start_time: 5, status: 'completed' }];
    mockApiRoutes({ '/api/status': statusPayload(), '/api/sessions': rows });
    const store = useSessionStore();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    store.stop();

    expect(localStorage.getItem(SESSIONS_KEY)).toContain('cached-1');

    // 新实例：后端不可用也能先渲染缓存
    setActivePinia(createPinia());
    apiGetMock.mockImplementation(() => Promise.reject(new Error('backend down')));
    const store2 = useSessionStore();
    store2.start();
    await vi.advanceTimersByTimeAsync(0);
    store2.stop();

    expect(store2.rawSessions.map((s) => s.session_id)).toEqual(['cached-1']);
  });
});
