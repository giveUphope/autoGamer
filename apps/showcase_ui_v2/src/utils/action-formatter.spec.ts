import { beforeEach, describe, expect, it } from 'vitest';

import i18n from '@/locales';
import {
  extractStepReplayFrames,
  getActionErrorMessage,
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

  it('keeps the legacy English error fallbacks', () => {
    expect(getActionErrorMessage({ action: 'click', args: {} })).toBe('Action Failed');
    expect(getActionErrorMessage({ action: 'click', error: 'Device unreachable' })).toBe('Device unreachable');
  });

  it('keeps the legacy English replay frame titles', () => {
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
    const frames = extractStepReplayFrames([
      { step_id: 's1', step_number: 1, post_image_name: 'p1.jpg', action_taken: { action: 'click' } },
    ]);
    expect(frames[0].title).toBe('步骤 1：轻点元素');
    i18n.global.locale.value = 'en-US';
  });
});
