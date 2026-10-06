<script setup lang="ts">
/**
 * 诊断向导 STEP 2：AI 模型配置。
 * 模式二选一（Gemini 推荐 / 自定义）。Gemini：当前 key 预览（显隐/复制）+ 测试
 * （testApiKey('google', key)）+ 保存（updateApiKey('google', key, true)）+ OCR 增强
 * 选项。自定义：modelConfigEnv 驱动——默认模型摘要、presets 只读列表、完整 JSONC
 * 查看器（a-collapse 内 <pre>）、.env keys 表格。切到自定义时跳过凭据检查
 * （对齐 Angular setModelSetupMode 语义）。后端 message 原样透传。
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  IconCheck,
  IconCopy,
  IconDelete,
  IconEye,
  IconEyeInvisible,
  IconLink,
  IconSave,
} from '@arco-design/web-vue/es/icon';

import { useSystemContract } from './contract';
import { errText } from './errors';
import { useCopy } from './useCopy';

const { t } = useI18n();
const system = useSystemContract();
const { copiedId, copy } = useCopy();

const GEMINI_PROVIDER = 'google';
const OCR_PROVIDER = 'ocr';
const AI_STUDIO_URL = 'https://aistudio.google.com/app/apikey';

const modelSetupMode = ref<'gemini' | 'custom'>('gemini');
const showOcrConfig = ref(false);

// ---- Gemini key 状态 ----
const geminiKeyInput = ref('');
const showGeminiKey = ref(false);
const isGeminiKeyEdited = ref(false);
const isSavingGeminiKey = ref(false);
const isTestingGeminiKey = ref(false);
const geminiMessage = ref<string | null>(null);
const geminiError = ref<string | null>(null);

// ---- OCR key 状态 ----
const ocrKeyInput = ref('');
const showOcrKey = ref(false);
const isOcrKeyEdited = ref(false);
const isSavingOcrKey = ref(false);
const isTestingOcrKey = ref(false);
const ocrMessage = ref<string | null>(null);
const ocrError = ref<string | null>(null);

const savedGeminiKey = computed(() => system.apiKeysMap?.[GEMINI_PROVIDER] || system.currentApiKey || '');
const isGeminiModified = computed(() => geminiKeyInput.value.trim() !== savedGeminiKey.value.trim());
const savedOcrKey = computed(() => system.apiKeysMap?.[OCR_PROVIDER] || '');
const isOcrModified = computed(() => ocrKeyInput.value.trim() !== savedOcrKey.value.trim());
const isOcrConfigured = computed(() => system.ocrProbe?.metadata?.['configured'] === true);

// 已保存 key 回填输入框（用户编辑过后不再覆盖，对齐 Angular 的 effect 语义）
watch(
  () => [system.apiKeysMap?.[GEMINI_PROVIDER], system.currentApiKey],
  () => {
    if (!isGeminiKeyEdited.value) geminiKeyInput.value = savedGeminiKey.value;
  },
  { immediate: true },
);
watch(
  () => system.apiKeysMap?.[OCR_PROVIDER],
  () => {
    if (!isOcrKeyEdited.value) ocrKeyInput.value = savedOcrKey.value;
  },
  { immediate: true },
);

let msgTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleMsgClear(clear: () => void): void {
  if (msgTimer) clearTimeout(msgTimer);
  msgTimer = setTimeout(clear, 5000);
}
onUnmounted(() => {
  if (msgTimer) clearTimeout(msgTimer);
});

function setMode(mode: 'gemini' | 'custom'): void {
  modelSetupMode.value = mode;
  if (mode === 'custom') {
    system.setSkipCredentialsCheck(true);
    void system.fetchModelConfigEnv().catch(() => undefined);
  } else {
    system.setSkipCredentialsCheck(false);
  }
}

// ---- 保存 / 测试（Gemini 与 OCR 共用流程）----
async function saveKey(provider: string, isSaving: { value: boolean }): Promise<void> {
  const isGemini = provider === GEMINI_PROVIDER;
  const key = (isGemini ? geminiKeyInput : ocrKeyInput).value.trim();
  if (isSaving.value) return;
  isSaving.value = true;
  if (isGemini) {
    geminiMessage.value = null;
    geminiError.value = null;
  } else {
    ocrMessage.value = null;
    ocrError.value = null;
  }
  try {
    const res = await system.updateApiKey(provider, key, true);
    if (isGemini) isGeminiKeyEdited.value = false;
    else isOcrKeyEdited.value = false;
    const fallback = isGemini
      ? key
        ? t('launcher.diagnostics.cred.savedOk')
        : t('launcher.diagnostics.cred.clearedOk')
      : key
        ? t('launcher.diagnostics.cred.ocrSavedOk')
        : t('launcher.diagnostics.cred.ocrClearedOk');
    const message = res?.message || fallback;
    if (isGemini) geminiMessage.value = message;
    else ocrMessage.value = message;
  } catch (err) {
    const fallback = isGemini
      ? key
        ? t('launcher.diagnostics.cred.saveFail')
        : t('launcher.diagnostics.cred.clearFail')
      : key
        ? t('launcher.diagnostics.cred.ocrSaveFail')
        : t('launcher.diagnostics.cred.ocrClearFail');
    if (isGemini) geminiError.value = errText(err, fallback);
    else ocrError.value = errText(err, fallback);
  } finally {
    isSaving.value = false;
  }
  scheduleMsgClear(() => {
    geminiMessage.value = null;
    ocrMessage.value = null;
  });
}

const saveGeminiKey = () => saveKey(GEMINI_PROVIDER, isSavingGeminiKey);
const saveOcrKey = () => saveKey(OCR_PROVIDER, isSavingOcrKey);

async function testKey(provider: string, key: string, isTesting: { value: boolean }): Promise<void> {
  if (!key || isTesting.value) return;
  isTesting.value = true;
  const isGemini = provider === GEMINI_PROVIDER;
  if (isGemini) {
    geminiMessage.value = null;
    geminiError.value = null;
  } else {
    ocrMessage.value = null;
    ocrError.value = null;
  }
  try {
    const res = await system.testApiKey(provider, key);
    if (res?.valid) {
      const message = res.message || (isGemini ? t('launcher.diagnostics.cred.testOk') : t('launcher.diagnostics.cred.ocrTestOk'));
      if (isGemini) geminiMessage.value = message;
      else ocrMessage.value = message;
    } else {
      const error = res?.message || (isGemini ? t('launcher.diagnostics.cred.testFail') : t('launcher.diagnostics.cred.ocrTestFail'));
      if (isGemini) geminiError.value = error;
      else ocrError.value = error;
    }
  } catch (err) {
    const fallback = isGemini ? t('launcher.diagnostics.cred.testError') : t('launcher.diagnostics.cred.ocrTestError');
    if (isGemini) geminiError.value = errText(err, fallback);
    else ocrError.value = errText(err, fallback);
  } finally {
    isTesting.value = false;
  }
  scheduleMsgClear(() => {
    geminiMessage.value = null;
    ocrMessage.value = null;
  });
}

const testGeminiKey = () => testKey(GEMINI_PROVIDER, geminiKeyInput.value.trim(), isTestingGeminiKey);
const testOcrKey = () => testKey(OCR_PROVIDER, ocrKeyInput.value.trim(), isTestingOcrKey);

// ---- 自定义模式（modelConfigEnv） ----
const env = computed(() => system.modelConfigEnv);
const presetEntries = computed(() => Object.entries(env.value?.presets ?? {}));
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
      <!-- 模式二选一 -->
      <div class="mode-cards">
        <button
          type="button"
          class="mode-card"
          :class="{ selected: modelSetupMode === 'gemini' }"
          @click="setMode('gemini')"
        >
          <span class="mode-radio" :class="{ checked: modelSetupMode === 'gemini' }" />
          <span class="mode-texts">
            <span class="mode-title-row">
              <span class="mode-title">{{ t('launcher.diagnostics.cred.modeGeminiTitle') }}</span>
              <a-tag color="green" size="small">{{ t('launcher.diagnostics.cred.modeGeminiTag') }}</a-tag>
            </span>
            <span class="mode-desc">{{ t('launcher.diagnostics.cred.modeGeminiDesc') }}</span>
          </span>
        </button>
        <button
          type="button"
          class="mode-card"
          :class="{ selected: modelSetupMode === 'custom' }"
          @click="setMode('custom')"
        >
          <span class="mode-radio" :class="{ checked: modelSetupMode === 'custom' }" />
          <span class="mode-texts">
            <span class="mode-title-row">
              <span class="mode-title">{{ t('launcher.diagnostics.cred.modeCustomTitle') }}</span>
            </span>
            <span class="mode-desc">{{ t('launcher.diagnostics.cred.modeCustomDesc') }}</span>
          </span>
        </button>
      </div>

      <!-- Gemini 面板 -->
      <div v-if="modelSetupMode === 'gemini'" class="cred-panel">
        <div class="cred-box">
          <div class="cred-box-head">
            <span class="cred-label">{{ t('launcher.diagnostics.cred.keyLabel') }}</span>
            <a :href="AI_STUDIO_URL" target="_blank" rel="noopener noreferrer" class="cred-link">
              <icon-link />
              <span>{{ t('launcher.diagnostics.cred.getKeyLink') }}</span>
            </a>
          </div>
          <div class="key-row">
            <a-input
              v-model="geminiKeyInput"
              class="key-input"
              :type="showGeminiKey ? 'text' : 'password'"
              :placeholder="t('launcher.diagnostics.cred.keyPlaceholder')"
              spellcheck="false"
              autocomplete="off"
              @input="isGeminiKeyEdited = true; geminiError = null; geminiMessage = null"
            />
            <a-button
              type="outline"
              size="small"
              class="key-btn"
              :title="showGeminiKey ? t('launcher.diagnostics.cred.hideKey') : t('launcher.diagnostics.cred.showKey')"
              @click="showGeminiKey = !showGeminiKey"
            >
              <icon-eye-invisible v-if="showGeminiKey" />
              <icon-eye v-else />
            </a-button>
            <a-button
              v-if="geminiKeyInput"
              type="outline"
              size="small"
              class="key-btn"
              :title="t('launcher.diagnostics.copy')"
              @click="copy(geminiKeyInput, 'gemini_key_field')"
            >
              <icon-check v-if="copiedId === 'gemini_key_field'" />
              <icon-copy v-else />
            </a-button>
          </div>
          <div class="key-actions">
            <a-button
              class="cred-save-btn"
              type="primary"
              size="small"
              :loading="isSavingGeminiKey"
              :disabled="isTestingGeminiKey || (!isGeminiModified && !geminiKeyInput.trim())"
              @click="saveGeminiKey"
            >
              <template #icon>
                <icon-delete v-if="!geminiKeyInput.trim()" />
                <icon-save v-else />
              </template>
              {{
                !geminiKeyInput.trim()
                  ? t('launcher.diagnostics.cred.clear')
                  : isGeminiModified
                    ? t('launcher.diagnostics.cred.saveApply')
                    : t('launcher.diagnostics.cred.save')
              }}
            </a-button>
            <a-button
              class="cred-test-btn"
              size="small"
              :loading="isTestingGeminiKey"
              :disabled="isSavingGeminiKey || !geminiKeyInput.trim()"
              @click="testGeminiKey"
            >
              {{ isTestingGeminiKey ? t('launcher.diagnostics.cred.testing') : t('launcher.diagnostics.cred.testKey') }}
            </a-button>
          </div>
          <a-alert v-if="geminiMessage" type="success" class="cred-alert">{{ geminiMessage }}</a-alert>
          <a-alert v-if="geminiError" type="error" class="cred-alert">{{ geminiError }}</a-alert>
        </div>

        <!-- OCR 增强（可选） -->
        <div class="ocr-card">
          <button type="button" class="ocr-toggle" @click="showOcrConfig = !showOcrConfig">
            <span class="ocr-toggle-title">{{ t('launcher.diagnostics.cred.ocrTitle') }}</span>
            <span class="ocr-toggle-right">
              <span v-if="isOcrConfigured" class="ocr-dot" :title="t('launcher.diagnostics.cred.ocrConfigured')" />
              <span class="ocr-caret">{{ showOcrConfig ? '▾' : '▸' }}</span>
            </span>
          </button>
          <div v-if="showOcrConfig" class="ocr-body">
            <p class="ocr-desc">{{ t('launcher.diagnostics.cred.ocrDesc') }}</p>
            <div class="key-row">
              <a-input
                v-model="ocrKeyInput"
                class="key-input"
                :type="showOcrKey ? 'text' : 'password'"
                :placeholder="t('launcher.diagnostics.cred.ocrKeyPlaceholder')"
                spellcheck="false"
                autocomplete="off"
                @input="isOcrKeyEdited = true; ocrError = null; ocrMessage = null"
              />
              <a-button
                type="outline"
                size="small"
                class="key-btn"
                :title="showOcrKey ? t('launcher.diagnostics.cred.hideKey') : t('launcher.diagnostics.cred.showKey')"
                @click="showOcrKey = !showOcrKey"
              >
                <icon-eye-invisible v-if="showOcrKey" />
                <icon-eye v-else />
              </a-button>
              <a-button
                v-if="ocrKeyInput"
                type="outline"
                size="small"
                class="key-btn"
                :title="t('launcher.diagnostics.copy')"
                @click="copy(ocrKeyInput, 'ocr_key_field')"
              >
                <icon-check v-if="copiedId === 'ocr_key_field'" />
                <icon-copy v-else />
              </a-button>
            </div>
            <div class="key-actions">
              <a-button
                class="ocr-save-btn"
                type="primary"
                size="small"
                :loading="isSavingOcrKey"
                :disabled="isTestingOcrKey || (!isOcrModified && !ocrKeyInput.trim())"
                @click="saveOcrKey"
              >
                <template #icon>
                  <icon-delete v-if="!ocrKeyInput.trim()" />
                  <icon-save v-else />
                </template>
                {{
                  !ocrKeyInput.trim()
                    ? t('launcher.diagnostics.cred.clear')
                    : isOcrModified
                      ? t('launcher.diagnostics.cred.saveApply')
                      : t('launcher.diagnostics.cred.save')
                }}
              </a-button>
              <a-button
                class="ocr-test-btn"
                size="small"
                :loading="isTestingOcrKey"
                :disabled="isSavingOcrKey || !ocrKeyInput.trim()"
                @click="testOcrKey"
              >
                {{ isTestingOcrKey ? t('launcher.diagnostics.cred.testing') : t('launcher.diagnostics.cred.testKey') }}
              </a-button>
            </div>
            <a-alert v-if="ocrMessage" type="success" class="cred-alert">{{ ocrMessage }}</a-alert>
            <a-alert v-if="ocrError" type="error" class="cred-alert">{{ ocrError }}</a-alert>
          </div>
        </div>
      </div>

      <!-- 自定义配置面板（modelConfigEnv 驱动） -->
      <div v-else class="cred-panel">
        <a-alert v-if="!env" type="info">{{ t('launcher.diagnostics.cred.notLoaded') }}</a-alert>
        <template v-else>
          <div class="inspector-card">
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

            <div v-if="presetEntries.length" class="presets">
              <div class="presets-title">{{ t('launcher.diagnostics.cred.presetsTitle') }}</div>
              <div v-for="[name, preset] in presetEntries" :key="name" class="preset-row">
                <code class="preset-name">{{ name }}</code>
                <span class="preset-value">{{ preset.provider }}/{{ preset.model }}</span>
                <span v-if="preset.fallback" class="preset-fallback">
                  → {{ preset.fallback.provider }}/{{ preset.fallback.model }}
                </span>
              </div>
            </div>
          </div>

          <div class="inspector-card">
            <div class="inspector-head">
              <div class="inspector-titles">
                <span class="inspector-title">{{ t('launcher.diagnostics.cred.envTitle') }}</span>
                <span class="inspector-sub">
                  {{ t('launcher.diagnostics.cred.envSubtitle', { path: env.env_path }) }}
                  <button
                    type="button"
                    class="copy-btn"
                    :class="{ copied: copiedId === 'env_path_btn' }"
                    @click="copy(env.env_path, 'env_path_btn')"
                  >
                    <icon-check v-if="copiedId === 'env_path_btn'" />
                    <icon-copy v-else />
                    <span>{{ copiedId === 'env_path_btn' ? t('launcher.diagnostics.copied') : t('launcher.diagnostics.cred.copyPath') }}</span>
                  </button>
                </span>
              </div>
            </div>
            <a-table :data="env.env_vars" :pagination="false" size="small" class="env-table">
              <template #columns>
                <a-table-column :title="t('launcher.diagnostics.cred.envColName')" data-index="name" />
                <a-table-column :title="t('launcher.diagnostics.cred.envColProvider')" data-index="provider" />
                <a-table-column :title="t('launcher.diagnostics.cred.envColStatus')" data-index="is_set" :width="110">
                  <template #cell="{ record }">
                    <a-tag v-if="record.is_set" color="green" size="small">{{ t('launcher.diagnostics.cred.envSet') }}</a-tag>
                    <a-tag v-else color="gray" size="small">{{ t('launcher.diagnostics.cred.envUnset') }}</a-tag>
                  </template>
                </a-table-column>
                <a-table-column :title="t('launcher.diagnostics.cred.envColPreview')" data-index="preview">
                  <template #cell="{ record }">
                    <code v-if="record.preview" class="env-preview">{{ record.preview }}</code>
                  </template>
                </a-table-column>
                <a-table-column :title="t('launcher.diagnostics.cred.envColDesc')" data-index="description" />
              </template>
            </a-table>
          </div>
        </template>
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

.mode-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

@media (max-width: 720px) {
  .mode-cards {
    grid-template-columns: 1fr;
  }
}

.mode-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  text-align: left;
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-3);
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.mode-card:hover {
  border-color: var(--color-border-3);
}

.mode-card.selected {
  border-color: rgb(var(--arcoblue-6));
}

.mode-radio {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--color-border-3);
  margin-top: 2px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.mode-radio.checked {
  border-color: rgb(var(--arcoblue-6));
  box-shadow: inset 0 0 0 3.5px rgb(var(--arcoblue-6));
  background-color: #fff;
}

.mode-texts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.mode-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mode-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.mode-desc {
  font-size: 12px;
  color: var(--color-text-3);
}

.cred-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cred-box,
.ocr-card,
.inspector-card {
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-3);
  padding: 12px 14px;
}

.cred-box-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.cred-label {
  font-size: 13px;
  color: var(--color-text-1);
  font-weight: 500;
}

.cred-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: rgb(var(--arcoblue-6));
  text-decoration: none;
}

.cred-link:hover {
  text-decoration: underline;
}

.key-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.key-input {
  flex: 1;
}

.key-btn {
  flex-shrink: 0;
}

.key-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.cred-alert {
  margin-top: 10px;
}

.ocr-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
}

.ocr-toggle-title {
  font-size: 13px;
  color: var(--color-text-1);
  font-weight: 500;
}

.ocr-toggle-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ocr-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: rgb(var(--green-6));
}

.ocr-caret {
  color: var(--color-text-3);
  font-size: 12px;
}

.ocr-body {
  margin-top: 10px;
  border-top: 1px solid var(--color-border-2);
  padding-top: 10px;
}

.ocr-desc {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--color-text-3);
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

.presets {
  border-top: 1px solid var(--color-border-2);
  padding-top: 8px;
}

.presets-title {
  font-size: 12px;
  color: var(--color-text-3);
  margin-bottom: 6px;
}

.preset-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  padding: 2px 0;
  color: var(--color-text-2);
}

.preset-name {
  color: var(--color-text-1);
  font-family: var(--font-mono, monospace);
  min-width: 90px;
}

.preset-fallback {
  color: var(--color-text-3);
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

.env-table :deep(.arco-table-td) {
  font-size: 12px;
}

.env-preview {
  font-family: var(--font-mono, monospace);
  color: var(--color-text-3);
}
</style>
