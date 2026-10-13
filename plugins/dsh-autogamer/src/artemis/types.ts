/**
 * External ARTEMIS backend surface (dsh-autogamer rectification, Phase 1).
 *
 * ARTEMIS is an EXTERNAL provider (a separate checkout/service): this plugin
 * holds none of its code. Phase 0 verified the fork's old top-level MCP face
 * (`mobile_run_task` / `mobile_manage_task` / `mobile_get_device_state` /
 * `mobile_inspect_trace` / `mobile_diagnose` over FastMCP stdio) from our own
 * git history (`pre-contraction:mcp_server/`), and that those tools answer
 * with stringified JSON. Only `getDeviceState` is wired in Phase 1; the other
 * four land with their tools in Phase 2 (no throwing stubs — the interface
 * grows then).
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

export interface ArtemisBackend {
  getDeviceState(args: DeviceStateArgs): Promise<DeviceState>;
  dispose(): Promise<void>;
}
