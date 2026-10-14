/**
 * `autogamer_get_device_state` unit locks. Since T2-a the answers come from
 * local adb probes, so the double is the probe (not a provider backend): these
 * tests own the mapping from "what adb said" to the tool's observable record,
 * including the honesty rule — a probe that did not answer must not be reported
 * as a device that is off. The probe's own parsing of real adb output is locked
 * in deviceState.spec.ts, and the wiring in apply.spec.ts.
 */
import { describe, expect, it } from "vitest";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { DeviceStateProbe, WindowState } from "../src/device/state.js";
import type { PreflightResult } from "../src/env/preflight.js";
import type { DshImageAttachment } from "../src/dsh-types.js";
import { defineGetDeviceState, summarize } from "../src/tools/getDeviceState.js";
import { pngHeaderOnly } from "./support/fakeAdb.js";

const HEALTHY: PreflightResult = { ok: true, checks: [], finishedAt: "2026-10-14T00:00:00.000Z" };

interface ProbeScript {
  serial?: string;
  connection?: "device" | "offline" | "unauthorized";
  window?: WindowState;
  helperInstalled?: boolean;
  /** Set when the device answers the screencap with nothing at all. */
  noFrame?: boolean;
}

/**
 * A probe double that also records which questions were asked: `capture` being
 * called only for `include_screenshot` is part of the contract (it costs a
 * screencap), and `serial` must not be asked when the caller named a device.
 */
function probeDouble(script: ProbeScript) {
  const calls: string[] = [];
  const png = pngHeaderOnly(1080, 2400);
  const probe: DeviceStateProbe = {
    async serial() {
      calls.push("serial");
      return script.serial;
    },
    async connection() {
      calls.push("connection");
      return script.connection;
    },
    async window() {
      calls.push("window");
      return script.window ?? { screenLocked: false };
    },
    async frame() {
      calls.push("frame");
      return { width: 1080, height: 2400 };
    },
    async helperInstalled() {
      calls.push("helper");
      return script.helperInstalled;
    },
    async capture() {
      calls.push("capture");
      return script.noFrame === true ? undefined : png;
    },
  };
  return { probe, calls };
}

function attachment(id = "att-1"): DshImageAttachment {
  return {
    attachmentId: id as DshImageAttachment["attachmentId"],
    mediaType: "image/png",
    bytes: 33,
    width: 1080,
    height: 2400,
  };
}

function defineWith(
  script: ProbeScript,
  overrides?: { env?: PreflightResult; defaultDeviceSerial?: string; noStore?: boolean },
) {
  const { probe, calls } = probeDouble(script);
  const saved: Buffer[] = [];
  const tool = defineGetDeviceState({
    probe,
    checkEnv: async () => overrides?.env ?? HEALTHY,
    defaultDeviceSerial: overrides?.defaultDeviceSerial ?? "",
    ...(overrides?.noStore
      ? {}
      : {
          saveScreenshot: async (bytes: Uint8Array) => {
            saved.push(Buffer.from(bytes));
            return attachment();
          },
        }),
  });
  return { tool, calls, saved, probe };
}

describe("get_device_state: definition", () => {
  it("registers under the autogamer_ prefix with a plain-string description", () => {
    const { tool } = defineWith({});
    expect(tool.name).toBe("autogamer_get_device_state");
    expect(typeof tool.description).toBe("string");
    expect(tool.description).toContain("adb");
  });

  it("declares the serial/screenshot params and requires the identity fields", () => {
    const { tool } = defineWith({});
    const parameters = tool.parameters as Record<string, { type?: string }>;
    expect(parameters.device_serial?.type).toBe("string");
    expect(parameters.include_screenshot?.type).toBe("boolean");
    const schema = tool.output as { schema: { properties: Record<string, { required?: boolean }> } };
    expect(schema.schema.properties.device_serial?.required).toBe(true);
    expect(schema.schema.properties.connected?.required).toBe(true);
    expect(schema.schema.properties.current_package?.required).not.toBe(true);
  });

  it("is declared concurrency-safe: reads never need the device gate", () => {
    const { tool } = defineWith({});
    expect(tool.isConcurrencySafe?.({})).toBe(true);
  });
});

describe("get_device_state: execute", () => {
  it("refuses on a failed preflight with the fix attached", async () => {
    const { tool } = defineWith({}, {
      env: {
        ok: false,
        checks: [{ id: "adb-devices", ok: false, detail: "none attached", fix: "plug it in" }],
        finishedAt: "t",
      },
    });
    await expect(tool.execute({}, exec())).rejects.toThrow(/environment: preflight failed at adb-devices.*plug it in/);
  });

  it("names the device it answered for: arg, then config, then what adb addresses", async () => {
    const byArg = defineWith({ serial: "em-from-adb" }, { defaultDeviceSerial: "em-default" });
    await byArg.tool.execute({ device_serial: "em-arg" }, exec());
    expect(byArg.calls).toContain("connection");
    expect(byArg.calls).not.toContain("serial");

    const byConfig = defineWith({ serial: "em-from-adb" }, { defaultDeviceSerial: "em-default" });
    await byConfig.tool.execute({}, exec());
    expect(byConfig.calls).not.toContain("serial");

    const byAdb = defineWith({ serial: "em-from-adb" }, { defaultDeviceSerial: "" });
    const value = (await byAdb.tool.execute({ device_serial: "" }, exec())) as Record<string, unknown>;
    expect(byAdb.calls).toContain("serial");
    expect(value.device_serial).toBe("em-from-adb");
  });

  it("maps the probes onto the output record", async () => {
    const { tool } = defineWith({
      connection: "device",
      window: {
        screenLocked: false,
        foreground: { package: "com.example", activity: "com.example.Main" },
      },
      helperInstalled: true,
    });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value).toMatchObject({
      device_serial: "",
      connected: true,
      current_package: "com.example",
      current_activity: "com.example.Main",
      accessibility_helper_installed: true,
    });
    expect(String(value.screen_summary)).toContain("frame 1080x2400");
  });

  it("omits what the device did not answer instead of inventing it", async () => {
    const { tool } = defineWith({ connection: undefined, window: { screenLocked: null }, helperInstalled: undefined });
    const value = (await tool.execute({}, exec())) as Record<string, unknown>;
    expect(value.connected).toBe(false);
    expect(value.current_package).toBeUndefined();
    expect(value.accessibility_helper_installed, "an unanswered probe is not `false`").toBeUndefined();
    expect(String(value.screen_summary)).toContain("did not answer");
  });

  it("says the screen is not ready without claiming a lock it did not see", async () => {
    const locked = (await (defineWith({ connection: "device", window: { screenLocked: true } }).tool.execute(
      {},
      exec(),
    )) as Record<string, unknown>).screen_summary;
    expect(String(locked)).toContain("screen locked/off");

    const unknown = (await (defineWith({ connection: "device", window: { screenLocked: null } }).tool.execute(
      {},
      exec(),
    )) as Record<string, unknown>).screen_summary;
    expect(String(unknown)).toContain("screen state unknown");
    expect(String(unknown)).not.toContain("screen locked/off");
  });

  /**
   * The frame belongs to the state: its size is reported whether or not a
   * screenshot was asked for (one capture, measured at ~0.4s on the emulator,
   * always). What `include_screenshot` controls is whether the bytes go to the
   * attachment store and reach the model as an image block.
   */
  it("reports the frame size always, and hands the image to the store only when asked", async () => {
    const asked = defineWith({});
    const value = (await asked.tool.execute({ include_screenshot: true }, exec())) as Record<string, unknown>;
    expect(asked.calls).toContain("capture");
    expect(asked.saved).toHaveLength(1);
    expect(value.screenshot_path).toBe("att-1");

    const notAsked = defineWith({});
    const plain = (await notAsked.tool.execute({}, exec())) as Record<string, unknown>;
    expect(plain.screenshot_path).toBeUndefined();
    expect(notAsked.saved).toHaveLength(0);
    expect(String(plain.screen_summary)).toContain("frame 1080x2400");
  });

  it("reports no screenshot when the store or the frame is missing, without failing the read", async () => {
    const noStore = defineWith({}, { noStore: true });
    const value = (await noStore.tool.execute({ include_screenshot: true }, exec())) as Record<string, unknown>;
    expect(value.connected).toBe(false);
    expect(value.screenshot_path).toBeUndefined();

    const noFrame = defineWith({ noFrame: true });
    const dead = (await noFrame.tool.execute({ include_screenshot: true }, exec())) as Record<string, unknown>;
    expect(dead.screenshot_path).toBeUndefined();
    expect(String(dead.screen_summary)).toContain("frame size unknown");
  });

  it("renders the state as one text line, and the screenshot as an image block", async () => {
    const { tool } = defineWith({ connection: "device" });
    const rendered = tool.output?.render({}, { device_serial: "em-1", connected: true }) as {
      type: string;
      text?: string;
    }[];
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.text).toContain("device_serial=em-1");
    expect(rendered[0]?.text).toContain("connected=true");

    const withImage = tool.output?.render({}, {
      device_serial: "em-1",
      connected: true,
      screenshot: attachment(),
      screenshot_path: "att-1",
    }) as { type: string; text?: string; attachment?: unknown }[];
    expect(withImage).toHaveLength(2);
    expect(withImage[1]).toMatchObject({ type: "image", attachment: { attachmentId: "att-1" } });
    expect(withImage[0]?.text).not.toContain("[object Object]");
  });

  it("a probe that dies is an environment failure, not a silent empty state", async () => {
    const { probe } = defineWith({});
    const throwing: DeviceStateProbe = {
      ...probe,
      connection: async () => {
        throw new Error("adb vanished");
      },
    };
    const tool = defineGetDeviceState({
      probe: throwing,
      checkEnv: async () => HEALTHY,
      defaultDeviceSerial: "",
    });
    await expect(tool.execute({}, exec())).rejects.toThrow(/adb vanished/);
  });
});

describe("get_device_state: summary wording", () => {
  it("joins with | so the render's ; separated fields stay parseable", () => {
    const text = summarize({
      connected: true,
      connection: "device",
      state: { screenLocked: false },
      frame: { width: 1600, height: 900 },
      helperInstalled: false,
    });
    expect(text).toBe("connected | screen on and unlocked | frame 1600x900 | helper APK not installed");
    expect(text).not.toContain("; ");
  });
});

/** The host's run context carries more than a signal; a tool body must not
 * depend on any of it, so the double is the minimum and is typed at the seam. */
function exec(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext;
}
