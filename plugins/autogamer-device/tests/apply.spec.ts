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
      if (tool === "get_ui_hierarchy") {
        return { content: [{ type: "text", text: "<hierarchy></hierarchy>" }] };
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
function fakeContext(
  definitions: ToolDefinition[],
  attachments?: { saveImages(inputs: readonly unknown[]): Promise<readonly DshImageAttachment[]> },
) {
  const cleanups: unknown[] = [];
  const context = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    tools: {
      register(definition: unknown) {
        definitions.push(definition as ToolDefinition);
        return () => {};
      },
    },
    ...(attachments ? { attachments } : {}),
    effect(setup: () => unknown): void {
      cleanups.push(setup());
    },
  };
  return { context, cleanups };
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

    expect(harness.calls.map((call) => call.tool)).not.toContain("take_screenshot");
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
