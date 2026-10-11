/**
 * Screen-effect observation (S11 step 3): compare two device frames and say
 * whether the screen visibly changed.
 *
 * Byte equality does not work — MuMu runs an animated wallpaper, so three
 * captures of an "idle" home screen hashed differently while the pixels only
 * moved by ~1.5% mean difference. A real navigation (home → settings) measured
 * 0.69, so a 64x36 grayscale mean-absolute-difference with a 0.05 threshold
 * separates the two with a ~3x margin over the worst animation noise observed
 * on 2026-10-11.
 *
 * PNG is decoded with node:zlib only (no new dependency): adb screencap yields
 * 8-bit non-interlaced RGB/RGBA, which is the only shape handled here. Anything
 * else (e.g. a JPEG backend) yields `undefined` and the caller reports the
 * effect as unknown rather than guessing.
 */
import { inflateSync } from "node:zlib";

export const EFFECT_GRID = { width: 64, height: 36 } as const;

/** Mean absolute difference over the grid, normalized to 0..1. */
export function frameDiff(a: Uint8Array | undefined, b: Uint8Array | undefined): number | undefined {
  if (!a || !b || a.length !== b.length || a.length === 0) return undefined;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / a.length / 255;
}

/** Downscaled grayscale grid of a device screenshot, or undefined if undecodable. */
export function grayscaleGrid(bytes: Uint8Array): Uint8Array | undefined {
  const frame = decodePngLuma(bytes);
  if (!frame) return undefined;
  return boxDownscale(frame.luma, frame.width, frame.height);
}

interface PngLuma {
  luma: Uint8Array;
  width: number;
  height: number;
}

function decodePngLuma(bytes: Uint8Array): PngLuma | undefined {
  if (
    bytes.length < 32 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return undefined;
  }
  const idat: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    const dataStart = offset + 8;
    if (dataStart + length > bytes.length) return undefined;
    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8] ?? 0;
      colorType = bytes[dataStart + 9] ?? 0;
      interlace = bytes[dataStart + 12] ?? 0;
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4;
  }
  // 8-bit non-interlaced RGB/RGBA is what `screencap -p` produces; anything
  // else is out of scope and reported as unknown by the caller.
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6) || width === 0 || height === 0) {
    return undefined;
  }
  const channels = colorType === 6 ? 4 : 3;
  let raw: Buffer;
  try {
    raw = inflateSync(concat(idat));
  } catch {
    return undefined;
  }
  const stride = width * channels;
  const luma = new Uint8Array(width * height);
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor] ?? 0;
    cursor += 1;
    if (cursor + stride > raw.length) return undefined;
    for (let x = 0; x < stride; x += 1) {
      const byte = raw[cursor + x] ?? 0;
      const left = x >= channels ? (current[x - channels] ?? 0) : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= channels ? (previous[x - channels] ?? 0) : 0;
      let value: number;
      switch (filter) {
        case 1:
          value = byte + left;
          break;
        case 2:
          value = byte + up;
          break;
        case 3:
          value = byte + ((left + up) >> 1);
          break;
        case 4:
          value = byte + paeth(left, up, upLeft);
          break;
        default:
          value = byte;
          break;
      }
      current[x] = value & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const p = x * channels;
      luma[y * width + x] = Math.round(
        0.299 * (current[p] ?? 0) + 0.587 * (current[p + 1] ?? 0) + 0.114 * (current[p + 2] ?? 0),
      );
    }
    previous.set(current);
    cursor += stride;
  }
  return { luma, width, height };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function boxDownscale(luma: Uint8Array, width: number, height: number): Uint8Array {
  const { width: gw, height: gh } = EFFECT_GRID;
  const out = new Uint8Array(gw * gh);
  const blockW = width / gw;
  const blockH = height / gh;
  for (let gy = 0; gy < gh; gy += 1) {
    const y0 = Math.floor(gy * blockH);
    const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * blockH));
    for (let gx = 0; gx < gw; gx += 1) {
      const x0 = Math.floor(gx * blockW);
      const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * blockW));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          sum += luma[y * width + x] ?? 0;
          count += 1;
        }
      }
      out[gy * gw + gx] = count > 0 ? Math.round(sum / count) : 0;
    }
  }
  return out;
}

function concat(parts: Uint8Array[]): Buffer {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = Buffer.allocUnsafe(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
