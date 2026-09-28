/**
 * UiView：一棵控件树 + 布局/输入/绘制的宿主环境（WidgetEnv 实现）。
 * 每帧闭环（overlay.tick 驱动，S13 API.md §4）：
 *   step(dt)（滚动物理等 → invalidate）→ buildNode() → layout() → applyTree()（sync+paint）
 *   → router.setTree()。dirty=false 的帧直接复用上一棵矩形树。
 * headless 可用：不依赖 WebGLRenderer（three 对象只建不画），node 测试直接驱动本类。
 */
import * as THREE from 'three';
import type { LayoutBox, LayoutNode, Size } from './types.js';
import { layout } from './layout.js';
import type { InputRouter } from './router.js';
import type { UiInput } from './router.js';
import type { FontSet } from './text/metrics.js';
import { createTheme, type Theme } from './theme.js';
import { defaultUiConfig, type UiConfig } from './uiConfig.js';
import { Widget, type WidgetEnv } from './widget.js';
import { Box } from './widgets/box.js';
import { rootPaintCtx } from './paint.js';

export interface UiViewOptions {
  fonts: FontSet;
  width: number;
  height: number;
  /** 缺省 createTheme()（view.dispose 时释放） */
  theme?: Theme;
  /** 缺省 defaultUiConfig（生产从 config/game.json params.ui 解析，见 uiConfig.ts） */
  config?: UiConfig;
  pixelRatio?: number;
}

export class UiView {
  readonly stage = new THREE.Group();
  readonly fonts: FontSet;
  readonly theme: Theme;
  readonly config: UiConfig;
  /** 全屏根容器（passthrough：底板不拦命中） */
  readonly root: Box;
  width: number;
  height: number;
  private env: WidgetEnv;
  private idSeq = 0;
  private dirty = true;
  private ownsTheme: boolean;
  private router: InputRouter | null = null;

  constructor(opts: UiViewOptions) {
    this.fonts = opts.fonts;
    this.theme = opts.theme ?? createTheme();
    this.ownsTheme = opts.theme === undefined;
    this.config = opts.config ?? defaultUiConfig;
    this.width = Math.max(0, opts.width);
    this.height = Math.max(0, opts.height);
    this.env = {
      fonts: this.fonts,
      theme: this.theme,
      config: this.config,
      pixelRatio: Math.max(0.1, opts.pixelRatio ?? 1),
      stage: this.stage,
      invalidate: () => { this.dirty = true; },
      nextId: (prefix: string) => `${prefix}${++this.idSeq}`,
      attachHandlers: (w: Widget) => this.attachHandlers(w),
      detachHandlers: (w: Widget) => this.detachHandlers(w),
    };
    this.root = new Box({ passthrough: true });
    this.root.bind(this.env);
  }

  get pixelRatio(): number { return this.env.pixelRatio; }

  add(...ws: Widget[]): this {
    this.root.add(...ws);
    return this;
  }

  remove(w: Widget): boolean { return this.root.remove(w); }

  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    this.dirty = true;
  }

  setPixelRatio(dpr: number): void {
    if (dpr === this.env.pixelRatio) return;
    this.env.pixelRatio = Math.max(0.1, dpr);
    this.root.visit(w => w.pixelRatioChanged());
    this.dirty = true;
  }

  invalidate(): void { this.dirty = true; }

  consumeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  /** 控件树 → S13 约束树（含文本测量回填的 content 尺寸） */
  buildNode(): LayoutNode { return this.root.node(); }

  /** 布局并把矩形树回放到控件（摆放视觉对象 + 分配绘制序/裁剪） */
  applyTree(box: LayoutBox): void {
    this.root.sync(box, rootPaintCtx());
  }

  /** 一步到位：布局 + 回放 + router 回填（overlay.tick 与 node 测试共用） */
  relayout(): LayoutBox {
    const box = layout(this.buildNode(), { w: this.width, h: this.height } as Size);
    this.dirty = false; // 先清脏位：applyTree/sync 期间的 invalidate（List 视口估算、Label 两遍收敛）才能存活到下一帧
    this.applyTree(box);
    this.router?.setTree(box);
    return box;
  }

  /** overlay.mount/unmount 时接线；已挂载状态下动态 add 的控件也能收到注册 */
  setRouter(router: InputRouter | null): void {
    if (this.router) this.unregisterHandlers(this.router);
    this.router = router;
    if (router) this.registerHandlers(router);
  }

  registerHandlers(router: InputRouter): void {
    this.root.visit(w => {
      const h = w.handlers();
      if (h && w.id) router.register(w.id, h);
    });
  }

  unregisterHandlers(router: InputRouter): void {
    this.root.visit(w => { if (w.id) router.unregister(w.id); });
  }

  attachHandlers(w: Widget): void {
    if (!this.router) return;
    w.visit(x => {
      const h = x.handlers();
      if (h && x.id) this.router!.register(x.id, h);
    });
  }

  detachHandlers(w: Widget): void {
    if (!this.router) return;
    w.visit(x => { if (x.id) this.router!.unregister(x.id); });
  }

  step(dt: number): void { this.root.step(dt); }

  /** 宿主级 touchcancel：滚动容器收尾（dragEnd），按压态由 router 的 cancel 分发负责 */
  inputCancelled(): void { this.root.onInputCancel(); }

  /** 输入直通（不经 overlay 单独驱动 view 时用；t 单位=秒） */
  dispatch(router: InputRouter, input: UiInput): void {
    router.dispatch(input);
    if (input.type === 'cancel') this.inputCancelled();
  }

  dispose(): void {
    this.root.dispose();
    if (this.ownsTheme) this.theme.dispose();
  }
}
