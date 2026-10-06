/**
 * 诊断向导消费的 system store 契约。
 *
 * 数据层 `src/stores/system.ts` 已完整平移 Angular SystemService（M5 数据层）。
 * 此文件保留一层窄契约视图：组件按 `SystemStoreContract` 类型消费，
 * `useSystemContract()` 内做**编译期结构断言**——数据层导出与契约漂移时
 * 在此报错，而不是被 `as` 强转掩盖。
 */
import { useSystemStore } from '@/stores/system';
import type {
  AdbServerConnectionResponse,
  AdbServerStatus,
  CredentialEntriesResponse,
  CredentialEndpointRow,
  DeviceInfo,
  EmulatorLaunchState,
  ModelConfigEnvResponse,
  ModelConfigUpdatePayload,
  ModelConfigUpdateResult,
  ProbeResult,
  SystemReadinessReport,
} from '@/types/system.model';

/** 数据层已平移至 @/types/system.model；此处 re-export 维持组件侧 import 路径稳定。 */
export type {
  CredentialEntriesResponse,
  CredentialEndpointRow,
  ModelConfigEnvResponse,
  ModelConfigUpdatePayload,
  ModelConfigUpdateResult,
};

/** testApiKey 响应。 */
export interface ApiKeyTestResult {
  valid: boolean;
  provider: string;
  message: string;
}

/** updateApiKey 响应（仅消费 message）。 */
export interface ApiKeyUpdateResult {
  message?: string;
}

/** restartAdb 响应（仅消费 restart_result.skipped）。 */
export interface AdbRestartResult {
  restart_result?: { skipped?: boolean } | null;
}

/** connectWirelessAdb 响应（仅消费 connect_result）。 */
export interface WirelessAdbResult {
  connect_result?: { success?: boolean; message?: string } | null;
}

/**
 * useSystemStore() 实例的契约视图（setup store 的 state/computed 在实例上自动解包）。
 * 字段清单与并行数据层的导出契约逐一对齐。
 */
export interface SystemStoreContract {
  // ---- 状态 ----
  readinessReport: SystemReadinessReport | null;
  isLoading: boolean;
  isRestartingAdb: boolean;
  adbServerStatus: AdbServerStatus | null;
  launchingAvd: string | null;
  emulatorLaunchState: EmulatorLaunchState | null;
  lastCheckedTime: Date | null;
  isSkipCredentialsCheck: boolean;
  modelConfigEnv: ModelConfigEnvResponse | null;
  credentialRows: CredentialEndpointRow[];

  // ---- computed ----
  readonly hasReadinessReport: boolean;
  readonly isRemoteAdbServer: boolean;
  readonly isEmulatorLaunching: boolean;
  readonly probes: ProbeResult[];
  readonly pythonProbe: ProbeResult | null;
  readonly configProbe: ProbeResult | null;
  readonly toolchainProbe: ProbeResult | null;
  readonly adbProbe: ProbeResult | null;
  readonly llmProbe: ProbeResult | null;
  readonly ocrProbe: ProbeResult | null;
  readonly isEnvironmentReady: boolean;
  readonly isCredentialsReady: boolean;
  readonly isDeviceReady: boolean;
  readonly isReady: boolean;
  readonly passedStepCount: number;
  readonly totalStepCount: number;
  readonly connectedDevices: DeviceInfo[];
  readonly installedAvds: string[];
  readonly emulatorPath: string | null;
  readonly isEmulatorInPath: boolean;
  readonly currentApiKey: string;
  readonly apiKeysMap: Record<string, string>;
  readonly activeDevice: DeviceInfo | null;
  readonly osType: 'linux' | 'darwin' | 'windows';

  // ---- actions（Promise，错误透传）----
  startAutoPolling(intervalMs?: number): void;
  stopAutoPolling(): void;
  fetchReadiness(silent?: boolean, forceRefresh?: boolean): Promise<SystemReadinessReport>;
  skipCredentialsCheck(): void;
  setSkipCredentialsCheck(skip: boolean): void;
  fetchEmulatorStatus(): Promise<EmulatorLaunchState>;
  startEmulatorStatusPolling(): void;
  stopEmulatorStatusPolling(): void;
  launchEmulator(avdName: string): Promise<EmulatorLaunchState>;
  stopEmulator(): Promise<unknown>;
  dismissEmulatorStatus(): Promise<unknown>;
  restartAdb(): Promise<AdbRestartResult | null>;
  connectWirelessAdb(host: string, port?: number): Promise<WirelessAdbResult | null>;
  fetchAdbServerStatus(): Promise<AdbServerStatus>;
  probeAdbServer(host: string, port: number): Promise<AdbServerConnectionResponse>;
  connectAdbServer(host: string, port: number, persist?: boolean): Promise<AdbServerConnectionResponse>;
  useLocalAdbServer(persist?: boolean): Promise<AdbServerConnectionResponse>;
  selectDevice(serial: string): Promise<unknown>;
  fetchModelConfigEnv(): Promise<ModelConfigEnvResponse>;
  testApiKey(provider: string, apiKey: string, baseUrl?: string): Promise<ApiKeyTestResult>;
  updateApiKey(provider: string, apiKey: string, persistToEnv?: boolean): Promise<ApiKeyUpdateResult | null>;
  saveModelConfig(payload: ModelConfigUpdatePayload): Promise<ModelConfigUpdateResult | null>;
  fetchCredentialEntries(): Promise<CredentialEntriesResponse>;
  deleteEndpointRecord(): Promise<{ status?: string; message?: string } | null>;
}

/** 按契约消费 system store（编译期结构断言：真实 store 必须与契约逐字段兼容）。 */
export function useSystemContract(): SystemStoreContract {
  const store = useSystemStore();
  // 结构断言：若数据层导出与契约漂移（缺字段/类型不符），此处编译报错。
  const structuralCheck: SystemStoreContract = store;
  void structuralCheck;
  return store;
}
