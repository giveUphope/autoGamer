/**
 * Minimal DSH-side contracts used by this plugin.
 *
 * Two kinds of entry, and the difference is deliberate:
 *  - anything a published `@deepseek-ai/*` package declares is **imported**, not
 *    restated — a hand copy is a claim that silently rots on upgrade (rule R21;
 *    the attachment mirror below lost exactly its branded `attachmentId` that way).
 *  - shapes only observable through the Host (which ships nothing outside the
 *    bundle) stay hand-mirrored here with the version and source they were
 *    verified against, so one DSH upgrade re-checks them all in this file.
 */
import type { ImageAttachmentRef, SaveImageAttachment } from "@deepseek-ai/dsh-attachment";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { MessageId, MessageSourceMap, UserMessage } from "@deepseek-ai/dsh-llm";
import type { ToolGuard } from "@deepseek-ai/dsh-tools";

/**
 * Our message source, declared the way the host says to declare one:
 * "`MessageSourceMap` … Merge-extensible sum type — each producer declares its
 * own `kind` in its own module; there is no shared catch-all `plugin` kind"
 * (`@deepseek-ai/dsh-llm` lib/types/message.d.ts:101-106). The retired
 * `{kind:'plugin', plugin:<name>}` wrapper is rejected by session format V4 (R17).
 */
declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    autogamer: {
      readonly kind: "autogamer";
      readonly reason: string;
    };
  }
}

export interface DshLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Durable, content-addressed image reference (`@deepseek-ai/dsh-attachment`,
 * lib/types/types.d.ts:7). The host owns the bytes: a producer hands them to
 * `ctx.attachments.saveImages()` and only the returned reference ever enters the
 * session log — image bytes never do ("会话事件和模型可见的附件块包含该引用及其
 * 元数据，绝不包含 … base64 数据"). `attachmentId` is a branded opaque id, so
 * nothing here may parse or pattern-match it.
 */
export type DshImageAttachment = ImageAttachmentRef;

/** The `AttachmentStore` seam, narrowed to what this plugin calls. */
export interface DshAttachments {
  saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]>;
}

/**
 * Agent/session surface for the G44 turn-end enforcement, narrowed to the two
 * members this plugin calls. `id` is the session-backed agent identity
 * (`@deepseek-ai/dsh-agent` lib/types/types.d.ts:11-13), which is why the ledger
 * and the `turn/end` listener key on the same value.
 */
export type DshAgent = Pick<Agent, "id" | "followup">;

export interface DshAgentsService {
  get(id: SessionId): DshAgent | undefined;
  /**
   * Declared at docs/subsystems/core.zh.md:612; live-verified to return the
   * session id during a model-driven tool call (CHANGELOGS #15), so the ledger
   * and the `turn/end` listener key on the same value.
   */
  currentInitiator?(): DshAgent | undefined;
}

export interface DshSessionRef {
  id: SessionId;
}

export interface DshSessionEvent {
  type: string;
}

/**
 * A real `UserMessage`. It requires a branded `id` ("Stable identity preserved
 * across every representation boundary", dsh-llm message.d.ts:110-120); the
 * official mint is `createUserMessage`, but that is a RUNTIME import and
 * `@deepseek-ai/dsh-llm` is only a devDependency here, so the id is branded
 * locally with the exported `MessageId` cast instead — same identity, no new
 * packaged dependency at load time (unit-proven; the live nudge landing in the
 * session log is CHANGELOGS #15).
 */
export type DshUserMessage = UserMessage;

/** Brand a message id without importing the host package at runtime. */
export const messageId = (id: string): MessageId => id as MessageId;

export interface DshEventOptions {
  global?: boolean;
}

export interface DshContext {
  logger: DshLogger;
  tools: {
    register(definition: unknown): () => void;
    /**
     * Monotonic execution guard (S4 熔断拒绝出口，R13)：plain-context 注册即全局生效，
     * 返回 reason 拒绝、返回 undefined 放行，且后续监听器无法翻转（`@deepseek-ai/dsh-tools`
     * lib/types/index.d.ts:514-522, 646-655）。
     */
    guard(guard: ToolGuard): () => void;
  };
  /**
   * Host attachment service. Declared in `inject`, because cordis throws on the
   * property GET of an undeclared service rather than returning undefined.
   */
  attachments: DshAttachments;
  agents: DshAgentsService;
  /**
   * Cordis typed events. `session/event` is scope-filtered, so the G44 listener
   * passes `{ global: true }` (packages/core/scope/README.zh.md:75 - "带
   * `{ global: true }` 的监听器绕过筛选").
   */
  on(
    event: "session/event",
    handler: (session: DshSessionRef, payload: DshSessionEvent) => void,
    options?: DshEventOptions,
  ): () => void;
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
  /**
   * Declares this call's successful result terminal for the current agent turn:
   * "The agent loop stops after committing this successful result batch"
   * (`ToolExecutionSuccess.concludesTurn`, @deepseek-ai/dsh-tools types).
   * `execute` receives a full `ToolRunContext`, so a reporting tool can end the
   * turn instead of letting the model keep calling tools after it already
   * reported the outcome (G41).
   */
  concludeTurn?(): void;
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
