/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/**
 * ARTEMIS showcase UI v2 (M0).
 *
 * - `base: '/'` + `build.outDir: 'dist/browser'`: FastAPI `server.py:_get_showcase_dist()`
 *   的候选列表已包含 `dist/browser`，CLI/start.sh 亦兼容，零后端改动即可托管。
 * - `server.proxy`: 与 Angular `proxy.conf.json` 对齐，代理 `/api`、`/images`、
 *   `/videos`、`/local_file` 到本机 FastAPI（默认 127.0.0.1:8000）。
 *   `/api` 必须移除浏览器 Origin：`SameOriginBoundaryMiddleware` 校验 Origin 与
 *   Host 一致，Vite 代理（changeOrigin 改写 Host）转发的请求若带
 *   `Origin: http://localhost:5173` 会被 403。见调研报告 §4.3。
 */
export default defineConfig({
  base: '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist/browser',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            // SameOriginBoundaryMiddleware: 去掉 Origin 后请求被视为非浏览器客户端而放行。
            // 同时覆盖 SSE（EventSource 同源请求会带 Origin 头）。
            proxyReq.removeHeader('origin');
          });
        },
      },
      '/images': { target: 'http://127.0.0.1:8000' },
      '/videos': { target: 'http://127.0.0.1:8000' },
      '/local_file': { target: 'http://127.0.0.1:8000' },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.spec.mjs'],
    setupFiles: ['src/test/setup.ts'],
  },
});
