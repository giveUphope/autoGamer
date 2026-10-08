import { beforeEach, describe, expect, it } from 'vitest';

import i18n from '@/locales';
import {
  extractActionExtraParams,
  extractStepReplayFrames,
  getActionErrorMessage,
  getActionInputLabel,
  getActionTitle,
} from './action-formatter';

/**
 * util 层语义文案 i18n（M7 收尾）。en-US 断言逐字节锁定迁移前的硬编码英文输出
 *（验收线：en-US 输出与迁移前一致）；zh-CN 抽样核对 actions.* 中文键值。
 */
describe('action-formatter display copy (en-US)', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en-US';
  });

  it('keeps the legacy English action titles', () => {
    expect(getActionTitle(null)).toBe('Action');
    expect(getActionTitle({ action: 'tap' })).toBe('Tapping Element');
    expect(getActionTitle({ action: 'click' })).toBe('Tapping Element');
    expect(getActionTitle({ action: 'input_text' })).toBe('Entering Text');
    expect(getActionTitle({ action: 'focus_and_clear_text' })).toBe('Clearing Text');
    expect(getActionTitle({ action: 'swipe', args: { direction: 'up' } })).toBe('Swiping Screen (UP)');
    expect(getActionTitle({ action: 'scroll' })).toBe('Swiping Screen');
    expect(getActionTitle({ action: 'drag_and_drop' })).toBe('Dragging Screen');
    expect(getActionTitle({ action: 'press_key' })).toBe('Pressing Hardware Key');
    expect(getActionTitle({ action: 'launch_app' })).toBe('Launching Application');
    expect(getActionTitle({ action: 'stop_app' })).toBe('Stopping Application');
    expect(getActionTitle({ name: 'manage_app', action: 'launch' })).toBe('Launching Application');
    expect(getActionTitle({ name: 'manage_app', action: 'close' })).toBe('Stopping Application');
    expect(getActionTitle({ name: 'manage_app', action: 'restart' })).toBe('Managing Application');
    expect(getActionTitle({ name: 'manage_app' })).toBe('Managing Application');
    expect(getActionTitle({ action: 'wait_for_delay' })).toBe('Waiting for Delay');
    expect(getActionTitle({ action: 'long_press_on' })).toBe('Long Pressing Element');
    expect(getActionTitle({ action: 'click_sequence' })).toBe('Clicking Sequence');
    expect(getActionTitle({ action: 'foo_bar' })).toBe('Foo Bar');
  });

  it('keeps the legacy English input labels and error fallbacks', () => {
    expect(getActionInputLabel(null)).toBe('Input');
    expect(getActionInputLabel({ action: 'wait_for_delay' })).toBe('Duration');
    expect(getActionInputLabel({ action: 'swipe', args: { direction: 'up' } })).toBe('Direction');
    expect(getActionInputLabel({ action: 'swipe', args: { gesture: 'pinch zoom' } })).toBe('Input');
    expect(getActionInputLabel({ action: 'press_key' })).toBe('Key');
    expect(getActionInputLabel({ action: 'input_text' })).toBe('Input Text');
    expect(getActionInputLabel({ action: 'foo_bar' })).toBe('Input');

    expect(getActionErrorMessage({ action: 'click', args: {} })).toBe('Action Failed');
    expect(getActionErrorMessage({ action: 'click', error: 'Device unreachable' })).toBe('Device unreachable');
  });

  it('keeps the legacy English extra param labels and replay frame titles', () => {
    expect(extractActionExtraParams({ action: 'wait_for_delay', duration: 500 })).toEqual([
      { key: 'Duration', value: '500ms' },
    ]);

    const frames = extractStepReplayFrames([
      { step_id: 's1', step_number: 1, post_image_name: 'p1.jpg', action_taken: { action: 'click', args: { target_description: '设置' } } },
      { step_id: 's2', step_number: 2, post_image_name: 'p2.jpg' },
    ]);
    expect(frames).toHaveLength(2);
    expect(frames[0].title).toBe('Step 1: Tapping Element');
    expect(frames[0].actionText).toBe('Tapping Element (设置)');
    expect(frames[1].title).toBe('Step 2: Step 2');
    expect(frames[1].actionText).toBe('Step 2');
  });
});

describe('action-formatter display copy (zh-CN spot checks)', () => {
  it('renders the Chinese actions.* copy', () => {
    i18n.global.locale.value = 'zh-CN';
    expect(getActionTitle({ action: 'click' })).toBe('轻点元素');
    expect(getActionTitle({ action: 'swipe', args: { direction: 'up' } })).toBe('滑动屏幕（UP）');
    expect(extractActionExtraParams({ action: 'wait_for_delay', duration: 500 })).toEqual([
      { key: '时长', value: '500ms' },
    ]);
    const frames = extractStepReplayFrames([
      { step_id: 's1', step_number: 1, post_image_name: 'p1.jpg', action_taken: { action: 'click' } },
    ]);
    expect(frames[0].title).toBe('步骤 1：轻点元素');
    i18n.global.locale.value = 'en-US';
  });
});

describe('extractActionExtraParams — 调试字段由轨迹树承担', () => {
  it('排除 trace_id / parent_trace_id / payload / agent_name，不再平铺进时间线', () => {
    i18n.global.locale.value = 'en-US';
    const params = extractActionExtraParams({
      action: 'click',
      target_description: '返回按钮',
      trace_id: 'trace-1',
      parent_trace_id: 'trace-0',
      payload: { args: { target: [36, 85] } },
      agent_name: 'FlashRunner',
      duration: 120,
    });
    const keys = params.map((p) => p.key);
    expect(keys).not.toContain('Trace Id');
    expect(keys).not.toContain('Parent Trace Id');
    expect(keys).not.toContain('Payload');
    expect(keys).not.toContain('Agent Name');
    // 人类可读字段不受影响（target_description 由 StepCard 专用渲染器展示，此处本就不输出）
    expect(keys).toContain('Duration');
    i18n.global.locale.value = 'zh-CN';
  });
});
