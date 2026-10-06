import { createPinia } from 'pinia';

/**
 * 全局 Pinia 实例（替代 Angular 的 providedIn: 'root' service 信号状态）。
 *
 * 已落地：
 * - stores/session.ts（会话合并 4 步算法 + 2s/6s 轮询 + 乐观更新 + localStorage 缓存，M1）
 * - stores/system.ts（最小 /api/status 连通性轮询，M1；完整诊断在 M5 扩展）
 *
 * 后续里程碑：
 * - stores/stream.ts（SSE 连接与合批，M3）
 * - stores/player.ts（视频回放状态机，M4）
 */
const pinia = createPinia();

export default pinia;
