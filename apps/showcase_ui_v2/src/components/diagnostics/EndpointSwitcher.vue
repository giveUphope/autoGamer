<script setup lang="ts">
/**
 * 当前端点切换行（渲染在「当前模型配置」卡内部，不再自立一张卡）。
 * 候选项来自端点库列表（system.credentialRows），前端不写死任何提供商或模型；
 * 端点库里的记录由「端点信息」表单保存产生，也可由用户直接编辑配置文件得到。
 * 选用走 /api/system/endpoints/use：后端按名字取记录写入 artemis.jsonc 的
 * default 块，密钥只在后端流转，成功后 store 一并刷新配置卡与列表。
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconSwap } from '@arco-design/web-vue/es/icon';

import { useSystemContract } from './contract';
import { errText } from './errors';

const { t } = useI18n();
const system = useSystemContract();

const selected = ref('');
const isApplying = ref(false);
const message = ref<string | null>(null);
const error = ref<string | null>(null);

/**
 * 候选只取端点库记录：只存在于 default 块的那条（用了但没存）本来就正在生效，
 * 按它的名字去"切换"要么命中同名的厂商 preset、要么 404，都不是用户点它时的预期。
 */
const candidates = computed(() =>
  (system.credentialRows ?? []).filter((row) => Boolean(row.provider) && row.source === 'library'),
);

const options = computed(() =>
  candidates.value.map((row) => ({
    value: row.provider as string,
    label: [
      row.provider,
      row.is_active ? t('launcher.diagnostics.cred.switchActive') : null,
      `${row.api_format ?? ''}/${row.model ?? ''}`,
      row.api_base || t('launcher.diagnostics.cred.switchNoBase'),
    ]
      .filter(Boolean)
      .join(' · '),
  })),
);

const selectedRow = computed(() =>
  candidates.value.find((row) => row.provider === selected.value),
);

// 重复选用当前端点不是空操作：记录里没写 fallback 时，应用会把现存的 fallback 清掉，
// 所以当前项只能看、不能点。
const canApply = computed(
  () => Boolean(selected.value) && !selectedRow.value?.is_active && !isApplying.value,
);

// 列表刷新后原名可能已被删除或改名，留着会让按钮对着一个不存在的端点
watch(candidates, (rows) => {
  if (selected.value && !rows.some((row) => row.provider === selected.value)) selected.value = '';
});

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

async function applySelected(): Promise<void> {
  if (!canApply.value) return;
  const name = selected.value;
  isApplying.value = true;
  message.value = null;
  error.value = null;
  try {
    const res = await system.useEndpoint(name);
    message.value = res?.message || t('launcher.diagnostics.cred.switchOk', { name });
  } catch (err) {
    error.value = errText(err, t('launcher.diagnostics.cred.switchFail'));
  } finally {
    isApplying.value = false;
  }
  scheduleMsgClear();
}
</script>

<template>
  <div v-if="options.length" class="endpoint-switch">
    <div class="switch-head">
      <span class="switch-title">{{ t('launcher.diagnostics.cred.switchTitle') }}</span>
      <span class="switch-sub">{{ t('launcher.diagnostics.cred.switchSubtitle') }}</span>
    </div>
    <div class="switch-row">
      <a-select
        v-model="selected"
        class="switch-select"
        size="small"
        :options="options"
        :disabled="isApplying"
        :placeholder="t('launcher.diagnostics.cred.switchPlaceholder')"
      />
      <a-button
        class="switch-apply-btn"
        type="primary"
        size="small"
        :loading="isApplying"
        :disabled="!canApply"
        @click="applySelected"
      >
        <template #icon>
          <icon-swap />
        </template>
        {{ t('launcher.diagnostics.cred.switchApplyBtn') }}
      </a-button>
    </div>
    <a-alert v-if="message" type="success" class="switch-alert">{{ message }}</a-alert>
    <a-alert v-if="error" type="error" class="switch-alert">{{ error }}</a-alert>
  </div>
</template>

<style scoped>
.endpoint-switch {
  border-top: 1px solid var(--color-border-2);
  padding-top: 10px;
  margin-bottom: 10px;
}

.switch-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.switch-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-1);
}

.switch-sub {
  font-size: 11px;
  color: var(--color-text-3);
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.switch-select {
  flex: 1;
  min-width: 0;
}

.switch-apply-btn {
  flex-shrink: 0;
}

.switch-alert {
  margin-top: 8px;
}
</style>
