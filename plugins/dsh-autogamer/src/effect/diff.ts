/**
 * Effect judgement for `run_device_action` (T3 / G84 slice 1).
 *
 * This is the TypeScript re-implementation of the python `check_ui_change` path
 * that used to be reached through the external action server's
 * `compare_ui_frames`. Only its *design* was read (archive blob, constants and
 * branch structure recorded in TODO section 七 "前置-3 实测结论"); no text was
 * carried over. Every constant below cites the function / constant name it came
 * from so the port stays checkable.
 *
 * Semantics kept from that design:
 *   - two frames are compared in greyscale; colour and alpha are dropped;
 *   - the status bar (top 10%) and navigation bar (bottom 5%) are cropped away
 *     before the global comparison, because they animate on their own;
 *   - the global pipeline blurs the absolute difference with a 5x5 gaussian
 *     (sigma 1.1 - cv2 derives it from the kernel size) and binarizes at 25;
 *   - the ROI pipeline works on the UNcropped frame, uses a 3x3 gaussian
 *     (sigma 0.8) and binarizes at 20 (more sensitive), and its threshold is
 *     500x the global one: only a sizeable local change counts there;
 *   - an ROI that misses the threshold does NOT mean "unchanged" - it falls
 *     back to the global comparison (the two-level gate, easiest step to lose);
 *   - only swipe always goes straight to the global comparison; the tap family
 *     goes through ROI first when a pixel pair is available;
 *   - a decode failure is fail-open: the layer above treats `undefined` as "no
 *     verdict" and neither retries nor counts an incident.
 */
import { decodePng, type DecodedFrame } from "./png.js";

export interface EffectThresholds {
  /** `full_screen_threshold` in the python source; 1e-4 of the content area. */
  fullScreen: number;
  /** `roi_threshold` in the python source; 0.05 of the ROI area. */
  roi: number;
}

export const DEFAULT_THRESHOLDS: EffectThresholds = { fullScreen: 1e-4, roi: 0.05 };

/** Global pipeline constants: `check_ui_change` / `_images_differ`. */
const GLOBAL_BINARY_THRESHOLD = 25;
const GLOBAL_BLUR_KERNEL = 5;
/** cv2 derives sigma from the kernel size: 0.3*((k-1)*0.5-1)+0.8 -> 1.1 at k=5. */
const GLOBAL_BLUR_SIGMA = 1.1;
/** Status bar / navigation bar fractions cropped before the global comparison. */
const STATUS_BAR_FRACTION = 0.1;
const NAV_BAR_FRACTION = 0.05;
/** ROI pipeline constants: same source, different threshold pair. */
const ROI_BINARY_THRESHOLD = 20;
const ROI_BLUR_KERNEL = 3;
const ROI_BLUR_SIGMA = 0.8;
/** `roi_size = max(15, int(50 * scale))`, scale against a 1080x2400 diagonal. */
const REFERENCE_DIAGONAL = Math.hypot(1080, 2400);
const ROI_MIN_HALF = 15;
const ROI_HALF_BASE = 50;
const ROI_ACTIONS = new Set(["tap", "long_press_on", "focus_and_input_text", "focus_and_clear_text"]);

function toGray(frame: DecodedFrame): Float64Array {
  const { width, height, rgb } = frame;
  const gray = new Float64Array(width * height);
  // 0.299/0.587/0.114 is cv2's colour-to-grey weighting; fixed-point rounding in
  // the python side can differ by one level, which the blur and thresholds absorb.
  for (let p = 0; p < gray.length; p++) {
    gray[p] = 0.299 * rgb[p * 3]! + 0.587 * rgb[p * 3 + 1]! + 0.114 * rgb[p * 3 + 2]!;
  }
  return gray;
}

/** Mirrors cv2's BORDER_REFLECT_101: the edge pixel is not repeated. */
function reflect101(i: number, n: number): number {
  if (n === 1) return 0;
  let x = i;
  while (x < 0) x = -x;
  while (x >= n) x = 2 * n - 2 - x;
  return x;
}

function kernel1d(size: number, sigma: number): Float64Array {
  const kernel = new Float64Array(size);
  const half = (size - 1) / 2;
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const d = i - half;
    kernel[i] = Math.exp(-(d * d) / (2 * sigma * sigma));
    sum += kernel[i]!;
  }
  for (let i = 0; i < size; i++) kernel[i] = kernel[i]! / sum;
  return kernel;
}

/** Separable gaussian blur over a width x height float plane. */
function blur(src: Float64Array, width: number, height: number, size: number, sigma: number): Float64Array {
  const kernel = kernel1d(size, sigma);
  const half = (size - 1) / 2;
  const horizontal = new Float64Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < size; k++) {
        acc += kernel[k]! * src[row + reflect101(x + k - half, width)]!;
      }
      horizontal[row + x] = acc;
    }
  }
  const out = new Float64Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < size; k++) {
        acc += kernel[k]! * horizontal[reflect101(y + k - half, height) * width + x]!;
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

/**
 * Counts binarized differences inside a window and compares the fraction of the
 * window area against a threshold. `crop` is expressed in rows and applies to
 * the window's own coordinate system.
 */
function differs(
  before: Float64Array,
  after: Float64Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  binaryThreshold: number,
  size: number,
  sigma: number,
  threshold: number,
): boolean {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return false;
  const diff = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = (y0 + y) * width + (x0 + x);
      diff[y * w + x] = Math.abs(before[at]! - after[at]!);
    }
  }
  const blurred = blur(diff, w, h, size, sigma);
  let changed = 0;
  for (let i = 0; i < blurred.length; i++) {
    if (blurred[i]! > binaryThreshold) changed++;
  }
  return changed / (w * h) > threshold;
}

function globalChanged(before: Float64Array, after: Float64Array, frame: DecodedFrame, threshold: number): boolean {
  const top = Math.trunc(frame.height * STATUS_BAR_FRACTION);
  const bottom = frame.height - Math.trunc(frame.height * NAV_BAR_FRACTION);
  return differs(
    before,
    after,
    frame.width,
    0,
    top,
    frame.width,
    bottom,
    GLOBAL_BINARY_THRESHOLD,
    GLOBAL_BLUR_KERNEL,
    GLOBAL_BLUR_SIGMA,
    threshold,
  );
}

function roiChanged(
  before: Float64Array,
  after: Float64Array,
  frame: DecodedFrame,
  centerX: number,
  centerY: number,
  threshold: number,
): boolean {
  const scale = Math.hypot(frame.width, frame.height) / REFERENCE_DIAGONAL;
  const half = Math.max(ROI_MIN_HALF, Math.trunc(ROI_HALF_BASE * scale));
  // The ROI comes out of the raw frame (not the bar-cropped one) and is clamped
  // to the canvas on all four sides.
  const x0 = Math.max(0, Math.min(frame.width - 1, Math.trunc(centerX) - half));
  const y0 = Math.max(0, Math.min(frame.height - 1, Math.trunc(centerY) - half));
  const x1 = Math.max(0, Math.min(frame.width, Math.trunc(centerX) + half));
  const y1 = Math.max(0, Math.min(frame.height, Math.trunc(centerY) + half));
  return differs(before, after, frame.width, x0, y0, x1, y1, ROI_BINARY_THRESHOLD, ROI_BLUR_KERNEL, ROI_BLUR_SIGMA, threshold);
}

/**
 * The effect verdict for one action: `true` changed, `false` unchanged,
 * `undefined` when no verdict could be produced (bad bytes, unsupported frame
 * shape, mismatched sizes). Callers treat `undefined` as fail-open.
 */
export function judgeEffectChanged(
  beforeBytes: Uint8Array,
  afterBytes: Uint8Array,
  action: string,
  coordinates?: readonly number[],
  thresholds: EffectThresholds = DEFAULT_THRESHOLDS,
): boolean | undefined {
  let before: DecodedFrame;
  let after: DecodedFrame;
  try {
    before = decodePng(beforeBytes);
    after = decodePng(afterBytes);
  } catch {
    return undefined;
  }
  if (before.width !== after.width || before.height !== after.height) return undefined;
  const grayBefore = toGray(before);
  const grayAfter = toGray(after);
  if (action !== "swipe" && ROI_ACTIONS.has(action) && coordinates?.length === 2) {
    // ROI first, but a miss is not a verdict: fall through to the global gate.
    if (roiChanged(grayBefore, grayAfter, before, coordinates[0]!, coordinates[1]!, thresholds.roi)) {
      return true;
    }
  }
  return globalChanged(grayBefore, grayAfter, before, thresholds.fullScreen);
}