/**
 * 道具箱（pickups）正面徽标贴图（用户 2026-10-07：道具箱不再旋转、贴大厅同风格道具徽标）。
 *
 * 与障碍海报同一套注入约定：表在 packages 侧，取文件在 apps 侧（本包零 IO）。
 * 砖图由 tools/gen_pickup_tiles.py 从金框徽标网格生成：不透明方砖 = 淡色底 + 居中徽标，
 * 底色取自该枚徽标自己的艳色（剔掉人人都有的金框色相）再大幅并白，整块砖只剩徽标是高饱和的。
 * bg 同时用作自发光色与无贴图时（微信端未注入）的纯色箱底色，两种情况下颜色口径一致。
 */
import * as THREE from 'three';

/** 贴图目录（仓库相对路径；不进微信分包——build-wx 只收 assets/fonts、assets/ui/*.png、assets/audio） */
export const PICKUP_TILE_DIR = 'assets/pickups/tiles';

export interface PickupTileDef {
  /** items.json 里的道具 id */
  item: string;
  /** PICKUP_TILE_DIR 下的文件名 */
  file: string;
  /** 方砖底色（与徽标主色同系），同时是发光色与无贴图时的纯色 */
  bg: number;
}

export const PICKUP_TILES: readonly PickupTileDef[] = [
  { item: 'item_magnet', file: 'item_magnet.jpg', bg: 0xc8bbc0 },
  { item: 'item_shield', file: 'item_shield.jpg', bg: 0xb6e8e5 },
  { item: 'item_jetpack', file: 'item_jetpack.jpg', bg: 0xc9c5c1 },
  { item: 'item_board', file: 'item_board.jpg', bg: 0xc7bbd6 },
  { item: 'item_multiplier', file: 'item_multiplier.jpg', bg: 0xd0b4a6 },
  { item: 'item_boots', file: 'item_boots.jpg', bg: 0xb5c3b5 },
  { item: 'item_helmet', file: 'item_helmet.jpg', bg: 0xceaeaa },
  { item: 'item_default', file: 'item_default.jpg', bg: 0xc4b4ab },
];

interface TileSlot {
  tex: THREE.Texture;
  bg: number;
}

let tiles = new Map<string, TileSlot>();

/** 宿主注入：按 id 配对，缺哪枚就少哪枚（该道具退回纯色箱） */
export function setPickupTiles(loaded: readonly { item: string; tex: THREE.Texture }[]): void {
  const next = new Map<string, TileSlot>();
  for (const def of PICKUP_TILES) {
    const hit = loaded.find(l => l.item === def.item);
    if (hit) next.set(def.item, { tex: hit.tex, bg: def.bg });
  }
  tiles = next;
}

/** 取该道具的方砖；未登记 id（新道具还没出图）走 item_default 兜底，池子为空时返回 null */
export function pickupTileFor(itemRef: string): TileSlot | null {
  return tiles.get(itemRef) ?? tiles.get('item_default') ?? null;
}
