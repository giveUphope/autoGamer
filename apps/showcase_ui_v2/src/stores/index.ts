import { createPinia } from 'pinia';

/**
 * 全局 Pinia 实例（替代 Angular 的两个 providedIn: 'root' service 信号状态）。
 *
 * M0 仅注册 Pinia；M1 起按迁移方案拆分 store：
 * - stores/session.ts（会话合并算法 + 轮询 + 乐观更新）
 * - stores/stream.ts（SSE 连接与合批）
 * - stores/player.ts（视频回放状态机）
 * - stores/system.ts（系统诊断轮询）
 */
const pinia = createPinia();

export default pinia;
