<script setup lang="ts">
/**
 * 诊断向导 STEP 2：AI 模型配置。
 * 仅保留自定义路径，无模式二选一：端点信息表单（provider / API 端点地址 /
 * 模型名称 / 可选 Key）写入 artemis.jsonc default 块与 .env；统一凭据管理
 * （CredentialsManager）由用户自定义变量名与提供商、多条增删并回显；
 * 当前模型配置卡只读展示 default 摘要与完整 JSONC（预设列表已移除）。
 * 挂载即跳过凭据检查并拉取 modelConfigEnv（对齐 Angular setModelSetupMode 语义）。
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconCheck, IconCopy } from '@arco-design/web-vue/es/icon';

import { useSystemContract } from './contract';
import type { CredentialEndpointRow } from './contract';
import { useCopy } from './useCopy';
import CredentialsManager from './CredentialsManager.vue';
import EndpointConfigForm from './EndpointConfigForm.vue';

const { t } = useI18n();
const system = useSystemContract();
const { copiedId, copy } = useCopy();

const env = computed(() => system.modelConfigEnv);

// 「编辑」：把表格行回填进上方端点信息表单并滚动过去重新编辑
const editingEndpoint = ref<CredentialEndpointRow | null>(null);

function onEditEndpoint(row: CredentialEndpointRow): void {
  editingEndpoint.value = { ...row };
  void nextTick(() => {
    // 防御式调用：jsdom 等测试环境未实现 scrollIntoView
    document.querySelector('.endpoint-card')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });
}

onMounted(() => {
  system.setSkipCredentialsCheck(true);
  void system.fetchModelConfigEnv().catch(() => undefined);
});
</script>

<template>
  <section class="diag-step" :class="system.isCredentialsReady ? 'is-pass' : 'is-pending'">
    <header class="diag-step-header">
      <span class="diag-step-badge" :class="{ pass: system.isCredentialsReady }">
        <icon-check v-if="system.isCredentialsReady" />
        <span v-else>2</span>
      </span>
      <div class="diag-step-info">
        <h3 class="diag-step-title">{{ t('launcher.diagnostics.cred.title') }}</h3>
        <p class="diag-step-desc">{{ t('launcher.diagnostics.cred.desc') }}</p>
      </div>
    </header>

    <div class="diag-step-body">
      <div class="cred-panel">
        <!-- 端点信息填写：唯一录入入口；「编辑」时由下方表格回填 -->
        <EndpointConfigForm :prefill="editingEndpoint" />

        <a-alert v-if="!env" type="info">{{ t('launcher.diagnostics.cred.notLoaded') }}</a-alert>
        <div v-else class="inspector-card">
          <div class="inspector-head">
            <div class="inspector-titles">
              <span class="inspector-title">{{ t('launcher.diagnostics.cred.cfgTitle') }}</span>
              <span class="inspector-sub">
                {{ t('launcher.diagnostics.cred.cfgSubtitle', { path: env.config_path }) }}
                <button
                  type="button"
                  class="copy-btn"
                  :class="{ copied: copiedId === 'config_path_btn' }"
                  @click="copy(env.config_path, 'config_path_btn')"
                >
                  <icon-check v-if="copiedId === 'config_path_btn'" />
                  <icon-copy v-else />
                  <span>{{ copiedId === 'config_path_btn' ? t('launcher.diagnostics.copied') : t('launcher.diagnostics.cred.copyPath') }}</span>
                </button>
              </span>
            </div>
          </div>

          <div class="model-summary-row">
            <div class="summary-metric">
              <span class="metric-label">{{ t('launcher.diagnostics.cred.defaultModel') }}</span>
              <span class="metric-pill">
                {{ env.default_model?.provider || 'google' }} / {{ env.default_model?.model || 'gemini-3.8-flash' }}
              </span>
              <span v-if="env.default_model?.thinking_level" class="metric-tag">
                {{ t('launcher.diagnostics.cred.thinkingLevel') }}: {{ env.default_model.thinking_level }}
              </span>
            </div>
            <div v-if="env.default_model?.fallback" class="summary-metric">
              <span class="metric-label">{{ t('launcher.diagnostics.cred.fallbackModel') }}</span>
              <span class="metric-pill secondary">
                {{ env.default_model.fallback.provider }}/{{ env.default_model.fallback.model }}
              </span>
            </div>
          </div>

          <a-collapse v-if="env.config_content" class="jsonc-collapse">
            <a-collapse-item key="jsonc" :header="t('launcher.diagnostics.cred.viewJsonc')">
              <pre class="jsonc-code"><code>{{ env.config_content }}</code></pre>
            </a-collapse-item>
          </a-collapse>
        </div>

        <!-- 已保存端点记录表格：编辑回填上方表单，删除移除配置 -->
        <CredentialsManager @edit="onEditEndpoint" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.diag-step {
  background-color: var(--color-bg-2);
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  padding: 16px 20px 20px;
  margin-bottom: 16px;
}

.diag-step.is-pass {
  border-color: rgb(var(--green-6) / 45%);
}

.diag-step.is-pending {
  border-color: rgb(var(--orange-6) / 45%);
}

.diag-step-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.diag-step-badge {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
  background-color: var(--color-fill-3);
  color: var(--color-text-2);
}

.diag-step-badge.pass {
  background-color: rgb(var(--green-6));
  color: #fff;
}

.diag-step-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-1);
}

.diag-step-desc {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--color-text-3);
}

.cred-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.inspector-card {
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-3);
  padding: 12px 14px;
}

.inspector-head {
  margin-bottom: 10px;
}

.inspector-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.inspector-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.inspector-sub {
  font-size: 12px;
  color: var(--color-text-3);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.model-summary-row {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.summary-metric {
  display: flex;
  align-items: center;
  gap: 8px;
}

.metric-label {
  font-size: 12px;
  color: var(--color-text-3);
}

.metric-pill {
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  color: var(--color-text-1);
  background-color: var(--color-fill-2);
  border: 1px solid var(--color-border-2);
  border-radius: 999px;
  padding: 2px 10px;
}

.metric-pill.secondary {
  color: var(--color-text-2);
}

.metric-tag {
  font-size: 11px;
  color: var(--color-text-3);
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-small);
  padding: 1px 6px;
}

.jsonc-collapse {
  margin-bottom: 10px;
}

.jsonc-code {
  margin: 0;
  padding: 10px 12px;
  background-color: var(--color-fill-2);
  border-radius: var(--border-radius-small);
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  color: var(--color-text-2);
  overflow: auto;
  max-height: 320px;
  white-space: pre-wrap;
  word-break: break-word;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--color-text-3);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--border-radius-small);
}

.copy-btn:hover {
  color: var(--color-text-1);
  background-color: var(--color-fill-3);
}

.copy-btn.copied {
  color: rgb(var(--green-6));
}
</style>
