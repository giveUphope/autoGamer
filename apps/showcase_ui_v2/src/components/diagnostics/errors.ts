/**
 * 后端错误 → 展示文案：优先 FastAPI detail（对齐 Angular `err?.error?.detail` 的取法）。
 */
import { ApiError } from '@/services/api';

export function errText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.detail || err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}
