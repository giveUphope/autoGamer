import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStreamTypewriter, type StreamTypewriter } from './useTypewriter';

/**
 * B5 打字机 composable 单测（fake timers，节奏 28ms tick × 19 字符正向 / 73 字符 rewind）：
 * live 逐步推进、全文增长续推、isReset rewind 一次、完成瞬间追平、历史块零动画零定时器。
 */

let api!: StreamTypewriter;
let wrapper: ReturnType<typeof mount> | null = null;

function mountHost(): void {
  const Host = defineComponent({
    setup() {
      api = useStreamTypewriter();
      return () => h('div');
    },
  });
  wrapper = mount(Host);
}

function sync(payload: {
  blockId: string;
  rawText?: string | null;
  nativeText?: string | null;
  live?: boolean;
  isReset?: boolean;
}): void {
  api.syncStreamBlock({
    blockId: payload.blockId,
    rawText: payload.rawText ?? null,
    nativeText: payload.nativeText ?? null,
    live: payload.live ?? false,
    isReset: payload.isReset ?? false,
  });
}

describe('useStreamTypewriter (B5 打字机)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mountHost();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
  });

  it('types live stream text step by step and cleans up the timer when done', () => {
    const full = 'x'.repeat(60);
    sync({ blockId: 'b1', rawText: full, live: true });
    expect(api.typedRaw('b1', full)).toBe('');
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(28);
    expect(api.typedRaw('b1', full)).toBe('x'.repeat(19));

    vi.advanceTimersByTime(56);
    expect(api.typedRaw('b1', full)).toBe('x'.repeat(57));

    vi.advanceTimersByTime(28);
    expect(api.typedRaw('b1', full)).toBe(full);

    // 追平后目标移除、定时器清理（只在 live 推进期间存在定时器）
    vi.advanceTimersByTime(28);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues typing from the current length when the stream text grows', () => {
    sync({ blockId: 'b1', rawText: 'abcde', live: true });
    vi.advanceTimersByTime(28 * 2);
    expect(api.typedRaw('b1', 'abcde')).toBe('abcde');
    expect(vi.getTimerCount()).toBe(0);

    // 全文增长：从已打出的长度继续推进
    sync({ blockId: 'b1', rawText: 'abcdefghij', live: true });
    expect(api.typedRaw('b1', 'abcdefghij')).toBe('abcde');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(28);
    expect(api.typedRaw('b1', 'abcdefghij')).toBe('abcdefghij');
  });

  it('rewinds to zero once on isReset and re-types when the retry stream arrives', () => {
    sync({
      blockId: 'b1',
      rawText: 'x'.repeat(100),
      nativeText: 'y'.repeat(40),
      live: true,
    });
    vi.advanceTimersByTime(28);
    expect(api.typedRaw('b1', 'x'.repeat(100))).toBe('x'.repeat(19));
    expect(api.typedNative('b1', 'y'.repeat(40))).toBe('y'.repeat(19));

    // isReset：双泳道按 rewind 速度（73 字符/帧）归零
    sync({
      blockId: 'b1',
      rawText: 'x'.repeat(100),
      nativeText: 'y'.repeat(40),
      live: true,
      isReset: true,
    });
    vi.advanceTimersByTime(28);
    expect(api.typedRaw('b1', 'x'.repeat(100))).toBe('');
    expect(api.typedNative('b1', 'y'.repeat(40))).toBe('');
    expect(vi.getTimerCount()).toBe(0);

    // 同一 block 的 isReset 持续期间不重复触发
    sync({
      blockId: 'b1',
      rawText: 'x'.repeat(100),
      nativeText: 'y'.repeat(40),
      live: true,
      isReset: true,
    });
    vi.advanceTimersByTime(28 * 5);
    expect(api.typedRaw('b1', 'x'.repeat(100))).toBe('');
    expect(vi.getTimerCount()).toBe(0);

    // 重试流到达（isReset 翻回 false）：归零重推进（母本 startTyping 语义）
    sync({ blockId: 'b1', rawText: 'z'.repeat(30), live: true });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(28);
    expect(api.typedRaw('b1', 'z'.repeat(30))).toBe('z'.repeat(19));
  });

  it('snaps to the full text the moment the stream completes', () => {
    const full = 'x'.repeat(60);
    sync({ blockId: 'b1', rawText: 'x'.repeat(50), live: true });
    vi.advanceTimersByTime(28);
    expect(api.typedRaw('b1', 'x'.repeat(50))).toBe('x'.repeat(19));

    // isCompleted 翻 true：完成瞬间追平全文（母本 isCompleted 分支）
    sync({ blockId: 'b1', rawText: full, live: false });
    expect(api.typedRaw('b1', full)).toBe(full);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never animates historical blocks (full text immediately, zero timers)', () => {
    sync({ blockId: 'b1', rawText: '历史执行内容', nativeText: '历史思考内容', live: false });
    expect(api.typedRaw('b1', '历史执行内容')).toBe('历史执行内容');
    expect(api.typedNative('b1', '历史思考内容')).toBe('历史思考内容');
    vi.advanceTimersByTime(28 * 10);
    expect(api.typedRaw('b1', '历史执行内容')).toBe('历史执行内容');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back to the full text for lanes it has never synced', () => {
    // 母本 getStreamDisplayText 的 fallback 语义（如 reset 块从未起打）
    expect(api.typedRaw('bX', 'fallback text')).toBe('fallback text');
    expect(api.typedNative('bX', 'fallback native')).toBe('fallback native');
  });
});
