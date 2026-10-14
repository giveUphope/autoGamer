/**
 * The shipped bundle patch must carry the full preset delivery shape: the
 * preset replaces its whole config (rule R5), so a missing row silently means
 * the agent lacks that face - that was G37, and G45 (the persona row) is the
 * same failure one level up. The archive branch also compared this file against
 * a live spike overlay; that overlay is not carried here (spike is rebuilt per
 * environment in T2), so the live-comparison cases are removed with it and
 * these assert the shipped patch itself.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FILES = {
  shipped: new URL("../cordis.patch.yml", import.meta.url),
};

/** Everything after the preset's `plugins:` key. */
function presetPlugins(url: URL): string {
  const text = readFileSync(fileURLToPath(url), "utf-8");
  const at = text.indexOf("\n        plugins:");
  const from = at >= 0 ? at : text.indexOf("\n    plugins:");
  if (from < 0) throw new Error(`${url.pathname} has no preset plugins block`);
  return text.slice(from);
}

/** Plugin names contributed by the preset (item-level `name:` keys). */
function contributedNames(url: URL): string[] {
  return [...presetPlugins(url).matchAll(/^\s*(?:- )?name: "?([^"\n]+?)"?\s*$/gm)].map((m) => (m[1] ?? "").trim());
}

/** The persona `prefix:` block scalar, dedented. */
function personaPrefix(url: URL): string {
  const lines = presetPlugins(url).split("\n");
  const start = lines.findIndex((l) => /^\s*prefix: \|\s*$/.test(l));
  if (start < 0) throw new Error(`${url.pathname} has no persona prefix`);
  const indent = (lines[start]?.match(/^\s*/)?.[0].length ?? 0);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith(" ".repeat(indent + 2))) break;
    body.push(line.slice(indent + 2));
  }
  return body.join("\n").trim();
}

describe("delivery shape: shipped patch carries the preset", () => {
  it("contributes the preset plugin rows, including the persona row (G45)", () => {
    const shipped = contributedNames(FILES.shipped);
    expect(shipped).toContain("@deepseek-ai/dsh-persona");
    expect(shipped).toContain("dsh-autogamer");
    expect(shipped).toContain("@deepseek-ai/dsh-tool-jobs");
    expect(shipped).toContain("@deepseek-ai/dsh-tool-cordis");
  });

  it("carries a non-empty persona prefix", () => {
    expect(personaPrefix(FILES.shipped).length).toBeGreaterThan(100);
  });

  it("keeps the instructions free of prompt variables", () => {
    // Unresolved `{{...}}` groups make assembly throw before any model request,
    // and the loop registers only provider/model (never cwd).
    expect(personaPrefix(FILES.shipped)).not.toMatch(/\{\{|\}\}/);
  });

  it("carries the checker audit discipline (P1-b)", () => {
    // Byte-identical across both files by the test above: assert once here.
    const prefix = personaPrefix(FILES.shipped);
    expect(prefix).toContain("Audit like a checker");
    expect(prefix).toContain("tests_failed");
    expect(prefix).toContain("incident");
  });

  it("ships the strictness ladder and plan scaffold in the flash skill (P1-c)", () => {
    const skill = readFileSync(
      fileURLToPath(new URL("../skills/autogamer-flash/SKILL.md", import.meta.url)),
      "utf-8",
    );
    for (const level of ["`off`", "`final`", "`checkpoints`", "`strict`"]) {
      expect(skill).toContain(level);
    }
    expect(skill).toContain("incident");
    expect(skill).toContain("verify");
  });
});
