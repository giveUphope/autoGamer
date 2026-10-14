/**
 * Minimal PNG decoder for effect comparison (T3 / G84 slice 1).
 *
 * Why hand-rolled: the only frames this plugin decodes are device screenshots,
 * and every one measured so far is depth 8, colour type 6 (RGBA), non-interlaced
 * - a shape that costs ~100 lines to support and would otherwise pull an image
 * library into the dependency list. Anything outside that shape throws, and the
 * effect judge turns the throw into its fail-open `undefined`.
 *
 * Colour type 2 (RGB) is accepted because screencap output is not uniform across
 * devices; alpha is dropped, which matches how the python side read frames
 * (three-channel imread).
 */
import { inflateSync } from "node:zlib";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export interface DecodedFrame {
  width: number;
  height: number;
  /** 3 bytes per pixel, row-major, alpha dropped. */
  rgb: Uint8Array;
}

function readChunks(bytes: Uint8Array): { ihdr: Uint8Array; idat: Uint8Array } {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error("not a PNG");
  }
  let offset = 8;
  let ihdr: Uint8Array | undefined;
  let idat: Uint8Array | undefined;
  let palette = false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error("truncated PNG chunk");
    if (type === "IHDR") ihdr = bytes.subarray(start, end);
    else if (type === "PLTE") palette = true;
    else if (type === "IDAT") {
      const next = new Uint8Array((idat?.length ?? 0) + length);
      if (idat) next.set(idat, 0);
      next.set(bytes.subarray(start, end), idat?.length ?? 0);
      idat = next;
    } else if (type === "IEND") break;
    offset = end + 4; // skip the chunk CRC
  }
  if (!ihdr) throw new Error("PNG has no IHDR");
  if (palette) throw new Error("PNG uses a palette");
  if (!idat) throw new Error("PNG has no IDAT");
  return { ihdr, idat };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilter(raw: Uint8Array, height: number, stride: number, bpp: number): Uint8Array {
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prior = dst - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x]!;
      const left = x >= bpp ? out[dst + x - bpp]! : 0;
      const up = y > 0 ? out[prior + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? out[prior + x - bpp]! : 0;
      let restored: number;
      switch (type) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4:
          restored = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`unknown PNG filter ${type}`);
      }
      out[dst + x] = restored & 0xff;
    }
  }
  return out;
}

export function decodePng(bytes: Uint8Array): DecodedFrame {
  const { ihdr, idat } = readChunks(bytes);
  const view = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const depth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${String(depth)}`);
  if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported PNG colour type ${String(colorType)}`);
  if (interlace !== 0) throw new Error("interlaced PNG is unsupported");
  if (width <= 0 || height <= 0) throw new Error("PNG has an empty canvas");
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(idat);
  if (raw.length !== height * (stride + 1)) {
    throw new Error("PNG scanline size does not match the header");
  }
  const pixels = unfilter(raw, height, stride, channels);
  if (channels === 3) return { width, height, rgb: pixels };
  const rgb = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    rgb[p * 3] = pixels[p * 4]!;
    rgb[p * 3 + 1] = pixels[p * 4 + 1]!;
    rgb[p * 3 + 2] = pixels[p * 4 + 2]!;
  }
  return { width, height, rgb };
}