/**
 * UiHost —— 自绘 UI 页面层（S5）的运行宿主：OrthoOverlay + 每帧循环 + 输入注入 + toast。
 * 两端同源：本文件零 DOM/wx（禁令强制）。renderer 由 apps 壳构造后经 OverlayHost 注入：
 * - web 壳（apps/web）：主画布之上叠一块专用透明 UI canvas（独立 WebGLRenderer），
 *   两 pass 在浏览器合成器串接——run 局内 runnerScene 自建 renderer 且不外露（packages/render
 *   属 S5 禁碰范围），单 canvas 共享 renderer 的两 pass 串接待 S7/S20 整合（见会话汇报）。
 * - wx 壳（S6 后接线）：同接口，届时 UI 与主场景真正共享单 renderer + 单循环。
 * 输入：inputMode='raw'（web）由壳经 pushInput 注入原始 pointer 流（可拖拽滚动）；
 *       inputMode='gesture'（缺省，wx）订阅 adapter.onInput，tap→down/up、swipe→列表 fling 退化滚动。
 */
import * as THREE from 'three';
import {
  UiView, Box, Panel, Label, List, ScrollView, createOverlay, createTheme, createSkinTexture,
  gestureToInputs, applySwipeScroll,
  type FontSet, type NinePatchSource, type Overlay, type OverlayHost, type Theme,
  type UiConfig, type UiInput, type Widget,
} from '@tr/framework/ui/index.js';
import type { PlatformAdapter, WindowSize } from '@tr/framework/platform/platformAdapter.js';

export interface UiHostOptions {
  adapter: PlatformAdapter;
  /** 与主场景分离或共享的渲染器（见文件头；overlay 只要求正交叠加渲染能力） */
  overlayHost: OverlayHost;
  fonts: FontSet;
  config: UiConfig;
  /** 缺省 'gesture'：仅消费 adapter.onInput 手势（wx 无原始触点流的退化路径） */
  inputMode?: 'raw' | 'gesture';
  /** 半透明页（HUD）渲染前清 UI 表面（web 壳=clear 透明色；单 canvas 两 pass 时省略=保留主场景） */
  clearSurface?: () => void;
  /** 视口尺寸变化转发（壳侧 renderer.setPixelRatio/setSize 在此调用） */
  onViewportSize?: (size: WindowSize) => void;
}

/** 页面每帧回调（tSec=宿主累计秒，驱动光标闪烁/进度条等装饰动画） */
export type PageFrame = (tSec: number) => void;

export interface MountOptions {
  /** true=不画不透明底色（run HUD 叠在主场景上），并每帧走 clearSurface */
  transparent?: boolean;
  frame?: PageFrame;
}

const TOAST_LIFE_S = 2.2;
const TOAST_W = 240;        // 胶囊宽度：装得下最长的占位提示，超出就折行
const TOAST_START = 0.45;   // 出现位置＝画面纵向 45%（视觉上居中）
const TOAST_DRIFT = 90;     // 寿命内向下漂移的像素
const TOAST_ROW = 40;       // 多条提示同时存在时的纵向错位

/**
 * toast 胶囊：自己按寿命向下漂移，到期由 UiHost 摘掉。
 * 它挂在零宽锚点上（见 UiHost.mount 的 toastLayer）——框架的命中规则是「反向扫描到第一个
 * rect 含命中点的分支就返回」，哪怕整条链都是 passthrough，也会把底下页面的点击判死；
 * 提示条盖在画面中间，绝不能吃掉它身下的按钮。锚点宽度 0 ⇒ 不含任何命中点 ⇒ 整棵 toast
 * 子树天然不参与命中，正好是想要的「只看不拦」。
 */
class ToastChip extends Panel {
  private age = 0;
  private readonly top0: number;
  private readonly drift: number;

  constructor(top0: number, left: number, drift: number, children: Widget[]) {
    super({
      absolute: true, top: top0, left, width: TOAST_W, align: 'stretch',
      passthrough: true, background: 'card',
      padding: { top: 8, right: 18, bottom: 8, left: 18 },
    }, children);
    this.top0 = top0;
    this.drift = drift;
  }

  override step(dt: number): void {
    super.step(dt);
    if (this.age >= TOAST_LIFE_S) return; // 停摆后等宿主摘除，不再逐帧重排
    const t = Math.min(1, (this.age += dt) / TOAST_LIFE_S);
    this.opts.top = this.top0 + this.drift * t * t; // 越落越快，收尾干脆
    this.env?.invalidate();
  }
}

export class UiHost {
  readonly overlay: Overlay;
  readonly theme: Theme;
  /** 白色实底九宫格（色块/焦点条等自定义色元素共用；host.dispose 释放） */
  readonly solidSkin: NinePatchSource;
  readonly adapter: PlatformAdapter;
  private opts: UiHostOptions;
  private view: UiView | null = null;
  private frameHook: PageFrame | null = null;
  private transparent = false;
  private toastLayer: Box | null = null;
  private toasts: { w: Panel; until: number }[] = [];
  private raf = 0;
  private last = 0;
  private clock = 0;
  private disposed = false;

  constructor(opts: UiHostOptions) {
    this.opts = opts;
    this.adapter = opts.adapter;
    this.theme = createTheme();
    this.overlay = createOverlay(opts.overlayHost);
    const solid = createSkinTexture({ fill: '#ffffff', border: null, radiusPx: 10, borderPx: 0, fillAlpha: 1 });
    this.solidSkin = { texture: solid.texture, insets: solid.insets, texSize: { w: solid.sizePx, h: solid.sizePx } };
    // 视口变化：overlay/UiView 尺寸走 WindowSize（CSS 逻辑像素，与输入坐标同基准）
    opts.adapter.canvas.onResize(s => { this.resize(s); });
    if ((opts.inputMode ?? 'gesture') === 'gesture') this.wireGestureInput();
  }

  /** 新建页面视图（共享 fonts/theme/config；尺寸取当前 overlayHost） */
  makeView(): UiView {
    return new UiView({
      fonts: this.opts.fonts,
      width: this.opts.overlayHost.width,
      height: this.opts.overlayHost.height,
      theme: this.theme,
      config: this.opts.config,
    });
  }

  /** 挂载页面视图（替换并 dispose 旧视图；toast 容器随视图重建） */
  mount(view: UiView, mo?: MountOptions): void {
    this.clear();
    this.view = view;
    this.transparent = mo?.transparent === true;
    this.frameHook = mo?.frame ?? null;
    this.overlay.scene.background = this.transparent ? null : new THREE.Color(this.theme.colors.bg);
    // 零宽满高的锚点：absolute 且不占常规流。旧版是 in-flow 列 + padding.bottom 28 托底，
    // 结果从页面高度里扣掉 28px，屏幕底下永远露出一条主题底色的暗带（用户反馈的「黑框」）。
    // 宽度取 0 ⇒ 锚点自身不含任何命中点，整棵 toast 子树不参与命中（见 ToastChip 注释）；
    // 高度必须给满：auto 尺寸会「收缩到可用空间」，锚点高度为 0 会把胶囊压成 0 高。
    this.toastLayer = new Box({
      absolute: true, top: 0, left: 0, width: 0, height: { percent: 100 }, passthrough: true,
    });
    view.add(this.toastLayer);
    this.overlay.mount(view);
  }

  /** 卸下并释放当前视图（run 退出后画面还没挂载时用） */
  clear(): void {
    const old = this.view;
    if (!old) return;
    this.overlay.unmount();
    old.dispose();
    this.view = null;
    this.frameHook = null;
    this.toastLayer = null;
    this.toasts = [];
  }

  pushInput(input: UiInput): void {
    this.overlay.handleInput(input);
  }

  /** 通用小提示条（挂当前页底部；无页面挂载时忽略——与 DOM 版 body 级 toast 等价语义） */
  toast(msg: string): void {
    if (!this.view || !this.toastLayer) return;
    const v = this.view;
    const top = Math.round(v.height * TOAST_START) + this.toasts.length * TOAST_ROW;
    const left = Math.max(8, Math.round((v.width - TOAST_W) / 2));
    const chip = new ToastChip(top, left, TOAST_DRIFT,
      [new Label({ text: msg, fontSizePx: 13, color: this.theme.colors.text, align: 'center' })]);
    this.toastLayer.add(chip);
    this.toasts.push({ w: chip, until: this.clock + TOAST_LIFE_S });
  }

  resize(size: WindowSize): void {
    this.overlay.resize(size.width, size.height, size.dpr);
    this.opts.onViewportSize?.(size);
  }

  /** 每帧循环（adapter.requestFrame 驱动，两端一致）；start 幂等 */
  start(): void {
    if (this.disposed || this.raf) return;
    this.last = this.adapter.now();
    const tick = (nowMs: number): void => {
      if (this.disposed) return;
      const dt = Math.min((nowMs - this.last) / 1000, 0.05);
      this.last = nowMs;
      this.clock += dt;
      this.frameHook?.(this.clock);
      this.purgeToasts();
      if (this.transparent) this.opts.clearSurface?.();
      this.overlay.tick(dt);
      this.raf = this.adapter.requestFrame(tick);
    };
    this.raf = this.adapter.requestFrame(tick);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) this.adapter.cancelFrame(this.raf);
    this.raf = 0;
    this.clear();
    const t = this.solidSkin.texture;
    if (t) t.dispose();
    this.theme.dispose();
  }

  private purgeToasts(): void {
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      if (this.clock >= this.toasts[i]!.until) {
        this.toastLayer?.remove(this.toasts[i]!.w);
        this.toasts.splice(i, 1);
      }
    }
  }

  private wireGestureInput(): void {
    this.adapter.onInput(e => {
      if (e.type === 'key') return; // 键盘不参与命中分发（页面 keymap 由壳转发）
      const t = this.adapter.now() / 1000;
      for (const input of gestureToInputs(e, t)) this.overlay.handleInput(input);
      if (e.type === 'swipe' && this.view) {
        // 退化滚动：无原始触点流时，一次 swipe = 当前页所有纵向滚动容器 fling 一屏
        const scrolls: (typeof List.prototype.physics)[] = [];
        this.view.root.visit(w => { if (w instanceof List || w instanceof ScrollView) scrolls.push(w.physics); });
        for (const p of scrolls) applySwipeScroll(e, p, 'y');
      }
    });
  }
}
