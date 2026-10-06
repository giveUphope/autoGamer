<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * 工作台占位页（对应 Angular WorkspaceComponent）。
 * AgentStream 时间线、任务队列面板与浮动播放器在 M1-M4 里程碑实现。
 */
const { t } = useI18n();
</script>

<template>
  <main class="page">
    <h1 class="page-title">{{ t('workspace.title') }}</h1>
    <p class="page-desc">{{ t('workspace.description') }}</p>
    <a-empty description="M1+" />
  </main>
</template>
