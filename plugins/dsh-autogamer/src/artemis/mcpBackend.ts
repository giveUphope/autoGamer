/**
 * MCP stdio backend for the external ARTEMIS provider (Phase 1).
 *
 * Spawns the provider's MCP server (`python -m mcp_server` under the
 * configured repo path by default — Phase 0 read the command off our own
 * history; provider installs vary, so the full argv stays configurable) and
 * talks to it with @modelcontextprotocol/client, the same SDK shape as the
 * in-repo action client. The session is lazy: constructing the backend never
 * spawns anything, so apply() stays spawn-free; the first tool call connects.
 * A dead transport is dropped and rebuilt on the next call.
 *
 * Error contract (matches the plugin's classifier vocabulary):
 * - transport/connect/timeout failures → `environment:` (the provider or the
 *   machine is at fault, safe to report and retry later);
 * - a payload that is not the documented JSON → `internal:` (our mapping or
 *   provider drift — not the device, do not retry the same call).
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { ArtemisBackend, DeviceState, DeviceStateArgs } from "./types.js";

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

/**
 * The provider answers MCP tools with a string payload (verified on the old
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
  const text = Array.isArray(record.content)
    ? record.content.find((block) => typeof block?.text === "string")?.text
    : undefined;
  if (typeof text !== "string") {
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

export class McpArtemisBackend implements ArtemisBackend {
  private connection?: McpConnection;
  private starting?: Promise<McpConnection>;

  constructor(
    private readonly options: McpBackendOptions,
    private readonly connect: (options: McpBackendOptions) => Promise<McpConnection> = openConnection,
  ) {}

  async getDeviceState(args: DeviceStateArgs, signal?: AbortSignal): Promise<DeviceState> {
    const params: Record<string, unknown> = {};
    if (args.deviceSerial !== undefined) params.device_serial = args.deviceSerial;
    if (args.includeScreenshot === true) params.include_screenshot = true;
    let answer: unknown;
    try {
      answer = await this.call("mobile_get_device_state", params, signal);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("internal:")) throw error;
      throw new Error(
        `environment: ARTEMIS provider did not answer mobile_get_device_state (${(error as Error)?.message ?? error})`,
      );
    }
    const payload = payloadObject(answer, "mobile_get_device_state");
    return {
      deviceSerial: readString(payload, ["device_serial", "serial"]) ?? args.deviceSerial ?? "",
      connected: readBoolean(payload, ["connected", "adb_connected"]) ?? false,
      currentPackage: readString(payload, ["current_package", "package"]),
      currentActivity: readString(payload, ["current_activity", "activity"]),
      screenSummary: readString(payload, ["screen_summary", "summary"]),
      screenshotPath: readString(payload, ["screenshot_path", "screenshot"]),
      helperInstalled: readBoolean(payload, [
        "accessibility_helper_installed",
        "helper_installed",
      ]),
    };
  }

  async dispose(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    this.starting = undefined;
    await connection?.close().catch(() => undefined);
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
