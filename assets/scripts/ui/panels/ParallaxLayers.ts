import type { Node, Texture2D } from 'cc';

/**
 * 主界面背景视差层（BG2 并行会话负责实现；当前为占位实现，接口已冻结，勿改签名）。
 * 调用方：MainMenuBackground.ts（BG1 会话）。
 */
export interface ParallaxCropSpec {
  /** 源图纹理内归一化裁剪区（0-1，**左上原点、y 向下**；与 SpriteFrame.rect 口径一致）：x, y, w, h */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 屏幕上的显示高度（设计像素） */
  screenHeight: number;
  /** 条带中心的设计坐标 Y（相对屏幕中心，向上为正） */
  screenY: number;
  /** 水平速度（设计像素/秒，正值向右） */
  speed: number;
  /** 是否水平镜像拼接铺满整宽（保证无缝循环） */
  mirror: boolean;
  /** 透明度 0-255，默认 255 */
  opacity?: number;
}

export interface ParallaxOptions {
  /** 源纹理（来自已加载 SpriteFrame 的 texture） */
  texture: Texture2D;
  /** 源纹理像素尺寸 */
  textureSize: { width: number; height: number };
  /** 设计分辨率（750 × 1624） */
  designSize: { width: number; height: number };
  /** 条带参数；缺省使用 DEFAULT_PARALLAX_CROPS */
  crops?: ParallaxCropSpec[];
}

export interface ParallaxHandle {
  update(dt: number): void;
  dispose(): void;
}

/** 临时估值（主会话提供）；BG3 会话的校准结果见 temp/bg-eval/crops.json。 */
export const DEFAULT_PARALLAX_CROPS: ParallaxCropSpec[] = [
  { x: 0.15, y: 0.18, w: 0.7, h: 0.2, screenHeight: 350, screenY: 313, speed: 8, mirror: true },
  { x: 0.0, y: 0.66, w: 0.35, h: 0.24, screenHeight: 380, screenY: -482, speed: -14, mirror: true },
];

/** 占位实现：BG2 会话用真实实现替换，保持导出签名不变。 */
export function createParallaxLayers(_parent: Node, _opts: ParallaxOptions): ParallaxHandle {
  return { update: () => undefined, dispose: () => undefined };
}
