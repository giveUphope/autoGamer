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

/**
 * Durable, content-addressed image reference. The host owns the bytes: a
 * producer hands them to `ctx.attachments.saveImages()` and only the returned
 * reference ever enters the session log — image bytes never do
 * (docs/subsystems/attachment: "会话事件和模型可见的附件块包含该引用及其元数据，
 * 绝不包含 … base64 数据"). `attachmentId` is opaque and provider-owned, so
 * nothing here may parse or pattern-match it.
 */
export interface DshImageAttachment {
  attachmentId: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  bytes: number;
  width: number;
  height: number;
  name?: string;
}

/** The `AttachmentStore` seam, narrowed to what this plugin calls. */
export interface DshAttachments {
  saveImages(
    inputs: readonly {
      data: Uint8Array;
      /** Declared here, but validated by the host against the decoded bytes. */
      mediaType: DshImageAttachment["mediaType"];
      name?: string;
    }[],
  ): Promise<readonly DshImageAttachment[]>;
}

export interface DshContext {
  logger: DshLogger;
  tools: {
    register(definition: unknown): () => void;
  };
  /**
   * Host attachment service. Declared in `inject`, because cordis throws on the
   * property GET of an undeclared service rather than returning undefined.
   */
  attachments: DshAttachments;
  get?(key: string): unknown;
  /**
   * Cordis effect: the callback runs IMMEDIATELY (it is the setup body) and
   * its returned function becomes the teardown. Verified against upstream
   * sources (mount.ts:208 `ctx.effect(() => () => { tree.root.stop() })`,
   * agent-preset-registry/src/index.ts:112, app-boot service.ts:110) — see
   * changelogs #10: an early version passed the teardown AS the callback and
   * disposed its own tool registrations during apply().
   */
  effect?(setup: () => unknown): void;
}

export interface ToolExec {
  signal: AbortSignal;
}

/*
 * Tool definition types come straight from the installed @deepseek-ai/dsh-tools
 * package artifacts (R1 declared-surface usage; type-only imports are erased at
 * runtime). The `any` parameters are deliberate: the official dialect
 * (per-property `required: true`, mandatory `additionalProperties` on object
 * nodes, ContentBlock[] renders) is enforced at REGISTRATION time by
 * defineTool's own schema compiler, which throws on unsupported shapes —
 * hand-mirroring the recursive spec types here only recreated them wrongly
 * (InferValue over the broad union collapses to `never`).
 */
import type { DefineToolOptions } from "@deepseek-ai/dsh-tools";

/** Author-facing tool options as accepted by the official defineTool(). */
export type ToolDefinitionInput = DefineToolOptions<any, any>;
