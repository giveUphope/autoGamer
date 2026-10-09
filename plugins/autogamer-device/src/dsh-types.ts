/**
 * Minimal DSH-side contracts used by this plugin. DSH ships no type
 * declarations (dist JS only, verified); these stubs mirror the shapes we
 * verified against 0.2.0-rc.2 source (ctx.tools.register / defineTool /
 * exec.signal). Keep them in one place so a DSH upgrade re-checks them all.
 */

export interface DshLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface DshContext {
  logger: DshLogger;
  tools: {
    register(definition: unknown): () => void;
  };
  get?(key: string): unknown;
  effect?(dispose: () => void): void;
}

export interface ToolExec {
  signal: AbortSignal;
}

export interface ToolParameterSpec {
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  description?: string;
  enum?: string[];
  items?: ToolParameterSpec;
  properties?: Record<string, ToolParameterSpec>;
  default?: unknown;
}

export interface ToolDefinitionInput {
  name: string;
  description: string;
  parameters: Record<string, ToolParameterSpec>;
  timeoutMs?: number;
  execute(args: Record<string, unknown>, exec: ToolExec): Promise<unknown>;
}

/** Subset of defineTool we rely on; imported from @deepseek-ai/dsh-tools at runtime. */
export type DefineTool = (options: ToolDefinitionInput) => unknown;
