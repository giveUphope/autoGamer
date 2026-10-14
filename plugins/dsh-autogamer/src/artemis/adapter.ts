/**
 * Backend selection for the external ARTEMIS provider (Phase 2).
 *
 * The scheme draws an adapter choosing between MCP and CLI backends at
 * runtime. Phase 0 cut the CLI backend (the old `run` has no JSON contract),
 * so exactly one backend kind remains and this adapter is deliberately a
 * factory: it centralises construction, documents the selection rule a second
 * backend would plug into, and refuses early with an actionable error when no
 * provider is configured — instead of letting the first tool die on spawn.
 */
import { McpArtemisBackend } from "./mcpBackend.js";
import type { ArtemisBackend } from "./types.js";

export interface AdapterOptions {
  command: string[];
  cwd?: string;
  callTimeoutMs: number;
}

export function createArtemisBackend(options: AdapterOptions): ArtemisBackend {
  // No refusal here on an unconfigured provider: every tool runs the
  // preflight gate first, and the repo check refuses faster with the same
  // fix. Throwing in the factory would break apply() itself on a fresh
  // install, turning "not configured yet" into a mount failure instead of a
  // per-tool refusal.
  return new McpArtemisBackend({
    command: options.command,
    cwd: options.cwd,
    callTimeoutMs: options.callTimeoutMs,
  });
}
