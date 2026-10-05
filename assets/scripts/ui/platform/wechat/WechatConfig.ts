import type { AdPlacement } from '../../../core/contracts';

/**
 * `assets/resources/config/app.json` 中微信平台专属字段的读取与清洗。
 * 这些字段不进入 `AppConfig` 公共契约（避免修改 contracts.ts 签名），
 * 由启动装配（GameRoot）在创建平台适配器前读取原始 JSON 使用。
 */

/** 广告触发场景全量清单（与 contracts.AdPlacement 保持一致）。 */
export const AD_PLACEMENTS: AdPlacement[] = [
  'settlement.double',
  'shop.free.gold',
  'welfare.daily',
  'run.revive',
];

export const WECHAT_DEFAULT_SHARE_TITLE = '雷霆酷跑，一起来跑！';

export interface WechatPayConfig {
  /** 米大师 offerId；空串表示未配置（支付返回 unsupported）。 */
  offerId: string;
  /** 'goods' 道具直购（默认）/ 'game' 虚拟币。 */
  mode: 'game' | 'goods';
  /** 0 正式环境 / 1 沙箱环境。 */
  env: number;
  currencyType: string;
  zoneId: string;
  buyQuantity: number;
}

export interface WechatShareConfig {
  title?: string;
  imageUrl?: string;
  query?: Record<string, string>;
}

export interface WechatAppExtras {
  cloudEnvId: string;
  adUnits: Partial<Record<AdPlacement, string>>;
  pay: WechatPayConfig;
  share: WechatShareConfig;
  /** debug 为 true 时强制走 Local 平台（开发期联调用）。 */
  forceLocal: boolean;
}

export const DEFAULT_PAY_CONFIG: WechatPayConfig = {
  offerId: '',
  mode: 'goods',
  env: 0,
  currencyType: 'CNY',
  zoneId: '1',
  buyQuantity: 1,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 容错读取 app.json 扩展字段：缺失/类型不符时回退默认值，不抛错。 */
export function readWechatExtras(raw: unknown): WechatAppExtras {
  const app = isRecord(raw) ? raw : {};

  const adUnits: Partial<Record<AdPlacement, string>> = {};
  const rawUnits = isRecord(app.adUnits) ? app.adUnits : {};
  for (const placement of AD_PLACEMENTS) {
    const unitId = trimmed(rawUnits[placement]);
    if (unitId) adUnits[placement] = unitId;
  }

  const rawPay = isRecord(app.pay) ? app.pay : {};
  const pay: WechatPayConfig = {
    offerId: trimmed(rawPay.offerId),
    mode: rawPay.mode === 'game' ? 'game' : 'goods',
    env: finiteNumber(rawPay.env, DEFAULT_PAY_CONFIG.env),
    currencyType: trimmed(rawPay.currencyType) || DEFAULT_PAY_CONFIG.currencyType,
    zoneId: trimmed(rawPay.zoneId) || DEFAULT_PAY_CONFIG.zoneId,
    buyQuantity: Math.max(1, Math.floor(finiteNumber(rawPay.buyQuantity, DEFAULT_PAY_CONFIG.buyQuantity))),
  };

  const rawShare = isRecord(app.share) ? app.share : {};
  const query: Record<string, string> = {};
  if (isRecord(rawShare.query)) {
    for (const [key, value] of Object.entries(rawShare.query)) {
      if (key && typeof value === 'string') query[key] = value;
    }
  }
  const share: WechatShareConfig = {
    title: trimmed(rawShare.title) || undefined,
    imageUrl: trimmed(rawShare.imageUrl) || undefined,
    query: Object.keys(query).length > 0 ? query : undefined,
  };

  return {
    cloudEnvId: trimmed(app.cloudEnvId),
    adUnits,
    pay,
    share,
    forceLocal: app.forceLocal === true,
  };
}
