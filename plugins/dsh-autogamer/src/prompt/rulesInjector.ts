/**
 * ARTEMIS rules injection (Phase 5).
 *
 * Reads the provider's `mcp_server/rules.md` fresh on every mount (never
 * cached — the file follows ARTEMIS updates) and contributes it as a
 * `systemPrompt.section()`. That is the official prompt-extension API
 * (dsh-system-prompt 0.2.0-rc.2 exposes section(), not contribute();
 * practices.md: "Add prompt text with ctx.systemPrompt.section()"), NOT a
 * self-written session write — so R16 does not apply. The section order
 * follows the scheme's priority number.
 *
 * Failure policy: injection is an enhancement, never a gate. An empty repo
 * path, a missing file, an unreadable file, or empty content all skip with a
 * warning and return false; this function never throws.
 *
 * Path correction (Phase 0): the file lives at `<repo>/mcp_server/rules.md`
 * on the fork's evidence, not at the repo root as the scheme first wrote.
 */
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const RULES_SECTION_NAME = "dsh-autogamer-rules";
export const RULES_SECTION_ORDER = 50;

export interface RulesInjectorConfig {
  artemisRepoPath: string;
  injectRules: boolean;
}

export interface RulesInjectorDeps {
  exists(path: string): boolean;
  read(path: string): string;
}

export interface SystemPromptFace {
  section(input: { name: string; order: number; text: string }): unknown;
}

const defaultDeps: RulesInjectorDeps = {
  exists: (path) => existsSync(path),
  read: (path) => readFileSync(path, "utf8"),
};

export function rulesFilePath(artemisRepoPath: string): string {
  return join(artemisRepoPath, "mcp_server", "rules.md");
}

/**
 * G80: the caller must be able to tell *why* nothing was injected. Returning a bare
 * `false` let a missing provider repo look identical to "rules are off by choice",
 * so the condition vanished silently in every real environment.
 */
export type RulesInjectionOutcome = "injected" | "disabled" | "no-repo" | "missing-file" | "read-failed" | "empty";

export function setupRulesInjection(
  systemPrompt: SystemPromptFace,
  config: RulesInjectorConfig,
  logger: (message: string) => void,
  deps: RulesInjectorDeps = defaultDeps,
): RulesInjectionOutcome {
  if (!config.injectRules) return "disabled";
  if (config.artemisRepoPath.trim().length === 0) {
    logger("[rules] injectRules is on but artemisRepoPath is empty; skipping rules injection");
    return "no-repo";
  }
  const path = rulesFilePath(config.artemisRepoPath);
  if (!deps.exists(path)) {
    logger(`[rules] no rules.md at ${path}; skipping rules injection`);
    return "missing-file";
  }
  let content: string;
  try {
    content = deps.read(path);
  } catch (error) {
    logger(`[rules] cannot read ${path} (${(error as Error)?.message ?? error}); skipping rules injection`);
    return "read-failed";
  }
  if (content.trim().length === 0) {
    logger(`[rules] ${path} is empty; skipping rules injection`);
    return "empty";
  }
  systemPrompt.section({ name: RULES_SECTION_NAME, order: RULES_SECTION_ORDER, text: content });
  return "injected";
}
