/**
 * 平台适配层接口 v2（S10 契约定稿；规格见 docs/platform-adapter-v2.md）。
 * 这是唯一的平台边界（docs/02 §4 / redesign §3.1）：
 * core / render / ui / game 只允许通过这里的接口访问宿主能力，
 * 禁止直接写 window / document / wx（由 tools/check-import-rules.mjs 强制检查）。
 *
 * v1 → v2 要点（完整去向表见规格 §2）：
 * - createCanvasHost(container) 拆分 → canvas: CanvasFactory（主画布幂等单例 + 显式离屏工厂，D1/D2）
 * - onGesture + onKey 合并 → onInput(InputEvent)（D4），且与画布生命周期解耦（D5）
 * - storage / fetchJson / requestFrame / cancelFrame / onVisibility / now 六项签名与 v1 逐字一致（D6）
 * - 新增 version: 2（运行时探测）、canvas.onResize、extras?: WxExtras（D9/D10/D7）
 */
import type { AudioService } from './audio.js';
import type { CanvasFactory, FrameHandle, Unsubscribe } from './canvas.js';
import type { InputEvent } from './input.js';
import type { WxExtras } from './extras.js';

/** 同步 KV 存储。语义约定：get 返回 null = 无记录（wx 实现归一化 getStorageSync 的 '' 歧义，D11）。 */
export interface SyncStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface PlatformAdapter {
  /** 运行时探测用（S2/S3 过渡期防新旧垫片错配）；v1 无此字段。 */
  readonly version: 2;
  readonly env: 'web' | 'wx';

  /** v1 createCanvasHost 的去向（拆分为工厂四方法，见 canvas.ts）。 */
  readonly canvas: CanvasFactory;

  /** v1 onGesture + onKey 的合并去向。可在画布创建前任意时刻订阅（v1「先建画布否则 throw」的坑废止）。 */
  onInput(cb: (e: InputEvent) => void): Unsubscribe;

  readonly storage: SyncStorage;
  /** 非 2xx 一律 reject（两端一致）；wx 映射 wx.request。 */
  fetchJson(url: string): Promise<unknown>;
  /** cb 的 timeMs 与 now() 同时间基准（契约 D12，wx 实现必要时内部换算）。 */
  requestFrame(cb: (timeMs: number) => void): FrameHandle;
  cancelFrame(handle: FrameHandle): void;
  /** 参数语义保持 v1：hidden=true 表示进入后台。wx 映射 onShow→false / onHide→true。 */
  onVisibility(cb: (hidden: boolean) => void): Unsubscribe;
  /** 毫秒单调钟（web: performance.now；wx: getPerformance().now）。 */
  now(): number;

  /** wx 专属能力（可选注入，见 extras.ts）；wx 实现必供，web 壳给 no-op/兜底实现。 */
  readonly extras?: PlatformExtras;

  /** 音频播放（web/wx 均提供，见 audio.ts）；纯逻辑测试壳可缺省，业务代码须容忍 undefined。 */
  readonly audio?: AudioService;
}

// 共享类型统一从包内各模块再导出：消费方 import '@tr/framework/platform/platformAdapter.js' 即可拿齐。
export type {
  CanvasFactory, ContextHandle, GLCanvas, GLContextAttributes, FrameHandle, Unsubscribe, WindowSize,
} from './canvas.js';
export type {
  Gesture, GestureClassifier, GestureClassifierOptions, InputEvent, SwipeDir, TouchSample,
} from './input.js';
export { GESTURE_DEFAULTS, createGestureClassifier } from './gestureClassifier.js';
export type { CloudBridge, ShareOptions, WxExtras, WxIdentity } from './extras.js';

export interface PlatformExtras extends WxExtras {
  /**
   * extras 的调试扩展（QA）：web 壳注入 location.search 解出的 URLSearchParams，
   * 供 render 层读 ?anim=<ClipName> 锁动作 / ?char=<id> 锁角色（见 render/animClips.ts）。
   * wx 无 location.search 概念，缺省 undefined；packages/** 只读不 import 任何 app/宿主代码。
   */
  urlParams?: URLSearchParams;
}
export type { AudioOptions, AudioService } from './audio.js';
