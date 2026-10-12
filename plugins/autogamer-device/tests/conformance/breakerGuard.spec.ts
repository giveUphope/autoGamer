/**
 * G33 locks on the real registry: the cooling-down refusal lives in a
 * monotonic `ctx.tools.guard`, not in the tool body.
 *
 * Assembly: real service graph + our plugin with an unspawnable action-server
 * command, so the first call fails at the transport (environment failure,
 * opens the breaker with the default allowedFails: 1). The next same-key call
 * must be denied by the guard — proving refusal without any device round-trip
 * — while a different key still goes through to the transport. Agent-less
 * execution is enough: a plain-context guard applies globally.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import * as pluginModule from "../../src/index.js";

const SERVICE_PACKAGES = [
  "@deepseek-ai/dsh-invariants",
  "@deepseek-ai/dsh-system-prompt",
  "@deepseek-ai/dsh-tools",
  "@deepseek-ai/dsh-agent",
  "@deepseek-ai/dsh-attachment",
  "@deepseek-ai/dsh-session",
] as const;

const BAD_ACTION_SERVER = ["g33-no-such-binary-xyz"];

let seq = 0;

async function boot(): Promise<Context> {
  const root = new Context();
  for (const specifier of SERVICE_PACKAGES) {
    const mod = (await import(specifier)) as { default: unknown };
    await root.plugin(mod.default as never);
  }
  await root.plugin(
    {
      name: pluginModule.name,
      Config: pluginModule.Config,
      inject: pluginModule.inject,
      apply: pluginModule.apply,
    } as never,
    {
      actionServerCommand: BAD_ACTION_SERVER,
      screenSize: [1080, 2400],
      defaultDeviceKey: "g33d",
      actionCallTimeoutMs: 5_000,
    } as never,
  );
  return root;
}

function call(root: Context, name: string, args: Record<string, unknown>) {
  seq += 1;
  return (root.tools as {
    execute(input: unknown): Promise<{ isError: boolean; error?: { message?: string } }>;
  }).execute({
    callId: `g33-${name}-${seq}`,
    name,
    arguments: args,
    signal: new AbortController().signal,
  });
}

afterEach(() => {
  seq = 0;
});

describe("conformance: breaker refusal through the registry guard (G33)", () => {
  it("denies the same device while cooling down", async () => {
    const root = await boot();
    const first = await call(root, "run_device_action", { action: "back", reason: "open the breaker" });
    expect(first.isError).toBe(true);
    expect(JSON.stringify(first)).toContain("transport failed");

    const second = await call(root, "run_device_action", {
      action: "take_screenshot",
      reason: "guarded",
    });
    expect(second.isError).toBe(true);
    expect(JSON.stringify(second)).toContain("cooling down");
  });

  it("still admits a different device key", async () => {
    const root = await boot();
    await call(root, "run_device_action", { action: "back", reason: "open the breaker" });

    const other = await call(root, "run_device_action", {
      action: "take_screenshot",
      device_serial: "g33-other",
      reason: "other key",
    });
    expect(other.isError).toBe(true);
    const text = JSON.stringify(other);
    expect(text).toContain("transport failed");
    expect(text).not.toContain("cooling down");
  });

  it("never guards the report outlet", async () => {
    const root = await boot();
    await call(root, "run_device_action", { action: "back", reason: "open the breaker" });

    // report_task_status with no prior report: succeeds trivially (validation
    // of required fields is the DSL's), proving the guard let it through.
    const report = await call(root, "report_task_status", { status: "completed", summary: "g33" });
    expect(report.isError).toBe(false);
  });

  it("keys an empty serial to the default (execute and guard agree)", async () => {
    const root = await boot();
    // Open the breaker through an explicitly empty serial…
    const first = await call(root, "run_device_action", {
      action: "back",
      device_serial: "",
      reason: "open via empty serial",
    });
    expect(first.isError).toBe(true);
    expect(JSON.stringify(first)).toContain("transport failed");
    // …then the omitted-serial (default-key) call must see the same hold.
    // Before deviceKeyOf, execute keyed "" while the guard keyed "default".
    const second = await call(root, "run_device_action", {
      action: "take_screenshot",
      reason: "default key sees the hold",
    });
    expect(second.isError).toBe(true);
    expect(JSON.stringify(second)).toContain("cooling down");
  });

  it("marks only read-only actions concurrency-safe", async () => {
    const root = await boot();
    const runDeviceAction = (root.tools as {
      get(name: string): { isConcurrencySafe?: (args: unknown) => boolean } | undefined;
    }).get("run_device_action");
    const classify = (args: unknown) => runDeviceAction?.isConcurrencySafe?.(args);
    // defineTool validates before delegating: schema-valid read-only calls are
    // parallel, everything else (including schema-invalid input) is exclusive.
    expect(classify({ action: "take_screenshot", reason: "look" })).toBe(true);
    expect(classify({ action: "get_ui_hierarchy", reason: "look" })).toBe(true);
    expect(classify({ action: "click", target: { index: 0 }, reason: "tap" })).not.toBe(true);
    expect(classify({ action: "launch_app", package: "com.example", reason: "go" })).not.toBe(true);
    expect(classify({ action: "take_screenshot" })).toBe(false);
  });
});
