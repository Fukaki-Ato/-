/**
 * 反重力区纯函数模块（失重图书馆 Phase B，brief §11.2 B-1）——从 trackGen 抽出守其 300 行上限。
 * 职责：antigrav 配置解析、zoneAt 二分查询、spawnZones 游标预注册（同 nextZapZ 模式）、
 * 禁铺窗与区内类别过滤判定。铁律：sim 纯逻辑、零分配——flip 从 (seed, distance) 可复现，
 * 渲染层只读不反写（worldBend 同款红线）；未配置 antigrav 段 ⇒ zones 恒空 ⇒
 * flip 恒 1、ceilH 恒 0，全部既有主题行为逐字节不变（硬门）。
 */

/** 禁铺窗宽度（米）：zone 入口前与出口后各 12m 不铺任何 cell——B-3 入口净空与 B-8 出口落地段净空的实现出处 */
export const NO_PLANT_M = 12;
/** 预注册提前量（米）：zone 起点在生成前沿 target+LEAD 前登记，LEAD 覆盖单窗 pattern 的最大前伸（3 段×24m+余量） */
const SPAWN_LEAD_M = 96;

/** 一个反重力区：[startM, endM) 内重力翻转（flip=-1 跑天花板），天花板平面高 ceilH */
export interface Zone { startM: number; endM: number; ceilH: number }

/** obstacles.json antigrav 段（B-8 数值地板：lengthM 60~120 / everyM 400~600 / fromM 600 / ceilingH 4.6） */
export interface ZoneCfg { lengthM: number; everyM: number; fromM: number; ceilingH: number }

/** 区内禁放类别（B-1 v1：区内只放 low/high/full/hazard，天然规避倒挂列车/摆锤/斜坡的体验验收成本） */
const ZONE_SKIP_CLASSES = new Set(['vehicle', 'moving', 'step']);

/** 解析 obstacles.json 的 antigrav 段：任一字段缺失/非法（非有限正数）一律返回 null（=zones 恒空，全主题零变化） */
export function parseZoneCfg(ob: unknown): ZoneCfg | null {
  const a = (ob as { antigrav?: Record<string, unknown> } | null)?.antigrav;
  const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!a || !ok(a.lengthM) || !ok(a.everyM) || !ok(a.fromM) || !ok(a.ceilingH)) return null;
  return { lengthM: a.lengthM as number, everyM: a.everyM as number, fromM: a.fromM as number, ceilingH: a.ceilingH as number };
}

/** zoneAt：zones 按 startM 升序且互不重叠 ⇒ 二分查找（每步一次、零分配；未命中返回 null=正常重力） */
export function zoneAt(zones: Zone[], z: number): Zone | null {
  let lo = 0, hi = zones.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, zn = zones[mid]!;
    if (z < zn.startM) hi = mid - 1; else if (z >= zn.endM) lo = mid + 1; else return zn;
  }
  return null;
}

/** 禁铺窗判定：入口前 [start−12, start) 与出口后 [end, end+12]（区体为 [start, end) 半开区间，无缝拼接） */
export function inNoPlantWindow(zn: Zone, z: number): boolean {
  return (z >= zn.startM - NO_PLANT_M && z < zn.startM) || (z >= zn.endM && z <= zn.endM + NO_PLANT_M);
}

/** ensure 落 cell 的统一过滤（B-1 预注册法配套）：禁铺窗内任何 cell 都跳过；区体内只拦
 *  vehicle/moving/step 障碍格（金币格保留，铺设后由 trackGen 统一改写到天花板带）。 */
export function skipCell(zones: Zone[], z: number, cls: string): boolean {
  const zn = zoneAt(zones, z);
  if (!zn) return false;
  if (inNoPlantWindow(zn, z)) return true;
  return cls !== '' && ZONE_SKIP_CLASSES.has(cls);
}

/** spawnZones 游标预注册：把起点 ≤ target+SPAWN_LEAD_M 的区按 everyM 逐个登记进 zones（必须先于
 *  pattern 生成调用 ⇒ 落 cell 时禁铺窗/类别过滤可见），返回推进后的游标（调用方持有，同 nextZapZ）。 */
export function spawnZones(zones: Zone[], nextZ: number, target: number, cfg: ZoneCfg | null): number {
  if (!cfg) return nextZ;
  let z = Math.max(nextZ, cfg.fromM);
  while (z <= target + SPAWN_LEAD_M) {
    zones.push({ startM: z, endM: z + cfg.lengthM, ceilH: cfg.ceilingH });
    z += cfg.everyM;
  }
  return z;
}
