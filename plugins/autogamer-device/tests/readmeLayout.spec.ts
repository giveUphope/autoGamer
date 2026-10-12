/**
 * README's Layout block is a hand-maintained *copy* of the module tree, and a
 * copy has nothing to change it when the tree does: by the time G67 added
 * `src/observations.ts`, it had already lost `devicePool.ts` (#55),
 * `turnLedger.ts` and `dsh-types.ts`. These two directions of drift are locked
 * here so the list stops being prose that decays (changelogs **#61**;
 * the repo rule that a derived fact has exactly one authority).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);

function modules(dir: string): string[] {
  return readdirSync(fileURLToPath(new URL(dir, root))).filter((name) => name.endsWith(".ts"));
}

const readme = readFileSync(fileURLToPath(new URL("README.md", root)), "utf-8");

describe("README Layout lists the module tree (changelogs #61)", () => {
  it("lists every module under src/ and src/tools/", () => {
    const missing = [...modules("src"), ...modules("src/tools")].filter((name) => !readme.includes(name));
    expect(missing).toEqual([]);
  });

  it("names no module that has since been renamed or removed", () => {
    const onDisk = new Set([...modules("src"), ...modules("src/tools")]);
    const listed = [...readme.matchAll(/src\/(?:tools\/)?([A-Za-z0-9_-]+\.ts)/g)].map((m) => m[1]);
    expect([...new Set(listed)].filter((name) => !onDisk.has(name))).toEqual([]);
  });
});
