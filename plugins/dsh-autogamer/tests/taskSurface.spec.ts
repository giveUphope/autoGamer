/**
 * G82 acceptance: the task tools reach no external process (T1).
 *
 * The engine this lock exists to keep out used to be reachable from three tool
 * bodies, and a spec that only asserted return values would not notice it coming
 * back. This is a source-level lock rather than a behavioural one because the
 * property is structural: no dep, no import, no spawn. It is deliberately
 * scoped to the three TASK tools - `getDevice_state` and `diagnose` still talk
 * to the optional external provider, which the D19 terminal state keeps until
 * T4 (§一.3), so a repo-wide ban would be a false claim rather than a lock.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TOOLS_DIR = fileURLToPath(new URL("../src/tools", import.meta.url));
const TASK_TOOLS = ["runTask.ts", "manageTask.ts", "inspectTrace.ts"] as const;

function sourceOf(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/tools/${file}`, import.meta.url)), "utf-8");
}

/** Strip comments so prose about a removed engine cannot satisfy or trip a lock. */
function codeOf(file: string): string {
  return sourceOf(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("G82: no task tool can reach an external engine", () => {
  it.each(TASK_TOOLS)("%s has no backend dependency", (file) => {
    expect(codeOf(file)).not.toMatch(/backend/i);
  });

  it.each(TASK_TOOLS)("%s imports nothing from the ARTEMIS provider", (file) => {
    expect(codeOf(file)).not.toMatch(/artemis/i);
  });

  it.each(TASK_TOOLS)("%s spawns no process", (file) => {
    expect(codeOf(file)).not.toMatch(/child_process|\bspawn\b|\bexecFile\b|\bexecSync\b/);
  });

  it("the other tools keep the optional provider - the ban is scoped, not global", () => {
    // If this ever fails, the scope of this lock was widened by accident: the
    // external provider is removed in T4, not by editing this spec.
    expect(codeOf("getDeviceState.ts")).toMatch(/backend/);
    expect(codeOf("diagnose.ts")).toMatch(/backend/);
  });

  it("reads through the task read model instead", () => {
    expect(codeOf("manageTask.ts")).toMatch(/store/);
    expect(codeOf("inspectTrace.ts")).toMatch(/store/);
  });
});