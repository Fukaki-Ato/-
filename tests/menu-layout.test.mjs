/**
 * 主界面布局常量表单测（issue 验收：1024×1536 基准、保持比例不拉伸、
 * 窄/高竖屏适配且控件不被裁出屏幕或互相遮挡）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { menuLayout, scaleOf, uiSafeFrom, DEFAULT_SAFE, DESIGN_W, DESIGN_H } from '../packages/game/dist/ui/menuLayout.js';

const inside = (r, vw, vh) => r.x >= -1 && r.y >= -1 && r.x + r.w <= vw + 1 && r.y + r.h <= vh + 1;

test('scaleOf：设计分辨率下为 1，其余等比取小边', () => {
  assert.equal(scaleOf(DESIGN_W, DESIGN_H), 1);
  assert.ok(Math.abs(scaleOf(390, 844) - 390 / DESIGN_W) < 1e-9, '窄高竖屏由宽度定比');
  assert.ok(Math.abs(scaleOf(1600, 900) - 900 / DESIGN_H) < 1e-9, '横屏由高度定比');
});

test('uiSafeFrom：缺字段回默认、脏值当默认', () => {
  assert.deepEqual(uiSafeFrom(undefined), DEFAULT_SAFE);
  assert.deepEqual(uiSafeFrom({ safeTop: 24 }), { top: 24, bottom: DEFAULT_SAFE.bottom });
  assert.deepEqual(uiSafeFrom({ safeTop: -5, safeBottom: Number.NaN }), DEFAULT_SAFE);
});

test('竖屏（390×844）：全部控件在屏内，顶栏贴顶、底栏贴底、牌匾在底栏之上', () => {
  const vw = 390, vh = 844;
  const L = menuLayout(vw, vh, DEFAULT_SAFE);
  for (const [name, r] of Object.entries({ pill: L.pill, settings: L.settings, event: L.event, task: L.task, achieve: L.achieve, rank: L.rank, plaque: L.plaque, bar: L.bar })) {
    assert.ok(inside(r, vw, vh), `${name} 在屏内，实得 ${JSON.stringify(r)}`);
  }
  for (const r of [...L.cells, ...L.dividers]) assert.ok(inside(r, vw, vh), '底栏格与分隔线在屏内');
  assert.ok(L.pill.y < vh * 0.1, '货币胶囊贴顶');
  const gap = vh - (L.bar.y + L.bar.h);
  assert.ok(Math.abs(gap - Math.round((DEFAULT_SAFE.bottom + 6) * L.s)) <= 1, `底栏贴底（安全区+6px 设计间隙），实得间隙 ${gap}`);
  assert.ok(L.plaque.y + L.plaque.h <= L.bar.y, '牌匾不压底栏');
  assert.ok(L.event.y + L.event.h <= L.task.y, '左列活动/任务不互相遮挡');
  // 参考图里成就飘带本就略压排行榜顶（贴纸叠放），允许 ≤16 设计像素
  assert.ok(L.achieve.y + L.achieve.h <= L.rank.y + 16 * L.s, '右列成就/排行榜叠放不超参考图');
});

test('高竖屏（412×915）与窄竖屏（360×780）：底栏仍贴底、牌匾仍在底栏之上', () => {
  for (const [vw, vh] of [[412, 915], [360, 780]]) {
    const L = menuLayout(vw, vh, DEFAULT_SAFE);
    assert.ok(inside(L.bar, vw, vh) && inside(L.plaque, vw, vh), `${vw}×${vh} 关键控件在屏内`);
    assert.ok(L.plaque.y + L.plaque.h <= L.bar.y, `${vw}×${vh} 牌匾不压底栏`);
    assert.ok(L.pill.y < vh * 0.1, `${vw}×${vh} 顶栏贴顶`);
  }
});

test('横屏（800×600）：舞台横向居中留边，控件不越出舞台', () => {
  const vw = 800, vh = 600;
  const L = menuLayout(vw, vh, DEFAULT_SAFE);
  const ox = (vw - DESIGN_W * L.s) / 2;
  assert.ok(ox > 0, '横屏两侧留边');
  assert.ok(L.pill.x >= ox - 1 && L.settings.x + L.settings.w <= vw - ox + 1, '顶栏控件在舞台内');
  assert.ok(inside(L.bar, vw, vh) && inside(L.plaque, vw, vh), '横屏关键控件仍在屏内');
});

test('安全区加高：顶栏与底栏整体让出', () => {
  const safe = { top: 44, bottom: 34 };
  const L = menuLayout(390, 844, safe);
  assert.ok(L.pill.y >= 44 * L.s, '顶栏让出刘海');
  assert.ok(L.bar.y + L.bar.h <= 844 - 34 * L.s + 1, '底栏让出_home 指示条');
});
