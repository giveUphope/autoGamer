/**
 * Adapter and env-gate unit locks (Phase 2). The adapter is a factory (one
 * backend kind survives the CLI cut); the gate is the single refusal
 * vocabulary shared by every autogamer_* tool.
 */
import { describe, expect, it } from "vitest";
import { createArtemisBackend } from "../src/artemis/adapter.js";
import { McpArtemisBackend } from "../src/artemis/mcpBackend.js";
import { requireEnv } from "../src/tools/envGate.js";
import type { PreflightResult } from "../src/env/preflight.js";

describe("adapter: factory", () => {
  it("builds the MCP backend without connecting", async () => {
    const backend = createArtemisBackend({ command: ["python", "-m", "mcp_server"], callTimeoutMs: 1000 });
    expect(backend).toBeInstanceOf(McpArtemisBackend);
    await backend.dispose();
  });

  it("does not refuse an unconfigured provider at construction: tools gate first", async () => {
    const backend = createArtemisBackend({ command: ["python"], callTimeoutMs: 1000 });
    expect(backend).toBeInstanceOf(McpArtemisBackend);
    await backend.dispose();
  });
});

describe("envGate: one refusal vocabulary", () => {
  it("passes a healthy environment silently", async () => {
    const healthy: PreflightResult = { ok: true, checks: [], finishedAt: "t" };
    await expect(requireEnv(async () => healthy)).resolves.toBeUndefined();
  });

  it("throws environment: with the first fix on failure", async () => {
    const broken: PreflightResult = {
      ok: false,
      checks: [{ id: "adb", ok: false, detail: "missing", fix: "install platform-tools" }],
      finishedAt: "t",
    };
    await expect(requireEnv(async () => broken)).rejects.toThrow(
      /^environment: preflight failed at adb.*install platform-tools/,
    );
  });
});
