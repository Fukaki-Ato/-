/**
 * 特殊事件三表纯函数模块（Stormspire 2026-11：时空隧道 / 金币雨 / 低重力带）——照 zones.ts 模式：
 * 配置解析（坏值降级 null=表恒空）、游标预注册（同 spawnZones/nextZapZ）、二分查询、
 * 互斥出生与金币铺设（layWarpCoins 金币河 / layRainCoins 金币雨）。
 * 铁律：sim 纯逻辑、零分配（实体 push 例外）、确定性（禁 Math.random，铺币随机性走注入 RunRng，
 * 同 seed 同布局）；未配置对应段 ⇒ 表恒空 ⇒ 查询恒 null / 判定恒 false ⇒ 全主题零变化（硬门，同 zones.ts）。
 */
import { NO_PLANT_M, type Zone } from './zones.js';
import type { RunRng } from '../rng.js';
import type { CoinEntity } from './trackGen.js';

/** 预注册提前量（米）：同 zones.ts SPAWN_LEAD_M——覆盖单窗 pattern 的最大前伸 */
const SPAWN_LEAD_M = 96;
/** 互斥余量（米）：候选段与 zone/warp 段的互斥窗各外扩 24m（叠加 NO_PLANT_M=入口净空再让一步） */
const MUTEX_PAD_M = NO_PLANT_M + 24;
/** 隧道入口净空（米）：段内+前后 12m 禁铺一切 cell（语义同 inNoPlantWindow 的 B-3 入口净空） */
export const WARP_CLEAR_M = 12;
/** 金币雨预告提前量（米）：stepFx 提前 30m 推一次性 coinRain 事件（渲染预告横幅消费） */
export const RAIN_WARN_M = 30;

/** 时空隧道段：[startM, endM) 无障碍金币河奖励段 */
export interface WarpSeg { startM: number; endM: number }
/** 金币雨窗口参数（obstacles.json coinRain 段的 spanM/count/ampY） */
export interface CoinRainCfg { spanM: number; count: number; ampY: number }
/** 金币雨窗口：[startM, endM) 内按 cfg 铺浮空金币列 */
export interface RainWin { startM: number; endM: number; cfg: CoinRainCfg }
/** 低重力带：[startM, endM) 内重力×gMul（gMul∈(0,1)，起跳速度不变 ⇒ 跳得更高落地更慢） */
export interface LowGravSeg { startM: number; endM: number; gMul: number }

/** obstacles.json 顶层 warp 块（长度/间隔/起点，米） */
export interface WarpCfg { lengthM: number; everyM: number; fromM: number }
/** obstacles.json 顶层 coinRain 块 */
export interface RainCfg extends CoinRainCfg { everyM: number; fromM: number }
/** obstacles.json 顶层 lowGrav 块 */
export interface LowGravCfg { lengthM: number; everyM: number; fromM: number; gMul: number }

const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const blk = (ob: unknown, key: string) => (ob as Record<string, unknown> | null)?.[key] as Record<string, unknown> | undefined;

/** 解析 obstacles.json 顶层 warp 块：任一字段缺失/非法（非有限正数）一律 null（=warps 恒空，全主题零变化） */
export function parseWarpCfg(ob: unknown): WarpCfg | null {
  const a = blk(ob, 'warp');
  if (!a || !ok(a.lengthM) || !ok(a.everyM) || !ok(a.fromM)) return null;
  return { lengthM: a.lengthM as number, everyM: a.everyM as number, fromM: a.fromM as number };
}

/** 解析顶层 coinRain 块：同上数值地板；count 取整 ≥1（0 枚=空窗无意义） */
export function parseRainCfg(ob: unknown): RainCfg | null {
  const a = blk(ob, 'coinRain');
  if (!a || !ok(a.spanM) || !ok(a.everyM) || !ok(a.fromM) || !ok(a.count) || !ok(a.ampY)) return null;
  return { spanM: a.spanM as number, everyM: a.everyM as number, fromM: a.fromM as number, count: Math.floor(a.count as number), ampY: a.ampY as number };
}

/** 解析顶层 lowGrav 块：gMul 额外要求 ∈(0,1)——≥1 不是「低」重力，直接判非法降级 */
export function parseLowGravCfg(ob: unknown): LowGravCfg | null {
  const a = blk(ob, 'lowGrav');
  if (!a || !ok(a.lengthM) || !ok(a.everyM) || !ok(a.fromM) || !ok(a.gMul) || (a.gMul as number) >= 1) return null;
  return { lengthM: a.lengthM as number, everyM: a.everyM as number, fromM: a.fromM as number, gMul: a.gMul as number };
}

/** 候选 [zs,ze) 是否与 list 任一段的外扩窗 [start−pad, end+pad] 相交（list 按 startM 升序、互不重叠 ⇒ 可提前收工） */
function hitsAny(list: { startM: number; endM: number }[], zs: number, ze: number, pad: number): boolean {
  for (let i = 0; i < list.length; i++) {
    const s = list[i]!;
    if (s.startM - pad >= ze) return false; // 后续段起点更靠右 ⇒ 全部不相交
    if (s.endM + pad > zs) return true;
  }
  return false;
}

/** spawnWarps 游标预注册（先于 pattern 生成调用）：候选段若与任一 zone 的
 *  [start−NO_PLANT_M−24, end+NO_PLANT_M+24] 相交则跳过（z += everyM 继续）——
 *  互斥硬规则：隧道永不与反重力区重叠（金币河替代区内改写，两套语义不打架）。返回推进后的游标。 */
export function spawnWarps(warps: WarpSeg[], nextZ: number, target: number, cfg: WarpCfg | null, zones: Zone[]): number {
  if (!cfg) return nextZ; // 未配置=游标不动=表恒空（硬门）
  let z = Math.max(nextZ, cfg.fromM);
  while (z <= target + SPAWN_LEAD_M) {
    if (!hitsAny(zones, z, z + cfg.lengthM, MUTEX_PAD_M)) warps.push({ startM: z, endM: z + cfg.lengthM });
    z += cfg.everyM;
  }
  return z;
}

/** spawnRains：同理游标预注册（纯加币，压障碍也算跳跃奖励）；候选窗若落进反重力区体（±NO_PLANT_M
 *  净空）则跳过——区内玩家在天花板跑，地面雨币不可达（2026-11-14 实测 [600,640)∩[600,690) 发现）。 */
export function spawnRains(wins: RainWin[], nextZ: number, target: number, cfg: RainCfg | null, zones: Zone[]): number {
  if (!cfg) return nextZ;
  let z = Math.max(nextZ, cfg.fromM);
  while (z <= target + SPAWN_LEAD_M) {
    if (!hitsAny(zones, z, z + cfg.spanM, NO_PLANT_M)) wins.push({ startM: z, endM: z + cfg.spanM, cfg });
    z += cfg.everyM;
  }
  return z;
}

/** spawnLowGravs：候选与 zones 或 warps 相交（同上余量）则跳过——低重力带不与倒挂/隧道叠加（两套竖直语义互斥） */
export function spawnLowGravs(lows: LowGravSeg[], nextZ: number, target: number, cfg: LowGravCfg | null,
  zones: Zone[], warps: WarpSeg[]): number {
  if (!cfg) return nextZ;
  let z = Math.max(nextZ, cfg.fromM);
  while (z <= target + SPAWN_LEAD_M) {
    const blocked = hitsAny(zones, z, z + cfg.lengthM, MUTEX_PAD_M) || hitsAny(warps, z, z + cfg.lengthM, MUTEX_PAD_M);
    if (!blocked) lows.push({ startM: z, endM: z + cfg.lengthM, gMul: cfg.gMul });
    z += cfg.everyM;
  }
  return z;
}

/** warpAt：warps 按 startM 升序且互不重叠 ⇒ 二分查找（每步一次、零分配；未命中 null） */
export function warpAt(list: WarpSeg[], z: number): WarpSeg | null {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, w = list[mid]!;
    if (z < w.startM) hi = mid - 1; else if (z >= w.endM) lo = mid + 1; else return w;
  }
  return null;
}

/** lowGravAt：同 warpAt 口径二分（命中段携带 gMul 供 stepFx 写 fxCtx.lowGravMulNow） */
export function lowGravAt(list: LowGravSeg[], z: number): LowGravSeg | null {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, g = list[mid]!;
    if (z < g.startM) hi = mid - 1; else if (z >= g.endM) lo = mid + 1; else return g;
  }
  return null;
}

/** inWarpClear：warp 段内+前后 12m 净空判定（隧道入口净空，语义同 inNoPlantWindow）。
 *  按 endM+净空二分定位后顺序扫命中段（相邻段净空可能重叠），trackGen 落 cell/出生 cross/zap 时调用。 */
export function inWarpClear(list: WarpSeg[], z: number): boolean {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.endM + WARP_CLEAR_M < z) lo = mid + 1; else hi = mid;
  }
  for (let i = lo; i < list.length && list[i]!.startM - WARP_CLEAR_M <= z; i++) {
    if (z >= list[i]!.startM - WARP_CLEAR_M && z <= list[i]!.endM + WARP_CLEAR_M) return true;
  }
  return false;
}

/** inRainWin：窗口内判定（[startM, endM) 半开区间，同 zoneAt 拼接口径） */
export function inRainWin(list: RainWin[], z: number): boolean {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, w = list[mid]!;
    if (z < w.startM) hi = mid - 1; else if (z >= w.endM) lo = mid + 1; else return true;
  }
  return false;
}

/** 金币河铺设（warp 预注册后 trackGen 对每个新段一行调用）：沿段每 coinSpacing(1.5m) 一枚，
 *  x=sin(段内里程×0.35)×laneWidth（正弦蛇形换道引导；收集判定按 x=lane×laneWidth 计，
 *  故把 sin 值写进 lane 字段即得该 x——laneWidth 参数仅为表意保留）。y=0.55 贴地跑吃。
 *  段内无障碍（互斥+禁铺保证）⇒ 不需要 chain 号与避障（purge 扫描区间也不含本次铺设）。 */
export function layWarpCoins(coins: CoinEntity[], seg: WarpSeg, _laneWidth: number, coinSpacing: number): void {
  for (let z = seg.startM; z < seg.endM; z += coinSpacing) {
    coins.push({ lane: Math.sin((z - seg.startM) * 0.35), worldZ: z, y: 0.55 });
  }
}

/** 金币雨铺设（rains 预注册后 trackGen 对每个新窗口一行调用）：count 枚沿 spanM 均布（rng 槽内抖动，
 *  同 seed 同布局），y=0.5+ampY×sin(i×0.9)（部分离地要跳吃），lane=蛇形 sin(i×0.5)（同上写 lane 字段）。 */
export function layRainCoins(coins: CoinEntity[], win: RainWin, _laneWidth: number, rng: RunRng): void {
  const step = win.cfg.spanM / win.cfg.count;
  for (let i = 0; i < win.cfg.count; i++) {
    const z = win.startM + (i + rng.next()) * step;
    coins.push({ lane: Math.sin(i * 0.5), worldZ: z, y: 0.5 + win.cfg.ampY * Math.sin(i * 0.9) });
  }
}
