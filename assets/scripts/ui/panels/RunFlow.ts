import type { GameplayResult, IGameContext, RunConfig } from '../../core/contracts';
import { calculateSettlement } from '../../core/gameplay/Settlement';
import { Logger } from '../../core/framework/Logger';
import { PanelManager } from '../framework/PanelManager';
import { PANEL_NAMES } from './panelNames';
import type { RunSettlementData } from './RunSettlementPanel';

const log = new Logger();

/**
 * run.finished 之后的统一结算入口（docs/06 §4）：
 * 计算 Settlement → 打开 RunSettlementPanel。
 * 面板尚未注册时（合并波次前）兜底直接发放基础奖励，避免跑一局无收益。
 */
export async function openSettlementPanel(ctx: IGameContext, result: GameplayResult, onPlayAgain?: () => void): Promise<boolean> {
  const settlement = calculateSettlement(result, resolveRunConfig(ctx, result));
  const data: RunSettlementData = { settlement, onPlayAgain };
  const opened = await PanelManager.open(PANEL_NAMES.runSettlement, data);
  if (opened) return true;

  log.warn('结算面板未注册（等待主会话合并登记），本次直接发放基础奖励');
  ctx.reward.grant(settlement.base, 'settlement');
  ctx.events.emit('run.settled', { result, reward: settlement.base, doubled: false });
  ctx.flush();
  ctx.redDot.refresh();
  return false;
}

/** 结算配置解析：未知模式回退到首个模式（配置只应有 classic，异常不吞奖励）。 */
function resolveRunConfig(ctx: IGameContext, result: GameplayResult): RunConfig {
  try {
    return ctx.config.run(result.mode);
  } catch (err) {
    log.warn(`未找到模式 ${result.mode} 的结算配置，回退到首个模式`, err);
    const all = ctx.config.allRuns();
    if (all.length === 0) throw err;
    return all[0];
  }
}
