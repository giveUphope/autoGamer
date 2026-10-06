import { createRouter, createWebHistory } from 'vue-router';

/**
 * 路由表与 Angular 版 app.routes.ts 的三条路由对齐：
 * - `/`          → LauncherView（原 HomeComponent：System Setup + Task Launcher）
 * - `/workspace` → WorkspaceView（原 WorkspaceComponent）
 * - `/check`     → Angular 旧版流视图已淘汰（M3 后由 workspace 完整替代），重定向到 /workspace
 * - catch-all    → 重定向回 `/`
 *
 * history 模式由 FastAPI serve_showcase_spa 的 index.html 兜底天然支持。
 */
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'launcher',
      component: () => import('@/views/LauncherView.vue'),
    },
    {
      path: '/workspace',
      name: 'workspace',
      component: () => import('@/views/WorkspaceView.vue'),
    },
    {
      path: '/check',
      redirect: '/workspace',
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
});

export default router;
