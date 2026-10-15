#!/usr/bin/env node
/**
 * Generate the synthetic hard frame for G92 (mechanism regression, offline).
 *
 * Why a synthetic frame at all: the only real fixture we ship
 * (`screen-chrome-tab-overview.png`) runs "whole frame is a superset of what the
 * region scan finds" - every label a region scan reads, the whole frame reads
 * too. G92 needs the opposite direction (region finds what the whole frame
 * misses), and the device frames that show it are not in the repo.
 *
 * Two other ways of building one were measured and REFUTED - do not retry them:
 *
 *  1. Shrinking a known-good label and pasting it back. Every configuration
 *     missed, including shrink=2 with contrast untouched: shrinking destroys the
 *     glyphs at the pixel level and upscaling cannot restore them. (This does
 *     not contradict T5's device measurement - that 140x70 crop was already 70px
 *     tall, nothing was shrunk.)
 *  2. Using the shipped fixture as-is. Refuted above.
 *
 * What works: paste the label at its ORIGINAL size into a busy background. The
 * whole-frame miss then comes from page layout analysis rather than from lost
 * detail, which is the bottleneck G92 identifies.
 *
 * Output (committed fixtures, so the lock does not depend on this script):
 *   tests/fixtures/screen-synth-hard.png
 *   tests/fixtures/hierarchy-synth-hard.xml
 *
 * With --scan it also prints the padding x scale table. That table is the offline
 * rehearsal of probe B's parameter scan; one label in one place is NOT grounds
 * for retuning DEFAULT_REGION_OPTIONS - but it did pick the pair this frame's
 * lock pins, and it marks scale 1.5 / padding 24 as failure regions.
 *
 * Zero dependencies beyond the package's own modules (no font, no image lib -
 * the same call T5 made when it refused sharp/pngjs).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "../dist/effect/png.js";
import { fromDecoded, cropImage, encodePng, upscaleNearest } from "../dist/ocr/image.js";
import { createOcrEngine, findNeedleHits, chooseHitPoint } from "../dist/ocr/recognize.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(PKG, "tests", "fixtures");

/** The label and its position are locked on the shipped fixture (ocrPackaging.spec). */
const NEEDLE = "游戏中心";
const LABEL_CENTER = { x: 1003, y: 240 };
const LABEL_BOX = { left: 913, top: 214, right: 1093, bottom: 266 };
/** Where the label lands in the synthetic frame (picked so the paste sits mid-canvas). */
const PASTE_AT = { x: 620, y: 430 };
const FRAME = { width: 1600, height: 900 };
const BACKGROUND_BLOCKS = 30;

/** Mid-grey launcher-ish background with dark blocks standing in for icons. */
function busyBackground(width, height, blocks) {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < rgb.length; i += 3) {
    rgb[i] = 116;
    rgb[i + 1] = 120;
    rgb[i + 2] = 128;
  }
  for (let n = 0; n < blocks; n++) {
    const box = {
      x: (173 + n * 211) % (width - 160),
      y: (97 + n * 149) % (height - 160),
      w: 60 + (n % 4) * 30,
      h: 60 + (n % 3) * 26,
      shade: 52 + ((n * 37) % 76),
    };
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = (y * width + x) * 3;
        rgb[i] = box.shade;
        rgb[i + 1] = box.shade + 5;
        rgb[i + 2] = box.shade + 12;
      }
    }
  }
  return { width, height, rgb };
}

/** Copy `src` onto `dst` at (atX, atY), clipping at the canvas edge. */
function blit(dst, src, atX, atY) {
  for (let y = 0; y < src.height; y++) {
    const dy = atY + y;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = atX + x;
      if (dx < 0 || dx >= dst.width) continue;
      const si = (y * src.width + x) * 3;
      const di = (dy * dst.width + dx) * 3;
      dst.rgb[di] = src.rgb[si];
      dst.rgb[di + 1] = src.rgb[si + 1];
      dst.rgb[di + 2] = src.rgb[si + 2];
    }
  }
  return dst;
}

/**
 * Minimal synthetic hierarchy: a full-screen root plus exactly one leaf over the
 * label. The root is what the candidate filter drops (area ratio + it contains
 * the leaf), so P1 has exactly one candidate - asserted by the lock, otherwise
 * this file would not be measuring P1 at all.
 */
function syntheticHierarchyXml() {
  // Split so the leaf never repeats an attribute - duplicate attributes are
  // invalid XML and the parser's behaviour on them would be a guess, not a fact.
  const base = [
    'text=""',
    'resource-id=""',
    'package="com.android.launcher3"',
    'content-desc=""',
    'checkable="false"',
    'checked="false"',
    'enabled="true"',
    'scrollable="false"',
    'selected="false"',
    'focused="false"',
    'drawing-order="0"',
    'hint=""',
  ];
  const root = [...base, 'class="android.widget.FrameLayout"', 'clickable="false"', 'focusable="false"'].join(" ");
  const leaf = [
    ...base,
    'class="android.view.View"',
    'clickable="true"',
    'focusable="true"',
    'drawing-order="1"',
  ].join(" ");
  return (
    `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n` +
    `<!-- G92 synthetic hard frame: NOT a device dump. A full-screen root plus one leaf over the` +
    ` pasted label; the root is dropped by the candidate filter, so the region scan has exactly one` +
    ` candidate. Bounds are in frame space (1600x900). -->\n` +
    `<hierarchy rotation="1">` +
    `<node index="0" ${root} bounds="[0,0][1600,900]">` +
    `<node index="0" ${leaf} bounds="[${PASTE_AT.x},${PASTE_AT.y}]` +
    `[${PASTE_AT.x + LABEL_BOX.right - LABEL_BOX.left},${PASTE_AT.y + LABEL_BOX.bottom - LABEL_BOX.top}]" />` +
    `</node>` +
    `</hierarchy>\n`
  );
}

const source = fromDecoded(decodePng(new Uint8Array(readFileSync(join(FIXTURES, "screen-chrome-tab-overview.png")))));
const label = cropImage(source, LABEL_BOX);
if (label === undefined) throw new Error("label box falls outside the source frame");
const background = blit(busyBackground(FRAME.width, FRAME.height, BACKGROUND_BLOCKS), label, PASTE_AT.x, PASTE_AT.y);

const png = encodePng(background);
writeFileSync(join(FIXTURES, "screen-synth-hard.png"), png);
writeFileSync(join(FIXTURES, "hierarchy-synth-hard.xml"), syntheticHierarchyXml(), "utf8");
console.log(`screen-synth-hard.png        ${png.length} bytes (${label.width}x${label.height} label at ${PASTE_AT.x},${PASTE_AT.y}, ${BACKGROUND_BLOCKS} background blocks)`);
console.log(`hierarchy-synth-hard.xml     1 leaf candidate over the label`);

if (!process.argv.includes("--scan")) {
  console.log("\n(pass --scan to print the padding x scale table; it needs the real engine, ~1 min)");
  process.exit(0);
}

const engine = createOcrEngine();
try {
  const whole = await engine.recognize(png);
  console.log(`\nwhole frame: ${chooseHitPoint(findNeedleHits(whole, NEEDLE)) ? "HIT (this frame is NOT hard)" : "MISS (hard, as intended)"}`);
  console.log("\npad\\scale |  1.0  1.5  2.0  3.0");
  for (const pad of [0, 8, 24]) {
    const row = [];
    for (const scale of [1, 1.5, 2, 3]) {
      const box = {
        left: PASTE_AT.x - pad,
        top: PASTE_AT.y - pad,
        right: PASTE_AT.x + label.width + pad,
        bottom: PASTE_AT.y + label.height + pad,
      };
      const cropped = cropImage(background, box);
      const read = await engine.recognize(encodePng(upscaleNearest(cropped, scale)));
      row.push(chooseHitPoint(findNeedleHits(read, NEEDLE)) ? " HIT " : "miss ");
    }
    console.log(`${String(pad).padStart(7)} | ${row.join(" ")}`);
  }
} finally {
  await engine.dispose();
}
