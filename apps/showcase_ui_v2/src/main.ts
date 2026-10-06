import { createPinia } from 'pinia';
import { createApp } from 'vue';
import ArcoVue from '@arco-design/web-vue';

import App from './App.vue';
import i18n from './locales';
import router from './router';

import '@arco-design/web-vue/dist/arco.css';
import './styles/index.css';

// 暗色主题：ConfigProvider 的 theme="dark" 覆盖组件树；
// body 上的 arco-theme 属性让 Arco 的全局 CSS 变量（页面背景等）切换到暗色。
document.body.setAttribute('arco-theme', 'dark');

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(i18n);
app.use(ArcoVue);

app.mount('#app');
