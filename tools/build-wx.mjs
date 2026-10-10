/**
 * 微信小游戏构建脚本。
 * 流程：
 *   1. esbuild 打包 apps/wx/src/main.ts → dist/game.js（iife，含 three，tree-shaking 走 npm 依赖；
 *      目标 es2017：微信现行基础库 v8 原生支持，模块格式沿用 S11/S3 实测可跑的 iife 单入口）。
 *   2. 组装 dist/（结构即开发者工具「导入项目」目录）：
 *        game.js / game.json / project.config.json      —— 主包（引擎+启动场景）
 *        pkg-assets/                                    —— 分包（game.json subpackages 声明）
 *          config/*.json、字体图集、真实音频 assets/audio/**（递归，计入包体门禁）、
 *          非默认角色/皮肤/主题资源占位
 *   3. 打印主包/分包体积表并做门禁（tools/check-wx-size.mjs 同一实现）。
 * 用法：
 *   node tools/build-wx.mjs [--minify] [--dry]
 *   --minify 压缩产物；--dry 只 bundle+体积校验（写临时目录后删除，不发布，check.mjs 第 5 步用）。
 * 前置：先 npm run build（tsc -b），否则 workspace 产物缺失。
 * 作为模块 import 时只导出 copyAudioAssets（测试用），不触发构建。
 */
import { build } from 'esbuild';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSizeTable, measureDist } from './check-wx-size.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** 直接 node 执行才构建（realpath 比较，防符号链接路径误判为「被 import」而静默跳过构建） */
const isMain = (() => {
  try {
    return !!process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

/** 默认进主包/首屏可用的资源 id；其余进分包占位。 */
const DEFAULT_CHAR = 'char_volt';

/** 运行时音频扩展名（README 等说明文件不进包）。 */
export const AUDIO_FILE_RE = /\.(mp3|m4a|aac|ogg|wav)$/i;

function copyDir(from, to, filter = () => true) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const abs = join(from, name);
    if (statSync(abs).isDirectory()) copyDir(abs, join(to, name), filter);
    else if (filter(name, abs)) copyFileSync(abs, join(to, name));
  }
}

/**
 * 递归复制 <repoRoot>/assets/audio 下全部音频到 <pkgDir>/assets/audio（与 resolveWxAudioPath 的
 * 'pkg-assets/assets/audio/...' 对应）；返回 { files, bytes }。目录缺失时返回 0（音频可选）。
 */
export function copyAudioAssets(repoRoot, pkgDir) {
  const from = join(repoRoot, 'assets/audio');
  if (!existsSync(from)) return { files: 0, bytes: 0 };
  let files = 0, bytes = 0;
  copyDir(from, join(pkgDir, 'assets/audio'), (name, abs) => {
    if (!AUDIO_FILE_RE.test(name)) return false;
    files++;
    bytes += statSync(abs).size;
    return true;
  });
  return { files, bytes };
}

/** 分包资源占位（S8 内容管线替换）：非默认角色/皮肤/主题各生成 placeholder.json。 */
function writeAssetPlaceholders(outDir) {
  const chars = JSON.parse(readFileSync(join(root, 'config/characters.json'), 'utf8')).items;
  const themes = JSON.parse(readFileSync(join(root, 'config/themes.json'), 'utf8')).items;
  const entries = [];
  for (const c of chars) {
    const isSkin = c.kind === 'skin';
    const owner = isSkin ? c.baseRef : c.id;
    if (owner === DEFAULT_CHAR && (!isSkin || c.id === 'skin_volt_default')) continue; // 默认角色+默认皮肤随主流程程序化模型，无需分包
    const rel = isSkin ? `characters/${owner}/skins/${c.id}` : `characters/${c.id}`;
    entries.push({ id: c.id, kind: isSkin ? 'skin' : 'character', status: c.status, path: `pkg-assets/${rel}/placeholder.json` });
  }
  const defaultTheme = themes[0] ? themes[0].id : null;
  for (const t of themes) {
    if (t.id === defaultTheme) continue;
    entries.push({ id: t.id, kind: 'theme', status: t.status, path: `pkg-assets/themes/${t.id}/placeholder.json` });
  }
  for (const e of entries) {
    const file = join(outDir, e.path.replace('pkg-assets/', ''));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({
      placeholder: true,
      note: 'S8 内容管线在此落真实资源（模型/贴图/音频），路径约定见本文件',
      ...e,
    }, null, 2));
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ generatedBy: 'tools/build-wx.mjs', entries }, null, 2));
  return entries.length;
}

if (isMain) await main();

async function main() {
  const minify = process.argv.includes('--minify');
  const dry = process.argv.includes('--dry');
  const src = join(root, 'apps/wx');
  if (!existsSync(join(root, 'apps/wx/build/platform/wxPlatform.js'))) {
    console.error('未找到 WX 平台适配产物：请先 npm run build（tsc -b）或直接用 npm run build:wx');
    process.exit(1);
  }
  const out = dry ? mkdtempSync(join(tmpdir(), 'tr-wx-dry-')) : join(src, 'dist');

  try {
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });

    const result = await build({
      entryPoints: [join(src, 'src/main.ts')],
      outfile: join(out, 'game.js'),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: ['es2017'], // 小游戏 v8 运行时原生支持；不开 devtools es6→es5（S11 K10：只会拖慢编译）
      minify,
      sourcemap: false,
      legalComments: 'none',
      logLevel: 'warning',
      metafile: true,
    });

    for (const f of ['game.json', 'project.config.json']) copyFileSync(join(src, f), join(out, f));

    // 分包 pkg-assets（redesign §3.5：config 随包走 + 字体图集 + 真实音频 + 非默认资源占位）；
    // wx 侧启动链：loadSubpackage → extras.readJson('pkg-assets/config/<name>.json')（apps/wx/src/main.ts）
    const pkg = join(out, 'pkg-assets');
    mkdirSync(pkg, { recursive: true });
    copyDir(join(root, 'config'), join(pkg, 'config'), n => n.endsWith('.json'));
    copyDir(join(root, 'assets/fonts'), join(pkg, 'assets/fonts'), n => /\.(png|metrics\.json)$/.test(n));
    // 主界面 UI 资源随分包走（徽标两帧/纯背景/分层动效贴图；只收 png——
    // 微信小游戏没有 <video> 通路，背景动效在 wx 端由这些贴图驱动，视频不进包）
    copyDir(join(root, 'assets/ui'), join(pkg, 'assets/ui'), n => n.endsWith('.png'));
    // 真实音频随分包走（game.json params.audio 的 'assets/audio/...' 由 WX 音频实现映射到此处）
    const audio = copyAudioAssets(root, pkg);
    const placeholders = writeAssetPlaceholders(pkg);
    // 开发者工具硬性要求 game.json 声明的每个分包 root 下存在 game.js，否则拒绝打包
    // （报「未找到 ["subpackages"][0]["root"] 对应的 /pkg-assets/game.js」）。分包内容经 wx.loadSubpackage 读取，此入口无执行逻辑。
    writeFileSync(join(pkg, 'game.js'), '/* pkg-assets 分包占位入口：本包只提供资源，无执行逻辑 */\n');

    const m = measureDist(out);
    console.log(`apps/wx/dist ${dry ? '（--dry 临时目录校验）' : '就绪'}（minify=${minify}）：分包占位 ${placeholders} 项，音频 ${audio.files} 个 ${(audio.bytes / 1024).toFixed(0)} KB`);
    console.log(formatSizeTable(m));

    const firstOutput = Object.values(result.metafile.outputs).find(o => o.entryPoint);
    if (firstOutput) {
      const top = Object.entries(firstOutput.inputs).sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput).slice(0, 5);
      console.log('game.js 体积构成 Top5：');
      for (const [file, v] of top) console.log(`  ${(v.bytesInOutput / 1024).toFixed(0).padStart(6)} KB  ${file}`);
    }

    if (!m.ok) {
      console.error('包体门禁失败：' + m.violations.join('；'));
      process.exit(1);
    }
    if (dry) console.log('[dry] wx bundle 校验通过 ✓（未发布）');
  } finally {
    if (dry) rmSync(out, { recursive: true, force: true });
  }
}
