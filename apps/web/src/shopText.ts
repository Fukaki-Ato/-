import type { FontSet } from '@tr/framework/ui/text/metrics.js';
import { layoutText } from '@tr/framework/ui/text/layoutText.js';

export const SHOP_CUSTOM_GLYPHS = ['惠', '品'] as const;

function atlasMask(font: FontSet, index: number, fontSize: number): HTMLCanvasElement {
  const atlas = font.atlases[index]!;
  const image = atlas.texture?.image as CanvasImageSource | undefined;
  if (!image) throw new Error('商店字体图集未加载');
  const width = atlas.metrics.atlas.width;
  const height = atlas.metrics.atlas.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('商店字体画布不可用');
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  const ratio = Math.max(0.05, fontSize / atlas.metrics.sdf.fontSize);
  const half = Math.min(127, 127.5 * 0.5 / (atlas.metrics.sdf.spread * ratio));
  const low = 127.5 - half;
  const range = Math.max(1, half * 2);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const t = Math.max(0, Math.min(1, (pixels.data[i]! - low) / range));
    pixels.data[i] = 255;
    pixels.data[i + 1] = 255;
    pixels.data[i + 2] = 255;
    pixels.data[i + 3] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

function drawHuiGlyph(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, color: string): void {
  const x = (ratio: number): number => rect.x + rect.w * ratio;
  const y = (ratio: number): number => rect.y + rect.h * ratio;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.65, Math.min(rect.w, rect.h) * 0.085);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x(0.2), y(0.08)); ctx.lineTo(x(0.8), y(0.08));
  ctx.moveTo(x(0.5), y(0.03)); ctx.lineTo(x(0.5), y(0.26));
  ctx.moveTo(x(0.22), y(0.3)); ctx.lineTo(x(0.78), y(0.3));
  ctx.moveTo(x(0.24), y(0.3)); ctx.lineTo(x(0.24), y(0.64));
  ctx.moveTo(x(0.76), y(0.3)); ctx.lineTo(x(0.76), y(0.64));
  ctx.moveTo(x(0.24), y(0.64)); ctx.lineTo(x(0.76), y(0.64));
  ctx.moveTo(x(0.5), y(0.31)); ctx.lineTo(x(0.5), y(0.63));
  ctx.moveTo(x(0.25), y(0.47)); ctx.lineTo(x(0.75), y(0.47));
  ctx.moveTo(x(0.32), y(0.72)); ctx.lineTo(x(0.24), y(0.82));
  ctx.moveTo(x(0.5), y(0.69)); ctx.lineTo(x(0.42), y(0.84));
  ctx.moveTo(x(0.69), y(0.71)); ctx.lineTo(x(0.78), y(0.82));
  ctx.moveTo(x(0.77), y(0.71)); ctx.lineTo(x(0.72), y(0.88));
  ctx.lineTo(x(0.57), y(0.96)); ctx.lineTo(x(0.4), y(0.92));
  ctx.stroke();
}

function drawPinGlyph(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.65, Math.min(rect.w, rect.h) * 0.085);
  ctx.lineJoin = 'round';
  ctx.strokeRect(rect.x + rect.w * 0.35, rect.y + rect.h * 0.04, rect.w * 0.3, rect.h * 0.32);
  ctx.strokeRect(rect.x + rect.w * 0.06, rect.y + rect.h * 0.55, rect.w * 0.38, rect.h * 0.38);
  ctx.strokeRect(rect.x + rect.w * 0.56, rect.y + rect.h * 0.55, rect.w * 0.38, rect.h * 0.38);
}

export function createShopTextRenderer(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  font: FontSet,
): (scale: number) => void {
  const masks = new Map<string, HTMLCanvasElement>();
  const scratch = document.createElement('canvas');
  let scratchContext = scratch.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  return (scale: number): void => {
    const width = Math.max(1, window.visualViewport?.width ?? window.innerWidth);
    const height = Math.max(1, window.visualViewport?.height ?? window.innerHeight);
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('商店文字画布不可用');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const rootRect = root.getBoundingClientRect();
    const missing = new Set<string>();

    for (const element of Array.from(root.querySelectorAll<HTMLElement>('.shop-sdf-text'))) {
      const text = element.textContent ?? '';
      const rect = element.getBoundingClientRect();
      if (!text || rect.width <= 0 || rect.height <= 0) continue;
      const style = getComputedStyle(element);
      const designFontSize = Number.parseFloat(style.fontSize) || 12;
      const fontSize = designFontSize * scale;
      const lineHeight = Number.parseFloat(style.lineHeight);
      const baselineRatio = font.baseline.lineHeightPx / font.sdf.fontSize;
      const lineHeightMul = Number.isFinite(lineHeight) && designFontSize > 0
        ? lineHeight / (designFontSize * baselineRatio) : 1;
      const align = style.textAlign === 'right' ? 'right' : style.textAlign === 'left' ? 'left' : 'center';
      const layout = layoutText(font, text, {
        fontSizePx: fontSize,
        lineHeightMul,
        align,
        maxWidthPx: Math.max(1, rect.width),
      });
      const missingCharacters = [...text].filter(character => !font.lookup(character.codePointAt(0)!));
      for (const character of missingCharacters) {
        if (!(SHOP_CUSTOM_GLYPHS as readonly string[]).includes(character)) missing.add(character);
      }

      const scratchWidth = Math.max(1, Math.ceil(rect.width * dpr));
      const scratchHeight = Math.max(1, Math.ceil(rect.height * dpr));
      if (scratch.width !== scratchWidth || scratch.height !== scratchHeight) {
        scratch.width = scratchWidth;
        scratch.height = scratchHeight;
        scratchContext = scratch.getContext('2d');
      }
      if (!scratchContext) continue;
      scratchContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      scratchContext.clearRect(0, 0, rect.width, rect.height);
      scratchContext.save();
      scratchContext.beginPath();
      scratchContext.rect(0, 0, rect.width, rect.height);
      scratchContext.clip();
      for (const quad of layout.quads) {
        const atlas = font.atlases[quad.atlasIndex]!;
        const sizeKey = `${quad.atlasIndex}:${Math.round(fontSize * 2) / 2}`;
        let mask = masks.get(sizeKey);
        if (!mask) {
          mask = atlasMask(font, quad.atlasIndex, fontSize);
          masks.set(sizeKey, mask);
        }
        const sourceX = quad.uv.x0 * atlas.metrics.atlas.width;
        const sourceY = quad.uv.y0 * atlas.metrics.atlas.height;
        const sourceW = (quad.uv.x1 - quad.uv.x0) * atlas.metrics.atlas.width;
        const sourceH = (quad.uv.y1 - quad.uv.y0) * atlas.metrics.atlas.height;
        scratchContext.drawImage(mask, sourceX, sourceY, sourceW, sourceH, quad.x, quad.y, quad.w, quad.h);
      }
      scratchContext.restore();
      scratchContext.globalCompositeOperation = 'source-in';
      scratchContext.fillStyle = element.dataset.sdfColor ?? style.color;
      scratchContext.fillRect(0, 0, rect.width, rect.height);
      scratchContext.globalCompositeOperation = 'source-over';
      for (const [index, tofu] of layout.tofus.entries()) {
        const missingCharacter = missingCharacters[index];
        const color = element.dataset.sdfColor ?? style.color;
        if (missingCharacter === '惠') drawHuiGlyph(scratchContext, tofu, color);
        else if (missingCharacter === '品') drawPinGlyph(scratchContext, tofu, color);
      }
      ctx.drawImage(scratch, 0, 0, scratch.width, scratch.height,
        rect.left - rootRect.left, rect.top - rootRect.top, rect.width, rect.height);
    }

    if (missing.size) root.dataset.fontMissing = [...missing].join('');
    else delete root.dataset.fontMissing;
    root.classList.add('shop-font-ready');
  };
}
