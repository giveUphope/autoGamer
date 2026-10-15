/**
 * G92 probe A, region pipeline (P1): candidate selection, crop+enlarge+encode
 * into the recognizer, and mapping block-space hits back into frame space.
 *
 * The recognizer is a fake recording the PNG size it received, so the geometry
 * is locked without loading WASM; the real engine runs in ocrRegionProbe.spec.
 */
import { describe, expect, it } from "vitest";
import { parseImageSize } from "../src/coord.js";
import type { HierarchyBounds, HierarchyNode } from "../src/device/hierarchy.js";
import { encodePng, type RgbImage } from "../src/ocr/image.js";
import {
  mapHitToFrame,
  recognizeRegions,
  selectRegionCandidates,
  type RegionOptions,
} from "../src/ocr/regions.js";
import type { OcrHit, OcrPage } from "../src/ocr/recognize.js";

function node(bounds?: [number, number, number, number], extra: Partial<HierarchyNode> = {}): HierarchyNode {
  const b: HierarchyBounds | undefined =
    bounds === undefined ? undefined : { left: bounds[0], top: bounds[1], right: bounds[2], bottom: bounds[3] };
  return {
    depth: 0,
    text: "",
    contentDesc: "",
    resourceId: "",
    class: "android.view.View",
    package: "com.example",
    ...(b === undefined ? {} : { bounds: b }),
    clickable: false,
    longClickable: false,
    enabled: true,
    scrollable: false,
    focused: false,
    selected: false,
    checked: false,
    password: false,
    ...extra,
  };
}

function solidFrame(width = 100, height = 100): Buffer {
  const image: RgbImage = { width, height, rgb: new Uint8Array(width * height * 3) };
  return encodePng(image);
}

function hit(text: string, box: [number, number, number, number], confidence = 90): OcrHit {
  return {
    text,
    confidence,
    box: { left: box[0], top: box[1], right: box[2], bottom: box[3] },
    center: { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 },
  };
}

function pageWith(hits: OcrHit[], confidence = 90): OcrPage {
  return { hits, text: hits.map((h) => h.text).join(" "), confidence, ms: 5 };
}

function fakeEngine(page: OcrPage | undefined) {
  const received: { width: number; height: number }[] = [];
  return {
    received,
    recognize: async (png: Buffer) => {
      const size = parseImageSize(png);
      received.push({ width: size?.width ?? 0, height: size?.height ?? 0 });
      return page;
    },
  };
}

describe("selectRegionCandidates", () => {
  const W = 1000;
  const H = 1000;

  it("keeps leaf-sized boxes and reports area ratios", () => {
    const selected = selectRegionCandidates(
      [node([10, 10, 110, 60], { text: "游戏中心" })],
      W,
      H,
    );
    expect(selected.map((r) => r.box)).toEqual([{ left: 10, top: 10, right: 110, bottom: 60 }]);
    expect(selected[0]!.areaRatio).toBeCloseTo(0.005, 5);
  });

  it("rejects missing, empty, out-of-frame and near-full-screen boxes", () => {
    const selected = selectRegionCandidates(
      [
        node(undefined),
        node([10, 10, 10, 60]), // zero width
        node([-5, 10, 50, 60]), // crosses the left edge
        node([0, 0, 1000, 1000]), // full-screen container
        node([0, 0, 800, 900]), // 72% of the frame, container-sized
      ],
      W,
      H,
    );
    expect(selected).toEqual([]);
  });

  it("drops a container that fully contains another candidate and collapses duplicates", () => {
    const selected = selectRegionCandidates(
      [
        node([10, 10, 200, 200], { text: "container" }),
        node([20, 30, 100, 90], { text: "label" }),
        node([20, 30, 100, 90], { text: "label-duplicate" }),
      ],
      W,
      H,
    );
    expect(selected.map((r) => r.box)).toEqual([{ left: 20, top: 30, right: 100, bottom: 90 }]);
  });

  it("scans smaller boxes first and caps the count", () => {
    // Non-overlapping boxes so the container rule does not remove them.
    const nodes = [
      node([200, 200, 400, 400]),
      node([0, 0, 20, 20]),
      node([30, 30, 130, 130]),
    ];
    const selected = selectRegionCandidates(nodes, W, H, { maxRegions: 2 });
    expect(selected).toHaveLength(2);
    expect(selected.map((r) => r.box)).toEqual([
      { left: 0, top: 0, right: 20, bottom: 20 },
      { left: 30, top: 30, right: 130, bottom: 130 },
    ]);
  });
});

describe("mapHitToFrame", () => {
  it("adds the crop origin and divides out the enlargement", () => {
    // crop origin (10,20), crop 20x20, enlarged 40x40 (scale 2).
    const mapped = mapHitToFrame(hit("游戏", [4, 6, 8, 10]), { left: 10, top: 20, right: 30, bottom: 40 }, 20, 20, 40, 40);
    expect(mapped.box).toEqual({ left: 12, top: 23, right: 14, bottom: 25 });
    expect(mapped.center).toEqual({ x: 13, y: 24 });
  });

  it("maps nested word boxes as well", () => {
    const line: OcrHit = {
      ...hit("游戏", [0, 0, 40, 20]),
      words: [{ text: "游", confidence: 92, box: { left: 0, top: 0, right: 20, bottom: 20 } }],
    };
    const mapped = mapHitToFrame(line, { left: 10, top: 10, right: 30, bottom: 30 }, 20, 20, 40, 40);
    expect(mapped.words?.[0]?.box).toEqual({ left: 10, top: 10, right: 20, bottom: 20 });
  });
});

describe("recognizeRegions", () => {
  const options: RegionOptions = { paddingPx: 0, scale: 2, maxRegions: 10 };

  it("crops each candidate, enlarges it, and maps the hit back into frame space", async () => {
    const engine = fakeEngine(pageWith([hit("游戏", [2, 2, 4, 4])]));
    // candidate [10,10][40,30] -> crop 30x20 -> enlarged 60x40.
    const result = await recognizeRegions(
      engine,
      solidFrame(100, 100),
      [node([10, 10, 40, 30])],
      options,
    );
    expect(result).toBeDefined();
    expect(result!.regionCount).toBe(1);
    expect(result!.scannedCount).toBe(1);
    expect(engine.received[0]).toEqual({ width: 60, height: 40 });
    // block (2,2)-(4,4) at scale 2 -> frame (11,11)-(12,12).
    expect(result!.page.hits[0]!.box).toEqual({ left: 11, top: 11, right: 12, bottom: 12 });
    expect(result!.page.hits[0]!.center).toEqual({ x: 12, y: 12 });
  });

  it("pads the crop before enlarging", async () => {
    const engine = fakeEngine(pageWith([]));
    // candidate [10,10][40,30] with 8px padding -> origin [2,2][48,38] -> 46x36 -> 92x72.
    await recognizeRegions(engine, solidFrame(100, 100), [node([10, 10, 40, 30])], {
      paddingPx: 8,
      scale: 2,
    });
    expect(engine.received[0]).toEqual({ width: 92, height: 72 });
  });

  it("returns undefined when there is no leaf candidate (P1 cannot cover a bare canvas)", async () => {
    const engine = fakeEngine(pageWith([hit("x", [0, 0, 2, 2])]));
    const result = await recognizeRegions(engine, solidFrame(), [node([0, 0, 100, 100])], options);
    expect(result).toBeUndefined();
    expect(engine.received).toEqual([]);
  });

  it("fails open when every block recognition fails", async () => {
    const engine = fakeEngine(undefined);
    const result = await recognizeRegions(engine, solidFrame(), [node([10, 10, 40, 30])], options);
    expect(result).toBeUndefined();
  });

  it("skips a block that throws and still scans the rest", async () => {
    const pages = [undefined, pageWith([hit("x", [0, 0, 2, 2])])];
    let i = 0;
    const engine = {
      received: [],
      recognize: async (png: Buffer) => {
        const size = parseImageSize(png);
        const index = i;
        i += 1;
        if (index === 0) throw new Error("wasm crashed");
        return pages[1];
      },
    };
    const result = await recognizeRegions(
      engine,
      solidFrame(),
      [node([0, 0, 10, 10]), node([30, 30, 60, 60])],
      options,
    );
    expect(result).toBeDefined();
    expect(result!.scannedCount).toBe(1);
    expect(result!.page.hits).toHaveLength(1);
  });

  it("fails open on an undecodable frame", async () => {
    const engine = fakeEngine(pageWith([hit("x", [0, 0, 2, 2])]));
    const result = await recognizeRegions(engine, Buffer.from("not a png"), [node([10, 10, 40, 30])], options);
    expect(result).toBeUndefined();
  });

  it("stops once the wall-clock budget is exhausted", async () => {
    const engine = fakeEngine(pageWith([hit("x", [0, 0, 2, 2])]));
    let t = 0;
    const deps = { now: () => t };
    const promise = recognizeRegions(
      engine,
      solidFrame(),
      [node([0, 0, 10, 10]), node([20, 20, 30, 30]), node([40, 40, 50, 50])],
      { ...options, totalBudgetMs: 100 },
      deps,
    );
    // Advance past the budget after the first block would have started.
    t = 200;
    const result = await promise;
    expect(result).toBeDefined();
    // First block is scanned; the budget check blocks the remaining two.
    expect(result!.scannedCount).toBe(1);
    expect(result!.regionCount).toBe(3);
  });

  it("honours an already-aborted signal", async () => {
    const engine = fakeEngine(pageWith([hit("x", [0, 0, 2, 2])]));
    const controller = new AbortController();
    controller.abort();
    const result = await recognizeRegions(
      engine,
      solidFrame(),
      [node([0, 0, 10, 10])],
      options,
      undefined,
      controller.signal,
    );
    expect(result).toBeUndefined();
  });
});
