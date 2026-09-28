/**
 * 小游戏包体门禁（S6，redesign §1 硬约束）：主包 >4MB 即 fail；整包（主包+全部分包）>30MB 亦 fail。
 * 口径说明：按 dist 目录**未压缩**字节数计（比微信上传时的压缩口径严格，留安全边际；
 * 官方限制针对上传包，devtools「本地包」显示原始大小——CI 门禁统一用原始字节，一票否决）。
 * 分包归属：以 dist/game.json 的 subpackages[].root 为准（root 目录下文件不计入主包）。
 * 用法：
 *   node tools/check-wx-size.mjs [--dir <dist目录>]   # 独立 CLI（CI wx-build job 调用），打印体积表
 *   import { measureDist, formatSizeTable } from './check-wx-size.mjs'  # build-wx.mjs 复用（--dry 与实发均打印）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const MAIN_BUDGET = 4 * 1024 * 1024; // 主包上限（官方现行）
export const TOTAL_BUDGET = 30 * 1024 * 1024; // 整包上限

/** 主包显示名（subpackages root 之外的所有文件归它）。 */
const MAIN_NAME = 'main';

/** 递归收集 dir 下全部文件，返回相对 dir 的 '/' 分隔路径 + 字节数。 */
function walkFiles(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs, rel));
    else out.push({ rel, bytes: statSync(abs).size });
  }
  return out;
}

/**
 * 测量 dist 产物：主包/各分包体积与文件清单。
 * @returns {{distDir:string, pkgs:{name:string,bytes:number,files:{rel:string,bytes:number}[]}[]}[],
 *            total:number, ok:boolean, violations:string[]}}
 */
export function measureDist(distDir) {
  const dir = resolve(distDir);
  let roots = [];
  try {
    const gameJson = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8'));
    roots = (gameJson.subpackages ?? gameJson.subPackages ?? []).map(s => String(s.root).replace(/^\/+|\/+$/g, '') + '/');
  } catch (e) {
    return { distDir: dir, pkgs: [], total: 0, ok: false, violations: [`无法读取 ${join(dir, 'game.json')}: ${e.message}`] };
  }
  const buckets = new Map([[MAIN_NAME, { name: MAIN_NAME, bytes: 0, files: [] }]]);
  for (const r of roots) buckets.set(r.slice(0, -1), { name: r.slice(0, -1), bytes: 0, files: [] });
  for (const f of walkFiles(dir)) {
    const hit = roots.find(r => f.rel.startsWith(r));
    const pkg = buckets.get(hit ? hit.slice(0, -1) : MAIN_NAME);
    pkg.files.push(f);
    pkg.bytes += f.bytes;
  }
  const pkgs = [...buckets.values()];
  const total = pkgs.reduce((s, p) => s + p.bytes, 0);
  const violations = [];
  const main = buckets.get(MAIN_NAME);
  if (main.bytes > MAIN_BUDGET) violations.push(`主包 ${(main.bytes / 1024 / 1024).toFixed(2)}MB 超过 ${(MAIN_BUDGET / 1024 / 1024)}MB 上限`);
  if (total > TOTAL_BUDGET) violations.push(`整包 ${(total / 1024 / 1024).toFixed(2)}MB 超过 ${(TOTAL_BUDGET / 1024 / 1024)}MB 上限`);
  return { distDir: dir, pkgs, total, ok: violations.length === 0, violations };
}

const kb = n => (n / 1024).toFixed(1) + ' KB';
const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB';

/** 体积表文本（构建日志与 CLI 共用一份渲染）。 */
export function formatSizeTable(m) {
  const lines = [];
  lines.push('── 小游戏包体（未压缩字节，主包上限 ' + mb(MAIN_BUDGET) + ' / 整包上限 ' + mb(TOTAL_BUDGET) + '）──');
  for (const p of m.pkgs) {
    const budget = p.name === MAIN_NAME ? MAIN_BUDGET : TOTAL_BUDGET;
    const pct = ((p.bytes / budget) * 100).toFixed(1);
    lines.push(`  ${p.name.padEnd(16)} ${kb(p.bytes).padStart(10)}  ${pct.padStart(5)}%  (${p.files.length} 个文件)`);
  }
  lines.push(`  ${'TOTAL'.padEnd(16)} ${kb(m.total).padStart(10)}`);
  if (!m.ok) for (const v of m.violations) lines.push('  ✗ ' + v);
  return lines.join('\n');
}

/** 独立 CLI 入口（被 import 时不自动跑）。 */
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const idx = process.argv.indexOf('--dir');
  const distDir = idx >= 0 ? process.argv[idx + 1] : join(root, 'apps/wx/dist');
  const m = measureDist(distDir);
  console.log(formatSizeTable(m));
  if (!m.ok) {
    console.error('包体门禁失败：' + m.violations.join('；'));
    process.exit(1);
  }
  console.log('包体门禁通过 ✓');
}
