/**
 * 赛道障碍定义解析（trackGen 专用，纯函数）：
 * 把 config/obstacles.json 的原始字段归一化成实体可用的形状，脏数据一律降级为安全值。
 */
import type { NamedEntry } from '../config/configTypes.js';
import type { ObstacleEntity } from './trackGen.js';

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

/**
 * 由配置定义构造障碍实体：尺寸/类别/横摆归一化，并带出行为开关
 * （jumpable=可跳挡板；rideTop=车顶可站立；moveZ=纵向漂移，负值朝玩家冲来；zap=闪电圈触电结算）。
 * 字段缺失/类型不符时按「最保守」处理，绝不产出 NaN 或未知类别。
 */
export function buildObstacleEntity(def: NamedEntry, lane: number, worldZ: number): ObstacleEntity {
  const size = (def.size as number[] | undefined) ?? [2, 1.2, 1.2];
  const e: ObstacleEntity = {
    obsRef: def.id,
    cls: (def.class as ObstacleEntity['cls'] | undefined) ?? 'full',
    w: size[0] ?? 2, h: size[1] ?? 1.2, d: size[2] ?? 1.2,
    lane, worldZ,
    swing: normalizeSwing(def.swing),
  };
  if (def.jumpable === true) e.jumpable = true;
  if (def.rideTop === true) e.rideTop = true;
  if (typeof def.moveZ === 'number' && Number.isFinite(def.moveZ) && def.moveZ !== 0) e.moveZ = def.moveZ;
  if (def.zap === true) e.zap = true;
  return e;
}
