<script setup lang="ts">
/**
 * 自定义模式下的端点信息填写表单。
 * 提供商为自由文本（用户自定义名称，仅作显示标签）；API 格式为独立下拉栏，
 * 提供主流三种协议（OpenAI 兼容 / Anthropic / Google Gemini）——xAI、
 * OpenRouter 等网关实际均走 OpenAI 兼容协议，不单列以免混淆。该下拉决定
 * 运行时的协议分派。数据经 saveModelConfig 写入 artemis.jsonc default 块与
 * .env，免去手动编辑配置文件；「测试连接」走 testApiKey（带 base_url）做
 * 不落库校验。预填值来自 modelConfigEnv。
 * 注意：下拉栏不能包在 <label> 里——label 会把点击转发给隐藏 input，
 * 导致下拉刚打开就被关闭。
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconEye, IconEyeInvisible, IconSave } from '@arco-design/web-vue/es/icon';

import { useSystemContract } from './contract';
import type { CredentialEndpointRow } from './contract';
import { errText } from './errors';

const props = defineProps<{
  /** 来自已保存端点表格的「编辑」回填；掩码 Key 不回填（留空即沿用现值）。 */
  prefill: CredentialEndpointRow | null;
}>();

const { t } = useI18n();
const system = useSystemContract();

const formatOptions = computed(() => [
  { value: 'openai', label: t('launcher.diagnostics.cred.formatOpenai') },
  { value: 'openai_responses', label: t('launcher.diagnostics.cred.formatOpenaiResponses') },
  { value: 'anthropic', label: t('launcher.diagnostics.cred.formatAnthropic') },
  { value: 'google', label: t('launcher.diagnostics.cred.formatGoogle') },
]);

const providerName = ref('');
const apiFormat = ref('openai');
const apiBase = ref('');
const model = ref('');
const apiKeyInput = ref('');
const showApiKey = ref(false);
const isEdited = ref(false);
const isSaving = ref(false);
const isTesting = ref(false);
const message = ref<string | null>(null);
const error = ref<string | null>(null);

const canTest = computed(() => Boolean(apiKeyInput.value.trim()) && !isTesting.value && !isSaving.value);
const canSave = computed(
  () =>
    Boolean(providerName.value.trim()) ||
    Boolean(apiBase.value.trim()) ||
    Boolean(model.value.trim()) ||
    Boolean(apiKeyInput.value.trim()),
);

// 已保存配置回填（用户编辑过后不再覆盖，对齐 Gemini key 的 effect 语义）
watch(
  () => system.modelConfigEnv?.default_model,
  (dm) => {
    if (!dm || isEdited.value) return;
    // 提供商显示名优先；旧配置没有 provider_label 时留空待用户填写
    providerName.value = dm.provider_label ?? '';
    if (dm.provider) apiFormat.value = dm.provider;
    if (dm.model) model.value = dm.model;
    if (dm.api_base) apiBase.value = dm.api_base;
  },
  { immediate: true },
);

// 「编辑」回填：把已保存端点记录的值载入表单重新编辑
watch(
  () => props.prefill,
  (p) => {
    if (!p) return;
    providerName.value = p.provider ?? '';
    if (p.api_format) apiFormat.value = p.api_format;
    apiBase.value = p.api_base ?? '';
    model.value = p.model ?? '';
    isEdited.value = true;
  },
);

let msgTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleMsgClear(): void {
  if (msgTimer) clearTimeout(msgTimer);
  msgTimer = setTimeout(() => {
    message.value = null;
    error.value = null;
  }, 5000);
}
onUnmounted(() => {
  if (msgTimer) clearTimeout(msgTimer);
});

async function testEndpoint(): Promise<void> {
  if (!canTest.value) return;
  isTesting.value = true;
  message.value = null;
  error.value = null;
  try {
    const res = await system.testApiKey(apiFormat.value, apiKeyInput.value.trim(), apiBase.value.trim() || undefined);
    if (res?.valid) message.value = res.message || t('launcher.diagnostics.cred.endpointTestOk');
    else error.value = res?.message || t('launcher.diagnostics.cred.endpointTestFail');
  } catch (err) {
    error.value = errText(err, t('launcher.diagnostics.cred.endpointTestError'));
  } finally {
    isTesting.value = false;
  }
  scheduleMsgClear();
}

async function saveEndpoint(): Promise<void> {
  if (!canSave.value || isSaving.value) return;
  isSaving.value = true;
  message.value = null;
  error.value = null;
  try {
    const apiKey = apiKeyInput.value.trim();
    const res = await system.saveModelConfig({
      provider: providerName.value.trim() || undefined,
      api_format: apiFormat.value,
      model: model.value.trim() || undefined,
      api_base: apiBase.value.trim() || undefined,
      api_key: apiKey || undefined,
    });
    message.value = res?.message || t('launcher.diagnostics.cred.endpointSaveOk');
    isEdited.value = false;
    if (apiKey) apiKeyInput.value = '';
  } catch (err) {
    error.value = errText(err, t('launcher.diagnostics.cred.endpointSaveFail'));
  } finally {
    isSaving.value = false;
  }
  scheduleMsgClear();
}
</script>

<template>
  <div class="endpoint-card">
    <div class="endpoint-head">
      <span class="endpoint-title">{{ t('launcher.diagnostics.cred.endpointTitle') }}</span>
      <span class="endpoint-sub">{{ t('launcher.diagnostics.cred.endpointSubtitle') }}</span>
    </div>

    <div class="endpoint-grid">
      <label class="field">
        <span class="field-label">{{ t('launcher.diagnostics.cred.endpointProviderLabel') }}</span>
        <a-input
          v-model="providerName"
          class="endpoint-provider-input"
          size="small"
          :placeholder="t('launcher.diagnostics.cred.endpointProviderPlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @input="isEdited = true"
        />
      </label>
      <div class="field">
        <span class="field-label">{{ t('launcher.diagnostics.cred.endpointFormatLabel') }}</span>
        <a-select
          v-model="apiFormat"
          class="endpoint-format-select"
          size="small"
          :options="formatOptions"
          @change="isEdited = true"
        />
        <span class="field-hint">{{ t('launcher.diagnostics.cred.endpointFormatHint') }}</span>
      </div>
      <label class="field field-wide">
        <span class="field-label">{{ t('launcher.diagnostics.cred.endpointBaseUrlLabel') }}</span>
        <a-input
          v-model="apiBase"
          class="endpoint-base-input"
          size="small"
          :placeholder="t('launcher.diagnostics.cred.endpointBaseUrlPlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @input="isEdited = true"
        />
      </label>
      <label class="field field-wide">
        <span class="field-label">{{ t('launcher.diagnostics.cred.endpointModelLabel') }}</span>
        <a-input
          v-model="model"
          class="endpoint-model-input"
          size="small"
          :placeholder="t('launcher.diagnostics.cred.endpointModelPlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @input="isEdited = true"
        />
      </label>
      <label class="field field-wide">
        <span class="field-label">{{ t('launcher.diagnostics.cred.endpointApiKeyLabel') }}</span>
        <div class="key-row">
          <a-input
            v-model="apiKeyInput"
            class="endpoint-key-input"
            size="small"
            :type="showApiKey ? 'text' : 'password'"
            :placeholder="t('launcher.diagnostics.cred.endpointApiKeyPlaceholder')"
            spellcheck="false"
            autocomplete="off"
            @input="isEdited = true"
          />
          <a-button
            type="outline"
            size="small"
            class="key-btn"
            :title="showApiKey ? t('launcher.diagnostics.cred.hideKey') : t('launcher.diagnostics.cred.showKey')"
            @click="showApiKey = !showApiKey"
          >
            <icon-eye-invisible v-if="showApiKey" />
            <icon-eye v-else />
          </a-button>
        </div>
      </label>
    </div>

    <div class="endpoint-actions">
      <a-button
        class="endpoint-test-btn"
        size="small"
        :loading="isTesting"
        :disabled="!canTest"
        @click="testEndpoint"
      >
        {{ isTesting ? t('launcher.diagnostics.cred.testing') : t('launcher.diagnostics.cred.endpointTestBtn') }}
      </a-button>
      <a-button
        class="endpoint-save-btn"
        type="primary"
        size="small"
        :loading="isSaving"
        :disabled="isTesting || !canSave"
        @click="saveEndpoint"
      >
        <template #icon>
          <icon-save />
        </template>
        {{ isSaving ? t('launcher.diagnostics.cred.endpointSaving') : t('launcher.diagnostics.cred.endpointSaveBtn') }}
      </a-button>
    </div>

    <a-alert v-if="message" type="success" class="endpoint-alert">{{ message }}</a-alert>
    <a-alert v-if="error" type="error" class="endpoint-alert">{{ error }}</a-alert>
  </div>
</template>

<style scoped>
.endpoint-card {
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-3);
  padding: 12px 14px;
}

.endpoint-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}

.endpoint-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.endpoint-sub {
  font-size: 12px;
  color: var(--color-text-3);
}

.endpoint-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}

@media (max-width: 720px) {
  .endpoint-grid {
    grid-template-columns: 1fr;
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.field-wide {
  grid-column: 1 / -1;
}

.field-label {
  font-size: 12px;
  color: var(--color-text-2);
}

.field-hint {
  font-size: 11px;
  color: var(--color-text-3);
  line-height: 1.4;
}

.key-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.key-row .endpoint-key-input {
  flex: 1;
}

.key-btn {
  flex-shrink: 0;
}

.endpoint-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.endpoint-alert {
  margin-top: 10px;
}
</style>
