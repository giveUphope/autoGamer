/**
 * `autogamer_get_device_state` unit locks (Phase 1). Backend and preflight are
 * doubles: the preflight gate, serial sanitising, field mapping, and the
 * wire-shape basics live here; the compiled wire schema is locked by the
 * conformance suite (runtimeBoot asserts every tool's object root).
 */
import { describe, expect, it } from "vitest";
import type { ArtemisBackend, DeviceState } from "../src/artemis/types.js";
import type { PreflightResult } from "../src/env/preflight.js";
import { defineGetDeviceState } from "../src/tools/getDeviceState.js";

const HEALTHY: PreflightResult = { ok: true, checks: [], finishedAt: "2026-10-14T00:00:00.000Z" };

function backendReturning(state: DeviceState): {
  backend: ArtemisBackend;
  calls: { deviceSerial?: string; includeScreenshot?: boolean }[];
} {
  const calls: { deviceSerial?: string; includeScreenshot?: boolean }[] = [];
  return {
    calls,
    backend: {
      getDeviceState: async (args) => {
        calls.push(args);
        return state;
      },
      dispose: async () => undefined,
    },
  };
}

function defineWith(overrides?: {
  backend?: ArtemisBackend;
  env?: PreflightResult;
  defaultDeviceSerial?: string;
}): { tool: ReturnType<typeof defineGetDeviceState>; calls: unknown[] } {
  const { backend, calls } = backendReturning({
    deviceSerial: "em-1",
    connected: true,
    currentPackage: "com.example",
    screenshotPath: "/tmp/shot.png",
  });
  const tool = defineGetDeviceState({
    backend: overrides?.backend ?? backend,
    checkEnv: async () => overrides?.env ?? HEALTHY,
    defaultDeviceSerial: overrides?.defaultDeviceSerial ?? "",
  });
  return { tool, calls };
}

describe("get_device_state: definition", () => {
  it("registers under the autogamer_ prefix with a plain-string description", () => {
    const { tool } = defineWith();
    expect(tool.name).toBe("autogamer_get_device_state");
    expect(typeof tool.description).toBe("string");
  });

  it("declares the serial/screenshot params and requires the identity fields", () => {
    const { tool } = defineWith();
    const parameters = tool.parameters as Record<string, { type?: string }>;
    expect(parameters.device_serial?.type).toBe("string");
    expect(parameters.include_screenshot?.type).toBe("boolean");
    const schema = tool.output as {
      schema: { properties: Record<string, { required?: boolean }> };
    };
    expect(schema.schema.properties.device_serial?.required).toBe(true);
    expect(schema.schema.properties.connected?.required).toBe(true);
    expect(schema.schema.properties.current_package?.required).not.toBe(true);
  });

  it("is declared concurrency-safe: reads never need the device gate", () => {
    const { tool } = defineWith();
    expect(tool.isConcurrencySafe?.({})).toBe(true);
  });
});

describe("get_device_state: execute", () => {
  it("refuses on a failed preflight with the fix attached", async () => {
    const { tool } = defineWith({
      env: {
        ok: false,
        checks: [{ id: "adb-devices", ok: false, detail: "none attached", fix: "plug it in" }],
        finishedAt: "t",
      },
    });
    await expect(tool.execute({}, { signal: new AbortController().signal })).rejects.toThrow(
      /environment: preflight failed at adb-devices.*plug it in/,
    );
  });

  it("prefers the call arg, then the configured default, then omits", async () => {
    const first = defineWith({ defaultDeviceSerial: "em-default" });
    await first.tool.execute({ device_serial: "em-arg" }, { signal: new AbortController().signal });
    expect(first.calls).toEqual([{ deviceSerial: "em-arg", includeScreenshot: false }]);

    const second = defineWith({ defaultDeviceSerial: "em-default" });
    await second.tool.execute({}, { signal: new AbortController().signal });
    expect(second.calls).toEqual([{ deviceSerial: "em-default", includeScreenshot: false }]);

    const third = defineWith({ defaultDeviceSerial: "" });
    await third.tool.execute({ device_serial: "" }, { signal: new AbortController().signal });
    expect(third.calls).toEqual([{ deviceSerial: undefined, includeScreenshot: false }]);
  });

  it("maps the backend state onto the output record", async () => {
    const { tool } = defineWith();
    const value = (await tool.execute(
      { include_screenshot: true },
      { signal: new AbortController().signal },
    )) as Record<string, unknown>;
    expect(value).toMatchObject({
      device_serial: "em-1",
      connected: true,
      current_package: "com.example",
      screenshot_path: "/tmp/shot.png",
    });
    expect(value.current_activity).toBeUndefined();
  });

  it("renders a one-line text envelope naming device and connection", async () => {
    const { tool } = defineWith();
    const rendered = tool.output?.render(
      {},
      { device_serial: "em-1", connected: true },
    ) as { type: string; text?: string }[];
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.text).toContain("device_serial=em-1");
    expect(rendered[0]?.text).toContain("connected=true");
  });

  it("backend errors pass through with their classification intact", async () => {
    const failing: ArtemisBackend = {
      getDeviceState: async () => {
        throw new Error("environment: provider is down");
      },
      dispose: async () => undefined,
    };
    const { tool } = defineWith({ backend: failing });
    await expect(
      tool.execute({}, { signal: new AbortController().signal }),
    ).rejects.toThrow(/^environment: provider is down/);
  });
});
