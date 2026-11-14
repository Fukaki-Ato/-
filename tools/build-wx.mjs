/**
 * 微信小游戏构建脚本。
 * 流程：
 *   1. esbuild 打包 apps/wx/src/main.ts → dist/game.js（iife，含 three，tree-shaking 走 npm 依赖；
 *      目标 es2017：微信现行基础库 v8 原生支持，模块格式沿用 S11/S3 实测可跑的 iife 单入口）。
 *   2. 组装 dist/（结构即开发者工具「导入项目」目录）：
 *        game.js / game.json / project.config.json      —— 主包（引擎+启动场景）
 *        pkg-assets/                                    —— 分包（game.json subpackages 声明）
 *          config/*.json、字体图集、真实音频 assets/audio/**（递归，计入包体门禁）、
 *          真实角色/道具 GLB 与 manifest.json（实际文件/缺失模型清单）
 *   3. 打印主包/分包体积表并做门禁（tools/check-wx-size.mjs 同一实现）。
 * 用法：
 *   node tools/build-wx.mjs [--minify] [--dry]
 *   --minify 压缩产物；--dry 只 bundle+体积校验（写临时目录后删除，不发布，check.mjs 第 5 步用）。
 * 前置：先 npm run build（tsc -b），否则 workspace 产物缺失。
 * 作为模块 import 时导出音频复制工具（测试用），不触发构建。
 */
import { build } from 'esbuild';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync,
  readdirSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSizeTable, measureDist } from './check-wx-size.mjs';
import { copyWxModelAssets, copyWxUiAssets, copyWxFontAssets, writeWxAssetManifest } from './wx-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** 直接 node 执行才构建（realpath 比较，防符号链接路径误判为「被 import」而静默跳过构建） */
const isMain = (() => {
  try {
    return !!process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

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

    for (const f of ['game.json', 'project.config.json', 'cloud.config.json']) copyFileSync(join(src, f), join(out, f));

    // 分包 pkg-assets：config + 字体图集 + UI + 真实音频/模型；
    // wx 侧启动链：loadSubpackage → extras.readJson('pkg-assets/config/<name>.json')（apps/wx/src/main.ts）
    const pkg = join(out, 'pkg-assets');
    mkdirSync(pkg, { recursive: true });
    copyDir(join(root, 'config'), join(pkg, 'config'), n => n.endsWith('.json'));
    copyWxFontAssets(root, pkg);
    // 当前WX页面仅使用模型肖像，旧Web菜单资源不再分发；保留已打包Three的完整MIT许可。
    copyWxUiAssets(root, pkg);
    // 真实音频随分包走（game.json params.audio 的 'assets/audio/...' 由 WX 音频实现映射到此处）
    const audio = copyAudioAssets(root, pkg);
    const models = copyWxModelAssets(root, pkg);
    // 开发者工具硬性要求 game.json 声明的每个分包 root 下存在 game.js，否则拒绝打包
    // （报「未找到 ["subpackages"][0]["root"] 对应的 /pkg-assets/game.js」）。分包内容经 wx.loadSubpackage 读取，此入口无执行逻辑。
    writeFileSync(join(pkg, 'game.js'), '/* pkg-assets 分包占位入口：本包只提供资源，无执行逻辑 */\n');
    writeWxAssetManifest(pkg, models.entries);

    const m = measureDist(out);
    console.log(`apps/wx/dist ${dry ? '（--dry 临时目录校验）' : '就绪'}（minify=${minify}）：真实模型 ${models.files} 个 ${(models.bytes / 1024).toFixed(0)} KB，音频 ${audio.files} 个 ${(audio.bytes / 1024).toFixed(0)} KB`);
    const missing = [...new Set(models.entries.filter(e => e.delivery === 'missing').map(e => e.source))];
    if (missing.length) console.warn(`尚未交付的模型 ${missing.length} 个（详见 pkg-assets/manifest.json）：\n  ${missing.join('\n  ')}`);
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
