#!/usr/bin/env node
/**
 * G92 探针 C（纯渲染帧判 P2 去留）—— 方案与判据见 docs/TODO.md §七「G92 · OCR 按区域识别」。
 *
 * 场景：层级只有一个渲染容器、零文本节点（实测：消消乐 `hellolua.MainActivity`，
 * 8 个节点 / 0 个 text）。P1 在这里**结构性失明**（候选框全部来自层级 bounds），
 * 所以本探针量的是 P2（版面投影分割，不依赖层级）能不能自己切出文字行并读出。
 *
 * P2 只在探针里实现 —— 它的唯一任务是「被量」，判活下去或降级（P1+P3）才决定要不要进 src。
 *
 * 参照读手：本地 VLM（默认 http://127.0.0.1:1234/v1）。层级失明时没有 needle 集，
 * 「读出的东西对不对」需要一个独立来源；顺带把「P4 模型视觉定位在这台机器上到底读得出什么」
 * 变成一手读数（§七「重审综合」那条「感知子代理与宿主 VLM 重复」的待拍板项，缺的就是这个数）。
 *
 * 用法：
 *   node scripts/probe-p2.mjs --frame ../../scratch/probe-c/frame-game.png
 *   node scripts/probe-p2.mjs --frame f.png --hierarchy h.xml --model minicpm-v-4.7-1b
 *
 * 退出码：0 跑通（判读结论写在 stdout）/ 2 前置没就绪（帧读不出、VLM 不可达）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const bail = (msg) => {
  console.error(`probe-p2: PRECONDITION - ${msg}`);
  process.exit(2);
};

const dist = (p) => pathToFileURL(join(PKG, 'dist', p)).href;
const { decodePng } = await import(dist('effect/png.js'));
const { cropImage, encodePng, fromDecoded, paddedBox, upscaleNearest } = await import(dist('ocr/image.js'));
const { createOcrEngine, missingLanguageData, OCR_DEFAULT_LANGS } = await import(dist('ocr/recognize.js'));
const { selectRegionCandidates, recognizeRegions } = await import(dist('ocr/regions.js'));
const { parseHierarchyXml } = await import(dist('device/hierarchy.js'));

if (missingLanguageData(OCR_DEFAULT_LANGS.split('+')).length) bail('OCR 语言数据缺失');
const framePath = arg('--frame');
if (!framePath) bail('--frame <png> 必填');

const png = readFileSync(framePath);
let frame;
try {
  frame = fromDecoded(decodePng(png));
} catch (err) {
  bail(`帧解不出：${err.message}`);
}
const { width: W, height: H, rgb } = frame; // rgb: 3 bytes per pixel, row-major

const lum = (x, y) => {
  const i = (y * W + x) * 3;
  return 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
};

// 亮度直方图上的 Otsu 阈值：P2 需要「字 vs 底」的分界，不能靠猜常量
const hist = new Array(256).fill(0);
for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) hist[Math.round(lum(x, y))] += 1;
const total = hist.reduce((a, b) => a + b, 0);
let sum = 0;
let sumB = 0;
for (let i = 0; i < 256; i += 1) {
  sum += i * hist[i];
}
let best = -1;
let thr = 127;
let wB = 0;
for (let i = 0; i < 256; i += 1) {
  wB += hist[i];
  if (wB === 0) continue;
  const wF = total - wB;
  if (wF === 0) break;
  sumB += i * hist[i];
  const mB = sumB / wB;
  const mF = (sum - sumB) / wF;
  const varBetween = wB * wF * (mB - mF) * (mB - mF);
  if (varBetween > best) {
    best = varBetween;
    thr = i;
  }
}

// 极性由 Otsu 两类的占比判（少数类才是文字层），而不是写死「更亮就算墨」——
// 消消乐是亮字暗底，换一个深色 UI 就是反的，写死会让探针在第二种帧上假装切不出行。
const above = hist.reduce((a, c, i) => (i > thr ? a + c : a), 0);
const inkIsBright = above <= total / 2;
const fracInk = (inkIsBright ? above : total - above) / total;
console.log(`probe-p2: 帧 ${W}x${H}，Otsu 阈值=${thr}，极性=${inkIsBright ? '亮字暗底' : '暗字亮底'}，少数类占比=${fracInk.toFixed(3)}`);

const isInk = (x, y) => (inkIsBright ? lum(x, y) > thr : lum(x, y) <= thr);

// 参照 needle：层级失明的帧上没有任何文字节点可当 needle，所以由调用方把独立来源
// （本仓库用本机 VLM 的读手结果）传进来 —— 否则「P1 在这种帧上必然失明」只能靠推理，量不出命中率。
const refNeedles = (arg('--needles', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length >= 2);

// P3 网格兜底（与 probe-recall 同一形状：重叠步长切格，逐格 OCR）
const gridCells = (cols, rws, overlap) => {
  const cw = Math.ceil(W / cols);
  const ch = Math.ceil(H / rws);
  const out = [];
  for (let r = 0; r < rws; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out.push({
        left: Math.max(0, c * cw - overlap),
        top: Math.max(0, r * ch - overlap),
        right: Math.min(W, (c + 1) * cw + overlap),
        bottom: Math.min(H, (r + 1) * ch + overlap),
      });
    }
  }
  return out;
};

const recall = (label, pages) => {
  if (refNeedles.length === 0) return;
  const found = new Set();
  for (const p of pages) {
    if (!p) continue;
    const t = (p.text ?? '').replace(/\s+/g, '');
    for (const n of refNeedles) if (t.includes(n.replace(/\s+/g, ''))) found.add(n);
  }
  console.log(`  参照 needle 召回 ${label.padEnd(22)} ${found.size}/${refNeedles.length}`);
};

// P2 第一步：水平投影找「有墨的带」——行上墨点足够多才算一条带
// --sweep 是给 P2 的公平审判：极性与行阈值各换几档，只看能切出多少带/块（不跑 OCR）。
// 判死一条算法不能凭一组参数。
const measure = (polarity, rowFrac) => {
  const bright = polarity === 'bright' ? true : polarity === 'dark' ? false : inkIsBright;
  const test = (x, y) => (bright ? lum(x, y) > thr : lum(x, y) <= thr);
  const need = Math.max(4, Math.round(W * rowFrac));
  const bd = [];
  let st = -1;
  for (let y = 0; y < H; y += 1) {
    let c = 0;
    for (let x = 0; x < W; x += 1) if (test(x, y)) c += 1;
    const on = c >= need;
    if (on && st < 0) st = y;
    if (!on && st >= 0) {
      if (y - st >= 8) bd.push([st, y]);
      st = -1;
    }
  }
  if (st >= 0 && H - st >= 8) bd.push([st, H]);
  return bd;
};
if (process.argv.includes('--sweep')) {
  console.log('probe-p2: 公平审判（一次只动一个变量，R25）');
  for (const pol of ['auto', 'bright', 'dark']) {
    for (const frac of [0.004, 0.01, 0.02, 0.05]) {
      const bd = measure(pol, frac);
      const tallest = bd.reduce((a, b) => Math.max(a, b[1] - b[0]), 0);
      const covered = bd.reduce((a, b) => a + (b[1] - b[0]), 0);
      console.log(`  polarity=${pol.padEnd(6)} rowFrac=${frac} 带=${String(bd.length).padStart(3)} 最高带=${String(tallest).padStart(4)}px 覆盖=${((covered / H) * 100).toFixed(0)}%`);
    }
  }
  process.exit(0); // 扫描模式只看分割形状，不跑 OCR、不问 VLM
}

const rowInk = Math.max(4, Math.round(W * Number(arg('--row-frac', '0.004'))));
const inkPerRow = new Array(H).fill(0);
for (let y = 0; y < H; y += 1) {
  let c = 0;
  for (let x = 0; x < W; x += 1) if (isInk(x, y)) c += 1;
  inkPerRow[y] = c;
}
const bands = [];
let start = -1;
for (let y = 0; y < H; y += 1) {
  const on = inkPerRow[y] >= rowInk;
  if (on && start < 0) start = y;
  if (!on && start >= 0) {
    if (y - start >= 8) bands.push([start, y]);
    start = -1;
  }
}
if (start >= 0 && H - start >= 8) bands.push([start, H]);

// P2 第二步：在带内做垂直投影切块
const blocks = [];
for (const [top, bottom] of bands) {
  const inkPerCol = new Array(W).fill(0);
  for (let x = 0; x < W; x += 1) {
    let c = 0;
    for (let y = top; y < bottom; y += 1) if (isInk(x, y)) c += 1;
    inkPerCol[x] = c;
  }
  const colInk = Math.max(1, Math.round((bottom - top) * 0.06));
  let cs = -1;
  for (let x = 0; x < W; x += 1) {
    const on = inkPerCol[x] >= colInk;
    if (on && cs < 0) cs = x;
    if (!on && cs >= 0) {
      if (x - cs >= 8) blocks.push({ left: cs, top, right: x, bottom });
      cs = -1;
    }
  }
  if (cs >= 0 && W - cs >= 8) blocks.push({ left: cs, top, right: W, bottom });
}

const engine = createOcrEngine({ timeoutMs: 120_000 });

console.log(`probe-p2: 带=${bands.length}，块=${blocks.length}`);
let p1Page = null;
if (arg('--hierarchy')) {
  const doc = parseHierarchyXml(readFileSync(arg('--hierarchy'), 'utf8'));
  const nodes = doc?.nodes ?? [];
  const textNodes = nodes.filter((n) => (n.text ?? '').trim().length >= 2);
  const cands = selectRegionCandidates(nodes, W, H, {});
  const t0 = Date.now();
  const r = await recognizeRegions(engine, png, nodes, {}, { now: () => Date.now() });
  p1Page = r?.page ?? null;
  console.log(`  对照 P1：节点=${nodes.length} 带文字=${textNodes.length} 候选=${cands.length} -> ${r ? `scanned=${r.scannedCount} hits=${r.page.hits.length} (${Date.now() - t0}ms)` : 'undefined（P1 在此失明）'}`);
}

const read = [];
const p2Pages = [];
const tP2 = Date.now();
for (const b of blocks.slice(0, Number(arg('--max-blocks', '40')))) {
  const box = paddedBox(frame, b, 4) ?? b;
  const crop = cropImage(frame, box);
  if (!crop) continue;
  const page = await engine.recognize(encodePng(upscaleNearest(crop, 2)));
  p2Pages.push(page);
  const text = (page?.text ?? '').replace(/\s+/g, ' ').trim();
  if (text) read.push({ box: [box.left, box.top, box.right, box.bottom], text, conf: Math.round(page.confidence ?? 0) });
}
const p2Ms = Date.now() - tP2;
console.log(`  P2 读出 ${read.length}/${blocks.length} 块有文字（${p2Ms}ms）：`);
for (const r of read.slice(0, 25)) console.log(`    [${r.box.join(',')}] conf=${r.conf} "${r.text.slice(0, 60)}"`);

if (refNeedles.length > 0) {
  console.log(`--- 以参照 needle 计召回（共 ${refNeedles.length} 条，来源见 --needles 注入口径）`);
  const wholePage = await engine.recognize(png);
  recall('整帧', [wholePage]);
  if (p1Page) recall('P1 层级区域', [p1Page]);
  recall('P2 投影片段', p2Pages);
  const p3Pages = [];
  for (const cell of gridCells(6, 5, 16)) {
    const crop = cropImage(frame, cell);
    if (!crop) continue;
    p3Pages.push(await engine.recognize(encodePng(upscaleNearest(crop, 2))));
  }
  recall('P3 网格 6x5', p3Pages);
}

// VLM 参照读手：同帧问一次「图上有哪些可见文字」
const base = arg('--base', 'http://127.0.0.1:1234/v1');
const model = arg('--model', 'minicpm-v-4.7-1b');
let vlm = null;
try {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '列出这张截图中所有可见的文字，逐行输出，不要解释、不要翻译。若没有可读文字，只输出 NONE。' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(png).toString('base64')}` } },
          ],
        },
      ],
      max_tokens: 600,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(Number(arg('--vlm-timeout-ms', '180000'))),
  });
  if (!res.ok) throw new Error(`http ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  vlm = json.choices?.[0]?.message?.content ?? null;
  console.log(`\n  VLM 参照（${model}）：`);
  console.log(typeof vlm === 'string' ? vlm.split('\n').map((l) => `    ${l}`).join('\n') : JSON.stringify(vlm));
} catch (err) {
  console.log(`\n  VLM 参照不可达：${err.message}`);
}

await engine.dispose().catch(() => undefined);

const verdict = bands.length === 0 ? 'P2 切不出任何带 -> 降级 P1+P3'
  : blocks.length === 0 ? 'P2 切得出带但切不出块 -> 降级 P1+P3'
  : read.length === 0 ? 'P2 切出块但一块读不出 -> 降级 P1+P3'
  : `P2 能切能读（${read.length} 块）-> 值得进 src，但准确性以 VLM 参照与人工核对为准`;
console.log(`\n判定：${verdict}`);
if (arg('--out')) {
  mkdirSync(arg('--out'), { recursive: true });
  writeFileSync(join(arg('--out'), 'probe-c-readouts.json'), JSON.stringify({ frame: { W, H }, thr, bands: bands.length, blocks: blocks.length, p2Ms, read, vlm }, null, 2));
  console.log(`读数已写 ${join(arg('--out'), 'probe-c-readouts.json')}`);
}
