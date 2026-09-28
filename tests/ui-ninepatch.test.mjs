/**
 * 九宫格与皮肤纹理测试（S4 · render/skinTexture.ts + render/ninePatch.ts + render/clip.ts）。
 * 全部 headless：DataTexture/BufferGeometry 在 node 可安全构造。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSkinTexture, hexToRgb, mixHex,
  ninePatchGeometry, NinePatchSprite,
  planesForRect, pointInPlanes,
} from '../packages/framework/dist/ui/index.js';

test('hexToRgb / mixHex', () => {
  assert.deepEqual(hexToRgb('#7FD1FF'), [0x7f, 0xd1, 0xff]);
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255]);
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHex('#102030', '#102030', 0.7), '#102030');
});

test('createSkinTexture：确定性（同参数两次字节一致）+ insets 覆盖圆角', () => {
  const spec = { fill: '#141C33', border: '#2A3A5F', radiusPx: 10, borderPx: 1 };
  const a = createSkinTexture(spec);
  const b = createSkinTexture(spec);
  assert.deepEqual([...a.texture.image.data], [...b.texture.image.data]);
  assert.ok(a.insets.top >= 10 && a.insets.left >= 10);
  assert.equal(a.texture.image.width, a.sizePx);
});

test('createSkinTexture：角落透明、中心不透明、边缘带描边色', () => {
  const { texture, sizePx } = createSkinTexture({ fill: '#ffffff', border: '#000000', radiusPx: 8, borderPx: 2 });
  const d = texture.image.data;
  const at = (x, y) => d[(y * sizePx + x) * 4 + 3];
  assert.equal(at(0, 0), 0, '圆角外应全透明');
  assert.equal(at(sizePx - 1, sizePx - 1), 0);
  assert.equal(at(sizePx >> 1, sizePx >> 1), 255, '中心应不透明');
  // 上边缘中点：在 border 环内 → 颜色接近黑（border），alpha 满
  const mid = (sizePx >> 1) * 4 * sizePx + (sizePx >> 1) * 4;
  assert.ok(d[mid] < 40 && d[mid + 3] === 255, `border px=${d[mid]},${d[mid + 3]}`);
});

function src() {
  const { texture, insets, sizePx } = createSkinTexture({ fill: '#1B2540', border: '#2A3A5F', radiusPx: 6, borderPx: 1 });
  return { texture, insets, texSize: { w: sizePx, h: sizePx } };
}

test('ninePatchGeometry：4×4 顶点、9 面片、切分单调、worldY=-uiY', () => {
  const rect = { x: 10, y: 20, w: 100, h: 60 };
  const geo = ninePatchGeometry(rect, { top: 8, right: 8, bottom: 8, left: 8 }, src());
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  assert.equal(pos.count, 16);
  assert.equal(geo.getIndex().count, 54);
  const xs = [pos.getX(0), pos.getX(1), pos.getX(2), pos.getX(3)];
  assert.deepEqual(xs, [10, 18, 102, 110]);
  const ys = [0, 1, 2, 3].map(j => pos.getY(j * 4)); // 第一列自上而下
  assert.deepEqual(ys, [-20, -28, -72, -80]);
  const us = [0, 1, 2, 3].map(i => uv.getX(i));
  assert.ok(us[0] === 0 && us[3] === 1 && us[1] > 0 && us[2] < 1 && us[1] < us[2]);
});

test('ninePatchGeometry：rect 小于 insets 时夹取不翻转', () => {
  const geo = ninePatchGeometry({ x: 0, y: 0, w: 4, h: 2 }, { top: 8, right: 8, bottom: 8, left: 8 }, src());
  const pos = geo.getAttribute('position');
  const xs = [pos.getX(0), pos.getX(1), pos.getX(2), pos.getX(3)];
  for (let i = 1; i < 4; i++) assert.ok(xs[i] >= xs[i - 1], `xs 非单调 ${xs}`);
  assert.equal(xs[3], 4);
});

test('NinePatchSprite：update 换矩形重建几何；零尺寸隐藏', () => {
  const s = new NinePatchSprite(src());
  const ctx = { order: () => 1, clip: [] };
  assert.equal(s.mesh.visible, false);
  s.update({ x: 0, y: 0, w: 50, h: 40 }, ctx);
  assert.equal(s.mesh.visible, true);
  const g1 = s.mesh.geometry;
  s.update({ x: 0, y: 0, w: 50, h: 40 }, ctx);
  assert.equal(s.mesh.geometry, g1, '同矩形不重建');
  s.update({ x: 0, y: 0, w: 60, h: 40 }, ctx);
  assert.notEqual(s.mesh.geometry, g1, '矩形变化重建');
  s.update({ x: 0, y: 0, w: 0, h: 40 }, ctx);
  assert.equal(s.mesh.visible, false);
  s.dispose();
});

test('planesForRect：裁剪面保内拒外（含四边外侧与对角）', () => {
  const planes = planesForRect({ x: 10, y: 10, w: 100, h: 50 });
  assert.ok(pointInPlanes(planes, 50, 30));
  assert.ok(pointInPlanes(planes, 10, 10), '左上闭边界');
  assert.ok(!pointInPlanes(planes, 9.9, 30), '左外');
  assert.ok(!pointInPlanes(planes, 110.1, 30), '右外');
  assert.ok(!pointInPlanes(planes, 50, 9.9), '上外');
  assert.ok(!pointInPlanes(planes, 50, 60.1), '下外');
  assert.ok(!pointInPlanes(planes, 200, 200), '对角外');
});
