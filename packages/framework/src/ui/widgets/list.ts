/**
 * List：虚拟化滚动列表（S13 computeVirtualWindow 的控件化）。
 * 只构建窗口内条目控件（overscan 预渲染），滚动时按槽位回收复用：
 *   updateItem 提供 → 原地更新；未提供 → dispose+buildItem 重建。
 * 布局技巧：node() 的 scrollOffset = physics.offset - window.leading，
 * 使布局引擎把首槽摆在正确内容偏移上；滚动度量（content/viewport）不取布局回报，
 * 而由 spec（itemCount×itemExtent+gap）计算——窗口化后布局只见可见项，回报值不可用。
 * 需要确定高度：height/flex/父 stretch 三选一（auto 高度会塌成 0，见 API.md）。
 */
import type { EdgesInput, Length, LayoutBox, LayoutNode } from '../types.js';
import { skipBubble, Widget } from '../widget.js';
import type { PaintCtx } from '../paint.js';
import { ScrollPhysics, type ScrollFeel } from '../scroll.js';
import type { NodeHandlers } from '../router.js';
import { computeVirtualWindow, contentExtentOf, type VirtualListSpec, type VirtualWindow } from '../virtualList.js';
import { planesForRect } from '../render/clip.js';
import type * as THREE from 'three';

export interface ListOptions {
  itemCount: number;
  /** 条目滚动轴尺寸 px */
  itemExtent: number;
  gap?: number;
  axis?: 'x' | 'y';
  overscan?: number;
  buildItem(index: number): Widget;
  /** 槽位复用时的原地更新（强烈建议提供，否则滚动中逐条重建） */
  updateItem?(item: Widget, index: number): void;
  onSelect?(index: number): void;
  feel?: Partial<ScrollFeel>;
  width?: Length;
  height?: Length;
  flex?: number;
  padding?: EdgesInput;
  margin?: EdgesInput;
}

const EMPTY_WINDOW: VirtualWindow = { start: 0, end: 0, count: 0, leading: 0, contentExtent: 0, maxOffset: 0 };

export class List extends Widget {
  /** 滚动物理（onBind 时按 UiConfig/feel 覆盖重建） */
  physics!: ScrollPhysics;
  private opts: ListOptions;
  private slots: { index: number; widget: Widget }[] = [];
  private win: VirtualWindow = EMPTY_WINDOW;
  private viewportEstimate: number;
  private lastBox: LayoutBox | null = null;
  private lastPos = 0;
  private clipRectKey = '';
  private clipPlanes: THREE.Plane[] = [];

  constructor(opts: ListOptions) {
    super();
    this.opts = opts;
    this.physics = new ScrollPhysics({ content: 0, viewport: 0 });
    this.viewportEstimate = typeof opts.height === 'number' ? Math.max(0, opts.height) : 0;
  }

  protected get kind(): string { return 'list'; }

  protected onBind(): void {
    const feel = this.opts.feel ?? this.requireEnv().config.scroll;
    this.physics = new ScrollPhysics({ content: 0, viewport: 0, feel, offset: this.physics.offset });
  }

  setItemCount(n: number): void {
    if (n === this.opts.itemCount) return;
    this.opts.itemCount = Math.max(0, n);
    this.requireEnv().invalidate();
  }

  /** 最近一次对账的虚拟窗口（调试/测试断言用） */
  get visibleWindow(): VirtualWindow { return this.win; }

  /** 当前槽位绑定的数据下标（测试/调试用） */
  get slotIndices(): number[] { return this.slots.map(s => s.index); }

  private axis(): 'x' | 'y' { return this.opts.axis ?? 'y'; }

  private spec(viewportExtent: number): VirtualListSpec {
    return {
      itemCount: this.opts.itemCount,
      itemExtent: this.opts.itemExtent,
      gap: this.opts.gap,
      viewportExtent,
      overscan: this.opts.overscan,
    };
  }

  /** 窗口对账：槽位数量与 index 绑定（node() 前调用，children 与槽位一一对应） */
  private reconcile(win: VirtualWindow): void {
    const env = this.requireEnv();
    while (this.slots.length > win.count) {
      const s = this.slots.pop()!;
      env.detachHandlers(s.widget);
      s.widget.dispose();
    }
    while (this.slots.length < win.count) {
      const index = win.start + this.slots.length;
      const widget = this.opts.buildItem(index);
      widget.bind(env);
      env.attachHandlers(widget);
      this.slots.push({ index, widget });
    }
    for (let k = 0; k < win.count; k++) {
      const want = win.start + k;
      const slot = this.slots[k]!;
      if (slot.index === want) continue;
      slot.index = want;
      if (this.opts.updateItem) this.opts.updateItem(slot.widget, want);
      else {
        env.detachHandlers(slot.widget);
        slot.widget.dispose();
        const widget = this.opts.buildItem(want);
        widget.bind(env);
        env.attachHandlers(widget);
        this.slots[k] = { index: want, widget };
      }
    }
    this.win = win;
  }

  node(): LayoutNode {
    const win = computeVirtualWindow(this.spec(this.viewportEstimate), this.physics.offset);
    this.reconcile(win);
    const vertical = this.axis() === 'y';
    const o = this.opts;
    return {
      id: this.id,
      scroll: this.axis(),
      direction: vertical ? 'column' : 'row',
      gap: o.gap,
      // 首槽摆在 leading-offset 处（布局引擎对子项整体 -scrollOffset）
      scrollOffset: this.physics.offset - win.leading,
      width: o.width, height: o.height, flex: o.flex, padding: o.padding, margin: o.margin,
      children: this.slots.map(s => (vertical
        ? { height: o.itemExtent, children: [s.widget.node()] }
        : { width: o.itemExtent, children: [s.widget.node()] })),
    };
  }

  handlers(): NodeHandlers {
    return {
      onDown: e => { if (skipBubble(e)) return; this.physics.dragStart(e.t); this.lastPos = this.axis() === 'y' ? e.y : e.x; },
      onMove: e => {
        if (skipBubble(e)) return;
        const p = this.axis() === 'y' ? e.y : e.x;
        this.physics.dragBy(p - this.lastPos, e.t);
        this.lastPos = p;
        this.requireEnv().invalidate();
      },
      onUp: e => { if (skipBubble(e)) return; this.physics.dragEnd(); this.requireEnv().invalidate(); },
      onClick: e => {
        if (skipBubble(e)) return;
        const box = this.lastBox;
        if (!box || !this.opts.onSelect) return;
        const cr = box.contentRect;
        const pos = (this.axis() === 'y' ? e.y - cr.y : e.x - cr.x) + this.physics.offset;
        const pitch = Math.max(1, this.opts.itemExtent + Math.max(0, this.opts.gap ?? 0));
        const i = Math.floor(pos / pitch);
        if (i >= 0 && i < this.opts.itemCount && pos - i * pitch <= this.opts.itemExtent) this.opts.onSelect(i);
      },
    };
  }

  onInputCancel(): void {
    this.physics.dragEnd();
    this.requireEnv().invalidate();
  }

  step(dt: number): void {
    if (this.physics.step(dt)) this.requireEnv().invalidate();
    for (const s of this.slots) s.widget.step(dt);
  }

  sync(box: LayoutBox, ctx: PaintCtx): void {
    this.lastBox = box;
    const vp = box.scroll?.viewport ?? 0;
    this.physics.setBounds(contentExtentOf(this.spec(vp)), vp);
    if (vp !== this.viewportEstimate) { this.viewportEstimate = vp; this.requireEnv().invalidate(); }
    const clip = box.clip;
    if (clip) {
      const key = `${clip.x}|${clip.y}|${clip.w}|${clip.h}`;
      if (key !== this.clipRectKey) { this.clipRectKey = key; this.clipPlanes = planesForRect(clip); }
    }
    const childCtx: PaintCtx = { order: ctx.order, clip: clip ? [...ctx.clip, ...this.clipPlanes] : ctx.clip };
    box.children.forEach((wrapper, i) => {
      const itemBox = wrapper.children[0] ?? wrapper;
      const slot = this.slots[i];
      if (slot) slot.widget.sync(itemBox, childCtx);
    });
  }

  visit(fn: (w: Widget) => void): void {
    fn(this);
    for (const s of this.slots) s.widget.visit(fn);
  }

  override applyVisible(v: boolean): void {
    super.applyVisible(v);
    for (const s of this.slots) s.widget.applyVisible(v && s.widget.visible);
  }

  pixelRatioChanged(): void { for (const s of this.slots) s.widget.pixelRatioChanged(); }

  dispose(): void {
    for (const s of this.slots) s.widget.dispose();
    this.slots = [];
  }
}
