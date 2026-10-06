import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/services/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

import { apiGet } from '@/services/api';
import { useSystemStore } from './system';

const apiGetMock = apiGet as unknown as Mock;

describe('system store — M1 最小连通性轮询', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('后端可达时 online=true', async () => {
    apiGetMock.mockResolvedValue({ status: 'idle' });
    const store = useSystemStore();

    await store.fetchStatus();

    expect(store.online).toBe(true);
    expect(store.lastCheckedAt).not.toBeNull();
  });

  it('后端不可达时 online=false（顶栏小圆点数据源）', async () => {
    apiGetMock.mockRejectedValue(new Error('down'));
    const store = useSystemStore();
    store.online = true;

    await store.fetchStatus();

    expect(store.online).toBe(false);
  });

  it('轮询在页面隐藏时跳过、可见时恢复', async () => {
    vi.useFakeTimers();
    apiGetMock.mockResolvedValue({ status: 'idle' });
    const store = useSystemStore();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    apiGetMock.mockClear();

    // 模拟页面隐藏
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(apiGetMock).not.toHaveBeenCalled();

    // 模拟恢复可见 → 立即刷新一次
    hiddenSpy.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(apiGetMock).toHaveBeenCalledTimes(1);

    store.stop();
    vi.useRealTimers();
    hiddenSpy.mockRestore();
  });
});
