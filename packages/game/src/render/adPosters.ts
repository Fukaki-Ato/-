/**
 * 障碍正面海报贴图（用户 2026-10-07：挡板减薄 + 正面换二次元海报）。
 *
 * 两个池子：
 * - adwall：满格广告墙（obs_adwall，2.0×3.0m 竖版）用的 9:16 竖构图；
 * - small：矮障 / 下蹲横杆 / 载具正面（obs_box·obs_barrier_low·obs_cube_roll·obs_gate_low·
 *   obs_rusher_long·obs_train_*）用的方构图——这些面都只有 0.6~2.4m 高，竖图贴上去会缩成一条。
 *
 * 贴图字节由宿主（apps/*）读取后注入，本包零 IO（CONTRIBUTING 禁令）；与 badges 同一套路：
 * 表在 packages 侧，取文件在 apps 侧。file/frame 由 tools/gen_ad_posters.py 产出，
 * frame = 该海报四周一圈均色压暗后的边框色，让挡板外壳与海报同色系。
 * 注入为空（微信端尚无资源加载链）时 entityLayers 回落到纯色挡板，不报错、不阻塞进局。
 */
import type * as THREE from 'three';

export type PosterPool = 'adwall' | 'small';

/** 各池的贴图目录（仓库相对路径；web 端 /assets/** 由 apps/web/vite.config.ts 的中间件下发） */
export const POSTER_DIR: Record<PosterPool, string> = {
  adwall: 'assets/obstacles/posters',
  small: 'assets/obstacles/posters-small',
};

export interface AdPosterDef {
  /** 池目录下的文件名 */
  file: string;
  /** 挡板边框色（与海报底色同系，源图边缘均色 ×0.42） */
  frame: number;
}

/** 广告墙池：一堵墙一张，顺序稳定（宿主按本表匹配注入结果） */
export const AD_POSTERS: readonly AdPosterDef[] = [
  { file: 'poster_01.jpg', frame: 0x4e5b64 },
  { file: 'poster_02.jpg', frame: 0x555663 },
  { file: 'poster_03.jpg', frame: 0x432b1d },
  { file: 'poster_04.jpg', frame: 0x393559 },
  { file: 'poster_05.jpg', frame: 0x3b4352 },
  { file: 'poster_06.jpg', frame: 0x415058 },
  { file: 'poster_07.jpg', frame: 0x1e150f },
  { file: 'poster_08.jpg', frame: 0x555556 },
  { file: 'poster_09.jpg', frame: 0x63452f },
  { file: 'poster_10.jpg', frame: 0x59544d },
  { file: 'poster_11.jpg', frame: 0x4d4f5d },
  { file: 'poster_12.jpg', frame: 0x211812 },
];

/** 小障碍池：6 张方动漫图 + 4 张奶蛙/牛（抖音导出，底部居中水印已补绘去掉）。
 *  全部 384×384 正方形——矮障板面按正方形做，海报才能一格不裁地贴满。 */
export const SMALL_POSTERS: readonly AdPosterDef[] = [
  { file: 'small_01.jpg', frame: 0x242328 },
  { file: 'small_02.jpg', frame: 0x5a5a64 },
  { file: 'small_03.jpg', frame: 0x625d56 },
  { file: 'small_04.jpg', frame: 0x565d63 },
  { file: 'small_05.jpg', frame: 0x51525e },
  { file: 'small_06.jpg', frame: 0x482f20 },
  { file: 'small_07.jpg', frame: 0x151a1d },
  { file: 'small_08.jpg', frame: 0x0a0d11 },
  { file: 'small_09.jpg', frame: 0x2d321a },
  { file: 'small_10.jpg', frame: 0x181a1a },
];

export const POSTER_TABLES: Record<PosterPool, readonly AdPosterDef[]> = {
  adwall: AD_POSTERS,
  small: SMALL_POSTERS,
};

export interface AdPosterSlot {
  tex: THREE.Texture;
  frame: number;
}

const pools: Record<PosterPool, readonly AdPosterSlot[]> = { adwall: [], small: [] };

/** 宿主注入：只认表内文件，缺张直接跳过（不留空槽，也不会因加载失败错位） */
export function setPosters(pool: PosterPool, loaded: readonly { file: string; tex: THREE.Texture }[]): void {
  pools[pool] = POSTER_TABLES[pool].flatMap(p => {
    const hit = loaded.find(l => l.file === p.file);
    return hit ? [{ tex: hit.tex, frame: p.frame }] : [];
  });
}

export function getPosters(pool: PosterPool): readonly AdPosterSlot[] {
  return pools[pool];
}

/** 用方图池的障碍类：矮障（low）、下蹲横杆（high）、载具车头（vehicle）。
 *  斜坡是坡面、电弧贴地、摆锤会横摆，都不该贴海报。 */
const SMALL_CLASSES: ReadonlySet<string> = new Set(['low', 'high', 'vehicle']);

/** 这个障碍正面挂哪张海报；不挂的类或池子为空时返回 null（挡板退回纯色） */
export function posterFor(cls: string, worldZ: number, lane: number): AdPosterSlot | null {
  const pool = cls === 'full' ? pools.adwall : SMALL_CLASSES.has(cls) ? pools.small : null;
  if (!pool || pool.length === 0) return null;
  return pool[posterSlotAt(worldZ, lane, pool.length)];
}

/** 挑选器能识别的最小实体形状（ObstacleEntity 的子集，避免 core 反向依赖） */
export interface PosterCarrier {
  cls: string;
  worldZ: number;
  lane: number;
}

/**
 * 海报挑选器：一个障碍从入场到离场固定一张图。
 *
 * 必须缓存——obs_cube_roll / obs_rusher_long 的 worldZ 每帧被 moveZ 推进（runnerSim §纵向漂移），
 * 直接按 worldZ 取模会让海报一边飞一边换图（用户反馈「乱闪」）。WeakMap 以实体对象为键，
 * 障碍被回收即自动释放，不需要手动清理。
 */
export function createPosterPicker(): (o: object & PosterCarrier) => AdPosterSlot | null {
  const taken = new WeakMap<object, AdPosterSlot>();
  return (o) => {
    const hit = taken.get(o);
    if (hit) return hit;
    const slot = posterFor(o.cls, o.worldZ, o.lane);
    if (slot) taken.set(o, slot); // 池子还没注入时返回 null 但不落缓存，注入后下一帧补上
    return slot;
  };
}

/**
 * 海报在挡板正面的铺法：等比缩放到「吃满可见盒体的一边、另一边不越界」，余量留给边框。
 * 海报比例与挡板比例不同，裁切会切掉人物或场景，所以只留边框不裁图。
 * @returns 贴图面片的宽高（米）；贴图尺寸非法时铺满挡板（退化成旧版纯色块的尺寸）
 */
export function posterSize(boardW: number, boardH: number, texW: number, texH: number): { w: number; h: number } {
  if (!(texW > 0 && texH > 0)) return { w: boardW, h: boardH };
  const w = Math.min(boardW, boardH * (texW / texH));
  return { w, h: w * (texH / texW) };
}

/**
 * 这堵墙用池里第几张：世界 z 与车道混合取模。
 * 车道必须参与——同一 pattern 里并排的两堵墙 worldZ 完全相同（pat_mid_wall_dodge 就是两堵同
 * offsetM），只按 z 取会两张一模一样，看着像贴图没轮换。脏数据（NaN）退池首。
 */
export function posterSlotAt(worldZ: number, lane: number, pool: number): number {
  if (!(pool > 0)) return 0;
  const z = Number.isFinite(worldZ) ? Math.round(worldZ) : 0;
  const l = Number.isFinite(lane) ? Math.round(lane) : 0;
  return Math.abs(z + l * 7) % pool;
}
