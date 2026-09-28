/**
 * SDF 字体度量类型与 FontSet（S12 产物 assets/fonts/*.metrics.json 的运行时侧）。
 * 编码约定见 assets/fonts/README.md：像素值 v∈[0,255]，sd_px=(v/255-0.5)*spread，正=字形内部；
 * 所有 px 基于 sdf.fontSize，渲染字号 S 时统一乘 k = S/fontSize。
 * 本模块不加载资源（IO 走 resources.ts 的 UiResources 注入，wx 侧 S6 接 extras.readBinary）。
 */
import * as THREE from 'three';
import type { ImageLike } from '../resources.js';

export interface SdfGlyph {
  char: string;
  codepoint: number;
  /** 笔进量（fontSize 基准 px） */
  advance: number;
  /** 墨迹左缘相对 pen 的 x 偏移（右为正） */
  bearingX: number;
  /** 墨迹顶边相对基线高度（y 向上为正） */
  bearingY: number;
  inkW: number;
  inkH: number;
  /** 图集单元（墨迹 + buffer 外扩），图集像素坐标，y 自顶向下 */
  cell: { x: number; y: number; w: number; h: number };
  /** 归一化图集坐标：(x0,y0)=左上，(x1,y1)=右下（配合 texture.flipY=false） */
  uv: { x0: number; y0: number; x1: number; y1: number };
  fallbackFont?: string;
}

export interface SdfParams {
  fontSize: number;
  spread: number;
  padding: number;
  buffer: number;
  gap: number;
  encoding?: string;
}

export interface SdfBaseline {
  ascenderPx: number;
  descenderPx: number;
  lineHeightPx: number;
}

/** metrics.json 全量结构（tr-sdf-atlas/1） */
export interface SdfAtlasMetrics {
  format?: string;
  generator?: string;
  font?: string;
  sdf: SdfParams;
  atlas: { width: number; height: number; channels?: number };
  baseline: SdfBaseline;
  glyphs: SdfGlyph[];
  missing?: string[];
}

export interface FontAtlas {
  metrics: SdfAtlasMetrics;
  /** codepoint → glyph 索引 */
  glyphs: Map<number, SdfGlyph>;
  /** 图集纹理；headless 测试可为 null（不渲染只排版） */
  texture: THREE.Texture | null;
}

export interface FontLookup {
  atlasIndex: number;
  glyph: SdfGlyph;
}

/** 多图集字体族（latin + cjk）：按图集顺序查字形，全部未命中 = 缺字（渲染占位方块） */
export interface FontSet {
  atlases: FontAtlas[];
  lookup(codepoint: number): FontLookup | undefined;
  /** 取首个图集的 SDF 参数（同工具链生成，各图集一致） */
  sdf: SdfParams;
  baseline: SdfBaseline;
}

export function createFontAtlas(metrics: SdfAtlasMetrics, texture: THREE.Texture | null = null): FontAtlas {
  const glyphs = new Map<number, SdfGlyph>();
  for (const g of metrics.glyphs) glyphs.set(g.codepoint, g);
  return { metrics, glyphs, texture };
}

export function createFontSet(atlases: FontAtlas[]): FontSet {
  if (atlases.length === 0) throw new Error('FontSet 至少需要一张图集');
  const first = atlases[0]!;
  return {
    atlases,
    sdf: first.metrics.sdf,
    baseline: first.metrics.baseline,
    lookup(codepoint: number): FontLookup | undefined {
      for (let i = 0; i < atlases.length; i++) {
        const g = atlases[i]!.glyphs.get(codepoint);
        if (g) return { atlasIndex: i, glyph: g };
      }
      return undefined;
    },
  };
}

/**
 * 由解码完成的图片对象建图集纹理（README §4 约定：flipY=false、无 mipmap、Linear）。
 * image 为不透明句柄：web 侧是 HTMLImageElement/ImageBitmap，wx 侧是 wx.createImage() 产物（S6）。
 */
export function createFontTexture(image: ImageLike): THREE.Texture {
  const t = new THREE.Texture(image as unknown as HTMLImageElement);
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** 缺字占位（tofu）的笔进量估算：CJK 全宽、其余半宽 */
export function fallbackAdvance(codepoint: number, fontSizePx: number): number {
  return codepoint >= 0x2e80 ? fontSizePx : fontSizePx * 0.55;
}
