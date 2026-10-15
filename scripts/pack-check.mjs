#!/usr/bin/env node
// 交付清单探针：pnpm pack 出来的 tarball 必须正好等于「files 白名单 ∪ 打包器强制携带 ∪ 由 src 推导的 dist」。
// 预期与被测物异源：dist 目录本身不参与预期计算（否则塞进一个多余 js 会同时改掉两侧，判据永不红）。
// 只用 Node 内置模块，零依赖（同 scripts/check-env.mjs / scripts/check-docs.mjs 一族）。
//
// 退出码：0 通过 / 1 清单或混淆锁不符 / 2 前置没准备好（dist 缺失、pack 失败、包读不出）

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pluginDir = join(repoRoot, 'plugins', 'dsh-autogamer');
const toPosix = (p) => p.split(sep).join('/');

const fail2 = (msg) => {
  console.error(`pack-check: PRECONDITION - ${msg}`);
  process.exit(2);
};

const argv = process.argv.slice(2);
const givenTarball = (() => {
  const i = argv.indexOf('--tarball');
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (!v) fail2('--tarball 需要一个路径参数');
  return v;
})();

// tar = gzip + 512 字节头；自己解析是因为判据要在 PowerShell / cmd 里同样能跑，外部 tar 不在保证范围内。
const readTar = (file) => {
  const buf = gunzipSync(readFileSync(file));
  const entries = [];
  let offset = 0;
  let longName = null;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const cstr = (start, len) => {
      const raw = header.subarray(start, start + len);
      const end = raw.indexOf(0);
      return (end < 0 ? raw : raw.subarray(0, end)).toString('utf8');
    };
    const typeflag = String.fromCharCode(header[156] || 48);
    const size = parseInt(cstr(124, 12).trim() || '0', 8) || 0;
    const data = buf.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (typeflag === 'L') {
      longName = data.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (typeflag === 'x' || typeflag === 'g') continue;
    const prefix = cstr(345, 155);
    let name = longName ?? (prefix ? `${prefix}/` : '') + cstr(0, 100);
    longName = null;
    if (typeflag === '5' || name.endsWith('/')) continue;
    entries.push({ name: name.replace(/^package\//, ''), content: Buffer.from(data) });
  }
  return entries;
};

const globToRe = (glob) => {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
        if (glob[i + 1] === '/') i += 1; // `**/` 也匹配零段
      } else out += '[^/]*';
    } else if ('+.?^${}()|[]\\'.includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`^${out}$`);
};

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(toPosix(relative(pluginDir, p)));
  }
  return out;
};

const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
const tree = walk(pluginDir).filter((f) => !f.startsWith('dist/')); // dist 一律不进预期
const declared = (pkg.files ?? []).map(globToRe);
const fromWhitelist = tree.filter((f) => declared.some((re) => re.test(f)));
// 打包器无条件携带的那几件
const forced = tree.filter((f) => /^(package\.json|readme(\.|$)|licen[cs]e(\.|$))/i.test(f));
const fromSrc = walk(join(pluginDir, 'src'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => `dist/${f.slice('src/'.length).replace(/\.ts$/, '.js')}`);
const wanted = [...new Set([...fromWhitelist, ...forced, ...fromSrc])].sort();

let tarball = givenTarball;
let tempDir = null;
if (!tarball) {
  if (!existsSync(join(pluginDir, 'dist'))) {
    fail2('plugins/dsh-autogamer/dist 不存在 —— 先跑 pnpm --config.verify-deps-before-run=false run build（verify 三段里没有 clean-dist，pack 前必须 build）');
  }
  tempDir = mkdtempSync(join(tmpdir(), 'pack-check-'));
  // pnpm 在 Windows 上是 .cmd（批处理），不经 shell 起不来 ⇒ 自己加引号，路径带空格也不散架
  const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const command = `"${pnpmBin}" --config.verify-deps-before-run=false pack --pack-destination "${tempDir}"`;
  const run = spawnSync(command, { cwd: pluginDir, encoding: 'utf8', shell: true });
  if (run.error || run.status !== 0) {
    rmSync(tempDir, { recursive: true, force: true });
    fail2(`pnpm pack exit ${run.status}${run.error ? ` (${run.error.message})` : ''}\n${run.stderr || run.stdout}`);
  }
  const made = readdirSync(tempDir).find((f) => f.endsWith('.tgz'));
  if (!made) fail2(`pack 跑完但 ${toPosix(tempDir)} 里没有 .tgz`);
  tarball = join(tempDir, made);
}
if (!existsSync(tarball)) fail2(`tarball 读不出：${tarball}`);

let entries;
try {
  entries = readTar(tarball);
} catch (err) {
  fail2(`tar 解析失败：${err.message}`);
}
const found = entries.map((e) => e.name).sort();

const extra = found.filter((f) => !wanted.includes(f));
const missing = wanted.filter((f) => !found.includes(f));
const banned = found.filter(
  (f) => /^(src|tests|scripts)\//.test(f) || f.endsWith('.d.ts') || /pnpm-lock\.yaml|pnpm-workspace\.yaml/.test(f),
);

const pkgEntry = entries.find((e) => e.name === 'package.json');
if (!pkgEntry) fail2('tarball 里没有 package.json');
const obfuscation = 'packageManager' in JSON.parse(pkgEntry.content.toString('utf8'))
  ? 'packed package.json 里出现 packageManager（pnpm 的 manifest 混淆默认应摘掉它）'
  : 'ok';

if (tempDir) rmSync(tempDir, { recursive: true, force: true });

console.log(`pack-check: entries=${found.length} wanted=${wanted.length} (files=${fromWhitelist.length} forced=${forced.length} src-derived dist=${fromSrc.length})`);
console.log(`  extra=${JSON.stringify(extra)}`);
console.log(`  missing=${JSON.stringify(missing)}`);
console.log(`  banned=${JSON.stringify(banned)}`);
console.log(`  obfuscation=${obfuscation}`);
if (extra.length || missing.length || banned.length || obfuscation !== 'ok') {
  console.error('pack-check: FAILED');
  process.exit(1);
}
console.log('pack-check: OK (交付清单与构成式一致，manifest 混淆锁在位)');
