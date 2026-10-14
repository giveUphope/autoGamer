/**
 * Effect-diff locks (T3 / G84 slice 1).
 *
 * Cases 1-5 are the discrimination set recorded from the python design
 * (TODO section 七, 前置-3 "H"); cases 6-7 were added here because 1-5 alone do
 * not pin two decisions the port must keep: that the ROI is cut from the
 * UNcropped frame, and that an ROI miss falls back to the global gate rather
 * than answering "unchanged" itself. Expectations come from the documented
 * semantics, not from re-running this implementation.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, judgeEffectChanged } from "../src/effect/diff.js";
import { decodePng } from "../src/effect/png.js";
import { encodePng, frame } from "./support/pngEncode.js";

const BASE = 32;
const UP = 96;

describe("effect diff: the five cases recorded from the python design", () => {
  it("case 1: a frame against itself is unchanged", () => {
    const png = frame(400, 300, BASE);
    expect(judgeEffectChanged(png, png, "swipe")).toBe(false);
  });

  it("case 2: a whole-screen change with swipe is changed", () => {
    const before = frame(400, 300, BASE);
    const after = frame(400, 300, UP);
    expect(judgeEffectChanged(before, after, "swipe")).toBe(true);
  });

  it("case 3: a centred block under a tap is changed through the ROI", () => {
    const before = frame(1000, 1000, BASE);
    const after = frame(1000, 1000, BASE, [{ x: 480, y: 480, width: 40, height: 40, level: 255 }]);
    expect(judgeEffectChanged(before, after, "tap", [500, 500])).toBe(true);
  });

  it("case 4: a change confined to the status bar rows is unchanged", () => {
    const before = frame(1080, 2400, BASE);
    const after = frame(1080, 2400, BASE, [{ x: 0, y: 0, width: 1080, height: 50, level: 255 }]);
    expect(judgeEffectChanged(before, after, "swipe")).toBe(false);
  });

  it("case 5: an ROI below its gate falls back to the global one and can still be unchanged", () => {
    const before = frame(1080, 2400, BASE);
    const after = frame(1080, 2400, BASE, [{ x: 535, y: 1195, width: 10, height: 10, level: 255 }]);
    // ROI share is 100/10000 = 0.01, below 0.05; the global share is ~4.5e-5,
    // below the raised 1e-3 gate. This is the case that pins the fallback.
    expect(judgeEffectChanged(before, after, "tap", [540, 1200], { fullScreen: 1e-3, roi: 0.05 })).toBe(false);
  });
});

describe("effect diff: the two decisions those cases leave open", () => {
  it("the ROI is cut from the uncropped frame (a change inside the status bar still fires)", () => {
    const before = frame(1080, 2400, BASE);
    const after = frame(1080, 2400, BASE, [{ x: 500, y: 100, width: 80, height: 40, level: 255 }]);
    // A pipeline that cropped first would clamp the ROI away and answer false.
    expect(judgeEffectChanged(before, after, "tap", [540, 120])).toBe(true);
  });

  it("an ROI miss falls back to the global gate, which can still say changed", () => {
    const before = frame(1080, 2400, BASE);
    const after = frame(1080, 2400, BASE, [{ x: 525, y: 1185, width: 30, height: 30, level: 255 }]);
    // ROI share is 900/10000 = 0.09: above the default gate, so the raised ROI
    // threshold is what forces the miss here; the global share ~4e-4 then passes.
    expect(judgeEffectChanged(before, after, "tap", [540, 1200], { fullScreen: 1e-4, roi: 0.5 })).toBe(true);
  });

  it("the bar mask does not swallow changes below the bar", () => {
    const before = frame(1080, 2400, BASE);
    const after = frame(1080, 2400, BASE, [{ x: 0, y: 300, width: 1080, height: 40, level: 255 }]);
    expect(judgeEffectChanged(before, after, "swipe")).toBe(true);
  });
});

describe("effect diff: fail-open and decode behaviour", () => {
  const usable = frame(120, 90, BASE);

  it("answers no verdict for garbage, truncated or unsupported frames", () => {
    expect(judgeEffectChanged(Uint8Array.from([1, 2, 3]), usable, "swipe")).toBeUndefined();
    // Cut into IDAT: a frame missing only its IEND still carries every scanline
    // and is decoded, which is harmless - the byte checks that matter are the
    // signature, the chunk bounds and the scanline length.
    expect(judgeEffectChanged(usable.subarray(0, usable.length - 20), usable, "swipe")).toBeUndefined();
    const grey = encodePng(4, 4, new Uint8Array(16).fill(200), 0);
    expect(judgeEffectChanged(grey, grey, "swipe")).toBeUndefined();
  });

  it("answers no verdict when the two frames differ in size", () => {
    expect(judgeEffectChanged(frame(120, 90, BASE), frame(60, 90, BASE), "swipe")).toBeUndefined();
  });

  it("decodes RGBA frames and drops alpha", () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let p = 0; p < 16; p++) {
      rgba[p * 4] = 10;
      rgba[p * 4 + 1] = 20;
      rgba[p * 4 + 2] = 30;
      rgba[p * 4 + 3] = 0; // fully transparent, still three-channel after decode
    }
    const decoded = decodePng(encodePng(4, 4, rgba, 6));
    expect([decoded.width, decoded.height]).toEqual([4, 4]);
    expect(Array.from(decoded.rgb.subarray(0, 3))).toEqual([10, 20, 30]);
  });

  it("defaults stay the python pair", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ fullScreen: 1e-4, roi: 0.05 });
  });
});