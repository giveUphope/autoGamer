/**
 * T5's consumer path (the half the plan called the delivery condition): OCR is
 * the **second** source, reached only for a `{text}` target the nodes cannot
 * answer, and the tap has to land on the box the label was matched in.
 *
 * The reason this needs its own locks is that both halves are invisible from
 * `src/ocr/recognize.ts`: a router that asked OCR on every miss (including
 * `{index}`) would still pass every unit test, and one that used a hit's own box
 * would tap the middle of a launcher row instead of the label in it. The page
 * here is built with the real `parseOcrData` over the row shape the live probe
 * measured, so re-boxing is exercised through the same function the device path
 * runs.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { DeviceBreaker } from "../src/breaker.js";
import { LiveObservations } from "../src/observations.js";
import { harness } from "./support/pool.js";
import { ActionIncidents, defineRunDeviceAction } from "../src/tools/runDeviceAction.js";
import { hierarchyXml, type XmlNodeSpec } from "./support/hierarchyXml.js";
import { pngHeaderOnly } from "./support/fakeAdb.js";
import { parseOcrData, type OcrDataLike, type OcrPage } from "../src/ocr/recognize.js";

function node(label: string, cx: number, cy: number): XmlNodeSpec {
  return { text: label, left: cx - 80, top: cy - 30, right: cx + 80, bottom: cy + 30 };
}

const OBSERVED = hierarchyXml([node("亮度", 120, 430), node("显示", 120, 630)]);
/**
 * A canvas / WebView screen: the window nodes are dumped, none of them carries
 * text, so `findNodeCenterBySubstring` can never answer — which is exactly the
 * case OCR exists for.
 */
const CANVAS = hierarchyXml([
  { text: "", left: 0, top: 0, right: 720, bottom: 1600 },
  { text: "", left: 40, top: 640, right: 680, bottom: 720 },
]);

function word(text: string, confidence: number, box: [number, number, number, number]) {
  return { text, confidence, bbox: { x0: box[0], y0: box[1], x1: box[2], y1: box[3] } };
}

/**
 * One game-menu row, shaped exactly like the measured launcher row: tesseract
 * reads it as a single line spanning the screen, whose own centre (605,673) is
 * empty space, while 商店 is two tight words at the right end.
 */
const MENU_ROW: OcrDataLike = {
  blocks: [
    {
      paragraphs: [
        {
          lines: [
            {
              text: "活 动 福 利 榜 单 商 店\n",
              confidence: 61,
              bbox: { x0: 10, y0: 645, x1: 1200, y1: 700 },
              words: [
                word("活", 88, [10, 650, 50, 690]),
                word("动", 90, [60, 650, 100, 690]),
                word("福", 87, [110, 650, 150, 690]),
                word("利", 89, [160, 650, 200, 690]),
                word("榜", 91, [300, 645, 340, 700]),
                word("单", 92, [350, 645, 390, 700]),
                word("商", 95, [1100, 645, 1150, 700]),
                word("店", 94, [1150, 645, 1200, 700]),
              ],
            },
          ],
        },
      ],
    },
  ],
  text: "活 动 福 利 榜 单 商 店\n",
  confidence: 61,
};

function ocrPage(data: OcrDataLike): OcrPage {
  return { hits: parseOcrData(data), text: String(data.text ?? ""), confidence: 61, ms: 601 };
}

/** Two identical labels: the same text at two points, so nothing may be guessed. */
const TWO_SHOPS: OcrDataLike = {
  blocks: [
    {
      paragraphs: [
        {
          lines: [
            {
              text: "商 店",
              confidence: 90,
              bbox: { x0: 100, y0: 100, x1: 300, y1: 160 },
              words: [word("商", 92, [100, 100, 150, 160]), word("店", 91, [150, 100, 200, 160])],
            },
            {
              text: "商 店",
              confidence: 90,
              bbox: { x0: 900, y0: 700, x1: 1100, y1: 760 },
              words: [word("商", 93, [900, 700, 950, 760]), word("店", 92, [950, 700, 1000, 760])],
            },
          ],
        },
      ],
    },
  ],
  text: "商 店\n商 店\n",
  confidence: 90,
};

const log: { tool: string; args: Record<string, unknown> }[] = [];
let ocrKeys: string[] = [];
let pages: (OcrPage | undefined)[] = [];
let hierarchies: string[] = [];
let regionKeys: string[] = [];
let regionNodeCounts: number[] = [];
let regionPages: (OcrPage | undefined)[] = [];
let agent = "agent-1";

function setup(options: { devices?: string[]; ocr?: boolean; regions?: boolean } = {}) {
  log.length = 0;
  ocrKeys = [];
  pages = [];
  hierarchies = [];
  regionKeys = [];
  regionNodeCounts = [];
  regionPages = [];
  agent = "agent-1";
  const tool = defineRunDeviceAction({
    pool: harness(options.devices ?? []).pool,
    breaker: new DeviceBreaker({ allowedFails: 99, cooldownMs: 0 }),
    execute: async (call: { tool: string; payload: Record<string, unknown> }) => {
      log.push({ tool: call.tool, args: call.payload });
      return "Success";
    },
    capturePng: async () => pngHeaderOnly(720, 1600),
    hierarchy: async () => {
      log.push({ tool: "get_ui_hierarchy", args: {} });
      return hierarchies.length > 0 ? hierarchies.shift()! : OBSERVED;
    },
    // The engine seam: returns the next scripted page, or nothing.
    ...(options.ocr === false
      ? {}
      : {
          ocr: async (key: string) => {
            ocrKeys.push(key);
            return pages.length > 0 ? pages.shift() : ocrPage(MENU_ROW);
          },
        }),
    // G92 P1: the third source. Absent unless the caller wires it, and by default it
    // has nothing to say - so every pre-existing lock below still reads as before.
    ...(options.regions === false
      ? {}
      : {
          ocrRegions: async (key: string, nodes: readonly { bounds?: unknown }[]) => {
            regionKeys.push(key);
            regionNodeCounts.push(nodes.length);
            return regionPages.length > 0 ? regionPages.shift() : undefined;
          },
        }),
    logger: { info: () => {}, warn: () => {} },
    defaultDeviceKey: "default",
    incidents: new ActionIncidents(),
    observations: new LiveObservations(),
    agentIdOfCall: () => agent,
    resolveScreenSize: async () => ({ width: 720, height: 1600 }),
    captureFrame: async () => "frame",
    compareFrames: async () => true,
  });
  return tool;
}

function exec(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext;
}

async function observe(tool: ReturnType<typeof setup>): Promise<void> {
  await tool.execute({ action: "get_ui_hierarchy", reason: "t" }, exec() as never);
  log.length = 0;
}

function taps(): Record<string, unknown>[] {
  return log.filter((call) => call.tool === "tap").map((call) => call.args);
}

beforeEach(() => {
  log.length = 0;
});

describe("OCR is the second source, never the first", () => {
  it("does not ask the frame what the nodes already answer", async () => {
    const tool = setup();
    const value = (await tool.execute(
      { action: "click", target: { text: "显示" }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(taps()[0]?.coordinates).toEqual([120, 630]);
    expect(ocrKeys).toHaveLength(0);
    expect(value.target_source).toBe("hierarchy");
  });

  it("resolves a textless screen off the frame, at the label box and not the row box", async () => {
    const tool = setup();
    hierarchies.push(CANVAS, CANVAS, CANVAS);
    const value = (await tool.execute(
      { action: "click", target: { text: "商店" }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    // parseOcrData's row box would be (605,673): the middle of an empty gap.
    expect(taps()[0]?.coordinates).toEqual([1150, 673]);
    expect(value.target_source).toBe("ocr");
    expect(ocrKeys).toEqual(["default"]);
  });

  it("does not fall through to OCR for an {index} the nodes cannot answer", async () => {
    const tool = setup();
    await observe(tool);
    hierarchies.push(CANVAS, CANVAS, CANVAS);
    await expect(
      tool.execute({ action: "click", target: { index: 1 }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/is no longer on device/);
    expect(ocrKeys).toHaveLength(0);
    expect(taps()).toHaveLength(0);
  });

  it("does not ask OCR about a coordinate target, and claims no source for it", async () => {
    const tool = setup();
    const value = (await tool.execute(
      { action: "click", target: { coordinate: [500, 500] }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(taps()[0]?.coordinates).toEqual([360, 800]);
    expect(ocrKeys).toHaveLength(0);
    expect(value.target_source).toBeUndefined();
  });

  it("keeps get_ui_hierarchy a nodes-only read", async () => {
    const tool = setup();
    hierarchies.push(CANVAS);
    await tool.execute({ action: "get_ui_hierarchy", reason: "t" }, exec() as never);
    expect(ocrKeys).toHaveLength(0);
  });

  it("asks about the device the call resolved to", async () => {
    const tool = setup({ devices: ["A", "B"] });
    hierarchies.push(CANVAS, CANVAS, CANVAS);
    await tool.execute(
      { action: "click", device_serial: "B", target: { text: "商店" }, reason: "t" },
      exec() as never,
    );
    expect(taps()[0]?.coordinates).toEqual([1150, 673]);
    expect(ocrKeys).toEqual(["B"]);
  });
});

describe("region OCR is the third source, reached only when the frame also missed", () => {
  /** What the region pass hands back: hits already expressed in frame coordinates. */
  const REGION_PAGE = ocrPage({
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                text: "商 城",
                confidence: 93,
                bbox: { x0: 500, y0: 1200, x1: 560, y1: 1250 },
                words: [word("商", 94, [500, 1200, 530, 1250]), word("城", 92, [530, 1200, 560, 1250])],
              },
            ],
          },
        ],
      },
    ],
    text: "商 城\n",
    confidence: 93,
  });

  it("does not ask the region pass what the nodes already answer", async () => {
    const tool = setup();
    await tool.execute({ action: "click", target: { text: "显示" }, reason: "t" }, exec() as never);
    expect(regionKeys).toHaveLength(0);
  });

  it("does not ask the region pass what the whole frame already answered (变异②的锁)", async () => {
    const tool = setup();
    hierarchies.push(CANVAS, CANVAS, CANVAS);
    const value = (await tool.execute(
      { action: "click", target: { text: "商店" }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(value.target_source).toBe("ocr");
    expect(ocrKeys).toHaveLength(1);
    // A ladder that always ran the region pass would still tap correctly here and
    // cost a second frame read - that is exactly what this assertion forbids.
    expect(regionKeys).toHaveLength(0);
  });

  it("taps where the region pass put the label, and says which source answered", async () => {
    const tool = setup();
    hierarchies.push(CANVAS, CANVAS, CANVAS);
    pages.push(undefined);
    regionPages.push(REGION_PAGE);
    const value = (await tool.execute(
      { action: "click", target: { text: "商城" }, reason: "t" },
      exec() as never,
    )) as Record<string, unknown>;
    expect(taps()[0]?.coordinates).toEqual([530, 1225]);
    expect(value.target_source).toBe("ocr-region");
    expect(ocrKeys).toHaveLength(1);
    expect(regionKeys).toEqual(["default"]);
  });

  it("reads the candidates off the same dump it just resolved against, not a second one", async () => {
    const tool = setup();
    hierarchies.push(CANVAS, CANVAS, CANVAS);
    pages.push(undefined);
    regionPages.push(REGION_PAGE);
    await tool.execute({ action: "click", target: { text: "商城" }, reason: "t" }, exec() as never);
    // CANVAS carries two bounded nodes; the region pass must see exactly those.
    expect(regionNodeCounts).toEqual([2]);
  });

  it("keeps the original refusal when the region pass also has nothing to say", async () => {
    const tool = setup();
    hierarchies.push(CANVAS, CANVAS, CANVAS);
    pages.push(undefined, undefined, undefined);
    await expect(
      tool.execute({ action: "click", target: { text: "商店" }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: no element matching text "商店" in the current hierarchy$/);
    expect(ocrKeys).toHaveLength(3);
    expect(regionKeys).toHaveLength(3);
    expect(taps()).toHaveLength(0);
  });

  it("behaves exactly as before when no region source is wired at all", async () => {
    const tool = setup({ regions: false });
    hierarchies.push(CANVAS, CANVAS, CANVAS);
    pages.push(undefined, undefined, undefined);
    await expect(
      tool.execute({ action: "click", target: { text: "商店" }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: no element matching text/);
    expect(ocrKeys).toHaveLength(3);
    expect(taps()).toHaveLength(0);
  });
});

describe("OCR says nothing", () => {
  it("leaves the pre-T5 refusal when there is no engine at all", async () => {
    const tool = setup({ ocr: false });
    hierarchies.push(CANVAS, CANVAS, CANVAS);
    await expect(
      tool.execute({ action: "click", target: { text: "商店" }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: no element matching text "商店" in the current hierarchy$/);
    expect(taps()).toHaveLength(0);
  });

  it("leaves the same refusal when the engine cannot read the frame, and the ladder runs out", async () => {
    const tool = setup();
    hierarchies.push(CANVAS, CANVAS, CANVAS);
    pages.push(undefined, undefined, undefined);
    await expect(
      tool.execute({ action: "click", target: { text: "商店" }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: no element matching text/);
    // One look at the screen per attempt: each attempt re-reads a screen that may
    // still be animating, and OCR reads the fresh frame, not a cached one.
    expect(ocrKeys).toHaveLength(3);
    expect(taps()).toHaveLength(0);
  });

  it("refuses an ambiguous page rather than tapping the nearest label", async () => {
    const tool = setup();
    hierarchies.push(CANVAS, CANVAS, CANVAS);
    pages.push(ocrPage(TWO_SHOPS), ocrPage(TWO_SHOPS), ocrPage(TWO_SHOPS));
    await expect(
      tool.execute({ action: "click", target: { text: "商店" }, reason: "t" }, exec() as never),
    ).rejects.toThrow(/^task: no element matching text/);
    expect(taps()).toHaveLength(0);
  });
});
