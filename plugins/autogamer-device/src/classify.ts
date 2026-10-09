/**
 * Tool-layer error classification (S4, R2' rewrite): the breaker counts
 * environment-level failures only. In the tool world the signal is the
 * ActionResult code / transport state, not DB row shapes (that was the
 * py-worker-era rule, now gone with the direct-plugin route).
 */

/** Mirror of the py ActionCode enum (artemis/mcp/action_types.py). */
export type ActionCode =
  | "OK"
  | "INVALID_ARGS"
  | "TARGET_NOT_FOUND"
  | "DEVICE_ERROR"
  | "PACKAGE_NOT_FOUND"
  | "TIMEOUT"
  | "UNSUPPORTED";

const TASK_LEVEL_CODES: ReadonlySet<ActionCode> = new Set([
  "INVALID_ARGS",
  "TARGET_NOT_FOUND",
  "PACKAGE_NOT_FOUND",
  "UNSUPPORTED",
]);

const ENVIRONMENT_MARKERS = [
  "device",
  "adb",
  "helper",
  "unavailable",
  "offline",
  "timeout",
  "timed out",
  "connection",
  "refused",
  "503",
  "502",
  "not authorized",
  "unauthorized",
] as const;

export interface ActionResultLike {
  ok: boolean;
  code?: ActionCode | string;
  message?: string;
}

export type FailureClass = "environment" | "task";

export function classifyActionFailure(result: ActionResultLike): FailureClass {
  const code = result.code as ActionCode | undefined;
  if (code && TASK_LEVEL_CODES.has(code)) return "task";
  if (code === "DEVICE_ERROR" || code === "TIMEOUT") return "environment";
  return classifyMessage(result.message ?? "");
}

export function classifyTransportError(error: unknown): FailureClass {
  // Action server dead / never started / transport torn down: environment by
  // definition — the device may be fine but we cannot reach the executor.
  return "environment";
}

export function classifyMessage(message: string): FailureClass {
  const lowered = message.toLowerCase();
  return ENVIRONMENT_MARKERS.some((marker) => lowered.includes(marker))
    ? "environment"
    : "task";
}
