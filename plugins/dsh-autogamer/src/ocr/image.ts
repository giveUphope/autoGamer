/**
 * Zero-dependency RGB image operations for region OCR (G92 probe A).
 *
 * The region ladder needs to crop a candidate box out of a frame, enlarge it
 * (measured: a 140x70 label at 2x reads while the whole 1600x900 frame does
 * not), and hand the small image back to tesseract as a PNG. The decoder
 * already exists (`src/effect/png.ts`); the encoder side is new.
 *
 * No image library: frames are depth-8 RGB/RGBA, the crop is a row copy,
 * nearest-neighbour enlargement is a gather, and a PNG encoder is zlib deflate
 * plus a CRC table - deliberately the same "narrow known shape, hand-rolled"
 * decision that produced the decoder (T5 rejected sharp/pngjs).
 */
import { deflateSync } from "node:zlib";
import type { DecodedFrame } from "../effect/png.js";

export interface RgbImage {
  width: number;
  height: number;
  /** 3 bytes per pixel, row-major. */
  rgb: Uint8Array;
}

export interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function fromDecoded(frame: DecodedFrame): RgbImage {
  return { width: frame.width, height: frame.height, rgb: frame.rgb };
}

/** Clip a box into the image and drop it when it covers no pixel. */
export function clipBox(image: RgbImage, box: PixelBox): PixelBox | undefined {
  const left = Math.max(0, Math.min(Math.round(box.left), image.width));
  const top = Math.max(0, Math.min(Math.round(box.top), image.height));
  const right = Math.max(0, Math.min(Math.round(box.right), image.width));
  const bottom = Math.max(0, Math.min(Math.round(box.bottom), image.height));
  if (right <= left || bottom <= top) return undefined;
  return { left, top, right, bottom };
}

/** Crop a clipped box out of the frame. Returns undefined for empty boxes. */
export function cropImage(image: RgbImage, box: PixelBox): RgbImage | undefined {
  const clipped = clipBox(image, box);
  if (clipped === undefined) return undefined;
  const { left, top, right, bottom } = clipped;
  const width = right - left;
  const height = bottom - top;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const src = ((top + y) * image.width + left) * 3;
    const dst = y * width * 3;
    rgb.set(image.rgb.subarray(src, src + width * 3), dst);
  }
  return { width, height, rgb };
}

/**
 * Nearest-neighbour enlargement. Fractional scales are supported (1.5/2/3 are
 * the probe range); the source pixel is chosen by rounded reverse mapping, so
 * no source row/column is silently skipped or duplicated out of proportion.
 */
export function upscaleNearest(image: RgbImage, scale: number): RgbImage {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("scale must be positive");
  if (scale === 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const srcY = Math.min(image.height - 1, Math.floor((y + 0.5) / scale));
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.min(image.width - 1, Math.floor((x + 0.5) / scale));
      const src = (srcY * image.width + srcX) * 3;
      const dst = (y * width + x) * 3;
      rgb[dst] = image.rgb[src]!;
      rgb[dst + 1] = image.rgb[src + 1]!;
      rgb[dst + 2] = image.rgb[src + 2]!;
    }
  }
  return { width, height, rgb };
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Encode an RGB image as a non-interlaced depth-8 colour-type-2 PNG (filter
 * None on every row, deflate via node:zlib). Every image this encoder makes
 * must round-trip through `decodePng` pixel-identically - that is the lock.
 */
export function encodePng(image: RgbImage): Buffer {
  const { width, height, rgb } = image;
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace: none
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type None
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = chunk("IHDR", ihdr);
  const idatChunk = chunk("IDAT", new Uint8Array(idat));
  const iendChunk = chunk("IEND", new Uint8Array(0));
  return Buffer.concat([signature, Buffer.from(ihdrChunk), Buffer.from(idatChunk), Buffer.from(iendChunk)]);
}

/**
 * A box enlarged by `padding` on every side, then clipped to the frame.
 * Measured labels can end tight against the text glyphs; the real padding
 * value is a probe-B constant, this only expresses the geometry.
 */
export function paddedBox(image: RgbImage, box: PixelBox, padding: number): PixelBox | undefined {
  return clipBox(image, {
    left: box.left - padding,
    top: box.top - padding,
    right: box.right + padding,
    bottom: box.bottom + padding,
  });
}
