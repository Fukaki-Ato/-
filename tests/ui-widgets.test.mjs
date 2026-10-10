/**
 * 控件层 headless 集成测试（S4）：UiView + Box/Panel/Label/Button/ScrollView/List 绑定 S13 内核，
 * 不创建 WebGLRenderer（three 对象只建不画），node 直测布局/输入/滚动/虚拟化闭环。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UiView, Box, Panel, Label, Button, ScrollView, List,
  InputRouter, findBox, gestureToInputs, applySwipeScroll, ScrollPhysics,
} from '../packages/framework/dist/ui/index.js';
import { loadTestFontSet } from './ui-helpers.mjs';

const fonts = loadTestFontSet();

function makeView(w = 400, h = 300) {
  return new UiView({ fonts, width: w, height: h });
}

const center = box => ({ x: box.rect.x + box.rect.w / 2, y: box.rect.y + box.rect.h / 2 });

test('Label 自动尺寸 + Box 纵向堆叠/gap', () => {
  const view = makeView();
  const a = new Label({ text: 'AB', fontSizePx: 40 });
  const b = new Label({ text: 'C', fontSizePx: 40 });
  view.add(new Box({ direction: 'column', gap: 10, align: 'start' }, [a, b]));
  const tree = view.relayout();
  const ba = findBox(tree, a.id);
  const bb = findBox(tree, b.id);
  const gA = fonts.atlases[0].glyphs.get(65);
  const gB = fonts.atlases[0].glyphs.get(66);
  assert.ok(Math.abs(ba.rect.w - (gA.advance + gB.advance)) < 1e-6, `label 宽=Σadvance：${ba.rect.w}`);
  assert.ok(Math.abs(bb.rect.y - (ba.rect.y + ba.rect.h + 10)) < 1e-6, 'gap 生效');
  view.dispose();
});

test('Label setText → 失效重布局，尺寸跟随', () => {
  const view = makeView();
  const l = new Label({ text: 'A', fontSizePx: 40 });
  view.add(new Box({ align: 'start' }, [l]));
  const w1 = findBox(view.relayout(), l.id).rect.w;
  l.setText('ABC');
  assert.equal(view.consumeDirty(), true, 'setText 应置脏');
  const w2 = findBox(view.relayout(), l.id).rect.w;
  assert.ok(w2 > w1);
  view.dispose();
});

test('visible=false 的控件退出布局', () => {
  const view = makeView();
  const a = new Label({ text: 'A' });
  const b = new Label({ text: 'B' });
  view.add(new Box({ align: 'start' }, [a, b]));
  assert.equal(findBox(view.relayout(), b.id).rect.y > 0, true);
  a.visible = false;
  const tree = view.relayout();
  assert.equal(findBox(tree, a.id), undefined);
  view.dispose();
});

test('Button：click 激活 / 按压三态 / slop 取消 / 禁用吞激活', () => {
  const view = makeView();
  let clicks = 0;
  const btn = new Button({ label: '点击', onClick: () => clicks++ });
  view.add(new Box({ align: 'start' }, [btn]));
  const router = new InputRouter({ slop: 8 });
  view.setRouter(router);
  const box = findBox(view.relayout(), btn.id);
  const c = center(box);

  router.dispatch({ type: 'down', x: c.x, y: c.y, t: 0 });
  assert.equal(btn.state, 'pressed', 'down → pressed');
  router.dispatch({ type: 'up', x: c.x, y: c.y, t: 0.05 });
  assert.equal(btn.state, 'normal');
  assert.equal(clicks, 1, 'up 命中 → 激活一次');

  // slop：移动超阈值 → 按压取消，up 不激活
  router.dispatch({ type: 'down', x: c.x, y: c.y, t: 1 });
  router.dispatch({ type: 'move', x: c.x + 20, y: c.y, t: 1.05 });
  assert.equal(btn.state, 'normal', 'slop 取消按压');
  router.dispatch({ type: 'up', x: c.x + 20, y: c.y, t: 1.1 });
  assert.equal(clicks, 1, 'slop 后 up 不激活');

  // up 落在按钮外：不激活且回 normal
  router.dispatch({ type: 'down', x: c.x, y: c.y, t: 2 });
  router.dispatch({ type: 'up', x: c.x + 2, y: c.y + 500, t: 2.05 });
  assert.equal(clicks, 1);
  assert.equal(btn.state, 'normal');

  // 禁用：吞掉激活；恢复后可点
  btn.setDisabled(true);
  assert.equal(btn.state, 'disabled');
  router.dispatch({ type: 'down', x: c.x, y: c.y, t: 3 });
  router.dispatch({ type: 'up', x: c.x, y: c.y, t: 3.05 });
  assert.equal(clicks, 1, '禁用不激活');
  assert.equal(btn.state, 'disabled');
  btn.setDisabled(false);
  router.dispatch({ type: 'down', x: c.x, y: c.y, t: 4 });
  router.dispatch({ type: 'up', x: c.x, y: c.y, t: 4.05 });
  assert.equal(clicks, 2);
  view.dispose();
});

test('Panel：九宫格背景随盒更新', () => {
  const view = makeView();
  const p = new Panel({}, [new Label({ text: '面板内容' })]);
  view.add(p);
  const tree = view.relayout();
  const box = findBox(tree, p.id);
  assert.ok(box.rect.w > 0 && box.rect.h > 0);
  assert.equal(p.bg.mesh.visible, true);
  assert.equal(p.bg.mesh.geometry.getAttribute('position').count, 16);
  view.dispose();
});

test('ScrollView：拖拽跟手 + 惯性收敛 + 越界回弹到 0', () => {
  const view = makeView(400, 300);
  const content = new Box({ direction: 'column' }, Array.from({ length: 10 }, () => new Box({ height: 30 })));
  const sv = new ScrollView({ height: 100, content });
  view.add(sv);
  const router = new InputRouter();
  view.setRouter(router);
  const box = findBox(view.relayout(), sv.id);
  assert.equal(sv.physics.maxOffset, 200, 'content 300 - viewport 100');

  const c = center(box);
  router.dispatch({ type: 'down', x: c.x, y: c.y, t: 0 });
  router.dispatch({ type: 'move', x: c.x, y: c.y - 50, t: 0.05 });
  assert.ok(Math.abs(sv.physics.offset - 50) < 1e-6, '内容跟手 offset=50');
  router.dispatch({ type: 'up', x: c.x, y: c.y - 50, t: 0.1 });
  for (let i = 0; i < 600; i++) sv.step(1 / 60);
  assert.equal(sv.physics.animating, false, '惯性有限步内停止');
  assert.ok(sv.physics.offset >= 0 && sv.physics.offset <= 200);

  // 越界拖拽（向下拉过头）→ 回弹精确到 0
  router.dispatch({ type: 'down', x: c.x, y: c.y, t: 10 });
  router.dispatch({ type: 'move', x: c.x, y: c.y + 260, t: 11 });
  assert.ok(sv.physics.offset < 0, '越界为负');
  router.dispatch({ type: 'up', x: c.x, y: c.y + 260, t: 11.05 });
  for (let i = 0; i < 1200; i++) sv.step(1 / 60);
  assert.equal(sv.physics.offset, 0);
  assert.equal(sv.physics.animating, false);
  view.dispose();
});

test('ScrollView：touchcancel 收尾（dragEnd 后惯性仍收敛）', () => {
  const view = makeView();
  const content = new Box({ direction: 'column' }, Array.from({ length: 10 }, () => new Box({ height: 30 })));
  const sv = new ScrollView({ height: 100, content });
  view.add(sv);
  const router = new InputRouter();
  view.setRouter(router);
  const c = center(findBox(view.relayout(), sv.id));
  router.dispatch({ type: 'down', x: c.x, y: c.y, t: 0 });
  router.dispatch({ type: 'move', x: c.x, y: c.y - 40, t: 0.05 });
  view.dispatch(router, { type: 'cancel', x: c.x, y: c.y - 40, t: 0.06 });
  assert.equal(sv.physics.dragging, false);
  for (let i = 0; i < 600; i++) sv.step(1 / 60);
  assert.equal(sv.physics.animating, false);
  assert.ok(sv.physics.offset >= 0 && sv.physics.offset <= 200);
  view.dispose();
});

test('List：虚拟窗口只建可见项 + 滚动对账复用 + 点击选中', () => {
  const view = makeView(400, 600);
  const built = [];
  const updated = [];
  const selected = [];
  const list = new List({
    itemCount: 100, itemExtent: 40, height: 200, overscan: 1,
    buildItem: i => { built.push(i); return new Label({ text: `条目 ${i}` }); },
    updateItem: (w, i) => { updated.push(i); w.setText(`条目 ${i}`); },
    onSelect: i => selected.push(i),
  });
  view.add(list);
  const router = new InputRouter();
  view.setRouter(router);
  view.relayout();
  assert.equal(list.visibleWindow.count, 6, '视口 5 项 + overscan 1');
  assert.deepEqual(list.slotIndices, [0, 1, 2, 3, 4, 5]);
  assert.equal(built.length, 6, '只构建窗口内条目');

  // 滚动 100px → 窗口 [1,9)，槽位复用（updateItem 而非重建）
  list.physics.snapTo(100);
  view.relayout();
  assert.deepEqual(list.slotIndices, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(built.length, 8, '新增 2 槽才 build');
  assert.ok(updated.includes(1) && updated.includes(6), `updateItem 复用槽位：${updated}`);

  // 点击第 2 项（offset 回 0，y=50 → index 1）
  list.physics.snapTo(0);
  const box = findBox(view.relayout(), list.id);
  router.dispatch({ type: 'down', x: box.rect.x + 20, y: box.rect.y + 50, t: 0 });
  router.dispatch({ type: 'up', x: box.rect.x + 20, y: box.rect.y + 50, t: 0.05 });
  assert.deepEqual(selected, [1]);
  view.dispose();
});

test('List：setItemCount 收缩释放槽位', () => {
  const view = makeView(400, 600);
  const list = new List({
    itemCount: 100, itemExtent: 40, height: 200,
    buildItem: i => new Label({ text: `x${i}` }),
    updateItem: (w, i) => w.setText(`x${i}`),
  });
  view.add(list);
  view.relayout();
  const n1 = list.slotIndices.length;
  list.setItemCount(2);
  view.relayout();
  assert.equal(list.slotIndices.length, 2);
  assert.ok(n1 > 2);
  view.dispose();
});

test('setRouter(null) 卸载注册：控件不再响应', () => {
  const view = makeView();
  let clicks = 0;
  const btn = new Button({ label: 'B', onClick: () => clicks++ });
  view.add(new Box({ align: 'start' }, [btn]));
  const router = new InputRouter();
  view.setRouter(router);
  const c = center(findBox(view.relayout(), btn.id));
  view.setRouter(null);
  router.dispatch({ type: 'down', x: c.x, y: c.y, t: 0 });
  router.dispatch({ type: 'up', x: c.x, y: c.y, t: 0.05 });
  assert.equal(clicks, 0);
  view.dispose();
});

test('动态 add：挂载后新增控件自动注册输入', () => {
  const view = makeView();
  const router = new InputRouter();
  view.setRouter(router);
  view.relayout();
  let clicks = 0;
  const btn = new Button({ label: '动态', onClick: () => clicks++ });
  view.add(new Box({ align: 'start' }, [btn]));
  const c = center(findBox(view.relayout(), btn.id));
  router.dispatch({ type: 'down', x: c.x, y: c.y, t: 0 });
  router.dispatch({ type: 'up', x: c.x, y: c.y, t: 0.05 });
  assert.equal(clicks, 1);
  view.dispose();
});

test('gestureToInputs：v1 tap/doubleTap → down+up；v1 swipe 无坐标 → 空', () => {
  assert.deepEqual(gestureToInputs({ type: 'tap', x: 5, y: 6 }, 1), [
    { type: 'down', x: 5, y: 6, t: 1 }, { type: 'up', x: 5, y: 6, t: 1 },
  ]);
  assert.equal(gestureToInputs({ type: 'doubleTap', x: 1, y: 2 }, 0).length, 2);
  assert.deepEqual(gestureToInputs({ type: 'swipe', dir: 'up' }, 0), []);
  // v2 swipe（带起点坐标）→ 定位 down+up
  assert.equal(gestureToInputs({ type: 'swipe', dir: 'up', x: 3, y: 4 }, 0).length, 2);
});

test('applySwipeScroll：上滑 → 内容下移（offset 增大）', () => {
  const p = new ScrollPhysics({ content: 1000, viewport: 200 });
  applySwipeScroll({ type: 'swipe', dir: 'up' }, p, 'y', 300);
  assert.ok(p.velocityPxS > 0);
  for (let i = 0; i < 300; i++) p.step(1 / 60);
  assert.ok(p.offset > 100, `offset=${p.offset}`);
  const q = new ScrollPhysics({ content: 1000, viewport: 200 });
  applySwipeScroll({ type: 'swipe', dir: 'left' }, q, 'y'); // 轴向不匹配 → 无效果
  assert.equal(q.velocityPxS, 0);
});

test('ScrollView 子树材质带裁剪面 uniform（uClipCount=4）', () => {
  const view = makeView();
  const inner = new Label({ text: '裁剪内文本' });
  const sv = new ScrollView({ height: 60, content: new Box({ direction: 'column' }, [inner, new Box({ height: 200 })]) });
  view.add(sv);
  view.relayout();
  const mat = inner.mesh.atlasMeshes[0].material;
  assert.equal(mat.uniforms.uClipCount.value, 4);
  const outside = new Label({ text: '裁剪外' });
  view.add(new Box({ align: 'start' }, [outside]));
  view.relayout();
  assert.equal(outside.mesh.atlasMeshes[0].material.uniforms.uClipCount.value, 0);
  view.dispose();
});

// ---------------- setBackground（技能图标的亮/暗态靠它，不重建控件） ----------------

/** 自定义背景源：headless 下只要 insets/texSize 齐就能建片，texture 不参与几何 */
const skinSrc = () => ({
  texture: {}, insets: { left: 8, top: 8, right: 8, bottom: 8 }, texSize: { w: 64, h: 64 },
});
const bgUniforms = w => w.bg.material.uniforms;

test('Box.setBackground：自定义源就地改乘色与不透明度，不重建背景片', () => {
  const view = makeView();
  const box = new Box({ background: skinSrc(), width: 40, height: 40 });
  view.add(box);
  view.relayout();
  const mesh = box.bg.mesh;

  // 断言取纯黑：THREE 的 Color 有 sRGB↔linear 往返，中间灰度读回来不等于原 hex，只有 0/1 精确可逆
  box.setBackground({ color: '#000000', opacity: 0.4 });
  const u = bgUniforms(box);
  assert.equal(u.uColor.value.getHexString(), '000000', '乘色应落到渲染对象上');
  assert.equal(u.uOpacity.value, 0.4, '不透明度应落到渲染对象上');
  assert.equal(box.opts.backgroundColor, '#000000', 'opts 要同步，避免下次 relayout 回弹');
  assert.equal(box.bg.mesh, mesh, '必须就地改：重建会打断命中注册与按压态机');
  view.dispose();
});

test('Box.setBackground：主题皮肤键与无背景都静默 no-op（不抛、不造片）', () => {
  const view = makeView();
  const bare = new Box({ width: 40, height: 40 });
  view.add(bare);
  view.relayout();
  bare.setBackground({ color: '#000000', opacity: 0.5 });
  assert.equal(bare.bg, null, '没有背景的 Box 不该被造出背景片');
  assert.equal(bare.opts.backgroundColor, undefined, 'no-op 不该留下脏 opts');
  view.dispose();
});

test('Button.setBackground：只改视觉，不改按压态机的可点身份', () => {
  const view = makeView();
  const btn = new Button({ skin: skinSrc(), label: '', width: 40, height: 40, onClick: () => {} });
  view.add(btn);
  view.relayout();

  btn.setBackground({ color: '#000000', opacity: 0.4 });
  assert.equal(bgUniforms(btn).uColor.value.getHexString(), '000000', '暗态乘色应落上');
  assert.equal(bgUniforms(btn).uOpacity.value, 0.4);
  assert.equal(btn.state, 'normal', 'setBackground 只改视觉，不该动按压态');

  btn.setDisabled(true);
  assert.equal(bgUniforms(btn).uOpacity.value, 0.45, 'setDisabled 会覆盖视觉（disabled 自带 0.45）');
  assert.equal(bgUniforms(btn).uColor.value.getHexString(), 'ffffff', '同上：乘色被重置回白');
  btn.setBackground({ color: '#000000', opacity: 0.7 });
  assert.equal(bgUniforms(btn).uColor.value.getHexString(), '000000',
    '两者先后顺序决定最终值：想压住 disabled 的默认视觉，必须后调 setBackground');
  assert.equal(bgUniforms(btn).uOpacity.value, 0.7);
  view.dispose();
});

test('Box absolute 子项：产出顺序与 laidOut 对齐，sync 不会把矩形错配给别的子项', () => {
  const view = makeView();
  const abs = new Box({ absolute: true, top: 0, height: 100, background: 'panel' });
  const flow = new Box({ height: 40, background: 'card' });
  view.add(new Box({ direction: 'column', width: 400, height: 300 }, [abs, flow]));
  const tree = view.relayout();
  const f = findBox(tree, flow.id);
  const a = findBox(tree, abs.id);
  assert.ok(f && a, '两个子项都要在矩形树里');
  assert.equal(f.rect.y, 0);
  assert.equal(f.rect.h, 40, '常规子项拿自己的矩形');
  assert.equal(a.rect.h, 100, '绝对子项拿自己的矩形');
});

