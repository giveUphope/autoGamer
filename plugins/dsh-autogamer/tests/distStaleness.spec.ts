/**
 * Build-hygiene guard (bundle verification finding): tsc never deletes outputs
 * whose source was removed, so without the clean step in the build script the
 * packed tarball carries deleted modules (actionClient / mcpText / scrcpy /
 * prompt/rulesInjector were actually shipped that way). The build script wipes
 * dist first; this test makes any stale emission fail the suite.
 *
 * vitest can run straight from src with no dist at all, so the guard skips
 * when dist is absent instead of demanding a build first.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(pkgRoot, "dist");
const srcDir = join(pkgRoot, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe.skipIf(!existsSync(distDir))("dist hygiene: emitted files mirror src", () => {
  it("every emitted .js/.d.ts has a matching src .ts", () => {
    const stale: string[] = [];
    for (const emitted of walk(distDir)) {
      const rel = relative(distDir, emitted).replace(/\\/g, "/");
      if (!/\.(js|d\.ts)$/.test(rel)) continue;
      const sourceRel = rel.replace(/\.d\.ts$/, ".ts").replace(/\.js$/, ".ts");
      if (!existsSync(join(srcDir, sourceRel))) stale.push(rel);
    }
    expect(stale).toEqual([]);
  });
});
