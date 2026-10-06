/**
 * 平移自 Angular `utils/image-overlay.util.spec.ts` 的绘制相关用例
 * （叠加层为纯 DOM/SVG，无需真实 canvas 2D context，与 Angular spec 的
 * fake image 元素方式一致，jsdom 可直接运行）。
 */
import { describe, expect, it } from 'vitest';

import { drawActionCoordinatesOnOverlay } from './image-overlay';
import { unwrapTraceAction } from './image-coords';

// Trace records as the DataEngine publishes them in `generic_tools`.
const PRO_TAP_TRACE = {
  trace_id: 'pro-tap',
  type: 'action',
  name: 'tap',
  timestamp: 1788478482.05,
  status: 'success',
  payload: {
    action: {
      action: 'tap',
      coordinates: [922, 1710],
      coordinate_space: 'pixel',
      normalized_coordinates: [854, 705],
      target_text: 'YouTube'
    },
    success: true,
    post_screenshot: null
  }
};

const FLASH_CLICK_TRACE = {
  trace_id: 'flash-click',
  type: 'action',
  name: 'click',
  timestamp: 1788478305.12,
  status: 'success',
  payload: {
    args: { target: [618, 705], target_text: '相册' },
    result: '{"outcome": "Clicked"}'
  }
};

function fakeImage(): HTMLImageElement {
  return { naturalWidth: 1080, naturalHeight: 2424 } as unknown as HTMLImageElement;
}

describe('unwrapTraceAction（平移：image-overlay.util.spec.ts）', () => {
  it('flattens a Pro action trace (payload.action)', () => {
    const act = unwrapTraceAction(PRO_TAP_TRACE);
    expect(act.action).toBe('tap');
    expect(act.normalized_coordinates).toEqual([854, 705]);
    expect(act.target_text).toBe('YouTube');
    expect(act.trace_id).toBe('pro-tap');
    expect(act.timestamp).toBe(1788478482.05);
  });

  it('flattens a Flash action trace (payload.args)', () => {
    const act = unwrapTraceAction(FLASH_CLICK_TRACE);
    expect(act.action).toBe('click');
    expect(act.target).toEqual([618, 705]);
    expect(act.args.target).toEqual([618, 705]);
  });

  it('passes plain action objects through untouched', () => {
    const plain = { action: 'tap', normalized_coordinates: [10, 20] };
    expect(unwrapTraceAction(plain)).toBe(plain);
  });
});

describe('drawActionCoordinatesOnOverlay（平移：image-overlay.util.spec.ts）', () => {
  it('draws the tap marker for a Pro action trace', () => {
    const overlay = document.createElement('div');
    drawActionCoordinatesOnOverlay(fakeImage(), overlay, PRO_TAP_TRACE);
    const marker = overlay.querySelector('.action-point-marker') as HTMLElement;
    expect(marker).not.toBeNull();
    expect(marker.style.left).toBe('85.4%');
    expect(marker.style.top).toBe('70.5%');
  });

  it('draws the tap marker for a Flash action trace', () => {
    const overlay = document.createElement('div');
    drawActionCoordinatesOnOverlay(fakeImage(), overlay, FLASH_CLICK_TRACE);
    expect(overlay.querySelector('.action-point-marker')).not.toBeNull();
  });
});
