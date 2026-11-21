import type { SimEvent } from '@tr/game/core/sim/simTypes.js';
import { buildAlert, buildSafetyAlert, type RunAlert, type RunAlertState } from './runTheme.js';

/** 瞬间反馈只在没有安全预警时占用横幅；urgency 是配色类别，不是数值优先级。 */
export function createRunAlerts() {
  let transient: (RunAlert & { fx: number }) | null = null, remaining = 0, duration = 1;
  return {
    consume(ev: SimEvent) {
      if (ev.type === 'flip') {
        duration = 1.2;
        transient = { text: ev.flip === -1 ? '重力翻转！' : '恢复正常', urgency: 2, fx: 1 };
      } else if (ev.type === 'warp') {
        duration = 1.4;
        transient = { text: ev.phase === 1 ? '时空隧道！' : '穿出隧道', urgency: 4, fx: 1 };
      } else if (ev.type === 'coinRain') {
        duration = 1.2;
        transient = { text: '金币雨即将到来', urgency: 5, fx: 0.6 };
      } else return;
      remaining = duration;
    },
    update(dt: number) { remaining = Math.max(0, remaining - dt); },
    current(s: RunAlertState): RunAlert | null {
      const safety = buildSafetyAlert(s);
      if (safety) return safety; // 安全提示保持自身语义与配色，并抑制会冲淡危险信号的庆祝闪屏
      if (transient && remaining > 0) return { ...transient, fx: transient.fx * remaining / duration };
      return buildAlert(s);
    },
  };
}
