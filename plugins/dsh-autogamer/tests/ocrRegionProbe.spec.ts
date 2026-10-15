/**
 * G92 probe A, real-engine run over the only fixture frame
 * (Chrome tab overview, 1600x900, with its hierarchy dump).
 *
 * Two findings are locked here, not just the happy path:
 *
 *  1. The P1 pipeline runs end to end with the real WASM engine: every leaf
 *     candidate is cropped, enlarged, recognised and merged, and every hit's
 *     frame-space point lands back inside one of the candidate boxes.
 *  2. The scope boundary is real on this very frame: the labels the whole
 *     frame reads (`TapTap`/`游戏中心` at y~240) live in the rendered
 *     thumbnail area, where the hierarchy exposes ONLY a full-screen
 *     container - so P1's leaf filter has no box over them and P1 cannot
 *     find them. That is the documented reason P2/P3 (projection / grid)
 *     stay open, not a defect in this pipeline.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseHierarchyXml } from "../src/device/hierarchy.js";
import { paddedBox } from "../src/ocr/image.js";
import { createOcrEngine, chooseHitPoint, findNeedleHits, type OcrEngine } from "../src/ocr/recognize.js";
import { recognizeRegions, selectRegionCandidates } from "../src/ocr/regions.js";

const ROOT = new URL("../", import.meta.url);
const FRAME = fileURLToPath(new URL("tests/fixtures/screen-chrome-tab-overview.png", ROOT));
const XML = fileURLToPath(new URL("tests/fixtures/hierarchy-chrome.xml", ROOT));
const FRAME_WIDTH = 1600;
const FRAME_HEIGHT = 900;
const PADDING = 8;
const SCALE = 2;

describe("P1 region OCR on the real engine (G92 probe A)", () => {
  let engine: OcrEngine | undefined;
  const frame = readFileSync(FRAME);
  const xml = readFileSync(XML, "utf8");

  beforeAll(async () => {
    engine = createOcrEngine();
  }, 60_000);
  afterAll(async () => {
    await engine?.dispose();
  });

  it("scans every leaf candidate and maps hits back inside their boxes", async () => {
    const doc = parseHierarchyXml(xml);
    expect(doc).toBeDefined();
    const candidates = selectRegionCandidates(doc!.nodes, FRAME_WIDTH, FRAME_HEIGHT, {
      paddingPx: PADDING,
      scale: SCALE,
    });
    // Measured: the hierarchy's small boxes are all in the toolbar/tab strip
    // (y <= 204); the thumbnail render area below has only a full-screen node.
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.box.bottom).toBeLessThanOrEqual(240);
    }
    const origins = candidates
      .map((c) => paddedBox({ width: FRAME_WIDTH, height: FRAME_HEIGHT, rgb: new Uint8Array(0) }, c.box, PADDING))
      .filter((b): b is NonNullable<typeof b> => b !== undefined);

    const result = await recognizeRegions(
      engine!,
      frame,
      doc!.nodes,
      { paddingPx: PADDING, scale: SCALE, maxRegions: 40 },
    );
    expect(result).toBeDefined();
    expect(result!.scannedCount).toBe(result!.regionCount);
    expect(result!.regionCount).toBe(candidates.length);

    // Every mapped hit must sit inside the padded box that produced it - the
    // end-to-end proof that crop origin and scale division are right.
    for (const hit of result!.page.hits) {
      const inside = origins.some(
        (o) =>
          hit.center.x >= o.left &&
          hit.center.x <= o.right &&
          hit.center.y >= o.top &&
          hit.center.y <= o.bottom,
      );
      expect(inside, `${hit.text} at ${JSON.stringify(hit.center)} is outside every candidate box`).toBe(true);
    }
  }, 120_000);

  it("cannot see the render-area labels the whole frame reads (the P1 boundary)", async () => {
    const doc = parseHierarchyXml(xml);
    const regionResult = await recognizeRegions(
      engine!,
      frame,
      doc!.nodes,
      { paddingPx: PADDING, scale: SCALE, maxRegions: 40 },
    );
    expect(regionResult).toBeDefined();
    // The hierarchy has no leaf box over y~240, so P1 cannot resolve these.
    expect(chooseHitPoint(findNeedleHits(regionResult!.page, "TapTap"))).toBeUndefined();
    expect(chooseHitPoint(findNeedleHits(regionResult!.page, "游戏中心"))).toBeUndefined();

    // The whole frame does read them (locked by ocrPackaging.spec too) - the
    // pair together is what proves the bound is candidate coverage, not the
    // recognizer or the coordinate mapping.
    const whole = await engine!.recognize(frame);
    expect(chooseHitPoint(findNeedleHits(whole!, "TapTap"))).toEqual({ x: 1206, y: 241 });
    expect(chooseHitPoint(findNeedleHits(whole!, "游戏中心"))).toEqual({ x: 1003, y: 240 });
  }, 120_000);
});
