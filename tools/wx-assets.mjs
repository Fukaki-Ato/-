/** WX 真实模型复制与可核查分包清单；缺失模型只记账，不生成假资源。 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** WX只分发可溯源的Noto/原创符号图集；旧混合图集不再进入小游戏包。 */
export function copyWxFontAssets(repoRoot, pkgDir) {
  const relative = 'assets/fonts/noto', target = join(pkgDir, relative);
  mkdirSync(target, { recursive: true });
  const names = ['latin.png', 'latin.metrics.json', 'cjk.png', 'cjk.metrics.json', 'NotoSansSC-OFL.txt', 'provenance.json'];
  for (const name of names) copyFileSync(join(repoRoot, relative, name), join(target, name));
  return { files: names.length, bytes: names.reduce((sum,name)=>sum+statSync(join(target,name)).size,0) };
}

/** 当前WX页面只使用实际角色肖像；旧Web菜单/徽标留在源码，不随小游戏分发。 */
export function copyWxUiAssets(repoRoot, pkgDir) {
  const source = join(repoRoot, 'assets/ui/portraits'), destination = join(pkgDir, 'assets/ui/portraits');
  mkdirSync(destination, { recursive: true });
  let files = 0, bytes = 0;
  for (const name of readdirSync(source).filter(name => name.endsWith('.png'))) {
    const target = join(destination, name);
    copyFileSync(join(source, name), target);
    files++; bytes += statSync(target).size;
  }
  const license = join(pkgDir, 'licenses/three-LICENSE.txt');
  mkdirSync(dirname(license), { recursive: true });
  copyFileSync(join(repoRoot, 'node_modules/three/LICENSE'), license);
  return { files: files + 1, bytes: bytes + statSync(license).size };
}

/** 配置引用的 GLB 保留 assets/... 相对路径；共享模型只复制一次。 */
export function copyWxModelAssets(repoRoot, pkgDir) {
  const entries = [];
  const copied = new Map();
  for (const config of ['characters', 'items']) {
    const { items } = JSON.parse(readFileSync(join(repoRoot, 'config', `${config}.json`), 'utf8'));
    for (const item of items) {
      const source = item.model?.prefab;
      if (!source?.endsWith('.glb')) continue;
      const entry = {
        id: item.id,
        kind: config === 'items' ? 'item' : item.kind === 'skin' ? 'skin' : 'character',
        contentStatus: item.status,
        source,
        path: `pkg-assets/${source}`,
        delivery: 'missing',
      };
      if (existsSync(join(repoRoot, source))) {
        if (!copied.has(source)) {
          const dest = join(pkgDir, source);
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(join(repoRoot, source), dest);
          copied.set(source, statSync(dest).size);
        }
        entry.delivery = 'packaged';
        entry.bytes = copied.get(source);
      }
      entries.push(entry);
    }
  }
  return { entries, files: copied.size, bytes: [...copied.values()].reduce((sum, bytes) => sum + bytes, 0) };
}

/** 清单列出分包实际文件（不含清单自身）与配置模型交付状态。 */
export function writeWxAssetManifest(pkgDir, entries) {
  const files = [];
  function walk(dir, prefix = '') {
    for (const name of readdirSync(dir).sort()) {
      const rel = prefix + name;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs, `${rel}/`);
      else if (rel !== 'manifest.json') files.push({ path: `pkg-assets/${rel}`, bytes: statSync(abs).size });
    }
  }
  walk(pkgDir);
  const manifest = {
    generatedBy: 'tools/build-wx.mjs',
    note: 'files 为实际分包文件（不含 manifest.json 自身）；delivery=missing 的模型尚未交付，不生成占位模型。',
    files,
    entries,
  };
  writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
