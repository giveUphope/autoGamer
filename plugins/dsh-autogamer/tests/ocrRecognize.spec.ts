/**
 * T5: the built-in offline OCR.
 *
 * The data shapes here are not invented — they are the records `node
 * scripts/ocr-probe.mjs` read out of the real emulator frame
 * (`tests/fixtures/screen-chrome-tab-overview.png`, 1600x900, 2026-10-15). That
 * frame is why this module looks the way it does: one tesseract "line" spans the
 * whole launcher row (`x0=4..x1=1441`, centre 723,245 — the middle of nothing,
 * mean confidence 60), while the label inside it is three tight words
 * (`游戏 中 心`, 92-96, centre 1003,240). A line hit that kept its own box and its
 * own confidence would tap the wrong app and refuse the right one.
 *
 * Locked here:
 *   - hit model: every word is a hit, a line is a hit only when it says more than
 *     any one word does (the spaced-CJK case), and a line hit keeps its words so
 *     the matching window can be re-boxed and re-scored from them;
 *   - the confidence floor measured between labels (72-96) and noise (0-47);
 *   - ambiguity is refused, not guessed;
 *   - the engine is fail-open: any worker error, timeout or abort means
 *     "OCR had nothing to say", never an action failure;
 *   - one worker for the plugin's lifetime, terminated once by dispose.
 */
import { describe, expect, it, vi } from "vitest";
import {
  OCR_MIN_CONFIDENCE,
  chooseHitPoint,
  createOcrEngine,
  findNeedleHits,
  matchWindow,
  normalizeOcrText,
  missingLanguageData,
  parseOcrData,
  type OcrDataLike,
  type OcrPage,
  type OcrWorkerLike,
} from "../src/ocr/recognize.js";

/** A word record in tesseract's own shape. */
function word(text: string, confidence: number, box: [number, number, number, number]) {
  return { text, confidence, bbox: { x0: box[0], y0: box[1], x1: box[2], y1: box[3] } };
}

function page(data: OcrDataLike): OcrPage {
  return { hits: parseOcrData(data), text: String(data.text ?? ""), confidence: 0, ms: 0 };
}

// The launcher row exactly as the probe reported it.
const rowLine = {
  text: ": : ° ee 有 ey ‘el @ @ 游戏 中 心 TapTap 光环 助手\n",
  confidence: 60,
  bbox: { x0: 4, y0: 210, x1: 1441, y1: 280 },
  words: [
    word(":", 32, [4, 223, 8, 227]),
    word(":", 22, [82, 227, 84, 229]),
    word("°", 0, [150, 240, 152, 242]),
    word("ee", 31, [210, 210, 375, 280]),
    word("有", 7, [505, 231, 514, 239]),
    word("ey", 45, [625, 233, 653, 265]),
    word("‘el", 44, [662, 232, 687, 259]),
    word("@", 90, [701, 237, 725, 261]),
    word("@", 91, [739, 237, 763, 261]),
    word("游戏", 96, [971, 224, 1009, 256]),
    word("中", 93, [1009, 232, 1018, 248]),
    word("心", 92, [1025, 233, 1035, 248]),
    word("TapTap", 92, [1179, 233, 1233, 249]),
    word("光环", 96, [1377, 232, 1417, 248]),
    word("助手", 96, [1416, 225, 1441, 252]),
  ],
};

// A single-word line: the case where a word hit already says everything.
const clockLine = {
  text: "03:27",
  confidence: 71,
  bbox: { x0: 8, y0: 9, x1: 49, y1: 20 },
  words: [word("03:27", 71, [8, 9, 49, 20])],
};

const FRAME: OcrDataLike = {
  blocks: [{ paragraphs: [{ lines: [clockLine, rowLine] }] }],
  text: "03:27\n游戏 中 心 TapTap 光环 助手\n",
  confidence: 55,
};

function lineHitOf(data: OcrDataLike) {
  return parseOcrData(data).find((hit) => hit.words !== undefined)!;
}

function workerReturning(data: OcrDataLike, over: Partial<OcrWorkerLike> = {}): OcrWorkerLike {
  return {
    recognize: vi.fn(async () => ({ data })),
    terminate: vi.fn(async () => undefined),
    ...over,
  };
}

describe("OCR hit model (measured frame shapes)", () => {
  it("makes every word a hit with its own tight box", () => {
    const taptap = parseOcrData(FRAME).filter((hit) => hit.text === "TapTap" && hit.words === undefined);
    expect(taptap).toHaveLength(1);
    expect(taptap[0]!.center).toEqual({ x: 1206, y: 241 });
    expect(taptap[0]!.confidence).toBe(92);
  });

  it("keeps a line hit that spans the row, with its words attached", () => {
    const line = lineHitOf(FRAME);
    expect(line.box).toEqual({ left: 4, top: 210, right: 1441, bottom: 280 });
    expect(line.center).toEqual({ x: 723, y: 245 });
    expect(line.words).toHaveLength(15);
    expect(line.words![9]).toEqual({ text: "游戏", box: { left: 971, top: 224, right: 1009, bottom: 256 }, confidence: 96 });
  });

  it("does not spend a line hit on a line that is one word", () => {
    const hits = parseOcrData(FRAME).filter((hit) => hit.text === "03:27");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.words).toBeUndefined();
  });

  it("drops words with no text or no box instead of inventing a point", () => {
    const hits = parseOcrData({
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  text: "x",
                  confidence: 90,
                  words: [{ text: " " }, { text: "y" }, word("z", 95, [1, 1, 3, 3])],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(hits.map((hit) => hit.text)).toEqual(["z"]);
  });
});

describe("needle resolution", () => {
  it("normalizes away the spaces tesseract puts between CJK glyphs", () => {
    expect(normalizeOcrText("游 戏 中 心")).toBe("游戏中心");
    expect(normalizeOcrText("Tap Tap")).toBe("taptap");
  });

  it("re-boxes a spaced-CJK label to the words it matched, not the row", () => {
    const line = lineHitOf(FRAME);
    expect(matchWindow(line, "游戏中心")).toEqual({
      box: { left: 971, top: 224, right: 1035, bottom: 256 },
      confidence: 92,
    });
    expect(matchWindow(line, "光环助手")).toEqual({
      box: { left: 1377, top: 225, right: 1441, bottom: 252 },
      confidence: 96,
    });
    expect(matchWindow(line, "不在这一行")).toBeUndefined();
  });

  it("returns the label centre for a multi-glyph needle", () => {
    const hits = findNeedleHits(page(FRAME), "游戏中心");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.center).toEqual({ x: 1003, y: 240 });
    expect(chooseHitPoint(hits)).toEqual({ x: 1003, y: 240 });
  });

  it("counts a word hit and its line hit as one point, so a real label is not ambiguous", () => {
    const hits = findNeedleHits(page(FRAME), "TapTap");
    expect(hits).toHaveLength(2);
    expect(new Set(hits.map((hit) => `${hit.center.x},${hit.center.y}`))).toEqual(new Set(["1206,241"]));
    expect(chooseHitPoint(hits)).toEqual({ x: 1206, y: 241 });
  });

  it("gates on the matched words, both ways round", () => {
    // Measured: this row's mean confidence is 60 because eight icon fragments
    // drag the label down with it — a line-level gate would refuse a real label.
    expect(lineHitOf(FRAME).confidence).toBe(60);
    expect(findNeedleHits(page(FRAME), "游戏中心")).toHaveLength(1);
    // ...and the same row must not vouch for the noise inside it: a confident
    // line made of low-confidence words is refused.
    const noisy = {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  text: "START 有",
                  confidence: 99,
                  bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
                  words: [word("START", 99, [0, 0, 60, 20]), word("有", 7, [70, 2, 80, 12])],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(findNeedleHits(page(noisy), "有")).toEqual([]);
    // The clear word of that line still resolves - to its own box (centre 30,10),
    // not the line's (50,10).
    expect(chooseHitPoint(findNeedleHits(page(noisy), "START"))).toEqual({ x: 30, y: 10 });
  });

  it("refuses the noise measured on the live frame, and keeps the labels", () => {
    const p = page(FRAME);
    expect(findNeedleHits(p, "ey")).toEqual([]);
    expect(findNeedleHits(p, "有")).toEqual([]);
    expect(findNeedleHits(p, "°")).toEqual([]);
    // Two identical icon glyphs do read clearly, and each is re-boxed to its own
    // word: three hits, two distinct points, so nothing is guessed between them.
    expect(findNeedleHits(p, "@")).toHaveLength(3);
    expect(chooseHitPoint(findNeedleHits(p, "@"))).toBeUndefined();
    // the floor sits strictly between the worst real label and the best noise
    expect(OCR_MIN_CONFIDENCE).toBeGreaterThan(45);
    expect(OCR_MIN_CONFIDENCE).toBeLessThanOrEqual(72);
  });

  it("refuses an empty needle rather than matching every box", () => {
    expect(findNeedleHits(page(FRAME), "  ")).toEqual([]);
  });

  it("refuses ambiguity instead of guessing between two labels", () => {
    const hits = findNeedleHits(page(FRAME), "助手");
    expect(hits.length).toBeGreaterThan(0);
    const two = [
      hits[0]!,
      { ...hits[0]!, center: { x: 999, y: 999 }, box: { left: 990, top: 990, right: 1008, bottom: 1008 } },
    ];
    expect(chooseHitPoint(two)).toBeUndefined();
    expect(chooseHitPoint([])).toBeUndefined();
  });
});

describe("engine lifecycle and fail-open behaviour", () => {
  it("starts one worker, reuses it, and parses the page it returns", async () => {
    const factory = vi.fn(async () => workerReturning(FRAME));
    const engine = createOcrEngine({ workerFactory: factory });
    const first = await engine.recognize(Buffer.from("png"));
    const second = await engine.recognize(Buffer.from("png"));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(first!.hits.length).toBe(second!.hits.length);
    expect(first!.hits.length).toBeGreaterThan(0);
    expect(first!.text).toContain("TapTap");
    expect(first!.ms).toBeGreaterThanOrEqual(0);
    await engine.dispose();
  });

  it("passes the configured languages through as a trimmed list", async () => {
    const factory = vi.fn(async () => workerReturning(FRAME));
    const engine = createOcrEngine({ langs: " eng + chi_sim ", workerFactory: factory });
    expect(await engine.recognize(Buffer.from("png"))).toBeDefined();
    expect(factory).toHaveBeenCalledWith(["eng", "chi_sim"]);
    await engine.dispose();
  });

  it("recognizes nothing without a worker when there are no languages", async () => {
    const factory = vi.fn(async () => workerReturning(FRAME));
    const engine = createOcrEngine({ langs: "", workerFactory: factory });
    expect(await engine.recognize(Buffer.from("png"))).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
  });

  it("is undefined — not an error — when the worker rejects", async () => {
    const logger = { warn: vi.fn() };
    const engine = createOcrEngine({
      logger,
      workerFactory: async () =>
        workerReturning(FRAME, {
          recognize: vi.fn(async () => {
            throw new Error("wasm died");
          }),
        }),
    });
    expect(await engine.recognize(Buffer.from("png"))).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("wasm died"));
    await engine.dispose();
  });

  it("does not poison itself when the worker fails to start, and retries", async () => {
    const logger = { warn: vi.fn() };
    let attempts = 0;
    const engine = createOcrEngine({
      logger,
      workerFactory: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("no traineddata");
        return workerReturning(FRAME);
      },
    });
    expect(await engine.recognize(Buffer.from("png"))).toBeUndefined();
    expect((await engine.recognize(Buffer.from("png")))?.hits.length).toBeGreaterThan(0);
    expect(attempts).toBe(2);
    await engine.dispose();
  });

  it("gives up on its own timeout (R15: the host does not enforce ours)", async () => {
    const slow = workerReturning(FRAME, {
      recognize: vi.fn(
        () => new Promise<{ data: OcrDataLike }>((resolve) => setTimeout(() => resolve({ data: FRAME }), 50))),
    });
    const engine = createOcrEngine({ timeoutMs: 5, workerFactory: async () => slow });
    expect(await engine.recognize(Buffer.from("png"))).toBeUndefined();
    await engine.dispose();
  });

  it("gives up when the call is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const slow = workerReturning(FRAME, {
      recognize: vi.fn(
        () => new Promise<{ data: OcrDataLike }>((resolve) => setTimeout(() => resolve({ data: FRAME }), 50))),
    });
    const engine = createOcrEngine({ timeoutMs: 5_000, workerFactory: async () => slow });
    expect(await engine.recognize(Buffer.from("png"), { signal: controller.signal })).toBeUndefined();
    await engine.dispose();
  });

  it("reports what the package can answer before any worker starts", async () => {
    const engine = createOcrEngine({ langs: "eng+chi_sim", workerFactory: async () => workerReturning(FRAME) });
    expect(engine.status()).toEqual({ langs: ["eng", "chi_sim"], missingData: [], workerStarted: false });
    await engine.recognize(Buffer.from("png"));
    expect(engine.status().workerStarted).toBe(true);
    await engine.dispose();
    expect(engine.status().workerStarted).toBe(false);
  });

  it("names a language whose data is not in the package", () => {
    expect(missingLanguageData(["eng", "chi_sim"])).toEqual([]);
    expect(missingLanguageData(["nosuchlang"])).toEqual(["nosuchlang"]);
  });

  it("terminates the worker once and recognizes nothing after dispose", async () => {
    const worker = workerReturning(FRAME);
    const engine = createOcrEngine({ workerFactory: async () => worker });
    await engine.recognize(Buffer.from("png"));
    await engine.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(await engine.recognize(Buffer.from("png"))).toBeUndefined();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(engine.dispose()).resolves.toBeUndefined();
  });

  it("survives a worker that refuses to terminate", async () => {
    const worker = workerReturning(FRAME, {
      terminate: vi.fn(async () => {
        throw new Error("hung");
      }),
    });
    const engine = createOcrEngine({ workerFactory: async () => worker });
    await expect(engine.dispose()).resolves.toBeUndefined();
  });
});
