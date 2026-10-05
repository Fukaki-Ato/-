import type {
  AdPlacement,
  IAdService,
  ICloudService,
  ILogger,
  IPlatformAdapter,
  IStorage,
  LoginResult,
  PayProduct,
  PayResult,
  ShareOptions,
  UserKV,
} from '../../../core/contracts';
import { createSafeStorage } from '../../../core/framework/Storage';
import { WechatAdService } from './WechatAdService';
import { WechatCloudService, type WechatCloudLoginProfile } from './WechatCloudService';
import { WechatStorage } from './WechatStorage';
import { getGlobalWx, type WxApi } from './WechatTypes';
import {
  WECHAT_DEFAULT_SHARE_TITLE,
  type WechatPayConfig,
  type WechatShareConfig,
} from './WechatConfig';

export const WECHAT_GUEST_UID_KEY = 'ltkp.wechat.guestUid';
const DEFAULT_NICKNAME = '酷跑玩家';

/** 生命周期回调（由启动装配注入：Boot/GameRoot 的 ctx.refreshDaily / ctx.flush）。 */
export interface WechatLifecycleHooks {
  onShow?: () => void;
  onHide?: () => void;
}

export interface WechatPlatformOptions {
  cloudEnvId?: string;
  adUnits?: Partial<Record<AdPlacement, string>>;
  pay?: WechatPayConfig;
  share?: WechatShareConfig;
  /** 微信宿主 API；缺省从全局 wx 探测（测试可注入假对象）。 */
  wx?: WxApi | null;
  log?: ILogger;
  storage?: IStorage;
  ad?: IAdService;
  cloud?: ICloudService;
  lifecycle?: WechatLifecycleHooks;
  cloudTimeoutMs?: number;
}

/**
 * `IPlatformAdapter` 的微信实现（docs/05）：
 * wx 云开发、登录（失败降级游客）、同步存储、激励视频、分享、米大师支付（Android）、
 * 震动/剪贴板/托管数据/前台后台生命周期与原生隐私授权。
 */
export class WechatPlatformAdapter implements IPlatformAdapter {
  readonly kind = 'wechat' as const;
  readonly storage: IStorage;
  readonly ad: IAdService;
  readonly cloud: ICloudService;

  private readonly wx: WxApi | null;
  private readonly log?: ILogger;
  private readonly cloudEnvId: string;
  private readonly payConfig: WechatPayConfig;
  private readonly shareConfig: WechatShareConfig;
  private readonly lifecycle: WechatLifecycleHooks;

  constructor(opts: WechatPlatformOptions = {}) {
    this.wx = opts.wx !== undefined ? opts.wx : getGlobalWx();
    this.log = opts.log;
    this.cloudEnvId = (opts.cloudEnvId ?? '').trim();
    this.payConfig = opts.pay ?? { offerId: '', mode: 'goods', env: 0, currencyType: 'CNY', zoneId: '1', buyQuantity: 1 };
    this.shareConfig = opts.share ?? {};
    this.lifecycle = opts.lifecycle ?? {};
    this.storage = opts.storage ?? (this.wx ? new WechatStorage(this.wx, opts.log) : createSafeStorage(opts.log));
    this.ad = opts.ad ?? new WechatAdService({ wx: this.wx, adUnits: opts.adUnits ?? {}, log: opts.log });
    this.cloud = opts.cloud ?? new WechatCloudService({ wx: this.wx, log: opts.log, timeoutMs: opts.cloudTimeoutMs });
  }

  async init(): Promise<void> {
    const api = this.wx;
    if (!api) {
      this.log?.warn('微信环境不可用，WechatPlatformAdapter 以降级模式运行（云/登录/分享不可用）');
      return;
    }
    await this.cloud.init(this.cloudEnvId);
    this.registerShare(api);
    this.registerLifecycle(api);
    try {
      api.setKeepScreenOn?.({ keepScreenOn: true });
    } catch (err) {
      this.log?.warn('setKeepScreenOn 调用失败', err);
    }
  }

  async login(): Promise<LoginResult> {
    const cloud = this.cloud as ICloudService & { login?: () => Promise<WechatCloudLoginProfile | null> };
    if (typeof cloud.login === 'function') {
      const profile = await cloud.login();
      if (profile && profile.uid) {
        return {
          uid: profile.uid,
          nickname: profile.nickname.trim() || DEFAULT_NICKNAME,
          avatarUrl: profile.avatarUrl,
          isGuest: false,
        };
      }
    }
    const uid = this.guestUid();
    this.log?.warn(`微信登录不可用，降级游客模式：${uid}`);
    return { uid, nickname: DEFAULT_NICKNAME, avatarUrl: '', isGuest: true };
  }

  async share(opts: ShareOptions): Promise<boolean> {
    const api = this.wx;
    if (!api?.shareAppMessage) {
      this.log?.warn('微信分享 API 不可用');
      return false;
    }
    try {
      api.shareAppMessage({
        title: opts.title || this.shareTitle(),
        imageUrl: opts.imageUrl || this.shareConfig.imageUrl || undefined,
        query: encodeQuery(opts.query) || this.shareQuery() || undefined,
      });
      // 微信不保证回传分享结果（部分场景无 success/fail 回调），主动调用即视为已触发。
      return true;
    } catch (err) {
      this.log?.warn('微信分享调用失败', err);
      return false;
    }
  }

  async pay(product: PayProduct): Promise<PayResult> {
    const api = this.wx;
    if (!api?.requestMidasPayment) return { ok: false, reason: 'unsupported' };
    const offerId = this.payConfig.offerId.trim();
    if (!offerId) {
      this.log?.warn('未配置支付 offerId（app.json pay 字段），支付不可用');
      return { ok: false, reason: 'unsupported' };
    }
    const platform = this.devicePlatform(api);
    if (platform !== 'android') {
      // iOS 虚拟支付受限（docs/05 §6）：统一返回 unsupported，由 UI 隐藏充值入口。
      this.log?.info(`当前平台（${platform || 'unknown'}）不支持米大师支付`);
      return { ok: false, reason: 'unsupported' };
    }
    const mode = this.payConfig.mode === 'game' ? 'game' : 'goods';
    return new Promise<PayResult>((resolve) => {
      const settle = (result: PayResult): void => resolve(result);
      try {
        api.requestMidasPayment!({
          mode,
          env: this.payConfig.env,
          offerId,
          currencyType: this.payConfig.currencyType || 'CNY',
          platform: 'android',
          zoneId: this.payConfig.zoneId || undefined,
          productId: mode === 'goods' ? product.id : undefined,
          buyQuantity: mode === 'goods' ? 1 : Math.max(1, this.payConfig.buyQuantity),
          success: () => settle({ ok: true }),
          fail: (err) => {
            const message = err?.errMsg ?? '';
            this.log?.warn('米大师支付失败', err);
            settle({ ok: false, reason: /cancel/i.test(message) ? 'cancel' : 'fail' });
          },
        });
      } catch (err) {
        this.log?.warn('米大师支付调用异常', err);
        settle({ ok: false, reason: 'fail' });
      }
    });
  }

  setUserCloudStorage(kv: UserKV[]): void {
    const api = this.wx;
    if (!api?.setUserCloudStorage) {
      this.log?.warn('setUserCloudStorage 不可用');
      return;
    }
    try {
      api.setUserCloudStorage({
        KVDataList: kv.map((entry) => ({ key: entry.key, value: String(entry.value) })),
        fail: (err) => this.log?.warn('setUserCloudStorage 调用失败', err),
      });
    } catch (err) {
      this.log?.warn('setUserCloudStorage 调用异常', err);
    }
  }

  vibrate(type: 'short' | 'long'): void {
    const api = this.wx;
    try {
      if (type === 'long') api?.vibrateLong?.({});
      else api?.vibrateShort?.({ type: 'medium' });
    } catch (err) {
      this.log?.debug('震动调用失败', err);
    }
  }

  copyText(text: string): void {
    const api = this.wx;
    if (!api?.setClipboardData) {
      this.log?.warn('setClipboardData 不可用');
      return;
    }
    try {
      api.setClipboardData({ data: text, fail: (err) => this.log?.warn('复制到剪贴板失败', err) });
    } catch (err) {
      this.log?.warn('复制到剪贴板异常', err);
    }
  }

  /**
   * 微信原生隐私授权（契约外附加能力，Boot 在本地隐私同意后调用）：
   * - `wx.getPrivacySetting` 查询是否需要授权；不需要/不可用直接通过；
   * - 需要时调用 `wx.requirePrivacyAuthorize` 弹出官方隐私弹窗，用户拒绝返回 false。
   */
  async requestPrivacyAuthorization(): Promise<boolean> {
    const api = this.wx;
    if (!api?.getPrivacySetting || !api?.requirePrivacyAuthorize) {
      this.log?.info('当前基础库不支持隐私授权 API，按本地隐私同意结果继续');
      return true;
    }
    const setting = await new Promise<{ needAuthorization: boolean } | null>((resolve) => {
      try {
        api.getPrivacySetting!({
          success: (res) => resolve({ needAuthorization: res?.needAuthorization === true }),
          fail: () => resolve(null),
        });
      } catch (err) {
        this.log?.warn('getPrivacySetting 调用异常', err);
        resolve(null);
      }
    });
    if (!setting) return true;
    if (!setting.needAuthorization) return true;
    return new Promise<boolean>((resolve) => {
      try {
        api.requirePrivacyAuthorize!({
          success: () => resolve(true),
          fail: (err) => {
            this.log?.warn('用户未通过隐私授权', err);
            resolve(false);
          },
        });
      } catch (err) {
        this.log?.warn('requirePrivacyAuthorize 调用异常', err);
        resolve(false);
      }
    });
  }

  private registerShare(api: WxApi): void {
    try {
      api.showShareMenu?.({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    } catch (err) {
      this.log?.warn('showShareMenu 调用失败', err);
    }
    try {
      api.onShareAppMessage?.(() => ({
        title: this.shareTitle(),
        imageUrl: this.shareConfig.imageUrl || undefined,
        query: this.shareQuery() || undefined,
      }));
    } catch (err) {
      this.log?.warn('onShareAppMessage 注册失败', err);
    }
  }

  private registerLifecycle(api: WxApi): void {
    try {
      api.onShow?.(() => this.lifecycle.onShow?.());
      api.onHide?.(() => this.lifecycle.onHide?.());
    } catch (err) {
      this.log?.warn('生命周期回调注册失败', err);
    }
  }

  private shareTitle(): string {
    return (this.shareConfig.title ?? '').trim() || WECHAT_DEFAULT_SHARE_TITLE;
  }

  private shareQuery(): string {
    return encodeQuery(this.shareConfig.query);
  }

  private devicePlatform(api: WxApi): string {
    try {
      return api.getDeviceInfo?.()?.platform ?? api.getSystemInfoSync?.()?.platform ?? '';
    } catch {
      return '';
    }
  }

  private guestUid(): string {
    const existing = this.storage.get(WECHAT_GUEST_UID_KEY);
    if (existing && /^guest_[a-z0-9]{8}$/.test(existing)) return existing;
    const uid = `guest_${randomToken(8)}`;
    this.storage.set(WECHAT_GUEST_UID_KEY, uid);
    return uid;
  }
}

function encodeQuery(query: Record<string, string> | undefined): string {
  if (!query) return '';
  return Object.entries(query)
    .filter(([key, value]) => key.length > 0 && typeof value === 'string')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function randomToken(length: number): string {
  let token = '';
  while (token.length < length) token += Math.random().toString(36).slice(2);
  return token.slice(0, length);
}
