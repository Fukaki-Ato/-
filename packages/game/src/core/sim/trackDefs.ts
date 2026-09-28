/**
 * 赛道障碍定义解析（trackGen 专用，纯函数）：
 * 把 config/obstacles.json 的原始字段归一化成实体可用的形状，脏数据一律降级为安全值。
 */

/** 摆锤横摆参数（实体字段名）：配置侧 writing 为 amplitudeM，实体统一用 ampM */
export interface SwingSpec { ampM: number; periodS: number }

/** 计入「封路」的障碍类别：必须换道才能通过的 full/vehicle/moving（低障/高杆/电弧可跳可铲，不算封路） */
export const BLOCKING_CLASSES = new Set(['full', 'vehicle', 'moving']);

/**
 * 宽容解析 obstacles.json 的 swing 字段：配置写 amplitudeM、实体用 ampM，两种写法都接受。
 * ampM 非法/缺失，或 periodS 非有限正数时返回 undefined（不做横摆，按车道中心处理，绝不产出 NaN）。
 */
export function normalizeSwing(raw: unknown): SwingSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  const amp = s.ampM ?? s.amplitudeM;
  const period = s.periodS;
  if (typeof amp !== 'number' || !Number.isFinite(amp)) return undefined;
  if (typeof period !== 'number' || !Number.isFinite(period) || period <= 0) return undefined;
  return { ampM: amp, periodS: period };
}