/**
 * charset.mjs — 扫描仓库 UI/配置文本，产出 SDF 图集所需字符集清单。
 * 扫描源（dev 基线）：src/ui/screens.ts（搬迁后自动回退 apps/web/src/ui/screens.ts）+ config/*.json。
 * 收录：全部 ASCII 可打印字符（0x20-0x7E）+ 扫描文本中出现的每一个非 ASCII 字符
 *       （CJK 汉字、全角标点、·…×←↑↓❤ 等 UI 符号一网打尽）。
 * 输出 charset.txt：每行一个字符（含空格字符行），按码点升序，行尾 LF。
 * CLI：node charset.mjs [--out assets/fonts/charset.txt] [--root <repoRoot>]
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 仓库根（tools/fontgen 的上两级）。 */
export function repoRoot(from = HERE) {
  return resolve(from, '..', '..');
}

/** 待扫描文件清单：页面文案源 + S4 演示页 + config/*.json。 */
export function scanTargets(root) {
  const files = [];
  // S5 页面迁移：screens.ts 退役，自绘 UI 文案源 = packages/game/src/**/*.ts
  // （src/ui 页面 + mainFlow 的 toast/错误等经 GameViews 上树的文案，全部入库即入字符集）
  const pagesRoot = join(root, 'packages', 'game', 'src');
  const walkTs = (dir) => {
    let names = [];
    try { names = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walkTs(p);
      else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  walkTs(pagesRoot);
  // S4 起自绘 UI 文案入库即入字符集（?ui=demo 验收页）
  for (const rel of ['apps/web/src/uiDemoView.ts']) {
    const p = join(root, rel);
    try { readFileSync(p, 'utf8'); files.push(p); } catch { /* 尚未落地则跳过 */ }
  }
  const cfgDir = join(root, 'config');
  for (const name of readdirSync(cfgDir).sort()) {
    if (name.endsWith('.json')) files.push(join(cfgDir, name));
  }
  return files;
}

/** 从文本提取字符集合（Set<number> 码点）。asciiPrintable=true 时并入 0x20-0x7E。 */
export function extractChars(texts, { asciiPrintable = true } = {}) {
  const set = new Set();
  if (asciiPrintable) for (let c = 0x20; c <= 0x7e; c++) set.add(c);
  for (const text of texts) {
    for (const ch of text) { // for..of 按码点迭代（代理对安全）
      const cp = ch.codePointAt(0);
      if (cp >= 0x20 && cp !== 0x7f) set.add(cp); // 跳过控制字符（\n \r \t 等）
    }
  }
  return set;
}

/** 扫描仓库并返回排序后的码点数组。 */
export function collectCharset(root = repoRoot()) {
  const files = scanTargets(root);
  if (!files.length) throw new Error(`charset: no scan targets under ${root}`);
  const texts = files.map((f) => readFileSync(f, 'utf8'));
  return [...extractChars(texts)].sort((a, b) => a - b);
}

/** 码点数组 -> charset.txt 文本（每行一个字符）。 */
export function formatCharset(codepoints) {
  return codepoints.map((cp) => String.fromCodePoint(cp)).join('\n') + '\n';
}

/** charset.txt 文本 -> 码点数组（跳过空行；每行取第一个码点）。 */
export function parseCharset(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.length) continue;
    out.push(line.codePointAt(0));
  }
  return out;
}

/** ASCII 可打印判定（供 gen.mjs 拆分 latin/cjk 两张图集）。 */
export function isAsciiPrintable(cp) {
  return cp >= 0x20 && cp <= 0x7e;
}

export function main(argv = process.argv.slice(2)) {
  let out = null, root = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--root') root = argv[++i];
  }
  root = root ? resolve(root) : repoRoot();
  out = out ? resolve(out) : join(root, 'assets', 'fonts', 'charset.txt');
  const cps = collectCharset(root);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, formatCharset(cps), 'utf8');
  const ascii = cps.filter(isAsciiPrintable).length;
  console.log(`charset: ${cps.length} chars (ascii ${ascii} + non-ascii ${cps.length - ascii}) -> ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
