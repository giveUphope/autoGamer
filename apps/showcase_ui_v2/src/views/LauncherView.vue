<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * 启动器占位页（对应 Angular HomeComponent：System Setup + Task Launcher）。
 * M0 仅验证 Arco 组件渲染与 dev 代理连通性；诊断向导与任务启动器在 M1/M5 实现。
 */
const { t } = useI18n();

type PingState = { ok: boolean; text: string } | null;
const pingState = ref<PingState>(null);

async function onPingBackend(): Promise<void> {
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      pingState.value = { ok: true, text: t('launcher.pingOk') };
    } else {
      pingState.value = { ok: false, text: t('launcher.pingFail', { reason: `HTTP ${res.status}` }) };
    }
  } catch (err) {
    pingState.value = { ok: false, text: t('launcher.pingFail', { reason: String(err) }) };
  }
}
</script>

<template>
  <main class="page">
    <h1 class="page-title">{{ t('launcher.title') }}</h1>
    <p class="page-desc">{{ t('launcher.description') }}</p>
    <div class="launcher-actions">
      <a-button type="primary" @click="onPingBackend">
        {{ t('launcher.ping') }}
      </a-button>
      <a-tag v-if="pingState" :color="pingState.ok ? 'green' : 'red'">
        {{ pingState.text }}
      </a-tag>
    </div>
  </main>
</template>

<style scoped>
.launcher-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
