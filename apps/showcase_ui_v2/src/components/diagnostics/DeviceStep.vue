<script setup lang="ts">
/**
 * 诊断向导 STEP 3：Android 设备与模拟器连接。
 * 按 Angular HomeComponent 四态分支（互斥条件对齐母本）：
 * A 就绪（activeDevice 卡 + 多设备切换）→ B-1 启动中 live 跟踪（35/65/ready 阈值
 * stepper + 进度条 + 停止 + 日志流）→ B-2 失败诊断卡（重试[远程 ADB 禁用] / 重启
 * ADB / 关闭）→ B-3 连接方式导航（emulator / USB / Wi-Fi / 远程 ADB 面板）。
 * 另有 C 锁定/未授权、D ADB 缺失分支。远程 ADB 端点自动预填（对齐 ngOnInit 语义）。
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  IconCheck,
  IconCheckCircle,
  IconClose,
  IconCopy,
  IconDesktop,
  IconExclamationCircle,
  IconLink,
  IconLoading,
  IconLock,
  IconMobile,
  IconPlayArrow,
  IconQuestionCircle,
  IconRefresh,
  IconStorage,
  IconStop,
  IconSwap,
  IconSync,
  IconWifi,
} from '@arco-design/web-vue/es/icon';
import type {
  AdbServerConnectionResult,
  AdbServerDevice,
} from '@/types/system.model';

import { useSystemContract, type AdbRestartResult, type WirelessAdbResult } from './contract';
import { errText } from './errors';
import { useCopy } from './useCopy';

const { t } = useI18n();
const system = useSystemContract();
const { copiedId, copy } = useCopy();

// ---- 头部操作 ----
const showConnectionMethods = ref(false);
// 用户亲手开合过一次之后，自动条件就不再改回去
const guideTouched = ref(false);
const adbRestartFeedback = ref<string | null>(null);
let restartTimer: ReturnType<typeof setTimeout> | null = null;

async function restartAdbServer(): Promise<void> {
  adbRestartFeedback.value = null;
  try {
    const res = (await system.restartAdb()) as AdbRestartResult | null;
    adbRestartFeedback.value = res?.restart_result?.skipped
      ? t('launcher.diagnostics.dev.devicesRefreshed')
      : t('launcher.diagnostics.dev.adbRefreshed');
  } catch {
    adbRestartFeedback.value = t('launcher.diagnostics.dev.restartFailed');
  }
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    adbRestartFeedback.value = null;
  }, 2500);
}
onUnmounted(() => {
  if (restartTimer) clearTimeout(restartTimer);
});

// ---- 状态分支（对齐 Angular 的互斥条件） ----
const bootingViaAdb = computed(
  () => !system.isDeviceReady && system.adbProbe?.summary === 'Device Booting',
);
const showTracker = computed(() => system.isEmulatorLaunching || bootingViaAdb.value);
const showFailed = computed(
  () =>
    !system.isDeviceReady &&
    !system.isEmulatorLaunching &&
    system.emulatorLaunchState?.status === 'failed',
);
const ADB_WARN_STATES = ['Device Booting', 'Device Unauthorized', 'Device Locked', 'Lock State Unknown'];
/** 没有可用设备时默认展开连接引导，让第一次上手的人看得见入口。 */
const guideAutoOpen = computed(
  () =>
    !system.isDeviceReady &&
    !system.isEmulatorLaunching &&
    !ADB_WARN_STATES.includes(system.adbProbe?.summary ?? '') &&
    system.adbProbe?.status !== 'fail' &&
    system.emulatorLaunchState?.status !== 'failed',
);

// 这里以前写成「手动开 或 自动开」：无设备时自动项恒真，
// 于是「收起连接方式」点了什么都不会发生。自动条件现在只负责初始开合。
watch(
  guideAutoOpen,
  (open) => {
    if (!guideTouched.value) showConnectionMethods.value = open;
  },
  { immediate: true },
);

function toggleConnectionMethods(): void {
  guideTouched.value = true;
  showConnectionMethods.value = !showConnectionMethods.value;
}
const showLocked = computed(
  () =>
    system.adbProbe?.status === 'warn' &&
    ['Device Locked', 'Lock State Unknown'].includes(system.adbProbe?.summary ?? ''),
);
const showUnauthorized = computed(
  () => system.adbProbe?.status === 'warn' && system.adbProbe?.summary === 'Device Unauthorized',
);
const showAdbMissing = computed(() => system.adbProbe?.status === 'fail');

/**
 * 「没有 AVD」是检测结果，不是连接教程的一部分：以前它只在展开连接方式后才看得见，
 * 一收起就跟着消失。所以把它提到可折叠块外面，条件仍是「还没有可用设备」。
 * adb 本身缺失时不叠加这条（那一档有自己的指引，且枚举不到 AVD 是必然的）。
 */
const showAvdEmptyNotice = computed(
  () =>
    !system.isDeviceReady &&
    !showAdbMissing.value &&
    system.installedAvds.length === 0,
);

// ---- State A：多设备切换 ----
function onDeviceChange(
  value: string | number | boolean | Record<string, unknown> | (string | number | boolean | Record<string, unknown>)[],
): void {
  if (typeof value === 'string' && value) {
    void system.selectDevice(value).catch(() => undefined);
  }
}

// ---- State B-1：启动跟踪 ----
const showLaunchLogs = ref(false);
const launchState = computed(() => system.emulatorLaunchState);
const progressPercent = computed(() => launchState.value?.progress_percent ?? 25);
const progressFraction = computed(() => Math.min(progressPercent.value / 100, 1));

const bootStages = computed(() => [
  {
    done: progressPercent.value >= 35,
    active: launchState.value?.status === 'starting',
    label: t('launcher.diagnostics.dev.stage1'),
  },
  {
    done: progressPercent.value >= 65,
    active: launchState.value?.status === 'waiting_for_adb',
    label: t('launcher.diagnostics.dev.stage2'),
  },
  {
    done: launchState.value?.status === 'ready',
    active: launchState.value?.status === 'booting' || bootingViaAdb.value,
    label: t('launcher.diagnostics.dev.stage3'),
  },
  {
    done: launchState.value?.status === 'ready',
    active: false,
    label: t('launcher.diagnostics.dev.stage4'),
  },
]);

const launchLogsText = computed(() => launchState.value?.logs?.join('\n') ?? '');

function stopEmulator(): void {
  void system.stopEmulator().catch(() => undefined);
}

// ---- State B-2：失败 ----
function retryLaunch(): void {
  const avd = launchState.value?.avd_name;
  if (!avd || system.isRemoteAdbServer) return;
  void system.launchEmulator(avd).catch(() => undefined);
}

function dismissFailed(): void {
  void system.dismissEmulatorStatus().catch(() => undefined);
}

// ---- State B-3：连接方式 ----
type AdbGuideTab = 'emulator' | 'usb' | 'wifi' | 'remote';
const activeAdbGuideTab = ref<AdbGuideTab>('emulator');

function setAdbGuideTab(tab: AdbGuideTab): void {
  activeAdbGuideTab.value = tab;
  remoteError.value = null;
  remoteMessage.value = null;
}

// 远程 ADB 端点自动预填 + tab 切换（对齐 ngOnInit fetchAdbServerStatus 语义，仅一次）
// —— watch 声明位于 remoteAdbHost 等状态之后（immediate 回调需写入这些 ref）
let didPrefillRemote = false;
function prefillRemoteEndpoint(): void {
  if (didPrefillRemote || !system.adbServerStatus || system.adbServerStatus.endpoint.mode !== 'remote') return;
  didPrefillRemote = true;
  remoteAdbHost.value = system.adbServerStatus.endpoint.host;
  remoteAdbPort.value = String(system.adbServerStatus.endpoint.port);
  activeAdbGuideTab.value = 'remote';
}

// Wi-Fi 表单
const wifiHost = ref('192.168.1.100');
const wifiPort = ref('5555');
const isConnectingWifi = ref(false);
const wifiMessage = ref<string | null>(null);
const wifiError = ref<string | null>(null);

async function connectWifiDevice(): Promise<void> {
  if (system.isRemoteAdbServer) {
    wifiError.value = t('launcher.diagnostics.dev.wifiRemoteBlock');
    return;
  }
  const host = wifiHost.value.trim();
  const port = parseInt(wifiPort.value.trim(), 10) || 5555;
  if (!host) {
    wifiError.value = t('launcher.diagnostics.dev.wifiInvalidHost');
    return;
  }
  isConnectingWifi.value = true;
  wifiError.value = null;
  wifiMessage.value = null;
  try {
    const res = (await system.connectWirelessAdb(host, port)) as WirelessAdbResult | null;
    const cr = res?.connect_result;
    if (cr?.success) {
      wifiMessage.value = t('launcher.diagnostics.dev.wifiConnected', { host, port });
    } else {
      wifiError.value = cr?.message || t('launcher.diagnostics.dev.wifiFail');
    }
  } catch (err) {
    wifiError.value = errText(err, t('launcher.diagnostics.dev.wifiError'));
  } finally {
    isConnectingWifi.value = false;
  }
}

// 远程 ADB 面板
const remoteAdbHost = ref('127.0.0.1');
const remoteAdbPort = ref('5038');
const rememberRemoteAdb = ref(true);
const isProbingRemoteAdb = ref(false);
const isActivatingRemoteAdb = ref(false);
const isSwitchingToLocalAdb = ref(false);
const remoteMessage = ref<string | null>(null);
const remoteError = ref<string | null>(null);
const remoteAdbProbeResult = ref<AdbServerConnectionResult | null>(null);
const remoteAdbDevices = ref<AdbServerDevice[]>([]);

watch(
  () => system.adbServerStatus,
  () => prefillRemoteEndpoint(),
  { immediate: true },
);

const remoteAdbHasReadyDevice = computed(() =>
  remoteAdbDevices.value.some((device) => device.state === 'device'),
);
const isProbedRemoteAdbActive = computed(() => {
  const tested = remoteAdbProbeResult.value?.endpoint;
  const active = system.adbServerStatus?.endpoint;
  return Boolean(tested && active && tested.identity === active.identity);
});

function clearRemoteAdbProbe(): void {
  remoteAdbProbeResult.value = null;
  remoteAdbDevices.value = [];
  remoteMessage.value = null;
  remoteError.value = null;
}

async function probeRemoteAdbServer(): Promise<void> {
  const host = remoteAdbHost.value.trim();
  const port = Number(remoteAdbPort.value.trim());
  if (!host) {
    remoteError.value = t('launcher.diagnostics.dev.remoteInvalidHost');
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    remoteError.value = t('launcher.diagnostics.dev.remoteInvalidPort');
    return;
  }
  isProbingRemoteAdb.value = true;
  clearRemoteAdbProbe();
  try {
    const response = await system.probeAdbServer(host, port);
    const result = response.connection_result;
    if (result.success) {
      remoteAdbProbeResult.value = result;
      remoteAdbDevices.value = result.devices || [];
      remoteMessage.value = result.message;
    } else {
      remoteError.value = result.message;
    }
  } catch (err) {
    remoteError.value = errText(err, t('launcher.diagnostics.dev.remoteTestError'));
  } finally {
    isProbingRemoteAdb.value = false;
  }
}

async function activateRemoteAdbServer(): Promise<void> {
  const tested = remoteAdbProbeResult.value;
  if (!tested?.success) {
    remoteError.value = t('launcher.diagnostics.dev.remoteTestFirst');
    return;
  }
  isActivatingRemoteAdb.value = true;
  remoteError.value = null;
  try {
    const response = await system.connectAdbServer(tested.endpoint.host, tested.endpoint.port, rememberRemoteAdb.value);
    const result = response.connection_result;
    if (result.success) {
      remoteAdbProbeResult.value = result;
      remoteAdbDevices.value = result.devices || [];
      remoteMessage.value = result.message;
    } else {
      remoteError.value = result.message;
    }
  } catch (err) {
    remoteError.value = errText(err, t('launcher.diagnostics.dev.remoteUseError'));
  } finally {
    isActivatingRemoteAdb.value = false;
  }
}

async function switchToLocalAdbServer(): Promise<void> {
  isSwitchingToLocalAdb.value = true;
  remoteError.value = null;
  try {
    const response = await system.useLocalAdbServer(true);
    remoteAdbDevices.value = [];
    remoteMessage.value = response.connection_result.message;
  } catch (err) {
    remoteError.value = errText(err, t('launcher.diagnostics.dev.remoteSwitchError'));
  } finally {
    isSwitchingToLocalAdb.value = false;
  }
}

// AVD 启动
function launchAvdEmulator(avdName: string): void {
  if (system.isRemoteAdbServer) return;
  void system.launchEmulator(avdName).catch(() => undefined);
}

function isAvdLaunching(avd: string): boolean {
  return system.launchingAvd === avd || (system.isEmulatorLaunching && system.emulatorLaunchState?.avd_name === avd);
}

// ADB 缺失：各 OS 安装命令（对齐 Angular 硬编码三卡）
const adbInstallCards = [
  { os: 'linux' as const, cmd: 'sudo apt-get install -y adb' },
  { os: 'darwin' as const, cmd: 'brew install android-platform-tools' },
  { os: 'windows' as const, cmd: 'winget install Google.PlatformTools' },
];
</script>

<template>
  <section class="diag-step" :class="system.isDeviceReady ? 'is-pass' : 'is-pending'">
    <header class="diag-step-header">
      <span class="diag-step-badge" :class="{ pass: system.isDeviceReady }">
        <icon-check v-if="system.isDeviceReady" />
        <span v-else>3</span>
      </span>
      <div class="diag-step-info">
        <h3 class="diag-step-title">{{ t('launcher.diagnostics.dev.title') }}</h3>
        <p class="diag-step-desc">{{ t('launcher.diagnostics.dev.desc') }}</p>
      </div>
      <div class="diag-step-actions">
        <a-button size="small" class="conn-toggle-btn" @click="toggleConnectionMethods">
          <template #icon><icon-swap /></template>
          {{ showConnectionMethods ? t('launcher.diagnostics.dev.hideConn') : t('launcher.diagnostics.dev.changeConn') }}
        </a-button>
        <a-button
          size="small"
          class="restart-adb-btn"
          :loading="system.isRestartingAdb"
          :title="system.isRemoteAdbServer ? t('launcher.diagnostics.dev.refreshDevices') : t('launcher.diagnostics.dev.restartAdb')"
          @click="restartAdbServer"
        >
          <template #icon><icon-sync /></template>
          {{
            adbRestartFeedback ||
            (system.isRemoteAdbServer
              ? t('launcher.diagnostics.dev.refreshDevices')
              : t('launcher.diagnostics.dev.restartAdb'))
          }}
        </a-button>
      </div>
    </header>

    <div class="diag-step-body">
      <!-- STATE A：已连接就绪 -->
      <div v-if="system.isDeviceReady" class="connected-panel">
        <div class="device-hero">
          <span class="device-avatar"><icon-mobile /></span>
          <div class="device-details">
            <div class="device-name">{{ system.activeDevice?.model || system.activeDevice?.serial }}</div>
            <div class="device-meta">
              <span v-if="system.activeDevice?.is_emulator" class="meta-pill">
                {{ t('launcher.diagnostics.dev.virtualDevice') }}
              </span>
              <span>{{ system.activeDevice?.serial }}</span>
              <span v-if="system.activeDevice?.screen_resolution">· {{ system.activeDevice.screen_resolution }}</span>
              <span v-if="system.activeDevice?.android_version">
                · Android {{ system.activeDevice.android_version }}
              </span>
              <span v-if="system.isRemoteAdbServer && system.adbServerStatus" class="remote-endpoint">
                · {{ t('launcher.diagnostics.dev.remoteVia', {
                  host: system.adbServerStatus.endpoint.host,
                  port: system.adbServerStatus.endpoint.port,
                }) }}
              </span>
            </div>
          </div>
          <span class="device-status">
            <icon-check-circle />
            <span>{{ t('launcher.diagnostics.dev.connected') }}</span>
          </span>
        </div>

        <!-- 多设备切换器 -->
        <div v-if="system.connectedDevices.length > 1" class="device-switcher">
          <span class="switcher-label">{{ t('launcher.diagnostics.dev.selectDevice') }}</span>
          <a-select
            class="device-select"
            size="small"
            :model-value="system.activeDevice?.serial ?? undefined"
            @change="onDeviceChange"
          >
            <a-option v-for="dev in system.connectedDevices" :key="dev.serial" :value="dev.serial">
              {{ dev.model || dev.serial }}
            </a-option>
          </a-select>
        </div>
      </div>

      <!-- STATE B-1：启动中 live 跟踪 -->
      <div v-if="showTracker" class="tracker-card">
        <div class="tracker-head">
          <span class="tracker-icon"><icon-loading spin /></span>
          <div class="tracker-titles">
            <div class="tracker-title-row">
              <span class="tracker-title">
                {{ t('launcher.diagnostics.dev.launchingTitle') }}
                <code class="avd-highlight">{{ launchState?.avd_name || system.activeDevice?.serial || t('launcher.diagnostics.dev.defaultAvd') }}</code>
              </span>
              <a-tag size="small" color="arcoblue">
                {{ launchState?.status === 'booting' ? t('launcher.diagnostics.dev.booting') : t('launcher.diagnostics.dev.starting') }}
              </a-tag>
            </div>
            <p class="tracker-subtitle">{{ launchState?.stage_message || 'Initializing Android Virtual Device...' }}</p>
          </div>
          <div class="tracker-actions">
            <a-button size="mini" class="logs-toggle-btn" @click="showLaunchLogs = !showLaunchLogs">
              <template #icon><icon-desktop /></template>
              {{ showLaunchLogs ? t('launcher.diagnostics.dev.hideLogs') : t('launcher.diagnostics.dev.viewLogs') }}
            </a-button>
            <a-button size="mini" status="danger" class="emu-stop-btn" @click="stopEmulator">
              <template #icon><icon-stop /></template>
              {{ t('launcher.diagnostics.dev.stop') }}
            </a-button>
          </div>
        </div>

        <!-- 进度 stepper（35% / 65% / ready 阈值） -->
        <div class="boot-stepper">
          <template v-for="(stage, i) in bootStages" :key="i">
            <div class="boot-stage" :class="{ done: stage.done, active: stage.active && !stage.done }">
              <span class="stage-circle">
                <icon-check v-if="stage.done" />
                <icon-loading v-else-if="stage.active" spin />
                <span v-else>{{ i + 1 }}</span>
              </span>
              <span class="stage-label">{{ stage.label }}</span>
            </div>
            <div v-if="i < bootStages.length - 1" class="stage-line" :class="{ done: bootStages[i + 1].done }" />
          </template>
        </div>

        <!-- 进度条 -->
        <a-progress :percent="progressFraction" :show-text="false" class="boot-progress" />
        <div class="boot-progress-meta">
          <span>{{ t('launcher.diagnostics.dev.progressComplete', { percent: progressPercent }) }}</span>
          <span>{{ t('launcher.diagnostics.dev.elapsed', { seconds: launchState?.elapsed_seconds ?? 0 }) }}</span>
        </div>

        <a-alert type="info" class="boot-tip">{{ t('launcher.diagnostics.dev.bootTip') }}</a-alert>

        <!-- 可折叠控制台日志流 -->
        <div v-if="showLaunchLogs" class="boot-logs">
          <div class="logs-head">
            <span>{{ t('launcher.diagnostics.dev.logsTitle') }}</span>
            <button type="button" class="copy-btn" :class="{ copied: copiedId === 'boot_logs' }" @click="copy(launchLogsText, 'boot_logs')">
              <icon-check v-if="copiedId === 'boot_logs'" />
              <icon-copy v-else />
              <span>{{ copiedId === 'boot_logs' ? t('launcher.diagnostics.copied') : t('launcher.diagnostics.dev.copyLogs') }}</span>
            </button>
          </div>
          <pre class="logs-body"><template v-if="launchState?.logs?.length"><div v-for="(log, i) in launchState.logs" :key="i" class="log-line">{{ log }}</div></template><div v-else class="log-empty">{{ t('launcher.diagnostics.dev.logsEmpty') }}</div></pre>
        </div>
      </div>

      <!-- STATE B-2：启动失败诊断卡 -->
      <div v-if="showFailed" class="failed-card">
        <div class="failed-head">
          <span class="failed-icon"><icon-exclamation-circle /></span>
          <div class="failed-titles">
            <div class="failed-title">{{ t('launcher.diagnostics.dev.failedTitle') }}</div>
            <p class="failed-desc">{{ launchState?.error || t('launcher.diagnostics.dev.failedDefault') }}</p>
          </div>
          <a-button size="mini" type="text" class="failed-dismiss-x" @click="dismissFailed">
            <template #icon><icon-close /></template>
          </a-button>
        </div>

        <div v-if="launchState?.logs?.length" class="failed-logs">
          <div class="logs-head">
            <span>{{ t('launcher.diagnostics.dev.failLogsTitle') }}</span>
            <button type="button" class="copy-btn" :class="{ copied: copiedId === 'fail_logs' }" @click="copy(launchState?.logs?.join('\n') ?? '', 'fail_logs')">
              <icon-check v-if="copiedId === 'fail_logs'" />
              <icon-copy v-else />
              <span>{{ copiedId === 'fail_logs' ? t('launcher.diagnostics.copied') : t('launcher.diagnostics.dev.copyLogs') }}</span>
            </button>
          </div>
          <pre class="logs-body"><div v-for="(log, i) in launchState.logs" :key="i" class="log-line">{{ log }}</div></pre>
        </div>

        <div class="failed-actions">
          <a-button
            v-if="launchState?.avd_name"
            type="primary"
            size="small"
            class="emu-retry-btn"
            :disabled="system.isRemoteAdbServer"
            :title="system.isRemoteAdbServer ? t('launcher.diagnostics.dev.retryRemoteDisabled') : undefined"
            @click="retryLaunch"
          >
            <template #icon><icon-refresh /></template>
            {{ t('launcher.diagnostics.dev.retry', { avd: launchState?.avd_name }) }}
          </a-button>
          <a-button size="small" class="failed-restart-btn" @click="restartAdbServer">
            <template #icon><icon-sync /></template>
            {{ t('launcher.diagnostics.dev.restartAdb') }}
          </a-button>
          <a-button size="small" type="text" class="failed-dismiss-btn" @click="dismissFailed">
            {{ t('launcher.diagnostics.dev.dismiss') }}
          </a-button>
        </div>
      </div>

      <!-- 检测提示：不随连接方式一起折叠 -->
      <a-alert
        v-if="showAvdEmptyNotice"
        type="warning"
        class="avd-empty-notice"
        :title="t('launcher.diagnostics.dev.avdEmptyTitle')"
      >
        {{ t('launcher.diagnostics.dev.avdEmptyDesc') }}
      </a-alert>

      <!-- STATE B-3：连接方式导航 -->
      <div v-if="showConnectionMethods" class="guide-panel">
        <div class="method-nav">
          <button
            v-for="method in [
              { id: 'emulator' as const, icon: IconMobile, title: t('launcher.diagnostics.dev.methodEmulator'), desc: system.installedAvds.length > 0 ? t('launcher.diagnostics.dev.methodEmulatorCount', { count: system.installedAvds.length }) : t('launcher.diagnostics.dev.methodEmulatorDesc') },
              { id: 'usb' as const, icon: IconLink, title: t('launcher.diagnostics.dev.methodUsb'), desc: t('launcher.diagnostics.dev.methodUsbDesc') },
              { id: 'wifi' as const, icon: IconWifi, title: t('launcher.diagnostics.dev.methodWifi'), desc: t('launcher.diagnostics.dev.methodWifiDesc') },
              { id: 'remote' as const, icon: IconStorage, title: t('launcher.diagnostics.dev.methodRemote'), desc: t('launcher.diagnostics.dev.methodRemoteDesc') },
            ]"
            :key="method.id"
            type="button"
            class="method-card"
            :class="{ active: activeAdbGuideTab === method.id }"
            @click="setAdbGuideTab(method.id)"
          >
            <component :is="method.icon" class="method-icon" />
            <span class="method-texts">
              <span class="method-title">{{ method.title }}</span>
              <span class="method-desc">{{ method.desc }}</span>
            </span>
          </button>
        </div>

        <!-- 远程 ADB 激活提示条 -->
        <div v-if="activeAdbGuideTab !== 'remote' && system.isRemoteAdbServer && system.adbServerStatus" class="remote-notice">
          <span class="remote-notice-text">
            {{
              t('launcher.diagnostics.dev.remoteNotice', {
                endpoint: `${system.adbServerStatus.endpoint.host}:${system.adbServerStatus.endpoint.port}`,
              })
            }}
          </span>
          <a-button size="mini" type="outline" class="use-local-btn" :loading="isSwitchingToLocalAdb" @click="switchToLocalAdbServer">
            <template #icon><icon-sync /></template>
            {{ isSwitchingToLocalAdb ? t('launcher.diagnostics.dev.switching') : t('launcher.diagnostics.dev.useLocalAdb') }}
          </a-button>
        </div>

        <!-- 方法 1：模拟器 -->
        <div v-if="activeAdbGuideTab === 'emulator'" class="method-panel">
          <template v-if="system.installedAvds.length > 0">
            <div class="panel-title-row">
              <span class="panel-title">{{ t('launcher.diagnostics.dev.avdTitle') }}</span>
              <a-tag size="small">{{ t('launcher.diagnostics.dev.avdCount', { count: system.installedAvds.length }) }}</a-tag>
            </div>
            <div class="avd-list">
              <div v-for="avd in system.installedAvds" :key="avd" class="avd-item">
                <icon-mobile class="avd-icon" />
                <span class="avd-name">{{ avd }}</span>
                <a-button
                  size="mini"
                  type="outline"
                  class="avd-launch-btn"
                  :loading="isAvdLaunching(avd)"
                  :disabled="system.isEmulatorLaunching || system.isRemoteAdbServer"
                  @click="launchAvdEmulator(avd)"
                >
                  <template #icon><icon-play-arrow /></template>
                  {{
                    isAvdLaunching(avd)
                      ? `${launchState?.status === 'booting' ? t('launcher.diagnostics.dev.booting') : t('launcher.diagnostics.dev.starting')} (${launchState?.elapsed_seconds ?? 0}s)`
                      : t('launcher.diagnostics.dev.launch')
                  }}
                </a-button>
              </div>
            </div>
          </template>
          <p v-else class="avd-empty-inline">{{ t('launcher.diagnostics.dev.avdEmptyInPanel') }}</p>
        </div>

        <!-- 方法 2：USB -->
        <div v-else-if="activeAdbGuideTab === 'usb'" class="method-panel">
          <div class="method-intro"><icon-link /> <span>{{ t('launcher.diagnostics.dev.usbIntro') }}</span></div>
          <div class="usb-steps">
            <div v-for="n in 4" :key="n" class="usb-step">
              <span class="usb-step-num">{{ n }}</span>
              <div class="usb-step-texts">
                <div class="usb-step-title">{{ t(`launcher.diagnostics.dev.usb${n}Title`) }}</div>
                <div class="usb-step-desc">{{ t(`launcher.diagnostics.dev.usb${n}Desc`) }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 方法 3：无线 ADB -->
        <div v-else-if="activeAdbGuideTab === 'wifi'" class="method-panel">
          <div class="method-intro"><icon-wifi /> <span>{{ t('launcher.diagnostics.dev.wifiIntro') }}</span></div>
          <div class="wifi-form">
            <div class="wifi-field">
              <label class="wifi-label">{{ t('launcher.diagnostics.dev.wifiHostLabel') }}</label>
              <a-input v-model="wifiHost" class="wifi-host-input" :placeholder="t('launcher.diagnostics.dev.wifiHostPlaceholder')" spellcheck="false" />
            </div>
            <div class="wifi-field wifi-port-field">
              <label class="wifi-label">{{ t('launcher.diagnostics.dev.wifiPortLabel') }}</label>
              <a-input v-model="wifiPort" class="wifi-port-input" :placeholder="t('launcher.diagnostics.dev.wifiPortPlaceholder')" spellcheck="false" />
            </div>
            <a-button
              type="primary"
              size="small"
              class="wifi-connect-btn"
              :loading="isConnectingWifi"
              :disabled="system.isRemoteAdbServer || !wifiHost.trim()"
              @click="connectWifiDevice"
            >
              {{ isConnectingWifi ? t('launcher.diagnostics.dev.wifiConnecting') : t('launcher.diagnostics.dev.wifiConnect') }}
            </a-button>
          </div>
          <a-alert v-if="wifiMessage" type="success" class="wifi-alert">{{ wifiMessage }}</a-alert>
          <a-alert v-if="wifiError" type="error" class="wifi-alert">{{ wifiError }}</a-alert>
          <div class="callout"><icon-question-circle /> <span>{{ t('launcher.diagnostics.dev.wifiHint') }}</span></div>
        </div>

        <!-- 方法 4：远程 ADB Server -->
        <div v-else class="method-panel">
          <div class="method-intro"><icon-storage /> <span>{{ t('launcher.diagnostics.dev.remoteIntro') }}</span></div>
          <div class="wifi-form">
            <div class="wifi-field">
              <label class="wifi-label">{{ t('launcher.diagnostics.dev.remoteHostLabel') }}</label>
              <a-input v-model="remoteAdbHost" class="remote-host-input" :placeholder="t('launcher.diagnostics.dev.remoteHostPlaceholder')" spellcheck="false" @input="clearRemoteAdbProbe" />
            </div>
            <div class="wifi-field wifi-port-field">
              <label class="wifi-label">{{ t('launcher.diagnostics.dev.remotePortLabel') }}</label>
              <a-input v-model="remoteAdbPort" class="remote-port-input" :placeholder="t('launcher.diagnostics.dev.remotePortPlaceholder')" spellcheck="false" @input="clearRemoteAdbProbe" />
            </div>
            <a-button
              type="primary"
              size="small"
              class="remote-test-btn"
              :loading="isProbingRemoteAdb"
              :disabled="!remoteAdbHost.trim()"
              @click="probeRemoteAdbServer"
            >
              {{ isProbingRemoteAdb ? t('launcher.diagnostics.dev.remoteTesting') : t('launcher.diagnostics.dev.remoteTest') }}
            </a-button>
          </div>

          <a-checkbox v-model="rememberRemoteAdb" class="remember-check">
            {{ t('launcher.diagnostics.dev.remoteRemember') }}
          </a-checkbox>

          <a-alert v-if="remoteMessage" type="success" class="wifi-alert">{{ remoteMessage }}</a-alert>
          <a-alert v-if="remoteError" type="error" class="wifi-alert">{{ remoteError }}</a-alert>

          <div v-if="remoteAdbDevices.length" class="remote-devices">
            <div v-for="device in remoteAdbDevices" :key="device.serial" class="remote-device-row">
              <icon-mobile />
              <span class="remote-device-name">{{ device.model || device.serial }}</span>
              <span class="remote-device-serial">{{ device.serial }}</span>
              <a-tag size="small" :color="device.state === 'device' ? 'green' : 'gray'">
                {{ device.state === 'device' ? t('launcher.diagnostics.dev.remoteReady') : device.state }}
              </a-tag>
            </div>
          </div>

          <a-button
            v-if="remoteAdbProbeResult?.success && !isProbedRemoteAdbActive"
            type="primary"
            size="small"
            class="remote-activate-btn"
            :loading="isActivatingRemoteAdb"
            @click="activateRemoteAdbServer"
          >
            <template #icon><icon-check /></template>
            {{ remoteAdbHasReadyDevice ? t('launcher.diagnostics.dev.remoteUse') : t('launcher.diagnostics.dev.remoteUseAnyway') }}
          </a-button>

          <p class="remote-explain">{{ t('launcher.diagnostics.dev.remoteExplain') }}</p>
        </div>
      </div>

      <!-- STATE C：设备锁定 / 锁定状态未知 -->
      <div v-if="showLocked" class="locked-card">
        <span class="locked-icon"><icon-lock /></span>
        <div class="locked-texts">
          <div class="locked-title">
            {{ system.adbProbe?.summary === 'Device Locked' ? t('launcher.diagnostics.dev.lockedTitle') : t('launcher.diagnostics.dev.lockUnknownTitle') }}
          </div>
          <div class="locked-desc">{{ system.adbProbe?.description }}</div>
        </div>
        <a-button size="small" class="check-again-btn" :loading="system.isLoading" @click="system.fetchReadiness().catch(() => undefined)">
          <template #icon><icon-refresh /></template>
          {{ t('launcher.diagnostics.dev.checkAgain') }}
        </a-button>
      </div>

      <!-- STATE C：未授权 -->
      <div v-if="showUnauthorized" class="locked-card">
        <span class="locked-icon"><icon-lock /></span>
        <div class="locked-texts">
          <div class="locked-title">{{ t('launcher.diagnostics.dev.unauthTitle') }}</div>
          <div class="locked-desc">{{ t('launcher.diagnostics.dev.unauthDesc') }}</div>
        </div>
        <a-button size="small" class="unauth-restart-btn" :loading="system.isRestartingAdb" @click="restartAdbServer">
          <template #icon><icon-refresh /></template>
          {{ system.isRemoteAdbServer ? t('launcher.diagnostics.dev.refreshDevices') : t('launcher.diagnostics.dev.unauthRestartLocal') }}
        </a-button>
      </div>

      <!-- STATE D：ADB 缺失 -->
      <div v-if="showAdbMissing" class="adb-missing">
        <a-alert type="error" :title="t('launcher.diagnostics.dev.adbMissingTitle')" />
        <div class="install-cards">
          <div
            v-for="card in adbInstallCards"
            :key="card.os"
            class="install-card"
            :class="{ highlight: system.osType === card.os }"
          >
            <div class="install-os">
              <span>{{ t(`launcher.diagnostics.dev.os${card.os === 'linux' ? 'Linux' : card.os === 'darwin' ? 'Mac' : 'Win'}`) }}</span>
              <a-tag v-if="system.osType === card.os" size="small" color="green">
                {{ t('launcher.diagnostics.dev.detected') }}
              </a-tag>
            </div>
            <div class="code-box">
              <code class="code-text">{{ card.cmd }}</code>
              <button type="button" class="copy-btn" :class="{ copied: copiedId === `adb-${card.os}` }" @click="copy(card.cmd, `adb-${card.os}`)">
                <icon-check v-if="copiedId === `adb-${card.os}`" />
                <icon-copy v-else />
                <span>{{ copiedId === `adb-${card.os}` ? t('launcher.diagnostics.copied') : t('launcher.diagnostics.copy') }}</span>
              </button>
            </div>
          </div>
        </div>
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
  flex-wrap: wrap;
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

.diag-step-info {
  flex: 1;
  min-width: 160px;
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

.diag-step-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ---- State A ---- */
.device-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  border: 1px solid rgb(var(--green-6) / 45%);
  background-color: rgb(var(--green-1) / 30%);
  border-radius: var(--border-radius-medium);
  padding: 14px 16px;
}

.device-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: rgb(var(--green-6) / 15%);
  color: rgb(var(--green-6));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.device-details {
  flex: 1;
  min-width: 0;
}

.device-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-1);
}

.device-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 4px;
}

.meta-pill {
  border: 1px solid var(--color-border-2);
  border-radius: 999px;
  padding: 0 8px;
  font-size: 11px;
  color: var(--color-text-2);
}

.remote-endpoint {
  color: rgb(var(--arcoblue-6));
}

.device-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: rgb(var(--green-6));
  font-size: 13px;
  flex-shrink: 0;
}

.device-switcher {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.switcher-label {
  font-size: 12px;
  color: var(--color-text-3);
}

.device-select {
  width: 220px;
}

/* ---- State B-1 ---- */
.tracker-card {
  border: 1px solid rgb(var(--arcoblue-6) / 45%);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-3);
  padding: 14px 16px;
}

.tracker-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}

.tracker-icon {
  color: rgb(var(--arcoblue-6));
  font-size: 20px;
  margin-top: 2px;
}

.tracker-titles {
  flex: 1;
  min-width: 200px;
}

.tracker-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tracker-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-1);
}

.avd-highlight {
  color: rgb(var(--arcoblue-6));
  font-family: var(--font-mono, monospace);
}

.tracker-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-text-3);
}

.tracker-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.boot-stepper {
  display: flex;
  align-items: center;
  margin-top: 16px;
  gap: 4px;
  flex-wrap: wrap;
}

.boot-stage {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stage-circle {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  border: 1px solid var(--color-border-3);
  color: var(--color-text-3);
  background-color: var(--color-bg-2);
  flex-shrink: 0;
}

.boot-stage.done .stage-circle {
  background-color: rgb(var(--green-6));
  border-color: rgb(var(--green-6));
  color: #fff;
}

.boot-stage.active .stage-circle {
  border-color: rgb(var(--arcoblue-6));
  color: rgb(var(--arcoblue-6));
}

.stage-label {
  font-size: 11px;
  color: var(--color-text-3);
  white-space: nowrap;
}

.boot-stage.done .stage-label {
  color: var(--color-text-1);
}

.stage-line {
  flex: 1;
  min-width: 12px;
  height: 1px;
  background-color: var(--color-border-2);
}

.stage-line.done {
  background-color: rgb(var(--green-6));
}

.boot-progress {
  margin-top: 14px;
}

.boot-progress-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 4px;
}

.boot-tip {
  margin-top: 12px;
}

.boot-logs {
  margin-top: 12px;
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-small);
  overflow: hidden;
}

.logs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background-color: var(--color-fill-2);
  font-size: 12px;
  color: var(--color-text-2);
}

.logs-body {
  margin: 0;
  padding: 10px 12px;
  max-height: 220px;
  overflow: auto;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-text-2);
  background-color: var(--color-bg-1);
}

.log-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.log-empty {
  color: var(--color-text-4);
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

/* ---- State B-2 ---- */
.failed-card {
  border: 1px solid rgb(var(--red-6) / 45%);
  border-radius: var(--border-radius-medium);
  background-color: rgb(var(--red-1) / 25%);
  padding: 14px 16px;
}

.failed-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.failed-icon {
  color: rgb(var(--red-6));
  font-size: 20px;
  margin-top: 2px;
}

.failed-titles {
  flex: 1;
  min-width: 0;
}

.failed-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-1);
}

.failed-desc {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-text-3);
  word-break: break-word;
}

.failed-logs {
  margin-top: 12px;
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-small);
  overflow: hidden;
}

.failed-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

/* ---- State B-3 ---- */
.avd-empty-notice {
  margin-bottom: 14px;
}

.avd-empty-inline {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-text-3);
}

.guide-panel {
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-3);
  padding: 14px 16px;
}

.method-nav {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 720px) {
  .method-nav {
    grid-template-columns: 1fr;
  }
}

.method-card {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  background-color: var(--color-bg-2);
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.method-card:hover {
  border-color: var(--color-border-3);
}

.method-card.active {
  border-color: rgb(var(--arcoblue-6));
}

.method-icon {
  font-size: 18px;
  color: var(--color-text-3);
  flex-shrink: 0;
}

.method-card.active .method-icon {
  color: rgb(var(--arcoblue-6));
}

.method-texts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.method-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.method-desc {
  font-size: 11px;
  color: var(--color-text-3);
}

.remote-notice {
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px dashed rgb(var(--arcoblue-6) / 60%);
  border-radius: var(--border-radius-medium);
  padding: 10px 12px;
  font-size: 12px;
  color: var(--color-text-2);
  flex-wrap: wrap;
}

.method-panel {
  margin-top: 14px;
  border-top: 1px solid var(--color-border-2);
  padding-top: 14px;
}

.panel-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.avd-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.avd-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  padding: 8px 12px;
  background-color: var(--color-bg-2);
}

.avd-icon {
  color: var(--color-text-3);
}

.avd-name {
  flex: 1;
  font-size: 13px;
  color: var(--color-text-1);
  font-family: var(--font-mono, monospace);
}

.method-intro {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-1);
  margin-bottom: 12px;
}

.usb-steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.usb-step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.usb-step-num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: var(--color-fill-3);
  color: var(--color-text-2);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.usb-step-title {
  font-size: 13px;
  color: var(--color-text-1);
  font-weight: 500;
}

.usb-step-desc {
  font-size: 12px;
  color: var(--color-text-3);
}

.wifi-form {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.wifi-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 160px;
}

.wifi-port-field {
  flex: 0 0 120px;
  min-width: 120px;
}

.wifi-label {
  font-size: 12px;
  color: var(--color-text-3);
}

.wifi-alert {
  margin-top: 10px;
}

.callout {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 10px;
}

.remember-check {
  margin-top: 10px;
  font-size: 12px;
}

.remote-devices {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.remote-device-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-2);
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-small);
  padding: 6px 10px;
}

.remote-device-name {
  color: var(--color-text-1);
  font-weight: 500;
}

.remote-device-serial {
  font-family: var(--font-mono, monospace);
  color: var(--color-text-3);
  flex: 1;
}

.remote-activate-btn {
  margin-top: 10px;
}

.remote-explain {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--color-text-3);
}

/* ---- State C ---- */
.locked-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  border: 1px solid rgb(var(--orange-6) / 45%);
  background-color: rgb(var(--orange-1) / 30%);
  border-radius: var(--border-radius-medium);
  padding: 12px 14px;
  margin-top: 12px;
}

.locked-icon {
  color: rgb(var(--orange-6));
  font-size: 18px;
  margin-top: 2px;
}

.locked-texts {
  flex: 1;
  min-width: 0;
}

.locked-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.locked-desc {
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 2px;
}

/* ---- State D ---- */
.adb-missing {
  margin-top: 4px;
}

.install-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

@media (max-width: 860px) {
  .install-cards {
    grid-template-columns: 1fr;
  }
}

.install-card {
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  padding: 10px 12px;
  background-color: var(--color-bg-3);
}

.install-card.highlight {
  border-color: rgb(var(--green-6) / 60%);
}

.install-os {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-2);
  margin-bottom: 8px;
}

.code-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background-color: var(--color-fill-2);
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-small);
  padding: 6px 10px;
  overflow: hidden;
}

.code-text {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--color-text-2);
  white-space: nowrap;
  overflow-x: auto;
  flex: 1;
  scrollbar-width: none;
}
</style>
