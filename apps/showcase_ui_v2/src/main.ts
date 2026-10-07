import { createPinia } from 'pinia';
import { createApp } from 'vue';
import ArcoVue from '@arco-design/web-vue';

import App from './App.vue';
import i18n from './locales';
import router from './router';

import '@arco-design/web-vue/dist/arco.css';
import './styles/index.css';

// 主题：ConfigProvider 的 theme="dark" 覆盖组件树；
// body 上的 arco-theme 属性让 Arco 的全局 CSS 变量（页面背景等）跟随切换。
// 默认暗色，用户在顶栏切换后写入 localStorage，这里按持久化值恢复。
const storedTheme = localStorage.getItem('artemis.theme');
document.body.setAttribute('arco-theme', storedTheme === 'light' ? 'light' : 'dark');

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(i18n);
app.use(ArcoVue);

app.mount('#app');
