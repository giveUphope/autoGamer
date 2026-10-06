/**
 * zh-CN 文案（默认 locale）。M0 仅埋骨架 key，后续里程碑按模块补全。
 */
export default {
  nav: {
    launcher: '启动器',
    workspace: '工作台',
  },
  app: {
    title: 'ARTEMIS 控制台',
  },
  launcher: {
    title: 'ARTEMIS 控制台（Vue 版）',
    description:
      '这是 Angular 前端向 Vue 3 + Arco Design Vue 迁移的 M0 脚手架占位页。当前 Angular 版本仍在主路径服务，切换发生在 M6。',
    ping: '测试后端连接',
    pingOk: '后端连接正常（/api/status → 200）',
    pingFail: '后端连接失败：{reason}',
  },
  workspace: {
    title: '工作台',
    description:
      '工作台占位页：AgentStream 时间线、任务队列与浮动播放器将在 M1-M4 里程碑实现。',
  },
};
