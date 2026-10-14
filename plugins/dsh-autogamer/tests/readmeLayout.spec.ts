/**
 * README's Layout block is a hand-maintained *copy* of the module tree, and a
 * copy has nothing to change it when the tree does: by the time G67 added
 * `src/observations.ts`, it had already lost `devicePool.ts` (#55),
 * `turnLedger.ts` and `observations.ts` itself. These two directions of drift
 * are locked here so the list stops being prose that decays (changelogs **#61**;
 * scoped to the block and to the shared file walker by **#64**) — scanning the
 * whole README would let a stray prose mention stand in for the Layout row, and
 * a hand-rolled two-directory listing would quietly stop covering a module that
 * lands in a new subdirectory.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { typescriptFiles } from "./support/srcFiles.js";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** The Layout fenced block only - not the prose around it. */
function layoutBlock(): string {
  const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf-8");
  const start = readme.indexOf("```", readme.indexOf("## Layout"));
  const end = readme.indexOf("```", start + 3);
  if (start < 0 || end < 0) throw new Error("README has no Layout fenced block");
  return readme.slice(start, end);
}

const onDisk = new Set(
  [...typescriptFiles(SRC)].map((file) => file.split(/[\\/]/).pop() as string),
);
const layout = layoutBlock();

describe("README Layout lists the module tree (changelogs #61)", () => {
  it("lists every module under src/", () => {
    expect([...onDisk].filter((name) => !layout.includes(name))).toEqual([]);
  });

  it("names no module in the Layout that is not on disk", () => {
    const named = new Set([...layout.matchAll(/([A-Za-z0-9_-]+\.ts)/g)].map((m) => m[1]));
    expect([...named].filter((name) => name !== undefined && !onDisk.has(name))).toEqual([]);
  });
});
