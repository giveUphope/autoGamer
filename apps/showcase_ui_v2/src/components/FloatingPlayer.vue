<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  IconCamera,
  IconClose,
  IconExpand,
  IconFileVideo,
  IconFullscreen,
  IconFullscreenExit,
  IconImage,
  IconLeft,
  IconLiveBroadcast,
  IconLoop,
  IconMinus,
  IconMute,
  IconPause,
  IconPlayArrow,
  IconPushpin,
  IconRefresh,
  IconRight,
  IconSound,
  IconSync,
} from '@arco-design/web-vue/es/icon';

import { usePlayerStore } from '@/stores/player';
import { getActionCoords, getActionIcon } from '@/utils/action-formatter';
import { drawActionCoordinatesOnOverlay } from '@/utils/image-overlay';
import { locateTimelineTime, sessionTimeToTimelineTime } from '@/utils/recording-timeline';
import type { StepReplayFrame } from '@/types/stream.model';

/**
 * 浮动播放器（M4，平移自 Angular FloatingVideoPlayerComponent 的完整交互语义，
 * 视觉按 Arco token 重做）。三种内容模式：
 * - live：任务运行中的 MJPEG 实时投屏（/api/stream/device-live，时间戳破缓存）；
 * - video：分段录像播放（ended 续播跨段、双时间轴 = 整场级 + 段内级 seek、
 *   消费 videoSeekRequest 会话级定位）；
 * - steps：step 截图帧回放（pre/post 切换、帧导航、stepSeekRequest 跳帧、
 *   pre 图上的动作坐标 canvas 叠加）。
 * 窗口 chrome：标题栏拖拽、最小化/还原、剧场模式、Escape 关闭。
 */
const { t } = useI18n();
const player = usePlayerStore();

// ---- 播放状态（平移自 Angular signals） ----
const isPlaying = ref(false);
const playbackRate = ref(1.0);
const isLooping = ref(false);
const currentTime = ref(0); // 整场（back-to-back 播放列表）轴秒数
const duration = ref(0); // 整场轴总时长
const isMuted = ref(false);
const isTheaterMode = ref(false);
const videoLoadError = ref(false);
const liveStreamUrl = ref('/api/stream/device-live');
const liveStreamError = ref(false);
const activeSegmentIndex = ref(0);
const segmentLocalTime = ref(0); // 当前段内秒数（段内时间轴）
// 非响应式 pending（与 Angular 私有字段一致）
let pendingLocalTime: number | null = null;
let pendingAutoplay = false;
let pendingAbsoluteSeek: number | null = null;
let lastVideoSeekRequestId = -1;
let lastStepSeekRequestId = -1;

// ---- Step 回放状态 ----
const activeStepIndex = ref(0);
const isStepPlaying = ref(false);
const viewMode = ref<'pre' | 'post'>('pre');
const isCardHovered = ref(false);
const isCardPinned = ref(false);
const isStepImageLoading = ref(false);
const stepImageError = ref(false);
let stepTimer: ReturnType<typeof setTimeout> | null = null;

// ---- 拖拽与窗口位置 ----
const posX = ref(typeof window !== 'undefined' ? Math.max(20, window.innerWidth - 420) : 100);
const posY = ref(typeof window !== 'undefined' ? Math.max(60, window.innerHeight - 700) : 100);
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let initialPosX = 0;
let initialPosY = 0;

const videoRef = ref<HTMLVideoElement | null>(null);
const stepImgRef = ref<HTMLImageElement | null>(null);
// 叠加层为普通 div：drawActionCoordinatesOnOverlay 以 DOM marker（div/svg）方式绘制
const stepOverlayRef = ref<HTMLElement | null>(null);

// ---- computed（平移自 Angular computed/signals） ----
const segments = computed(() => player.activeVideoSegments);

const currentVideoUrl = computed(() => {
  const list = segments.value;
  return list[activeSegmentIndex.value]?.url || player.activeVideoUrl || '';
});

const activeSegment = computed(() => segments.value[activeSegmentIndex.value] || null);

const speedOptions = [0.5, 1.0, 1.5, 2.0, 4.0];

const stepFrames = computed<StepReplayFrame[]>(() => player.currentSessionStepFrames);
const totalStepFrames = computed(() => stepFrames.value.length);
const currentStepFrame = computed<StepReplayFrame | null>(() => stepFrames.value[activeStepIndex.value] || null);
const currentStepImageUrl = computed(() => {
  const frame = currentStepFrame.value;
  if (!frame) return '';
  if (viewMode.value === 'post' && frame.postImageUrl) return frame.postImageUrl;
  return frame.preImageUrl || frame.imageUrl || '';
});
const currentStepCoords = computed(() => {
  const frame = currentStepFrame.value;
  if (!frame) return '';
  return frame.coords || (frame.action ? getActionCoords(frame.action) : '') || '';
});
const isCardVisible = computed(() => isCardHovered.value || isCardPinned.value);
const stepProgressPercent = computed(() => {
  const total = totalStepFrames.value;
  if (total <= 1) return 0;
  return (activeStepIndex.value / (total - 1)) * 100;
});

const progressPercent = computed(() => {
  const dur = duration.value;
  if (dur <= 0) return 0;
  return Math.min(100, Math.max(0, (currentTime.value / dur) * 100));
});

const segmentProgressPercent = computed(() => {
  const seg = activeSegment.value;
  const dur = seg?.duration || 0;
  if (dur <= 0) return 0;
  return Math.min(100, Math.max(0, (segmentLocalTime.value / dur) * 100));
});

/** 头部标题（平移自 Angular html L40 的标题分支）。 */
const headerTitle = computed(() => {
  if (player.recordingPlaybackStatus === 'live') return t('workspace.player.liveTitle');
  if (player.playerMode === 'steps') {
    const total = totalStepFrames.value;
    return t('workspace.player.stepReplayTitle', {
      current: total > 0 ? activeStepIndex.value + 1 : 0,
      total,
    });
  }
  if (player.recordingPlaybackStatus === 'processing') return t('workspace.player.preparingTitle');
  return player.activeVideoTitle || t('workspace.player.title');
});

/** 模式切换可见性（ready/unavailable 且有帧且未最小化；unavailable 时也要能切 steps）。 */
const canToggleMode = computed(
  () =>
    ['ready', 'unavailable'].includes(String(player.recordingPlaybackStatus))
    && player.hasCurrentSessionStepFrames
    && !player.isVideoMinimized,
);

/** video 加载态文案：后端透传优先，缺省按状态给 processing / finalizing 文案。 */
const loadingText = computed(() => {
  if (player.recordingPlaybackMessage) return player.recordingPlaybackMessage;
  return player.recordingPlaybackStatus === 'processing'
    ? t('workspace.player.processing')
    : t('workspace.player.finalizing');
});

const showVideoLoading = computed(
  () =>
    player.playerMode === 'video'
    && (player.recordingPlaybackStatus === 'processing' || player.isVideoLoading),
);

const videoViewVisible = computed(
  () =>
    player.playerMode === 'video'
    && player.recordingPlaybackStatus === 'ready'
    && !player.isVideoLoading
    && Boolean(player.activeVideoUrl),
);

/** 空态 fallback（平移自 Angular Option C）：failed/unavailable/加载错误且无帧。 */
const showEmptyFallback = computed(
  () =>
    !player.isVideoLoading
    && (player.playerMode === 'video' || totalStepFrames.value === 0)
    && (['failed', 'unavailable'].includes(String(player.recordingPlaybackStatus)) || videoLoadError.value)
    && totalStepFrames.value === 0,
);

/** unavailable / 加载失败但有帧：引导切换到 steps 模式。 */
const showStepsGuide = computed(
  () =>
    !player.isVideoLoading
    && player.playerMode === 'video'
    && totalStepFrames.value > 0
    && (player.recordingPlaybackStatus === 'unavailable' || videoLoadError.value),
);

// ---- 格式化 ----
function formatTime(seconds: number): string {
  if (Number.isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const mStr = mins < 10 ? `0${mins}` : String(mins);
  const sStr = secs < 10 ? `0${secs}` : String(secs);
  return `${mStr}:${sStr}`;
}

// ---- 拖拽（mousemove/mouseup 仅在拖拽期间挂载） ----
function startDrag(event: MouseEvent): void {
  if (isTheaterMode.value) return;
  isDragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  initialPosX = posX.value;
  initialPosY = posY.value;
  event.preventDefault();
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
}

const onDrag = (event: MouseEvent): void => {
  if (!isDragging) return;
  const deltaX = event.clientX - dragStartX;
  const deltaY = event.clientY - dragStartY;
  const minX = 10;
  const minY = 10;
  const maxX = Math.max(10, window.innerWidth - 240);
  const maxY = Math.max(10, window.innerHeight - 80);
  posX.value = Math.max(minX, Math.min(maxX, initialPosX + deltaX));
  posY.value = Math.max(minY, Math.min(maxY, initialPosY + deltaY));
};

const stopDrag = (): void => {
  isDragging = false;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
};

function onWindowResize(): void {
  const maxX = Math.max(10, window.innerWidth - 240);
  const maxY = Math.max(10, window.innerHeight - 80);
  if (posX.value > maxX) posX.value = maxX;
  if (posY.value > maxY) posY.value = maxY;
}

function onKeyDown(event: KeyboardEvent): void {
  if (!player.isVideoWindowOpen) return;
  if (event.key === 'Escape') {
    if (isTheaterMode.value) isTheaterMode.value = false;
    else player.closeVideoPlayer();
  }
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize);
  window.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
  if (stepTimer) {
    clearTimeout(stepTimer);
    stepTimer = null;
  }
});

// ---- live 流（时间戳破缓存，平移自 Angular retryLiveStream L198-201） ----
function onLiveStreamError(): void {
  liveStreamError.value = true;
}

function retryLiveStream(): void {
  liveStreamError.value = false;
  liveStreamUrl.value = `/api/stream/device-live?t=${Date.now()}`;
}

// ---- video 元素事件（平移自 Angular onLoadedMetadata/onTimeUpdate/onEnded...） ----
function onLoadedMetadata(): void {
  const v = videoRef.value;
  if (!v) return;
  const list = segments.value;
  if (!list.length) duration.value = v.duration || 0;
  videoLoadError.value = false;
  v.playbackRate = playbackRate.value;
  v.loop = isLooping.value && !list.length;
  v.muted = isMuted.value;
  if (pendingAbsoluteSeek !== null) {
    const target = pendingAbsoluteSeek;
    pendingAbsoluteSeek = null;
    seekToSessionTime(target, true);
    // seek 落在其他分段时切源，该段的 loadedmetadata 会接手 pendingLocalTime
    if (pendingLocalTime !== null) return;
  }
  if (pendingLocalTime !== null) {
    v.currentTime = Math.max(0, Math.min(v.duration || pendingLocalTime, pendingLocalTime));
    pendingLocalTime = null;
  }
  if (pendingAutoplay) {
    pendingAutoplay = false;
    v.play().catch(() => {});
  }
  if (player.consumeVideoAutoplay()) {
    isMuted.value = true;
    v.muted = true;
    v.play().catch(() => {
      isPlaying.value = false;
    });
  }
}

function onTimeUpdate(): void {
  const v = videoRef.value;
  if (!v) return;
  const seg = segments.value[activeSegmentIndex.value];
  currentTime.value = (seg?.start || 0) + v.currentTime;
  segmentLocalTime.value = v.currentTime;
  if (!segments.value.length && v.duration && v.duration !== duration.value) {
    duration.value = v.duration;
  }
}

function onPlay(): void {
  isPlaying.value = true;
}

function onPause(): void {
  isPlaying.value = false;
}

function onEnded(): void {
  const list = segments.value;
  if (list.length && activeSegmentIndex.value < list.length - 1) {
    // 跨段无缝续播：切下一段并自动播放（该段 loadedmetadata 应用 pending 值）
    pendingLocalTime = 0;
    pendingAutoplay = true;
    activeSegmentIndex.value += 1;
    return;
  }
  if (list.length && isLooping.value) {
    seek(0, true);
    return;
  }
  isPlaying.value = false;
}

function onError(): void {
  videoLoadError.value = true;
  isPlaying.value = false;
}

// ---- 播放控制 ----
function togglePlay(): void {
  const v = videoRef.value;
  if (!v) return;
  if (v.paused) v.play().catch(() => {});
  else v.pause();
}

function restart(): void {
  seek(0, true);
}

/** 会话轴时间（step 时间戳/analyzer range 使用的轴）→ seek。 */
function seekToSessionTime(sessionSeconds: number, autoplay = false): void {
  seek(sessionTimeToTimelineTime(segments.value, sessionSeconds), autoplay);
}

/** 整场（back-to-back 播放列表）轴 seek：跨段定位切换片段。 */
function seek(seconds: number, autoplay = false): void {
  const v = videoRef.value;
  if (!v) return;
  const target = Math.max(0, Math.min(duration.value, seconds));
  const location = locateTimelineTime(segments.value, target);
  if (!location) {
    v.currentTime = target;
    if (autoplay) v.play().catch(() => {});
    currentTime.value = target;
    return;
  }
  const { index, localTime } = location;
  if (index === activeSegmentIndex.value) {
    v.currentTime = localTime;
    if (autoplay) v.play().catch(() => {});
  } else {
    pendingLocalTime = localTime;
    pendingAutoplay = autoplay || !v.paused;
    activeSegmentIndex.value = index;
  }
  currentTime.value = target;
}

/** 整场时间轴拖动（会话级跨段定位）。 */
function onSessionScrub(event: Event): void {
  const input = event.target as HTMLInputElement;
  seek(parseFloat(input.value));
}

/** 段内时间轴拖动：仅调整当前分段内部位置。 */
function onSegmentScrub(event: Event): void {
  const input = event.target as HTMLInputElement;
  const v = videoRef.value;
  if (!v) return;
  const seg = activeSegment.value;
  const local = Math.max(0, Math.min(seg?.duration || v.duration || 0, parseFloat(input.value)));
  v.currentTime = local;
  segmentLocalTime.value = local;
  currentTime.value = (seg?.start || 0) + local;
}

function setSpeed(rate: number): void {
  playbackRate.value = rate;
  const v = videoRef.value;
  if (v) v.playbackRate = rate;
  if (isStepPlaying.value) scheduleNextStepFrame();
}

function cycleSpeed(): void {
  const idx = speedOptions.indexOf(playbackRate.value);
  setSpeed(speedOptions[(idx + 1) % speedOptions.length]);
}

function toggleLoop(): void {
  isLooping.value = !isLooping.value;
  const v = videoRef.value;
  if (v) v.loop = isLooping.value && !segments.value.length;
}

function toggleMute(): void {
  isMuted.value = !isMuted.value;
  const v = videoRef.value;
  if (v) v.muted = isMuted.value;
}

function toggleTheater(): void {
  isTheaterMode.value = !isTheaterMode.value;
}

function toggleMinimize(): void {
  player.toggleVideoMinimized();
}

function openInNewTab(): void {
  if (player.activeVideoUrl) window.open(player.activeVideoUrl, '_blank');
}

// ---- Step 回放控制 ----
function toggleStepPlay(): void {
  if (isStepPlaying.value) pauseStepPlay();
  else startStepPlay();
}

function startStepPlay(): void {
  if (totalStepFrames.value <= 0) return;
  if (activeStepIndex.value >= totalStepFrames.value - 1) activeStepIndex.value = 0;
  isStepPlaying.value = true;
  scheduleNextStepFrame();
}

function pauseStepPlay(): void {
  isStepPlaying.value = false;
  if (stepTimer) {
    clearTimeout(stepTimer);
    stepTimer = null;
  }
}

function scheduleNextStepFrame(): void {
  if (stepTimer) clearTimeout(stepTimer);
  const delay = Math.max(300, 1500 / playbackRate.value);
  stepTimer = setTimeout(() => {
    if (!isStepPlaying.value) return;
    if (activeStepIndex.value < totalStepFrames.value - 1) {
      activeStepIndex.value += 1;
      scheduleNextStepFrame();
    } else if (isLooping.value) {
      activeStepIndex.value = 0;
      scheduleNextStepFrame();
    } else {
      pauseStepPlay();
    }
  }, delay);
}

function prevStepFrame(): void {
  pauseStepPlay();
  viewMode.value = 'pre';
  activeStepIndex.value = Math.max(0, activeStepIndex.value - 1);
}

function nextStepFrame(): void {
  pauseStepPlay();
  viewMode.value = 'pre';
  activeStepIndex.value = Math.min(totalStepFrames.value - 1, activeStepIndex.value + 1);
}

function seekStepFrame(index: number): void {
  viewMode.value = 'pre';
  activeStepIndex.value = Math.max(0, Math.min(totalStepFrames.value - 1, index));
}

function onStepScrub(event: Event): void {
  const input = event.target as HTMLInputElement;
  seekStepFrame(parseInt(input.value, 10));
}

function restartStep(): void {
  seekStepFrame(0);
  startStepPlay();
}

function setStepViewMode(mode: 'pre' | 'post'): void {
  viewMode.value = mode;
  setTimeout(() => drawStepOverlay(), 40);
}

function toggleCardPin(event?: Event): void {
  event?.stopPropagation();
  isCardPinned.value = !isCardPinned.value;
}

function openStepImageInNewTab(): void {
  const url = currentStepImageUrl.value || currentStepFrame.value?.imageUrl;
  if (url) window.open(url, '_blank');
}

function getStepActionIcon(action: any): string {
  return getActionIcon(action);
}

function onStepImageLoad(): void {
  isStepImageLoading.value = false;
  stepImageError.value = false;
  drawStepOverlay();
}

function onStepImageError(): void {
  isStepImageLoading.value = false;
  stepImageError.value = true;
}

/** 把动作坐标画到叠加层（仅 pre 图；平移自 Angular drawStepOverlay L587-606）。 */
function drawStepOverlay(): void {
  const img = stepImgRef.value;
  const overlay = stepOverlayRef.value;
  if (!img || !overlay) return;
  overlay.innerHTML = '';

  // 仅动作前（pre）截图绘制坐标叠加
  if (viewMode.value !== 'pre') return;

  const frame = currentStepFrame.value;
  if (!frame || !frame.action) return;
  try {
    drawActionCoordinatesOnOverlay(img, overlay, frame.action);
  } catch (err) {
    console.warn('Failed to draw step coordinates overlay:', err);
  }
}

// ---- watches（平移自 Angular effects） ----

// activeVideoUrl/segments 变化：重置加载错误与分段位置（Angular effect L125-136；
// effect 创建即执行一次 → immediate，保证窗口打开时 duration 已是分段总长）
watch(
  () => [player.activeVideoUrl, player.activeVideoSegments] as const,
  () => {
    videoLoadError.value = false;
    activeSegmentIndex.value = 0;
    currentTime.value = 0;
    segmentLocalTime.value = 0;
    duration.value = segments.value.reduce((sum, seg) => sum + seg.duration, 0);
    isPlaying.value = false;
  },
  { immediate: true },
);

// 会话切换（step 帧集合签名变化）→ 重置回放；否则夹紧索引（Angular effect L138-154）
watch(
  () => stepFrames.value.map((f) => f.stepId || `${f.index}-${f.title}`).join('|'),
  () => {
    const total = totalStepFrames.value;
    if (total > 0 && activeStepIndex.value >= total) {
      activeStepIndex.value = total - 1;
      return;
    }
    activeStepIndex.value = 0;
    viewMode.value = 'pre';
    pauseStepPlay();
  },
);

// step 截图 URL 变化：重置 loading/error（Angular effect L156-165）
watch(currentStepImageUrl, (url) => {
  if (url) {
    isStepImageLoading.value = true;
    stepImageError.value = false;
  } else {
    isStepImageLoading.value = false;
  }
});

// 帧索引/视图模式变化后重绘叠加层（Angular effect L167-172）
watch([activeStepIndex, viewMode], () => {
  setTimeout(() => drawStepOverlay(), 40);
});

// videoSeekRequest 消费：requestId 变化时挂起会话级 seek，ready 且元数据就绪后执行
// （平移自 Angular effect L174-185）
watch(
  () => [player.videoSeekRequest?.requestId, player.recordingPlaybackStatus] as const,
  () => {
    const request = player.videoSeekRequest;
    if (!request || request.requestId === lastVideoSeekRequestId) return;
    lastVideoSeekRequestId = request.requestId;
    pendingAbsoluteSeek = request.seconds;
    if (player.recordingPlaybackStatus !== 'ready') return;
    const v = videoRef.value;
    if (v && v.readyState >= 1 && pendingAbsoluteSeek !== null) {
      const target = pendingAbsoluteSeek;
      pendingAbsoluteSeek = null;
      seekToSessionTime(target, true);
    }
  },
);

// stepSeekRequest 消费：requestId 变化时跳帧（Angular effect L187-191）
watch(
  () => player.stepSeekRequest?.requestId,
  (requestId) => {
    const request = player.stepSeekRequest;
    if (!request || requestId === undefined || requestId === lastStepSeekRequestId) return;
    lastStepSeekRequestId = requestId;
    seekStepFrame(request.index);
  },
);
</script>

<template>
  <!-- 剧场模式遮罩 -->
  <div v-if="player.isVideoWindowOpen && isTheaterMode" class="theater-backdrop" @click="isTheaterMode = false" />

  <div
    v-if="player.isVideoWindowOpen"
    class="floating-player"
    :class="{ minimized: player.isVideoMinimized, theater: isTheaterMode }"
    :style="!isTheaterMode ? { left: `${posX}px`, top: `${posY}px` } : undefined"
  >
    <!-- 窗口头（拖拽手柄） -->
    <header class="window-header" @mousedown="startDrag">
      <div class="header-left">
        <icon-live-broadcast v-if="player.recordingPlaybackStatus === 'live'" class="header-icon is-live" />
        <icon-image v-else-if="player.playerMode === 'steps'" class="header-icon" />
        <icon-sync v-else-if="player.recordingPlaybackStatus === 'processing'" class="header-icon spin-icon" />
        <icon-file-video v-else class="header-icon" />
        <span class="header-title" :title="player.activeVideoTitle || headerTitle">{{ headerTitle }}</span>
      </div>
      <div class="header-actions" @mousedown.stop>
        <div v-if="canToggleMode" class="mode-toggle">
          <button
            type="button"
            class="mode-btn"
            :class="{ active: player.playerMode === 'video' }"
            :title="t('workspace.player.modeVideo')"
            @click="player.setPlayerMode('video')"
          >
            <icon-file-video />
            <span>{{ t('workspace.player.modeVideo') }}</span>
          </button>
          <button
            type="button"
            class="mode-btn"
            :class="{ active: player.playerMode === 'steps' }"
            :title="t('workspace.player.modeSteps')"
            @click="player.setPlayerMode('steps')"
          >
            <icon-image />
            <span>{{ t('workspace.player.modeSteps') }}</span>
          </button>
        </div>
        <button
          type="button"
          class="header-btn"
          :title="player.isVideoMinimized ? t('workspace.player.restore') : t('workspace.player.minimize')"
          @click="toggleMinimize"
        >
          <icon-expand v-if="player.isVideoMinimized" />
          <icon-minus v-else />
        </button>
        <button
          v-if="!player.isVideoMinimized"
          type="button"
          class="header-btn"
          :title="isTheaterMode ? t('workspace.player.exitTheater') : t('workspace.player.theater')"
          @click="toggleTheater"
        >
          <icon-fullscreen-exit v-if="isTheaterMode" />
          <icon-fullscreen v-else />
        </button>
        <button
          type="button"
          class="header-btn close-btn"
          :title="t('workspace.player.close')"
          @click="player.closeVideoPlayer()"
        >
          <icon-close />
        </button>
      </div>
    </header>

    <!-- 内容区 -->
    <div v-if="!player.isVideoMinimized" class="player-body">
      <!-- 1. LIVE：任务运行中的 MJPEG 投屏 -->
      <template v-if="player.recordingPlaybackStatus === 'live'">
        <div v-if="!liveStreamError" class="live-container">
          <img
            class="live-img"
            :src="liveStreamUrl"
            :alt="t('workspace.player.liveTitle')"
            @error="onLiveStreamError"
          />
          <div class="live-overlay">
            <div class="live-badge">
              <span class="pulse-dot" />
              <span>{{ t('workspace.player.liveBadge') }}</span>
            </div>
            <button type="button" class="header-btn" :title="t('workspace.player.refreshLive')" @click="retryLiveStream">
              <icon-refresh />
            </button>
          </div>
        </div>
        <div v-else class="fallback">
          <div class="fallback-icon-wrap"><icon-camera /></div>
          <h4 class="fallback-title">{{ t('workspace.player.liveConnectingTitle') }}</h4>
          <p class="fallback-desc">{{ t('workspace.player.liveConnectingDesc') }}</p>
          <button type="button" class="retry-btn" @click="retryLiveStream">
            <icon-refresh />
            {{ t('workspace.player.reconnect') }}
          </button>
        </div>
      </template>

      <!-- 2. 录像回放 / 步骤回放（任务结束后自动生效） -->
      <template v-else>
        <!-- 加载态（video 模式 processing / loading） -->
        <div v-if="showVideoLoading" class="loading-state">
          <icon-sync class="spin-icon" />
          <span>{{ loadingText }}</span>
        </div>

        <!-- 2a. 步骤回放视图 -->
        <div v-if="player.playerMode === 'steps' && totalStepFrames > 0" class="step-replay">
          <div
            v-if="player.recordingPlaybackStatus === 'failed' || videoLoadError"
            class="step-replay-notice"
          >
            {{ t('workspace.player.stepUnavailableNotice') }}
          </div>

          <div
            class="step-viewport"
            @mouseenter="isCardHovered = true"
            @mouseleave="isCardHovered = false"
          >
            <div v-if="isStepImageLoading" class="step-loading">
              <icon-sync class="spin-icon" />
              <span>{{ t('workspace.player.loadingScreenshot') }}</span>
            </div>
            <div v-else-if="stepImageError" class="step-image-error">
              {{ t('workspace.player.imageError') }}
            </div>
            <template v-if="!stepImageError">
              <div class="step-image-wrap">
                <img
                  ref="stepImgRef"
                  class="step-img"
                  :src="currentStepImageUrl"
                  :alt="currentStepFrame?.title || ''"
                  @load="onStepImageLoad"
                  @error="onStepImageError"
                  @click="openStepImageInNewTab"
                />
                <div
                  v-show="viewMode === 'pre'"
                  ref="stepOverlayRef"
                  class="overlay-layer"
                />
              </div>
            </template>

            <!-- 悬浮详情卡（hover 或固定时显示） -->
            <div v-if="currentStepFrame" class="step-badge" :class="{ visible: isCardVisible }" @click.stop>
              <div class="badge-left">
                <span class="badge-step-no">
                  {{ t('workspace.timeline.stepLabel', { n: currentStepFrame.stepNumber }) }}
                </span>
                <span class="badge-action-desc" :title="currentStepFrame.actionText || currentStepFrame.title">
                  <span v-if="currentStepFrame.action" class="badge-action-icon">
                    {{ getStepActionIcon(currentStepFrame.action) }}
                  </span>
                  {{ currentStepFrame.actionText || currentStepFrame.title }}
                </span>
                <span v-if="currentStepCoords" class="badge-coords">{{ currentStepCoords }}</span>
              </div>
              <div class="badge-right">
                <span v-if="currentStepFrame.status === 'failed'" class="badge-status">
                  {{ t('workspace.timeline.failed') }}
                </span>
                <div v-if="currentStepFrame.postImageUrl" class="pre-post-toggle">
                  <button
                    type="button"
                    class="toggle-btn"
                    :class="{ active: viewMode === 'pre' }"
                    :title="t('workspace.player.preImageTitle')"
                    @click="setStepViewMode('pre')"
                  >
                    {{ t('workspace.player.preImage') }}
                  </button>
                  <button
                    type="button"
                    class="toggle-btn"
                    :class="{ active: viewMode === 'post' }"
                    :title="t('workspace.player.postImageTitle')"
                    @click="setStepViewMode('post')"
                  >
                    {{ t('workspace.player.postImage') }}
                  </button>
                </div>
                <button
                  type="button"
                  class="header-btn pin-btn"
                  :class="{ pinned: isCardPinned }"
                  :title="isCardPinned ? t('workspace.player.unpinCard') : t('workspace.player.pinCard')"
                  @click="toggleCardPin($event)"
                >
                  <icon-pushpin />
                </button>
              </div>
            </div>
          </div>

          <!-- 步骤回放控制条 -->
          <div class="controls-footer">
            <div class="scrubber-wrap">
              <input
                type="range"
                class="scrubber"
                min="0"
                :max="Math.max(0, totalStepFrames - 1)"
                step="1"
                :value="activeStepIndex"
                @input="onStepScrub"
              />
              <div class="scrubber-fill" :style="{ width: `${stepProgressPercent}%` }" />
              <template v-if="totalStepFrames > 1">
                <span
                  v-for="(frame, i) in stepFrames"
                  :key="frame.stepId || i"
                  class="step-tick"
                  :class="{ active: i === activeStepIndex, passed: i < activeStepIndex }"
                  :style="{ left: `${(i / (totalStepFrames - 1)) * 100}%` }"
                  :title="`#${i + 1} ${frame.actionText || frame.title}`"
                  @click.stop="seekStepFrame(i)"
                />
              </template>
            </div>
            <div class="controls-row">
              <div class="controls-left">
                <button type="button" class="ctrl-btn play-btn" :title="isStepPlaying ? t('workspace.player.pause') : t('workspace.player.playSlideshow')" @click="toggleStepPlay">
                  <icon-pause v-if="isStepPlaying" />
                  <icon-play-arrow v-else />
                </button>
                <button type="button" class="ctrl-btn" :disabled="activeStepIndex <= 0" :title="t('workspace.player.prevFrame')" @click="prevStepFrame">
                  <icon-left />
                </button>
                <button type="button" class="ctrl-btn" :disabled="activeStepIndex >= totalStepFrames - 1" :title="t('workspace.player.nextFrame')" @click="nextStepFrame">
                  <icon-right />
                </button>
                <button type="button" class="ctrl-btn" :title="t('workspace.player.replay')" @click="restartStep">
                  <icon-refresh />
                </button>
                <span class="time-display">{{ activeStepIndex + 1 }} / {{ totalStepFrames }}</span>
              </div>
              <div class="controls-right">
                <button type="button" class="ctrl-btn speed-btn" :title="t('workspace.player.speedTitle', { rate: playbackRate })" @click="cycleSpeed">
                  {{ playbackRate }}x
                </button>
                <button type="button" class="ctrl-btn" :class="{ active: isLooping }" :title="isLooping ? t('workspace.player.loopOn') : t('workspace.player.loopOff')" @click="toggleLoop">
                  <icon-loop />
                </button>
                <button type="button" class="ctrl-btn" :title="t('workspace.player.openImageTab')" @click="openStepImageInNewTab">
                  <icon-expand />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 2b. 录像播放视图 -->
        <template v-if="videoViewVisible">
          <div v-if="!videoLoadError" class="video-container" @click="togglePlay">
            <video
              ref="videoRef"
              :src="currentVideoUrl"
              playsinline
              @loadedmetadata="onLoadedMetadata"
              @timeupdate="onTimeUpdate"
              @play="onPlay"
              @pause="onPause"
              @ended="onEnded"
              @error="onError"
            />
          </div>
          <div v-if="!videoLoadError" class="controls-footer">
            <!-- 整场时间轴（跨段定位） -->
            <div class="axis-label">{{ t('workspace.player.sessionAxis') }}</div>
            <div class="scrubber-wrap">
              <input
                type="range"
                class="scrubber"
                min="0"
                :max="duration || 100"
                step="0.1"
                :value="currentTime"
                @input="onSessionScrub"
              />
              <div class="scrubber-fill" :style="{ width: `${progressPercent}%` }" />
            </div>
            <!-- 段内时间轴（多分段时出现） -->
            <template v-if="segments.length > 1">
              <div class="axis-label">
                {{ t('workspace.player.segmentAxis') }}
                <span class="axis-segment">({{ t('workspace.player.segmentLabel', { index: activeSegmentIndex + 1, total: segments.length }) }})</span>
              </div>
              <div class="scrubber-wrap">
                <input
                  type="range"
                  class="scrubber"
                  min="0"
                  :max="activeSegment?.duration || 0"
                  step="0.1"
                  :value="segmentLocalTime"
                  @input="onSegmentScrub"
                />
                <div class="scrubber-fill" :style="{ width: `${segmentProgressPercent}%` }" />
              </div>
            </template>
            <div class="controls-row">
              <div class="controls-left">
                <button type="button" class="ctrl-btn play-btn" :title="isPlaying ? t('workspace.player.pause') : t('workspace.player.play')" @click="togglePlay">
                  <icon-pause v-if="isPlaying" />
                  <icon-play-arrow v-else />
                </button>
                <button type="button" class="ctrl-btn" :title="t('workspace.player.replay')" @click="restart">
                  <icon-refresh />
                </button>
                <span class="time-display">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
              </div>
              <div class="controls-right">
                <button type="button" class="ctrl-btn speed-btn" :title="t('workspace.player.speedTitle', { rate: playbackRate })" @click="cycleSpeed">
                  {{ playbackRate }}x
                </button>
                <button type="button" class="ctrl-btn" :class="{ active: isLooping }" :title="isLooping ? t('workspace.player.loopOn') : t('workspace.player.loopOff')" @click="toggleLoop">
                  <icon-loop />
                </button>
                <button type="button" class="ctrl-btn" :title="isMuted ? t('workspace.player.unmute') : t('workspace.player.mute')" @click="toggleMute">
                  <icon-mute v-if="isMuted" />
                  <icon-sound v-else />
                </button>
                <button type="button" class="ctrl-btn" :title="t('workspace.player.openVideoTab')" @click="openInNewTab">
                  <icon-expand />
                </button>
              </div>
            </div>
          </div>
        </template>

        <!-- 2c. 失败 / 不可用 fallback -->
        <div v-if="showEmptyFallback" class="fallback">
          <div class="fallback-icon-wrap"><icon-camera /></div>
          <h4 class="fallback-title">
            {{ player.recordingPlaybackStatus === 'failed' || videoLoadError
              ? t('workspace.player.failedTitle')
              : t('workspace.player.unavailableTitle') }}
          </h4>
          <p class="fallback-desc">
            {{ videoLoadError
              ? t('workspace.player.loadErrorDesc')
              : (player.recordingPlaybackMessage || t('workspace.player.unavailableDesc')) }}
          </p>
          <button
            v-if="player.recordingPlaybackStatus === 'failed' || videoLoadError"
            type="button"
            class="retry-btn"
            @click="videoLoadError = false; player.retryVideoRecording()"
          >
            <icon-refresh />
            {{ t('workspace.player.retry') }}
          </button>
        </div>

        <!-- unavailable / 加载失败但有帧：引导切换到步骤回放 -->
        <div v-else-if="showStepsGuide" class="fallback">
          <div class="fallback-icon-wrap"><icon-image /></div>
          <h4 class="fallback-title">{{ videoLoadError ? t('workspace.player.loadErrorDesc') : t('workspace.player.unavailableTitle') }}</h4>
          <p class="fallback-desc">{{ t('workspace.player.stepUnavailableNotice') }}</p>
          <button type="button" class="retry-btn" @click="videoLoadError = false; player.setPlayerMode('steps')">
            <icon-image />
            {{ t('workspace.player.switchToSteps') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.theater-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgb(0 0 0 / 55%);
  z-index: 930;
}

.floating-player {
  position: fixed;
  width: 400px;
  max-width: calc(100vw - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--color-bg-2);
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  box-shadow: 0 12px 32px rgb(0 0 0 / 35%);
  z-index: 940;
  user-select: none;
}

.floating-player.minimized {
  width: 280px;
}

.floating-player.theater {
  left: 50% !important;
  top: 50% !important;
  transform: translate(-50%, -50%);
  width: 85vw;
  max-width: 960px;
  max-height: 88vh;
}

/* ---- 窗口头 ---- */
.window-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 42px;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid var(--color-border-2);
  background-color: var(--color-bg-3);
  cursor: grab;
  flex-shrink: 0;
}

.window-header:active {
  cursor: grabbing;
}

.floating-player.minimized .window-header {
  border-bottom: none;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  flex: 1;
}

.header-icon {
  font-size: 16px;
  color: rgb(var(--arcoblue-6));
  flex-shrink: 0;
}

.header-icon.is-live {
  color: rgb(var(--red-6));
}

.header-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.mode-toggle {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-right: 4px;
  padding: 2px;
  border-radius: var(--border-radius-small);
  background-color: var(--color-fill-2);
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: none;
  border-radius: var(--border-radius-small);
  background: transparent;
  color: var(--color-text-3);
  font-size: 12px;
  cursor: pointer;
}

.mode-btn.active {
  background-color: var(--color-bg-2);
  color: rgb(var(--arcoblue-6));
}

.header-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--border-radius-small);
  background: transparent;
  color: var(--color-text-2);
  font-size: 14px;
  cursor: pointer;
}

.header-btn:hover {
  background-color: var(--color-fill-2);
  color: var(--color-text-1);
}

.header-btn.close-btn:hover {
  background-color: rgb(var(--red-6) / 15%);
  color: rgb(var(--red-6));
}

/* ---- 内容区 ---- */
.player-body {
  display: flex;
  flex-direction: column;
  background-color: var(--color-bg-1);
  overflow: hidden;
}

.floating-player.theater .player-body {
  max-height: calc(88vh - 42px);
  overflow-y: auto;
}

.live-container {
  position: relative;
  background-color: #000;
}

.live-img {
  display: block;
  width: 100%;
  max-height: 62vh;
  object-fit: contain;
}

.live-overlay {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
}

.live-overlay > * {
  pointer-events: auto;
}

.live-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background-color: rgb(var(--red-6) / 90%);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #fff;
  animation: live-pulse 1.2s ease-in-out infinite;
}

@keyframes live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

/* ---- 步骤回放 ---- */
.step-replay {
  display: flex;
  flex-direction: column;
}

.step-replay-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid rgb(var(--orange-6) / 35%);
  background-color: rgb(var(--orange-1) / 45%);
  color: rgb(var(--orange-6));
  font-size: 12px;
}

.step-viewport {
  position: relative;
  background-color: #000;
  min-height: 180px;
}

.step-img {
  display: block;
  width: 100%;
  max-height: 58vh;
  object-fit: contain;
  cursor: zoom-in;
}

.step-image-wrap {
  position: relative;
  display: flex;
  justify-content: center;
}

.overlay-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 5;
}

.step-loading,
.step-image-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 12px;
  color: var(--color-text-3);
  font-size: 12.5px;
}

.step-badge {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--border-radius-medium);
  background-color: color-mix(in srgb, var(--color-bg-2) 92%, transparent);
  border: 1px solid var(--color-border-2);
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.15s ease, transform 0.15s ease;
  pointer-events: none;
}

.step-badge.visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.badge-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

.badge-step-no {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 999px;
  background-color: rgb(var(--arcoblue-6) / 15%);
  color: rgb(var(--arcoblue-6));
  font-size: 11px;
  font-weight: 600;
}

.badge-action-desc {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-1);
  font-size: 12px;
}

.badge-action-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.badge-coords {
  flex-shrink: 0;
  font-family: monospace;
  font-size: 11px;
  color: var(--color-text-3);
}

.badge-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.badge-status {
  padding: 0 6px;
  border-radius: var(--border-radius-small);
  background-color: rgb(var(--red-6) / 15%);
  color: rgb(var(--red-6));
  font-size: 11px;
}

.pre-post-toggle {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--border-radius-small);
  background-color: var(--color-fill-2);
}

.toggle-btn {
  padding: 1px 8px;
  border: none;
  border-radius: var(--border-radius-small);
  background: transparent;
  color: var(--color-text-3);
  font-size: 11px;
  cursor: pointer;
}

.toggle-btn.active {
  background-color: var(--color-bg-2);
  color: rgb(var(--arcoblue-6));
}

.pin-btn.pinned {
  color: rgb(var(--arcoblue-6));
}

/* ---- 控制条 ---- */
.controls-footer {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--color-border-2);
  background-color: var(--color-bg-2);
}

.axis-label {
  font-size: 11px;
  color: var(--color-text-3);
}

.axis-segment {
  color: var(--color-text-4);
}

.scrubber-wrap {
  position: relative;
  height: 14px;
  display: flex;
  align-items: center;
}

.scrubber {
  width: 100%;
  height: 4px;
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
  border-radius: 999px;
  background-color: var(--color-fill-3);
  outline: none;
  cursor: pointer;
}

.scrubber::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: rgb(var(--arcoblue-6));
  border: 2px solid var(--color-bg-2);
  box-shadow: 0 0 3px rgb(0 0 0 / 40%);
}

.scrubber-fill {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  height: 4px;
  border-radius: 999px;
  background-color: rgb(var(--arcoblue-6) / 70%);
  pointer-events: none;
}

.step-tick {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background-color: var(--color-text-4);
  cursor: pointer;
  z-index: 1;
}

.step-tick.passed {
  background-color: rgb(var(--arcoblue-6) / 60%);
}

.step-tick.active {
  background-color: rgb(var(--arcoblue-6));
}

.controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.controls-left,
.controls-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ctrl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 4px;
  border: none;
  border-radius: var(--border-radius-small);
  background: transparent;
  color: var(--color-text-2);
  font-size: 14px;
  cursor: pointer;
}

.ctrl-btn:hover:not(:disabled) {
  background-color: var(--color-fill-2);
  color: var(--color-text-1);
}

.ctrl-btn:disabled {
  color: var(--color-text-4);
  cursor: default;
}

.ctrl-btn.active {
  color: rgb(var(--arcoblue-6));
}

.ctrl-btn.play-btn {
  color: rgb(var(--arcoblue-6));
}

.ctrl-btn.speed-btn {
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.time-display {
  font-size: 12px;
  color: var(--color-text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---- video ---- */
.video-container {
  display: flex;
  justify-content: center;
  background-color: #000;
  cursor: pointer;
}

.video-container video {
  display: block;
  width: 100%;
  max-height: 58vh;
}

/* ---- 加载态 / fallback ---- */
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 16px;
  color: var(--color-text-2);
  font-size: 12.5px;
}

.fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 20px;
  text-align: center;
}

.fallback-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--color-fill-2);
  color: var(--color-text-3);
  font-size: 20px;
}

.fallback-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text-1);
}

.fallback-desc {
  margin: 0;
  max-width: 300px;
  color: var(--color-text-3);
  font-size: 12.5px;
  overflow-wrap: anywhere;
}

.retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: 1px solid rgb(var(--arcoblue-6));
  border-radius: var(--border-radius-small);
  background: transparent;
  color: rgb(var(--arcoblue-6));
  font-size: 12.5px;
  cursor: pointer;
}

.retry-btn:hover {
  background-color: rgb(var(--arcoblue-6) / 12%);
}

.spin-icon {
  animation: player-spin 1.2s linear infinite;
}

@keyframes player-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>

<!-- 动作坐标叠加标记的全局样式：drawActionCoordinatesOnOverlay 动态创建的 DOM
     不携带 scoped 属性，且内联 animation 引用的 keyframes 须为全局名
     （对应 Angular 版 ::ng-deep 块）。 -->
<style>
.action-point-marker {
  z-index: 10;
  pointer-events: none;
}

@keyframes pulse-animation {
  0% {
    transform: scale(0.6);
    opacity: 1;
  }
  100% {
    transform: scale(2.2);
    opacity: 0;
  }
}
</style>
