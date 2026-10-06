<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';

import arcoEnUS from '@arco-design/web-vue/es/locale/lang/en-us';
import arcoZhCN from '@arco-design/web-vue/es/locale/lang/zh-cn';

import { useSessionStore } from '@/stores/session';
import { useStreamStore } from '@/stores/stream';
import { useSystemStore } from '@/stores/system';

/**
 * 应用根组件：Arco ConfigProvider 统一提供中文 locale，页面经 router-view 渲染。
 *
 * 注意：@arco-design/web-vue 2.58.0 的 ConfigProvider 没有 `theme` 属性
 * （与 React 版不同）。暗色主题的官方机制是 body[arco-theme='dark'] 属性，
 * 已在 main.ts 中设置（arco.css 中有 60 条对应的暗色变量规则）。
 *
 * M1：session / system 两个 store 在应用根启动（对应 Angular providedIn: 'root'
 * 服务的构造期启动语义）：恢复缓存 + 2s/6s 双频轮询 + visibilitychange 立即刷新。
 */
const { locale } = useI18n();

const arcoLocale = computed(() => (locale.value === 'en-US' ? arcoEnUS : arcoZhCN));

const sessionStore = useSessionStore();
const systemStore = useSystemStore();
// M3：SSE 实时流单通道连接也随应用根启动。
const streamStore = useStreamStore();
sessionStore.start();
systemStore.start();
streamStore.start();
onBeforeUnmount(() => {
  sessionStore.stop();
  systemStore.stop();
  streamStore.stop();
});
</script>

<template>
  <a-config-provider :locale="arcoLocale">
    <router-view />
  </a-config-provider>
</template>
