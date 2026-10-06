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
  launcher: {
    title: 'ARTEMIS Console (Vue Edition)',
    description:
      'M0 scaffold placeholder for the Angular to Vue 3 + Arco Design Vue migration. The Angular app still serves the main path; the cutover happens at M6.',
    ping: 'Test backend connection',
    pingOk: 'Backend reachable (/api/status → 200)',
    pingFail: 'Backend request failed: {reason}',
  },
  workspace: {
    title: 'Workspace',
    description:
      'Workspace placeholder: the AgentStream timeline, task queue and floating player arrive in milestones M1-M4.',
  },
};
