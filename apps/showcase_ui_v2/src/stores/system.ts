/**
 * 系统 store —— M1 最小实现。
 *
 * Angular SystemService（610 行）的完整职责（readiness 三步引导、ADB 管理、
 * emulator 生命周期、凭据配置）留给 M5 的 DiagnosticsWizard。M1 仅保留：
 * - 轻量 `/api/status` 连通性轮询（5s，页面隐藏时暂停，visibilitychange 立即刷新）
 * - 连接状态展示数据源（顶栏小圆点）
 */

import { ref } from 'vue';
import { defineStore } from 'pinia';

import { apiGet } from '@/services/api';

const POLL_INTERVAL_MS = 5000;

export const useSystemStore = defineStore('system', () => {
  /** 后端连通性（顶栏小圆点）。 */
  const online = ref<boolean>(true);
  const lastCheckedAt = ref<number | null>(null);

  let started = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function fetchStatus(): Promise<void> {
    try {
      await apiGet('/api/status');
      online.value = true;
      lastCheckedAt.value = Date.now();
    } catch {
      online.value = false;
    }
  }

  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && !document.hidden) {
      void fetchStatus();
    }
  };

  function start(intervalMs: number = POLL_INTERVAL_MS): void {
    if (started) return;
    started = true;
    void fetchStatus();
    timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      void fetchStatus();
    }, intervalMs);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    started = false;
  }

  return { online, lastCheckedAt, fetchStatus, start, stop };
});
