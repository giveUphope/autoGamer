import { mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';

import zhCN from '../locales/zh-CN';
import LauncherView from './LauncherView.vue';

/** 组件冒烟：Arco 组件能在 Vue 版工程内正常渲染。 */
const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
});

function mountView() {
  return mount(LauncherView, {
    global: {
      plugins: [ArcoVue, i18n],
    },
  });
}

describe('LauncherView (M0 placeholder)', () => {
  it('renders the M0 title', () => {
    const wrapper = mountView();
    expect(wrapper.text()).toContain('ARTEMIS 控制台（Vue 版）');
  });

  it('renders an Arco button', () => {
    const wrapper = mountView();
    expect(wrapper.find('.arco-btn').exists()).toBe(true);
  });
});
