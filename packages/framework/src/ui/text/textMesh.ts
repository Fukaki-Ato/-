/**
 * TextMesh：把 layoutText 的四边形上传为 three 网格（每张图集一个 Mesh + 缺字占位一个 Mesh）。
 * 局部坐标 = UI 屏幕系取负 y（overlay 正交相机 top=0/bottom=-h，worldY=-uiY），
 * 因此顶点 winding 翻转，材质一律 DoubleSide（见 sdf.ts）。
 * 缓冲按容量增长复用（setDrawRange 截断），动态文本（HUD 分数）不反复分配。
 */
import * as THREE from 'three';
import type { FontSet } from './metrics.js';
import { layoutText, type PlacedQuad, type TextAlign, type TextLayout } from './layoutText.js';
import { createSdfMaterial, spreadKFor } from './sdf.js';
import type { PaintCtx } from '../paint.js';
import { applyClip, uiColor } from '../paint.js';
import { createUiBasicMaterial, createWhiteTexture, setUiBasicColor, setUiBasicOpacity } from '../render/uiBasic.js';

export interface TextMeshOptions {
  color?: THREE.ColorRepresentation;
  opacity?: number;
  /** 设备像素比（uSpreadK 换算用），默认 1 */
  pixelRatio?: number;
}

interface AtlasBuffers {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  capacity: number;
}

const IDX_PER_QUAD = 6;

export class TextMesh {
  readonly object = new THREE.Group();
  private font: FontSet;
  private atlasMeshes: AtlasBuffers[] = [];
  private tofu: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry; material: THREE.ShaderMaterial; whiteTex: THREE.DataTexture; capacity: number };
  private color: THREE.ColorRepresentation;
  private opacity: number;
  private pixelRatio: number;
  private fontSizePx = 16;

  constructor(font: FontSet, opts: TextMeshOptions = {}) {
    this.font = font;
    this.color = opts.color ?? '#ffffff';
    this.opacity = opts.opacity ?? 1;
    this.pixelRatio = opts.pixelRatio ?? 1;
    this.atlasMeshes = font.atlases.map(a => this.makeAtlasBuffers(a.texture));
    const tofuGeo = new THREE.BufferGeometry();
    const whiteTex = createWhiteTexture();
    const tofuMat = createUiBasicMaterial({ map: whiteTex, color: this.color, opacity: this.opacity * 0.35 });
    this.tofu = { mesh: new THREE.Mesh(tofuGeo, tofuMat), geometry: tofuGeo, material: tofuMat, whiteTex, capacity: 0 };
    this.tofu.mesh.visible = false;
    this.tofu.mesh.frustumCulled = false;
    for (const b of this.atlasMeshes) this.object.add(b.mesh);
    this.object.add(this.tofu.mesh);
  }

  private makeAtlasBuffers(texture: THREE.Texture | null): AtlasBuffers {
    const geometry = new THREE.BufferGeometry();
    const material = createSdfMaterial(texture, { color: this.color, opacity: this.opacity, spreadK: 1 });
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(0), 1));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // UI 常驻屏幕，不参与视锥剔除
    return { mesh, geometry, material, capacity: 0 };
  }

  /** 重排文本并上传顶点；返回布局结果（Label 用于对外暴露度量） */
  set(text: string, style: { fontSizePx: number; lineHeightMul?: number; align?: TextAlign; maxWidthPx?: number }): TextLayout {
    this.fontSizePx = style.fontSizePx;
    const layout = layoutText(this.font, text, style);
    const perAtlas = this.font.atlases.map(() => [] as PlacedQuad[]);
    for (const q of layout.quads) perAtlas[q.atlasIndex]?.push(q);
    perAtlas.forEach((quads, i) => this.uploadQuads(this.atlasMeshes[i]!, quads));
    this.uploadTofu(layout.tofus);
    this.refreshSpreadK();
    return layout;
  }

  private uploadQuads(b: AtlasBuffers, quads: PlacedQuad[]): void {
    if (quads.length === 0) { b.geometry.setDrawRange(0, 0); b.mesh.visible = false; return; }
    b.mesh.visible = true;
    if (quads.length > b.capacity) {
      b.capacity = Math.max(quads.length, b.capacity * 2, 32);
      const pos = new Float32Array(b.capacity * 4 * 3);
      const uv = new Float32Array(b.capacity * 4 * 2);
      const idx = quads.length * IDX_PER_QUAD > 65535 ? new Uint32Array(b.capacity * IDX_PER_QUAD) : new Uint16Array(b.capacity * IDX_PER_QUAD);
      b.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      b.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      b.geometry.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    const pos = b.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = b.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const index = b.geometry.getIndex()!;
    quads.forEach((q, i) => {
      const v = i * 4;
      const y0 = -q.y, y1 = -(q.y + q.h); // worldY = -uiY
      pos.setXYZ(v, q.x, y0, 0);
      pos.setXYZ(v + 1, q.x + q.w, y0, 0);
      pos.setXYZ(v + 2, q.x + q.w, y1, 0);
      pos.setXYZ(v + 3, q.x, y1, 0);
      uv.setXY(v, q.uv.x0, q.uv.y0);
      uv.setXY(v + 1, q.uv.x1, q.uv.y0);
      uv.setXY(v + 2, q.uv.x1, q.uv.y1);
      uv.setXY(v + 3, q.uv.x0, q.uv.y1);
      const o = i * IDX_PER_QUAD;
      index.setX(o, v); index.setX(o + 1, v + 1); index.setX(o + 2, v + 2);
      index.setX(o + 3, v); index.setX(o + 4, v + 2); index.setX(o + 5, v + 3);
    });
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    index.needsUpdate = true;
    b.geometry.setDrawRange(0, quads.length * IDX_PER_QUAD);
  }

  private uploadTofu(rects: { x: number; y: number; w: number; h: number }[]): void {
    const t = this.tofu;
    if (rects.length === 0) { t.mesh.visible = false; t.geometry.setDrawRange(0, 0); return; }
    t.mesh.visible = true;
    if (rects.length > t.capacity) {
      t.capacity = Math.max(rects.length, t.capacity * 2, 8);
      t.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(t.capacity * 4 * 3), 3));
      t.geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(t.capacity * IDX_PER_QUAD), 1));
    }
    const pos = t.geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = t.geometry.getIndex()!;
    rects.forEach((r, i) => {
      const v = i * 4;
      const y0 = -r.y, y1 = -(r.y + r.h);
      pos.setXYZ(v, r.x, y0, 0); pos.setXYZ(v + 1, r.x + r.w, y0, 0);
      pos.setXYZ(v + 2, r.x + r.w, y1, 0); pos.setXYZ(v + 3, r.x, y1, 0);
      const o = i * IDX_PER_QUAD;
      index.setX(o, v); index.setX(o + 1, v + 1); index.setX(o + 2, v + 2);
      index.setX(o + 3, v); index.setX(o + 4, v + 2); index.setX(o + 5, v + 3);
    });
    pos.needsUpdate = true;
    index.needsUpdate = true;
    t.geometry.setDrawRange(0, rects.length * IDX_PER_QUAD);
  }

  private refreshSpreadK(): void {
    this.font.atlases.forEach((a, i) => {
      const b = this.atlasMeshes[i]!;
      b.material.uniforms.uSpreadK!.value = spreadKFor(a.metrics.sdf.spread, a.metrics.sdf.fontSize, this.fontSizePx, this.pixelRatio);
    });
  }

  setColor(c: THREE.ColorRepresentation): void {
    this.color = c;
    for (const b of this.atlasMeshes) (b.material.uniforms.uColor!.value as THREE.Color).copy(uiColor(c));
    setUiBasicColor(this.tofu.material, c);
  }

  setOpacity(o: number): void {
    this.opacity = o;
    for (const b of this.atlasMeshes) b.material.uniforms.uOpacity!.value = o;
    setUiBasicOpacity(this.tofu.material, o * 0.35);
  }

  setPixelRatio(dpr: number): void {
    this.pixelRatio = dpr;
    this.refreshSpreadK();
  }

  /** 绘制序号 + 祖先裁剪面（组内所有材质/网格一致） */
  setPaint(ctx: PaintCtx): void {
    const order = ctx.order();
    for (const b of this.atlasMeshes) { b.mesh.renderOrder = order; applyClip(b.material, ctx); }
    this.tofu.mesh.renderOrder = order;
    applyClip(this.tofu.material, ctx);
  }

  dispose(): void {
    for (const b of this.atlasMeshes) { b.geometry.dispose(); b.material.dispose(); }
    this.tofu.geometry.dispose();
    this.tofu.material.dispose();
    this.tofu.whiteTex.dispose();
  }
}
