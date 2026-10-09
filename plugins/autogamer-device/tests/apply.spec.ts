/**
 * apply() wiring lock. The unit tests around `configuredScreenSize` alone are
 * not enough: the defect lived at the call site, where a truthiness check on
 * the Schemastery-resolved tuple (`[undefined, undefined]`) read as
 * "operator configured it" and fed undefined dimensions into the 0-1000 →
 * pixel conversion. These tests drive the registered tool through apply() and
 * assert the coordinates the py action server actually receives.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  calls: [] as { tool: string; args: Record<string, unknown> }[],
  clientOptions: [] as Record<string, unknown>[],
}));

vi.mock("../src/actionClient.js", () => ({
  ActionClient: class {
    constructor(options: Record<string, unknown>) {
      harness.clientOptions.push(options);
    }

    async callTool(tool: string, args: Record<string, unknown>) {
      harness.calls.push({ tool, args });
      if (tool === "take_screenshot") {
        // 1080x2400 PNG: signature + IHDR with the dimensions at byte 16/20.
        const bytes = Buffer.alloc(33);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
        bytes.writeUInt32BE(13, 8);
        bytes.write("IHDR", 12, "ascii");
        bytes.writeUInt32BE(1080, 16);
        bytes.writeUInt32BE(2400, 20);
        return { content: [{ type: "text", text: bytes.toString("base64") }] };
      }
      if (tool === "get_ui_hierarchy") {
        return { content: [{ type: "text", text: "<hierarchy></hierarchy>" }] };
      }
      return { content: [{ type: "text", text: "Success" }] };
    }

    async dispose() {}
  },
}));

type ToolDefinition = {
  name: string;
  execute(args: Record<string, unknown>, exec: { signal: AbortSignal }): Promise<unknown>;
};

const { apply, Config } = await import("../src/index.js");

function fakeContext(definitions: ToolDefinition[]) {
  return {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    tools: {
      register(definition: unknown) {
        definitions.push(definition as ToolDefinition);
        return () => {};
      },
    },
  };
}

async function registerToolWith(config: Record<string, unknown>): Promise<ToolDefinition> {
  const definitions: ToolDefinition[] = [];
  harness.calls.length = 0;
  await apply(fakeContext(definitions) as never, config as never);
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
