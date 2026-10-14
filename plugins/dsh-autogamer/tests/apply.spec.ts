/**
 * apply() wiring lock. The unit tests around `configuredScreenSize` alone are
 * not enough: the defect lived at the call site, where a truthiness check on
 * the Schemastery-resolved tuple (`[undefined, undefined]`) read as
 * "operator configured it" and fed undefined dimensions into the 0-1000 →
 * pixel conversion. These tests drive the registered tool through apply() and
 * assert the coordinates the action tools receive, and that the effect verdict
 * is computed here rather than fetched from the action server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { parseImageSize } from "../src/coord.js";
import { frame } from "./support/pngEncode.js";
import {
  adbRuntime,
  actionArgv,
  catArgv,
  devicesArgv,
  dumpArgv,
  getStateArgv,
  getSerialnoArgv,
  identityArgv,
  packagesArgv,
  pngHeaderOnly,
  rmArgv,
  screencapArgv,
  swipeArgv,
  tapArgv,
  tapsOf,
  windowArgv,
  windowDump,
} from "./support/fakeAdb.js";
import {
  PIXEL_GUIDANCE,
  SELF_CHECK_PROMPT,
  closurePrompt,
  incidentPrompt,
} from "../src/tools/runDeviceAction.js";
import type { DshImageAttachment } from "../src/dsh-types.js";

/**
 * A real PNG in the device's frame space. The effect verdict is computed locally
 * from the frames since T3, so a header-only stub is not enough: the judge has
 * to decode what `exec-out screencap -p` hands back. `parseImageSize` still reads
 * the IHDR at bytes 16/20, so both consumers see the shape they expect.
 */
function pngFrame(level = 40): Buffer {
  return Buffer.from(frame(720, 1600, level));
}

/**
 * The same two rows the fake action server answers as JSON, in the device's own
 * wire form: `uiautomator dump` XML, flattened by `src/device/hierarchy.ts`.
 * Bounds are in frame space, and the `index` attribute repeats per container —
 * which is exactly the field G42 says cannot address an element.
 */
const HIERARCHY_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="1">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.settings" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1600,900]" drawing-order="0" hint="">
    <node index="0" text="亮度" resource-id="" class="android.widget.TextView" package="com.android.settings" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[40,400][200,460]" drawing-order="0" hint="" />
    <node index="1" text="显示" resource-id="" class="android.widget.TextView" package="com.android.settings" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[40,600][200,660]" drawing-order="1" hint="" />
  </node>
</hierarchy>`;

/**
 * What the frames the router sees look like. Since T2-c every capture is an
 * `exec-out screencap -p`, so these flags drive the adb double's answer rather
 * than a fake action server: `captures` counts them, `drift` makes the second
 * frame of each pair differ, `garbage` hands back bytes that are not a PNG.
 */
const harness = vi.hoisted(() => ({
  captures: 0,
  drift: false,
  garbage: false,
}));

function adbFramesAndGestures(): void {
  // One healthy device in the 720x1600 frame space, answering every question the
  // plugin asks over adb. `captures`/`drift`/`garbage` steer the screencap rule,
  // because the size probe and the effect-observation pair share that one seam.
  adbRuntime.on(getSerialnoArgv, { code: 0, stdout: "emulator-5554\n" });
  adbRuntime.on(getStateArgv, { code: 0, stdout: "device\n" });
  adbRuntime.on(windowArgv, {
    code: 0,
    stdout: windowDump({ screenState: "ON", focus: "com.example/.Main" }),
  });
  adbRuntime.on(packagesArgv, { code: 0, stdout: "" });
  adbRuntime.on(screencapArgv, () => {
    harness.captures += 1;
    if (harness.garbage) return { code: 0, stdout: Buffer.from("not-a-png") };
    const level = harness.drift && harness.captures % 2 === 0 ? 200 : 40;
    return { code: 0, stdout: pngFrame(level) };
  });
  adbRuntime.on(actionArgv, { code: 0, stdout: "" });
  adbRuntime.on(dumpArgv, { code: 139, stdout: "UI hierchary dumped to: /sdcard/x.xml\n" });
  adbRuntime.on(catArgv, { code: 0, stdout: HIERARCHY_XML });
  adbRuntime.on(rmArgv, { code: 0, stdout: "" });
}

type ToolDefinition = {
  name: string;
  execute(args: Record<string, unknown>, exec: { signal: AbortSignal }): Promise<unknown>;
  output?: {
    render(args: unknown, value: unknown): { type: string; text?: string; attachment?: unknown }[];
    presentationMeta?(args: unknown, value: unknown): Record<string, unknown>;
  };
};

/**
 * The preflight runner is module-mocked here so apply() never spawns real
 * `uv`/`adb` processes across its dozens of wiring tests: the real runner's
 * subprocess behaviour is locked in tests/preflight.spec.ts with injected
 * doubles, and the warm-up call itself is asserted below.
 */
const preflightProbe = vi.hoisted(() => ({ runs: 0 }));

vi.mock("../src/env/preflight.js", () => ({
  createPreflight: () => ({
    run: async () => {
      preflightProbe.runs += 1;
      return { ok: true, checks: [], finishedAt: "2026-10-14T00:00:00.000Z" };
    },
  }),
  preflightErrorText: () => "environment: mocked preflight failure",
}));

/**
 * The adb double (T2-a, installed globally by tests/support/adbMock.ts). The
 * screen-size probe and the device roster now spawn adb instead of asking the
 * action server, so a suite that reached the machine's real adb would pass or
 * fail depending on what is plugged into this laptop.
 */
const A = adbRuntime;

const { apply } = await import("../src/index.js");
const { configOf: Config } = await import("./support/config.js");

/**
 * Cordis-faithful context double. `effect(setup)` runs `setup` IMMEDIATELY and
 * keeps its returned function as the teardown (verified against upstream
 * mount.ts:208 / agent-preset-registry/src/index.ts:112) — the double used to
 * omit `effect` entirely, which let a teardown-as-callback bug (G30: apply()
 * disposed its own tool registrations) pass CI while every live session lost
 * the tool face. Services are real lookups, and `on(name, handler, options)`
 * records the options so the scope-filter bypass (`{ global: true }`) is itself
 * under test.
 */
function fakeContext(
  definitions: ToolDefinition[],
  attachments?: { saveImages(inputs: readonly unknown[]): Promise<readonly DshImageAttachment[]> },
  agentId = "agent-1",
) {
  const cleanups: unknown[] = [];
  const listeners: Array<{ handler: (session: unknown, event: unknown) => void; options?: { global?: boolean } }> = [];
  const guards: Array<(execution: { name: string; arguments: unknown }) => string | undefined> = [];
  const followups: unknown[] = [];
  const agent = { id: agentId, followup: (message: unknown) => { followups.push(message); } };
  const context = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    tools: {
      register(definition: unknown) {
        definitions.push(definition as ToolDefinition);
        return () => {};
      },
      guard(guard: (execution: { name: string; arguments: unknown }) => string | undefined) {
        guards.push(guard);
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
    guards: () => guards,
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
  const { context } = fakeContext(definitions, attachments);
  await apply(context as never, config as never);
  const tool = definitions.find((definition) => definition.name === "run_device_action");
  if (!tool) throw new Error(`run_device_action was not registered (got: ${definitions.map((d) => d.name).join(", ")})`);
  return tool;
}

function exec(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext;
}

beforeEach(() => {
  harness.captures = 0;
  harness.drift = false;
  harness.garbage = false;
  preflightProbe.runs = 0;
  // One healthy device in the 720x1600 frame space; see adbFramesAndGestures().
  adbFramesAndGestures();
});

describe("apply(): screen size sourcing wiring", () => {
  it("resolves the screen size from the device frame over adb, not from the action server", async () => {
    const tool = await registerToolWith(Config());
    await tool.execute({ action: "click", target: { coordinate: [500, 500] }, reason: "probe path" }, exec());

    // Three captures: the size probe, then the effect-observation pair. All of
    // them are `exec-out screencap -p`; there is no other frame source left.
    expect(A.calls.filter((args) => screencapArgv.test(args.join(" ")))).toHaveLength(3);
    expect(tapsOf(A.calls)).toEqual([[360, 800]]);
  });

  /**
   * G90: the cached screen size must expire. A rotation mid-session used to stay
   * invisible until the plugin restarted. Counted in captures: a click asks the
   * frame once for the size (only when the cache is cold) and twice for the pair.
   *
   * The clock jumps are **absolute numbers, not `SCREEN_SIZE_TTL_MS`**: sizing the
   * jump from the constant under test makes the criterion vacuous — a mutation
   * that sets the TTL to forever moves the jump with it and stays green. (That is
   * exactly what happened to the first version of this test.)
   */
  it("re-probes the screen size once the cache has aged out (G90)", async () => {
    const realNow = Date.now();
    let offset = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow + offset);
    const captures = () => A.calls.filter((args) => screencapArgv.test(args.join(" "))).length;
    try {
      const tool = await registerToolWith(Config());
      await tool.execute({ action: "click", target: { coordinate: [500, 500] }, reason: "first" }, exec());
      expect(captures(), "cold cache: one size probe plus the effect pair").toBe(3);

      offset = 1_000;
      await tool.execute({ action: "click", target: { coordinate: [500, 500] }, reason: "second" }, exec());
      expect(captures(), "one second later the cached space is still trusted").toBe(5);

      offset = 6_000;
      await tool.execute({ action: "click", target: { coordinate: [500, 500] }, reason: "third" }, exec());
      expect(captures(), "six seconds later the device is asked again").toBe(8);
    } finally {
      clock.mockRestore();
    }
  });

  it("honours an explicit screenSize that matches the frame", async () => {    const tool = await registerToolWith(Config({ screenSize: [720, 1600] }));
    await tool.execute({ action: "click", target: { coordinate: [500, 500] }, reason: "configured" }, exec());

    expect(tapsOf(A.calls)).toEqual([[360, 800]]);
  });

  /**
   * G76, measured on the live emulator: `wm size` says 900x1600 while the frame
   * of the same device says 1600x900, so an operator who copied the wm numbers
   * would put every tap half a screen off — and nothing used to check.
   */
  it("refuses a configured screenSize that contradicts the device frame (G76)", async () => {
    const tool = await registerToolWith(Config({ screenSize: [900, 1600] }));
    await expect(
      tool.execute({ action: "click", target: { coordinate: [500, 500] }, reason: "transposed config" }, exec()),
    ).rejects.toThrow(/environment: configured screenSize 900x1600 contradicts the device frame 720x1600/);
    expect(tapsOf(A.calls), "nothing may reach the device").toEqual([]);
  });

  it("never leaks the schema's empty tuple into pixel math", async () => {
    const tool = await registerToolWith(Config());
    const result = await tool.execute(
      { action: "click", target: { coordinate: [500, 500] }, reason: "NaN guard" },
      exec(),
    );
    const taps = tapsOf(A.calls);
    expect(taps.length, "the action must not be dispatched with unresolved dimensions").toBeGreaterThan(0);
    expect(JSON.stringify(taps)).not.toMatch(/null|NaN/);
    expect(result).toBeDefined();
  });

  /**
   * T2-c/d/e: the plugin does not start, configure or talk to an action server
   * any more. There is no client to hand settings to, so the lock is that the
   * whole surface goes out through adb - and the gesture really lands.
   */
  it("reaches the device over adb with no action server anywhere", async () => {
    const tool = await registerToolWith(Config({ screenSize: [720, 1600] }));
    await tool.execute({ action: "swipe", target: { coordinate: [100, 200] }, end_coordinate: [900, 800], duration_ms: 300, reason: "swipe" }, exec());

    expect(A.calls.some((args) => swipeArgv.test(args.join(" ")))).toBe(true);
    const swipe = A.calls.find((args) => swipeArgv.test(args.join(" ")))!;
    expect(swipe.slice(-5)).toEqual(["72", "320", "648", "1280", "300"]);
    expect(A.calls.some((args) => /python|artemis|mcp/.test(args.join(" ")))).toBe(false);
  });
});

describe("apply(): registration lifetime (G30 regression)", () => {
  it("returns teardown from effect() instead of running it during apply()", async () => {
    const definitions: ToolDefinition[] = [];
    const { context, cleanups } = fakeContext(definitions);
    await apply(context as never, Config() as never);

    // All three tools must still be registered once apply() resolved: cordis
    // effect() takes the RETURNED function as the disposer. The broken
    // ancestor passed teardown as the callback body, so it executed inline,
    // disposing both registrations within apply() while every official
    // checker still reported the row "running".
    expect(definitions.map((definition) => definition.name)).toEqual([
      "run_device_action",
      "report_task_status",
      "autogamer_get_device_state",
      "autogamer_run_task",
      "autogamer_manage_task",
      "autogamer_inspect_trace",
      "autogamer_diagnose",
    ]);
    expect(cleanups).toHaveLength(1);
    expect(typeof cleanups[0]).toBe("function");
    // apply() itself must not have disposed anything synchronously, and mounting
    // must not have reached the device either (T2-c/d/e: no server to connect).
    expect(A.calls).toEqual([]);
  });

  it("tears down quietly: the disposer spawns nothing and touches no device", async () => {
    const definitions: ToolDefinition[] = [];
    const { context, cleanups } = fakeContext(definitions);
    await apply(context as never, Config() as never);
    A.reset();

    const cleanup = cleanups[0] as () => void;
    expect(() => cleanup()).not.toThrow();
    expect(A.calls).toEqual([]);
  });
});

describe("apply(): screenshot media path (G36)", () => {
  const ref: DshImageAttachment = {
    attachmentId: "opaque-id-from-the-store" as DshImageAttachment["attachmentId"],
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
    expect(saved[0]?.mediaType).toBe("image/png");
    expect(parseImageSize(saved[0]?.data ?? new Uint8Array())).toEqual({ width: 720, height: 1600 });
    expect(value.image).toEqual(ref);
    expect(value.screenshot).toBe("captured 720x1600");

    const blocks = tool.output!.render({}, value);
    expect(blocks.map((block) => block.type)).toEqual(["text", "image"]);
    expect(blocks[0]?.text).toBe("screenshot=captured 720x1600");
    expect(blocks[1]?.attachment).toBe(ref);
  });

  it("keeps encoded bytes out of the persisted tool value", async () => {
    const tool = await registerToolWith(Config(), { saveImages: async () => [ref] });
    const value = await tool.execute({ action: "take_screenshot", reason: "look" }, exec());
    // The session log records the result value; only the reference may appear.
    expect(JSON.stringify(value)).not.toContain(pngFrame().toString("base64"));
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
    expect(value).toEqual({ screenshot: "captured 720x1600" });
    expect(tool.output!.render({}, value)).toEqual([{ type: "text", text: "screenshot=captured 720x1600" }]);
  });
});

describe("apply(): effect observation (S10 ②; local since T3/G84)", () => {
  it("reports unchanged when the two frames match", async () => {
    const tool = await registerToolWith(Config({ screenSize: [720, 1600] }));
    const value = (await tool.execute(
      { action: "click", target: { coordinate: [500, 500] }, reason: "observe" },
      exec(),
    )) as Record<string, unknown>;
    expect(value.effect).toBe("unchanged");
  });

  it("reports changed when the screen moves between the two frames", async () => {
    harness.drift = true;
    const tool = await registerToolWith(Config({ screenSize: [720, 1600] }));
    const value = (await tool.execute(
      { action: "back", reason: "observe" },
      exec(),
    )) as Record<string, unknown>;
    expect(value.effect).toBe("changed");
  });

  it("computes the verdict from the two frames it captured, asking nothing else", async () => {
    const tool = await registerToolWith(Config({ screenSize: [720, 1600] }));
    await tool.execute({ action: "click", target: { coordinate: [500, 500] }, reason: "observe" }, exec());
    // The verdict is computed from the frames themselves (T3), and since T2-c
    // those frames come off the device. A restored server round-trip - or any
    // adb vocabulary beyond the gesture and the captures - is what this catches.
    expect(harness.captures).toBe(3);
    const strays = A.calls.filter((args) => {
      const line = args.join(" ");
      return ![screencapArgv, tapArgv, dumpArgv, catArgv, rmArgv].some((re) => re.test(line));
    });
    expect(strays.map((args) => args.join(" "))).toEqual([]);
  });

  it("reports unknown rather than guessing when the frames are not decodable", async () => {
    harness.garbage = true;
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
    // T2-b: a hierarchy read is a device read. It dispatches no gesture and
    // still captures no before/after frames.
    expect(tapsOf(A.calls)).toEqual([]);
    expect(harness.captures).toBe(0);
    expect(A.calls.filter((args) => /uiautomator dump/.test(args.join(" ")))).toHaveLength(1);
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
    await tool.execute(
      { action: "back", reason: "act" },
      { signal: new AbortController().signal, concludeTurn: () => { concluded += 1; } } as unknown as ToolRunContext,
    );
    expect(concluded).toBe(0);
  });
});

describe("apply(): element handles reach the device (G42)", () => {
  it("resolves a #N handle to that element's pixel center", async () => {
    // A 1600x900 screen space: the adb frame the guard compares against has to
    // say the same thing as the config here, or G76 refuses before the tap.
    A.on(screencapArgv, { code: 0, stdout: pngHeaderOnly(1600, 900) });
    const tool = await registerToolWith(Config({ screenSize: [1600, 900] }));
    // G67: a handle is only meaningful against the list the model was shown.
    await tool.execute({ action: "get_ui_hierarchy", reason: "look" }, exec());
    await tool.execute({ action: "click", target: { index: 2 }, reason: "tap 显示" }, exec());
    const taps = tapsOf(A.calls);
    // #2 is the 显示 row at bounds [40,600]-[200,660] on a 1600x900 screen
    // (#0 is the container the real dump keeps in the tree).
    expect(taps).toEqual([[120, 630]]);
  });

  it("reads the hierarchy off the device instead of asking a server (T2-b)", async () => {
    A.on(screencapArgv, { code: 0, stdout: pngHeaderOnly(1600, 900) });
    const tool = await registerToolWith(Config({ screenSize: [1600, 900] }));
    await tool.execute({ action: "get_ui_hierarchy", reason: "look" }, exec());
    expect(A.calls.filter((args) => /uiautomator dump/.test(args.join(" ")))).toHaveLength(1);
    expect(A.calls.filter((args) => screencapArgv.test(args.join(" ")))).toHaveLength(0);
  });

  it("hands the model a numbered list rather than the raw per-container index", async () => {
    const tool = await registerToolWith(Config({ screenSize: [1600, 900] }));
    const value = (await tool.execute({ action: "get_ui_hierarchy", reason: "look" }, exec())) as Record<
      string,
      unknown
    >;
    /**
     * A real dump is the whole tree, containers included — which the py server's
     * simplified fixture left out. Numbering follows document order, so the
     * FrameLayout is `#0` and the two labelled rows shift by one.
     */
    expect(value.element_count).toBe(3);
    const lines = String(value.hierarchy).split("\n");
    expect(lines[0]).toMatch(/^#0 /);
    expect(lines[1]).toMatch(/^#1 .*亮度$/);
    expect(lines[2]).toMatch(/^#2 .*显示$/);
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
    // Rule R23: appending inside the emit is rejected by the host
    // ("session append cannot reenter while another append is being published"),
    // so the call must NOT have happened yet at this point in the same task.
    expect(tools.followups).toHaveLength(0);
    // The followup is deferred out of the append/publication boundary, so let the
    // macrotask run before asserting it landed.
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tools.followups).toHaveLength(0);
  });

  it("never nudges twice for the same agent", async () => {
    const tools = await registeredTools(CONFIG);
    await tools.runDeviceAction.execute({ action: "back", reason: "act" }, exec());
    tools.emit("turn/end");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await tools.runDeviceAction.execute({ action: "back", reason: "again" }, exec());
    tools.emit("turn/end");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tools.followups).toHaveLength(1);
  });

  it("ignores other session events", async () => {
    const tools = await registeredTools(CONFIG);
    await tools.runDeviceAction.execute({ action: "back", reason: "act" }, exec());
    tools.emit("tool/call");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tools.followups).toHaveLength(0);
  });
});

describe("apply(): the result envelope must not starve the hierarchy (G42)", () => {
  const CONFIG = Config({ screenSize: [720, 1600] }) as Record<string, unknown>;

  it("keeps a long hierarchy dump whole while clipping prose fields", async () => {
    const t = await registeredTools(CONFIG);
    const long = Array.from({ length: 40 }, (_, i) => `#${i} [10,20] clickable pkg=com.x label 设置项`).join("\n");
    const rendered = t.runDeviceAction.output!.render(
      {},
      { result: "Success", hierarchy: long, message: "x".repeat(400) },
    ) as Array<{ text?: string }>;
    const text = rendered.map((part) => part.text ?? "").join("");

    expect(text).toContain(long); // the whole list reaches the model
    expect(text).toContain(`${"x".repeat(200)}…`); // other fields keep the generic budget
  });

  it("hands every prompt field over whole, not clipped mid-sentence (G68 ①)", async () => {
    const t = await registeredTools(CONFIG);
    // The longest serial this plugin can be asked to talk about: adb over the wire.
    const serial = "192.168.1.100:5555";
    const fields = {
      pixel_guidance: PIXEL_GUIDANCE,
      self_check: SELF_CHECK_PROMPT,
      audit_request: incidentPrompt(3, serial, true),
      closure_request: closurePrompt({ consecutive_failures: 3 }, serial),
    };
    for (const [key, text] of Object.entries(fields)) {
      expect(text.length, `${key} is already over the envelope budget`).toBeLessThanOrEqual(200);
    }
    const rendered = t.runDeviceAction.output!.render({}, { effect: "unchanged", ...fields }) as Array<{
      text?: string;
    }>;
    const seen = rendered.map((part) => part.text ?? "").join("");
    for (const [key, text] of Object.entries(fields)) {
      expect(seen, `${key} reached the model truncated`).toContain(`${key}=${text}`);
    }
  });

  it("renders the image as a block instead of flattening its reference", async () => {
    const t = await registeredTools(CONFIG);
    const rendered = t.runDeviceAction.output!.render({}, {
      result: "Success",
      image: { attachmentId: "att-1", mediaType: "image/jpeg" },
    }) as Array<{ type: string; text?: string }>;

    expect(rendered.map((part) => part.type)).toEqual(["text", "image"]);
    expect(rendered[0]?.text).not.toContain("att-1");
  });
});

describe("apply(): checker facts persist on tool/result meta (P1-b)", () => {
  const CONFIG = Config({ screenSize: [720, 1600] }) as Record<string, unknown>;

  it("projects the validator verdict and nothing else", async () => {
    const t = await registeredTools(CONFIG);
    expect(
      t.runDeviceAction.output?.presentationMeta?.({}, {
        result: "Success",
        effect: "unchanged",
        category: "disappeared",
        pixel_guidance: "look",
        incident: { consecutive_failures: 3 },
      }),
    ).toEqual({
      effect: "unchanged",
      category: "disappeared",
      incident: { consecutive_failures: 3 },
    });
  });

  it("projects an empty meta for verdict-less values instead of throwing", async () => {
    const t = await registeredTools(CONFIG);
    expect(t.runDeviceAction.output?.presentationMeta?.({}, { result: "Success" })).toEqual({});
    expect(t.runDeviceAction.output?.presentationMeta?.({}, null)).toEqual({});
  });

  it("projects the terminal outcome for exit audits", async () => {
    const t = await registeredTools(CONFIG);
    expect(
      t.reportTaskStatus.output?.presentationMeta?.({}, {
        status: "blocked",
        tests_failed: 2,
        outcome: "blocked",
      }),
    ).toEqual({ status: "blocked", tests_failed: 2, outcome: "blocked" });
  });
});


describe("report_task_status: the outcome carries BOTH axes (changelogs #62)", () => {
  const CONFIG = Config({ screenSize: [720, 1600] }) as Record<string, unknown>;

  async function report(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const t = await registeredTools(CONFIG);
    return (await t.reportTaskStatus.execute(
      { summary: "done", reason: "report", ...args },
      exec(),
    )) as Record<string, unknown>;
  }

  it("keeps assertion failures in the outcome of a completed task", async () => {
    expect(await report({ status: "completed", tests_failed: 2 })).toEqual({
      status: "completed",
      tests_failed: 2,
      outcome: "completed (with assertion failures on record)",
    });
  });

  it("reports a clean completion without the failure suffix", async () => {
    expect(await report({ status: "completed" })).toMatchObject({
      tests_failed: 0,
      outcome: "completed",
    });
  });

  it("never lets a blocked report read as completed, failures or not", async () => {
    expect(await report({ status: "blocked", tests_failed: 3 })).toMatchObject({ outcome: "blocked" });
    expect(await report({ status: "blocked" })).toMatchObject({ outcome: "blocked" });
  });
});

describe("apply(): breaker refusal lives in a registry guard (G33)", () => {
  const CONFIG = Config({ screenSize: [720, 1600] }) as Record<string, unknown>;

  it("registers exactly one guard", async () => {
    const definitions: ToolDefinition[] = [];
    const double = fakeContext(definitions);
    await apply(double.context as never, CONFIG as never);
    expect(double.guards()).toHaveLength(1);
  });

  it("lets other tools and the report outlet through untouched", async () => {
    const definitions: ToolDefinition[] = [];
    const double = fakeContext(definitions);
    await apply(double.context as never, CONFIG as never);
    const [guard] = double.guards();
    if (guard === undefined) throw new Error("the breaker guard was never registered");
    expect(guard({ name: "job_submit", arguments: {} })).toBeUndefined();
    expect(guard({ name: "report_task_status", arguments: { status: "completed" } })).toBeUndefined();
    // Fresh breaker: our own tool is admitted too.
    expect(guard({ name: "run_device_action", arguments: { action: "back" } })).toBeUndefined();
  });
});

describe("apply(): external ARTEMIS wiring (dsh-autogamer Phase 1)", () => {
  it("registers autogamer_get_device_state alongside the two router tools", async () => {
    const definitions: ToolDefinition[] = [];
    const double = fakeContext(definitions);
    await apply(double.context as never, Config() as never);
    expect(definitions.map((d) => d.name).sort()).toEqual([
      "autogamer_diagnose",
      "autogamer_get_device_state",
      "autogamer_inspect_trace",
      "autogamer_manage_task",
      "autogamer_run_task",
      "report_task_status",
      "run_device_action",
    ]);
  });

  it("warms the preflight cache on mount unless autoPreflight is off", async () => {
    const first: ToolDefinition[] = [];
    await apply(fakeContext(first).context as never, Config() as never);
    expect(preflightProbe.runs).toBeGreaterThanOrEqual(1);
    preflightProbe.runs = 0;
    const second: ToolDefinition[] = [];
    await apply(fakeContext(second).context as never, Config({ autoPreflight: false }) as never);
    expect(preflightProbe.runs).toBe(0);
  });
});

/**
 * The roster glue (T2-a). `enumerateTransports` / `buildRoster` / `screenIsLocked`
 * are locked in deviceRoster.spec.ts and the pool's own folding rules in
 * devicePool.spec.ts; what is only reachable through apply() is that the pool is
 * handed an adb-built roster at all - which transport it asks, that one device
 * with three transports is one entry, and that the lock verdict reaches admission.
 */
describe("apply(): native device roster (G75 / G65)", () => {
  const ONE_EMULATOR_THREE_TRANSPORTS = `List of devices attached
emulator-5554          device product:aurora model:24031PN0DC device:aurora transport_id:1
127.0.0.1:7555         device product:aurora model:24031PN0DC device:aurora transport_id:2
127.0.0.1:16384        device product:aurora model:24031PN0DC device:aurora transport_id:3
`;

  async function guardAfterDiscovery(screenState: string) {
    A.on(devicesArgv, { code: 0, stdout: ONE_EMULATOR_THREE_TRANSPORTS });
    A.on(identityArgv, { code: 0, stdout: "1ca26c4e90b0b571\n" });
    A.on(windowArgv, { code: 0, stdout: windowDump({ screenState, focus: "com.example/.Main" }) });
    const tools = await registeredTools(Config({ discoverDevices: true, screenSize: [720, 1600] }));
    await tools.runDeviceAction.execute(
      { action: "back", device_serial: "emulator-5554", reason: "refresh the roster" },
      exec(),
    );
    return { tools, guard: tools.guards()[0]! };
  }

  it("asks adb once and folds the transports into the one device it admits", async () => {
    const { tools, guard } = await guardAfterDiscovery("ON");
    expect(A.calls.filter((args) => devicesArgv.test(args.join(" ")))).toHaveLength(1);
    expect(A.calls.filter((args) => identityArgv.test(args.join(" ")))).toHaveLength(3);

    expect(guard({ name: "run_device_action", arguments: { device_serial: "127.0.0.1:7555", action: "back" } })).toBeUndefined();
    expect(
      guard({ name: "run_device_action", arguments: { device_serial: "nope-1", action: "back" } }),
      "a serial the roster does not carry is not a device",
    ).toContain("is not connected");
  });

  it("refuses the folded device while its screen is off, under any of its names", async () => {
    const { guard } = await guardAfterDiscovery("OFF");
    expect(guard({ name: "run_device_action", arguments: { device_serial: "emulator-5554", action: "back" } })).toContain("is locked");
    expect(guard({ name: "run_device_action", arguments: { device_serial: "127.0.0.1:16384", action: "back" } })).toContain("is locked");
  });
});
