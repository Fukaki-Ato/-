/**
 * 微信宿主 API 的最小结构化类型（仅本目录使用）。
 *
 * 约束：
 * - 全局 `wx` 的唯一直连探测点是本文件的 `getGlobalWx()`；
 * - 其余代码通过构造参数注入 `WxApi`，便于在 Node/Vitest 中用假对象测试；
 * - 只声明本工程实际使用的方法，未使用的能力不引入。
 */

/** 微信 API 通用错误对象。 */
export interface WxErrorInfo {
  errMsg?: string;
  errCode?: number;
  errno?: number;
}

export interface WxLoginOptions {
  timeout?: number;
  success?: (res: { code?: string; errMsg?: string }) => void;
  fail?: (err: WxErrorInfo) => void;
  complete?: () => void;
}

export interface WxCloudCallFunctionResult {
  result?: unknown;
  errMsg?: string;
  errCode?: number;
}

export interface WxCloudApi {
  init(options: { env: string; traceUser?: boolean }): void;
  callFunction(options: {
    name: string;
    data?: Record<string, unknown>;
    success?: (res: WxCloudCallFunctionResult) => void;
    fail?: (err: WxErrorInfo) => void;
    complete?: () => void;
  }): void;
}

/** 激励视频广告实例（wx.createRewardedVideoAd 返回值的最小声明）。 */
export interface WxRewardedVideoAd {
  load(): Promise<void>;
  show(): Promise<void>;
  onClose(cb: (res: { isEnded?: boolean; errMsg?: string } | undefined) => void): void;
  offClose?(cb: (res: { isEnded?: boolean; errMsg?: string } | undefined) => void): void;
  onError(cb: (err: WxErrorInfo) => void): void;
  offError?(cb: (err: WxErrorInfo) => void): void;
}

export interface WxMidasPaymentOptions {
  mode: 'game' | 'goods';
  env: number;
  offerId: string;
  currencyType: string;
  platform: 'android';
  zoneId?: string;
  buyQuantity?: number;
  productId?: string;
  success?: () => void;
  fail?: (err: WxErrorInfo) => void;
  complete?: () => void;
}

/** 微信宿主 API 最小子集（全部可选，缺省表示该能力在当前基础库不可用）。 */
export interface WxApi {
  login?: (options: WxLoginOptions) => void;
  cloud?: WxCloudApi;
  createRewardedVideoAd?: (options: { adUnitId: string }) => WxRewardedVideoAd;

  getStorageSync?: (key: string) => unknown;
  setStorageSync?: (key: string, data: unknown) => void;
  removeStorageSync?: (key: string) => void;

  showShareMenu?: (options?: {
    withShareTicket?: boolean;
    menus?: string[];
    fail?: (err: WxErrorInfo) => void;
  }) => void;
  onShareAppMessage?: (cb: () => { title?: string; imageUrl?: string; query?: string }) => void;
  shareAppMessage?: (options: {
    title?: string;
    imageUrl?: string;
    query?: string;
    success?: () => void;
    fail?: (err: WxErrorInfo) => void;
  }) => void;

  onShow?: (cb: (res?: { query?: Record<string, string>; scene?: number }) => void) => void;
  onHide?: (cb: () => void) => void;
  setKeepScreenOn?: (options: { keepScreenOn: boolean; fail?: (err: WxErrorInfo) => void }) => void;

  vibrateShort?: (options?: { type?: 'heavy' | 'medium' | 'light'; fail?: (err: WxErrorInfo) => void }) => void;
  vibrateLong?: (options?: { fail?: (err: WxErrorInfo) => void }) => void;
  setClipboardData?: (options: { data: string; success?: () => void; fail?: (err: WxErrorInfo) => void }) => void;
  setUserCloudStorage?: (options: {
    KVDataList: Array<{ key: string; value: string }>;
    success?: () => void;
    fail?: (err: WxErrorInfo) => void;
  }) => void;

  requestMidasPayment?: (options: WxMidasPaymentOptions) => void;

  getDeviceInfo?: () => { platform?: string };
  getSystemInfoSync?: () => { platform?: string };

  getPrivacySetting?: (options: {
    success?: (res: { needAuthorization?: boolean; privacyContractName?: string }) => void;
    fail?: (err: WxErrorInfo) => void;
    complete?: () => void;
  }) => void;
  requirePrivacyAuthorize?: (options: {
    success?: () => void;
    fail?: (err: WxErrorInfo) => void;
    complete?: () => void;
  }) => void;

  getOpenDataContext?: () => { postMessage(message: unknown): void } | undefined;
}

/**
 * 探测全局 `wx`。这是全工程唯一直接引用宿主全局的位置；
 * 非微信环境（浏览器/编辑器/Node 测试）返回 null。
 *
 * 注：cc 工程（tsconfig.cc）通过 `typings/wx.d.ts` 引入官方
 * `miniprogram-api-typings` 的全局 `wx`；core 工程（tests 引用本文件）不加载该包，
 * 因此这里在模块内声明占位名，两种 tsconfig 下均可通过类型检查。
 */
declare const wx: unknown;

export function getGlobalWx(): WxApi | null {
  const globalWx: unknown = wx;
  if (typeof globalWx === 'undefined' || !globalWx) return null;
  return globalWx as WxApi;
}
