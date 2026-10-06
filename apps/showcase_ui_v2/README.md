# ARTEMIS Showcase UI v2（Vue 3 + Arco Design Vue）

ARTEMIS Web 前端从 Angular 22 向 **Vue 3 + Arco Design Vue** 重构的新工程。
当前状态为 **M0 脚手架**：Angular 版（`apps/showcase_ui`）仍在主路径服务，
新旧切换发生在 **M6**。迁移方案与决策见
[`docs/research/vue3-arco-migration-research.md`](../../../docs/research/vue3-arco-migration-research.md)。

## 技术栈（决策 D4 / 报告 §3.1）

| 层 | 选型 |
| --- | --- |
| 构建 | Vite 7 |
| 框架 | Vue ^3.5（`<script setup>` Composition API） |
| 语言 | TypeScript ~5.9 |
| 状态 | Pinia ^3 |
| 路由 | Vue Router ^4.5（history 模式） |
| UI | @arco-design/web-vue ~2.58.0（暗色主题 + zh-CN locale） |
| i18n | vue-i18n ^11（默认 locale：zh-CN） |
| 测试 | Vitest + @vue/test-utils + jsdom |

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器（http://localhost:5173，API 代理到 127.0.0.1:8000）
npm run build      # 类型检查 + 产物构建，输出到 dist/browser/
npm run preview    # 本地预览构建产物
npm run test       # Vitest 单次运行
npm run test:watch # Vitest watch 模式
npm run typecheck  # 仅 vue-tsc 类型检查
```

## 与 FastAPI 的集成

- **开发期**：`npm run dev` 后访问 `http://localhost:5173`。`vite.config.ts` 将
  `/api`、`/images`、`/videos`、`/local_file` 代理到本机 FastAPI
  （默认 `http://127.0.0.1:8000`）。其中 `/api` 代理会移除浏览器
  `Origin` 头，绕过 `SameOriginBoundaryMiddleware` 的同源校验（否则 403），
  SSE（`/api/stream`）同样经此代理透传（报告 §4.3）。
- **托管期**：`npm run build` 输出到 `dist/browser/`（含内容 hash）。
  FastAPI `server.py:_get_showcase_dist()` 的探测候选列表已包含
  `dist/browser`，SPA history 回退由 catch-all 路由 `serve_showcase_spa`
  的 index.html 兜底天然支持，**后端零改动**（报告 §4.1）。
- **wheel 回退产物**：`artemis/resources/showcase_ui` 是 wheel 安装态的
  回退目录，切换上线时需将 Vue 产物同步进去（M6 checklist，报告 §4.2）。

## 路由

| 路径 | 视图 | 对应 Angular |
| --- | --- | --- |
| `/` | `views/LauncherView.vue` | `HomeComponent`（诊断向导 + 任务启动器） |
| `/workspace` | `views/WorkspaceView.vue` | `WorkspaceComponent`（时间线 + 队列 + 播放器） |
| `/check` | 重定向到 `/workspace` | 旧版流视图，已淘汰 |
| 其余 | 重定向到 `/` | catch-all |

## 目录结构（M0）

```
src/
  main.ts          入口：Pinia / Router / i18n / Arco 注册，body 暗色属性
  App.vue          a-config-provider（Arco zh-CN locale + theme="dark"）+ router-view
  router/          路由表
  stores/          Pinia 实例注册（M1 起按 session/stream/player/system 拆分）
  locales/         vue-i18n（zh-CN 默认，en-US 键集由测试锁定）
  styles/          全局样式入口（Arco 暗色基调）
  types/           从 Angular core/models 原样平移的 5 个类型契约文件
  views/           LauncherView / WorkspaceView（M0 占位）
  test/            Vitest 环境垫片
```

## 里程碑

M0 脚手架（当前）→ M1 会话列表/队列 → M2 详情/轨迹 → M3 SSE 实时流 →
M4 回放/投屏 → M5 系统诊断 → M6 i18n/主题/打包收尾与切换。
