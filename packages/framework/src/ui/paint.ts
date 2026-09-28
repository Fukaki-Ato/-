/**
 * 绘制上下文与 UI 颜色/裁剪约定。
 * - 层序：UI 全部材质 transparent+depthTest:false，完全由 renderOrder 决定（遍历序=画家算法）；
 * - 裁剪：滚动容器裁剪面经自定义 shader 的 uniform 生效（three 内建 clipping chunks 不进自定义
 *   ShaderMaterial，故不走 material.clippingPlanes / localClippingEnabled）；
 * - 颜色：uiColor() 按原始 sRGB 值存储（直通 shader 原样输出，所见即所得）。
 */
import * as THREE from 'three';

/** 裁剪面嵌套上限（两层滚动容器足够；更深层忽略，见 API.md 注记） */
export const MAX_CLIP_PLANES = 8;

/**
 * UI 颜色：绕过 three 色彩管理，按「原始 sRGB 值」存储（渲染管线为直通 shader，见 render/uiBasic.ts）。
 * 全 UI 材质颜色（文本/贴片/主题）一律经这里构造（#7FD1FF 就是 (127,209,255)）。
 * 例外：scene.background 走 three unlit clear 路径（自带 linear→sRGB 编码），须用普通 Color，见 overlay.ts。
 */
export function uiColor(c: THREE.ColorRepresentation): THREE.Color {
  const col = new THREE.Color();
  if (typeof c === 'string') col.setStyle(c, THREE.LinearSRGBColorSpace);
  else if (typeof c === 'number') col.setHex(c, THREE.LinearSRGBColorSpace);
  else col.copy(c);
  return col;
}

export interface PaintCtx {
  /** 递增取绘制序号（先调用者先画，在底层） */
  order(): number;
  /** 当前生效的祖先滚动容器裁剪面（空 = 不裁剪） */
  clip: readonly THREE.Plane[];
}

const NO_CLIP: readonly THREE.Plane[] = [];

export function rootPaintCtx(): PaintCtx {
  let seq = 0;
  return { order: () => ++seq, clip: NO_CLIP };
}

/** 裁剪 uniform 初值（未激活面 constant 取大正数，恒通过） */
export function clipUniforms(): { uClipPlanes: { value: THREE.Vector4[] }; uClipCount: { value: number } } {
  return {
    uClipPlanes: { value: Array.from({ length: MAX_CLIP_PLANES }, () => new THREE.Vector4(0, 0, 0, 1e9)) },
    uClipCount: { value: 0 },
  };
}

/** 把当前裁剪面写进材质 uniform（sdf / uiBasic 两种直通 shader 共用） */
export function applyClip(mat: THREE.ShaderMaterial, ctx: PaintCtx): void {
  const u = mat.uniforms;
  if (!u.uClipPlanes) return;
  const arr = u.uClipPlanes.value as THREE.Vector4[];
  const n = Math.min(ctx.clip.length, MAX_CLIP_PLANES);
  for (let i = 0; i < MAX_CLIP_PLANES; i++) {
    const p = i < n ? ctx.clip[i] : undefined;
    if (p) arr[i]!.set(p.normal.x, p.normal.y, p.normal.z, p.constant);
    else arr[i]!.set(0, 0, 0, 1e9);
  }
  u.uClipCount!.value = n;
}
