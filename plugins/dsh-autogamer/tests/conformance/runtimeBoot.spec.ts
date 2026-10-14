/**
 * G5 Tier 1: the model-facing contract, asserted against the REAL DSH runtime
 * instead of a fixture that someone re-captured by hand.
 *
 * This boots the real service graph the plugin declares it depends on
 * (`@deepseek-ai/dsh-tools` and the services it requires) on a bare cordis
 * context and reads the registry the way the upstream tool-catalog generator
 * does — "BOOTS each tool plugin on a real context and reads ctx.tools.schemas()"
 * (docs/tool-catalog.md). No model, no network, no device.
 *
 * What this adds over the hand-written harness in apply.spec.ts: that harness
 * collects `ctx.tools.register` calls into an array, so it proves our own
 * registration call, not that the real registry accepted it. The 400-whole-
 * request-rejected bug (changelogs #10) lived exactly in that gap.
 */
import { describe, expect, it } from "vitest";

/** cordis's `plugin()` carries a signature this plugin never uses; the specs only
 * ever hand it one definition, so the seam is narrowed once, here. */
const mount = (root: { plugin: unknown }, mod: { default?: unknown }): unknown =>
  (root.plugin as (input: unknown) => unknown)(mod.default);
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import * as pluginModule from "../../src/index.js";
import { typescriptFiles } from "../support/srcFiles.js";

/**
 * The service packages the plugin's `inject` list resolves through, in mount
 * order. `dsh-system-prompt` is not injected directly any more (the rules
 * injector is gone) but stays: the agent loop we depend on resolves through it,
 * and dropping it from the graph makes the mount fail.
 */
const SERVICE_PACKAGES = [
  "@deepseek-ai/dsh-invariants",
  "@deepseek-ai/dsh-system-prompt",
  "@deepseek-ai/dsh-tools",
  "@deepseek-ai/dsh-agent",
  "@deepseek-ai/dsh-attachment",
] as const;

type WireSchema = {
  name: string;
  description?: string;
  parameters?: { type?: string; properties?: Record<string, unknown>; required?: string[] };
};

const plugin = {
  name: pluginModule.name,
  Config: pluginModule.Config,
  inject: pluginModule.inject,
  apply: pluginModule.apply,
};

async function bootServices(): Promise<Context> {
  const ctx = new Context();
  for (const specifier of SERVICE_PACKAGES) {
    const mod = (await import(specifier)) as { default: unknown };
    // Each package's default export is a cordis plugin (class or function).
    await (ctx.plugin as unknown as (definition: unknown) => unknown)(mod.default);
  }
  return ctx;
}

async function bootWithPlugin(): Promise<Context> {
  const ctx = await bootServices();
  await (ctx.plugin as unknown as (definition: unknown, config?: unknown) => unknown)(plugin);
  return ctx;
}

describe("conformance: real DSH runtime tool registry (G5 Tier 1)", () => {
  it("the plugin mounts on the real service graph it declares", async () => {
    const ctx = await bootWithPlugin();
    // Reaching this line at all is the assertion: cordis only loads a plugin
    // while every injected service is available, so `inject` stays an
    // live-verified claim rather than an aspiration (G30's root cause).
    expect(typeof ctx.tools.register).toBe("function");
    expect(typeof ctx.agents.currentInitiator).toBe("function");
  });

  it("registers exactly the seven tools the preset advertises", async () => {
    const ctx = await bootWithPlugin();
    expect(ctx.tools.schemas().map((schema: WireSchema) => schema.name).sort()).toEqual([
      "autogamer_diagnose",
      "autogamer_get_device_state",
      "autogamer_inspect_trace",
      "autogamer_manage_task",
      "autogamer_run_task",
      "report_task_status",
      "run_device_action",
    ]);
  });

  it("compiles every tool through defineTool into an object-rooted wire schema", async () => {
    const ctx = await bootWithPlugin();
    const schemas = ctx.tools.schemas() as WireSchema[];
    for (const schema of schemas) {
      // The historical failure: registering a bare parameter map produced
      // `parameters.type !== "object"` and the LLM API rejected the ENTIRE
      // request, not just this tool (changelogs #10).
      expect(schema.parameters?.type, `${schema.name} parameters must be an object root`).toBe("object");
      const properties = Object.keys(schema.parameters?.properties ?? {});
      expect(properties.length, `${schema.name} declares no parameters`).toBeGreaterThan(0);
      for (const required of schema.parameters?.required ?? []) {
        expect(properties, `${schema.name} requires "${required}" without declaring it`).toContain(required);
      }
    }
  });

  it("resolves a tool through the real registry, not a collected array", async () => {
    const ctx = await bootWithPlugin();
    const tool = ctx.tools.get("run_device_action");
    expect(tool?.name).toBe("run_device_action");
    expect(typeof tool?.execute).toBe("function");
  });

  it("declares every Host service its own code touches", () => {
    // The mount above proves the other direction (a declared-but-absent service
    // never loads). This one catches under-declaration, which is silent until
    // the first property access throws `cannot get property … without inject`.
    const builtins = new Set(["logger", "effect", "on", "emit", "once", "off", "extend", "plugin", "inject", "get", "provide", "root"]);
    const srcRoot = fileURLToPath(new URL("../../src", import.meta.url));
    const consumed = new Set<string>();
    for (const file of typescriptFiles(srcRoot)) {
      for (const match of readFileSync(file, "utf8").matchAll(/\bctx\.([a-zA-Z_]+)/g)) if (match[1]) consumed.add(match[1]);
    }
    expect([...consumed].sort(), "src should still reach for Host services").not.toHaveLength(0);
    const services = [...consumed].filter((name) => !builtins.has(name)).sort();
    expect(services, "src consumes services that are not declared in `inject`").toEqual([...pluginModule.inject].sort());
  });

  it("rejects a malformed config through the real Config validation path", async () => {
    const ctx = await bootServices();
    // Only proven by calling Config() ourselves today; here the loader is the
    // one that must refuse, because that is what a profile row actually does.
    await expect(
      (ctx.plugin as unknown as (definition: unknown, config?: unknown) => Promise<never>)(plugin, { actionServerCommand: "not-an-array" }),
    ).rejects.toThrow();
  });
});
