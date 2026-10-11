/**
 * Minimal 8-bit RGB PNG writer for the effect-observation specs: the decoder in
 * src/frame.ts must be tested against real encoded bytes, not a fixture blob,
 * so the un-filter branches stay honest.
 */
import { deflateSync } from "node:zlib";

export type PngFilter = 0 | 2;



function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([header, body, crc]);
}

/** CRC-32 as PNG uses it (the decoder ignores CRC, but a valid file keeps the test honest). */
function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc;
}

/** Build an 8-bit RGB PNG whose pixels come from `pixel(x, y)`. */
export function encodePng(width: number, height: number, filter: PngFilter, pixel: (x: number, y: number) => number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const rows: Buffer[] = [];
  const previous = Buffer.alloc(width * 3);
  for (let y = 0; y < height; y += 1) {
    const raw = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x += 1) {
      const value = pixel(x, y);
      raw[x * 3] = value;
      raw[x * 3 + 1] = value;
      raw[x * 3 + 2] = value;
    }
    const line = Buffer.alloc(1 + raw.length);
    line[0] = filter;
    if (filter === 0) {
      raw.copy(line, 1);
    } else {
      for (let i = 0; i < raw.length; i += 1) line[1 + i] = (raw[i] - previous[i] + 256) & 0xff;
    }
    previous.set(raw);
    rows.push(line);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
