<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconLeft, IconLoading, IconRight } from '@arco-design/web-vue/es/icon';

import { ApiError, apiGet, apiPost } from '@/services/api';
import { usePlayerStore } from '@/stores/player';
import { useSessionStore } from '@/stores/session';

/**
 * 步骤回放调试抽屉（B6）：
 * - `GET /api/sessions/{id}/replay_steps`：可回放 chunked 步骤元数据
 *   （{step_number, summary, is_replayed, param_defaults, ...}；404 = 无回放数据）；
 * - `GET /api/devices`（{serial, status}[]）与 `GET /api/replay/tools`
 *   （{name, display_name, description}[]）提供设备/工具选择；
 * - `GET /api/replay/config?tool_name=` 展示所选工具的参数说明
 *   （{name, default, input_type}[]）；
 * - "回放"先经 a-modal 二次确认（真实沙箱执行、期间占用设备），确认后
 *   POST /api/sessions/{id}/steps/{n}/replay（body: device_id / user_submits /
 *   tool_name / replay_id）；"查看上次结果"走 GET replay_traces；
 * - 结果（{live, preloaded} 轨迹树）在抽屉下方 a-collapse + <pre> 折叠展示。
 * 设备 / 工具 / 步骤任一未就绪时回放按钮禁用。
 */
interface DeviceItem {
  serial?: unknown;
  status?: unknown;
}

interface ToolItem {
  name?: unknown;
  display_name?: unknown;
  description?: unknown;
}

interface ToolParamDef {
  name?: unknown;
  default?: unknown;
  input_type?: unknown;
}

interface ReplayStep {
  step_number?: unknown;
  summary?: unknown;
  is_replayed?: unknown;
  param_defaults?: Record<string, Record<string, unknown>> | unknown;
}

type StepsState = 'idle' | 'loading' | 'ready' | 'notFound' | 'error';

interface ReplayResult {
  stepNumber: number;
  kind: 'replay' | 'last';
  live: unknown[];
  preloaded: unknown[];
}

const props = defineProps<{ visible: boolean; sessionId: string | null }>();
const emit = defineEmits<{ (e: 'update:visible', value: boolean): void }>();
const { t } = useI18n();
const playerStore = usePlayerStore();
const sessionStore = useSessionStore();

const globalError = ref<string | null>(null);
const requestError = ref<string | null>(null);

const devices = ref<DeviceItem[]>([]);
const devicesLoading = ref(false);
const selectedDevice = ref('');

const tools = ref<ToolItem[]>([]);
const toolsLoading = ref(false);
const selectedTool = ref('');

const toolConfig = ref<ToolParamDef[] | null>(null);
const toolConfigLoading = ref(false);

const steps = ref<ReplayStep[]>([]);
const stepsState = ref<StepsState>('idle');

const runningStep = ref<number | null>(null);
const lastResultLoading = ref<number | null>(null);
const pendingStep = ref<ReplayStep | null>(null);
const result = ref<ReplayResult | null>(null);

/** 屏幕回放查看器：/steps 的完整步骤记录（含前/后截图与摘要）。 */
interface ViewerStep {
  stepNumber: number;
  summary: string;
  preImage: string | null;
  postImage: string | null;
}
const viewerSteps = ref<ViewerStep[]>([]);
const viewerIndex = ref(0);
const stepListRef = ref<HTMLElement | null>(null);

/** 步骤列表滚动：把查看器当前对应的步骤滚动置顶。 */
async function scrollStepListToTop(stepNumberValue: number): Promise<void> {
  await nextTick();
  const list = stepListRef.value;
  const row = list?.querySelector(`.replay-step[data-step-number="${stepNumberValue}"]`);
  if (list && row) list.scrollTop = (row as HTMLElement).offsetTop - 2;
}

watch(viewerIndex, (idx) => {
  const step = viewerSteps.value[idx];
  if (step) void scrollStepListToTop(step.stepNumber);
});

const hasVideo = computed(() => Boolean(sessionStore.currentSession?.video_url));

const currentViewer = computed<ViewerStep | null>(() =>
  viewerSteps.value.length > 0
    ? viewerSteps.value[Math.min(viewerIndex.value, viewerSteps.value.length - 1)]!
    : null,
);

function viewerShift(delta: number): void {
  if (viewerSteps.value.length === 0) return;
  const next = viewerIndex.value + delta;
  viewerIndex.value = Math.max(0, Math.min(next, viewerSteps.value.length - 1));
}

/** 灯箱预览：展开大图并携带图片定义（动作前/动作后）与步骤号。 */
const lightboxIndex = ref<number | null>(null);

const lightboxImages = computed(() => {
  if (!currentViewer.value) return [];
  const out: Array<{ url: string; label: string }> = [];
  if (currentViewer.value.preImage) {
    out.push({ url: `/images/${currentViewer.value.preImage}`, label: t('workspace.replay.preImage') });
  }
  if (currentViewer.value.postImage) {
    out.push({ url: `/images/${currentViewer.value.postImage}`, label: t('workspace.replay.postImage') });
  }
  return out;
});

const lightboxCurrent = computed(() => {
  const idx = lightboxIndex.value;
  if (idx === null || idx < 0 || idx >= lightboxImages.value.length) return null;
  return { ...lightboxImages.value[idx]!, index: idx };
});

function openLightbox(index: number): void {
  lightboxIndex.value = index;
}

function closeLightbox(): void {
  lightboxIndex.value = null;
}

function lightboxShift(delta: number): void {
  const total = lightboxImages.value.length;
  if (lightboxIndex.value === null || total === 0) return;
  lightboxIndex.value = (lightboxIndex.value + delta + total) % total;
}

function onLightboxKeydown(e: KeyboardEvent): void {
  if (lightboxIndex.value === null) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') lightboxShift(-1);
  else if (e.key === 'ArrowRight') lightboxShift(1);
}

onMounted(() => window.addEventListener('keydown', onLightboxKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onLightboxKeydown));

function openFullVideo(): void {
  playerStore.openVideoPlayer();
}

async function fetchViewerSteps(sid: string): Promise<void> {
  try {
    const res = await apiGet<unknown[]>(`/api/sessions/${encodeURIComponent(sid)}/steps`);
    viewerSteps.value = arrayNodes(res)
      .map((item) => {
        const n: Record<string, unknown> =
          item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const num = Number(n.step_number);
        return {
          stepNumber: Number.isFinite(num) ? num : 0,
          summary: typeof n.summary === 'string' ? n.summary : '',
          preImage: typeof n.pre_image_name === 'string' && n.pre_image_name ? n.pre_image_name : null,
          postImage:
            typeof n.post_image_name === 'string' && n.post_image_name ? n.post_image_name : null,
        };
      })
      .sort((a, b) => a.stepNumber - b.stepNumber);
    viewerIndex.value = 0;
    void scrollStepListToTop(0);
  } catch {
    viewerSteps.value = [];
  }
}

const canReplay = computed(
  () =>
    Boolean(props.sessionId)
    && stepsState.value === 'ready'
    && steps.value.length > 0
    && Boolean(selectedDevice.value)
    && Boolean(selectedTool.value)
    && runningStep.value === null
    && pendingStep.value === null,
);

function detailOf(err: unknown): string {
  if (err instanceof ApiError) return err.detail || `HTTP ${err.status}`;
  return err instanceof Error && err.message ? err.message : String(err);
}

function stepNumber(step: ReplayStep): number {
  const num = Number(step?.step_number);
  return Number.isFinite(num) ? num : 0;
}

function deviceLabel(device: DeviceItem): string {
  const serial = typeof device?.serial === 'string' ? device.serial : '';
  const status = typeof device?.status === 'string' ? device.status : '';
  return status ? `${serial} · ${status}` : serial;
}

function toolLabel(tool: ToolItem): string {
  return (typeof tool?.display_name === 'string' && tool.display_name) || (typeof tool?.name === 'string' ? tool.name : '');
}

function stepSummary(step: ReplayStep): string {
  return typeof step?.summary === 'string' ? step.summary : '';
}

/** 步骤列表与顶部查看器联动：点行即查看该步截图。 */
function selectViewerStep(stepNumberValue: number): void {
  const idx = viewerSteps.value.findIndex((s) => s.stepNumber === stepNumberValue);
  if (idx >= 0) viewerIndex.value = idx;
}

/** 从步骤的 param_defaults[tool] 取回放入参（后端已按工具签名解析好默认值）。 */
function userSubmitsFor(step: ReplayStep, toolName: string): Record<string, unknown> {
  const defaults = step?.param_defaults;
  const perTool = defaults && typeof defaults === 'object' && !Array.isArray(defaults)
    ? (defaults as Record<string, unknown>)[toolName]
    : undefined;
  return perTool && typeof perTool === 'object' && !Array.isArray(perTool)
    ? { ...(perTool as Record<string, unknown>) }
    : {};
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function arrayNodes(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function fetchDevices(): Promise<void> {
  devicesLoading.value = true;
  try {
    const res = await apiGet<unknown>('/api/devices');
    devices.value = arrayNodes(res).filter(
      (item): item is DeviceItem => Boolean(item) && typeof item === 'object',
    );
    if (!selectedDevice.value) {
      const first = devices.value[0]?.serial;
      selectedDevice.value = typeof first === 'string' ? first : '';
    }
  } catch {
    devices.value = [];
  } finally {
    devicesLoading.value = false;
  }
}

async function fetchTools(): Promise<void> {
  toolsLoading.value = true;
  try {
    const res = await apiGet<unknown>('/api/replay/tools');
    tools.value = arrayNodes(res).filter(
      (item): item is ToolItem => Boolean(item) && typeof item === 'object',
    );
    if (!selectedTool.value) {
      const first = tools.value[0]?.name;
      selectedTool.value = typeof first === 'string' ? first : '';
    }
  } catch {
    tools.value = [];
  } finally {
    toolsLoading.value = false;
  }
}

async function fetchSteps(sid: string): Promise<void> {
  stepsState.value = 'loading';
  try {
    const res = await apiGet<unknown>(`/api/sessions/${encodeURIComponent(sid)}/replay_steps`);
    steps.value = arrayNodes(res).filter(
      (item): item is ReplayStep => Boolean(item) && typeof item === 'object',
    );
    stepsState.value = 'ready';
  } catch (err) {
    steps.value = [];
    stepsState.value = err instanceof ApiError && err.status === 404 ? 'notFound' : 'error';
  }
}

async function fetchToolConfig(toolName: string): Promise<void> {
  if (!toolName) {
    toolConfig.value = null;
    return;
  }
  toolConfigLoading.value = true;
  try {
    const res = await apiGet<unknown>('/api/replay/config', { params: { tool_name: toolName } });
    toolConfig.value = arrayNodes(res).filter(
      (item): item is ToolParamDef => Boolean(item) && typeof item === 'object',
    );
  } catch {
    toolConfig.value = null;
  } finally {
    toolConfigLoading.value = false;
  }
}

watch(selectedTool, (toolName) => {
  if (props.visible) void fetchToolConfig(toolName);
});

async function fetchAll(): Promise<void> {
  const sid = props.sessionId;
  if (!sid) return;
  globalError.value = null;
  requestError.value = null;
  result.value = null;
  pendingStep.value = null;
  toolConfig.value = null;
  selectedDevice.value = '';
  selectedTool.value = '';
  // 工具列表就绪后 selectedTool 变化会经 watch 触发 fetchToolConfig。
  await Promise.all([fetchDevices(), fetchTools(), fetchSteps(sid), fetchViewerSteps(sid)]);
}

// 仅抽屉打开时拉取；会话切换后若仍打开则重拉。
watch(
  () => [props.visible, props.sessionId] as const,
  ([visible]) => {
    if (visible) void fetchAll();
  },
  { immediate: true },
);

function requestReplay(step: ReplayStep): void {
  if (!canReplay.value) return;
  requestError.value = null;
  pendingStep.value = step;
}

function cancelReplay(): void {
  if (runningStep.value !== null) return;
  pendingStep.value = null;
}

async function confirmReplay(): Promise<void> {
  const step = pendingStep.value;
  const sid = props.sessionId;
  if (!step || !sid || runningStep.value !== null) return;
  const num = stepNumber(step);
  runningStep.value = num;
  requestError.value = null;
  try {
    const res = await apiPost<Record<string, unknown>>(
      `/api/sessions/${encodeURIComponent(sid)}/steps/${num}/replay`,
      {
        device_id: selectedDevice.value,
        user_submits: userSubmitsFor(step, selectedTool.value),
        tool_name: selectedTool.value,
        replay_id: null,
      },
    );
    result.value = {
      stepNumber: num,
      kind: 'replay',
      live: arrayNodes(res?.live),
      preloaded: arrayNodes(res?.preloaded),
    };
    pendingStep.value = null;
  } catch (err) {
    requestError.value = detailOf(err);
  } finally {
    runningStep.value = null;
  }
}

async function loadLastResult(step: ReplayStep): Promise<void> {
  const sid = props.sessionId;
  const num = stepNumber(step);
  if (!sid || lastResultLoading.value !== null) return;
  lastResultLoading.value = num;
  requestError.value = null;
  try {
    const res = await apiGet<Record<string, unknown>>(
      `/api/sessions/${encodeURIComponent(sid)}/steps/${num}/replay_traces`,
      { params: { tool_name: selectedTool.value } },
    );
    result.value = {
      stepNumber: num,
      kind: 'last',
      live: arrayNodes(res?.live),
      preloaded: arrayNodes(res?.preloaded),
    };
  } catch (err) {
    requestError.value = detailOf(err);
  } finally {
    lastResultLoading.value = null;
  }
}

function close(): void {
  emit('update:visible', false);
}
</script>

<template>
  <a-drawer
    :visible="visible"
    :width="520"
    :title="t('workspace.replay.title')"
    :footer="false"
    unmount-on-close
    @cancel="close"
  >
    <div class="replay-body">
      <a-alert v-if="globalError" type="error" class="replay-alert">
        {{ t('workspace.replay.loadFail') }}：{{ globalError }}
      </a-alert>
      <a-alert v-if="requestError" type="error" class="replay-alert">
        {{ t('workspace.replay.requestFail', { reason: requestError }) }}
      </a-alert>

      <!-- 屏幕回放查看器：选中步骤的前/后截图 + 导航 -->
      <div v-if="viewerSteps.length > 0" class="viewer">
        <div class="viewer-head">
          <span class="viewer-title">{{ t('workspace.replay.viewerTitle') }}</span>
          <a-button v-if="hasVideo" size="mini" type="outline" @click="openFullVideo">
            {{ t('workspace.replay.playVideo') }}
          </a-button>
        </div>
        <div class="viewer-stage">
          <a-button
            size="mini"
            class="viewer-nav"
            :disabled="viewerIndex <= 0"
            @click="viewerShift(-1)"
          >
            <template #icon><icon-left /></template>
          </a-button>
          <div
            class="viewer-images"
            :class="currentViewer?.postImage ? 'is-dual' : 'is-single'"
          >
            <figure
              v-if="currentViewer?.preImage"
              class="viewer-figure"
              :title="t('workspace.replay.preImage')"
              @click="openLightbox(0)"
            >
              <img :src="`/images/${currentViewer.preImage}`" alt="" />
              <figcaption>{{ t('workspace.replay.preImage') }}</figcaption>
            </figure>
            <figure
              v-if="currentViewer?.postImage"
              class="viewer-figure"
              :title="t('workspace.replay.postImage')"
              @click="openLightbox(1)"
            >
              <img :src="`/images/${currentViewer.postImage}`" alt="" />
              <figcaption>{{ t('workspace.replay.postImage') }}</figcaption>
            </figure>
          </div>
          <a-button
            size="mini"
            class="viewer-nav"
            :disabled="viewerIndex >= viewerSteps.length - 1"
            @click="viewerShift(1)"
          >
            <template #icon><icon-right /></template>
          </a-button>
        </div>
        <div v-if="currentViewer" class="viewer-caption">
          <span class="viewer-step-no">
            {{ t('workspace.replay.stepOf', { i: viewerIndex + 1, n: viewerSteps.length }) }}
          </span>
          <span class="viewer-summary" :title="currentViewer.summary">{{ currentViewer.summary }}</span>
        </div>
      </div>

      <a-divider v-if="viewerSteps.length > 0" class="replay-divider" />

      <!-- 设备 / 工具选择 -->
      <div class="replay-controls">
        <div class="control-row">
          <label class="control-label">{{ t('workspace.replay.deviceLabel') }}</label>
          <a-select
            v-model="selectedDevice"
            :placeholder="t('workspace.replay.devicePlaceholder')"
            :loading="devicesLoading"
            allow-clear
            size="small"
            class="control-select"
          >
            <a-option v-for="(device, i) in devices" :key="deviceLabel(device) || i" :value="String(device?.serial ?? '')">
              {{ deviceLabel(device) }}
            </a-option>
          </a-select>
          <div v-if="!devicesLoading && devices.length === 0" class="control-hint">
            {{ t('workspace.replay.deviceEmpty') }}
          </div>
        </div>
        <div class="control-row">
          <label class="control-label">{{ t('workspace.replay.toolLabel') }}</label>
          <a-select
            v-model="selectedTool"
            :placeholder="t('workspace.replay.toolPlaceholder')"
            :loading="toolsLoading"
            size="small"
            class="control-select"
          >
            <a-option v-for="(tool, i) in tools" :key="String(tool?.name ?? i)" :value="String(tool?.name ?? '')">
              {{ toolLabel(tool) }}
            </a-option>
          </a-select>
        </div>
        <div v-if="toolConfigLoading" class="control-hint">
          <icon-loading spin />
        </div>
        <div v-else-if="toolConfig && toolConfig.length > 0" class="tool-params">
          <div class="tool-params-title">{{ t('workspace.replay.paramsTitle') }}</div>
          <div v-for="(param, i) in toolConfig" :key="String(param?.name ?? i)" class="tool-param-row">
            <code class="tool-param-name">{{ String(param?.name ?? '') }}</code>
            <span class="tool-param-type">{{ String(param?.input_type ?? '') }}</span>
            <span class="tool-param-default">
              {{ param?.default === '' || param?.default === undefined || param?.default === null
                ? t('workspace.replay.paramNone')
                : String(param.default) }}
            </span>
          </div>
        </div>
      </div>

      <a-divider class="replay-divider" />

      <!-- 可回放步骤列表 -->
      <a-spin v-if="stepsState === 'loading'" :loading="true" class="steps-loading">
        <div class="loading-inner">{{ t('workspace.replay.stepsLoading') }}</div>
      </a-spin>
      <a-empty v-else-if="stepsState === 'notFound'" :description="t('workspace.replay.stepsEmpty')" />
      <a-empty
        v-else-if="stepsState === 'error'"
        :description="`${t('workspace.replay.loadFail')}：${t('workspace.replay.stepsEmpty')}`"
      />
      <a-empty v-else-if="stepsState === 'ready' && steps.length === 0" :description="t('workspace.replay.stepsEmpty')" />
      <div v-else ref="stepListRef" class="step-list">
        <div
          v-for="(step, i) in steps"
          :key="stepNumber(step) || i"
          class="replay-step"
          :class="{ 'is-viewing': currentViewer?.stepNumber === stepNumber(step) }"
          :data-step-number="stepNumber(step)"
          role="button"
          @click="selectViewerStep(stepNumber(step))"
        >
          <div class="step-head">
            <span class="step-title">
              {{ t('workspace.replay.stepPrefix') }} {{ stepNumber(step) }}
            </span>
            <a-tag v-if="step?.is_replayed === true" size="small" color="green" class="replayed-tag">
              {{ t('workspace.replay.replayedTag') }}
            </a-tag>
            <div class="step-actions">
              <a-button
                size="mini"
                type="primary"
                :disabled="!canReplay || runningStep === stepNumber(step)"
                :loading="runningStep === stepNumber(step)"
                @click.stop="requestReplay(step)"
              >
                {{ t('workspace.replay.replayBtn') }}
              </a-button>
              <a-button
                size="mini"
                :disabled="!selectedTool || lastResultLoading !== null || runningStep !== null"
                :loading="lastResultLoading === stepNumber(step)"
                @click.stop="loadLastResult(step)"
              >
                {{ t('workspace.replay.lastResultBtn') }}
              </a-button>
            </div>
          </div>
          <div v-if="stepSummary(step)" class="step-summary">{{ stepSummary(step) }}</div>
        </div>
      </div>

      <!-- 结果区（a-collapse + pre 折叠展示轨迹 JSON） -->
      <div v-if="result" class="replay-result">
        <div class="result-title">
          {{ t('workspace.replay.resultStep', { n: result.stepNumber }) }}
          · {{ result.kind === 'replay' ? t('workspace.replay.kindReplay') : t('workspace.replay.kindLast') }}
        </div>
        <a-empty
          v-if="result.live.length === 0 && result.preloaded.length === 0"
          :description="t('workspace.replay.resultEmpty')"
        />
        <a-collapse v-else :default-active-key="['live']">
          <a-collapse-item
            v-if="result.live.length > 0"
            key="live"
            :header="t('workspace.replay.liveLabel', { count: result.live.length })"
          >
            <pre class="result-json">{{ formatJson(result.live) }}</pre>
          </a-collapse-item>
          <a-collapse-item
            v-if="result.preloaded.length > 0"
            key="preloaded"
            :header="t('workspace.replay.preloadedLabel', { count: result.preloaded.length })"
          >
            <pre class="result-json">{{ formatJson(result.preloaded) }}</pre>
          </a-collapse-item>
        </a-collapse>
      </div>
    </div>

    <!-- 二次确认：真实沙箱执行，期间占用设备 -->
    <a-modal
      :visible="pendingStep !== null"
      :title="t('workspace.replay.confirmTitle')"
      :ok-text="t('workspace.replay.confirmOk')"
      :cancel-text="t('workspace.replay.cancel')"
      :ok-loading="runningStep !== null"
      :mask-closable="false"
      @ok="confirmReplay"
      @cancel="cancelReplay"
    >
      <div class="confirm-body">
        {{
          t('workspace.replay.confirmBody', {
            device: selectedDevice,
            step: pendingStep ? stepNumber(pendingStep) : '',
          })
        }}
      </div>
    </a-modal>

    <!-- 灯箱预览：大图 + 图片定义（动作前/动作后）+ 步骤号 + 切换 -->
    <div v-if="lightboxCurrent" class="lightbox" @click="closeLightbox">
      <div class="lightbox-inner" @click.stop>
        <div class="lightbox-top">
          <span class="lightbox-label">{{ lightboxCurrent.label }}</span>
          <span class="lightbox-step">
            {{ t('workspace.replay.stepPrefix') }} {{ currentViewer?.stepNumber }}
            · {{ lightboxCurrent.index + 1 }} / {{ lightboxImages.length }}
          </span>
          <button class="lightbox-close" aria-label="close" @click="closeLightbox">×</button>
        </div>
        <div class="lightbox-stage">
          <button
            v-if="lightboxImages.length > 1"
            class="lightbox-nav"
            @click="lightboxShift(-1)"
          >‹</button>
          <img class="lightbox-img" :src="lightboxCurrent.url" alt="" />
          <button
            v-if="lightboxImages.length > 1"
            class="lightbox-nav"
            @click="lightboxShift(1)"
          >›</button>
        </div>
      </div>
    </div>
  </a-drawer>
</template>

<style scoped>
.viewer {
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  padding: 10px;
  background-color: var(--color-fill-1);
}

.viewer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.viewer-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-text-2);
}

.viewer-stage {
  display: flex;
  align-items: center;
  gap: 8px;
}

.viewer-nav {
  flex-shrink: 0;
}

/* 按双图结构编排：双图两等列；单图只占一列宽并居中，避免拉伸满行。
   图片保持自然宽高比（不锁定 9/19、不加黑底），横竖屏均自适应无黑边。 */
.viewer-images {
  flex: 1;
  display: grid;
  gap: 8px;
  min-width: 0;
}

.viewer-images.is-dual {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.viewer-images.is-single {
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
}

.viewer-images.is-single .viewer-figure {
  width: 100%;
  max-width: calc(50% - 4px);
}

.viewer-figure {
  min-width: 0;
  margin: 0;
}

.viewer-figure img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--border-radius-small);
}

.viewer-figure figcaption {
  text-align: center;
  font-size: 11px;
  color: var(--color-text-3);
  margin-top: 2px;
}

.viewer-caption {
  margin-top: 8px;
  font-size: 12px;
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.viewer-step-no {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--color-text-2);
}

.viewer-summary {
  color: var(--color-text-3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.viewer-figure {
  cursor: zoom-in;
}

.viewer-figure:hover img {
  opacity: 0.92;
}

.lightbox {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
}

.lightbox-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 94vw;
}

.lightbox-top {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 0 4px 10px;
}

.lightbox-label {
  padding: 2px 10px;
  border-radius: var(--border-radius-small);
  background: rgb(var(--arcoblue-6));
  color: #fff;
  font-size: 12.5px;
}

.lightbox-step {
  color: rgba(255, 255, 255, 0.85);
  font-size: 12.5px;
}

.lightbox-close {
  margin-left: auto;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}

.lightbox-stage {
  display: flex;
  align-items: center;
  gap: 16px;
}

.lightbox-img {
  max-width: 88vw;
  max-height: 80vh;
  object-fit: contain;
  border-radius: var(--border-radius-small);
}

.lightbox-nav {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 20px;
  cursor: pointer;
}

.lightbox-nav:hover {
  background: rgba(255, 255, 255, 0.28);
}

.replay-step.is-viewing {
  background-color: var(--color-fill-2);
  box-shadow: inset 2px 0 0 rgb(var(--arcoblue-6));
}

.replay-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.replay-alert,
.viewer,
.replay-controls,
.replay-divider {
  flex-shrink: 0;
}

.replay-alert {
  margin-bottom: 0;
}

.replay-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.control-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.control-label {
  font-size: 12.5px;
  color: var(--color-text-2);
}

.control-select {
  width: 100%;
}

.control-hint {
  font-size: 12px;
  color: var(--color-text-3);
}

.tool-params {
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-small);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-params-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-2);
}

.tool-param-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  flex-wrap: wrap;
}

.tool-param-name {
  color: var(--color-text-1);
}

.tool-param-type {
  color: var(--color-text-3);
}

.tool-param-default {
  color: var(--color-text-2);
  overflow-wrap: anywhere;
}

.replay-divider {
  margin: 2px 0;
}

.steps-loading {
  display: block;
  width: 100%;
  padding: 24px 0;
}

.loading-inner {
  padding: 12px;
  color: var(--color-text-3);
  font-size: 13px;
}

.step-list {
  position: relative;
  flex: 1 1 0;
  min-height: 120px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.replay-step {
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-title {
  font-weight: 600;
  font-size: 13px;
}

.replayed-tag {
  flex-shrink: 0;
}

.step-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.step-summary {
  font-size: 12.5px;
  color: var(--color-text-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.replay-result {
  flex-shrink: 0;
  max-height: 42%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.result-title {
  font-weight: 600;
  font-size: 13px;
}

.result-json {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--color-text-2);
}

.confirm-body {
  font-size: 13px;
  line-height: 1.6;
}
</style>
