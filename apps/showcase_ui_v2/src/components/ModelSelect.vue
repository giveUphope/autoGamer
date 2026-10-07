<script setup lang="ts">
/**
 * 模型（当前生效端点）选择器，三处共用：启动器提交行、工作台命令条、诊断向导的
 * 当前模型配置卡。状态只有一份——候选与当前值都读 system store，切换走
 * POST /api/system/endpoints/use，store 刷新后所有实例同步。
 * 选中即生效（写 artemis.jsonc 的 default 块），所以显示值单向绑定 store：
 * 切换失败时下拉自己弹回原来那条，不会留下"看着已切、其实没切"的错位。
 * 正在使用但从未存入端点库的端点占一个只读选项，避免出现"当前用着 A、列表里没有 A"。
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Message } from '@arco-design/web-vue';

import { ApiError } from '@/services/api';
import { useSystemStore } from '@/stores/system';
import type { CredentialEndpointRow } from '@/types/system.model';

const props = withDefaults(
  defineProps<{ size?: 'mini' | 'small' | 'medium' }>(),
  { size: 'small' },
);

/** 未存入端点库的当前端点没有可切换的名字，用固定哨兵占位。 */
const UNSAVED = '__current_unsaved__';

const { t } = useI18n();
const system = useSystemStore();
const isSwitching = ref(false);

onMounted(() => {
  // 诊断向导之外（启动器 / 工作台）没人拉这两份数据，选择器自己保证有得显示
  void system.fetchModelConfigEnv().catch(() => undefined);
  void system.fetchCredentialEntries().catch(() => undefined);
});

const activeRow = computed(
  () => system.credentialRows.find((row) => row.is_active) ?? null,
);

function optionLabel(row: CredentialEndpointRow): string {
  return [
    row.provider,
    `${row.api_format ?? ''}/${row.model ?? ''}`,
    row.api_base || t('model.noBase'),
  ]
    .filter(Boolean)
    .join(' · ');
}

const unsavedLabel = computed(() => {
  const dm = system.modelConfigEnv?.default_model;
  if (!dm?.model) return '';
  return [
    `${t('model.currentUnsaved')} · ${dm.provider ?? ''}/${dm.model}`,
    dm.api_base || t('model.noBase'),
  ]
    .filter(Boolean)
    .join(' · ');
});

const options = computed(() => {
  const saved = system.credentialRows
    .filter((row) => row.source === 'library' && row.provider)
    .map((row) => ({ value: row.provider as string, label: optionLabel(row) }));
  const currentIsSaved = activeRow.value?.source === 'library';
  if (!currentIsSaved && unsavedLabel.value) {
    saved.unshift({ value: UNSAVED, label: unsavedLabel.value });
  }
  return saved;
});

const selected = computed(() => {
  // 生效的是库记录就直接显示它的名字；否则必须落到那个只读哨兵上，
  // 不然选中项会指向列表里根本不存在的条目
  if (activeRow.value?.source === 'library' && activeRow.value.provider) {
    return activeRow.value.provider;
  }
  return unsavedLabel.value ? UNSAVED : '';
});

async function onChange(
  value:
    | string
    | number
    | boolean
    | Record<string, unknown>
    | (string | number | boolean | Record<string, unknown>)[],
): Promise<void> {
  const name = typeof value === 'string' ? value : '';
  if (!name || name === selected.value || name === UNSAVED || isSwitching.value) return;
  isSwitching.value = true;
  try {
    await system.useEndpoint(name);
  } catch (err) {
    Message.error(err instanceof ApiError ? err.detail || `HTTP ${err.status}` : String(err));
  } finally {
    isSwitching.value = false;
  }
}
</script>

<template>
  <a-select
    class="model-select"
    :size="props.size"
    :model-value="selected"
    :options="options"
    :loading="isSwitching"
    :disabled="isSwitching || options.length === 0"
    :placeholder="t('model.placeholder')"
    :popup-max-height="280"
    @change="onChange"
  />
</template>

<style scoped>
.model-select {
  min-width: 200px;
}
</style>
