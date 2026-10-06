<script setup lang="ts">
/**
 * 诊断向导 STEP 1：系统与环境。
 * 四张探针卡（python_runtime / android_adb / system_config / toolchain）+ 状态徽标
 * + probe.actions（command 复制 / hint tooltip / link 外链）+ 依赖缺失时的一键安装条
 * （聚合各 probe 的 command）。probe 的 title/summary 为后端字段，原样透传。
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Component } from 'vue';
import {
  IconCheck,
  IconCheckCircleFill,
  IconCloseCircleFill,
  IconCode,
  IconCopy,
  IconExclamationCircleFill,
  IconLink,
  IconMinusCircle,
  IconMobile,
  IconQuestionCircle,
  IconSettings,
  IconTool,
  IconVideoCamera,
} from '@arco-design/web-vue/es/icon';
import type { ProbeResult } from '@/types/system.model';

import { useSystemContract } from './contract';
import { useCopy } from './useCopy';

const { t, te } = useI18n();
const system = useSystemContract();
const { copiedId, copy } = useCopy();

const probeCards = computed<{ id: string; icon: Component; probe: ProbeResult | null }[]>(() => [
  { id: 'python_runtime', icon: IconCode, probe: system.pythonProbe },
  { id: 'android_adb', icon: IconTool, probe: system.adbProbe },
  { id: 'system_config', icon: IconSettings, probe: system.configProbe },
  { id: 'toolchain', icon: IconVideoCamera, probe: system.toolchainProbe },
]);

/**
 * 后端探针的 title/summary 是英文原样字段；标题按卡片 id 走 i18n，
 * 摘要按已知文案映射或模板正则翻译，未知内容原样透传。
 */
function probeTitle(cardId: string, probe: ProbeResult | null): string {
  const key = `launcher.diagnostics.env.card.${cardId}`;
  if (te(key)) return t(key);
  return probe?.title || t('launcher.diagnostics.env.checking');
}

const SUMMARY_TEXT_KEYS: Record<string, string> = {
  'Config Valid': 'configValid',
  'Config Error': 'configError',
  'No Device Found': 'noDeviceFound',
  Connected: 'connected',
  'ADB Not Found': 'adbNotFound',
  'ADB Key Corrupted': 'adbKeyCorrupted',
  'Device Booting': 'deviceBooting',
  'Device Unauthorized': 'deviceUnauthorized',
  'Lock State Unknown': 'lockStateUnknown',
  'Ready (FFmpeg + scrcpy)': 'toolchainReady',
};

function probeSummary(probe: ProbeResult | null): string {
  const s = probe?.summary;
  if (!s) return t('launcher.diagnostics.env.checking');
  const key = SUMMARY_TEXT_KEYS[s];
  if (key) return t(`launcher.diagnostics.env.summary.${key}`);
  let m = s.match(/^Python (.+) Ready$/);
  if (m) return t('launcher.diagnostics.env.summary.pythonReady', { version: m[1] });
  m = s.match(/^Python (.+) Unsupported$/);
  if (m) return t('launcher.diagnostics.env.summary.pythonUnsupported', { version: m[1] });
  m = s.match(/^Missing (.+)$/);
  if (m) return t('launcher.diagnostics.env.summary.missing', { tools: m[1] });
  m = s.match(/^Active \((.+)\)$/);
  if (m) return t('launcher.diagnostics.env.summary.active', { name: m[1] });
  return s;
}

type StatusCls = 'pass' | 'warn' | 'fail' | 'skipped' | 'checking';

function statusCls(probe: ProbeResult | null): StatusCls {
  if (!probe) return 'checking';
  return probe.status;
}

function statusIcon(probe: ProbeResult | null): Component {
  switch (statusCls(probe)) {
    case 'pass':
      return IconCheckCircleFill;
    case 'warn':
      return IconExclamationCircleFill;
    case 'fail':
      return IconCloseCircleFill;
    case 'checking':
      return IconCheckCircleFill;
    default:
      return IconMinusCircle;
  }
}

function statusText(probe: ProbeResult | null): string {
  const cls = statusCls(probe);
  if (cls === 'checking') return t('launcher.diagnostics.env.checking');
  return t(`launcher.diagnostics.status.${cls}`);
}

function actionCopyId(cardId: string, index: number): string {
  return `${cardId}-${index}`;
}

/** 一键安装条：聚合所有 probe 中的 command action（去重）。 */
const installCommands = computed<string[]>(() => {
  const seen = new Set<string>();
  const cmds: string[] = [];
  for (const probe of system.probes) {
    for (const action of probe.actions ?? []) {
      if (action.action_type === 'command' && action.payload && !seen.has(action.payload)) {
        seen.add(action.payload);
        cmds.push(action.payload);
      }
    }
  }
  return cmds;
});

const showInstallBar = computed(() => system.hasReadinessReport && !system.isEnvironmentReady);

const INSTALL_BAR_ID = 'env-install';
</script>

<template>
  <section class="diag-step" :class="system.isEnvironmentReady ? 'is-pass' : 'is-pending'">
    <header class="diag-step-header">
      <span class="diag-step-badge" :class="{ pass: system.isEnvironmentReady }">
        <icon-check v-if="system.isEnvironmentReady" />
        <span v-else>1</span>
      </span>
      <div class="diag-step-info">
        <h3 class="diag-step-title">{{ t('launcher.diagnostics.env.title') }}</h3>
        <p class="diag-step-desc">{{ t('launcher.diagnostics.env.desc') }}</p>
      </div>
    </header>

    <div class="diag-step-body">
      <!-- 一键依赖安装条（环境未就绪时） -->
      <div v-if="showInstallBar" class="install-bar">
        <div class="install-bar-text">
          <div class="install-bar-title">{{ t('launcher.diagnostics.env.installTitle') }}</div>
          <div class="install-bar-desc">{{ t('launcher.diagnostics.env.installDesc') }}</div>
        </div>
        <div class="install-bar-commands">
          <div v-for="(cmd, i) in installCommands" :key="cmd" class="code-box">
            <code class="code-text">{{ cmd }}</code>
            <button
              type="button"
              class="copy-btn"
              :class="{ copied: copiedId === `${INSTALL_BAR_ID}-${i}` }"
              @click="copy(cmd, `${INSTALL_BAR_ID}-${i}`)"
            >
              <icon-check v-if="copiedId === `${INSTALL_BAR_ID}-${i}`" />
              <icon-copy v-else />
              <span>{{ copiedId === `${INSTALL_BAR_ID}-${i}` ? t('launcher.diagnostics.copied') : t('launcher.diagnostics.copy') }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 4 卡环境矩阵 -->
      <div class="env-grid">
        <div
          v-for="card in probeCards"
          :key="card.id"
          class="env-card"
          :class="`st-${statusCls(card.probe)}`"
        >
          <div class="env-card-head">
            <span class="env-icon"><component :is="card.icon" /></span>
            <div class="env-titles">
              <div class="env-name">{{ probeTitle(card.id, card.probe) }}</div>
              <div class="env-sub">{{ probeSummary(card.probe) }}</div>
            </div>
            <span class="env-status" :class="`st-${statusCls(card.probe)}`">
              <component :is="statusIcon(card.probe)" />
              <span>{{ statusText(card.probe) }}</span>
            </span>
          </div>

          <!-- probe.actions：command / hint / link -->
          <div
            v-if="card.probe && card.probe.status !== 'pass' && card.probe.actions?.length"
            class="env-card-actions"
          >
            <template v-for="(action, i) in card.probe.actions" :key="`${card.id}-${i}`">
              <div v-if="action.action_type === 'command'" class="code-box">
                <code class="code-text">{{ action.payload }}</code>
                <button
                  type="button"
                  class="copy-btn"
                  :class="{ copied: copiedId === actionCopyId(card.id, i) }"
                  @click="copy(action.payload, actionCopyId(card.id, i))"
                >
                  <icon-check v-if="copiedId === actionCopyId(card.id, i)" />
                  <icon-copy v-else />
                  <span>{{ copiedId === actionCopyId(card.id, i) ? t('launcher.diagnostics.copied') : t('launcher.diagnostics.copy') }}</span>
                </button>
              </div>
              <a-tooltip v-else-if="action.action_type === 'hint'" :content="action.payload">
                <span class="hint-action">
                  <icon-question-circle />
                  <span>{{ action.label }}</span>
                </span>
              </a-tooltip>
              <a
                v-else-if="action.action_type === 'link'"
                :href="action.payload"
                target="_blank"
                rel="noopener noreferrer"
                class="link-action"
              >
                <icon-link />
                <span>{{ action.label }}</span>
              </a>
            </template>
          </div>

          <!-- ADB 卡附设备列表 -->
          <div v-if="card.id === 'android_adb' && system.connectedDevices.length" class="adb-devices">
            <div class="adb-devices-title">{{ t('launcher.diagnostics.env.devicesTitle') }}</div>
            <div v-for="dev in system.connectedDevices" :key="dev.serial" class="adb-device-row">
              <icon-mobile />
              <span class="dev-serial">{{ dev.serial }}</span>
              <span class="dev-meta">{{ [dev.model, dev.state].filter(Boolean).join(' · ') }}</span>
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

.install-bar {
  border: 1px dashed rgb(var(--orange-6) / 60%);
  background-color: rgb(var(--orange-1) / 40%);
  border-radius: var(--border-radius-medium);
  padding: 12px 14px;
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.install-bar-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.install-bar-desc {
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 2px;
}

.install-bar-commands {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
  /* env-card-actions 用 align-items: flex-start 排按钮；命令框改为撑满行宽，
     否则宽度按内容计算，长命令会把盒子顶出卡片 */
  align-self: stretch;
  min-width: 0;
}

.code-text {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--color-text-2);
  /* 长命令自动换行：横向滚动条已被隐藏，nowrap 会让超出部分不可见 */
  white-space: pre-wrap;
  word-break: break-word;
  min-width: 0;
  flex: 1;
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
  flex-shrink: 0;
}

.copy-btn:hover {
  color: var(--color-text-1);
  background-color: var(--color-fill-3);
}

.copy-btn.copied {
  color: rgb(var(--green-6));
}

.env-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 720px) {
  .env-grid {
    grid-template-columns: 1fr;
  }
}

.env-card {
  border: 1px solid var(--color-border-2);
  border-radius: var(--border-radius-medium);
  padding: 12px 14px;
  background-color: var(--color-bg-3);
}

.env-card-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.env-icon {
  display: inline-flex;
  font-size: 18px;
  color: var(--color-text-3);
  margin-top: 2px;
}

.env-titles {
  flex: 1;
  min-width: 0;
}

.env-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.env-sub {
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 2px;
  word-break: break-word;
}

.env-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  flex-shrink: 0;
}

.env-status.st-pass {
  color: rgb(var(--green-6));
}

.env-status.st-warn {
  color: rgb(var(--orange-6));
}

.env-status.st-fail {
  color: rgb(var(--red-6));
}

.env-status.st-skipped,
.env-status.st-checking {
  color: var(--color-text-4);
}

.env-card.st-fail {
  border-color: rgb(var(--red-6) / 45%);
}

.env-card.st-warn {
  border-color: rgb(var(--orange-6) / 45%);
}

.env-card.st-pass {
  border-color: rgb(var(--green-6) / 35%);
}

.env-card-actions {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.hint-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-3);
  cursor: help;
  border-bottom: 1px dashed var(--color-border-3);
}

.link-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: rgb(var(--arcoblue-6));
  text-decoration: none;
}

.link-action:hover {
  text-decoration: underline;
}

.adb-devices {
  margin-top: 10px;
  border-top: 1px solid var(--color-border-2);
  padding-top: 8px;
}

.adb-devices-title {
  font-size: 11px;
  color: var(--color-text-3);
  margin-bottom: 4px;
}

.adb-device-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-2);
  padding: 2px 0;
}

.dev-serial {
  font-family: var(--font-mono, monospace);
  color: var(--color-text-1);
}

.dev-meta {
  color: var(--color-text-3);
}
</style>
