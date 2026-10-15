#!/usr/bin/env node
/**
 * G92 探针 B（真机召回数字）—— 方案与判据见 docs/TODO.md §七「G92 · OCR 按区域识别」。
 *
 * 它量的是：同一张真机帧、同一套 needle（全部来自同屏 `uiautomator dump` 的带文字节点），
 * 整帧 OCR / P1（层级 bounds 区域）/ P3（规则网格）各能答出多少个，以及各自的耗时。
 * 命中判定复用**生产同一函数** `findNeedleHits`，探针不自造第二套匹配口径。
 *
 * 用法（默认现采现用，需 adb 与一台在线设备）：
 *   node scripts/probe-recall.mjs                       # 采帧 + 层级，跑全部测量
 *   node scripts/probe-recall.mjs --frame f.png --hierarchy h.xml   # 复跑既有夹具
 *   node scripts/probe-recall.mjs --needle 游戏中心      # 只看某几个 needle
 *
 * 退出码：0 跑通 / 2 前置没就绪（adb、设备、帧或层级读不出、OCR 数据缺失）。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const bail = (msg) => {
  console.error(`probe-recall: PRECONDITION - ${msg}`);
  process.exit(2);
};

const dist = (p) => pathToFileURL(join(PKG, 'dist', p)).href;
const { parseHierarchyXml } = await import(dist('device/hierarchy.js'));
const { createOcrEngine, findNeedleHits, missingLanguageData, normalizeOcrText, OCR_DEFAULT_LANGS } = await import(dist('ocr/recognize.js'));
const { recognizeRegions, DEFAULT_REGION_OPTIONS } = await import(dist('ocr/regions.js'));
const { decodePng } = await import(dist('effect/png.js'));
const { cropImage, encodePng, fromDecoded, upscaleNearest } = await import(dist('ocr/image.js'));

const missing = missingLanguageData(OCR_DEFAULT_LANGS.split('+'));
if (missing.length) bail(`OCR 语言数据缺失：${missing.join(',')}`);

const serial = arg('--serial');
const framePath = arg('--frame');
const hierarchyPath = arg('--hierarchy');
const keepDir = arg('--out');
const adb = (...a) => execFileSync('adb', serial ? ['-s', serial, ...a] : a, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });

let framePng;
let xml;
if (framePath && hierarchyPath) {
  framePng = readFileSync(framePath);
  xml = readFileSync(hierarchyPath, 'utf8');
} else {
  if (framePath || hierarchyPath) bail('--frame 与 --hierarchy 要么都给，要么都不给');
  try {
    const listed = adb('devices').toString('utf8');
    if (!/\tdevice\b/.test(listed)) bail(`没有 device 状态的设备：\n${listed}`);
    // 实测：`uiautomator dump` 在这台设备上 exit 139 却照样写出文件（生产路径早就按这条事实写的），
    // 所以探针也不能拿 exec 的退出码当失败判据 —— 判据是「文件读没读回来」。
    try { adb('shell', 'uiautomator', 'dump', '/sdcard/probe-dump.xml'); } catch { /* 139 with a usable dump */ }
    xml = adb('exec-out', 'cat', '/sdcard/probe-dump.xml').toString('utf8');
    adb('shell', 'rm', '/sdcard/probe-dump.xml').toString('utf8');
    framePng = adb('exec-out', 'screencap', '-p');
  } catch (err) {
    bail(`采帧失败：${err.message}`);
  }
  if (keepDir) {
    mkdirSync(keepDir, { recursive: true });
    writeFileSync(join(keepDir, 'frame-desktop.png'), framePng);
    writeFileSync(join(keepDir, 'hierarchy-desktop.xml'), xml);
    console.log(`probe-recall: 夹具已存 ${keepDir}`);
  }
}

const doc = parseHierarchyXml(xml);
if (!doc) bail('层级 XML 解析失败（不是 uiautomator dump？）');
const frame = fromDecoded(decodePng(framePng));
const nodes = doc.nodes;

// needle 集：全部带文字的层级节点文本（去空、去重、去纯符号），长度 >=2 才算「一个能点的东西」
const only = arg('--needle');
let needles = [...new Set(nodes.map((n) => (n.text ?? '').trim()).filter((t) => t.length >= 2 && /[一-鿿A-Za-z]/.test(t)))];
if (only) needles = needles.filter((n) => n.includes(only));
if (needles.length === 0 && !process.argv.includes('--new-labels')) bail('这一屏没有可当 needle 的文字节点');
if (needles.length === 0) console.log('  层级里没有文字节点：needle 集为空，这一屏只能看「像素读得出、层级读不出」那一侧（P1 的可达性）');

const engine = createOcrEngine({ timeoutMs: 120_000 });
const clock = () => Date.now();

const countHits = (page) => {
  if (!page) return { hit: 0, which: [] };
  const which = needles.filter((n) => findNeedleHits(page, n).length > 0);
  return { hit: which.length, which };
};

const rows = [];
const report = async (label, fn) => {
  const t0 = clock();
  const result = await fn();
  const ms = clock() - t0;
  const { hit, which } = countHits(result.page);
  rows.push({ label, hit, ms, extra: result.extra ?? '', which });
  console.log(`  ${label.padEnd(46)} hits=${String(hit).padStart(2)}/${needles.length} ms=${String(ms).padStart(6)} ${result.extra ?? ''}`);
  return { hit, ms, which };
};

console.log(`probe-recall: 帧 ${frame.width}x${frame.height}，节点 ${nodes.length}，needle ${needles.length}`);
console.log(`  needle: ${needles.join(' / ')}`);
console.log(`  层级 rotation=${doc.rotation ?? '未标'}`);
console.log('--- 三级对照');

const whole = await report('整帧 OCR（现状基线）', async () => ({ page: await engine.recognize(framePng) }));
await report(`P1 默认（pad=${DEFAULT_REGION_OPTIONS.paddingPx} scale=${DEFAULT_REGION_OPTIONS.scale} cap=${DEFAULT_REGION_OPTIONS.maxRegions} ratio=${DEFAULT_REGION_OPTIONS.maxAreaRatio}）`, async () => {
  const r = await recognizeRegions(engine, framePng, nodes, {}, { now: clock });
  return { page: r?.page, extra: r ? `candidates=${r.regionCount} scanned=${r.scannedCount} inner=${r.ms}ms` : 'undefined' };
});

// P3：规则网格兜底（src 里没有这条，探针里造，因为它的全部价值就是被量）
const grid = async (cols, rows_, overlap) => {
  const cw = Math.ceil(frame.width / cols);
  const ch = Math.ceil(frame.height / rows_);
  const hits = new Set();
  let blocks = 0;
  let ms = 0;
  for (let r = 0; r < rows_; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const ox = Math.max(0, c * cw - overlap);
      const oy = Math.max(0, r * ch - overlap);
      const right = Math.min(frame.width, (c + 1) * cw + overlap);
      const bottom = Math.min(frame.height, (r + 1) * ch + overlap);
      const crop = cropImage(frame, { left: ox, top: oy, right, bottom });
      if (!crop) continue;
      const t0 = clock();
      const page = await engine.recognize(encodePng(upscaleNearest(crop, 2)));
      ms += clock() - t0;
      blocks += 1;
      if (!page) continue;
      for (const n of needles) if (findNeedleHits(page, n).length > 0) hits.add(n);
    }
  }
  return { page: undefined, hits, blocks, ms };
};
if (process.argv.includes('--new-labels')) {
  // P1 只有在这一刻才会被阶梯触达：标签在像素里读得出、在层级里读不出，
  // 而它又落在某个叶级框内。没有这种屏，就说明这条级的增益在现场够不着。
  console.log('--- 像素读得出、层级读不出的标签（P1 唯一能被触达的赢面）');
  const known = new Set();
  for (const n of nodes) {
    if (n.text) known.add(normalizeOcrText(n.text));
    if (n.contentDesc) known.add(normalizeOcrText(n.contentDesc));
  }
  const r = await recognizeRegions(engine, framePng, nodes, {}, { now: () => Date.now() });
  if (r === undefined) console.log('  区域扫描无输出（没有叶级候选框，或帧不可解）');
  else {
    const novel = r.page.hits.filter((h) => h.text.length >= 2 && !known.has(normalizeOcrText(h.text)));
    console.log(`  候选=${r.regionCount} scanned=${r.scannedCount} 命中=${r.page.hits.length}，其中层级里没有的=${novel.length}`);
    for (const h of novel.slice(0, 20)) {
      console.log(`    "${h.text}" @ [${h.box.left},${h.box.top}][${h.box.right},${h.box.bottom}] conf=${Math.round(h.confidence)}`);
    }
  }
}

for (const [cols, rows_, overlap] of [[4, 3, 24], [6, 5, 16]]) {
  const t0 = clock();
  const g = await grid(cols, rows_, overlap);
  const which = needles.filter((n) => g.hits.has(n));
  const ms = clock() - t0;
  rows.push({ label: `P3 网格 ${cols}x${rows_} +${overlap}px`, hit: which.length, ms, extra: `blocks=${g.blocks}`, which });
  console.log(`  P3 网格 ${cols}x${rows_} +${overlap}px`.padEnd(50) + `hits=${String(which.length).padStart(2)}/${needles.length} ms=${String(ms).padStart(6)} blocks=${g.blocks}`);
}

console.log('--- 常量扫描（一次只动一个变量，R25）');
const quick = process.argv.includes('--quick');
for (const paddingPx of quick ? [] : [0, 8, 16, 24]) {
  await report(`P1 pad=${paddingPx} scale=2 cap=200`, async () => {
    const r = await recognizeRegions(engine, framePng, nodes, { paddingPx, scale: 2, maxRegions: 200, totalBudgetMs: 600_000 }, { now: clock });
    return { page: r?.page, extra: r ? `candidates=${r.regionCount} scanned=${r.scannedCount}` : 'undefined' };
  });
}
for (const scale of quick ? [] : [1.5, 2, 3]) {
  await report(`P1 pad=8 scale=${scale} cap=200`, async () => {
    const r = await recognizeRegions(engine, framePng, nodes, { paddingPx: 8, scale, maxRegions: 200, totalBudgetMs: 600_000 }, { now: clock });
    return { page: r?.page, extra: r ? `candidates=${r.regionCount} scanned=${r.scannedCount}` : 'undefined' };
  });
}
for (const ratio of quick ? [] : [0.25, 0.6, 1]) {
  await report(`P1 maxAreaRatio=${ratio}`, async () => {
    const r = await recognizeRegions(engine, framePng, nodes, { paddingPx: 8, scale: 2, maxRegions: 200, maxAreaRatio: ratio, totalBudgetMs: 600_000 }, { now: clock });
    return { page: r?.page, extra: r ? `candidates=${r.regionCount} scanned=${r.scannedCount}` : 'undefined' };
  });
}

await engine.dispose().catch(() => undefined);

console.log('--- 摘要');const best = [...rows].sort((a, b) => b.hit - a.hit || a.ms - b.ms)[0];
console.log(`整帧基线 ${whole.hit}/${needles.length}；最高召回 ${best.label} = ${best.hit}（${best.ms}ms）`);
console.log(`到期条件「P1 命中率 >= 整帧基线」：${rows.filter((r) => r.label.startsWith('P1 默认')).some((r) => r.hit >= whole.hit) ? '满足' : '不满足'}`);
if (keepDir) {
  writeFileSync(join(keepDir, 'probe-b-readouts.json'), JSON.stringify({ frame: { w: frame.width, h: frame.height }, nodes: nodes.length, needles, rows }, null, 2));
  console.log(`读数已写 ${join(keepDir, 'probe-b-readouts.json')}`);
}
