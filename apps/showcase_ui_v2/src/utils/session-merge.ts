/**
 * 会话合并与状态推导的纯函数模块 —— 从 Angular `agent.service.ts` 逐行平移，
 * 框架无关（无 Vue / Pinia 依赖），配套 spec 见 `session-merge.spec.ts`。
 *
 * 平移来源与对应关系：
 * - `mergeSessions`            ← AgentService.sessions computed（agent.service.ts L82-198）
 * - `mapPendingQueue`          ← AgentService.fetchStatus 内的 queue 映射（L1541-1559）
 * - `getTaskStatus`            ← ChatInterfaceComponent.getTaskStatus
 * - `resolveDeviceSerial`      ← ChatInterfaceComponent.getDeviceSerial（展示用，带 WeakMap 缓存）
 * - `statusSignature`          ← fetchStatus 的轮询签名（`JSON.stringify(data.queue || [])`）
 */

import type { ModelInfo, Session, TaskQueueItem } from '@/types/session.model';

/** `/api/status` 的 `active_tasks` 行（多设备并行 / 外部入口运行中的任务）。 */
export interface ActiveTaskInfo {
  device_id?: string | null;
  session_id?: string | null;
  goal?: string | null;
  pid?: number | null;
  ingress?: string | null;
  acquired_at?: string | number | null;
  conversation_id?: string | null;
  created_at?: number | null;
}

/**
 * 轮次排序 / 展示的统一时间锚点：提交（入队）时刻优先，缺失（旧数据）回退
 * start_time。任务的 start_time 会随生命周期漂移（排队时是入队时刻，引擎
 * 启动后变成获得设备使用权的时刻），用它排序会让发射的轮次"顶"到队尾。
 */
export function sessionChronoKey(session: {
  submitted_at?: number | null;
  start_time?: number | null;
}): number {
  return session.submitted_at || session.start_time || 0;
}

export interface MergeSessionsContext {
  /** `/api/sessions` 返回的 DB 行。 */
  raw: Session[];
  /** `/api/status` 的 queue 映射出的 pending 会话。 */
  pending: Session[];
  /** `/api/status` 的 active_tasks。 */
  activeTasks: ActiveTaskInfo[];
  /** 运行器状态（idle / running / paused / offline）。 */
  agentStatus: string;
  runningSessionId: string | null;
  runningGoal: string | null;
  /** 状态轮询报告的运行中模型。 */
  activeModel: ModelInfo | null;
  /** 当前时间（毫秒），用于 start_time 兜底，便于测试注入。 */
  nowMs: number;
}

export type DisplayTaskStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'pending'
  | 'failed'
  | 'cancelled';

function isTerminalStatus(status: string | undefined): boolean {
  return (
    status === 'completed' || status === 'success' || status === 'failed' || status === 'cancelled'
  );
}

/**
 * 会话合并 4 步算法（迁移验收隐藏条款 §3.3 条款 3）：
 *
 *   raw(DB 行) → pending(queue) → active_tasks → tracking 桥接
 *
 * `tracking` 是跨轮询持久存在的 active/pending 会话追踪表（store 持有一个
 * 非响应式 Map 传入；本函数按 Angular 原实现原地读写它）。第 4 步桥接保证
 * 「队列 → 运行」切换窗口里（DB 行尚未写入、queue 已被消费、status 轮询
 * 尚未观察到新 runner）会话不从列表中消失，避免 UI 闪烁。
 */
export function mergeSessions(
  ctx: MergeSessionsContext,
  tracking: Map<string, Session>,
): Session[] {
  const {
    raw,
    pending,
    activeTasks: activeList,
    agentStatus: status,
    runningSessionId: runId,
    runningGoal: goal,
    activeModel,
    nowMs,
  } = ctx;

  const sessionMap = new Map<string, Session>();
  // 查找表让每个会话的合并保持 O(1)，不必在 pending/active 列表里反复扫描。
  const pendingById = new Map(pending.map((p) => [p.session_id, p]));
  const activeById = new Map<string | null | undefined, ActiveTaskInfo>(
    activeList.map((at) => [at.session_id, at]),
  );

  // 1. 先加入 DB 中的 raw sessions
  raw.forEach((s) => {
    const activeMatch = activeById.get(s.session_id);
    const pendingMatch = pendingById.get(s.session_id);
    const isCurrentActive =
      ((status === 'running' || status === 'paused') && runId === s.session_id) || !!activeMatch;
    const isTerminal = isTerminalStatus(s.status);
    let sStatus = s.status;
    if (!isTerminal) {
      const isPending = !!pendingMatch && !isCurrentActive;
      sStatus = isCurrentActive
        ? status === 'paused'
          ? 'paused'
          : 'running'
        : isPending
          ? 'pending'
          : s.status;
    } else {
      sStatus = s.status === 'success' ? 'completed' : s.status;
    }
    let serial =
      s.device_serial || s.device_id || activeMatch?.device_id || pendingMatch?.device_serial || null;
    if (!serial && s.device_info) {
      try {
        const info = typeof s.device_info === 'string' ? JSON.parse(s.device_info) : s.device_info;
        serial = info?.device_id || info?.device_serial || null;
      } catch {
        // ignore
      }
    }
    const finalSession: Session = {
      ...s,
      status: sStatus,
      device_serial: serial,
      // 全局 activeModel 回答的是「下一个任务用什么」，pin 过的会话带着
      // 「这次用了什么」，后者不能被前者覆盖（后端已按 pin 下发 model_info）。
      model_info:
        isCurrentActive && activeModel && !s.model_endpoint ? activeModel : s.model_info,
    };
    sessionMap.set(s.session_id, finalSession);
    if (isTerminal) {
      tracking.delete(s.session_id);
    } else if (sStatus === 'running' || sStatus === 'paused' || sStatus === 'pending') {
      tracking.set(s.session_id, finalSession);
    }
  });

  // 2. 补充尚未出现在 raw sessions 里的 pending 队列会话
  pending.forEach((p) => {
    if (!sessionMap.has(p.session_id)) {
      const activeMatch = activeById.get(p.session_id);
      const isCurrentRunning =
        ((status === 'running' || status === 'paused') && runId === p.session_id) || !!activeMatch;
      const finalPending: Session = {
        ...p,
        status: isCurrentRunning ? (status === 'paused' ? 'paused' : 'running') : p.status || 'pending',
        device_serial: p.device_serial || p.device_id || activeMatch?.device_id || null,
      };
      sessionMap.set(p.session_id, finalPending);
      tracking.set(p.session_id, finalPending);
    }
  });

  // 3. 保证所有正在运行的任务都在列表里（多设备并行 & 外部入口发起的运行）
  if (activeList.length > 0) {
    activeList.forEach((at) => {
      const sid = at.session_id || `active-${at.device_id}`;
      const existing = sessionMap.get(sid);
      if (!existing) {
        const bridged = tracking.get(sid);
        const newSession: Session = {
          session_id: sid,
          initial_goal: at.goal || goal || '',
          start_time: at.acquired_at ? new Date(at.acquired_at).getTime() / 1000 : nowMs / 1000,
          status: 'running',
          model_info: activeModel || undefined,
          device_serial: at.device_id || null,
          conversation_id: at.conversation_id || bridged?.conversation_id || null,
          // 提交时刻优先取 active_tasks 的回填；任务从未在本页见过排队时
          // （外部入口）回退 tracking 桥接，再退 null。
          submitted_at: at.created_at || bridged?.submitted_at || null,
        };
        sessionMap.set(sid, newSession);
        tracking.set(sid, newSession);
      } else if (existing.status === 'pending') {
        const updated: Session = {
          ...existing,
          status: 'running',
          device_serial: at.device_id || existing.device_serial,
          conversation_id: existing.conversation_id || at.conversation_id || null,
          submitted_at: existing.submitted_at || at.created_at || null,
        };
        sessionMap.set(sid, updated);
        tracking.set(sid, updated);
      }
    });
  } else if ((status === 'running' || status === 'paused') && runId && !sessionMap.has(runId)) {
    // 队列与 active_tasks 都还没带上运行任务的短暂窗口（取走→持锁间隙）。
    // tracking 里若已有该任务（本页见过它的排队表示），必须复用它的锚点；
    // 若在这里用 now 现造一个，会遮蔽 tracking 的正确 submitted_at，
    // 运行轮次就会"顶"到后面排队轮次的下方。
    const bridged = tracking.get(runId);
    if (bridged) {
      const revived: Session = { ...bridged, status };
      sessionMap.set(runId, revived);
      tracking.set(runId, revived);
    } else {
      const activeSession: Session = {
        session_id: runId,
        initial_goal: goal || '',
        start_time: nowMs / 1000,
        status,
        model_info: activeModel || undefined,
      };
      sessionMap.set(runId, activeSession);
      tracking.set(runId, activeSession);
    }
  }

  // 4. 桥接「队列 → 运行」的瞬时过渡窗口
  tracking.forEach((ts, sid) => {
    if (!sessionMap.has(sid)) {
      sessionMap.set(sid, {
        ...ts,
        status: 'running',
      });
    }
  });

  return Array.from(sessionMap.values()).sort((a, b) => b.start_time - a.start_time);
}

/**
 * 把 `/api/status` 的 queue 映射成 pending 会话（agent.service.ts L1541-1559）。
 * 元素可能是对象（TaskQueueItem）也可能是纯字符串目标。
 */
export function mapPendingQueue(
  queue: Array<TaskQueueItem | string>,
  nowMs: number,
): Session[] {
  return (queue || []).map((item, index) => {
      if (typeof item === 'object' && item !== null) {
        return {
          session_id: item.session_id || `pending-task-${index}`,
          initial_goal: item.goal || '',
          start_time: item.start_time || item.created_at || nowMs / 1000 + index,
          status: item.status || 'pending',
          device_serial: item.device_serial || item.device_id || null,
          // 队列条目自带线程 id（/api/run 指派）：pending/running 表示必须带着它，
          // 否则新轮在落库前会以 `round:<sid>` 合成键成一个「幽灵会话」，
          // 且此刻提交下一条消息会拿不到线程 id 而另起新线程。
          conversation_id: item.conversation_id || null,
          // 提交时刻：轮次排序锚点（见 sessionChronoKey）。
          submitted_at: item.created_at || null,
        };
      }
    return {
      session_id: `task-queued-${index}`,
      initial_goal: String(item),
      start_time: nowMs / 1000 + index,
      status: 'pending',
    };
  });
}

/**
 * 展示用状态推导（ChatInterfaceComponent.getTaskStatus）：
 * success 归一化为 completed；未知状态在非运行情况下归为 completed。
 */
export function getTaskStatus(
  session: Session,
  runningSessionId: string | null,
  agentStatus: string,
): DisplayTaskStatus {
  if (session.status) {
    const s = session.status.toLowerCase();
    if (s === 'completed' || s === 'success' || s === 'failed' || s === 'cancelled') {
      return (s === 'success' ? 'completed' : s) as DisplayTaskStatus;
    }
    if (s === 'running' || s === 'paused' || s === 'pending') {
      return s;
    }
  }
  if (
    session.session_id === runningSessionId &&
    (agentStatus === 'running' || agentStatus === 'paused')
  ) {
    return agentStatus as DisplayTaskStatus;
  }
  return 'completed';
}

const deviceSerialCache = new WeakMap<Session, string | null>();

/**
 * 展示用的设备序列号解析（ChatInterfaceComponent.getDeviceSerial）：
 * 过滤 'pending'/'null'/'undefined' 占位串，并按对象/字符串两种 device_info 兜底。
 * 按 session 对象做 WeakMap 缓存，避免模板重求值时反复 JSON.parse。
 */
export function resolveDeviceSerial(session: Session): string | null {
  const cached = deviceSerialCache.get(session);
  if (cached !== undefined) {
    return cached;
  }
  let resolved: string | null = null;
  const serial = session.device_serial || session.device_id;
  if (serial && serial !== 'pending' && serial !== 'null' && serial !== 'undefined') {
    resolved = serial;
  } else if (session.device_info) {
    try {
      const info =
        typeof session.device_info === 'string' ? JSON.parse(session.device_info) : session.device_info;
      const s = info?.device_id || info?.device_serial;
      if (s && s !== 'pending' && s !== 'null' && s !== 'undefined') {
        resolved = s;
      }
    } catch {
      // ignore
    }
  }
  deviceSerialCache.set(session, resolved);
  return resolved;
}

/**
 * 轮询签名：payload 未变化时返回相同字符串，store 据此跳过响应式赋值
 * （迁移验收隐藏条款 §3.3 条款 4 的「签名去重」面）。
 */
export function statusSignature(value: unknown): string {
  return JSON.stringify(value ?? []);
}

/** 会话线程分组键：conversation_id 优先，无线程标记的旧轮各自成组。
 *  store 的 conversationGroups、时间线的轮过滤与选中联动必须共用本函数，
 *  否则左右两栏的键空间不一致会导致选中会话后轮次被过滤成空。 */
export function conversationThreadKey(session: {
  session_id: string;
  conversation_id?: string | null;
}): string {
  return session.conversation_id || `round:${session.session_id}`;
}

/** 会话状态 → Arco tag 色彩（队列面板与会话头共用，避免两处映射漂移）。 */
export const SESSION_STATUS_COLOR: Record<string, string> = {
  running: 'arcoblue',
  paused: 'orange',
  pending: 'gray',
  completed: 'green',
  failed: 'red',
  cancelled: 'gray',
};

export function sessionStatusColor(status: string): string {
  return SESSION_STATUS_COLOR[status] || 'gray';
}

/** 会话开始时间的紧凑展示：今天显示 HH:MM，跨天带日期（MM/DD HH:MM）。 */
export function formatSessionTime(startTime?: number): string {
  if (!startTime) return '--:--';
  const date = new Date(startTime * 1000);
  const hm = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return hm;
  return `${date.toLocaleDateString([], { month: '2-digit', day: '2-digit' })} ${hm}`;
}
