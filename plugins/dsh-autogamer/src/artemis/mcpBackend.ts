/**
 * MCP stdio backend for the external ARTEMIS provider (Phase 2).
 *
 * Spawns the provider's MCP server (`python -m mcp_server` under the
 * configured repo path by default — Phase 0 read the command off our own
 * history; provider installs vary, so the full argv stays configurable) and
 * talks to it with @modelcontextprotocol/client, the same SDK shape as the
 * in-repo action client. The session is lazy: constructing the backend never
 * spawns anything, so apply() stays spawn-free; the first tool call connects.
 * A dead transport is dropped and rebuilt on the next call.
 *
 * Request/response mapping is locked against the fork's old face
 * (`pre-contraction:mcp_server/tools/*.py`), NOT the scheme text — see
 * `types.ts` for the deviation table. Payload rules:
 * - dict answers arrive stringified (or structured) → parsed to objects;
 * - device state arrives as PLAIN TEXT (`file://…`, a hierarchy dump, or
 *   `Error: …`) because that tool returns `str`, not a dict.
 *
 * Error contract (matches the plugin's classifier vocabulary):
 * - transport/connect/timeout failures → `environment:` (the provider or the
 *   machine is at fault, safe to report and retry later);
 * - a payload outside the documented shape → `internal:` (our mapping or
 *   provider drift — not the device, do not retry the same call).
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type {
  ArtemisBackend,
  DeviceState,
  DeviceStateArgs,
  DiagnoseArgs,
  Diagnosis,
  InspectArgs,
  ManageArgs,
  TaskInfo,
  TaskStartArgs,
  TaskStatus,
  TaskStep,
  TraceView,
} from "./types.js";

export interface McpBackendOptions {
  command: string[];
  cwd?: string;
  callTimeoutMs: number;
}

/** Minimal transport face, so tests can inject a fake without the SDK. */
export interface McpConnection {
  callTool(
    params: { name: string; arguments: Record<string, unknown> },
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  close(): Promise<void>;
}

async function openConnection(options: McpBackendOptions): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: options.command[0] ?? "python",
    args: options.command.slice(1),
    cwd: options.cwd,
  });
  const client = new Client({ name: "dsh-autogamer-artemis", version: "0.1.0" });
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
  return client as unknown as McpConnection;
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function readBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function readStringArray(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

/**
 * The provider's dict tools answer with a string payload (verified on the old
 * face: every tool returns `str`). Prefer a structured result when the SDK
 * hands one over, else parse the first text block as JSON.
 */
function payloadObject(answer: unknown, tool: string): Record<string, unknown> {
  const record = (answer ?? {}) as {
    structuredContent?: unknown;
    content?: Array<{ type?: unknown; text?: unknown }>;
  };
  if (record.structuredContent !== undefined) {
    if (typeof record.structuredContent === "object" && record.structuredContent !== null) {
      return record.structuredContent as Record<string, unknown>;
    }
    throw new Error(
      `internal: ${tool} answered with a non-object structured result (provider drift; do not retry the same call)`,
    );
  }
  const text = extractText(answer);
  if (text === undefined) {
    throw new Error(
      `internal: ${tool} answered with no text payload (provider drift; do not retry the same call)`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `internal: ${tool} answered with non-JSON text (provider drift; do not retry the same call)`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `internal: ${tool} answered with a non-object JSON payload (provider drift; do not retry the same call)`,
    );
  }
  return parsed as Record<string, unknown>;
}

/** First text block of an SDK result, or a string structured result. */
function extractText(answer: unknown): string | undefined {
  const record = (answer ?? {}) as {
    structuredContent?: unknown;
    content?: Array<{ type?: unknown; text?: unknown }>;
  };
  if (typeof record.structuredContent === "string") return record.structuredContent;
  if (!Array.isArray(record.content)) return undefined;
  const block = record.content.find((entry) => typeof entry?.text === "string");
  return typeof block?.text === "string" ? block.text : undefined;
}

export class McpArtemisBackend implements ArtemisBackend {
  private connection?: McpConnection;
  private starting?: Promise<McpConnection>;

  constructor(
    private readonly options: McpBackendOptions,
    private readonly connect: (options: McpBackendOptions) => Promise<McpConnection> = openConnection,
  ) {}

  /**
   * The old face takes a REQUIRED view_type and answers plain text: a
   * `file://…` screenshot path, a hierarchy dump, or an `Error: …` refusal.
   */
  async getDeviceState(args: DeviceStateArgs, signal?: AbortSignal): Promise<DeviceState> {
    const params: Record<string, unknown> = {
      view_type: args.includeScreenshot === true ? "screenshot" : "hierarchy",
    };
    if (args.deviceSerial !== undefined) params.device_serial = args.deviceSerial;
    let answer: unknown;
    try {
      answer = await this.call("mobile_get_device_state", params, signal);
    } catch (error) {
      throw new Error(
        `environment: ARTEMIS provider did not answer mobile_get_device_state (${(error as Error)?.message ?? error})`,
      );
    }
    const text = extractText(answer);
    if (text === undefined) {
      throw new Error(
        "internal: mobile_get_device_state answered with no text payload (provider drift; do not retry the same call)",
      );
    }
    if (text.startsWith("Error:")) {
      throw new Error(`environment: provider refused device state (${text.slice(0, 300)})`);
    }
    if (args.includeScreenshot === true) {
      return { deviceSerial: args.deviceSerial ?? "", connected: true, screenshotPath: text };
    }
    return { deviceSerial: args.deviceSerial ?? "", connected: true, screenSummary: text };
  }

  async startTask(args: TaskStartArgs, signal?: AbortSignal): Promise<TaskInfo> {
    const params: Record<string, unknown> = {
      task_desc: args.instruction,
      model: args.profile,
    };
    if (args.deviceSerial !== undefined) params.device_serial = args.deviceSerial;
    const payload = await this.dictCall("mobile_run_task", params, signal);
    const taskId = readString(payload, ["trace_id", "task_id"]);
    if (taskId === undefined) {
      throw new Error(
        "internal: mobile_run_task answered with no trace_id (provider drift; do not retry the same call)",
      );
    }
    return {
      taskId,
      profile: args.profile,
      ...(args.deviceSerial !== undefined ? { deviceSerial: args.deviceSerial } : {}),
      startedAt: new Date().toISOString(),
    };
  }

  async manageTask(args: ManageArgs, signal?: AbortSignal): Promise<TaskStatus> {
    const params: Record<string, unknown> = { action: args.action, trace_id: args.taskId };
    if (args.instruction !== undefined) params.instruction = args.instruction;
    const payload = await this.dictCall("mobile_manage_task", params, signal);
    const steps = Array.isArray(payload.steps)
      ? (payload.steps as Record<string, unknown>[])
      : Array.isArray(payload.recent_actions)
        ? (payload.recent_actions as Record<string, unknown>[])
        : [];
    return {
      taskId: args.taskId,
      state: readString(payload, ["state", "status"]),
      currentStep: readNumber(payload, ["current_step", "step", "currentStep"]),
      totalSteps: readNumber(payload, ["total_steps", "totalSteps"]),
      lastAction: readString(payload, ["last_action", "lastAction"]),
      recentSteps: steps.map(mapStep),
      elapsedSeconds: readNumber(payload, ["elapsed_seconds", "elapsedSeconds", "elapsed"]),
      finalSummary: readString(payload, ["final_summary", "finalSummary", "summary"]),
    };
  }

  async inspectTrace(args: InspectArgs, signal?: AbortSignal): Promise<TraceView> {
    const payload = await this.dictCall("mobile_inspect_trace", { action: "view_summary", trace_id: args.traceId }, signal);
    const raw = Array.isArray(payload.steps) ? (payload.steps as Record<string, unknown>[]) : [];
    return {
      taskId: args.traceId,
      finalStatus: readString(payload, ["final_status", "finalStatus", "status", "state"]),
      totalSteps: readNumber(payload, ["total_steps", "totalSteps"]) ?? raw.length,
      steps: raw.map(mapStep),
      artifactPaths: readStringArray(payload, ["artifact_paths", "artifacts", "artifactPaths"]),
    };
  }

  async diagnose(args: DiagnoseArgs, signal?: AbortSignal): Promise<Diagnosis> {
    const params: Record<string, unknown> = {};
    if (args.deviceSerial !== undefined) params.device_serial = args.deviceSerial;
    const payload = await this.dictCall("mobile_diagnose", params, signal);
    const crashes = Array.isArray(payload.recent_crashes)
      ? (payload.recent_crashes as Record<string, unknown>[])
      : [];
    return {
      deviceSerial: readString(payload, ["device_serial", "serial"]) ?? args.deviceSerial,
      adbConnected: readBoolean(payload, ["adb_connected", "connected"]),
      helperInstalled: readBoolean(payload, ["helper_installed"]),
      helperVersion: readString(payload, ["helper_version", "helperVersion"]),
      recentCrashes: crashes.map((entry) => ({
        package: readString(entry, ["package", "package_name"]),
        timestamp: readString(entry, ["timestamp", "time"]),
        stackExcerpt: readString(entry, ["stack_excerpt", "stack", "stackExcerpt"]),
      })),
      logcatPath: readString(payload, ["logcat_path", "logcatPath"]),
      screenshotPath: readString(payload, ["screenshot_path", "screenshotPath"]),
      recommendations: readStringArray(payload, ["recommendations", "fixes", "fix_steps"]),
    };
  }

  async dispose(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    this.starting = undefined;
    await connection?.close().catch(() => undefined);
  }

  private async dictCall(
    name: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    let answer: unknown;
    try {
      answer = await this.call(name, params, signal);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("internal:")) throw error;
      throw new Error(`environment: ARTEMIS provider did not answer ${name} (${(error as Error)?.message ?? error})`);
    }
    return payloadObject(answer, name);
  }

  private async call(
    name: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const connection = await this.ensure();
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        void this.dispose();
        reject(new Error(`ARTEMIS provider did not answer ${name} within ${this.options.callTimeoutMs}ms`));
      }, this.options.callTimeoutMs);
      timer.unref?.();
    });
    return await Promise.race([
      connection.callTool({ name, arguments: params }, signal ? { signal } : undefined),
      timeout,
    ]);
  }

  private ensure(): Promise<McpConnection> {
    if (this.connection) return Promise.resolve(this.connection);
    this.starting ??= this.start();
    return this.starting;
  }

  private async start(): Promise<McpConnection> {
    try {
      const connection = await this.connect(this.options);
      this.connection = connection;
      return connection;
    } finally {
      this.starting = undefined;
    }
  }
}

export function mapStep(raw: Record<string, unknown>): TaskStep {
  const step: TaskStep = {};
  const index = readNumber(raw, ["index", "step_number", "step", "n"]);
  if (index !== undefined) step.index = index;
  const action = readString(raw, ["action"]);
  if (action !== undefined) step.action = action;
  const reasoning = readString(raw, ["reasoning", "reason"]);
  if (reasoning !== undefined) step.reasoning = reasoning;
  const screenshot = readString(raw, ["screenshot_path", "screenshot"]);
  if (screenshot !== undefined) step.screenshotPath = screenshot;
  const timestamp = readString(raw, ["timestamp", "time"]);
  if (timestamp !== undefined) step.timestamp = timestamp;
  const duration = readNumber(raw, ["duration_ms", "durationMs", "duration"]);
  if (duration !== undefined) step.durationMs = duration;
  const status = readString(raw, ["status", "state"]);
  if (status !== undefined) step.status = status;
  const ok = readBoolean(raw, ["ok", "success"]);
  if (ok !== undefined) step.ok = ok;
  return step;
}
