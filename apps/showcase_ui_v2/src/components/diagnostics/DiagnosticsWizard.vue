<script setup lang="ts">
/**
 * 诊断向导容器：三步引导（环境 / 凭据 / 设备）。
 * 顶部：三步完成度（passedStepCount/totalStepCount）+ 跳过凭据复选框 + 手动
 * "重新检测"（fetchReadiness(false, true) + loading，对齐 Angular refreshReadiness）。
 * 挂载时拉取 readiness / adb server 状态 / model-config-env，并启动 readiness 轮询；
 * 模拟器启动期间驱动 1s 状态轮询（start/stopEmulatorStatusPolling）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconLaunch, IconRefresh } from '@arco-design/web-vue/es/icon';

import CredentialsStep from './CredentialsStep.vue';
import DeviceStep from './DeviceStep.vue';
import EnvironmentStep from './EnvironmentStep.vue';
import { useSystemContract } from './contract';

const emit = defineEmits<{ (e: 'proceed'): void }>();

const { t } = useI18n();
const system = useSystemContract();

const isRefreshing = ref(false);
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

async function refreshReadiness(): Promise<void> {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    await system.fetchReadiness(false, true);
    await system.fetchModelConfigEnv().catch(() => undefined);
  } catch {
    // 错误已在报告数据中体现，不中断 UI
  } finally {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      isRefreshing.value = false;
    }, 450);
  }
}

onMounted(() => {
  void system.fetchReadiness().catch(() => undefined);
  void system.fetchModelConfigEnv().catch(() => undefined);
  void system.fetchAdbServerStatus().catch(() => undefined);
  system.startAutoPolling();
});

onUnmounted(() => {
  system.stopAutoPolling();
  system.stopEmulatorStatusPolling();
  if (refreshTimer) clearTimeout(refreshTimer);
});

// 模拟器启动期间驱动状态轮询（1s 进度刷新由 store 实现）
watch(
  () => system.isEmulatorLaunching,
  (launching) => {
    if (launching) system.startEmulatorStatusPolling();
    else system.stopEmulatorStatusPolling();
  },
  { immediate: true },
);

function onSkipCredentialsChange(value: boolean | (string | number | boolean)[]): void {
  system.setSkipCredentialsCheck(value === true);
}

const stepProgress = computed(() =>
  system.totalStepCount > 0 ? system.passedStepCount / system.totalStepCount : 0,
);
</script>

<template>
  <div class="diag-wizard">
    <a-spin :loading="!system.hasReadinessReport && system.isLoading" style="display: block; width: 100%">
      <!-- 顶部：完成度 + 跳过凭据 + 重新检测 -->
      <div class="diag-topbar">
        <div class="diag-progress">
          <span class="diag-progress-label">{{ t('launcher.diagnostics.progressLabel') }}</span>
          <a-progress
            class="diag-progress-bar"
            :percent="stepProgress"
            :show-text="false"
            size="small"
            :status="system.isReady ? 'success' : 'normal'"
          />
          <span class="diag-progress-count">
            {{ t('launcher.diagnostics.progressOf', { passed: system.passedStepCount, total: system.totalStepCount }) }}
          </span>
        </div>
        <div class="diag-topbar-actions">
          <a-checkbox
            class="skip-cred-check"
            :model-value="system.isSkipCredentialsCheck"
            @change="onSkipCredentialsChange"
          >
            {{ t('launcher.diagnostics.skipCredentials') }}
          </a-checkbox>
          <a-button
            size="small"
            class="diag-recheck-btn"
            :loading="isRefreshing"
            @click="refreshReadiness"
          >
            <template #icon><icon-refresh /></template>
            {{ isRefreshing ? t('launcher.diagnostics.checking') : t('launcher.diagnostics.recheck') }}
          </a-button>
        </div>
      </div>

      <!-- STEP 1-3 -->
      <EnvironmentStep />
      <CredentialsStep />
      <DeviceStep />

      <!-- 就绪横幅：一键进入启动器 -->
      <div v-if="system.isReady" class="ready-banner">
        <div class="ready-texts">
          <div class="ready-title">{{ t('launcher.diagnostics.readyBanner.title') }}</div>
          <p class="ready-desc">{{ t('launcher.diagnostics.readyBanner.desc') }}</p>
        </div>
        <a-button type="primary" class="ready-launch-btn" @click="emit('proceed')">
          {{ t('launcher.diagnostics.readyBanner.launch') }}
          <template #icon><icon-launch /></template>
        </a-button>
      </div>
    </a-spin>
  </div>
</template>

<style scoped>
.diag-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  background-color: var(--color-bg-2);
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  padding: 12px 16px;
  margin-bottom: 16px;
}

.diag-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 220px;
}

.diag-progress-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
  white-space: nowrap;
}

.diag-progress-bar {
  flex: 1;
  max-width: 220px;
}

.diag-progress-count {
  font-size: 12px;
  color: var(--color-text-3);
  white-space: nowrap;
}

.diag-topbar-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.skip-cred-check {
  font-size: 12px;
}

.ready-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  border: 1px solid rgb(var(--green-6) / 55%);
  background-color: rgb(var(--green-1) / 35%);
  border-radius: var(--border-radius-medium);
  padding: 16px 20px;
  margin-top: 4px;
}

.ready-texts {
  flex: 1;
  min-width: 220px;
}

.ready-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-1);
}

.ready-desc {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-text-3);
}
</style>
