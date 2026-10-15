/**
 * G92 synthetic hard frame: the mechanism regression.
 *
 * What this locks, and what it deliberately does not: the shipped fixture runs
 * "whole frame is a superset of what a region scan finds" - every label a region
 * reads, the whole frame reads too. So it can never show the thing G92 is about
 * (region finds what the whole frame misses). `scripts/synth-hard-frame.mjs`
 * builds a frame that does, by pasting a known label at its ORIGINAL size into a
 * busy background: the whole-frame miss then comes from page layout analysis,
 * which is the bottleneck T5 identified, not from destroyed pixels.
 *
 * The two assertions are a PAIR and neither is enough alone:
 *
 *  1. the frame really is hard - whole-frame recognition finds nothing for the
 *     needle. Without this, a frame that happens to be readable everywhere would
 *     make assertion 2 meaningless;
 *  2. the region pipeline recovers it - the region scan hits, and the point
 *     mapped back to frame space lands INSIDE the single candidate that produced
 *     it, which is the end-to-end proof of crop origin + scale division.
 *
 * It also pins the default parameters (padding 8, scale 2) against this harder
 * input: the generator's --scan table shows scale 1.5 misses at every padding, so
 * setting the default there must redden this lock (changelogs: that mutation is
 * the point - it turns a scan result into a criterion instead of a note).
 *
 * NOT a recall number. Device recall remains probe B / probe C's job; this only
 * shows the mechanism can work when the page analyser gives up.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseHierarchyXml } from "../src/device/hierarchy.js";
import { paddedBox } from "../src/ocr/image.js";
import { createOcrEngine, chooseHitPoint, findNeedleHits, type OcrEngine } from "../src/ocr/recognize.js";
import { DEFAULT_REGION_OPTIONS, recognizeRegions, selectRegionCandidates } from "../src/ocr/regions.js";

const ROOT = new URL("../", import.meta.url);
const FRAME = fileURLToPath(new URL("tests/fixtures/screen-synth-hard.png", ROOT));
const XML = fileURLToPath(new URL("tests/fixtures/hierarchy-synth-hard.xml", ROOT));
const FRAME_WIDTH = 1600;
const FRAME_HEIGHT = 900;
const NEEDLE = "游戏中心";
/** The leaf the synthetic hierarchy declares over the pasted label. */
const LABEL_BOX = { left: 620, top: 430, right: 800, bottom: 482 };

describe("synthetic hard frame: whole frame misses, region scan recovers (G92)", () => {
  let engine: OcrEngine | undefined;
  const frame = readFileSync(FRAME);
  const xml = readFileSync(XML, "utf8");

  beforeAll(async () => {
    engine = createOcrEngine();
  }, 60_000);
  afterAll(async () => {
    await engine?.dispose();
  });

  it("is a hard frame: whole-frame recognition finds no needle", async () => {
    const whole = await engine!.recognize(frame);
    expect(chooseHitPoint(findNeedleHits(whole!, NEEDLE))).toBeUndefined();
  }, 120_000);

  it("recovers it through one region candidate, mapped back inside that box", async () => {
    const doc = parseHierarchyXml(xml);
    expect(doc).toBeDefined();
    // The shipped defaults, not literals: this file must exercise the path the
    // product will actually take. (It did not at first - the options were spelled
    // out here, so retuning DEFAULT_REGION_OPTIONS could not have moved this lock
    // at all. See the changelog: the first scale mutation stayed green and that is
    // how the bug was found.)
    const { paddingPx, scale, maxRegions } = DEFAULT_REGION_OPTIONS;
    const candidates = selectRegionCandidates(doc!.nodes, FRAME_WIDTH, FRAME_HEIGHT, { paddingPx, scale });
    // Exactly one: the full-screen root must be dropped by the candidate filter,
    // otherwise this file would be measuring something other than P1.
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.box).toEqual(LABEL_BOX);

    const result = await recognizeRegions(engine!, frame, doc!.nodes, { paddingPx, scale, maxRegions });
    expect(result).toBeDefined();
    expect(result!.regionCount).toBe(1);

    const hit = chooseHitPoint(findNeedleHits(result!.page, NEEDLE));
    expect(hit, "region scan found no needle in the one candidate").toBeDefined();

    // The mapping proof: back in frame space the point must sit inside the padded
    // box that produced it.
    const padded = paddedBox(
      { width: FRAME_WIDTH, height: FRAME_HEIGHT, rgb: new Uint8Array(0) },
      candidates[0]!.box,
      paddingPx,
    );
    expect(padded).toBeDefined();
    expect(hit!.x).toBeGreaterThanOrEqual(padded!.left);
    expect(hit!.x).toBeLessThanOrEqual(padded!.right);
    expect(hit!.y).toBeGreaterThanOrEqual(padded!.top);
    expect(hit!.y).toBeLessThanOrEqual(padded!.bottom);
  }, 120_000);
});
