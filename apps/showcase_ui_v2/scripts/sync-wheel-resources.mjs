#!/usr/bin/env node
/**
 * 同步 Vite 构建产物到 wheel 内置回退目录（调研报告 §4.2 的"容易遗漏的一步"）。
 *
 * - 源：`dist/browser/`（`npm run build` 输出，含内容 hash 的 assets/）。
 * - 目标：`artemis/resources/showcase_ui/`（wheel 安装态回退目录，
 *   `artemis/resources/__init__.py::get_bundled_showcase_dist` 以 `index.html`
 *   存在为准）。
 * - 行为：**先清空**目标目录全部内容（移除旧 Angular 平铺产物），再把源目录
 *   全部内容（含子目录）复制进去，最后打印同步文件清单摘要。
 *
 * 用法：
 *   npm run sync:resources            # 等价于 node scripts/sync-wheel-resources.mjs
 *   node scripts/sync-wheel-resources.mjs --src <dir> --dest <dir>
 *
 * `--src` / `--dest` 用于测试时注入临时目录；不传时使用上述默认路径。
 * 发布流程：`npm run build && npm run sync:resources`（手动执行，不挂进 build）。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--src' || arg === '--dest') {
      const value = argv[i + 1];
      if (!value) {
        console.error(`[sync:resources] 错误：${arg} 需要一个目录参数。`);
        process.exit(2);
      }
      options[arg.slice(2)] = path.resolve(value);
      i += 1;
    } else {
      console.error(`[sync:resources] 错误：未知参数 ${arg}（支持 --src <dir> / --dest <dir>）。`);
      process.exit(2);
    }
  }
  return options;
}

/** 递归收集目录下全部文件（相对 path 的 POSIX 风格路径）。 */
function listFilesRecursively(dir, relativeTo = dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...listFilesRecursively(fullPath, relativeTo));
    } else {
      files.push(path.relative(relativeTo, fullPath).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

/** 清空目录全部内容（目录本身保留/不存在则创建）。 */
function clearDirectory(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  for (const entry of readdirSync(dir)) {
    rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

export function runSync({ src, dest }) {
  const indexHtml = path.join(src, 'index.html');
  if (!existsSync(indexHtml)) {
    console.error(
      `[sync:resources] 错误：未找到构建产物 ${indexHtml}。\n` +
        '请先执行 `npm run build`（输出到 dist/browser/），再运行 `npm run sync:resources`。'
    );
    process.exitCode = 1;
    return null;
  }

  clearDirectory(dest);
  cpSync(src, dest, { recursive: true });

  const files = listFilesRecursively(dest);
  const directories = new Set(files.map((file) => path.posix.dirname(file)).filter((dir) => dir !== '.'));
  console.log(`[sync:resources] 已同步 ${files.length} 个文件（${directories.size} 个子目录）到 ${dest}`);
  for (const file of files) {
    console.log(`  - ${file}`);
  }
  return { dest, files };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const src = options.src ?? path.join(appRoot, 'dist', 'browser');
  const dest = options.dest ?? path.resolve(appRoot, '..', '..', 'artemis', 'resources', 'showcase_ui');
  runSync({ src, dest });
}

// 仅在作为 CLI 直接执行时运行（被测试导入时不触发同步）。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
