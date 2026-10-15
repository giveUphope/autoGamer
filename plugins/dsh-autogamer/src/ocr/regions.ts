/**
 * Region OCR ladder (G92 probe A, path P1).
 *
 * Measured in T5: a whole 1600x900 frame lets tesseract's layout analysis miss
 * small light CJK labels (0-3 of 24 read at every scale), while the same
 * label's 140x70 box cropped out and enlarged 2x reads cleanly. This module is
 * the "crop the hierarchy's candidate boxes, enlarge each, recognise each"
 * pipeline behind that finding.
 *
 * Scope honesty (TODO G92): P1 candidates come from hierarchy bounds, so P1
 * cannot cover a frame where the hierarchy has NO box over the text (a pure
 * WebView/canvas render area shows up as one full-screen container). That is
 * why the candidate filter rejects near-full-screen boxes and why probe C
 * (projection segmentation P2) stays open - this module is the P1 mechanism,
 * not the whole G92 answer.
 *
 * The ladder is wired ONLY when probes B/C fix the constants; this module
 * currently exposes the mechanism and is exercised offline.
 */
import type { HierarchyBounds, HierarchyNode } from "../device/hierarchy.js";
import { decodePng } from "../effect/png.js";
import { cropImage, encodePng, fromDecoded, paddedBox, upscaleNearest, type PixelBox, type RgbImage } from "./image.js";
import type { OcrBox, OcrEngine, OcrHit, OcrPage } from "./recognize.js";

export interface RegionOptions {
  /** Pixels added on every side of a candidate box before cropping. */
  paddingPx?: number;
  /** Nearest-neighbour enlargement applied to each crop. */
  scale?: number;
  /** Candidates covering at least this fraction of the frame are containers, not labels. */
  maxAreaRatio?: number;
  /** Hard cap on scanned regions; smaller boxes are scanned first. */
  maxRegions?: number;
  /** Overall wall-clock budget for the region scan (R15: our timeout, ours to keep). */
  totalBudgetMs?: number;
}

export const DEFAULT_REGION_OPTIONS: Required<RegionOptions> = {
  paddingPx: 8,
  scale: 2,
  maxAreaRatio: 0.25,
  maxRegions: 40,
  totalBudgetMs: 30_000,
};

export interface SelectedRegion {
  readonly box: PixelBox;
  readonly areaRatio: number;
  /** The node's text/content-desc, for logs only - never sent to OCR. */
  readonly label: string;
}

function boxArea(box: PixelBox): number {
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
}

function boxEquals(a: PixelBox, b: PixelBox): boolean {
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

function contains(outer: PixelBox, inner: PixelBox): boolean {
  return (
    outer.left <= inner.left &&
    outer.top <= inner.top &&
    outer.right >= inner.right &&
    outer.bottom >= inner.bottom
  );
}

/**
 * Turn hierarchy nodes into leaf-ish, label-sized candidate boxes.
 *
 * Rules, each mutation-proven: well-formed and non-empty; small enough not to
 * be a container (area ratio); duplicate boxes collapsed; a box that fully
 * contains another candidate is dropped (it is a parent, not a label).
 * Smaller boxes sort first, and the list is capped at `maxRegions`.
 */
export function selectRegionCandidates(
  nodes: readonly HierarchyNode[],
  frameWidth: number,
  frameHeight: number,
  options: RegionOptions = {},
): SelectedRegion[] {
  const maxAreaRatio = options.maxAreaRatio ?? DEFAULT_REGION_OPTIONS.maxAreaRatio;
  const maxRegions = options.maxRegions ?? DEFAULT_REGION_OPTIONS.maxRegions;
  const frameArea = frameWidth * frameHeight;
  const seen: PixelBox[] = [];
  const sized: { box: PixelBox; areaRatio: number; label: string }[] = [];
  for (const node of nodes) {
    const box = node.bounds as PixelBox | undefined;
    if (box === undefined) continue;
    if (box.right <= box.left || box.bottom <= box.top) continue;
    if (box.left < 0 || box.top < 0 || box.right > frameWidth || box.bottom > frameHeight) continue;
    const areaRatio = frameArea > 0 ? boxArea(box) / frameArea : 0;
    if (areaRatio <= 0 || areaRatio > maxAreaRatio) continue;
    if (seen.some((prior) => boxEquals(prior, box))) continue;
    seen.push(box);
    sized.push({
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      areaRatio,
      label: node.text || node.contentDesc || "",
    });
  }
  // Drop containers: a box fully containing another surviving candidate is a
  // parent. Ties in `contains` (identical boxes) were collapsed above.
  const leaves = sized.filter(
    (candidate) => !sized.some((other) => other !== candidate && contains(candidate.box, other.box)),
  );
  leaves.sort((a, b) => boxArea(a.box) - boxArea(b.box));
  return leaves.slice(0, maxRegions);
}

function mapBox(box: OcrBox, origin: PixelBox, cropW: number, cropH: number, outW: number, outH: number): OcrBox {
  const scaleX = outW > 0 ? cropW / outW : 1;
  const scaleY = outH > 0 ? cropH / outH : 1;
  return {
    left: Math.round(origin.left + box.left * scaleX),
    top: Math.round(origin.top + box.top * scaleY),
    right: Math.round(origin.left + box.right * scaleX),
    bottom: Math.round(origin.top + box.bottom * scaleY),
  };
}

function centerOf(box: OcrBox): { x: number; y: number } {
  return { x: Math.round((box.left + box.right) / 2), y: Math.round((box.top + box.bottom) / 2) };
}

/** Map one block-space OCR hit back into the original frame coordinate space. */
export function mapHitToFrame(
  hit: OcrHit,
  origin: PixelBox,
  cropW: number,
  cropH: number,
  outW: number,
  outH: number,
): OcrHit {
  const box = mapBox(hit.box, origin, cropW, cropH, outW, outH);
  const words = hit.words?.map((word) => {
    const wordBox = mapBox(word.box, origin, cropW, cropH, outW, outH);
    return { text: word.text, box: wordBox, confidence: word.confidence };
  });
  return {
    text: hit.text,
    confidence: hit.confidence,
    box,
    center: centerOf(box),
    ...(words === undefined ? {} : { words }),
  };
}

export interface RegionResult {
  /** All hits merged and expressed in frame coordinates. */
  readonly page: OcrPage;
  /** Candidate boxes scanned. */
  readonly regionCount: number;
  /** Regions that returned a page (others failed open). */
  readonly scannedCount: number;
  readonly ms: number;
}

export interface RegionDeps {
  now(): number;
  logger?: { warn(message: string): void; info?(message: string): void };
}

/**
 * Crop every candidate box, enlarge it, OCR it, and merge the hits back into
 * frame coordinates. Undefined means the region scan had nothing to say
 * (undecodable frame, no candidates, every block failed) - it never throws for
 * OCR or image reasons, in line with the whole-frame OCR fail-open contract.
 */
export async function recognizeRegions(
  engine: Pick<OcrEngine, "recognize">,
  framePng: Buffer,
  nodes: readonly HierarchyNode[],
  options: RegionOptions = {},
  deps: RegionDeps = { now: () => Date.now() },
  signal?: AbortSignal,
): Promise<RegionResult | undefined> {
  const paddingPx = options.paddingPx ?? DEFAULT_REGION_OPTIONS.paddingPx;
  const scale = options.scale ?? DEFAULT_REGION_OPTIONS.scale;
  const totalBudgetMs = options.totalBudgetMs ?? DEFAULT_REGION_OPTIONS.totalBudgetMs;
  const startedAt = deps.now();

  let frame: RgbImage;
  try {
    frame = fromDecoded(decodePng(framePng));
  } catch (error) {
    deps.logger?.warn(`[ocr-region] frame not decodable: ${(error as Error)?.message ?? error}`);
    return undefined;
  }
  const candidates = selectRegionCandidates(nodes, frame.width, frame.height, options);
  if (candidates.length === 0) {
    deps.logger?.warn("[ocr-region] no leaf-sized candidate boxes in the hierarchy; P1 cannot add anything");
    return undefined;
  }

  const mergedHits: OcrHit[] = [];
  let scannedCount = 0;
  let confidence = 0;
  let confidenceSeen = false;

  for (const candidate of candidates) {
    if (signal?.aborted) break;
    if (deps.now() - startedAt >= totalBudgetMs) {
      deps.logger?.warn(
        `[ocr-region] budget ${totalBudgetMs}ms exhausted after ${scannedCount}/${candidates.length} regions`,
      );
      break;
    }
    const origin = paddedBox(frame, candidate.box, paddingPx);
    if (origin === undefined) continue;
    const crop = cropImage(frame, origin);
    if (crop === undefined) continue;
    const enlarged = upscaleNearest(crop, scale);
    const png = encodePng(enlarged);
    let page;
    try {
      page = await engine.recognize(png, { signal });
    } catch (error) {
      // One block must not sink the whole region scan (same fail-open contract
      // as the whole-frame path; the engine itself also returns undefined).
      deps.logger?.warn(
        `[ocr-region] block [${origin.left},${origin.top}][${origin.right},${origin.bottom}] failed: ${(error as Error)?.message ?? error}`,
      );
      continue;
    }
    if (page === undefined) continue;
    scannedCount += 1;
    if (!confidenceSeen || page.confidence < confidence) confidence = page.confidence;
    confidenceSeen = true;
    for (const hit of page.hits) {
      mergedHits.push(
        mapHitToFrame(hit, origin, crop.width, crop.height, enlarged.width, enlarged.height),
      );
    }
  }

  if (scannedCount === 0) {
    deps.logger?.warn("[ocr-region] every candidate block failed open");
    return undefined;
  }
  const ms = deps.now() - startedAt;
  const page: OcrPage = {
    hits: mergedHits,
    text: mergedHits.map((hit) => hit.text).join("\n"),
    confidence,
    ms,
  };
  return { page, regionCount: candidates.length, scannedCount, ms };
}
