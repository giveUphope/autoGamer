/**
 * Effect-observation frame math (S11 step 3). The PNG path is exercised with
 * real encoded bytes rather than a fixture file so the un-filter branches stay
 * honest: `screencap -p` yields 8-bit RGBA, but the decoder also accepts 8-bit
 * RGB, and a wrong Paeth/Up reconstruction would silently read as "no change".
 */
import { describe, expect, it } from "vitest";
import { EFFECT_GRID, frameDiff, grayscaleGrid } from "../src/frame.js";
import { encodePng } from "./support/png.js";

const SIZE = { width: 160, height: 90 };

function flat(value: number): Buffer {
  return encodePng(SIZE.width, SIZE.height, 0, () => value);
}

describe("frame: effect metrics", () => {
  it("returns an empty grid for an identical frame pair", () => {
    const a = grayscaleGrid(new Uint8Array(flat(40)));
    const b = grayscaleGrid(new Uint8Array(flat(40)));
    expect(a).toBeDefined();
    expect(frameDiff(a, b)).toBe(0);
  });

  it("separates a navigation-sized change from a small brightness shift", () => {
    const before = grayscaleGrid(new Uint8Array(flat(40)));
    // Half the screen flips to white: a coarse stand-in for navigating screens.
    const after = grayscaleGrid(
      new Uint8Array(encodePng(SIZE.width, SIZE.height, 0, (x) => (x < SIZE.width / 2 ? 40 : 240))),
    );
    const dimmed = grayscaleGrid(new Uint8Array(flat(46)));
    expect(frameDiff(before, after)).toBeGreaterThan(0.05);
    expect(frameDiff(before, dimmed)!).toBeLessThan(0.05);
  });

  it("reconstructs Up-filtered rows identically to None-filtered rows", () => {
    const pixel = (x: number, y: number) => (x * 3 + y * 5) % 256;
    const none = grayscaleGrid(new Uint8Array(encodePng(SIZE.width, SIZE.height, 0, pixel)));
    const up = grayscaleGrid(new Uint8Array(encodePng(SIZE.width, SIZE.height, 2, pixel)));
    expect(up).toEqual(none);
    expect(frameDiff(none, up)).toBe(0);
  });

  it("yields no frame for bytes that are not a supported PNG", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(grayscaleGrid(new Uint8Array(jpeg))).toBeUndefined();
    expect(grayscaleGrid(new Uint8Array(Buffer.from("not an image")))).toBeUndefined();
    expect(frameDiff(undefined, grayscaleGrid(new Uint8Array(flat(1))))).toBeUndefined();
  });

  it("keeps the grid at the declared observation size", () => {
    const grid = grayscaleGrid(new Uint8Array(flat(128)));
    expect(grid?.length).toBe(EFFECT_GRID.width * EFFECT_GRID.height);
  });
});
