import { describe, expect, it } from 'vitest';

import type { Session } from '@/types/session.model';
import {
  getTaskStatus,
  mapPendingQueue,
  mergeSessions,
  resolveDeviceSerial,
  sessionChronoKey,
  statusSignature,
} from './session-merge';
import type { ActiveTaskInfo, MergeSessionsContext } from './session-merge';

/** 构造一份「空轮询快照」上下文，测试里按需覆盖。 */
function ctx(overrides: Partial<MergeSessionsContext> = {}): MergeSessionsContext {
  return {
    raw: [],
    pending: [],
    activeTasks: [],
    agentStatus: 'idle',
    runningSessionId: null,
    runningGoal: null,
    activeModel: null,
    nowMs: 1_000_000,
    ...overrides,
  };
}

function session(partial: Partial<Session> & { session_id: string }): Session {
  return { initial_goal: '', start_time: 100, ...partial } as Session;
}

function activeTask(partial: Partial<ActiveTaskInfo> & { session_id?: string }): ActiveTaskInfo {
  return { ...partial };
}

describe('mergeSessions — 4 步合并算法（§3.3 条款 3）', () => {
  it('step1: raw 行按 DB 状态保留，success 归一化为 completed，列表按 start_time 倒序', () => {
    const merged = mergeSessions(
      ctx({
        raw: [
          session({ session_id: 'old', status: 'completed', start_time: 50 }),
          session({ session_id: 'new', status: 'success', start_time: 500 }),
          session({ session_id: 'mid', status: 'failed', start_time: 100 }),
        ],
      }),
      new Map(),
    );
    expect(merged.map((s) => s.session_id)).toEqual(['new', 'mid', 'old']);
    expect(merged[0].status).toBe('completed');
    expect(merged[1].status).toBe('failed');
    expect(merged[2].status).toBe('completed');
  });

  it('step1: 终态会话从 tracking 表移除，进行中会话进入 tracking 表', () => {
    const tracking = new Map<string, Session>();
    mergeSessions(
      ctx({
        raw: [
          session({ session_id: 'done', status: 'completed', start_time: 1 }),
          session({ session_id: 'live', status: 'running', start_time: 2 }),
        ],
        agentStatus: 'running',
        runningSessionId: 'live',
      }),
      tracking,
    );
    expect(tracking.has('done')).toBe(false);
    expect(tracking.has('live')).toBe(true);
  });

  it('step1: 运行中的会话状态由状态轮询决定（paused 覆盖 running），未 pin 的模型信息以 activeModel 为准', () => {
    const activeModel = { name: 'GLM-Pro', id: 'glm-pro', provider: 'zhipu' };
    const merged = mergeSessions(
      ctx({
        raw: [session({ session_id: 's1', status: 'running', start_time: 1, model_info: { name: 'Flash', id: 'flash', provider: 'x' } })],
        agentStatus: 'paused',
        runningSessionId: 's1',
        activeModel,
      }),
      new Map(),
    );
    expect(merged[0].status).toBe('paused');
    expect(merged[0].model_info).toEqual(activeModel);
  });

  it('step1: pin 过端点的运行会话保留自己的 model_info，不被全局默认改写', () => {
    const activeModel = { name: 'GLM-Pro', id: 'glm-pro', provider: 'zhipu' };
    const pinned = { name: 'Flash', id: 'pinned-model', provider: 'openai', endpoint: 'mine' };
    const merged = mergeSessions(
      ctx({
        raw: [
          session({
            session_id: 's1',
            status: 'running',
            start_time: 1,
            model_endpoint: 'mine',
            model_info: pinned,
          }),
        ],
        agentStatus: 'running',
        runningSessionId: 's1',
        activeModel,
      }),
      new Map(),
    );
    // activeModel 说的是「下一个任务用什么」；这次运行用什么已经写在行里
    expect(merged[0].model_info).toEqual(pinned);
  });

  it('step1: 未运行的 raw 行若在 pending 队列中则标记为 pending；设备序列号按 raw → device_info JSON 顺序解析', () => {
    const merged = mergeSessions(
      ctx({
        raw: [
          session({ session_id: 's1', status: 'created', start_time: 1, device_info: JSON.stringify({ device_id: 'emu-5554' }) }),
          session({ session_id: 's2', status: 'created', start_time: 2, device_serial: 'serial-2' }),
        ],
        pending: [session({ session_id: 's1', initial_goal: 'goal', start_time: 1 })],
      }),
      new Map(),
    );
    expect(merged.find((s) => s.session_id === 's1')?.status).toBe('pending');
    expect(merged.find((s) => s.session_id === 's1')?.device_serial).toBe('emu-5554');
    expect(merged.find((s) => s.session_id === 's2')?.device_serial).toBe('serial-2');
  });

  it('step1: 运行会话的设备序列号可由 active_tasks 的 device_id 兜底', () => {
    const merged = mergeSessions(
      ctx({
        raw: [session({ session_id: 's1', status: 'running', start_time: 1 })],
        activeTasks: [activeTask({ session_id: 's1', device_id: 'device-A' })],
      }),
      new Map(),
    );
    expect(merged[0].device_serial).toBe('device-A');
    expect(merged[0].status).toBe('running');
  });

  it('step2: 尚未出现在 DB 行中的 pending 会话直接入列并进入 tracking 表', () => {
    const tracking = new Map<string, Session>();
    const merged = mergeSessions(
      ctx({
        pending: [session({ session_id: 'queued-1', initial_goal: '排队任务', start_time: 10, status: 'pending' })],
      }),
      tracking,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('pending');
    expect(tracking.has('queued-1')).toBe(true);
  });

  it('step3: active_tasks 中列表外的新会话被创建为 running（外部入口 / 多设备并行）', () => {
    const merged = mergeSessions(
      ctx({
        activeTasks: [
          activeTask({ session_id: 'ext-1', goal: '外部任务', device_id: 'device-B', acquired_at: '2026-01-01T00:00:00Z' }),
          activeTask({ device_id: 'device-C', goal: '无 sid 的任务' }),
        ],
        runningGoal: null,
      }),
      new Map(),
    );
    const ext = merged.find((s) => s.session_id === 'ext-1');
    expect(ext?.status).toBe('running');
    expect(ext?.initial_goal).toBe('外部任务');
    expect(ext?.device_serial).toBe('device-B');
    const fallback = merged.find((s) => s.session_id === 'active-device-C');
    expect(fallback?.status).toBe('running');
  });

  it('step3: 已在列表中的 pending 会话被 active_tasks 升级为 running', () => {
    const merged = mergeSessions(
      ctx({
        pending: [session({ session_id: 's1', initial_goal: 'goal', start_time: 1, status: 'pending' })],
        activeTasks: [activeTask({ session_id: 's1', device_id: 'device-A' })],
      }),
      new Map(),
    );
    expect(merged[0].status).toBe('running');
    expect(merged[0].device_serial).toBe('device-A');
  });

  it('step3: active_tasks 为空但状态轮询报告 running 时，按 runId + goal 兜底创建运行会话', () => {
    const merged = mergeSessions(
      ctx({
        agentStatus: 'running',
        runningSessionId: 'runner-1',
        runningGoal: 'runner goal',
      }),
      new Map(),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      session_id: 'runner-1',
      initial_goal: 'runner goal',
      status: 'running',
    });
  });

  it('step4（桥接）: 队列消费后 DB 行尚未落库的窗口里，tracking 表把会话桥接为 running，队列→运行切换不闪烁', () => {
    const tracking = new Map<string, Session>();
    // 第一次轮询：会话在队列中
    const first = mergeSessions(
      ctx({
        pending: [session({ session_id: 's1', initial_goal: 'goal', start_time: 10, status: 'pending' })],
      }),
      tracking,
    );
    expect(first[0].status).toBe('pending');
    // 第二次轮询：queue 已消费、DB 行未写入、status 轮询未观察到 runner —— 三处都找不到，
    // 但 tracking 表仍在，会话不得从列表消失。
    const second = mergeSessions(ctx({ nowMs: 2_000_000 }), tracking);
    expect(second.map((s) => s.session_id)).toEqual(['s1']);
    expect(second[0].status).toBe('running');
    // 第三次轮询：DB 行以终态出现 → 桥接结束，tracking 表清掉该会话
    const third = mergeSessions(
      ctx({ raw: [session({ session_id: 's1', status: 'completed', start_time: 10 })] }),
      tracking,
    );
    expect(third[0].status).toBe('completed');
    expect(tracking.has('s1')).toBe(false);
  });

  it('step3→4 窗口: 任务被取走、状态已 running 且 active/queue 都没有它时，提交锚点沿用 tracking，不被 now 现造的条目遮蔽', () => {
    const tracking = new Map<string, Session>();
    // 第一次轮询：任务在队列中，带提交时刻
    mergeSessions(
      ctx({
        pending: [
          session({
            session_id: 's-run',
            initial_goal: '排队轮次',
            start_time: 100,
            submitted_at: 90,
            status: 'pending',
          }),
        ],
      }),
      tracking,
    );
    // 第二次轮询：worker 已取走（queue 空）、DB 行未落库，但状态轮询已观察到
    // runner —— 现造条目的 start_time 会是 now；排序锚点必须仍是 90，
    // 否则运行轮次会跳到提交更晚的排队轮次下方。
    const second = mergeSessions(
      ctx({
        agentStatus: 'running',
        runningSessionId: 's-run',
        nowMs: 5_000_000,
      }),
      tracking,
    );
    const running = second.find((s) => s.session_id === 's-run')!;
    expect(running.status).toBe('running');
    expect(running.submitted_at).toBe(90);
    expect(sessionChronoKey(running)).toBe(90);
  });

  it('step4: 状态载荷长期不再提及且无 DB 行的 tracking 条目过期清除，不再永久驻留', () => {
    const tracking = new Map<string, Session>();
    // 外部幽灵（如测试进程误连 IPC 桥广播的会话）进入 tracking
    tracking.set('ghost-1', session({ session_id: 'ghost-1', initial_goal: 'summary versioning test', start_time: 900 }));
    // 合法排队任务同样先经 tracking
    tracking.set('queued-1', session({ session_id: 'queued-1', initial_goal: '真任务', start_time: 950 }));

    // 第一次合并：幽灵在宽限期内照常桥接显示
    const first = mergeSessions(ctx({ nowMs: 1_000_000 }), tracking);
    expect(first.find((s) => s.session_id === 'ghost-1')!.status).toBe('running');
    expect(first.find((s) => s.session_id === 'queued-1')).toBeTruthy();

    // 61s 后状态载荷不再提及幽灵：从合并结果与 tracking 中一并清除；
    // queued-1 每次轮询都被载荷提及（pending），不受影响
    const second = mergeSessions(
      ctx({
        nowMs: 1_061_001,
        pending: [session({ session_id: 'queued-1', initial_goal: '真任务', start_time: 950 })],
      }),
      tracking,
    );
    expect(second.find((s) => s.session_id === 'ghost-1')).toBeUndefined();
    expect(tracking.has('ghost-1')).toBe(false);
    expect(tracking.has('queued-1')).toBe(true);

    // 载荷提及中的条目：超过 TTL 也不会被清除
    const third = mergeSessions(
      ctx({
        nowMs: 1_200_000,
        pending: [session({ session_id: 'queued-1', initial_goal: '真任务', start_time: 950 })],
      }),
      tracking,
    );
    expect(third.find((s) => s.session_id === 'queued-1')).toBeTruthy();
    expect(tracking.has('queued-1')).toBe(true);
  });
});

describe('mapPendingQueue — /api/status queue 映射', () => {
  it('对象元素：优先使用 session_id / goal / start_time，设备取 device_serial 或 device_id', () => {
    const mapped = mapPendingQueue(
      [
        { session_id: 'q1', goal: 'G1', status: 'pending', created_at: 123, device_id: 'dev-1' },
        { session_id: '', goal: 'G2', status: 'pending', start_time: 200 },
      ],
      1_000_000,
    );
    expect(mapped[0]).toMatchObject({
      session_id: 'q1',
      initial_goal: 'G1',
      start_time: 123,
      status: 'pending',
      device_serial: 'dev-1',
    });
    expect(mapped[1]).toMatchObject({ session_id: 'pending-task-1', initial_goal: 'G2', start_time: 200 });
  });

  it('对象元素携带 conversation_id：pending 表示并入正确线程，不成幽灵会话', () => {
    const mapped = mapPendingQueue(
      [
        { session_id: 'q1', goal: 'G1', status: 'pending', conversation_id: 'conv-1' },
        { session_id: 'q2', goal: 'G2', status: 'pending' },
      ],
      1_000_000,
    );
    expect(mapped[0]).toMatchObject({ session_id: 'q1', conversation_id: 'conv-1' });
    expect(mapped[1]).toMatchObject({ session_id: 'q2', conversation_id: null });
  });

  it('对象元素携带 created_at 作为 submitted_at：轮次排序锚点在发射前后保持不变', () => {
    const mapped = mapPendingQueue(
      [{ session_id: 'q1', goal: 'G1', status: 'pending', created_at: 555.5 }],
      1_000_000,
    );
    expect(mapped[0]).toMatchObject({ session_id: 'q1', submitted_at: 555.5 });
  });

  it('对象元素缺省字段时回退到 pending-task-N 与 nowMs/1000 + index', () => {
    const mapped = mapPendingQueue([{ session_id: '', goal: '', status: 'pending' }], 2_000_000);
    expect(mapped[0]).toMatchObject({
      session_id: 'pending-task-0',
      initial_goal: '',
      start_time: 2000,
      status: 'pending',
    });
  });

  it('字符串元素：生成 task-queued-N 占位会话，FIFO 递增 start_time', () => {
    const mapped = mapPendingQueue(['第一个目标', '第二个目标'], 1_000_000);
    expect(mapped[0]).toMatchObject({
      session_id: 'task-queued-0',
      initial_goal: '第一个目标',
      start_time: 1000,
      status: 'pending',
    });
    expect(mapped[1]).toMatchObject({
      session_id: 'task-queued-1',
      initial_goal: '第二个目标',
      start_time: 1001,
    });
  });
});

describe('getTaskStatus — 展示状态推导', () => {
  it('success 归一化为 completed；failed/cancelled 原样透出', () => {
    expect(getTaskStatus(session({ session_id: 'a', status: 'success' }), null, 'idle')).toBe('completed');
    expect(getTaskStatus(session({ session_id: 'a', status: 'failed' }), null, 'idle')).toBe('failed');
    expect(getTaskStatus(session({ session_id: 'a', status: 'cancelled' }), null, 'idle')).toBe('cancelled');
  });

  it('无状态行时按运行器状态兜底：running/paused 透出，否则归为 completed', () => {
    expect(getTaskStatus(session({ session_id: 'a' }), 'a', 'running')).toBe('running');
    expect(getTaskStatus(session({ session_id: 'a' }), 'a', 'paused')).toBe('paused');
    expect(getTaskStatus(session({ session_id: 'a' }), 'a', 'idle')).toBe('completed');
    expect(getTaskStatus(session({ session_id: 'a' }), 'b', 'running')).toBe('completed');
  });

  it('pending 状态透出（排队中的任务）', () => {
    expect(getTaskStatus(session({ session_id: 'a', status: 'pending' }), null, 'idle')).toBe('pending');
  });
});

describe('resolveDeviceSerial — 展示用设备序列号', () => {
  it('过滤 pending/null/undefined 占位串，回退到 device_info（字符串或对象）', () => {
    expect(resolveDeviceSerial(session({ session_id: 'a', device_serial: 'pending' }))).toBeNull();
    expect(resolveDeviceSerial(session({ session_id: 'a', device_id: 'null' }))).toBeNull();
    expect(
      resolveDeviceSerial(session({ session_id: 'a', device_serial: 'pending', device_info: { device_serial: 'dev-9' } })),
    ).toBe('dev-9');
    expect(
      resolveDeviceSerial(session({ session_id: 'a', device_info: '{"device_id":"dev-8"}' })),
    ).toBe('dev-8');
    expect(resolveDeviceSerial(session({ session_id: 'a', device_serial: 'dev-1' }))).toBe('dev-1');
  });

  it('同一 session 对象的解析结果被缓存（WeakMap）', () => {
    const s = session({ session_id: 'cache', device_serial: 'dev-cache' });
    expect(resolveDeviceSerial(s)).toBe('dev-cache');
    expect(resolveDeviceSerial(s)).toBe('dev-cache');
  });
});

describe('sessionChronoKey — 轮次排序锚点', () => {
  it('优先 submitted_at；旧数据回退 start_time', () => {
    expect(sessionChronoKey({ submitted_at: 555, start_time: 999 })).toBe(555);
    expect(sessionChronoKey({ start_time: 999 })).toBe(999);
    expect(sessionChronoKey({})).toBe(0);
  });
});

describe('statusSignature — 轮询签名（§3.3 条款 4）', () => {
  it('内容相同的 payload 产生相同签名；内容变化签名变化；null/undefined 归一为空数组签名', () => {
    const payload = [{ session_id: 'q1', goal: 'G' }];
    expect(statusSignature(payload)).toBe(statusSignature([{ session_id: 'q1', goal: 'G' }]));
    expect(statusSignature(payload)).not.toBe(statusSignature([{ session_id: 'q2', goal: 'G' }]));
    expect(statusSignature(null)).toBe(statusSignature(undefined));
    expect(statusSignature(null)).toBe('[]');
  });
});
