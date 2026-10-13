/**
 * Rules-injector unit locks (Phase 5). Filesystem is injected, so no test
 * here touches disk: flag handling, path correction, warning paths, and the
 * section() call shape live here. Expected paths always go through
 * rulesFilePath() itself, so the suite is separator-agnostic (Windows joins
 * with backslashes). The live half (the section text reaching model context)
 * needs a real session and stays deferred.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RULES_SECTION_NAME,
  RULES_SECTION_ORDER,
  rulesFilePath,
  setupRulesInjection,
} from "../src/prompt/rulesInjector.js";

function harness(options?: {
  files?: Record<string, string>;
  readError?: string;
}): {
  sections: { name: string; order: number; text: string }[];
  warnings: string[];
  systemPrompt: { section(input: { name: string; order: number; text: string }): unknown };
  deps: { exists(path: string): boolean; read(path: string): string };
} {
  const sections: { name: string; order: number; text: string }[] = [];
  const warnings: string[] = [];
  return {
    sections,
    warnings,
    systemPrompt: {
      section: (input: { name: string; order: number; text: string }) => {
        sections.push(input);
        return undefined;
      },
    },
    deps: {
      exists: (path: string) => options?.files !== undefined && path in options.files,
      read: (path: string) => {
        if (options?.readError) throw new Error(options.readError);
        return options?.files?.[path] ?? "";
      },
    },
  };
}

describe("rules injector: the guarded path to section()", () => {
  it("does nothing when the flag is off, without touching the filesystem", () => {
    const probe = harness({ files: { [rulesFilePath("/repo")]: "rules" } });
    let touched = false;
    const result = setupRulesInjection(
      probe.systemPrompt,
      { artemisRepoPath: "/repo", injectRules: false },
      (message) => probe.warnings.push(message),
      {
        exists: (path) => {
          touched = true;
          return probe.deps.exists(path);
        },
        read: probe.deps.read,
      },
    );
    expect(result).toBe("disabled");
    expect(touched).toBe(false);
    expect(probe.sections).toHaveLength(0);
  });

  it("warns and skips on an empty repo path", () => {
    const probe = harness();
    const result = setupRulesInjection(
      probe.systemPrompt,
      { artemisRepoPath: "  ", injectRules: true },
      (message) => probe.warnings.push(message),
      probe.deps,
    );
    expect(result).toBe("no-repo");
    expect(probe.warnings.join()).toContain("artemisRepoPath is empty");
  });

  it("reads mcp_server/rules.md, not the repo root", () => {
    expect(rulesFilePath("/repo")).toContain("mcp_server");
    const probe = harness({ files: { [join("/other", "rules.md")]: "root rules" } });
    const result = setupRulesInjection(
      probe.systemPrompt,
      { artemisRepoPath: "/other", injectRules: true },
      (message) => probe.warnings.push(message),
      probe.deps,
    );
    expect(result).toBe("missing-file");
    expect(probe.sections).toHaveLength(0);
  });

  it("warns and skips on read errors and empty content", () => {
    const unreadable = harness({
      files: { [rulesFilePath("/r")]: "x" },
      readError: "EACCES",
    });
    expect(
      setupRulesInjection(
        unreadable.systemPrompt,
        { artemisRepoPath: "/r", injectRules: true },
        (message) => unreadable.warnings.push(message),
        unreadable.deps,
      ),
    ).toBe("read-failed");
    const empty = harness({ files: { [rulesFilePath("/r")]: "  \n " } });
    expect(
      setupRulesInjection(
        empty.systemPrompt,
        { artemisRepoPath: "/r", injectRules: true },
        (message) => empty.warnings.push(message),
        empty.deps,
      ),
    ).toBe("empty");
    expect(empty.sections).toHaveLength(0);
  });

  it("contributes the file through section() with the scheme's order", () => {
    const probe = harness({ files: { [rulesFilePath("/repo")]: "# testing mindset\n" } });
    const result = setupRulesInjection(
      probe.systemPrompt,
      { artemisRepoPath: "/repo", injectRules: true },
      (message) => probe.warnings.push(message),
      probe.deps,
    );
    expect(result).toBe("injected");
    expect(probe.sections).toEqual([
      { name: RULES_SECTION_NAME, order: RULES_SECTION_ORDER, text: "# testing mindset\n" },
    ]);
    expect(probe.warnings).toHaveLength(0);
  });
});
