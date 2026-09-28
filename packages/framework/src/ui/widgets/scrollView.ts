/**
 * ScrollView：滚动容器控件（S13 每帧闭环的实现侧）。
 * node() 带 scroll+scrollOffset（布局引擎产出 clip 与 ScrollMetrics）；
 * handlers 接 dragStart/dragBy/dragEnd；step(dt) 推进惯性/回弹并 invalidate；
 * sync 用布局回报的 content/viewport 更新物理边界，并给子树叠加裁剪面。
 * 注意：dragBy 只在 router 锁定路径包含本容器时到达（down 必须落在容器内）。
 */
import type { EdgesInput, Length, LayoutBox, LayoutNode } from '../types.js';
import { skipBubble, Widget } from '../widget.js';
import type { PaintCtx } from '../paint.js';
import { ScrollPhysics, type ScrollFeel } from '../scroll.js';
import type { NodeHandlers } from '../router.js';
import { planesForRect } from '../render/clip.js';
import type * as THREE from 'three';

export interface ScrollViewOptions {
  axis?: 'x' | 'y';
  /** 单内容子控件 */
  content: Widget;
  /** 手感覆盖（默认取 UiConfig.scroll，即 config/game.json params.ui.scroll） */
  feel?: Partial<ScrollFeel>;
  width?: Length;
  height?: Length;
  flex?: number;
  padding?: EdgesInput;
  margin?: EdgesInput;
}

export class ScrollView extends Widget {
  /** 滚动物理（onBind 时按 UiConfig/feel 覆盖构建） */
  physics!: ScrollPhysics;
  protected content: Widget;
  protected opts: ScrollViewOptions;
  private lastPos = 0;
  private clipRectKey = '';
  private clipPlanes: THREE.Plane[] = [];

  constructor(opts: ScrollViewOptions) {
    super();
    this.opts = opts;
    this.physics = new ScrollPhysics({ content: 0, viewport: 0 });
    this.content = opts.content;
  }

  protected get kind(): string { return 'scroll'; }

  protected onBind(): void {
    const env = this.requireEnv();
    const feel = this.opts.feel ?? env.config.scroll;
    this.physics = new ScrollPhysics({ content: 0, viewport: 0, feel, offset: this.physics.offset });
    this.content.bind(env);
  }

  protected axis(): 'x' | 'y' { return this.opts.axis ?? 'y'; }

  private posOf(e: { x: number; y: number }): number { return this.axis() === 'y' ? e.y : e.x; }

  node(): LayoutNode {
    const o = this.opts;
    return {
      id: this.id,
      scroll: this.axis(),
      scrollOffset: this.physics.offset,
      width: o.width, height: o.height, flex: o.flex, padding: o.padding, margin: o.margin,
      children: [this.content.node()],
    };
  }

  handlers(): NodeHandlers {
    return {
      onDown: e => { if (skipBubble(e)) return; this.physics.dragStart(e.t); this.lastPos = this.posOf(e); },
      onMove: e => {
        if (skipBubble(e)) return;
        const p = this.posOf(e);
        this.physics.dragBy(p - this.lastPos, e.t);
        this.lastPos = p;
        this.requireEnv().invalidate();
      },
      onUp: e => { if (skipBubble(e)) return; this.physics.dragEnd(); this.requireEnv().invalidate(); },
    };
  }

  onInputCancel(): void {
    this.physics.dragEnd();
    this.requireEnv().invalidate();
  }

  step(dt: number): void {
    if (this.physics.step(dt)) this.requireEnv().invalidate();
    this.content.step(dt);
  }

  sync(box: LayoutBox, ctx: PaintCtx): void {
    if (box.scroll) this.physics.setBounds(box.scroll.content, box.scroll.viewport);
    const clip = box.clip;
    if (clip) {
      const key = `${clip.x}|${clip.y}|${clip.w}|${clip.h}`;
      if (key !== this.clipRectKey) { this.clipRectKey = key; this.clipPlanes = planesForRect(clip); }
    }
    const childCtx: PaintCtx = { order: ctx.order, clip: clip ? [...ctx.clip, ...this.clipPlanes] : ctx.clip };
    const cb = box.children[0];
    if (cb) this.content.sync(cb, childCtx);
  }

  visit(fn: (w: Widget) => void): void { fn(this); this.content.visit(fn); }

  override applyVisible(v: boolean): void {
    super.applyVisible(v);
    this.content.applyVisible(v && this.content.visible);
  }

  pixelRatioChanged(): void { this.content.pixelRatioChanged(); }

  dispose(): void { this.content.dispose(); }
}
