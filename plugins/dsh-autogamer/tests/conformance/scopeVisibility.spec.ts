/**
 * G57 lock: tools registered from a scope-mounted plugin are scope-local.
 *
 * Mechanism (no product code changed): dsh-tools `register()` files the entry
 * through `ScopedLayers.effect(this.ctx, …)`, tagged to the calling scope; but
 * `schemas()`/`get()` with no scope argument are the GLOBAL view, so a bare
 * `scope.ctx` read shows nothing and the global view correctly hides scoped
 * registrations (D16 isolation). The G52 probe's "empty in scope and root" was
 * this reader artifact, not a mount failure. Pass `scopeOf(ctx)` and both
 * tools resolve.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { createScope, scopeOf } from "@deepseek-ai/dsh-scope";
import * as pluginModule from "../../src/index.js";

const SERVICE_PACKAGES = [
  "@deepseek-ai/dsh-invariants",
  "@deepseek-ai/dsh-system-prompt",
  "@deepseek-ai/dsh-tools",
  "@deepseek-ai/dsh-agent",
  "@deepseek-ai/dsh-attachment",
  "@deepseek-ai/dsh-session",
] as const;

const STUB_ACTION_SERVER = [process.execPath, "-e", "process.exit(0)"];

let cleanups: Array<() => unknown> = [];

afterEach(async () => {
  for (const dispose of cleanups.splice(0)) await dispose();
});

describe("conformance: scope-mounted tools resolve through the scope key (G57)", () => {
  it("sees both tools with scopeOf(ctx) and hides them from the global view", async () => {
    const root = new Context();
    for (const specifier of SERVICE_PACKAGES) {
      const mod = (await import(specifier)) as { default: unknown };
      await root.plugin(mod.default as never);
    }

    const presetRealm = createScope(root, Symbol("g57-realm"));
    cleanups.push(() => presetRealm.dispose());
    await presetRealm.ctx.plugin(
      {
        name: pluginModule.name,
        Config: pluginModule.Config,
        inject: pluginModule.inject,
        apply: pluginModule.apply,
      } as never,
      { actionServerCommand: STUB_ACTION_SERVER, screenSize: [1080, 2400] } as never,
    );

    let inside: { keyType: string; schemas: string[]; get: string | null } | null = null;
    await presetRealm.ctx.plugin({
      name: "g57-reader",
      inject: ["tools"],
      apply: (ctx: {
        tools: {
          schemas(scope?: unknown): Array<{ name: string }>;
          get(name: string, scope?: unknown): { name: string } | undefined;
        };
      }) => {
        const key = scopeOf(ctx as never);
        inside = {
          keyType: typeof key,
          schemas: ctx.tools.schemas(key as never).map((schema) => schema.name).sort(),
          get: ctx.tools.get("run_device_action", key as never)?.name ?? null,
        };
      },
    } as never);

    expect(inside?.keyType).toBe("symbol");
    expect(inside?.schemas).toEqual([
      "autogamer_get_device_state",
      "report_task_status",
      "run_device_action",
    ]);
    expect(inside?.get).toBe("run_device_action");
    // Scoped registrations do not leak into the global view (D16 isolation).
    expect(root.tools.schemas()).toHaveLength(0);
  });
});
