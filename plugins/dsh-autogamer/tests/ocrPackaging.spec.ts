/**
 * T5's promise to the user is "install and use": the OCR needs no API key, no
 * model download, no extra install step, and leaves no files behind. That promise
 * is made of packaging facts, so they are locked here rather than trusted from
 * the README — and one of them is proved by running the real engine over the real
 * frame, offline, in this test.
 *
 * Mutation-proven (docs/TODO.md §七 T5, 2026-10-15): dropping the `files` entry,
 * moving `tesseract.js` to devDependencies, and switching `cacheMethod` off
 * `"none"` each turn one of these red.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chooseHitPoint, createOcrEngine, findNeedleHits, type OcrEngine, type OcrPage } from "../src/ocr/recognize.js";

const ROOT = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("package.json", ROOT)), "utf-8")) as {
  files?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const LANGS = ["eng", "chi_sim"] as const;

/** The live launcher frame the probe measured (1600x900). */
const FIXTURE = fileURLToPath(new URL("tests/fixtures/screen-chrome-tab-overview.png", ROOT));
const OCR_DIR = fileURLToPath(new URL("ocr", ROOT));

describe("OCR ships inside the package", () => {
  it("lists the language data in the published files", () => {
    expect(pkg.files ?? []).toContain("ocr/*.traineddata.gz");
    expect(pkg.files ?? []).toContain("THIRD_PARTY_NOTICES.md");
  });

  it("carries real gzip language data, not a pointer or a truncated download", () => {
    for (const lang of LANGS) {
      const file = `${OCR_DIR}/${lang}.traineddata.gz`;
      const size = statSync(file).size;
      const head = readFileSync(file).subarray(0, 2);
      // 1f 8b is gzip's own magic; the real files are ~1.7-2.0 MB (measured).
      expect([head[0], head[1]], lang).toEqual([0x1f, 0x8b]);
      expect(size, lang).toBeGreaterThan(1_000_000);
    }
  });

  it("keeps the runtime a dependency, since the tool is used at run time", () => {
    expect(Object.keys(pkg.dependencies ?? {})).toContain("tesseract.js");
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("tesseract.js");
  });
});

describe("the built-in engine works with nothing installed", () => {
  // Worker boot is measured at 169ms and one frame at ~650ms, but this is the
  // only test that loads WASM, so it gets room.
  let engine: OcrEngine | undefined;
  let page: OcrPage | undefined;
  let ocrDirBefore: string[] = [];
  let cwdBefore: string[] = [];

  beforeAll(async () => {
    ocrDirBefore = readdirSync(OCR_DIR);
    cwdBefore = readdirSync(process.cwd());
    engine = createOcrEngine();
    page = await engine.recognize(readFileSync(FIXTURE));
  }, 60_000);

  afterAll(async () => {
    await engine?.dispose();
  });

  it("reads a real label off a real frame and taps its own box", () => {
    expect(page).toBeDefined();
    // Both centres are the boxes the probe reported for this fixture.
    expect(chooseHitPoint(findNeedleHits(page!, "TapTap"))).toEqual({ x: 1206, y: 241 });
    expect(chooseHitPoint(findNeedleHits(page!, "游戏中心"))).toEqual({ x: 1003, y: 240 });
  });

  it("writes nothing into the package or the working directory", () => {
    // `langPath` is the packaged directory and `cacheMethod: "none"` is what
    // keeps both lists below unchanged. Measured default behaviour (the probe
    // without either option, and the `cacheMethod: "write"` mutation here): it
    // unpacks `eng.traineddata` / `chi_sim.traineddata` next to the process.
    // Asserted absolutely as well as relatively, because a relative check alone
    // goes blind on a machine an earlier run already dirtied.
    const cwd = readdirSync(process.cwd());
    expect(cwd.filter((name) => name.endsWith(".traineddata"))).toEqual([]);
    expect(cwd).not.toContain("tessdata");
    expect(cwd.filter((name) => !cwdBefore.includes(name))).toEqual([]);
    expect([...readdirSync(OCR_DIR)].sort()).toEqual([...ocrDirBefore].sort());
  });
});
