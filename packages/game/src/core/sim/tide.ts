/**
 * 潮汐纯函数单源（M4 sim 基建：docs/scenes/forgeheart-brief.md §3.1 / §13 Phase B-1，场景节拍器）：
 *   周期 P=144m（玩家 12~26 m/s 下 ≈5.5~12.0s 一循环）；相位 u = dist mod 144 四相：
 *   [0,40) 低潮驻留 level 0 → [40,72) 涨潮 smoothstep（6.5m→0.8m）→ [72,108) 高潮驻留
 *   level 1 → [108,144) 落潮 smoothstep 回落（退潮开路，渣滩渐次出露）。
 *   喷发段：k = floor(dist/144) 为**奇数**的高潮驻留段升级为喷发段——窗口
 *   216-252 / 504-540 / 792-828…（每 288m 一次，三幕各摊一次，§8）。
 * 取数口径（§13 Phase B-1 已落位）：本文件是 **sim 层唯一权威实现**——渲染层
 *   （render/forgeheart/tide.ts）re-export 这里；trackGen 出生时潮汐感知放置与 runnerSim
 *   潮位状态都将消费本文件（同为 dist 纯函数 ⇒ 回放安全，golden 基线不受未接线影响）。
 *   喷发特效模块走 LightningFx.update(dt, dist) 直接拿 dist——两处算同一公式。
 * 纯函数：零依赖、零状态、零分配；同 dist 恒同结果（回放安全），禁 Math.random。
 */

/** 潮汐周期（米）：班次表的机械遗产（§1.4）——石碑刻痕/哑阀/炉心心跳/涨落必须同相位 */
const P = 144;
/** 四相边界（u 相位）：低潮驻留止 / 高潮驻留起 / 高潮驻留止 */
const U_LOW = 40, U_HIGH = 72, U_FALL = 108;
/** 喷发段起点在周期内的偏移 = 高潮驻留段起点 */
const S_OFF = 72;

/** smoothstep 0..1（钳制端点） */
const ss = (x: number) => { const c = x < 0 ? 0 : x > 1 ? 1 : x; return c * c * (3 - 2 * c); };

/** 潮位 0..1：0=低潮驻留（岩浆面在堤道缘下 6.5m）、1=高潮驻留（缘下 0.8m，火星溅路缘） */
export function level(dist: number): number {
  const u = dist - Math.floor(dist / P) * P;
  if (u < U_LOW) return 0;                       // 低潮驻留
  if (u < U_HIGH) return ss((u - U_LOW) / 32);   // 涨潮：涨率 5.7m/32m
  if (u < U_FALL) return 1;                      // 高潮驻留
  return 1 - ss((u - U_FALL) / 36);              // 落潮
}

/** 是否处于喷发段：k=floor(dist/144) 为奇数的高潮驻留段升级喷发（窗口 [k·144+72, k·144+108)） */
export function surgeWindow(dist: number): boolean {
  const k = Math.floor(dist / P);
  if (((k % 2) + 2) % 2 !== 1) return false;     // 偶数周期无喷发
  const u = dist - k * P;
  return u >= U_HIGH && u < U_FALL;
}

/** 最近喷发段起点 S：正处喷发段返回本段起点；否则返回下一个即将到来的喷发段起点
 *  （供 1s 红光预警窗 [S − v·1.0, S) 前向取窗，§3.1——预警提前量恒定 1.0s 不随难度变） */
export function surgeStart(dist: number): number {
  const k = Math.floor(dist / P);
  const u = dist - k * P;
  const odd = ((k % 2) + 2) % 2 === 1;
  if (odd && u < U_FALL) return k * P + S_OFF;   // 本周期喷发段（未到或正在其中）
  return (odd ? k + 2 : k + 1) * P + S_OFF;      // 已过则下下个 / 下一个奇数周期
}
