/**
 * G92 probe A's image primitives: crop, nearest-neighbour enlargement and a
 * PNG encoder. The encoder is locked by a pixel-exact round trip through the
 * existing decoder - an encode/decode cycle is the whole reason these exist
 * (tesseract's recognizer accepts only a PNG buffer).
 */
import { describe, expect, it } from "vitest";
import { decodePng } from "../src/effect/png.js";
import {
  clipBox,
  cropImage,
  encodePng,
  paddedBox,
  upscaleNearest,
  type RgbImage,
} from "../src/ocr/image.js";

/** A 4x4 image whose pixels encode their own coordinates: R=y, G=x, B=17. */
function gridImage(width = 4, height = 4): RgbImage {
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 3;
      rgb[p] = y * 60;
      rgb[p + 1] = x * 60;
      rgb[p + 2] = 17;
    }
  }
  return { width, height, rgb };
}

function pixelAt(image: RgbImage, x: number, y: number): [number, number, number] {
  const p = (y * image.width + x) * 3;
  return [image.rgb[p]!, image.rgb[p + 1]!, image.rgb[p + 2]!];
}

describe("cropImage", () => {
  it("copies the exact rows and columns of the clipped box", () => {
    const crop = cropImage(gridImage(), { left: 1, top: 2, right: 3, bottom: 4 });
    expect(crop).toBeDefined();
    expect(crop!.width).toBe(2);
    expect(crop!.height).toBe(2);
    // Source (1,2) = R120,G60,B17
    expect(pixelAt(crop!, 0, 0)).toEqual([120, 60, 17]);
    // Source (2,3) = R180,G120,B17
    expect(pixelAt(crop!, 1, 1)).toEqual([180, 120, 17]);
  });

  it("clips a box that runs past the frame instead of reading out of bounds", () => {
    const crop = cropImage(gridImage(), { left: 2, top: 2, right: 99, bottom: 99 });
    expect(crop).toBeDefined();
    expect(crop!.width).toBe(2);
    expect(crop!.height).toBe(2);
  });

  it("drops an empty or out-of-frame box", () => {
    expect(cropImage(gridImage(), { left: 2, top: 2, right: 2, bottom: 4 })).toBeUndefined();
    expect(cropImage(gridImage(), { left: 9, top: 9, right: 10, bottom: 10 })).toBeUndefined();
  });
});

describe("clipBox / paddedBox", () => {
  const image = gridImage(10, 10);

  it("pads symmetrically and clips to the frame", () => {
    expect(paddedBox(image, { left: 2, top: 2, right: 4, bottom: 4 }, 2)).toEqual({
      left: 0,
      top: 0,
      right: 6,
      bottom: 6,
    });
  });

  it("rejects a box with no overlap", () => {
    expect(clipBox(image, { left: 11, top: 11, right: 12, bottom: 12 })).toBeUndefined();
  });
});

describe("upscaleNearest", () => {
  it("2x maps each source pixel to a 2x2 block, with no skipped pixels", () => {
    const up = upscaleNearest(gridImage(2, 2), 2);
    expect(up.width).toBe(4);
    expect(up.height).toBe(4);
    // Source (0,0) quadrant, source (1,1) quadrant.
    expect(pixelAt(up, 0, 0)).toEqual(pixelAt(gridImage(2, 2), 0, 0));
    expect(pixelAt(up, 1, 1)).toEqual(pixelAt(gridImage(2, 2), 0, 0));
    expect(pixelAt(up, 2, 2)).toEqual(pixelAt(gridImage(2, 2), 1, 1));
    expect(pixelAt(up, 3, 3)).toEqual(pixelAt(gridImage(2, 2), 1, 1));
  });

  it("rounds fractional sizes and refuses non-positive scales", () => {
    const up = upscaleNearest(gridImage(3, 2), 1.5);
    expect(up.width).toBe(5);
    expect(up.height).toBe(3);
    // Reverse mapping covers every source column/row (gather, not a strided copy).
    const sourceColumns = new Set<number>();
    for (let x = 0; x < up.width; x += 1) {
      // G channel is 60*x_source, so recover the source column.
      sourceColumns.add(up.rgb[(x) * 3 + 1]! / 60);
    }
    expect([...sourceColumns].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(() => upscaleNearest(gridImage(2, 2), 0)).toThrow();
  });

  it("returns the same image at scale 1", () => {
    const image = gridImage(2, 2);
    expect(upscaleNearest(image, 1)).toBe(image);
  });
});

describe("encodePng", () => {
  it("round-trips through decodePng pixel-exactly", () => {
    const original = gridImage(7, 5);
    const decoded = decodePng(encodePng(original));
    expect(decoded.width).toBe(7);
    expect(decoded.height).toBe(5);
    expect(decoded.rgb).toEqual(original.rgb);
  });

  it("writes a non-interlaced depth-8 RGB IHDR", () => {
    const png = encodePng(gridImage(2, 2));
    // IHDR data starts after signature (8) + length/type (8).
    expect(png.subarray(8, 16).toString("latin1")).toContain("IHDR");
    expect(png[16 + 8]).toBe(8); // bit depth
    expect(png[16 + 9]).toBe(2); // colour type RGB
    expect(png[16 + 12]).toBe(0); // interlace none
  });
});
