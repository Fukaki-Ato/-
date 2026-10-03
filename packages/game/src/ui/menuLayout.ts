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
const BAR_X = 40;
const BAR_W = 944;
const CELL_W = BAR_W / 4;
const ICON_W = 114;
const ICON_H = 139;
const PLAQUE_W = 600;
const PLAQUE_H = 290;
const PLAQUE_GAP = 34;

export function scaleOf(vw: number, vh: number): number {
  return Math.min(vw / DESIGN_W, vh / DESIGN_H);
}

export function menuLayout(vw: number, vh: number, safe: MenuSafe): MenuLayout {
  const s = scaleOf(vw, vh);
  const ox = (vw - DESIGN_W * s) / 2;                 // 横屏时两侧留边，竖屏为 0
  const d = (n: number): number => Math.round(n * s);
  const dx = (n: number): number => Math.round(ox + n * s);
  const top = (n: number): number => Math.round(safe.top * s + n * s);
  const barY = vh - Math.round((safe.bottom + 6) * s) - d(BAR_H);
  const cells: Rect[] = [];
  const dividers: Rect[] = [];
  for (let k = 0; k < 4; k++) {
    const cx = BAR_X + CELL_W * k;
    cells.push({ x: dx(cx + (CELL_W - ICON_W) / 2), y: barY + d(12), w: d(ICON_W), h: d(ICON_H) });
    if (k > 0) dividers.push({ x: dx(cx), y: barY + d(37), w: Math.max(1, d(2)), h: d(90) });
  }
  return {
    s,
    pill: { x: dx(296), y: top(8), w: d(433), h: d(66) },
    settings: { x: dx(914), y: top(6), w: d(96), h: d(96) },
    event: { x: dx(12), y: top(12), w: d(131), h: d(166) },
    task: { x: dx(10), y: top(182), w: d(142), h: d(152) },
    achieve: { x: dx(878), y: top(124), w: d(132), h: d(152) },
    rank: { x: dx(880), y: top(262), w: d(130), h: d(137) },
    plaque: { x: dx((DESIGN_W - PLAQUE_W) / 2), y: barY - d(PLAQUE_GAP) - d(PLAQUE_H), w: d(PLAQUE_W), h: d(PLAQUE_H) },
    bar: { x: dx(BAR_X), y: barY, w: d(BAR_W), h: d(BAR_H) },
    cells,
    dividers,
    panel: { x: dx(152), y: top(290), w: d(720), h: 0 },
  };
}
