import { flushPromises, mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createI18n } from 'vue-i18n';

import zhCN from '../../locales/zh-CN';
import enUS from '../../locales/en-US';
import TaskPresets from './TaskPresets.vue';

/**
 * 组件测试：TaskPresets（B6 推荐任务 chips）。
 * api mock 参照 DiagnosticsWizard.spec：vi.mock('@/services/api')。
 * 覆盖：presets chips 渲染、点击 emit select（goal 填入由父组件完成）、
 * 空列表 / 加载失败时整区静默隐藏、按 id 的中文覆盖与 en-US 下退回后端英文。
 */

vi.mock('@/services/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

import { apiGet } from '@/services/api';

const apiGetMock = apiGet as unknown as Mock;

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
});

/** 与真实应用一致：en-US 界面仍以 zh-CN 作 fallbackLocale，用来验证覆盖查找不外溢。 */
function mountLocalized(locale: 'zh-CN' | 'en-US') {
  const instance = createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'zh-CN',
    messages: { 'zh-CN': zhCN, 'en-US': enUS },
  });
  return mount(TaskPresets, { global: { plugins: [ArcoVue, instance] } });
}

// 后端目录里的真实条目（task_preset_catalog.py），用来验证 id 命中的中文覆盖。
const CATALOG_PRESET = [
  {
    id: 'clock_timer',
    title: '25-Min Pomodoro Timer',
    description: 'Start a 25 minute countdown in the Clock app',
    goal: 'Open Clock app, switch to Timer tab, set 25 minutes and start the countdown timer.',
    tag: 'Clock',
    apps: [],
    profile: 'flash',
    category: 'flash',
    required_packages: [],
    match_mode: 'any',
    priority: 50,
    is_device_matched: true,
  },
];

// 条目形状对齐后端 TaskPreset.model_dump()（task_preset_catalog.py）。
const PRESETS = [
  {
    id: 'clock-countdown',
    title: '打开时钟倒计时',
    description: '启动时钟应用并开始 1 分钟倒计时',
    goal: '打开时钟应用并启动 1 分钟倒计时',
    tag: 'system',
    apps: [],
    profile: 'flash',
    category: 'flash',
    required_packages: [],
    match_mode: 'any',
    priority: 50,
    is_device_matched: true,
  },
  {
    id: 'photo-search',
    title: '拍照搜索',
    description: '打开相机拍摄并搜索',
    goal: '打开相机应用，拍摄一张照片并进行搜索',
    tag: 'media',
    apps: [],
    profile: 'pro',
    category: 'cross_app',
    required_packages: [],
    match_mode: 'any',
    priority: 40,
    is_device_matched: false,
  },
];

function mountPresets() {
  return mount(TaskPresets, {
    global: {
      plugins: [ArcoVue, i18n],
    },
  });
}

describe('TaskPresets (B6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGetMock.mockReset();
  });

  it('fetches recommended presets on mount and renders chips', async () => {
    apiGetMock.mockResolvedValue(PRESETS);
    const wrapper = mountPresets();
    await flushPromises();

    expect(apiGetMock).toHaveBeenCalledWith('/api/tasks/presets', {
      params: { category: 'recommended', packages: '', limit: 8 },
    });
    expect(wrapper.text()).toContain('推荐任务');
    expect(wrapper.text()).toContain('打开时钟倒计时');
    expect(wrapper.text()).toContain('拍照搜索');
    expect(wrapper.findAll('.preset-chip')).toHaveLength(2);
  });

  it('emits select with the preset goal (fill input, no direct submit)', async () => {
    apiGetMock.mockResolvedValue(PRESETS);
    const wrapper = mountPresets();
    await flushPromises();

    const chips = wrapper.findAll('.preset-chip');
    await chips[0]!.trigger('click');
    await chips[1]!.trigger('click');

    const emitted = wrapper.emitted('select');
    expect(emitted).toHaveLength(2);
    expect(emitted?.[0]).toEqual(['打开时钟应用并启动 1 分钟倒计时']);
    expect(emitted?.[1]).toEqual(['打开相机应用，拍摄一张照片并进行搜索']);
  });

  it('hides the whole section when the payload is empty', async () => {
    apiGetMock.mockResolvedValue([]);
    const wrapper = mountPresets();
    await flushPromises();

    expect(wrapper.find('.presets-card').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('推荐任务');
  });

  it('hides the whole section silently when the request fails', async () => {
    apiGetMock.mockRejectedValue(new Error('network down'));
    const wrapper = mountPresets();
    await flushPromises();

    expect(wrapper.find('.presets-card').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('推荐任务');
  });

  it('hides the whole section when the payload is not an array', async () => {
    apiGetMock.mockResolvedValue({ detail: 'unexpected' });
    const wrapper = mountPresets();
    await flushPromises();

    expect(wrapper.find('.presets-card').exists()).toBe(false);
  });

  it('localizes chip label and emitted goal by preset id', async () => {
    apiGetMock.mockResolvedValue(CATALOG_PRESET);
    const wrapper = mountLocalized('zh-CN');
    await flushPromises();

    expect(wrapper.text()).toContain('25 分钟番茄计时器');
    expect(wrapper.text()).not.toContain('25-Min Pomodoro Timer');

    await wrapper.findAll('.preset-chip')[0]!.trigger('click');
    expect(wrapper.emitted('select')?.[0]).toEqual([
      '打开时钟应用，切换到计时器标签，设置 25 分钟并启动倒计时。',
    ]);
  });

  it('keeps English under en-US even though zh-CN is the fallback locale', async () => {
    apiGetMock.mockResolvedValue(CATALOG_PRESET);
    const wrapper = mountLocalized('en-US');
    await flushPromises();

    expect(wrapper.text()).toContain('25-Min Pomodoro Timer');
    expect(wrapper.text()).not.toContain('番茄');

    await wrapper.findAll('.preset-chip')[0]!.trigger('click');
    expect(wrapper.emitted('select')?.[0]).toEqual([CATALOG_PRESET[0]!.goal]);
  });
});
