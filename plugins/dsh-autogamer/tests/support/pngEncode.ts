/**
 * Synthetic PNG builder for the effect-diff specs.
 *
 * The diff needs real PNG bytes, and shipping fixtures would mean opaque binary
 * blobs in the tree; encoding them here keeps every case readable (a base level,
 * a rectangular patch, an action) and lets a case dial its own frame size.
 * Frames are written with filter 0 on every row - the decoder's filter
 * reconstruction is exercised separately by decoding a python-shaped sample.
 */
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** 0 = grey (1 byte/px), 2 = RGB, 6 = RGBA. Filter type 0 on every row. */
export function encodePng(
  width: number,
  height: number,
  pixels: Uint8Array,
  colorType: 0 | 2 | 6 = 2,
): Uint8Array {
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 4;
  if (pixels.length !== width * height * channels) {
    throw new Error(`pixel buffer is ${pixels.length} bytes, expected ${width * height * channels}`);
  }
  const stride = width * channels;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export interface Block {
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
}

/** A uniform frame, optionally with rectangular patches painted on top. */
export function frame(
  width: number,
  height: number,
  base: number,
  blocks: readonly Block[] = [],
): Uint8Array {
  const pixels = new Uint8Array(width * height * 3).fill(base);
  for (const block of blocks) {
    for (let y = block.y; y < block.y + block.height; y++) {
      for (let x = block.x; x < block.x + block.width; x++) {
        const at = (y * width + x) * 3;
        pixels[at] = block.level;
        pixels[at + 1] = block.level;
        pixels[at + 2] = block.level;
      }
    }
  }
  return encodePng(width, height, pixels);
}