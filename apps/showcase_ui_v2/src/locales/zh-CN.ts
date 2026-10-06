/**
 * zh-CN 文案（默认 locale）。M0 仅埋骨架 key，后续里程碑按模块补全。
 * M1：状态、连接、启动器任务提交与会话摘要、工作台队列/命令条。
 */
export default {
  nav: {
    launcher: '启动器',
    workspace: '工作台',
  },
  app: {
    title: 'ARTEMIS 控制台',
  },
  status: {
    idle: '空闲',
    running: '运行中',
    paused: '已暂停',
    pending: '排队中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    offline: '离线',
  },
  connection: {
    online: '已连接',
    offline: '连接断开',
  },
  launcher: {
    title: 'ARTEMIS 控制台（Vue 版）',
    description:
      'Vue 3 + Arco Design Vue 重构版控制台（M1）：提交任务、查看队列与会话摘要。诊断向导将在 M5 交付。',
    taskTitle: '提交新任务',
    goalLabel: '任务目标',
    goalPlaceholder: '描述你要让 ARTEMIS 完成的任务，例如：打开时钟并启动 1 分钟倒计时…',
    submit: '提交任务',
    submitting: '提交中…',
    submitFail: '提交失败：{reason}',
    summaryTitle: '会话摘要',
    openWorkspace: '进入工作台',
    summary: {
      total: '全部会话',
      running: '进行中',
      pending: '排队中',
      done: '已完成',
    },
  },
  workspace: {
    title: '工作台',
    description: 'M1：任务队列、会话列表与命令条。时间线将在 M2、实时流将在 M3 交付。',
    timelinePlaceholder: '会话时间线将在 M2 里程碑交付',
    queue: {
      tabQueue: '队列',
      tabHistory: '历史',
      emptyQueue: '暂无排队或运行中的任务',
      emptyHistory: '暂无历史会话',
      stop: '停止',
      delete: '删除',
      clearAll: '清空历史',
      deleteConfirm: '确定删除该任务？此操作不可恢复。',
      clearAllConfirm: '确定清空全部任务与历史？此操作不可恢复。',
      device: '设备',
      noDevice: '未指定',
    },
    dock: {
      capsuleHint: '输入任务指令',
      placeholder: '输入任务指令，回车提交',
      submit: '提交',
      submitFail: '提交失败：{reason}',
    },
  },
};
