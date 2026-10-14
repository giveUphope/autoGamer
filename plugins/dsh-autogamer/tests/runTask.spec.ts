/**
 * `autogamer_run_task` unit locks (T1 / G82).
 *
 * The tool no longer starts anything: the agent loop executes, and this tool
 * mints the record's id. What these locks protect is that the id is minted
 * locally and uniquely, that the accepted-for-stability parameters still behave,
 * and — the part the read model depends on — that the id reaches the log
 * through `presentationMeta` rather than through the rendered text.
 */
import { describe, expect, it } from "vitest";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { PreflightResult } from "../src/env/preflight.js";
import { defineRunTask } from "../src/tools/runTask.js";

const HEALTHY: PreflightResult = { ok: true, checks: [], finishedAt: "t" };
const BROKEN: PreflightResult = {
  ok: false,
  checks: [{ id: "uv", ok: false, detail: "missing", fix: "install uv" }],
  finishedAt: "t",
};

function defineWith(overrides?: {
  env?: PreflightResult;
  defaultProfile?: "flash" | "pro";
  defaultDeviceSerial?: string;
}): { tool: ReturnType<typeof defineRunTask>; minted: string[] } {
  const minted: string[] = [];
  const tool = defineRunTask({
    checkEnv: async () => overrides?.env ?? HEALTHY,
    defaultProfile: overrides?.defaultProfile ?? "flash",
    defaultDeviceSerial: overrides?.defaultDeviceSerial ?? "",
    newTaskId: () => {
      const id = `autogamer-task-${minted.length + 1}`;
      minted.push(id);
      return id;
    },
    now: () => new Date("2026-10-14T00:00:00.000Z"),
  });
  return { tool, minted };
}

function exec(): ToolRunContext {
  // The host type carries more than a signal (agent, session, ...); a tool body
  // under test must not depend on any of it, so the double is the minimum.
  return { signal: new AbortController().signal } as unknown as ToolRunContext;
}

describe("run_task: definition", () => {
  it("registers under the autogamer_ prefix with the instruction contract", () => {
    const { tool } = defineWith();
    expect(tool.name).toBe("autogamer_run_task");
    const parameters = tool.parameters as Record<string, { type?: string; required?: boolean }>;
    expect(parameters.instruction?.required).toBe(true);
    // The description must not send the model to an engine that no longer exists.
    expect(String(tool.description)).not.toMatch(/ARTEMIS|backend/i);
  });
});

describe("run_task: execute", () => {
  it("refuses an empty or over-long instruction before anything else", async () => {
    const { tool, minted } = defineWith();
    await expect(tool.execute({ instruction: "  " }, exec())).rejects.toThrow(/non-empty/);
    await expect(tool.execute({ instruction: "x".repeat(2000) }, exec())).rejects.toThrow(/2000/);
    expect(minted).toHaveLength(0);
  });

  it("refuses on a failed preflight with the fix attached", async () => {
    const { tool, minted } = defineWith({ env: BROKEN });
    await expect(tool.execute({ instruction: "open settings" }, exec())).rejects.toThrow(
      /preflight failed at uv.*install uv/,
    );
    expect(minted).toHaveLength(0);
  });

  it("mints a fresh id per call and returns immediately with the record", async () => {
    const { tool, minted } = defineWith({ defaultDeviceSerial: "em-d" });
    const first = (await tool.execute({ instruction: "open settings", profile: "pro" }, exec())) as Record<
      string,
      unknown
    >;
    const second = (await tool.execute({ instruction: "open settings" }, exec())) as Record<string, unknown>;
    expect(minted).toEqual(["autogamer-task-1", "autogamer-task-2"]);
    expect(first).toMatchObject({ task_id: "autogamer-task-1", status: "running", profile: "pro" });
    expect(first.started_at).toBe("2026-10-14T00:00:00.000Z");
    expect(second.task_id).toBe("autogamer-task-2");
  });

  it("falls back to the configured default profile and reports an empty serial", async () => {
    const { tool } = defineWith({ defaultProfile: "pro", defaultDeviceSerial: "" });
    const value = (await tool.execute({ instruction: "x" }, exec())) as Record<string, unknown>;
    expect(value).toMatchObject({ profile: "pro", device_serial: "" });
  });
});

describe("run_task: the card the fold reads", () => {
  it("presentationMeta carries the task id, not the rendered text", () => {
    const { tool } = defineWith();
    const meta = tool.output?.presentationMeta?.({}, { task_id: "autogamer-task-7", status: "running" });
    expect(meta).toEqual({ taskId: "autogamer-task-7", status: "running" });
  });

  it("presentationMeta stays empty on a shape it cannot read", () => {
    const { tool } = defineWith();
    expect(tool.output?.presentationMeta?.({}, null)).toEqual({});
    expect(tool.output?.presentationMeta?.({}, { task_id: 7 })).toEqual({});
  });
});