// @vitest-environment node
/**
 * sync-wheel-resources.mjs 的 CLI 行为测试（spawn 真实进程，校验退出码）。
 * 通过 --src / --dest 注入临时目录，绝不触碰真实的 artemis/resources/showcase_ui。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(new URL('./sync-wheel-resources.mjs', import.meta.url));

const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeSourceFixture(root) {
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><body>bundle</body></html>');
  writeFileSync(path.join(root, 'assets', 'index-abc123.js'), 'console.log("app");');
  writeFileSync(path.join(root, 'assets', 'index-def456.css'), 'body { margin: 0; }');
  writeFileSync(path.join(root, 'favicon.ico'), 'fake-ico');
}

function runScript(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('sync-wheel-resources', () => {
  it('exits non-zero with a build hint when the dist source is missing', () => {
    const missingSrc = path.join(makeTempDir('sync-missing-'), 'nope');
    const dest = makeTempDir('sync-missing-dest-');

    const result = runScript(['--src', missingSrc, '--dest', dest]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('npm run build');
    // 校验先行：不触碰目标目录。
    expect(readdirSync(dest)).toEqual([]);
  });

  it('mirrors the source into the destination and removes stale files', () => {
    const src = makeTempDir('sync-src-');
    makeSourceFixture(src);
    const dest = makeTempDir('sync-dest-');
    // 预置旧 Angular 平铺产物，同步后必须被清除。
    writeFileSync(path.join(dest, 'main-BGAFACUZ.js'), 'old angular bundle');
    writeFileSync(path.join(dest, 'polyfills-5CFQRCPP.js'), 'old polyfills');
    writeFileSync(path.join(dest, 'styles-CDJM3XQS.css'), 'old styles');

    const result = runScript(['--src', src, '--dest', dest]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(readdirSync(dest).sort()).toEqual(['assets', 'favicon.ico', 'index.html']);
    expect(readFileSync(path.join(dest, 'assets', 'index-abc123.js'), 'utf8')).toBe('console.log("app");');
    expect(existsSync(path.join(dest, 'main-BGAFACUZ.js'))).toBe(false);
    // 打印同步文件清单摘要。
    for (const relative of ['index.html', 'assets/index-abc123.js', 'assets/index-def456.css', 'favicon.ico']) {
      expect(result.stdout).toContain(`- ${relative}`);
    }
  });

  it('resets the destination on re-sync (idempotent)', () => {
    const src = makeTempDir('sync-src-');
    makeSourceFixture(src);
    const dest = makeTempDir('sync-dest-');

    expect(runScript(['--src', src, '--dest', dest]).status).toBe(0);
    rmSync(path.join(src, 'favicon.ico'));
    expect(runScript(['--src', src, '--dest', dest]).status).toBe(0);

    expect(readdirSync(dest).sort()).toEqual(['assets', 'index.html']);
  });
});
