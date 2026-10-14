/**
 * Browser-half locks (Phase 3). client.js is hand-written plain JS in the
 * deployment's ModuleLoader format (tsc cannot emit it), so it cannot be
 * imported under node — these locks assert on its text instead, the same way
 * deliveryShape locks the two patch files against each other:
 * - the manifest half (dsh.client + ./client export + files entry);
 * - the proven call shape (ModuleLoader id, require('react'), slots
 *   inject/register, the five wire-tool keys on tool.call.toolview);
 * - NEGATIVE locks: the cut APIs (conversation.card, ctx.rpc, per-plugin
 *   settings slot, binary push, fetch/WebSocket polling) must never reappear.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLIENT = readFileSync(fileURLToPath(new URL("../client.js", import.meta.url)), "utf-8");
const MANIFEST = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf-8"),
) as {
  dsh?: { client?: { platform?: string; immediately?: boolean; inject?: string[] } };
  exports?: Record<string, string>;
  files?: string[];
};

describe("browser half: manifest declares the client artifact", () => {
  it("carries a dsh.client section in the proven shape", () => {
    expect(MANIFEST.dsh?.client?.platform).toBe("web");
    expect(MANIFEST.dsh?.client?.immediately).toBe(true);
    expect(MANIFEST.dsh?.client?.inject).toEqual(["slots"]);
  });

  it("exports ./client and ships client.js", () => {
    expect(MANIFEST.exports?.["./client"]).toBe("./client.js");
    expect(MANIFEST.files).toContain("client.js");
  });
});

describe("browser half: client.js keeps the proven ModuleLoader shape", () => {
  it("registers the loader id and takes React from the browser module table", () => {
    expect(CLIENT).toContain("window.__ModuleLoader__.load({");
    expect(CLIENT).toContain("id: 'dsh-autogamer'");
    expect(CLIENT).toContain("require('react')");
  });

  it("injects slots and registers all five task toolviews by wire key", () => {
    expect(CLIENT).toContain("inject: ['slots']");
    expect(CLIENT).toContain("ctx.slots.inject('tool.call.toolview'");
    for (const tool of [
      "autogamer_run_task",
      "autogamer_manage_task",
      "autogamer_inspect_trace",
      "autogamer_diagnose",
      "autogamer_get_device_state",
    ]) {
      expect(CLIENT, `toolview key for ${tool}`).toContain(`'${tool}'`);
    }
  });

  it("imports nothing but react: no second framework, no host client code", () => {
    expect(CLIENT).not.toMatch(/require\(['"`](?!react['"`])/);
    expect(CLIENT).not.toContain("from '@deepseek-ai/");
  });

  it("never references the cut APIs (Phase 0 verdicts)", () => {
    for (const banned of [
      "conversation.card",
      "ctx.rpc",
      "settings.plugin.item",
      "WebSocket",
      "VideoDecoder",
      "multipart/x-mixed-replace",
    ]) {
      expect(CLIENT, `cut API must stay out: ${banned}`).not.toContain(banned);
    }
    expect(CLIENT).not.toMatch(/\bfetch\s*\(/);
  });
});
