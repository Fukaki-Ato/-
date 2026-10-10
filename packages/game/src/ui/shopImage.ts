import * as THREE from 'three';
import type { LayoutBox, LayoutNode } from '@tr/framework/ui/types.js';
import { applyClip, type PaintCtx } from '@tr/framework/ui/paint.js';
import { createUiBasicMaterial } from '@tr/framework/ui/render/uiBasic.js';
import { Widget } from '@tr/framework/ui/widget.js';

export interface ShopTexture {
  texture: THREE.Texture;
  width: number;
  height: number;
  release?(): void;
}

export interface ShopImageAssets {
  sheet: ShopTexture;
  coin: ShopTexture;
  gem: ShopTexture;
}

export type ShopArtwork = 'magnet' | 'boots' | 'shield' | 'coinBag' | 'compass' | 'chest' | 'coinIcon' | 'gemIcon';

export interface PixelCrop { x: number; y: number; w: number; h: number }

export const SHOP_SPRITE_CROPS: Record<Exclude<ShopArtwork, 'coinIcon' | 'gemIcon'>, PixelCrop> = {
  magnet: { x: 96, y: 494, w: 198, h: 224 },
  boots: { x: 515, y: 489, w: 204, h: 229 },
  shield: { x: 98, y: 800, w: 198, h: 224 },
  coinBag: { x: 513, y: 800, w: 203, h: 232 },
  compass: { x: 98, y: 1078, w: 198, h: 232 },
  chest: { x: 510, y: 1080, w: 205, h: 254 },
};

export function cropUvCoordinates(crop: PixelCrop, width: number, height: number): number[] {
  if (width <= 0 || height <= 0 || crop.x < 0 || crop.y < 0 || crop.w <= 0 || crop.h <= 0
    || crop.x + crop.w > width || crop.y + crop.h > height) {
    throw new RangeError('商店图集裁切区域超出源图');
  }
  const x0 = crop.x / width;
  const y0 = crop.y / height;
  const x1 = (crop.x + crop.w) / width;
  const y1 = (crop.y + crop.h) / height;
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

function sourceFor(assets: ShopImageAssets, artwork: ShopArtwork): { source: ShopTexture; crop: PixelCrop } {
  if (artwork === 'coinIcon') return { source: assets.coin, crop: { x: 0, y: 0, w: assets.coin.width, h: assets.coin.height } };
  if (artwork === 'gemIcon') return { source: assets.gem, crop: { x: 0, y: 0, w: assets.gem.width, h: assets.gem.height } };
  return { source: assets.sheet, crop: SHOP_SPRITE_CROPS[artwork] };
}

/** Shop-only image leaf: one atlas rectangle rendered through the existing UI shader/clip path. */
export class ShopImage extends Widget {
  private mesh: THREE.Mesh | null = null;
  private readonly source: ShopTexture;
  private readonly crop: PixelCrop;
  private readonly uv: number[];
  private readonly targetHeight: number;

  constructor(assets: ShopImageAssets, readonly artwork: ShopArtwork, height: number) {
    super();
    const resolved = sourceFor(assets, artwork);
    this.source = resolved.source;
    this.crop = resolved.crop;
    this.uv = cropUvCoordinates(this.crop, this.source.width, this.source.height);
    this.targetHeight = Math.max(1, height);
  }

  protected override get kind(): string { return 'shopImage'; }

  protected override onBind(): void {
    const env = this.requireEnv();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.mesh = new THREE.Mesh(geometry, createUiBasicMaterial({ map: this.source.texture }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = this.visible;
    env.stage.add(this.mesh);
  }

  node(): LayoutNode {
    return {
      id: this.id,
      content: { w: this.targetHeight * this.crop.w / this.crop.h, h: this.targetHeight },
    };
  }

  sync(box: LayoutBox, ctx: PaintCtx): void {
    if (!this.mesh) return;
    const { x, y, w, h } = box.contentRect;
    const positions = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.array.set([x, -y, 0, x + w, -y, 0, x + w, -(y + h), 0, x, -(y + h), 0]);
    positions.needsUpdate = true;
    this.mesh.renderOrder = ctx.order();
    applyClip(this.mesh.material as THREE.ShaderMaterial, ctx);
  }

  protected override onVisible(visible: boolean): void {
    if (this.mesh) this.mesh.visible = visible;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.requireEnv().stage.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = null;
  }
}
