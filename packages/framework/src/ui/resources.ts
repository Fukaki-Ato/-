/**
 * 资源注入接口（ui 包零 IO：本包禁止 fetch/DOM/wx，加载能力由宿主实现后注入）。
 * - web（apps/web）：fetch + blob → Image/ImageBitmap（见 apps/web/src/uiDemo.ts）；
 * - wx（S6 接入点）：extras.readBinary → wx.createImage()（onload 后 resolve 同一 ImageLike 句柄）。
 * metrics.json 走 loadJson（wx 侧可用 extras.readJson）。
 */
import { createFontAtlas, createFontSet, createFontTexture, type FontSet, type SdfAtlasMetrics } from './text/metrics.js';

/** 解码完成的图片句柄（three Texture 的 image 源；结构化最小类型，两端实现各自满足） */
export interface ImageLike {
  width: number;
  height: number;
}

export interface UiResources {
  loadJson(path: string): Promise<unknown>;
  loadImage(path: string): Promise<ImageLike>;
}

/**
 * 加载 S12 图集对（latin + cjk），dir 为图集目录（如 web 端 '/assets/fonts'）。
 * 文件名契约：latin.png / latin.metrics.json / cjk.png / cjk.metrics.json。
 */
export async function loadFontSet(res: UiResources, dir: string): Promise<FontSet> {
  const [latinM, cjkM] = await Promise.all([
    res.loadJson(`${dir}/latin.metrics.json`),
    res.loadJson(`${dir}/cjk.metrics.json`),
  ]);
  const [latinI, cjkI] = await Promise.all([
    res.loadImage(`${dir}/latin.png`),
    res.loadImage(`${dir}/cjk.png`),
  ]);
  return createFontSet([
    createFontAtlas(latinM as SdfAtlasMetrics, createFontTexture(latinI)),
    createFontAtlas(cjkM as SdfAtlasMetrics, createFontTexture(cjkI)),
  ]);
}
