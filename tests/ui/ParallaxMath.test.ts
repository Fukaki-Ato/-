import { describe, expect, it } from 'vitest';
import {
  computeParallaxBlockCount,
  computeParallaxLayerLayout,
  normalizeOpacity,
  wrapSpanPosition,
} from '../../assets/scripts/ui/panels/parallaxMath';
import type { ParallaxCropNumbers, ParallaxLayerLayout } from '../../assets/scripts/ui/panels/parallaxMath';

const TEXTURE = { width: 1007, height: 1562 };
const DESIGN = { width: 750, height: 1624 };

function mustLayout(
  crop: ParallaxCropNumbers,
  texture: { width: number; height: number } = TEXTURE,
  design: { width: number; height: number } = DESIGN,
): ParallaxLayerLayout {
  const layout = computeParallaxLayerLayout(crop, texture, design);
  if (!layout) throw new Error('layout 不应为 null');
  return layout;
}

/** 1:1 像素裁剪的干净纹理，便于构造确定的 blockWidth。 */
const SQUARE_TEXTURE = { width: 1000, height: 1000 };

describe('computeParallaxLayerLayout', () => {
  it('默认云带：像素裁剪 + 屏幕宽度换算', () => {
    const layout = mustLayout({ x: 0.15, y: 0.18, w: 0.7, h: 0.2, screenHeight: 350, screenY: 313, speed: 8, mirror: true });
    expect(layout.rect).toEqual({ x: 151, y: 281, width: 705, height: 312 });
    expect(layout.blockWidth).toBeCloseTo((350 * 705) / 312, 6);
    expect(layout.screenHeight).toBe(350);
    expect(layout.screenY).toBe(313);
    expect(layout.speed).toBe(8);
    expect(layout.opacity).toBe(255);
    expect(layout.blockCount).toBe(2);
    expect(layout.wrapLeft).toBeCloseTo(-DESIGN.width / 2 - layout.blockWidth, 6);
    expect(layout.wrapSpan).toBeCloseTo(2 * layout.blockWidth, 6);
  });

  it('默认海浪带：4 块（镜像取偶）+ 回绕周期为镜像对整数倍', () => {
    const layout = mustLayout({ x: 0, y: 0.66, w: 0.35, h: 0.24, screenHeight: 380, screenY: -482, speed: -14, mirror: true });
    expect(layout.rect).toEqual({ x: 0, y: 1031, width: 352, height: 375 });
    expect(layout.blockWidth).toBeCloseTo((380 * 352) / 375, 6);
    expect(layout.blockCount).toBe(4);
    expect(layout.wrapSpan).toBeCloseTo(4 * layout.blockWidth, 6);
    expect(layout.wrapSpan / layout.blockWidth).toBe(4);
  });

  it('覆盖不足时镜像自动补为偶数块', () => {
    const layout = mustLayout({ x: 0, y: 0, w: 0.4, h: 0.4, screenHeight: 400, screenY: 0, speed: 0, mirror: true }, SQUARE_TEXTURE);
    expect(layout.blockWidth).toBeCloseTo(400, 6);
    // ceil(750 / 400) + 1 = 3 → 镜像补为 4
    expect(layout.blockCount).toBe(4);
  });

  it('块数受每带 4 节点预算封顶', () => {
    const layout = mustLayout({ x: 0, y: 0, w: 0.1, h: 0.1, screenHeight: 100, screenY: 0, speed: 0, mirror: false }, SQUARE_TEXTURE);
    expect(layout.blockWidth).toBeCloseTo(100, 6);
    expect(layout.blockCount).toBe(4);
  });

  it('四舍五入溢出时按纹理边界安全 clamp', () => {
    const layout = mustLayout({ x: 0.5, y: 0.5, w: 0.5, h: 0.5, screenHeight: 100, screenY: 0, speed: 0, mirror: false });
    expect(layout.rect.x).toBe(504);
    expect(layout.rect.width).toBe(503);
    expect(layout.rect.x + layout.rect.width).toBe(TEXTURE.width);
    expect(layout.rect.y + layout.rect.height).toBe(TEXTURE.height);
  });

  it('非法输入返回 null（不抛错）', () => {
    const base: ParallaxCropNumbers = { x: 0, y: 0, w: 0.5, h: 0.5, screenHeight: 100, screenY: 0, speed: 0, mirror: false };
    expect(computeParallaxLayerLayout(base, { width: 0, height: 100 }, DESIGN)).toBeNull();
    expect(computeParallaxLayerLayout(base, { width: 100, height: -1 }, DESIGN)).toBeNull();
    expect(computeParallaxLayerLayout(base, { width: 100, height: 100 }, { width: 0, height: 100 })).toBeNull();
    expect(computeParallaxLayerLayout({ ...base, w: 0 }, TEXTURE, DESIGN)).toBeNull();
    expect(computeParallaxLayerLayout({ ...base, x: -0.01 }, TEXTURE, DESIGN)).toBeNull();
    expect(computeParallaxLayerLayout({ ...base, x: 0.9, w: 0.2 }, TEXTURE, DESIGN)).toBeNull();
    expect(computeParallaxLayerLayout({ ...base, y: 0.9, h: 0.2 }, TEXTURE, DESIGN)).toBeNull();
    expect(computeParallaxLayerLayout({ ...base, screenHeight: 0 }, TEXTURE, DESIGN)).toBeNull();
    expect(computeParallaxLayerLayout({ ...base, speed: Number.NaN }, TEXTURE, DESIGN)).toBeNull();
    expect(computeParallaxLayerLayout({ ...base, h: Number.POSITIVE_INFINITY }, TEXTURE, DESIGN)).toBeNull();
  });
});

describe('computeParallaxBlockCount', () => {
  it('覆盖设计宽度并多铺一块', () => {
    expect(computeParallaxBlockCount(2000, 750, false)).toBe(2);
    expect(computeParallaxBlockCount(400, 750, false)).toBe(3);
    expect(computeParallaxBlockCount(400, 750, true)).toBe(4);
    expect(computeParallaxBlockCount(250, 750, false)).toBe(4);
  });

  it('非法入参返回 0', () => {
    expect(computeParallaxBlockCount(0, 750, false)).toBe(0);
    expect(computeParallaxBlockCount(400, 0, false)).toBe(0);
    expect(computeParallaxBlockCount(Number.NaN, 750, false)).toBe(0);
  });
});

describe('normalizeOpacity', () => {
  it('归一化到 0-255', () => {
    expect(normalizeOpacity(undefined)).toBe(255);
    expect(normalizeOpacity(128)).toBe(128);
    expect(normalizeOpacity(127.6)).toBe(128);
    expect(normalizeOpacity(-5)).toBe(0);
    expect(normalizeOpacity(300)).toBe(255);
    expect(normalizeOpacity(Number.NaN)).toBe(255);
  });
});

describe('wrapSpanPosition', () => {
  it('周期内保持原位，越界按周期回绕', () => {
    expect(wrapSpanPosition(5, 0, 10)).toBe(5);
    expect(wrapSpanPosition(10, 0, 10)).toBe(0);
    expect(wrapSpanPosition(15, 0, 10)).toBe(5);
    expect(wrapSpanPosition(-5, 0, 10)).toBe(5);
    expect(wrapSpanPosition(-15, 0, 10)).toBe(5);
  });

  it('大位移（帧间隔尖峰）仍落在回绕区间内', () => {
    const left = -1165.87;
    const span = 1581.73;
    for (const offset of [-1e6, -1234.5, 0, 42.42, 1e6]) {
      const wrapped = wrapSpanPosition(123.45 + offset, left, span);
      expect(wrapped).toBeGreaterThanOrEqual(left);
      expect(wrapped).toBeLessThan(left + span);
    }
  });

  it('span 非法时原样返回', () => {
    expect(wrapSpanPosition(3, 0, 0)).toBe(3);
    expect(wrapSpanPosition(3, 0, Number.NaN)).toBe(3);
  });
});
