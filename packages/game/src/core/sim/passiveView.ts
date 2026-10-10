/**
 * 被动天赋的亮灯判定（HUD 技能图标的数据源，从 runnerSim 拆出守 300 行上限）。
 *
 * 口径：逐条看被动原语在 fx 里的派生位，而不是按角色硬编码——
 *   常驻被动（coinValueAdd/buffDurationAdd/buffDurationFlat/slideExtend/
 *   shieldAdd/duckPass）开局即为真；
 *   周期被动（periodic）看 fx.periodicLive（子效果此刻生效中，如阿牛冲撞期）；
 *   叠层被动（jumpCharge）看 fx.jumpCharges > 0（奶蛙弹跳充能）。
 * 于是「换角色 / 改配置」不需要改这里，加新被动只需在 passiveLit 补一条分支。
 */
import type { FxState } from '../effects/buffEngine.js';

/** HUD 被动图标的派生视图 */
export interface PassiveView { active: boolean; charges: number }

/** 单个被动原语此刻是否生效（未知原语返回 false：不亮假图标） */
export function passiveLit(primitive: string, fx: FxState): boolean {
  switch (primitive) {
    case 'coinValueAdd': return fx.coinPct > 0;
    case 'buffDurationAdd': return fx.buffPct > 0;
    case 'buffDurationFlat': return fx.buffAddS > 0;
    case 'slideExtend': return fx.slideAddS > 0;
    case 'shieldAdd': return fx.shieldLayers > 0;
    case 'duckPass': return fx.duckPass;
    case 'jumpCharge': return fx.jumpCharges > 0;
    default: return false;
  }
}

/**
 * 汇总一名角色当前装备的被动：任一条生效即 active（图标亮）。
 * charges 单独给叠层数（jumpCharge 层数），无层数语义的角色恒为 0。
 */
export function passiveView(primitives: readonly string[], fx: FxState): PassiveView {
  let active = false;
  for (const p of primitives) {
    if (p === 'periodic') { if (fx.periodicLive) active = true; continue; }
    if (passiveLit(p, fx)) active = true;
  }
  return { active, charges: fx.jumpCharges };
}
