<script setup lang="ts">
/**
 * 统一凭据管理：用户自定义变量名与提供商，可添加多条并回显已配置项。
 * 值写入 .env（用户命名的变量），name→provider 绑定持久化于
 * credential_bindings.json 并在启动时回放；已知提供商会立即作用于当前会话。
 * 列表只显示掩码预览，密钥原文不回传前端。
 */
import { computed, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconDelete, IconPlus } from '@arco-design/web-vue/es/icon';

import { useSystemContract } from './contract';
import { errText } from './errors';

const { t } = useI18n();
const system = useSystemContract();

const newName = ref('');
const newProvider = ref('');
const newValue = ref('');
const showValue = ref(false);
const isSaving = ref(false);
const message = ref<string | null>(null);
const error = ref<string | null>(null);

const entries = computed(() => system.credentialEntries ?? []);
const canAdd = computed(
  () => Boolean(newName.value.trim()) && Boolean(newProvider.value.trim()) && !isSaving.value,
);

let msgTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleMsgClear(): void {
  if (msgTimer) clearTimeout(msgTimer);
  msgTimer = setTimeout(() => {
    message.value = null;
    error.value = null;
  }, 5000);
}
// 组件随向导常驻，卸载时清理定时器即可
onUnmounted(() => {
  if (msgTimer) clearTimeout(msgTimer);
});

async function addEntry(): Promise<void> {
  if (!canAdd.value) return;
  isSaving.value = true;
  message.value = null;
  error.value = null;
  try {
    const res = await system.saveCredentialEntry({
      name: newName.value.trim(),
      provider: newProvider.value.trim(),
      value: newValue.value.trim() || undefined,
    });
    message.value = res?.message || t('launcher.diagnostics.cred.credsSaveOk');
    newName.value = '';
    newProvider.value = '';
    newValue.value = '';
  } catch (err) {
    error.value = errText(err, t('launcher.diagnostics.cred.credsSaveFail'));
  } finally {
    isSaving.value = false;
  }
  scheduleMsgClear();
}

async function removeEntry(name: string): Promise<void> {
  message.value = null;
  error.value = null;
  try {
    const res = await system.deleteCredentialEntry(name);
    message.value = res?.message || t('launcher.diagnostics.cred.credsDeleteOk');
  } catch (err) {
    error.value = errText(err, t('launcher.diagnostics.cred.credsDeleteFail'));
  }
  scheduleMsgClear();
}
</script>

<template>
  <div class="creds-card">
    <div class="creds-head">
      <span class="creds-title">{{ t('launcher.diagnostics.cred.credsTitle') }}</span>
      <span class="creds-sub">{{ t('launcher.diagnostics.cred.credsSubtitle') }}</span>
    </div>

    <!-- 已配置条目列表 -->
    <div v-if="entries.length" class="creds-list">
      <div v-for="entry in entries" :key="entry.name" class="creds-row">
        <code class="creds-name">{{ entry.name }}</code>
        <a-tag size="small" class="creds-provider">{{ entry.provider }}</a-tag>
        <a-tag v-if="entry.is_set" color="green" size="small">
          {{ t('launcher.diagnostics.cred.envSet') }}
        </a-tag>
        <a-tag v-else color="gray" size="small">{{ t('launcher.diagnostics.cred.envUnset') }}</a-tag>
        <code v-if="entry.preview" class="creds-preview">{{ entry.preview }}</code>
        <span v-else class="creds-preview placeholder">—</span>
        <a-popconfirm
          :content="t('launcher.diagnostics.cred.credsDeleteConfirm')"
          type="warning"
          @ok="removeEntry(entry.name)"
        >
          <a-button size="mini" type="text" class="creds-delete-btn" :title="t('launcher.diagnostics.cred.credsDeleteBtn')">
            <icon-delete />
          </a-button>
        </a-popconfirm>
      </div>
    </div>
    <p v-else class="creds-empty">{{ t('launcher.diagnostics.cred.credsEmpty') }}</p>

    <!-- 新增表单 -->
    <div class="creds-add-grid">
      <label class="creds-field">
        <span class="creds-field-label">{{ t('launcher.diagnostics.cred.credsNameLabel') }}</span>
        <a-input
          v-model="newName"
          class="creds-name-input"
          size="small"
          :placeholder="t('launcher.diagnostics.cred.credsNamePlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @keyup.enter="addEntry"
        />
      </label>
      <label class="creds-field">
        <span class="creds-field-label">{{ t('launcher.diagnostics.cred.credsProviderLabel') }}</span>
        <a-input
          v-model="newProvider"
          class="creds-provider-input"
          size="small"
          :placeholder="t('launcher.diagnostics.cred.credsProviderPlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @keyup.enter="addEntry"
        />
      </label>
      <label class="creds-field">
        <span class="creds-field-label">{{ t('launcher.diagnostics.cred.credsValueLabel') }}</span>
        <a-input
          v-model="newValue"
          class="creds-value-input"
          size="small"
          :type="showValue ? 'text' : 'password'"
          :placeholder="t('launcher.diagnostics.cred.credsValuePlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @keyup.enter="addEntry"
        />
      </label>
      <a-button
        class="creds-add-btn"
        type="primary"
        size="small"
        :loading="isSaving"
        :disabled="!canAdd"
        @click="addEntry"
      >
        <template #icon>
          <icon-plus />
        </template>
        {{ isSaving ? t('launcher.diagnostics.cred.credsAdding') : t('launcher.diagnostics.cred.credsAddBtn') }}
      </a-button>
    </div>

    <a-alert v-if="message" type="success" class="creds-alert">{{ message }}</a-alert>
    <a-alert v-if="error" type="error" class="creds-alert">{{ error }}</a-alert>
  </div>
</template>

<style scoped>
.creds-card {
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-3);
  padding: 12px 14px;
}

.creds-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}

.creds-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.creds-sub {
  font-size: 12px;
  color: var(--color-text-3);
}

.creds-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.creds-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-small);
  background-color: var(--color-bg-2);
}

.creds-name {
  color: var(--color-text-1);
  font-family: var(--font-mono, monospace);
  min-width: 120px;
}

.creds-preview {
  flex: 1;
  font-family: var(--font-mono, monospace);
  color: var(--color-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.creds-preview.placeholder {
  flex: 1;
}

.creds-delete-btn {
  color: var(--color-text-3);
  flex-shrink: 0;
}

.creds-delete-btn:hover {
  color: rgb(var(--red-6));
}

.creds-empty {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--color-text-3);
}

.creds-add-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.4fr) auto;
  gap: 10px 12px;
  align-items: end;
  border-top: 1px solid var(--color-border-2);
  padding-top: 10px;
}

@media (max-width: 720px) {
  .creds-add-grid {
    grid-template-columns: 1fr;
  }
}

.creds-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.creds-field-label {
  font-size: 12px;
  color: var(--color-text-2);
}

.creds-alert {
  margin-top: 10px;
}
</style>
