<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { IconMoonFill, IconSunFill } from '@arco-design/web-vue/es/icon';

import { LOCALE_STORAGE_KEY } from '@/locales';
import { useSessionStore } from '@/stores/session';
import { useSystemStore } from '@/stores/system';

/**
 * 顶部导航（对应 Angular NavSwitcherComponent 的 M1 子集）：
 * 品牌名 + 两个页面入口 + 深浅色切换 + 中英文切换 + 连接小圆点 + 运行器状态 tag。
 */
const { t, locale } = useI18n();
const route = useRoute();
const sessionStore = useSessionStore();
const systemStore = useSystemStore();

const STATUS_COLOR: Record<string, string> = {
  idle: 'gray',
  running: 'green',
  paused: 'orange',
  offline: 'red',
  completed: 'gray',
};

const statusColor = computed(() => STATUS_COLOR[sessionStore.agentStatus] || 'gray');
const statusText = computed(() => t(`status.${sessionStore.agentStatus}`));

// ---- 深浅色主题切换（与 main.ts 的启动逻辑共用 body[arco-theme] 机制）----
type Theme = 'dark' | 'light';
const theme = ref<Theme>(
  (document.body.getAttribute('arco-theme') as Theme | null) === 'light' ? 'light' : 'dark',
);
const isDark = computed(() => theme.value === 'dark');

function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  document.body.setAttribute('arco-theme', theme.value);
  localStorage.setItem('artemis.theme', theme.value);
}

// ---- 中英文切换（持久化到 localStorage，locales/index.ts 启动时恢复）----
const isZh = computed(() => locale.value === 'zh-CN');

function toggleLocale(): void {
  const next = isZh.value ? 'en-US' : 'zh-CN';
  locale.value = next;
  localStorage.setItem(LOCALE_STORAGE_KEY, next);
}
</script>

<template>
  <header class="app-nav">
    <div class="nav-brand">ARTEMIS</div>
    <nav class="nav-links">
      <router-link to="/" class="nav-link" :class="{ active: route.name === 'launcher' }">
        {{ t('nav.launcher') }}
      </router-link>
      <router-link to="/workspace" class="nav-link" :class="{ active: route.name === 'workspace' }">
        {{ t('nav.workspace') }}
      </router-link>
    </nav>
    <div class="nav-status">
      <a-button
        size="mini"
        type="text"
        class="nav-toggle"
        :title="t('nav.toggleTheme')"
        @click="toggleTheme"
      >
        <icon-sun-fill v-if="isDark" />
        <icon-moon-fill v-else />
      </a-button>
      <a-button
        size="mini"
        type="text"
        class="nav-toggle nav-locale-toggle"
        :title="t('nav.toggleLocale')"
        @click="toggleLocale"
      >
        {{ isZh ? 'EN' : '中文' }}
      </a-button>
      <span class="conn-dot" :class="systemStore.online ? 'online' : 'offline'" />
      <span class="conn-text">
        {{ t(systemStore.online ? 'connection.online' : 'connection.offline') }}
      </span>
      <a-tag :color="statusColor" size="small">{{ statusText }}</a-tag>
    </div>
  </header>
</template>

<style scoped>
.app-nav {
  display: flex;
  align-items: center;
  gap: 20px;
  width: 100%;
}

.nav-brand {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--color-text-1);
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.nav-link {
  padding: 4px 12px;
  border-radius: var(--border-radius-medium);
  color: var(--color-text-2);
  text-decoration: none;
  font-size: 14px;
  transition:
    color 0.2s,
    background-color 0.2s;
}

.nav-link:hover {
  color: var(--color-text-1);
  background-color: var(--color-fill-2);
}

.nav-link.active {
  color: var(--color-text-1);
  background-color: var(--color-fill-3);
  font-weight: 500;
}

.nav-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-3);
}

.nav-toggle {
  color: var(--color-text-2);
  padding: 0 6px;
}

.nav-toggle:hover {
  color: var(--color-text-1);
}

.nav-locale-toggle {
  font-size: 12px;
  font-weight: 600;
}

.conn-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.conn-dot.online {
  background-color: rgb(var(--green-6));
  box-shadow: 0 0 6px rgb(var(--green-6) / 60%);
}

.conn-dot.offline {
  background-color: rgb(var(--red-6));
  box-shadow: 0 0 6px rgb(var(--red-6) / 60%);
}
</style>
