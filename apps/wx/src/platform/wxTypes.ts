/**
 * 微信小游戏运行时 `wx` 全局的最小类型面（platform-wx 内部契约；S10 草案 §6 定稿形态）。
 * 做成**可注入接口**而不是 `declare const wx`：
 * - getWx() 是全包唯一读运行时全局的落点；其余模块一律经参数接收 WxLike；
 * - node:test 可注入 mock 直测垫片/存储/网络（S3「垫片正式化：可测试」要求）；
 * - 换官方 miniprogram-api-typings 的时机在 S9（云函数/开放数据域会显著扩大 API 面）。
 * 只声明本包实际用到的成员；扩面即扩评审面。
 */

export interface WxTouch {
  identifier: number;
  clientX: number;
  clientY: number;
}

export interface WxTouchEvent {
  touches: WxTouch[];
  changedTouches: WxTouch[];
  /** 基准不保证（K12 同款疑点）：本包不用它，采样时间统一取 adapter.now() */
  timeStamp: number;
}

/** wx.createCanvas() 返回的原生画布（首次=上屏；后续=离屏）。垫片前形态。 */
export interface WxRawCanvas {
  width: number;
  height: number;
  getContext(contextId: string, attrs?: object): object | null;
  /** 官方画布**没有**这两个方法，垫片补（three r160 硬要求，S11 路线 B） */
  addEventListener?: (type: string, fn: (ev?: unknown) => void) => void;
  removeEventListener?: (type: string, fn: (ev?: unknown) => void) => void;
  /** 真机上无 style：垫片给可写空对象（S10 D13） */
  style?: Record<string, string | undefined>;
}

export interface WxRequestTask {
  abort(): void;
}

export interface WxFileSystemManager {
  readFile(opts: {
    filePath: string;
    encoding?: string;
    success?(res: { data: string | ArrayBuffer }): void;
    fail?(err: { errMsg: string }): void;
  }): void;
}

export interface WxRequestOpts {
  url: string;
  method?: 'GET' | 'POST';
  dataType?: 'json' | string;
  timeout?: number;
  success?(res: { statusCode: number; data: unknown }): void;
  fail?(err: { errMsg: string }): void;
}

export interface WxDownloadOpts {
  url: string;
  success?(res: { statusCode: number; tempFilePath: string }): void;
  fail?(err: { errMsg: string }): void;
}

export interface WxCloud {
  init(opts?: { env?: string; traceUser?: boolean }): void;
  callFunction(opts: {
    name: string;
    data?: unknown;
    success?(res: { result: unknown }): void;
    fail?(err: { errMsg: string }): void;
  }): Promise<unknown>;
}

/** InnerAudioContext 的最小面（音频模块用；字段即属性，play/stop 等为方法）。 */
export interface WxInnerAudioContext {
  src: string;
  loop: boolean;
  volume: number;
  play(): void;
  stop(): void;
  destroy(): void;
  onEnded(cb: () => void): void;
  onError(cb: (err: { errMsg: string }) => void): void;
}

/** 本包实际用到的 wx API 面（S10 §6 表；wx.onTouchMove 故意不接——判定内核只用 down/up/cancel）。 */
export interface WxLike {
  createCanvas(): WxRawCanvas;
  getWindowInfo(): { windowWidth: number; windowHeight: number; pixelRatio: number };
  onWindowResize(cb: (res: { windowWidth: number; windowHeight: number }) => void): void;
  offWindowResize(cb: (res: { windowWidth: number; windowHeight: number }) => void): void;

  onTouchStart(cb: (e: WxTouchEvent) => void): void;
  onTouchEnd(cb: (e: WxTouchEvent) => void): void;
  onTouchCancel(cb: (e: WxTouchEvent) => void): void;
  offTouchStart(cb: (e: WxTouchEvent) => void): void;
  offTouchEnd(cb: (e: WxTouchEvent) => void): void;
  offTouchCancel(cb: (e: WxTouchEvent) => void): void;

  getStorageSync(key: string): unknown;
  setStorageSync(key: string, data: unknown): void;
  removeStorageSync(key: string): void;

  request(opts: WxRequestOpts): WxRequestTask;
  downloadFile(opts: WxDownloadOpts): WxRequestTask;
  getFileSystemManager(): WxFileSystemManager;

  onShow(cb: () => void): void;
  onHide(cb: () => void): void;
  offShow(cb: () => void): void;
  offHide(cb: () => void): void;

  /** 基础库 2.11.3+；缺失时退化 Date.now（S10 §4） */
  getPerformance?(): { now(): number };
  /** K12：回调参数不保证是时间戳，requestFrame 内部不消费它 */
  requestAnimationFrame(cb: (timeMs: number) => void): number;
  cancelAnimationFrame(handle: number): void;

  login(opts: { success?(res: { code: string }): void; fail?(err: { errMsg: string }): void }): void;
  shareAppMessage(opts: { title?: string; query?: string; imageUrl?: string }): void;
  cloud?: WxCloud;

  createInnerAudioContext(): WxInnerAudioContext;
}

/** 全包唯一读取运行时 `wx` 全局的落点（createWxAdapter 默认值；测试用显式注入绕开）。 */
export function getWx(): WxLike {
  const g = globalThis as { wx?: WxLike };
  if (!g.wx) throw new Error('未检测到微信小游戏运行时全局 wx（非小游戏环境请用 createWxAdapter({ wx: mock }) 注入）');
  return g.wx;
}
