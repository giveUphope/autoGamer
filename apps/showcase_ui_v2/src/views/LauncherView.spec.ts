import { mount } from '@vue/test-utils';
import ArcoVue from '@arco-design/web-vue';
import { describe, expect, it } from 'vitest';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';

import zhCN from '../locales/zh-CN';
import LauncherView from './LauncherView.vue';

/**
 * 组件冒烟：LauncherView（M1 最小可用版）在 Vue 工程内正常渲染——
 * 标题、任务输入、提交按钮与会话数摘要。
 */
const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
});

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/workspace', component: { template: '<div />' } },
  ],
});

function mountView() {
  return mount(LauncherView, {
    global: {
      plugins: [ArcoVue, i18n, createPinia(), router],
    },
  });
}

describe('LauncherView (M1)', () => {
  it('renders the title', () => {
    const wrapper = mountView();
    expect(wrapper.text()).toContain('ARTEMIS 控制台（Vue 版）');
  });

  it('renders a task textarea and a submit button', () => {
    const wrapper = mountView();
    expect(wrapper.find('textarea').exists()).toBe(true);
    expect(wrapper.text()).toContain('提交任务');
    expect(wrapper.find('.arco-btn').exists()).toBe(true);
  });

  it('renders the session summary statistics', () => {
    const wrapper = mountView();
    expect(wrapper.text()).toContain('全部会话');
    expect(wrapper.text()).toContain('进行中');
    expect(wrapper.text()).toContain('排队中');
    expect(wrapper.text()).toContain('已完成');
  });
});
