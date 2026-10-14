/**
 * External ARTEMIS backend surface (dsh-autogamer rectification, Phase 2).
 *
 * The provider's TASK face (`mobile_run_task` / `mobile_manage_task` /
 * `mobile_inspect_trace`) is gone from this interface (T1 / G82): the three task
 * tools now read the session's own projection, so the engine has no consumer
 * left, and leaving the methods on the type would keep advertising a path the
 * plugin does not take. What remains is device state and diagnostics, which the
 * D19 terminal state keeps as the optional external provider until T4 (§一.3).
 *
 * Request shapes below are locked against the fork's old top-level MCP face
 * (`pre-contraction:mcp_server/tools/*.py`), not against the scheme text —
 * the scheme's assumed backend params were wrong in detail:
 * - device state takes a REQUIRED `view_type` ("screenshot"|"hierarchy") and
 *   answers plain text (`file://…`, a hierarchy dump, or `Error: …`), NOT JSON;
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
  diagnose(args: DiagnoseArgs, signal?: AbortSignal): Promise<Diagnosis>;
  dispose(): Promise<void>;
}
