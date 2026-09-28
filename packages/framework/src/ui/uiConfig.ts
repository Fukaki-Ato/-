/**
 * ui 技术段配置解析（config/game.json params.ui，schema-lite）。
 * 字段与默认值 = 手感基线（S13 API.md §4 草案 + 输入阈值沿 v1 现值）；
 * 校验在 core configValidator.validateUiParams（非法值进不了这里，解析仍做防御性回退）。
 */
import { defaultScrollFeel, type ScrollFeel } from './scroll.js';

export interface UiPressConfig {
  /** 按压取消阈值 px（移动超过判定为滚动/拖拽，InputRouter slop） */
  slopPx: number;
  /** tap 判定时长 ms（手势分类用，v2 GestureClassifier 对齐项） */
  tapMaxMs: number;
}

export interface UiDoubleTapConfig {
  windowMs: number;
  maxDistPx: number;
}

export interface UiTextConfig {
  /** 默认正文字号 px */
  fontSizePx: number;
  /** 默认行高倍数 */
  lineHeightMul: number;
}

export interface UiConfig {
  scroll: ScrollFeel;
  press: UiPressConfig;
  doubleTap: UiDoubleTapConfig;
  text: UiTextConfig;
}

export const defaultUiConfig: UiConfig = {
  scroll: { ...defaultScrollFeel },
  press: { slopPx: 8, tapMaxMs: 350 },
  doubleTap: { windowMs: 280, maxDistPx: 40 },
  text: { fontSizePx: 16, lineHeightMul: 1.2 },
};

function num(src: unknown, key: string, fallback: number): number {
  const v = (src as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** params = game.json 的 params 段（容错：任意形状/缺省 → 全默认） */
export function resolveUiConfig(params: unknown): UiConfig {
  const ui = (params as Record<string, unknown> | null | undefined)?.ui as Record<string, unknown> | undefined;
  const d = defaultUiConfig;
  const scroll = ui?.scroll;
  return {
    scroll: {
      frictionPerS: num(scroll, 'frictionPerS', d.scroll.frictionPerS),
      minVelocityPxS: num(scroll, 'minVelocityPxS', d.scroll.minVelocityPxS),
      flingMaxPxS: num(scroll, 'flingMaxPxS', d.scroll.flingMaxPxS),
      overscrollResist: num(scroll, 'overscrollResist', d.scroll.overscrollResist),
      bounceStiffness: num(scroll, 'bounceStiffness', d.scroll.bounceStiffness),
      bounceDamping: num(scroll, 'bounceDamping', d.scroll.bounceDamping),
      settleEpsPx: num(scroll, 'settleEpsPx', d.scroll.settleEpsPx),
      settleEpsPxS: num(scroll, 'settleEpsPxS', d.scroll.settleEpsPxS),
    },
    press: {
      slopPx: num(ui?.press, 'slopPx', d.press.slopPx),
      tapMaxMs: num(ui?.press, 'tapMaxMs', d.press.tapMaxMs),
    },
    doubleTap: {
      windowMs: num(ui?.doubleTap, 'windowMs', d.doubleTap.windowMs),
      maxDistPx: num(ui?.doubleTap, 'maxDistPx', d.doubleTap.maxDistPx),
    },
    text: {
      fontSizePx: num(ui?.text, 'fontSizePx', d.text.fontSizePx),
      lineHeightMul: num(ui?.text, 'lineHeightMul', d.text.lineHeightMul),
    },
  };
}
