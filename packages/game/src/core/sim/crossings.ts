/**
 * 穿越判定层（M4 第五步，雷脊穿环计分 / 泰坦肋拱穿行 / 图书馆书阁共用）：
 * sim 持有 CrossingEntity 列表（trackGen 按 config 出生，与侧景视觉件同 z 对齐），
 * 玩家经过时按「深度窗 + 高度带」判一次穿越 → 推 cross 事件进 drainEvents（计分/连击消费）。
 * 纯逻辑：零 three 依赖、零分配（事件对象按需 push 例外）、同输入恒同输出（回放安全）。
 */

export type CrossingKind = 'ring' | 'rib';

/** 一个穿越体：lane=所在车道（ring 居中可 0）、worldZ=到达距离、yBand=可穿越高度带 [yMin,yMax] */
export interface CrossingEntity {
  kind: CrossingKind;
  lane: number;
  worldZ: number;
  yMin: number;
  yMax: number;
  done?: boolean;
}

/** 穿越判定参数（sim 从 config/game.json runner 段读，缺省=下面 DEFAULTS 的值） */
export interface CrossingParams {
  /** 深度判定半窗（米）：|worldZ - dist| ≤ half 即在本帧深度窗内 */
  halfM: number;
  /** 穿越成功奖励分 */
  scorePer: number;
}

export const CROSSING_DEFAULTS: CrossingParams = { halfM: 1.2, scorePer: 50 };

/**
 * 推进穿越判定：对每个未完成穿越体做一次性判定（深度窗命中 + 玩家高度在带内 ⇒ done + 事件）。
 * 错过（worldZ 落到身后）也置 done 但不计分——「穿环」是走位奖励，不是惩罚项。
 * 返回本次新完成的穿越体数量（sim 据此加分）。events.push 的对象结构即 SimEvent 的 cross 分支。
 */
export function stepCrossings(
  crossings: CrossingEntity[], dist: number, playerY: number, params: CrossingParams,
  events: { type: string; kind?: string; lane?: number; worldZ?: number }[],
): number {
  let hit = 0;
  for (const c of crossings) {
    if (c.done) continue;
    const rel = c.worldZ - dist;
    if (rel < -params.halfM) { c.done = true; continue; } // 已身后：错过，不再判
    if (rel > params.halfM) break; // 列表按 worldZ 升序 ⇒ 后面的还没到，提前收工
    c.done = true;
    if (playerY >= c.yMin && playerY <= c.yMax) {
      hit++;
      events.push({ type: 'cross', kind: c.kind, lane: c.lane, worldZ: c.worldZ });
    }
  }
  return hit;
}

/** 穿越体按 worldZ 升序插入（trackGen 出生时用；列表保持有序 ⇒ stepCrossings 可提前收工） */
export function insertCrossing(list: CrossingEntity[], c: CrossingEntity): void {
  let i = list.length;
  while (i > 0 && list[i - 1]!.worldZ > c.worldZ) i--;
  list.splice(i, 0, c);
}

/** 清理已掠过（done 且落后于回收线）的穿越体。列表按 worldZ 升序 ⇒ 被回收的恒为前缀
 *  （落后线的都已被 stepCrossings 置 done），copyWithin 整体前移保序、零分配——
 *  旧版 swap-pop 会把队尾换到队首打乱升序，stepCrossings 的提前收工（rel>halfM 即 break）
 *  随之把后续穿越体整段误判成错过（ring@250 起从未计过分，泰坦 rib 加密出生后更明显）。 */
export function cullCrossings(list: CrossingEntity[], dist: number, cullBehindM: number): void {
  let i = 0;
  while (i < list.length && list[i]!.done && list[i]!.worldZ < dist - cullBehindM) i++;
  if (i) { list.copyWithin(0, i); list.length -= i; }
}

/** crossings 配置段的一条出生规则（obstacles.json crossings.ring / crossings.rib；nextZ=出生游标，trackGen 持有推进） */
export interface CrossingRule {
  kind: CrossingKind;
  everyM: number;
  fromM: number;
  yMin: number;
  yMax: number;
  nextZ: number;
}

/**
 * 解析 obstacles.json 的 crossings 块（配置键驱动：ring=雷脊金环 / rib=泰坦肋拱；缺键或 everyM≤0=不出该 kind）。
 * trackGen 构造调用一次；未配置 crossings 返回空数组 ⇒ 全主题零变化。
 * rib 的 yMax=4.5 对齐泰坦肋拱「跑过档」净高（ribs.ts 两档 4.5 跑过 / 2.2 滑铲）；
 * 泰坦侧暂不画 rib 视觉（渲染 Phase 后置，金环视觉只在 stormspire/landmarks.ts），先只让 sim 判定/计分生效。
 */
export function parseCrossings(obstacles: unknown): CrossingRule[] {
  const block = (obstacles as { crossings?: Record<string, { everyM?: unknown; fromM?: unknown; yMin?: unknown; yMax?: unknown }> }).crossings;
  const rules: CrossingRule[] = [];
  for (const kind of ['ring', 'rib'] as const) {
    const c = block?.[kind];
    if (!c || typeof c.everyM !== 'number' || c.everyM <= 0) continue; // 未配置/非法 ⇒ 该 kind 不出生
    const fromM = typeof c.fromM === 'number' ? c.fromM : 0;
    rules.push({
      kind, everyM: c.everyM, fromM,
      yMin: typeof c.yMin === 'number' ? c.yMin : 0,
      yMax: typeof c.yMax === 'number' ? c.yMax : 3,
      nextZ: fromM,
    });
  }
  return rules;
}

/** trackGen 出生钩子：按 rule 在 [from, target) 区间按 everyM 均匀插该 kind 穿越体，游标写回 rule.nextZ */
export function spawnKind(list: CrossingEntity[], target: number, rule: CrossingRule): void {
  let z = Math.max(rule.nextZ, rule.fromM);
  while (z < target) {
    insertCrossing(list, { kind: rule.kind, lane: 0, worldZ: z, yMin: rule.yMin, yMax: rule.yMax });
    z += rule.everyM;
  }
  rule.nextZ = Math.max(z, rule.fromM);
}