import { isValid, Rect, Size, Sprite, SpriteFrame, UIOpacity } from 'cc';
import type { Node, Texture2D } from 'cc';
import { node as uiNode } from '../framework/UIKit';
import { computeParallaxLayerLayout, wrapSpanPosition } from './parallaxMath';
import type { ParallaxLayerLayout } from './parallaxMath';

/**
 * 主界面背景视差层（BG2 并行会话负责实现；接口已冻结，勿改签名）。
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

interface ParallaxBlock {
  node: Node;
  /** 当前左边界 x（相对屏幕中心） */
  left: number;
}

interface ParallaxLayerState {
  layout: ParallaxLayerLayout;
  frame: SpriteFrame;
  blocks: ParallaxBlock[];
}

function noopHandle(): ParallaxHandle {
  return { update: () => undefined, dispose: () => undefined };
}

/** 创建单块：同一裁剪帧的精灵，镜像块整节点 scale.x = -1；opacity 挂在节点 UIOpacity 上。 */
function createBlockNode(parent: Node, layout: ParallaxLayerLayout, frame: SpriteFrame, index: number): ParallaxBlock {
  const left = layout.wrapLeft + index * layout.blockWidth;
  const blockNode = uiNode('ParallaxBlock', {
    parent,
    size: { width: layout.blockWidth, height: layout.screenHeight },
    position: [left + layout.blockWidth / 2, layout.screenY],
  });
  const sprite = blockNode.addComponent(Sprite);
  sprite.spriteFrame = frame;
  sprite.trim = false;
  sprite.sizeMode = Sprite.SizeMode.CUSTOM;
  if (layout.mirror && index % 2 === 1) blockNode.setScale(-1, 1, 1);
  if (layout.opacity < 255) blockNode.addComponent(UIOpacity).opacity = layout.opacity;
  return { node: blockNode, left };
}

/** 真实实现：从源纹理裁条带，镜像交替平铺并水平滚动；参数与算式见 docs/reports/BG2-视差动效层.md。 */
export function createParallaxLayers(parent: Node, opts: ParallaxOptions): ParallaxHandle {
  if (!parent || !opts) return noopHandle();
  const crops = opts.crops ?? DEFAULT_PARALLAX_CROPS;
  const texture = opts.texture;
  const { textureSize, designSize } = opts;
  // 纹理/尺寸无效或 crops 为空：完全 no-op（不抛错）。
  if (!texture || !isValid(texture) || !Array.isArray(crops) || crops.length === 0) return noopHandle();
  if (!textureSize || !designSize) return noopHandle();
  if (!(textureSize.width > 0) || !(textureSize.height > 0)) return noopHandle();
  if (!(designSize.width > 0)) return noopHandle();

  const layers: ParallaxLayerState[] = [];
  for (const crop of crops) {
    const layout = computeParallaxLayerLayout(crop, textureSize, designSize);
    if (!layout) continue;
    const blocks: ParallaxBlock[] = [];
    let frame: SpriteFrame | null = null;
    try {
      frame = new SpriteFrame();
      // 顺序固定：先 texture（会把 rect 重置为整图），再 rect，最后 originalSize；挂到 Sprite 后不再改 rect。
      frame.texture = texture;
      frame.rect = new Rect(layout.rect.x, layout.rect.y, layout.rect.width, layout.rect.height);
      frame.originalSize = new Size(layout.rect.width, layout.rect.height);
      for (let index = 0; index < layout.blockCount; index += 1) {
        blocks.push(createBlockNode(parent, layout, frame, index));
      }
    } catch {
      // 单条带创建失败不影响其它条带：清理已建节点后跳过。
      for (const block of blocks) if (isValid(block.node)) block.node.destroy();
      if (frame && isValid(frame)) frame.destroy();
      continue;
    }
    if (!frame) continue;
    layers.push({ layout, frame, blocks });
  }

  let disposed = false;
  return {
    update(dt: number): void {
      if (disposed || !Number.isFinite(dt) || dt === 0) return;
      for (const layer of layers) {
        const { layout, blocks } = layer;
        const dx = layout.speed * dt;
        if (!Number.isFinite(dx) || dx === 0) continue;
        // 只改节点位置（不建/销节点、不碰纹理与 UV）；越出回绕周期即按周期取模回绕。
        for (const block of blocks) {
          if (!isValid(block.node)) continue;
          block.left = wrapSpanPosition(block.left + dx, layout.wrapLeft, layout.wrapSpan);
          block.node.setPosition(block.left + layout.blockWidth / 2, layout.screenY, 0);
        }
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const layer of layers) {
        for (const block of layer.blocks) if (isValid(block.node)) block.node.destroy();
        // 只销毁自建 SpriteFrame（不销毁传入的 texture）。
        if (isValid(layer.frame)) layer.frame.destroy();
      }
      layers.length = 0;
    },
  };
}
