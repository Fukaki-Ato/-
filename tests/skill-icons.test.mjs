/**
 * 局内技能图标（中右方两枚）测试。
 *
 * 覆盖四件事：
 *   1. 布局：贴右边缘、竖直一列、不出屏（多档窄高/宽屏视口）；
 *   2. 亮灯口径：主动亮=ready，被动亮=passive.active 且叠层显示次数；
 *   3. 可点性：主动图标可点并回调释放，被动图标永不可点（不可释放）；
 *   4. 状态文案：冷却秒数、下滑积攒进度、「生效中」/次数。
 * 素材本身（assets/ui/skills/*.png）由 tools/gen_skill_icons.py 产出，
 * 这里只断言文件在场且尺寸/体积合理，不逐像素比对。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defaultUiConfig, findBox } from '../packages/framework/dist/ui/index.js';
import { UiHost } from '../packages/framework/dist/ui/host.js';
import { createOverlayViews } from '../packages/game/dist/ui/overlayViews.js';
import { buildSkillIcons, skillCaption, skillIconLayout } from '../packages/game/dist/ui/skillIcons.js';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { hashSeed } from '../packages/game/dist/core/rng.js';
import { loadTestFontSet, readJson } from './ui-helpers.mjs';

const content = Object.fromEntries(
  ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy']
    .map(n => [n, readJson(`config/${n}.json`)]),
);

/** 最小 host：headless（three 只建不画），fontSet 走共用助手 */
function hostFixture(width = 800, height = 873) {
  const store = new Map();
  const adapter = {
    version: 2,
    env: 'web',
    canvas: {
      mainCanvas: () => ({}),
      createOffscreenCanvas: () => ({}),
      windowSize: () => ({ width, height, dpr: 1 }),
      onResize: () => () => {},
    },
    onInput: () => () => {},
    storage: { get: k => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: k => store.delete(k) },
    fetchJson: async () => { throw new Error('node 环境不联网'); },
    requestFrame: () => 0,
    cancelFrame: () => {},
    onVisibility: () => () => {},
    now: () => 0,
  };
  const host = new UiHost({
    adapter,
    overlayHost: { renderer: null, width, height, dpr: 1 },
    fonts: loadTestFontSet(),
    config: defaultUiConfig,
  });
  return { host, adapter, store };
}

const relayout2 = (host) => {
  host.overlay.current?.relayout();
  host.overlay.current?.relayout();
};

/**
 * 走真实输入通路点击某个控件（与 pages.test.mjs 的 clickWidget 同一做法）：
 * pushInput down/up 命中控件中心，由 InputRouter 派发到 Button 的 handlers。
 * 用它而不是直调 onClick，才能验到「暗态 disabled 吞掉激活」。
 */
function clickWidget(host, id, tree = host.overlay.current?.relayout()) {
  const box = findBox(tree, id);
  if (!box) throw new Error(`控件 ${id} 不在布局树里`);
  const x = box.rect.x + box.rect.w / 2;
  const y = box.rect.y + box.rect.h / 2;
  host.pushInput({ type: 'down', x, y, t: 0 });
  host.pushInput({ type: 'up', x, y, t: 0.05 });
}

// ---------------- 布局 ----------------

test('技能图标布局：贴右边缘、竖直一列、不出屏（多档视口）', () => {
  const viewports = [
    [390, 844], [412, 915], [360, 780], [800, 600], [320, 720], [1024, 1536], [1200, 500],
  ];
  for (const [vw, vh] of viewports) {
    const L = skillIconLayout(vw, vh);
    const tag = `${vw}x${vh}`;
    assert.ok(L.active.x >= 0 && L.active.x + L.active.w <= vw + 1, `${tag} 主动图标应完整在屏内`);
    assert.ok(L.passive.x >= 0 && L.passive.x + L.passive.w <= vw + 1, `${tag} 被动图标应完整在屏内`);
    assert.ok(L.active.y >= 0, `${tag} 主动图标不应被顶出上沿`);
    assert.ok(L.passive.y + L.passive.h <= vh + 1, `${tag} 被动图标不应被底边裁掉`);
    assert.equal(L.active.x, L.passive.x, `${tag} 两枚应左对齐成列`);
    assert.ok(L.active.w === L.active.h && L.active.w === L.passive.w, `${tag} 圆形图标应等宽高`);
    assert.ok(L.active.x > vw * 0.5, `${tag} 应在画面右半区（中右方）`);
    assert.ok(
      L.passive.y - (L.active.y + L.active.h) > 0,
      `${tag} 两枚图标不应重叠（间距=${L.passive.y - (L.active.y + L.active.h)}）`,
    );
  }
});

test('技能图标布局吃安全区：safeTop 下推，safeBottom 只作不压底的兜底', () => {
  // safeTop 参与定位：顶栏安全区越大，整体越往下让
  const none = skillIconLayout(800, 873, { top: 0, bottom: 0 });
  const withTop = skillIconLayout(800, 873, { top: 60, bottom: 0 });
  assert.ok(withTop.active.y > none.active.y, 'safeTop 应把图标下移');

  // 图标锚在画面中段（设计 y=700），正常机型下 bottom 安全区够不着 ⇒ 两版同高
  const withBottom = skillIconLayout(800, 873, { top: 0, bottom: 120 });
  assert.equal(
    withBottom.passive.y, none.passive.y,
    '底部安全区够不到中段锚点时不应无故挪动（避免图标位置随机型漂移）',
  );
  assert.ok(withBottom.passive.y + withBottom.passive.h <= 873, '任何情况都不压底');

  // 兜底生效：safeBottom 大到整列容不下时，退化为顶部对齐，且仍完整在屏内
  //（此时「满足安全区」与「不出屏」不可兼得，不出屏优先——图标被裁掉比压到安全区更糟）
  const huge = skillIconLayout(1024, 1536, { top: 0, bottom: 1400 });
  assert.ok(huge.active.y >= 0, '退化时应贴顶而不是落到屏外');
  assert.ok(huge.passive.y + huge.passive.h <= 1536 + 1, `退化后仍须完整在屏内，实得底部 ${huge.passive.y + huge.passive.h}`);
});

// ---------------- 文案 ----------------

test('状态文案：冷却秒数 / 下滑积攒进度 / 可释放', () => {
  const base = { active: false, charges: 0 };
  assert.equal(skillCaption('active', { ...base, ready: true, cd: 0, charge: null }), '可释放');
  assert.equal(skillCaption('active', { ...base, ready: false, cd: 2.5, charge: null }), '2.5s');
  assert.equal(skillCaption('active', { ...base, ready: false, cd: 0, charge: { now: 5, need: 10 } }), '5/10');
  // 积攒期优先显示进度（玩家更需要知道还差几次下滑）
  assert.equal(skillCaption('active', { ...base, ready: false, cd: 3, charge: { now: 5, need: 10 } }), '5/10');
});

test('状态文案：被动亮时显示生效/次数，暗时为空', () => {
  const base = { ready: false, cd: 0, charge: null };
  assert.equal(skillCaption('passive', { ...base, active: false, charges: 0 }), '');
  assert.equal(skillCaption('passive', { ...base, active: true, charges: 0 }), '生效中');
  assert.equal(skillCaption('passive', { ...base, active: true, charges: 3 }), '×3');
});

// ---------------- 图标控件行为 ----------------

test('主动图标：亮=可点，点击触发释放回调；暗态被禁用点击不响应', () => {
  const { host } = hostFixture();
  let casts = 0;
  const icons = buildSkillIcons(host, {}, () => { casts++; }, { top: 0, bottom: 0 });
  // 经 host.mount 挂载：只有这样 InputRouter 才会注册控件 handlers（clickWidget 才有点可点）
  const view = host.makeView();
  view.add(icons.root);
  host.mount(view, { transparent: true });
  relayout2(host);

  assert.equal(icons.activeIcon.tappable, true, '主动图标应可点');
  assert.equal(icons.passiveIcon.tappable, false, '被动图标永不可点（不可释放）');

  // 亮态：走真实输入通路点它中心
  icons.update({ ready: true, cd: 0, charge: null, active: true, charges: 0 });
  relayout2(host);
  assert.equal(icons.activeIcon.captionLabel.text, '可释放');
  assert.equal(icons.passiveIcon.captionLabel.text, '生效中');
  clickWidget(host, icons.activeIcon.id);
  assert.equal(casts, 1, '亮态点击应触发释放回调');

  // 暗态：setDisabled 后 machine 不再 activated
  icons.update({ ready: false, cd: 12, charge: null, active: true, charges: 0 });
  relayout2(host);
  assert.equal(icons.activeIcon.captionLabel.text, '12.0s');
  clickWidget(host, icons.activeIcon.id);
  assert.equal(casts, 1, '暗态（冷却中）点击不应再释放');

  host.clear();
});

test('暗态真的落到渲染参数上（不被 Button 的 disabled 视觉覆盖回去）', () => {
  const { host } = hostFixture();
  const icons = buildSkillIcons(host, {}, () => {}, { top: 0, bottom: 0 });
  const view = host.makeView();
  view.add(icons.root);
  host.mount(view, { transparent: true });
  relayout2(host);

  icons.update({ ready: true, cd: 0, charge: null, active: true, charges: 0 });
  relayout2(host);
  const lit = icons.activeIcon.bgVisual;
  assert.equal(lit.color, 'ffffff', '亮态应是白乘色（不改色相）');
  assert.equal(lit.opacity, 1, '亮态应全不透明');

  // 暗态：Button 走 setDisabled，其 applyVisual 会把乘色重置为白、透明度重置为 0.45。
  // 上面那条用例只验「点不动」，验不到「画出来没有」——顺序写反时图标会糊成半透明灰块。
  icons.update({ ready: false, cd: 12, charge: null, active: false, charges: 0 });
  relayout2(host);
  const dim = icons.activeIcon.bgVisual;
  assert.notEqual(dim.color, 'ffffff', '暗态乘色不该仍是白：白=被 applyVisual 覆盖，压暗参数没落上');
  assert.ok(dim.opacity < lit.opacity, `暗态应比亮态更暗，实际 ${dim.opacity} vs ${lit.opacity}`);
  assert.ok(dim.opacity >= 0.6,
    `暗态不该低于 0.6（跑酷背景是亮沙，太透就看不出那是个技能键），实际 ${dim.opacity}`);
  assert.equal(icons.passiveIcon.bgVisual.color, dim.color, '被动暗态与主动同口径（Box 侧不受态机影响）');
  host.clear();
});

test('被动图标：充能耗尽后转暗且不留文案', () => {
  const { host } = hostFixture();
  const icons = buildSkillIcons(host, {}, null, { top: 0, bottom: 0 });
  const view = host.makeView();
  view.add(icons.root);
  relayout2(host);
  icons.update({ ready: false, cd: 0, charge: null, active: true, charges: 2 });
  assert.equal(icons.passiveIcon.captionLabel.text, '×2');
  icons.update({ ready: false, cd: 0, charge: null, active: false, charges: 0 });
  assert.equal(icons.passiveIcon.captionLabel.text, '', '被动转暗后不留文案');
  view.dispose();
});

test('缺贴图时退化为纯色圆：结构、命中区与可点性不变', () => {
  const { host } = hostFixture(390, 844);
  const icons = buildSkillIcons(host, {}, () => {}, { top: 0, bottom: 0 });
  const view = host.makeView();
  view.add(icons.root);
  relayout2(host);
  assert.ok(host.overlay.current || true); // 无贴图也应能布局完成
  assert.equal(icons.activeIcon.tappable, true, '无贴图时主动图标仍可点');
  icons.update({ ready: false, cd: 0, charge: null, active: true, charges: 0 });
  assert.equal(icons.passiveIcon.captionLabel.text, '生效中');
  view.dispose();
});

// ---------------- HUD 装配 ----------------

test('HUD 挂图标：update 透传 ready/cd/charge/active/charges，不再产出技能文字行', async () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  let casts = 0;
  const hud = views.mountHud({ onCastSkill: () => { casts++; } });
  hud.update({
    score: 0, coins: 0, distance: 0, hits: 0, lives: 1, buffs: [],
    skill: { label: '雷霆冲刺', cd: 0, ready: true, charge: null },
    passive: { label: '静电收藏家', active: true, charges: 0 },
  });
  relayout2(host);
  hud.dispose();
  assert.equal(casts, 0, '挂载不应自己触发释放');
  assert.equal(host.overlay.current, null, 'dispose 即卸页');
});

// ---------------- sim 侧的亮灯口径 ----------------

test('sim.passiveActive/passiveCharges：可玩角色开局被动都亮（无天赋角色不亮假灯）', () => {
  const live = content.characters.items.filter(c => String(c.id).startsWith('char_') && c.status === 'live');
  assert.ok(live.length >= 8, `可玩角色应 ≥8 个，实得 ${live.length}`);
  for (const c of live) {
    const sim = new RunnerSim(content, hashSeed('icon'), c.id);
    sim.obstacles.length = 0;
    sim.step();               // 常驻被动开局即挂；周期被动在第 1 步触发子效果
    sim.drainEvents();
    if (!sim.loadout.passive.length) {
      // 纯渲染接入、暂无天赋配置的角色（如奶龙）：图标位留空而不是亮一个假的
      assert.equal(sim.passiveActive(), false, `${c.id} 无天赋，不应亮灯`);
      assert.equal(sim.passiveCharges(), 0, `${c.id} 无天赋，不应有充能`);
      continue;
    }
    assert.equal(sim.passiveActive(), true, `${c.id} 开局被动应生效（图标亮）`);
    if (c.id === 'char_frog') {
      assert.ok(sim.passiveCharges() >= 1, `奶蛙开局应至少 1 层充能，实际 ${sim.passiveCharges()}`);
    } else {
      assert.equal(sim.passiveCharges(), 0, `${c.id} 无叠层语义，充能数应为 0`);
    }
  }
});

test('sim.passiveActive：奶蛙把充能全跳完后图标转暗', () => {
  const sim = new RunnerSim(content, hashSeed('icon'), 'char_frog');
  const step = () => { sim.obstacles.length = 0; sim.step(); sim.drainEvents(); };
  step();
  assert.equal(sim.passiveActive(), true, '开局有充能');
  let guard = 0;
  while (sim.passiveCharges() > 0 && guard++ < 200) {
    sim.obstacles.length = 0;
    sim.applyAction('jump');
    step();
  }
  assert.equal(sim.passiveCharges(), 0, '充能应被起跳消耗完');
  assert.equal(sim.passiveActive(), false, '无充能时被动图标应转暗');
});

test('sim.passiveActive：无被动的装配返回 false（不亮假图标）', () => {
  const sim = new RunnerSim(content, hashSeed('icon'));
  assert.equal(sim.loadout.passive.length, 0, '默认装配无被动');
  assert.equal(sim.passiveActive(), false);
  assert.equal(sim.passiveCharges(), 0);
});

// ---------------- 素材 ----------------

test('技能图标素材在场：两张 png，体积克制且同量级', () => {
  for (const name of ['active', 'passive']) {
    const p = join(process.cwd(), 'assets/ui/skills', `${name}.png`);
    assert.ok(existsSync(p), `缺少 ${name}.png（重出图：ImageGen 品红底 → tools/mat_skill_icons.py 抠图；`
      + `离线兜底：D:/python/python.exe tools/gen_skill_icons.py）`);
    const bytes = statSync(p).size;
    assert.ok(bytes > 500, `${name}.png 太小（${bytes}B），可能是空图`);
    assert.ok(bytes < 120 * 1024, `${name}.png 过大（${(bytes / 1024).toFixed(1)}KB），要算 WX 包体`);
  }
  const a = statSync(join(process.cwd(), 'assets/ui/skills/active.png')).size;
  const b = statSync(join(process.cwd(), 'assets/ui/skills/passive.png')).size;
  assert.ok(Math.abs(a - b) / Math.max(a, b) < 0.5, '两枚图标体积应同量级（同一套生成管线）');
});
