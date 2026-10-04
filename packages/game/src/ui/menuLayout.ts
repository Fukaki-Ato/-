/**
 * 主界面布局常量表（issue #12：以参考图 1024×1536 为布局坐标基准，保持比例不拉伸）。
 * 参考图实测像素 × (1024/1007, 1536/1562) 归一到设计坐标；运行时按
 * s = min(vw/1024, vh/1536) 等比缩放，横向居中、竖向「顶栏贴顶 / 底栏贴底」锚定，
 * 窄高竖屏中段天空自然拉长、控件不被裁出屏幕。安全区边距走 config（params.ui）。
 * 本文件纯函数无 DOM，可直接单测。
 */

export const DESIGN_W = 1024;
export const DESIGN_H = 1536;

export interface MenuSafe { top: number; bottom: number }

export const DEFAULT_SAFE: MenuSafe = { top: 10, bottom: 10 };

/** config/game.json params.ui 的宽松解析：缺字段回默认，脏值（非有限数/负数）当默认 */
export function uiSafeFrom(raw: unknown): MenuSafe {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d;
  return { top: num(o['safeTop'], DEFAULT_SAFE.top), bottom: num(o['safeBottom'], DEFAULT_SAFE.bottom) };
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface MenuLayout {
  /** 设计坐标 → 视口像素的等比系数 */
  s: number;
  pill: Rect;
  settings: Rect;
  event: Rect;
  task: Rect;
  achieve: Rect;
  rank: Rect;
  plaque: Rect;
  bar: Rect;
  /** 底栏四格图标位（商店/福利手册/仓库/角色） */
  cells: Rect[];
  /** 底栏格间竖分隔线 */
  dividers: Rect[];
  /** 选角面板（复用现有选角 UI） */
  panel: Rect;
}

const BAR_H = 163;
const BAR_W = 944;
const ICON_W = 114;
const ICON_H = 139;
const PLAQUE_W = 600;
const PLAQUE_H = 290;
const PLAQUE_GAP = 34;
/** 左右两列入口贴屏幕边留的边距（设计 px） */
const EDGE = 12;
/** 同列两枚入口之间的间距（设计 px）——排行榜压成就就是这里给小了 */
const COL_GAP = 14;

export function scaleOf(vw: number, vh: number): number {
  return Math.min(vw / DESIGN_W, vh / DESIGN_H);
}

export function menuLayout(vw: number, vh: number, safe: MenuSafe): MenuLayout {
  const s = scaleOf(vw, vh);
  const d = (n: number): number => Math.round(n * s);
  const top = (n: number): number => Math.round(safe.top * s + n * s);
  const cx = (w: number): number => Math.round((vw - w) / 2);   // 横向一律按视口居中
  const barW = d(BAR_W);
  const barX = cx(barW);
  const barY = vh - Math.round((safe.bottom + 6) * s) - d(BAR_H);
  // 底栏四格与分隔线按「栏」定位（栏本身按视口居中，横屏下才不会与栏错位）
  const cells: Rect[] = [];
  const dividers: Rect[] = [];
  for (let k = 0; k < 4; k++) {
    const slotX = barX + Math.round((barW / 4) * k);
    const slotW = Math.round(barW / 4);
    cells.push({ x: slotX + Math.round((slotW - d(ICON_W)) / 2), y: barY + d(12), w: d(ICON_W), h: d(ICON_H) });
    if (k > 0) dividers.push({ x: slotX, y: barY + d(37), w: Math.max(1, d(2)), h: d(90) });
  }
  // 侧列贴屏幕两边（只留 EDGE 设计边距）：画面横向伸缩时不跟着舞台往里缩，
  // 这才符合参考图「入口挂在画框两侧」的观感。纵向仍按设计 y 走。
  const evW = d(131), evH = d(166);
  const tkW = d(142), tkH = d(152);
  const acW = d(132), acH = d(152), acY = top(124);
  const rkW = d(130), rkH = d(137);
  return {
    s,
    pill: { x: cx(d(433)), y: top(8), w: d(433), h: d(66) },
    settings: { x: vw - d(EDGE) - d(96), y: top(6), w: d(96), h: d(96) },
    event: { x: d(EDGE), y: top(12), w: evW, h: evH },
    task: { x: d(EDGE), y: top(12) + evH + d(COL_GAP), w: tkW, h: tkH },
    achieve: { x: vw - d(EDGE) - acW, y: acY, w: acW, h: acH },
    rank: { x: vw - d(EDGE) - rkW, y: acY + acH + d(COL_GAP), w: rkW, h: rkH },
    plaque: { x: cx(d(PLAQUE_W)), y: barY - d(PLAQUE_GAP) - d(PLAQUE_H), w: d(PLAQUE_W), h: d(PLAQUE_H) },
    bar: { x: cx(barW), y: barY, w: barW, h: d(BAR_H) },
    cells,
    dividers,
    panel: { x: cx(d(720)), y: top(290), w: d(720), h: 0 },
  };
}
