/**
 * 局内 3D 场景的宿主侧资源注入（packages 零 IO 禁令的另一半：apps 取文件，packages 只管用）。
 * 障碍海报是位图，three 需要已解码图像句柄 ⇒ fetch + createImageBitmap，与 uiShell 的
 * 徽标加载同一套路。取不到就少一张（挡板退化成纯色边框），不阻塞进局。
 */
import * as THREE from 'three';
import { POSTER_DIR, POSTER_TABLES, setPosters, type PosterPool } from '@tr/game/render/adPosters.js';
import { PICKUP_TILE_DIR, PICKUP_TILES, setPickupTiles } from '@tr/game/render/pickupTiles.js';

async function loadTexture(url: string): Promise<THREE.Texture> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const bmp = await createImageBitmap(await res.blob());
  const tex = new THREE.Texture(bmp);
  tex.colorSpace = THREE.SRGBColorSpace; // 不标 sRGB 会被当线性色洗白（同 uiShell.loadStill）
  // ImageBitmap 上传不吃 UNPACK_FLIP_Y（行 0 就是图顶），而 three 标准材质的 v=0 在底 ⇒ 海报会
  // 上下颠倒，得手动翻 UV（与 ui/menuBackdrop.ts 的 unflip 同一口径）。
  tex.repeat.y = -1;
  tex.offset.y = 1;
  tex.needsUpdate = true;
  return tex;
}

/** 加载两个海报池（广告墙竖版 + 矮障/横杆/车头方版）并注入渲染层。须在首次进局前 await 完成。 */
export async function injectObstaclePosters(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  await Promise.all((Object.keys(POSTER_TABLES) as PosterPool[]).map(async kind => {
    const table = POSTER_TABLES[kind];
    const loaded = await Promise.all(table.map(async (p): Promise<{ file: string; tex: THREE.Texture } | null> => {
      try {
        return { file: p.file, tex: await loadTexture(`${base}${POSTER_DIR[kind]}/${p.file}`) };
      } catch {
        return null;
      }
    }));
    const ok = loaded.filter((s): s is { file: string; tex: THREE.Texture } => s !== null);
    setPosters(kind, ok);
    console.info(`[tr-web] ${kind} 海报注入 ${ok.length}/${table.length}`);
  }));
}

/** 加载道具箱方砖（含金框兜底砖）并注入渲染层。同样须在首次进局前完成。 */
export async function injectPickupTiles(): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const loaded = await Promise.all(PICKUP_TILES.map(async (t): Promise<{ item: string; tex: THREE.Texture } | null> => {
    try {
      return { item: t.item, tex: await loadTexture(`${base}${PICKUP_TILE_DIR}/${t.file}`) };
    } catch {
      return null;
    }
  }));
  const ok = loaded.filter((s): s is { item: string; tex: THREE.Texture } => s !== null);
  setPickupTiles(ok);
  console.info(`[tr-web] 道具箱方砖注入 ${ok.length}/${PICKUP_TILES.length}`);
}
