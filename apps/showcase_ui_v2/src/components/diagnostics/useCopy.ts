/**
 * 剪贴板复制 + "已复制"反馈（对齐 Angular HomeComponent 的 copiedId 交互）。
 * jsdom / 剪贴板不可用时静默失败，不中断 UI。
 */
import { ref } from 'vue';

export function useCopy(timeoutMs = 2000) {
  const copiedId = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function copy(text: string, id: string): Promise<void> {
    if (!text) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      copiedId.value = id;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (copiedId.value === id) copiedId.value = null;
      }, timeoutMs);
    } catch {
      // 剪贴板写入被拒绝时静默失败
    }
  }

  return { copiedId, copy };
}
