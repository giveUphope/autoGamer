/**
 * Built-in offline OCR (T5 / G87 reversed).
 *
 * The shape of this module comes from measurements on the real emulator frame
 * (`node scripts/ocr-probe.mjs`, 2026-10-15), not from the upstream design:
 *
 *   - engine: `tesseract.js` WASM with the language data **shipped inside the
 *     package** (`ocr/<lang>.traineddata.gz`, `4.0.0_fast`: eng 1,984,273 +
 *     chi_sim 1,730,011 bytes gzipped). `langPath` points at that directory and
 *     `cacheMethod: "none"`, so nothing is downloaded and nothing is written
 *     next to the process - measured: 0 new files in cwd, 0 extras in `ocr/`;
 *   - cost: worker boot 169ms, first frame 655ms, second frame 601ms ⇒ a
 *     singleton worker is reused, and one recognition is cheaper than one
 *     `uiautomator dump` (2.4s);
 *   - boxes: word boxes are tight (`TapTap` at conf 92 → centre 1206,241), but
 *     **a line can span a whole launcher row** (measured x0=4..x1=1441, mean conf
 *     60), so a line hit must take the box - and the confidence - of the words it
 *     actually matched, not its own;
 *   - matching: tesseract writes CJK with a space between glyphs
 *     (`游 戏 中 心`), so needle comparison ignores whitespace - and a
 *     multi-glyph label then matches no single word, which is exactly why the
 *     line path cannot be dropped either.
 *
 * Upstream's route (Google Cloud Vision plus a user API key) is deliberately NOT
 * reproduced: a key the operator must obtain is the opposite of "install and
 * use", and the only thing this is for - finding text a hierarchy cannot show -
 * works offline.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the packaged language data lives (`ocr/<lang>.traineddata.gz`). */
const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface OcrBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface OcrHit {
  readonly text: string;
  readonly confidence: number;
  readonly box: OcrBox;
  readonly center: { x: number; y: number };
  /**
   * For a line hit: the words that made it up, in order, with their own
   * confidences. A line box can span a whole launcher row (measured
   * `x0=4..x1=1441`, and the row's mean confidence is 60 while the label inside
   * it scores 92-96), which makes the line box useless as a tap point and the
   * line confidence the wrong thing to gate on - so both come from the words.
   */
  readonly words?: readonly { text: string; box: OcrBox; confidence: number }[];
}

export interface OcrPage {
  readonly hits: readonly OcrHit[];
  readonly text: string;
  readonly confidence: number;
  readonly ms: number;
}

export interface OcrEngine {
  recognize(png: Buffer, options?: { signal?: AbortSignal }): Promise<OcrPage | undefined>;
  /** What the package alone can answer, without starting the worker (T5 diagnosis). */
  status(): { langs: readonly string[]; missingData: readonly string[]; workerStarted: boolean };
  dispose(): Promise<void>;
}

/**
 * Measured on the live frame: the words a real label is made of score 72-96, the
 * noise (status-bar glyphs, icon fragments, launcher doodles) 0-47. 60 sits
 * between the two.
 *
 * This gates the confidence of the **matched words**, never of the line: the
 * measured launcher row reads as one line whose mean confidence is exactly 60,
 * because eight fragments of icon drag a `游戏 中 心` (96/93/92) down with it. The
 * thing being tapped is the label, so the label is what has to be readable.
 */
export const OCR_MIN_CONFIDENCE = 60;
export const OCR_DEFAULT_LANGS = "eng+chi_sim";
export const OCR_DEFAULT_TIMEOUT_MS = 8_000;

/** tesseract's own word/line records, narrowed to what this file reads. */
interface WordLike {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}
interface LineLike {
  text?: string;
  confidence?: number;
  words?: WordLike[];
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}
interface BlockLike {
  paragraphs?: { lines?: LineLike[] }[];
}
export interface OcrDataLike {
  blocks?: BlockLike[];
  text?: string;
  confidence?: number;
}

/** Whitespace-insensitive comparison: `游 戏 中 心` is `游戏中心`. */
export function normalizeOcrText(value: string): string {
  return value.replace(/\s+/gu, "").toLowerCase();
}

function hitFrom(
  text: string,
  confidence: number,
  box: OcrBox,
  words?: readonly { text: string; box: OcrBox; confidence: number }[],
): OcrHit {
  return {
    text,
    confidence,
    box,
    center: {
      x: Math.round((box.left + box.right) / 2),
      y: Math.round((box.top + box.bottom) / 2),
    },
    ...(words === undefined ? {} : { words }),
  };
}

/**
 * Flatten the block tree into hits. Every word is a hit (that is the tight
 * case), and every line is a hit too - boxed by its own words, which is how a
 * CJK label spread over spaced glyphs (`游 戏 中 心`) stays findable at all.
 */
export function parseOcrData(data: OcrDataLike): OcrHit[] {
  const hits: OcrHit[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const words = (line.words ?? []).filter((word) => (word.text ?? "").trim().length > 0 && word.bbox);
        for (const word of words) {
          hits.push(hitFrom((word.text ?? "").trim(), numberOr(word.confidence, 0), boxOf(word.bbox!)));
        }
        // A line is worth its own hit only when it says more than any single
        // word in it does - which is exactly the CJK case (spaced glyphs).
        const lineText = (line.text ?? "").trim();
        if (lineText.length === 0 || words.length < 2) continue;
        hits.push(
          hitFrom(
            lineText.replace(/\s+/gu, " "),
            numberOr(line.confidence, 0),
            mergedBox(words.map((word) => boxOf(word.bbox!))),
            words.map((word) => ({
              text: (word.text ?? "").trim(),
              box: boxOf(word.bbox!),
              confidence: numberOr(word.confidence, 0),
            })),
          ),
        );
      }
    }
  }
  return hits;
}

/**
 * What a needle actually matched inside a hit: the box of the shortest run of
 * the line's words whose joined text contains it, and the confidence of that run
 * (its weakest word). Without this, a label found on a launcher row would be
 * tapped in the middle of the row and judged by the row's mean confidence.
 * Undefined means the needle is not in this hit.
 */
export function matchWindow(
  hit: OcrHit,
  needle: string,
): { box: OcrBox; confidence: number } | undefined {
  const words = hit.words;
  if (words === undefined || words.length === 0) return { box: hit.box, confidence: hit.confidence };
  const wanted = normalizeOcrText(needle);
  let best: { box: OcrBox; confidence: number; span: number } | undefined;
  for (let start = 0; start < words.length; start += 1) {
    let joined = "";
    for (let end = start; end < words.length; end += 1) {
      const word = words[end]!;
      joined += word.text;
      if (joined.length >= 800) break;
      if (normalizeOcrText(joined).includes(wanted)) {
        const run = words.slice(start, end + 1);
        // Tightest run wins; ties go to the earlier one.
        const candidate = {
          box: mergedBox(run.map((part) => part.box)),
          confidence: Math.min(...run.map((part) => part.confidence)),
          span: end - start,
        };
        if (best === undefined || candidate.span < best.span) best = candidate;
        break;
      }
    }
  }
  if (best === undefined) return undefined;
  return { box: best.box, confidence: best.confidence };
}

function boxOf(raw: { x0: number; y0: number; x1: number; y1: number }): OcrBox {
  return { left: raw.x0, top: raw.y0, right: raw.x1, bottom: raw.y1 };
}

function mergedBox(boxes: readonly OcrBox[]): OcrBox {
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Hits that read as `needle` and whose matched text clears the confidence floor,
 * each carrying the box of the words it actually matched - so the tap point is
 * the label, not the launcher row it sits on.
 */
export function findNeedleHits(page: OcrPage, needle: string): OcrHit[] {
  const wanted = normalizeOcrText(needle);
  if (wanted.length === 0) return [];
  const hits: OcrHit[] = [];
  for (const hit of page.hits) {
    if (!normalizeOcrText(hit.text).includes(wanted)) continue;
    const matched = matchWindow(hit, needle);
    if (matched === undefined || matched.confidence < OCR_MIN_CONFIDENCE) continue;
    hits.push(matched.box === hit.box ? hit : reBoxed(hit, matched.box));
  }
  return hits;
}

function reBoxed(hit: OcrHit, box: OcrBox): OcrHit {
  return {
    text: hit.text,
    confidence: hit.confidence,
    box,
    center: { x: Math.round((box.left + box.right) / 2), y: Math.round((box.top + box.bottom) / 2) },
  };
}

/**
 * The point to tap, or nothing. Ambiguity is refused rather than guessed: two
 * matching labels on different spots mean the caller has to look again (or use
 * a `{index}` handle), which is the same conservative direction G67 takes.
 */
export function chooseHitPoint(hits: readonly OcrHit[]): { x: number; y: number } | undefined {
  const distinct = new Map<string, OcrHit>();
  for (const hit of hits) {
    const key = `${hit.center.x},${hit.center.y}`;
    if (!distinct.has(key)) distinct.set(key, hit);
  }
  if (distinct.size === 0) return undefined;
  if (distinct.size > 1) return undefined;
  return [...distinct.values()][0]!.center;
}

export interface OcrWorkerLike {
  recognize(
    image: Uint8Array,
    options?: unknown,
    output?: { blocks?: boolean; text?: boolean; [key: string]: unknown },
  ): Promise<{ data: OcrDataLike }>;
  terminate(): Promise<unknown>;
}

export interface OcrEngineOptions {
  langs?: string;
  timeoutMs?: number;
  /** Injected in tests; the default spawns the WASM worker on first use. */
  workerFactory?: (langs: string[]) => Promise<OcrWorkerLike>;
  logger?: { warn(message: string): void };
}

function defaultWorkerFactory(langs: string[]): Promise<OcrWorkerLike> {
  const require = createRequire(join(PACKAGE_DIR, "package.json"));
  const tesseract = require("tesseract.js") as {
    createWorker(
      langs: string[],
      oem: number,
      options: Record<string, unknown>,
    ): Promise<OcrWorkerLike>;
  };
  return tesseract.createWorker(langs, 1, {
    // Both of these are the "no extra install, no stray files" half of the
    // design: the language data comes from the package, and nothing is cached
    // next to the process (measured default behaviour: it downloads into cwd).
    langPath: join(PACKAGE_DIR, "ocr"),
    cacheMethod: "none",
    gzip: true,
    logger: () => undefined,
  });
}

/** Languages whose packaged data is not on disk — the "install and use" failure. */
export function missingLanguageData(langs: readonly string[]): string[] {
  return langs.filter((lang) => !existsSync(join(PACKAGE_DIR, "ocr", `${lang}.traineddata.gz`)));
}

/**
 * The engine. One worker, built lazily, reused for the plugin's lifetime and
 * terminated by the disposer `apply()` registers. A failure is `undefined`:
 * OCR only ever *adds* an answer to a text lookup that would otherwise fail, and
 * it must never turn into an action failure or a mount failure.
 */
export function createOcrEngine(options: OcrEngineOptions = {}): OcrEngine {
  const langs = (options.langs ?? OCR_DEFAULT_LANGS).split("+").map((lang) => lang.trim()).filter(Boolean);
  const timeoutMs = options.timeoutMs ?? OCR_DEFAULT_TIMEOUT_MS;
  const factory = options.workerFactory ?? (() => defaultWorkerFactory(langs));
  let worker: OcrWorkerLike | undefined;
  let starting: Promise<OcrWorkerLike> | undefined;
  let disposed = false;

  const start = () => {
    starting ??= factory(langs).then(
      (created) => {
        worker = created;
        return created;
      },
      (error) => {
        starting = undefined;
        throw error;
      },
    );
    return starting;
  };

  return {
    async recognize(png, recognizeOptions) {
      if (disposed || langs.length === 0) return undefined;
      const at = Date.now();
      try {
        const engine = worker ?? (await start());
        const outcome = await withTimeout(engine.recognize(png, {}, { blocks: true, text: true }), timeoutMs, recognizeOptions?.signal);
        if (outcome === undefined) return undefined;
        return {
          hits: parseOcrData(outcome.data),
          text: String(outcome.data.text ?? ""),
          confidence: numberOr(outcome.data.confidence, 0),
          ms: Date.now() - at,
        };
      } catch (error) {
        options.logger?.warn(`[ocr] recognition unavailable: ${(error as Error)?.message ?? error}`);
        return undefined;
      }
    },

    status() {
      return { langs, missingData: missingLanguageData(langs), workerStarted: worker !== undefined };
    },

    async dispose() {
      disposed = true;
      const engine = worker;
      worker = undefined;
      starting = undefined;
      if (engine !== undefined) {
        try {
          await engine.terminate();
        } catch {
          // A worker that will not terminate is not worth failing a teardown for.
        }
      }
    },
  };
}

/** R15: the host does not enforce our timeouts, so this one is ours to keep. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
      if (signal !== undefined) {
        onAbort = () => resolve(undefined);
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      promise.then(resolve, reject);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (signal !== undefined && onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}
