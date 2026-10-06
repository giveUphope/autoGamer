/**
 * en-US 文案（次要 locale，键集必须与 zh-CN 保持一致，由测试锁定）。
 */
export default {
  nav: {
    launcher: 'Launcher',
    workspace: 'Workspace',
  },
  app: {
    title: 'ARTEMIS Console',
  },
  status: {
    idle: 'Idle',
    running: 'Running',
    paused: 'Paused',
    pending: 'Queued',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    offline: 'Offline',
  },
  connection: {
    online: 'Connected',
    offline: 'Disconnected',
  },
  launcher: {
    title: 'ARTEMIS Console (Vue Edition)',
    description:
      'Vue 3 + Arco Design Vue rewrite (M1): submit tasks, watch the queue and the session summary. The diagnostics wizard arrives in M5.',
    taskTitle: 'Submit a new task',
    goalLabel: 'Task goal',
    goalPlaceholder: 'Describe the task for ARTEMIS, e.g. open the clock and start a 1-minute countdown…',
    submit: 'Submit task',
    submitting: 'Submitting…',
    submitFail: 'Submit failed: {reason}',
    summaryTitle: 'Session summary',
    openWorkspace: 'Open workspace',
    summary: {
      total: 'All sessions',
      running: 'Active',
      pending: 'Queued',
      done: 'Finished',
    },
  },
  workspace: {
    title: 'Workspace',
    description: 'M1: task queue, session list and the command dock. Timeline arrives in M2, live stream in M3.',
    timelinePlaceholder: 'The session timeline will arrive in milestone M2',
    queue: {
      tabQueue: 'Queue',
      tabHistory: 'History',
      emptyQueue: 'No queued or running tasks',
      emptyHistory: 'No historical sessions',
      stop: 'Stop',
      delete: 'Delete',
      clearAll: 'Clear history',
      deleteConfirm: 'Delete this task? This cannot be undone.',
      clearAllConfirm: 'Clear all tasks and history? This cannot be undone.',
      device: 'Device',
      noDevice: 'Unassigned',
    },
    dock: {
      capsuleHint: 'Type a task instruction',
      placeholder: 'Type a task instruction, Enter to submit',
      submit: 'Submit',
      submitFail: 'Submit failed: {reason}',
    },
  },
};
