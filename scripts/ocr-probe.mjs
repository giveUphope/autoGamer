// T5 probe: the built-in OCR has to work offline, from the package's own language
// data, and leave nothing behind in the working directory. Run:
//   node scripts/ocr-probe.mjs [path/to/fixture.png]
import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..", "plugins", "dsh-autogamer");
const require = createRequire(join(plugin, "package.json"));
const { createWorker } = require("tesseract.js");

const fixture = process.argv[2] ?? join(plugin, "tests", "fixtures", "screen-chrome-tab-overview.png");
const png = readFileSync(fixture);
const ocrDir = join(plugin, "ocr");
const before = readdirSync(process.cwd());

const langs = process.env.OCR_LANGS ?? "eng+chi_sim";
const t0 = Date.now();
const worker = await createWorker(langs.split("+"), 1, {
  langPath: ocrDir,
  cacheMethod: "none",
  gzip: true,
  logger: () => {},
});
const bootMs = Date.now() - t0;
const t1 = Date.now();
// Word boxes only come back when they are asked for (v7 default output is text).
const { data } = await worker.recognize(png, {}, { blocks: true, text: true, layoutBlocks: false });
const runMs = Date.now() - t1;
const t2 = Date.now();
const second = await worker.recognize(png, {}, { blocks: true, text: false });
const secondMs = Date.now() - t2;

const words = [];
for (const block of data.blocks ?? []) {
  for (const paragraph of block.paragraphs ?? []) {
    for (const line of paragraph.lines ?? []) {
      for (const word of line.words ?? []) {
        words.push({ text: word.text, conf: word.confidence, bbox: word.bbox });
      }
    }
  }
}
console.log(`fixture: ${fixture} (${png.length} bytes)`);
console.log(`langs=${langs} boot=${bootMs}ms recognize=${runMs}ms second=${secondMs}ms total-confidence=${data.confidence}`);
console.log(`blocks=${data.blocks?.length ?? 0} words=${words.length}`);
const text = String(data.text ?? "").replace(/\r/g, "").trim();
console.log("text head:", JSON.stringify(text.slice(0, 200)));
const norm = (s) => s.replace(/\s+/g, "").toLowerCase();
for (const needle of ["TapTap", "游戏中心", "光环助手", "叫MT", "崛起", "Settings"]) {
  const lineHits = (data.blocks ?? [])
    .flatMap((b) => (b.paragraphs ?? []).flatMap((p) => p.lines ?? []))
    .filter((line) => norm(line.text ?? "").includes(norm(needle)));
  // A line can span a whole launcher row (measured: x0=4..x1=1441), so the tap
  // point has to come from the WORD box, not the line box.
  const wordHits = words.filter((word) => norm(word.text).includes(norm(needle)));
  console.log(
    `needle ${JSON.stringify(needle)}: lines=${lineHits.length} words=${wordHits.length}`,
    JSON.stringify(wordHits.slice(0, 3).map((w) => ({ t: w.text, conf: Math.round(w.conf), c: [Math.round((w.bbox.x0 + w.bbox.x1) / 2), Math.round((w.bbox.y0 + w.bbox.y1) / 2)], box: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1] }))),
  );
}
console.log("sample words:", JSON.stringify(words.slice(0, 6)));
await worker.terminate();

const after = readdirSync(process.cwd());
const leaked = after.filter((name) => !before.includes(name));
const stray = readdirSync(ocrDir).filter((name) => !name.endsWith(".traineddata.gz"));
console.log(`cwd pollution: ${JSON.stringify(leaked)}   ocr dir extras: ${JSON.stringify(stray)}`);
if (existsSync(join(process.cwd(), "tessdata"))) console.log("!! a tessdata directory appeared in cwd");
