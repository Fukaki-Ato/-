/**
 * 视差条带的纯数学：源图裁剪换算与周期回绕（BG2）。
 * 不依赖 cc 运行时，便于单测；坐标系为设计像素、屏幕中心为原点（x 向右、y 向上）。
 */

/** 条带裁剪参数（与 ParallaxLayers.ParallaxCropSpec 结构兼容）。 */
export interface ParallaxCropNumbers {
  x: number;
  y: number;
  w: number;
  h: number;
  screenHeight: number;
  screenY: number;
  speed: number;
  mirror: boolean;
  opacity?: number;
}

export interface ParallaxSize {
  width: number;
  height: number;
}

/** 源纹理内的像素裁剪矩形（左上原点、y 向下，直接对应 SpriteFrame.rect）。 */
export interface ParallaxSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 单条带最大节点数（性能预算，见 docs/prompts/BG2-视差动效层.md §4.5）。 */
export const MAX_BLOCKS_PER_STRIP = 4;

/** 由裁剪换算得到的完整铺设参数。 */
export interface ParallaxLayerLayout {
  /** 源纹理像素裁剪矩形 */
  rect: ParallaxSourceRect;
  /** 单块屏幕宽度 = screenHeight × 源裁剪像素宽 / 源裁剪像素高 */
  blockWidth: number;
  screenHeight: number;
  screenY: number;
  speed: number;
  mirror: boolean;
  /** 归一化后的 UIOpacity（0-255） */
  opacity: number;
  /** 铺设块数（2–4；镜像时取偶数保证「原块 / 镜像块」交替一致） */
  blockCount: number;
  /** 回绕窗口左边界：最左块的左边界 x（屏幕中心为原点） */
  wrapLeft: number;
  /** 回绕周期 = blockCount × blockWidth（镜像时为镜像对周期的整数倍） */
  wrapSpan: number;
}

function isPositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** opacity 归一化到 0-255；缺省或非法值按 255（不透明）。 */
export function normalizeOpacity(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return 255;
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * 覆盖 designWidth 并至少多铺一块：blockCount ≥ designWidth / blockWidth + 1（回绕余量）。
 * 镜像铺贴时相邻块朝向交替，必须取偶数块，否则回绕后朝向错位出现跳变；最后受 4 块预算封顶。
 * 非法入参返回 0（调用方按不可铺设处理）。
 */
export function computeParallaxBlockCount(blockWidth: number, designWidth: number, mirror: boolean): number {
  if (!isPositiveNumber(blockWidth) || !isPositiveNumber(designWidth)) return 0;
  const cover = Math.max(2, Math.ceil(designWidth / blockWidth) + 1);
  const aligned = mirror && cover % 2 === 1 ? cover + 1 : cover;
  return Math.min(MAX_BLOCKS_PER_STRIP, aligned);
}

/**
 * 裁剪换算：归一化裁剪区（0-1，左上原点、y 向下）→ 像素 rect + 屏幕参数。
 * 任一输入非法（非有限数、宽高 ≤ 0、归一化区越界）返回 null，调用方跳过该条带。
 * 说明：SpriteFrame.rect 不校验越界，这里先取整再按纹理尺寸安全 clamp（四舍五入最多溢出 1px）。
 */
export function computeParallaxLayerLayout(
  crop: ParallaxCropNumbers,
  textureSize: ParallaxSize,
  designSize: ParallaxSize,
): ParallaxLayerLayout | null {
  if (!crop || !textureSize || !designSize) return null;
  const { x, y, w, h, screenHeight, screenY, speed, mirror } = crop;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (!Number.isFinite(screenHeight) || !Number.isFinite(screenY) || !Number.isFinite(speed)) return null;
  if (!isPositiveNumber(textureSize.width) || !isPositiveNumber(textureSize.height)) return null;
  if (!isPositiveNumber(designSize.width)) return null;
  if (!(w > 0) || !(h > 0) || !(screenHeight > 0)) return null;
  if (x < 0 || y < 0 || x + w > 1 || y + h > 1) return null;

  const texW = Math.floor(textureSize.width);
  const texH = Math.floor(textureSize.height);
  const rect: ParallaxSourceRect = {
    x: clampInt(Math.round(x * texW), 0, Math.max(0, texW - 1)),
    y: clampInt(Math.round(y * texH), 0, Math.max(0, texH - 1)),
    width: 0,
    height: 0,
  };
  rect.width = clampInt(Math.round(w * texW), 1, Math.max(0, texW - rect.x));
  rect.height = clampInt(Math.round(h * texH), 1, Math.max(0, texH - rect.y));
  if (rect.width <= 0 || rect.height <= 0) return null;

  const blockWidth = (screenHeight * rect.width) / rect.height;
  if (!isPositiveNumber(blockWidth)) return null;
  const blockCount = computeParallaxBlockCount(blockWidth, designSize.width, mirror);
  if (blockCount <= 0) return null;
  const wrapSpan = blockCount * blockWidth;
  if (!isPositiveNumber(wrapSpan)) return null;
  // 覆盖校验：受 4 块预算封顶后，回绕窗口必须仍满足「覆盖 designWidth + 一块宽度」，
  // 否则条带会出现周期性缺口（窄条带预算不足时）——按不可铺设处理，跳过该条带。
  if (wrapSpan < designSize.width + blockWidth) return null;

  return {
    rect,
    blockWidth,
    screenHeight,
    screenY,
    speed,
    mirror,
    opacity: normalizeOpacity(crop.opacity),
    blockCount,
    // 最左块从屏幕左缘外一块宽处开始，保证水平位移到达任意相位时视口仍被完全覆盖。
    wrapLeft: -designSize.width / 2 - blockWidth,
    wrapSpan,
  };
}

/** 把 x 回绕到 [left, left + span)：位移超过一个周期即按周期回绕，保证视觉连续。 */
export function wrapSpanPosition(x: number, left: number, span: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(left) || !isPositiveNumber(span)) return x;
  const offset = (x - left) % span;
  return left + (offset < 0 ? offset + span : offset);
}
