/**
 * S6 wx 构建管线单测：分包加载辅助（platform-wx/subpackage）+ 包体门禁（tools/check-wx-size）。
 * wx 用注入 mock（同 platform-wx.test.mjs 纪律）；measureDist 用临时 dist fixture。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PKG_ASSETS, loadWxSubpackage, subpackageAssetPath } from '../apps/wx/build/platform/subpackage.js';
import { resolveWxAudioPath } from '../apps/wx/build/platform/audio.js';
import { MAIN_BUDGET, TOTAL_BUDGET, measureDist } from '../tools/check-wx-size.mjs';
import { AUDIO_FILE_RE, copyAudioAssets } from '../tools/build-wx.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');

const baseWx = {
  createCanvas: () => ({ width: 300, height: 150, getContext: () => ({}) }),
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2 }),
  onWindowResize() {}, offWindowResize() {},
  onTouchStart() {}, onTouchEnd() {}, onTouchCancel() {},
  offTouchStart() {}, offTouchEnd() {}, offTouchCancel() {},
  getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
  request() { return { abort() {} }; }, downloadFile() { return { abort() {} }; },
  getFileSystemManager: () => ({}),
  onShow() {}, onHide() {}, offShow() {}, offHide() {},
  requestAnimationFrame: cb => { cb(0); return 1; }, cancelAnimationFrame() {},
  login() {}, shareAppMessage() {},
};

test('loadWxSubpackage：成功 resolve 耗时并带 name', async () => {
  let asked = null;
  const wx = { ...baseWx, loadSubpackage: opts => { asked = opts.name; setTimeout(() => opts.success({}), 1); return {}; } };
  const cost = await loadWxSubpackage(wx, PKG_ASSETS);
  assert.equal(asked, 'pkg-assets');
  assert.ok(cost >= 0 && Number.isFinite(cost));
});

test('loadWxSubpackage：fail reject（不静默）+ 进度回调', async () => {
  const seen = [];
  const wx = {
    ...baseWx,
    loadSubpackage: opts => {
      setTimeout(() => opts.success(), 0);
      return { onProgressUpdate: cb => { cb({ progress: 30 }); cb({ progress: 60 }); } };
    },
  };
  await loadWxSubpackage(wx, 'pkg-assets', p => seen.push(p));
  assert.deepEqual(seen, [30, 60]);
  const bad = { ...baseWx, loadSubpackage: opts => { opts.fail({ errMsg: 'load fail' }); return {}; } };
  await assert.rejects(loadWxSubpackage(bad), /loadSubpackage 失败/);
});

test('loadWxSubpackage：旧基础库/mock 无能力 → 降级 resolve(0)', async () => {
  assert.equal(await loadWxSubpackage({ ...baseWx }), 0);
});

test('subpackageAssetPath：分包内路径拼接（相对代码包根，无开头斜杠）', () => {
  assert.equal(subpackageAssetPath('config', 'game.json'), 'pkg-assets/config/game.json');
});

/** 临时 dist fixture：主包 game.js + game.json + project.config.json，分包 pkg-assets/{config,a}.bin */
function makeFixture(extraMainBytes = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'tr-wx-size-'));
  mkdirSync(join(dir, 'pkg-assets/config'), { recursive: true });
  writeFileSync(join(dir, 'game.json'), JSON.stringify({ subpackages: [{ name: 'pkg-assets', root: 'pkg-assets' }] }));
  writeFileSync(join(dir, 'game.js'), 'x'.repeat(1024 + extraMainBytes));
  writeFileSync(join(dir, 'pkg-assets/config/game.json'), '{"a":1}');
  writeFileSync(join(dir, 'pkg-assets/big.bin'), Buffer.alloc(2048));
  return dir;
}

test('measureDist：按 game.json subpackages 归属主包/分包', () => {
  const dir = makeFixture();
  try {
    const m = measureDist(dir);
    const main = m.pkgs.find(p => p.name === 'main');
    const pkg = m.pkgs.find(p => p.name === 'pkg-assets');
    assert.ok(main.bytes >= 1024 && main.bytes < 4096);
    assert.equal(pkg.bytes, 2048 + '{"a":1}'.length); // 分包 root 下文件不计主包
    assert.ok(m.ok, m.violations.join());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('measureDist：主包 >4MB → ok=false 且 violations 指明主包', () => {
  const dir = makeFixture(MAIN_BUDGET); // game.js 超预算 1 字节以上
  try {
    const m = measureDist(dir);
    assert.equal(m.ok, false);
    assert.match(m.violations.join('\n'), /主包 .* 超过 4MB 上限/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 递归列出目录下文件 → { 相对路径: 字节数 } */
function listFiles(dir, base = dir, out = {}) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) listFiles(abs, base, out);
    else out[relative(base, abs).split('\\').join('/')] = statSync(abs).size;
  }
  return out;
}

test('copyAudioAssets：真实 assets/audio 递归全部进分包 assets/audio，字节逐一一致并计入分包体积', () => {
  const src = listFiles(join(root, 'assets/audio'));
  const expected = Object.fromEntries(Object.entries(src).filter(([p]) => AUDIO_FILE_RE.test(p)));
  const expectedBytes = Object.values(expected).reduce((a, b) => a + b, 0);
  assert.ok(Object.keys(expected).length > 0, '仓库应有真实音频');
  const dir = mkdtempSync(join(tmpdir(), 'tr-wx-audio-'));
  try {
    writeFileSync(join(dir, 'game.json'), JSON.stringify({ subpackages: [{ name: PKG_ASSETS, root: PKG_ASSETS }] }));
    writeFileSync(join(dir, 'game.js'), 'x');
    const pkg = join(dir, PKG_ASSETS);
    const res = copyAudioAssets(root, pkg);
    assert.equal(res.files, Object.keys(expected).length);
    assert.equal(res.bytes, expectedBytes);
    assert.deepEqual(listFiles(join(pkg, 'assets/audio')), expected); // README 等非音频不进包
    const m = measureDist(dir);
    const sub = m.pkgs.find(p => p.name === PKG_ASSETS);
    assert.equal(sub.bytes, expectedBytes, '音频字节必须计入分包体积');
    assert.ok(expectedBytes < TOTAL_BUDGET, '真实音频不得超出整包预算');
    assert.ok(m.ok, m.violations.join());

    // 配置引用的每条音频经 WX 解析后都落在构建产物里（无双重前缀）
    const audio = JSON.parse(readFileSync(join(root, 'config/game.json'), 'utf8')).params.audio;
    const refs = [
      ...Object.values(audio.bgm), audio.sfx.start, ...[audio.sfx.death].flat(),
      ...Object.values(audio.characters).flatMap(c => Object.values(c.sfx)),
    ];
    for (const ref of refs) {
      const resolved = resolveWxAudioPath(ref);
      assert.ok(resolved.startsWith(`${PKG_ASSETS}/assets/audio/`) && !resolved.includes(`${PKG_ASSETS}/${PKG_ASSETS}`), resolved);
      assert.ok(existsSync(join(dir, resolved)), `构建产物缺少 ${resolved}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('copyAudioAssets：仓库无 assets/audio 时安全返回 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tr-wx-noaudio-'));
  try {
    assert.deepEqual(copyAudioAssets(dir, join(dir, 'out')), { files: 0, bytes: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
