/**
 * 九宫格贴片：4×4 顶点网格（9 个面片），角区固定尺寸、中段双向拉伸。
 * 源图 insets 为纹理像素；屏幕 insets 默认与纹理 1:1（程序化皮肤即如此），可显式覆盖。
 * rect 为 UI 屏幕系（y 下）；顶点写入 worldY=-uiY（与 TextMesh 同约定），材质 DoubleSide。
 */
import * as THREE from 'three';
import type { Edges, Rect } from '../types.js';
import { createUiBasicMaterial, setUiBasicColor, setUiBasicOpacity } from './uiBasic.js';
import type { PaintCtx } from '../paint.js';
import { applyClip } from '../paint.js';

export interface NinePatchSource {
  texture: THREE.Texture;
  /** 纹理像素 insets（角区） */
  insets: Edges;
  /** 源图尺寸 px（DataTexture 为正方形边长） */
  texSize: { w: number; h: number };
  /**
   * 'cover' = 保持源图比例铺满目标矩形、超出部分居中裁掉；缺省 'fill' = 整图拉伸。
   * 全屏照片背景用 cover：宿主窗口比例和源图不一致时（桌面横窗）拉伸会把画面拉变形。
   * 裁切写在 UV 上而不是 texture.repeat 上，因为 UI 材质是自定义 shader，不应用 three 的
   * 纹理变换矩阵（见 uiBasic.ts）。
   */
  fit?: 'fill' | 'cover';
}

/** 切分轴：[0, l, size-r, size] 与对应 uv（insets 夹到不越界，保证单调） */
function slices(size: number, lead: number, trail: number): { pos: number[]; uv: number[] } {
  const s = Math.max(1, size);
  const l = Math.max(0, Math.min(lead, s));
  const r = Math.max(0, Math.min(trail, s - l));
  return { pos: [0, l, s - r, s], uv: [0, l / s, 1 - r / s, 1] };
}

export function ninePatchGeometry(rect: Rect, insetsPx: Edges, src: NinePatchSource): THREE.BufferGeometry {
  const il = Math.max(0, Math.min(insetsPx.left, rect.w));
  const ir = Math.max(0, Math.min(insetsPx.right, rect.w - il));
  const it = Math.max(0, Math.min(insetsPx.top, rect.h));
  const ib = Math.max(0, Math.min(insetsPx.bottom, rect.h - it));
  const xs = [rect.x, rect.x + il, rect.x + rect.w - ir, rect.x + rect.w];
  const ys = [rect.y, rect.y + it, rect.y + rect.h - ib, rect.y + rect.h];
  const uSrc = slices(src.texSize.w, src.insets.left, src.insets.right);
  const vSrc = slices(src.texSize.h, src.insets.top, src.insets.bottom);
  if (src.fit === 'cover') {
    // 取源图的一个居中子矩形，让它与目标矩形同比例：多出来的那一边按超出量裁掉
    const s = Math.max(rect.w / Math.max(1, src.texSize.w), rect.h / Math.max(1, src.texSize.h));
    const uw = Math.min(1, rect.w / (Math.max(1, src.texSize.w) * s));
    const vh = Math.min(1, rect.h / (Math.max(1, src.texSize.h) * s));
    const ox = (1 - uw) / 2, oy = (1 - vh) / 2;
    for (let i = 0; i < 4; i++) {
      uSrc.uv[i] = ox + uSrc.uv[i]! * uw;
      vSrc.uv[i] = oy + vSrc.uv[i]! * vh;
    }
  }

  const positions = new Float32Array(16 * 3);
  const uvs = new Float32Array(16 * 2);
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const v = j * 4 + i;
      positions[v * 3] = xs[i]!;
      positions[v * 3 + 1] = -ys[j]!; // worldY = -uiY
      positions[v * 3 + 2] = 0;
      uvs[v * 2] = uSrc.uv[i]!;
      uvs[v * 2 + 1] = vSrc.uv[j]!;
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const a = j * 4 + i;
      indices.push(a, a + 1, a + 5, a, a + 5, a + 4);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export interface NinePatchSpriteOptions {
  /** 屏幕 px 角区，默认 = 源纹理 insets（1:1） */
  insetsPx?: Edges;
  color?: THREE.ColorRepresentation;
  opacity?: number;
}

/** 单张九宫格背景片：update(rect) 时若矩形变化则重建几何（UI 面板低频，可接受） */
export class NinePatchSprite {
  readonly mesh: THREE.Mesh;
  private src: NinePatchSource;
  private insetsPx: Edges;
  private material: THREE.ShaderMaterial;
  private lastKey = '';

  constructor(src: NinePatchSource, opts: NinePatchSpriteOptions = {}) {
    this.src = src;
    this.insetsPx = opts.insetsPx ?? { ...src.insets };
    this.material = createUiBasicMaterial({ map: src.texture, color: opts.color ?? '#ffffff', opacity: opts.opacity ?? 1 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false; // UI 常驻屏幕，不参与视锥剔除
  }

  update(rect: Rect, ctx: PaintCtx): void {
    const key = `${rect.x}|${rect.y}|${rect.w}|${rect.h}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.mesh.geometry.dispose();
      this.mesh.geometry = ninePatchGeometry(rect, this.insetsPx, this.src);
      this.mesh.visible = rect.w > 0 && rect.h > 0;
    }
    this.mesh.renderOrder = ctx.order();
    applyClip(this.material, ctx);
  }

  setColor(c: THREE.ColorRepresentation): void { setUiBasicColor(this.material, c); }
  setOpacity(o: number): void { setUiBasicOpacity(this.material, o); }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
