import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXPLORER_MODE,
  DEFAULT_VERIFICATION_LEVEL,
  EXPLORER_MODES,
  VERIFICATION_LEVELS,
  levelIndex,
  notchPercent,
} from './pro-tuning.model';
import { DEFAULT_STREAM_RESET_MESSAGE } from './stream.model';
import type {
  AgentStatusResponse,
  Session,
  SessionUsage,
  TaskQueueItem,
} from './session.model';
import type { CheckerBlockData, StepBlock, StepItemData } from './stream.model';
import type { MarkdownLine, MarkdownSegment, ParsedNote } from './markdown.model';
import type { SystemReadinessReport } from './system.model';

/**
 * 类型平移冒烟测试：core/models 下的 5 个模型文件从 Angular 工程
 * 原样复制而来，此处验证其可在无 Angular 依赖的 Vue 工程中正常
 * 编译与执行（类型仅作编译期检查，运行时断言覆盖纯函数）。
 */

describe('pro-tuning.model (copied verbatim from Angular project)', () => {
  it('exposes the documented defaults', () => {
    expect(DEFAULT_VERIFICATION_LEVEL).toBe('final');
    expect(DEFAULT_EXPLORER_MODE).toBe('flash');
    expect(VERIFICATION_LEVELS.map((l) => l.id)).toEqual([
      'off',
      'final',
      'checkpoints',
      'strict',
    ]);
    expect(EXPLORER_MODES.map((l) => l.id)).toEqual(['flash', 'pro', 'ultra']);
  });

  it('levelIndex resolves ids and falls back', () => {
    expect(levelIndex(VERIFICATION_LEVELS, 'strict', DEFAULT_VERIFICATION_LEVEL)).toBe(3);
    expect(levelIndex(VERIFICATION_LEVELS, 'unknown', DEFAULT_VERIFICATION_LEVEL)).toBe(1);
    expect(levelIndex(EXPLORER_MODES, null, DEFAULT_EXPLORER_MODE)).toBe(0);
  });

  it('notchPercent maps an index onto 0-100', () => {
    expect(notchPercent(0, 4)).toBe(0);
    expect(notchPercent(3, 4)).toBe(100);
    expect(notchPercent(1, 4)).toBeCloseTo(33.33, 1);
    expect(notchPercent(2, 1)).toBe(0);
  });
});

describe('stream.model (copied verbatim)', () => {
  it('exports the default stream reset message', () => {
    expect(DEFAULT_STREAM_RESET_MESSAGE).toContain('Retrying automatically');
  });
});

describe('type contracts compile without Angular dependencies', () => {
  it('accepts wire-shaped payloads', () => {
    const status: AgentStatusResponse = {
      status: 'idle',
      session_id: null,
      queue: [],
    };
    const session: Session = {
      session_id: 's1',
      initial_goal: 'demo',
      start_time: 0,
    };
    const queueItem: TaskQueueItem = {
      session_id: 's1',
      goal: 'demo',
      status: 'pending',
    };
    const usage: SessionUsage = {
      session_id: 's1',
      llm_calls: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cached_tokens: 0,
      operator_context_tokens: null,
      operator_context_window_tokens: 0,
    };
    const step: StepItemData = {
      step_id: 's1#1',
      step_number: 1,
      session_id: 's1',
      timestamp: 0,
    };
    const readiness: SystemReadinessReport = {
      overall_ready: false,
      blocker_count: 0,
      passed_blocker_count: 0,
      probes: [],
      active_device: null,
      timestamp: 0,
    };
    const note: ParsedNote = { title: null, milestones: [], otherLines: [] };
    const segment: MarkdownSegment = { text: 'hi', bold: false };
    const line: MarkdownLine = { type: 'text', segments: [segment], indent: 0 };
    const block: StepBlock = { id: 'b1', type: 'step', timestamp: '0', data: step };
    const checker: CheckerBlockData = { phase: 'checkpoint', status: 'running' };

    expect(status.status).toBe('idle');
    expect(session.initial_goal).toBe('demo');
    expect(queueItem.status).toBe('pending');
    expect(usage.total_tokens).toBe(0);
    expect(step.step_number).toBe(1);
    expect(readiness.probes).toHaveLength(0);
    expect(note.otherLines).toHaveLength(0);
    expect(line.segments[0]?.text).toBe('hi');
    expect(block.type).toBe('step');
    expect(checker.phase).toBe('checkpoint');
  });
});
