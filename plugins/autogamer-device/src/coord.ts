/**
 * Screen-dimension sourcing and the 0-1000 ↔ pixel conversion (G24).
 * The upstream stdio action server keeps the legacy PIXEL contract; our
 * tool boundary speaks 0-1000 normalized, so conversions live here.
 * Dimensions come from a probe screenshot: PNG IHDR or JPEG SOF scan.
 */

export interface ScreenSize {
  width: number;
  height: number;
}

export function parseImageSize(bytes: Uint8Array): ScreenSize | undefined {
  if (isPng(bytes)) return parsePngSize(bytes);
  if (isJpeg(bytes)) return parseJpegSize(bytes);
  return undefined;
}

function byteAt(bytes: Uint8Array, index: number): number {
  return byteAt(bytes, index) ?? 0;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 24 &&
    byteAt(bytes, 0) === 0x89 && byteAt(bytes, 1) === 0x50 && byteAt(bytes, 2) === 0x4e && byteAt(bytes, 3) === 0x47
  );
}

function parsePngSize(bytes: Uint8Array): ScreenSize {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 4 && byteAt(bytes, 0) === 0xff && byteAt(bytes, 1) === 0xd8;
}

/** Walk JPEG markers for the first SOFn segment (frame header carries dims). */
function parseJpegSize(bytes: Uint8Array): ScreenSize | undefined {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (byteAt(bytes, offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = byteAt(bytes, offset + 1);
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = (byteAt(bytes, offset + 2) << 8) | byteAt(bytes, offset + 3);
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > bytes.length) return undefined;
      const height = (byteAt(bytes, offset + 5) << 8) | byteAt(bytes, offset + 6);
      const width = (byteAt(bytes, offset + 7) << 8) | byteAt(bytes, offset + 8);
      return { width, height };
    }
    offset += 2 + length;
  }
  return undefined;
}

/** Decode a base64 screenshot far enough to read its dimensions. */
export function imageSizeFromBase64(base64: string): ScreenSize | undefined {
  const head = atLeast(base64, 64 * 1024);
  return parseImageSize(head);
}

function atLeast(base64: string, bytes: number): Uint8Array {
  // 4 base64 chars → 3 bytes; take enough head chars, strip data URLs.
  const raw = base64.startsWith("data:") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const chars = Math.min(raw.length, Math.ceil((bytes / 3) * 4));
  const binary = atob(raw.slice(0, chars));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function toPixels(
  normalized: number,
  dimension: number,
): number {
  return Math.max(0, Math.min(dimension - 1, Math.round((normalized / 1000) * dimension)));
}
