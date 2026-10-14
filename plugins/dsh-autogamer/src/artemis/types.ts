/**
 * External ARTEMIS backend surface (dsh-autogamer rectification, Phase 2).
 *
 * Request shapes below are locked against the fork's old top-level MCP face
 * (`pre-contraction:mcp_server/tools/*.py`), not against the scheme text —
 * the scheme's assumed backend params were wrong in detail:
 * - run takes `task_desc`/`model` ("Flash"/"Pro") and answers `trace_id`
 *   (no timeout/max-steps params exist — accepted by our tool, not forwarded);
 * - device state takes a REQUIRED `view_type` ("screenshot"|"hierarchy") and
 *   answers plain text (`file://…`, a hierarchy dump, or `Error: …`), NOT JSON;
 * - manage actions are exactly status/stop/inject_instruction over `trace_id`;
 * - inspect actions are view_summary/search/view_step_screenshots/view_step_details;
 * - diagnose takes no logcat/screenshot flags (device_serial only).
 * A live provider newer than the fork may differ — refine on live evidence.
 */

export interface DeviceStateArgs {
  deviceSerial?: string;
  includeScreenshot?: boolean;
}

export interface DeviceState {
  deviceSerial: string;
  connected: boolean;
  currentPackage?: string;
  currentActivity?: string;
  screenSummary?: string;
  screenshotPath?: string;
  helperInstalled?: boolean;
}

export interface TaskStartArgs {
  instruction: string;
  profile: "Flash" | "Pro";
  deviceSerial?: string;
}

export interface TaskInfo {
  taskId: string;
  profile: string;
  deviceSerial?: string;
  startedAt: string;
}

export type ManageAction = "status" | "stop" | "inject_instruction";

export interface ManageArgs {
  taskId: string;
  action: ManageAction;
  instruction?: string;
}

export interface TaskStep {
  index?: number;
  action?: string;
  reasoning?: string;
  screenshotPath?: string;
  timestamp?: string;
  durationMs?: number;
  status?: string;
  ok?: boolean;
}

export interface TaskStatus {
  taskId: string;
  state?: string;
  currentStep?: number;
  totalSteps?: number;
  lastAction?: string;
  recentSteps?: TaskStep[];
  elapsedSeconds?: number;
  finalSummary?: string;
}

export interface InspectArgs {
  traceId: string;
}

export interface TraceView {
  taskId: string;
  finalStatus?: string;
  totalSteps?: number;
  steps: TaskStep[];
  artifactPaths: string[];
}

export interface DiagnoseArgs {
  deviceSerial?: string;
}

export interface CrashEntry {
  package?: string;
  timestamp?: string;
  stackExcerpt?: string;
}

export interface Diagnosis {
  deviceSerial?: string;
  adbConnected?: boolean;
  helperInstalled?: boolean;
  helperVersion?: string;
  recentCrashes: CrashEntry[];
  logcatPath?: string;
  screenshotPath?: string;
  recommendations: string[];
}

export interface ArtemisBackend {
  getDeviceState(args: DeviceStateArgs, signal?: AbortSignal): Promise<DeviceState>;
  startTask(args: TaskStartArgs, signal?: AbortSignal): Promise<TaskInfo>;
  manageTask(args: ManageArgs, signal?: AbortSignal): Promise<TaskStatus>;
  inspectTrace(args: InspectArgs, signal?: AbortSignal): Promise<TraceView>;
  diagnose(args: DiagnoseArgs, signal?: AbortSignal): Promise<Diagnosis>;
  dispose(): Promise<void>;
}
