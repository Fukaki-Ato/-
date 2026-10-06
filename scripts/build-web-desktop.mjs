#!/usr/bin/env node
/**
 * Creator 3.8.8 Web 构建能力（可溯源）：
 *   调用 Cocos Creator CLI 无头构建 web-desktop，并把「引擎版本 + 源码提交 + 脏标记 + 时间」
 *   写入产物内的 BUILD-MANIFEST.json；可选打包 zip 并输出 SHA-256 校验文件。
 *
 * 用法：
 *   npm run build:web               # debug 构建
 *   npm run build:web:zip           # debug 构建并打包 dist/*.zip（含 .sha256）
 *   node scripts/build-web-desktop.mjs --release --zip
 *   node scripts/build-web-desktop.mjs --creator "F:\\Cocos\\Editor\\3.8.8\\CocosCreator.exe"
 *
 * 环境变量：COCOS_CREATOR 指定 CocosCreator.exe 路径（默认 F:\Cocos\Editor\3.8.8\CocosCreator.exe）。
 *
 * 溯源约定：构建前请先提交源码（dirty=false 时清单最具可信度）；
 * 提交 A 之后运行本脚本，产物的 source.commit 即为 A。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : null;
};

const release = hasFlag('--release');
const makeZip = hasFlag('--zip');
const creator = resolve(
  argValue('--creator')
  ?? process.env.COCOS_CREATOR
  ?? 'F:\\Cocos\\Editor\\3.8.8\\CocosCreator.exe',
);
const outDir = resolve(argValue('--out') ?? join(root, 'build', 'web-desktop'));

if (!existsSync(creator)) {
  console.error(`[build-web] 未找到 Cocos Creator 可执行文件：${creator}`);
  console.error('[build-web] 可用 --creator <路径> 或环境变量 COCOS_CREATOR 指定。');
  process.exit(2);
}

function git(...cmd) {
  const result = spawnSync('git', cmd, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const engineVersion = pkg?.creator?.version ?? 'unknown';
const commitFull = git('rev-parse', 'HEAD');
const commitShort = commitFull ? commitFull.slice(0, 7) : 'nogit';
const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || 'unknown';
const describe = git('describe', '--tags', '--always', '--dirty');
const dirty = git('status', '--porcelain').length > 0;

const buildParam = `platform=web-desktop;debug=${release ? 'false' : 'true'}`;
console.log('[build-web] project :', root);
console.log('[build-web] creator :', creator, `(Creator ${engineVersion})`);
console.log('[build-web] params  :', buildParam);
console.log('[build-web] source  :', `${commitShort} (${branch})${dirty ? ' + dirty' : ''}`);

const buildResult = spawnSync(creator, ['--project', root, '--build', buildParam], { stdio: 'inherit' });
const exitCode = buildResult.status;
// Cocos Creator CLI 约定：36 为成功（docs/08 §4.1），0 兼容部分版本。
if (exitCode !== 0 && exitCode !== 36) {
  console.error(`[build-web] 构建失败，退出码 ${exitCode === null ? 'null(异常退出)' : exitCode}`);
  process.exit(exitCode ?? 1);
}

const manifest = {
  schemaVersion: 1,
  project: pkg.name,
  platform: 'web-desktop',
  debug: !release,
  engine: {
    name: 'Cocos Creator',
    version: engineVersion,
    executable: creator,
    exitCode,
  },
  source: {
    commit: commitFull || null,
    commitShort,
    branch,
    dirty,
    describe,
  },
  builtAt: new Date().toISOString(),
  builder: 'scripts/build-web-desktop.mjs',
};

mkdirSync(outDir, { recursive: true });
const manifestPath = join(outDir, 'BUILD-MANIFEST.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('[build-web] manifest:', manifestPath);
console.log('[build-web] sha256  :', sha256File(manifestPath), '(BUILD-MANIFEST.json)');

if (makeZip) {
  const distDir = join(root, 'dist');
  mkdirSync(distDir, { recursive: true });
  const zipName = `${pkg.name}-web-${commitShort}${dirty ? '-dirty' : ''}.zip`;
  const zipPath = join(distDir, zipName);
  // bsdtar 打包（Windows 10+ 与 macOS 自带）：PowerShell Compress-Archive 会把路径分隔符写成反斜杠，
  // Linux 解压得到损坏的平铺文件名；bsdtar 写入正斜杠，跨端可用。
  const tarBin = process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  const zipResult = spawnSync(tarBin, ['-a', '-cf', zipPath, '-C', outDir, '.'], { stdio: 'inherit' });
  if (zipResult.status !== 0 || !existsSync(zipPath)) {
    console.error('[build-web] 打包失败');
    process.exit(1);
  }
  const zipSha = sha256File(zipPath);
  writeFileSync(`${zipPath}.sha256`, `${zipSha}  ${zipName}\n`);
  console.log('[build-web] zip     :', zipPath);
  console.log('[build-web] sha256  :', zipSha, `(${zipName})`);
}
