/**
 * 程序化皮肤纹理：圆角矩形 RGBA DataTexture（九宫格源图）。
 * 纯数据生成（无 DOM/canvas），两端通用；确定性输出（同参数同字节，可单测）。
 * 采样 3×3 超采样做边缘 AA；border 环在形状内侧，内外边界各 1px 过渡。
 */
import * as THREE from 'three';
import type { Edges } from '../types.js';

export interface SkinSpec {
  /** 纹理边长 px（正方形），默认由 radius/border 推出（保证九宫格角区完整） */
  sizePx?: number;
  radiusPx?: number;
  borderPx?: number;
  /** '#RRGGBB' */
  fill: string;
  /** 缺省 = 无描边 */
  border?: string | null;
  fillAlpha?: number;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/** 颜色线性混合（t=0 → a，t=1 → b），返回 '#RRGGBB' */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${f(ar, br)}${f(ag, bg)}${f(ab, bb)}`;
}

/** 圆角矩形有符号距离（负=内部），中心 (cx,cy) */
function sdRoundRect(px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: number): number {
  const dx = Math.max(Math.abs(px - cx) - (hw - r), 0);
  const dy = Math.max(Math.abs(py - cy) - (hh - r), 0);
  return Math.hypot(dx, dy) - r;
}

const SS = 3; // 超采样 3×3

export function createSkinTexture(spec: SkinSpec): { texture: THREE.DataTexture; insets: Edges; sizePx: number } {
  const radius = Math.max(0, spec.radiusPx ?? 8);
  const border = Math.max(0, spec.borderPx ?? 0);
  const size = Math.max(8, spec.sizePx ?? (radius + border + 2) * 2 + 3);
  const [fr, fg, fb] = hexToRgb(spec.fill);
  const hasBorder = !!spec.border && border > 0;
  const [br, bg, bb] = hasBorder ? hexToRgb(spec.border!) : [0, 0, 0];
  const fillA = Math.round((spec.fillAlpha ?? 1) * 255);

  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0, borderW = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const d = sdRoundRect(px, py, half, half, half, half, radius);
          cov += Math.min(1, Math.max(0, 0.5 - d));
          if (hasBorder) borderW += 1 - Math.min(1, Math.max(0, d + border));
        }
      }
      cov /= SS * SS;
      borderW /= SS * SS;
      const i = (y * size + x) * 4;
      data[i] = Math.round(fr + (br - fr) * borderW);
      data[i + 1] = Math.round(fg + (bg - fg) * borderW);
      data[i + 2] = Math.round(fb + (bb - fb) * borderW);
      data[i + 3] = Math.round(fillA * cov);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  // 九宫格角区 = 圆角 + 描边 + 1px AA 余量（保证中段拉伸区是纯平色）
  const inset = radius + border + 1;
  return { texture, insets: { top: inset, right: inset, bottom: inset, left: inset }, sizePx: size };
}
