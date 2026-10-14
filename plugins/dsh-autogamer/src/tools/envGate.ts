/**
 * Shared preflight gate for the autogamer_* tools (Phase 2). One vocabulary:
 * a failed environment throws `environment:` with the fix, so every tool
 * refuses the same way instead of each inventing its own refusal line.
 */
import { preflightErrorText, type PreflightResult } from "../env/preflight.js";

export async function requireEnv(checkEnv: () => Promise<PreflightResult>): Promise<void> {
  const env = await checkEnv();
  if (!env.ok) throw new Error(preflightErrorText(env));
}
