import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { copyWxModelAssets, copyWxUiAssets, copyWxFontAssets, writeWxAssetManifest } from '../tools/wx-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = join(tmpdir(), 'opencode');
mkdirSync(tempRoot, { recursive: true });
const temp = mkdtempSync(join(tempRoot, 'wx-assets-test-'));
after(() => rmSync(temp, { recursive: true, force: true }));

// 独立编译这两个平台模块，不依赖/触发全仓 tsc，也不写共享 build/。
buildSync({
  entryPoints: {
    assetPaths: join(root, 'apps/wx/src/platform/assetPaths.ts'),
    network: join(root, 'apps/wx/src/platform/network.ts'),
  },
  outdir: join(temp, 'modules'), bundle: true, platform: 'node', format: 'esm',
});
const { resolveWxAssetPath } = await import(pathToFileURL(join(temp, 'modules/assetPaths.js')).href);
const { wxReadBinary, wxReadJson } = await import(pathToFileURL(join(temp, 'modules/network.js')).href);

test('真实 GLB 逐字节进入分包，共享皮肤模型不重复复制，缺失引用不伪造资源', () => {
  const pkg = join(temp, 'real/pkg-assets');
  const result = copyWxModelAssets(root, pkg);
  const expected = [...['bball', 'ama', 'kaze', 'rina', 'bolt', 'frog', 'niu', 'pony', 'whale']
    .map(name => `characters/coastal/${name}.glb`), 'pickups/coastal/magnet.glb',
    ...['shield','jetpack','board','multiplier','boots','helmet'].map(name => `pickups/coastal/${name}.glb`)].map(p => `assets/${p}`);
  const sources = [...new Set(result.entries.filter(e => e.delivery === 'packaged').map(e => e.source))];
  assert.deepEqual(sources.sort(), expected.sort());
  assert.equal(result.files, expected.length);
  assert.equal(result.bytes, expected.reduce((sum, source) => sum + statSync(join(root, source)).size, 0));
  for (const entry of result.entries) {
    const dest = join(pkg, entry.source);
    assert.equal(entry.path, `pkg-assets/${entry.source}`);
    if (entry.delivery === 'packaged') {
      assert.deepEqual(readFileSync(dest), readFileSync(join(root, entry.source)));
      assert.equal(readFileSync(dest).toString('ascii', 0, 4), 'glTF');
      assert.equal(entry.bytes, statSync(dest).size);
    } else {
      assert.equal(existsSync(join(root, entry.source)), false);
      assert.equal(existsSync(dest), false);
      assert.equal(entry.bytes, undefined);
    }
  }
  assert.equal(result.entries.find(e => e.id === 'char_ama').delivery, 'packaged');
  assert.equal(result.entries.find(e => e.id === 'skin_volt_thunder').delivery, 'missing');
  assert.equal(result.entries.find(e => e.id === 'item_jetpack').delivery, 'packaged');
  assert.equal(result.entries.find(e => e.id === 'item_key').delivery, 'missing', 'wallet material has no run pickup model');
  assert.ok(!existsSync(join(pkg,'assets/pickups/magnet.glb')),'old source magnet is not a release input');
  assert.equal(result.entries.find(e => e.id === 'skin_bolt_storm').contentStatus, 'draft');
});

test('manifest 同时记录实际文件字节与缺失模型状态，排除自身且无占位模型', () => {
  const pkg = join(temp, 'manifest/pkg-assets');
  const { entries, files } = copyWxModelAssets(root, pkg);
  mkdirSync(join(pkg, 'config'));
  writeFileSync(join(pkg, 'config/game.json'), '{"hello":1}');
  writeFileSync(join(pkg, 'game.js'), '/* resource package */');
  const manifest = writeWxAssetManifest(pkg, entries);
  assert.deepEqual(JSON.parse(readFileSync(join(pkg, 'manifest.json'), 'utf8')), manifest);
  assert.equal(manifest.files.length, files + 2);
  for (const file of manifest.files) {
    assert.equal(file.bytes, statSync(join(dirname(pkg), file.path)).size);
    assert.equal(file.path.includes('placeholder'), false);
    assert.notEqual(file.path, 'pkg-assets/manifest.json');
  }
  assert.ok(manifest.entries.some(e => e.delivery === 'missing'));
  // 再生成不会把上一版清单误记为实际资源。
  assert.deepEqual(writeWxAssetManifest(pkg, entries), manifest);
});

test('WX只分发9张实际肖像和Three许可，保留源树旧菜单而不再混入未使用图片',()=>{
  const pkg=join(temp,'ui/pkg-assets'),result=copyWxUiAssets(root,pkg);
  const portraits=JSON.parse(readFileSync(join(root,'config/characters.json'),'utf8')).items.filter(c=>c.id.startsWith('char_')&&c.status==='live');
  let bytes=0;
  for(const character of portraits){
    const path=`assets/ui/portraits/${character.id}.png`,target=join(pkg,path);
    assert.deepEqual(readFileSync(target),readFileSync(join(root,path)));bytes+=statSync(target).size;
  }
  const license=join(pkg,'licenses/three-LICENSE.txt');
  assert.deepEqual(readFileSync(license),readFileSync(join(root,'node_modules/three/LICENSE')));
  assert.match(readFileSync(license,'utf8'),/Copyright.*three\.js authors/);bytes+=statSync(license).size;
  assert.equal(result.files,portraits.length+1);assert.equal(result.bytes,bytes);
  assert.ok(existsSync(join(root,'assets/ui/menu-bg.png')),'the historical source art is not deleted');
  assert.ok(!existsSync(join(pkg,'assets/ui/menu-bg.png')));assert.ok(!existsSync(join(pkg,'assets/ui/badges')));
});

test('assets 路径统一映射，已映射路径幂等，URL 与其它本地文件原样透传', () => {
  for (const source of ['assets/characters/bball.glb', './assets/fonts/cjk.png', '/assets/ui/icon_gold.png']) {
    const expected = `pkg-assets/${source.replace(/^(\.?\/)+/, '')}`;
    assert.equal(resolveWxAssetPath(source), expected);
    assert.equal(resolveWxAssetPath(expected), expected);
  }
  for (const source of ['pkg-assets/assets/pickups/magnet.glb', './pkg-assets/assets/fonts/cjk.png',
    'config/game.json', 'pkg-assets/config/game.json', 'https://cdn.test/assets/frog.glb?x=1',
    'http://cdn.test/assets/frog.glb', 'wxfile://usr/assets/frog.glb', '//cdn.test/assets/frog.glb']) {
    assert.equal(resolveWxAssetPath(source), source);
  }
});

function fileMock() {
  const paths = [], downloads = [];
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const wx = {
    getFileSystemManager: () => ({
      readFile(opts) {
        paths.push(opts.filePath);
        if (opts.filePath.endsWith('missing.glb')) return opts.fail({ errMsg: 'no such file' });
        opts.success({ data: opts.encoding ? '{"ok":true}' : bytes });
      },
    }),
    downloadFile(opts) { downloads.push(opts); },
  };
  return { wx, paths, downloads, bytes };
}

test('readBinary/readJson 使用同一 assets 映射，不改变既有 config 相对路径', async () => {
  const m = fileMock();
  assert.equal(await wxReadBinary(m.wx, 'assets/characters/bball.glb'), m.bytes);
  await wxReadBinary(m.wx, 'pkg-assets/assets/characters/bball.glb');
  assert.deepEqual(await wxReadJson(m.wx, 'assets/fonts/cjk.metrics.json'), { ok: true });
  await wxReadJson(m.wx, 'config/game.json');
  assert.deepEqual(m.paths, ['pkg-assets/assets/characters/bball.glb', 'pkg-assets/assets/characters/bball.glb',
    'pkg-assets/assets/fonts/cjk.metrics.json', 'config/game.json']);
});

test('远程 URL 下载原样传递，下载后的临时路径不再次映射', async () => {
  const m = fileMock();
  const url = 'https://cdn.test/assets/characters/frog.glb?version=2';
  const binary = wxReadBinary(m.wx, url);
  assert.equal(m.downloads[0].url, url);
  m.downloads[0].success({ statusCode: 200, tempFilePath: 'assets/downloaded-temp.glb' });
  assert.equal(await binary, m.bytes);
  const json = wxReadJson(m.wx, 'http://cdn.test/assets/font.metrics.json');
  m.downloads[1].success({ statusCode: 200, tempFilePath: 'wxfile://tmp/data.json' });
  assert.deepEqual(await json, { ok: true });
  assert.deepEqual(m.paths, ['assets/downloaded-temp.glb', 'wxfile://tmp/data.json']);
});

test('缺失文件与失败下载仍 reject，不替换为占位数据', async () => {
  const m = fileMock();
  await assert.rejects(wxReadBinary(m.wx, 'assets/characters/missing.glb'), /pkg-assets\/assets\/characters\/missing.glb/);
  const httpError = wxReadBinary(m.wx, 'https://cdn.test/missing.glb');
  m.downloads[0].success({ statusCode: 404, tempFilePath: 'unused' });
  await assert.rejects(httpError, /HTTP 404/);
  const downloadError = wxReadJson(m.wx, 'https://cdn.test/data.json');
  m.downloads[1].fail({ errMsg: 'domain denied' });
  await assert.rejects(downloadError, /domain denied/);
  assert.equal(m.paths.length, 1);
});
