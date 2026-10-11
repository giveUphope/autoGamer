/**
 * apply() wiring lock. The unit tests around `configuredScreenSize` alone are
 * not enough: the defect lived at the call site, where a truthiness check on
 * the Schemastery-resolved tuple (`[undefined, undefined]`) read as
 * "operator configured it" and fed undefined dimensions into the 0-1000 →
 * pixel conversion. These tests drive the registered tool through apply() and
 * assert the coordinates the py action server actually receives.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseImageSize } from "../src/coord.js";
import type { DshImageAttachment } from "../src/dsh-types.js";

/** A 1080x2400 PNG: signature + IHDR carrying the dimensions at byte 16/20. */
function pngBytes(): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1080, 16);
  bytes.writeUInt32BE(2400, 20);
  return bytes;
}

const harness = vi.hoisted(() => ({
  calls: [] as { tool: string; args: Record<string, unknown> }[],
  clientOptions: [] as Record<string, unknown>[],
  /** What compare_ui_frames should answer; undefined means "no verdict". */
  changed: true as boolean | undefined,
  disposed: 0,
}));

vi.mock("../src/actionClient.js", () => ({
  ActionClient: class {
    constructor(options: Record<string, unknown>) {
      harness.clientOptions.push(options);
    }

    async callTool(tool: string, args: Record<string, unknown>) {
      harness.calls.push({ tool, args });
      if (tool === "take_screenshot") {
        return { content: [{ type: "text", text: pngBytes().toString("base64") }] };
      }
      if (tool === "compare_ui_frames") {
        return {
          content: [{ type: "text", text: JSON.stringify({ changed: harness.changed }) }],
        };
      }
      if (tool === "get_ui_hierarchy") {
        // Live shape: a JSON node list whose own `index` is per-container.
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify([
                { index: "0", text: "亮度", "content-desc": "", "resource-id": "", class: "android.widget.TextView", package: "com.android.settings", clickable: "true", parsed_bounds: { left: 40, top: 400, right: 200, bottom: 460 } },
                { index: "1", text: "显示", "content-desc": "", "resource-id": "", class: "android.widget.TextView", package: "com.android.settings", clickable: "true", parsed_bounds: { left: 40, top: 600, right: 200, bottom: 660 } },
              ]),
            },
          ],
        };
      }
      return { content: [{ type: "text", text: "Success" }] };
    }

    async dispose() {
      harness.disposed += 1;
    }
  },
}));

type ToolDefinition = {
  name: string;
  execute(args: Record<string, unknown>, exec: { signal: AbortSignal }): Promise<unknown>;
  output?: { render(args: unknown, value: unknown): { type: string; text?: string; attachment?: unknown }[] };
};

const { apply, Config } = await import("../src/index.js");

/**
 * Cordis-faithful context double. `effect(setup)` runs `setup` IMMEDIATELY and
 * keeps its returned function as the teardown (verified against upstream
 * mount.ts:208 / agent-preset-registry/src/index.ts:112 / app-boot
 * service.ts:110). The apply.spec.ts double used to omit `effect` entirely,
 * which let a teardown-as-callback bug (G30: apply() disposed its own tool
 * registrations) pass CI while every live session lost the tool face.
 */
/**
 * Cordis-faithful context double: `effect` runs the callback immediately and
 * keeps its return value as the teardown; services are real lookups; and
 * `on(name, handler, options)` records the options so the scope-filter bypass
 * (G44 v2, `{ global: true }`) is itself under test.
 */
function fakeContext(
  definitions: ToolDefinition[],
  attachments?: { saveImages(inputs: readonly unknown[]): Promise<readonly DshImageAttachment[]> },
  agentId = "agent-1",
) {
  const cleanups: unknown[] = [];
  const listeners: Array<{ handler: (session: unknown, event: unknown) => void; options?: { global?: boolean } }> = [];
  const followups: unknown[] = [];
  const agent = { id: agentId, followup: (message: unknown) => { followups.push(message); } };
  const context = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    tools: {
      register(definition: unknown) {
        definitions.push(definition as ToolDefinition);
        return () => {};
      },
    },
    agents: {
      get: (id: string) => (id === agentId ? agent : undefined),
      currentInitiator: () => agent,
    },
    on(event: string, handler: (session: unknown, payload: unknown) => void, options?: { global?: boolean }) {
      if (event === "session/event") listeners.push({ handler, options });
      return () => {};
    },
    ...(attachments ? { attachments } : {}),
    effect(setup: () => unknown): void {
      cleanups.push(setup());
    },
  };
  return {
    context,
    cleanups,
    followups,
    listenerOptions: () => listeners.map((l) => l.options),
    emit: (type: string, id = agentId) => {
      for (const l of listeners) l.handler({ id }, { type });
    },
  };
}

async function registeredTools(
  config: Record<string, unknown>,
  attachments?: { saveImages(inputs: readonly unknown[]): Promise<readonly DshImageAttachment[]> },
) {
  const definitions: ToolDefinition[] = [];
  harness.calls.length = 0;
  const double = fakeContext(definitions, attachments);
  await apply(double.context as never, config as never);
  const find = (name: string) => {
    const tool = definitions.find((d) => d.name === name);
    if (!tool) throw new Error(`${name} was not registered (got: ${definitions.map((d) => d.name).join(", ")})`);
    return tool;
  };
  return { ...double, runDeviceAction: find("run_device_action"), reportTaskStatus: find("report_task_status") };
}

async function registerToolWith(
  config: Record<string, unknown>,
  attachments?: { saveImages(inputs: readonly unknown[]): Promise<readonly DshImageAttachment[]> },
): Promise<ToolDefinition> {
  const definitions: ToolDefinition[] = [];
  harness.calls.length = 0;
  const { context } = fakeContext(definitions, attachments);
  await apply(context as never, config as never);
  const tool = definitions.find((definition) => definition.name === "run_device_action");
  if (!tool) throw new Error(`run_device_action was not registered (got: ${definitions.map((d) => d.name).join(", ")})`);
  return tool;
}

function exec(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

beforeEach(() => {
  harness.calls.length = 0;
  harness.clientOptions.length = 0;
  harness.disposed = 0;
});

describe("apply(): screen size sourcing wiring", () => {
  it("probes the screenshot when no screenSize is configured", async () => {
    const tool = await registerToolWith(Config());
    await tool.execute({ action: "click", target: { coordinate: [500, 500] }, reason: "probe path" }, exec());

    expect(harness.calls.map((call) => call.tool)).toContain("take_screenshot");
    const tap = harness.calls.find((call) => call.tool === "tap");
    expect(tap?.args.coordinates).toEqual([540, 1200]);
  });

  it("honours an explicit screenSize without probing", async () => {
    const tool = await registerToolWith(Config({ screenSize: [720, 1600] }));
    await tool.execute({ action: "click", target: { coordinate: [500, 500] }, reason: "configured" }, exec());

    // Effect observation captures a before-frame and an after-frame, so "no
    // probe" means exactly two captures around the tap, not three.
    expect(harness.calls.filter((call) => call.tool === "take_screenshot")).toHaveLength(2);
    const tap = harness.calls.find((call) => call.tool === "tap");
    expect(tap?.args.coordinates).toEqual([360, 800]);
  });

  it("never leaks the schema's empty tuple into pixel math", async () => {
    const tool = await registerToolWith(Config());
    const result = await tool.execute(
      { action: "click", target: { coordinate: [500, 500] }, reason: "NaN guard" },
      exec(),
    );
    const tap = harness.calls.find((call) => call.tool === "tap");
    expect(tap, "the action must not be dispatched with unresolved dimensions").toBeDefined();
    expect(JSON.stringify((tap?.args as { coordinates: number[] }).coordinates)).not.toContain("null");
    expect(result).toBeDefined();
  });

  it("passes the resolved action-server settings through to the client", async () => {
    await registerToolWith(Config());
    expect(harness.clientOptions).toHaveLength(1);
    expect(harness.clientOptions[0]?.command).toEqual([
      "python",
      "-m",
      "artemis.interfaces.cli.main",
      "mcp",
      "--type",
      "adb",
    ]);
  });
});

describe("apply(): registration lifetime (G30 regression)", () => {
  it("returns teardown from effect() instead of running it during apply()", async () => {
    const definitions: ToolDefinition[] = [];
    harness.calls.length = 0;
    const { context, cleanups } = fakeContext(definitions);
    await apply(context as never, Config() as never);

    // Both tools must still be registered once apply() resolved: cordis
    // effect() takes the RETURNED function as the disposer. The broken
    // ancestor passed teardown as the callback body, so it executed inline,
    // disposing both registrations within apply() while every official
    // checker still reported the row "running".
    expect(definitions.map((definition) => definition.name)).toEqual([
      "run_device_action",
      "report_task_status",
    ]);
    expect(cleanups).toHaveLength(1);
    expect(typeof cleanups[0]).toBe("function");
    // apply() itself must not have disposed anything synchronously.
    expect(harness.disposed).toBe(0);
  });

  it("tears down the action client only when the effect disposer runs", async () => {
    const definitions: ToolDefinition[] = [];
    const { context, cleanups } = fakeContext(definitions);
    await apply(context as never, Config() as never);

    const cleanup = cleanups[0] as () => void;
    cleanup();
    expect(harness.disposed).toBe(1);
  });
});

describe("apply(): screenshot media path (G36)", () => {
  const ref: DshImageAttachment = {
    attachmentId: "opaque-id-from-the-store",
    mediaType: "image/png",
    bytes: 33,
    width: 1080,
    height: 2400,
  };

  it("commits bytes to the attachment store and renders [text, image]", async () => {
    const saved: { data: Uint8Array; mediaType: string }[] = [];
    const tool = await registerToolWith(Config(), {
      saveImages: async (inputs) => {
        saved.push(...(inputs as { data: Uint8Array; mediaType: string }[]));
        return [ref];
      },
    });

    const value = (await tool.execute({ action: "take_screenshot", reason: "look" }, exec())) as Record<
      string,
      unknown
    >;
    expect(saved).toHaveLength(1);
    expect(saved[0].mediaType).toBe("image/png");
    expect(parseImageSize(saved[0].data)).toEqual({ width: 1080, height: 2400 });
    expect(value.image).toEqual(ref);
    expect(value.screenshot).toBe("captured 1080x2400");

    const blocks = tool.output!.render({}, value);
    expect(blocks.map((block) => block.type)).toEqual(["text", "image"]);
    expect(blocks[0].text).toBe("screenshot=captured 1080x2400");
    expect(blocks[1].attachment).toBe(ref);
  });

  it("keeps encoded bytes out of the persisted tool value", async () => {
    const tool = await registerToolWith(Config(), { saveImages: async () => [ref] });
    const value = await tool.execute({ action: "take_screenshot", reason: "look" }, exec());
    // The session log records the result value; only the reference may appear.
    expect(JSON.stringify(value)).not.toContain(pngBytes().toString("base64"));
  });

  it("still reports dimensions when the store refuses the image", async () => {
    const tool = await registerToolWith(Config(), {
      saveImages: async () => {
        throw new Error("AttachmentError: exceeds maxImageBytes");
      },
    });
    const value = (await tool.execute({ action: "take_screenshot", reason: "look" }, exec())) as Record<
      string,
      unknown
    >;
    expect(value).toEqual({ screenshot: "captured 1080x2400" });
    expect(tool.output!.render({}, value)).toEqual([{ type: "text", text: "screenshot=captured 1080x2400" }]);
  });
});

describe("apply(): effect observation (S10 ② / G39 route A)", () => {
  it("reports unchanged when the action server sees no screen change", async () => {
    harness.changed = false;
    const tool = await registerToolWith(Config({ screenSize: [720, 1600] }));
    const value = (await tool.execute(
      { action: "click", target: { coordinate: [500, 500] }, reason: "observe" },
      exec(),
    )) as Record<string, unknown>;
    expect(value.effect).toBe("unchanged");
  });

  it("reports changed when the action server sees the screen move", async () => {
    harness.changed = true;
    const tool = await registerToolWith(Config({ screenSize: [720, 1600] }));
    const value = (await tool.execute(
      { action: "back", reason: "observe" },
      exec(),
    )) as Record<string, unknown>;
    expect(value.effect).toBe("changed");
  });

  it("hands the tap coordinates to the verdict so the ROI rule can apply", async () => {
    const tool = await registerToolWith(Config({ screenSize: [720, 1600] }));
    await tool.execute({ action: "click", target: { coordinate: [500, 500] }, reason: "observe" }, exec());
    const compare = harness.calls.find((call) => call.tool === "compare_ui_frames");
    expect(compare?.args.action).toBe("tap");
    expect(compare?.args.coordinates).toEqual([360, 800]);
  });

  it("reports unknown rather than guessing when no verdict comes back", async () => {
    harness.changed = undefined;
    const tool = await registerToolWith(Config({ screenSize: [720, 1600] }));
    const value = (await tool.execute({ action: "back", reason: "observe" }, exec())) as Record<string, unknown>;
    expect(value.effect).toBe("unknown");
  });

  it("takes no observation frames for read-only actions", async () => {
    const tool = await registerToolWith(Config({ screenSize: [720, 1600] }));
    const value = (await tool.execute({ action: "get_ui_hierarchy", reason: "read" }, exec())) as Record<
      string,
      unknown
    >;
    expect(value).not.toHaveProperty("effect");
    expect(harness.calls.map((call) => call.tool)).toEqual(["get_ui_hierarchy"]);
  });
});

describe("apply(): turn conclusion on the reported outcome (G41)", () => {
  async function reportWith(exec: { signal: AbortSignal; concludeTurn?(): void }) {
    const definitions: ToolDefinition[] = [];
    const { context } = fakeContext(definitions);
    await apply(context as never, Config() as never);
    const tool = definitions.find((d) => d.name === "report_task_status");
    if (!tool) throw new Error("report_task_status was not registered");
    return tool.execute(
      { status: "blocked", summary: "device never answered", reason: "report" },
      exec,
    );
  }

  it("concludes the agent turn once the outcome is reported", async () => {
    let concluded = 0;
    await reportWith({ signal: new AbortController().signal, concludeTurn: () => { concluded += 1; } });
    expect(concluded).toBe(1);
  });

  it("does not let a device action conclude the turn", async () => {
    const tool = await registerToolWith(Config({ screenSize: [720, 1600] }));
    let concluded = 0;
    await tool.execute({ action: "back", reason: "act" }, {
      signal: new AbortController().signal,
      concludeTurn: () => { concluded += 1; },
    });
    expect(concluded).toBe(0);
  });
});

describe("apply(): element handles reach the device (G42)", () => {
  it("resolves a #N handle to that element's pixel center", async () => {
    const tool = await registerToolWith(Config({ screenSize: [1600, 900] }));
    await tool.execute({ action: "click", target: { index: 1 }, reason: "tap 显示" }, exec());
    const tap = harness.calls.find((call) => call.tool === "tap");
    // #1 is the 显示 row at bounds [40,600]-[200,660] on a 1600x900 screen.
    expect(tap?.args.coordinates).toEqual([120, 630]);
  });

  it("hands the model a numbered list rather than the raw per-container index", async () => {
    const tool = await registerToolWith(Config({ screenSize: [1600, 900] }));
    const value = (await tool.execute({ action: "get_ui_hierarchy", reason: "look" }, exec())) as Record<
      string,
      unknown
    >;
    expect(value.element_count).toBe(2);
    const lines = String(value.hierarchy).split("\n");
    expect(lines[0]).toMatch(/^#0 /);
    expect(lines[1]).toMatch(/^#1 .*显示$/);
  });
});

describe("apply(): unreported turns are nudged (G44 v2)", () => {
  const CONFIG = Config({ screenSize: [720, 1600] }) as Record<string, unknown>;

  it("registers its session listener to bypass scope filtering", async () => {
    const tools = await registeredTools(CONFIG);
    expect(tools.listenerOptions()).toEqual([{ global: true }]);
  });

  it("follows up once when a turn ended after device actions without reporting", async () => {
    const tools = await registeredTools(CONFIG);
    await tools.runDeviceAction.execute({ action: "back", reason: "act" }, exec());
    tools.emit("turn/end");
    expect(tools.followups).toHaveLength(1);
    const text = JSON.stringify(tools.followups[0]);
    expect(text).toContain("report_task_status");
    expect(text).toContain("Do not call run_device_action");
  });

  it("stays silent when the turn reported its outcome", async () => {
    const tools = await registeredTools(CONFIG);
    await tools.runDeviceAction.execute({ action: "back", reason: "act" }, exec());
    await tools.reportTaskStatus.execute({ status: "completed", summary: "done" }, exec());
    tools.emit("turn/end");
    expect(tools.followups).toHaveLength(0);
  });

  it("never nudges twice for the same agent", async () => {
    const tools = await registeredTools(CONFIG);
    await tools.runDeviceAction.execute({ action: "back", reason: "act" }, exec());
    tools.emit("turn/end");
    await tools.runDeviceAction.execute({ action: "back", reason: "again" }, exec());
    tools.emit("turn/end");
    expect(tools.followups).toHaveLength(1);
  });

  it("ignores other session events", async () => {
    const tools = await registeredTools(CONFIG);
    await tools.runDeviceAction.execute({ action: "back", reason: "act" }, exec());
    tools.emit("tool/call");
    expect(tools.followups).toHaveLength(0);
  });
});
