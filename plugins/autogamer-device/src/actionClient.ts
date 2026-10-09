/**
 * MCP stdio client wrapper around the upstream py action server
 * (`artemis mcp --server adb`). One lazily-started session per plugin
 * process; a dead transport is replaced on the next call (the py side
 * tolerates re-entry — verified: ActionSession rebuilds after transport
 * death). Deliberately NOT `dsh-mcp-client`: its registered tools would
 * bypass the device gate (upstream-rethink §三.1).
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export interface ActionClientOptions {
  /** Full argv of the py action server, e.g. ["python","-m","artemis.interfaces.cli.main","mcp","--server","adb"]. */
  command: string[];
  env?: Record<string, string>;
  callTimeoutMs: number;
}

export class ActionClient {
  private client?: Client;
  private starting?: Promise<Client>;

  constructor(private readonly options: ActionClientOptions) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    // This SDK's callTool takes no per-call options; a timed-out request
    // cannot be cancelled in place, so on timeout we tear the session down
    // and let the next call respawn it (a hung response would otherwise
    // poison the transport — the mcp-1.29 lesson, tool side).
    const client = await this.ensure();
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        void this.dispose();
        reject(new Error(`action server did not answer ${name} within ${this.options.callTimeoutMs}ms`));
      }, this.options.callTimeoutMs);
      timer.unref?.();
    });
    const result = await Promise.race([
      client.callTool({ name, arguments: args }),
      timeout,
    ]);
    return (result as { structuredContent?: unknown }).structuredContent ?? result;
  }

  /** Tools the server advertises; used by the P0 spike sanity check. */
  async listTools(): Promise<string[]> {
    const client = await this.ensure();
    const listed = await client.listTools();
    return (listed.tools ?? []).map((tool) => tool.name);
  }

  async dispose(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.starting = undefined;
    await client?.close().catch(() => undefined);
  }

  private ensure(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    this.starting ??= this.start();
    return this.starting;
  }

  private async start(): Promise<Client> {
    const transport = new StdioClientTransport({
      command: this.options.command[0] ?? "python",
      args: this.options.command.slice(1),
      env: this.options.env,
    });
    const client = new Client({ name: "autogamer-device", version: "0.1.0" });
    await client.connect(transport);
    this.client = client;
    this.starting = undefined;
    return client;
  }
}
