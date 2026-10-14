/**
 * Screen-size sourcing (G24). Two regression locks live here:
 *  - byteAt used to call itself, so parseImageSize threw RangeError on EVERY
 *    input and the probe-screenshot fallback path was dead;
 *  - Schemastery resolves an unset optional `screenSize` tuple to a truthy
 *    `[undefined, undefined]` array (not `undefined`), so a truthiness check
 *    on the array treated the default config as an explicit screen size.
 */
import { describe, expect, it } from "vitest";
import { configuredScreenSize, imageSizeFromBase64, parseImageSize } from "../src/coord.js";

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8); // IHDR chunk length
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return new Uint8Array(bytes);
}

function jpegBytes(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(16);
  bytes[0] = 0xff;
  bytes[1] = 0xd8; // SOI
  bytes[2] = 0xff;
  bytes[3] = 0xc0; // SOF0
  bytes[4] = 0x00;
  bytes[5] = 0x11; // segment length
  bytes[6] = 8; // sample precision
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return new Uint8Array(bytes);
}

describe("parseImageSize", () => {
  it("reads dimensions from a PNG header", () => {
    expect(parseImageSize(pngBytes(1080, 2400))).toEqual({ width: 1080, height: 2400 });
  });

  it("reads dimensions from a JPEG SOF segment", () => {
    expect(parseImageSize(jpegBytes(720, 1600))).toEqual({ width: 720, height: 1600 });
  });

  it("returns undefined for a non-image buffer instead of throwing", () => {
    const garbage = new Uint8Array(Buffer.from("not an image payload at all"));
    expect(() => parseImageSize(garbage)).not.toThrow();
    expect(parseImageSize(garbage)).toBeUndefined();
  });

  it("decodes through imageSizeFromBase64", () => {
    const base64 = Buffer.from(pngBytes(1440, 3200)).toString("base64");
    expect(imageSizeFromBase64(base64)).toEqual({ width: 1440, height: 3200 });
  });
});

describe("configuredScreenSize", () => {
  it("accepts a real declared size", () => {
    expect(configuredScreenSize([1080, 2400])).toEqual({ width: 1080, height: 2400 });
  });

  it("treats the Schemastery empty-tuple shape as unset", () => {
    expect(configuredScreenSize([undefined, undefined])).toBeUndefined();
    expect(configuredScreenSize([null, null])).toBeUndefined();
  });

  it("treats a missing value as unset", () => {
    expect(configuredScreenSize(undefined)).toBeUndefined();
  });

  it("rejects non-numeric and non-positive entries", () => {
    expect(configuredScreenSize(["1080", "2400"])).toBeUndefined();
    expect(configuredScreenSize([0, 0])).toBeUndefined();
    expect(configuredScreenSize([-1, 2400])).toBeUndefined();
  });
});
