/**
 * Box：通用容器控件（flex 子集规格直通 S13 LayoutNode），可选九宫格背景。
 * Panel = 默认带 panel 皮肤的 Box（widgets/panel.ts）。
 * 子控件顺序 = 绘制顺序（画家算法，renderOrder 按 sync 遍历序分配）。
 */
import type { EdgesInput, Length, LayoutBox, LayoutNode } from '../types.js';
import type { Align, Direction, Justify } from '../types.js';
import { Widget, type WidgetEnv } from '../widget.js';
import { skipBubble } from '../widget.js';
import type { NodeHandlers } from '../router.js';
import type { PaintCtx } from '../paint.js';
import { NinePatchSprite, type NinePatchSource } from '../render/ninePatch.js';
import type { SkinKey } from '../theme.js';

export interface BoxOptions {
  direction?: Direction;
  align?: Align;
  justify?: Justify;
  gap?: number;
  padding?: EdgesInput;
  margin?: EdgesInput;
  width?: Length;
  height?: Length;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  flex?: number;
  /** true=自身不作为命中目标（全屏底板），子项仍可命中 */
  passthrough?: boolean;
  /**
   * true=脱离常规流，按 top/left（或 right/bottom）相对父内容盒定位；不占父主轴空间，
   * 且总是绘制在常规子项之上、命中优先。半屏弹层与全屏点击捕获层用它。
   */
  absolute?: boolean;
  /** 绝对定位偏移 px，仅 absolute 为真时消费 */
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  /** 九宫格背景：主题皮肤键 / 自定义源 / null（无背景） */
  background?: SkinKey | NinePatchSource | null;
  /** 背景乘色（默认白=皮肤原色） */
  backgroundColor?: string;
  backgroundOpacity?: number;
  onClick?: () => void;
}

export class Box extends Widget {
  readonly children: Widget[] = [];
  protected opts: BoxOptions;
  protected bg: NinePatchSprite | null = null;
  /** node() 时的可见子集（sync 与 box.children 按下标对齐） */
  protected laidOut: Widget[] = [];

  constructor(opts: BoxOptions = {}, children: Widget[] = []) {
    super();
    this.opts = opts;
    for (const c of children) this.children.push(c);
  }

  protected get kind(): string { return 'box'; }

  bind(env: WidgetEnv): void {
    super.bind(env);
    for (const c of this.children) c.bind(env);
    this.applyVisible(this.visible); // 子树绑定完成后统一落地初始可见性
  }

  protected onBind(): void {
    const env = this.requireEnv();
    const bgOpt = this.opts.background ?? this.defaultBackground();
    if (bgOpt == null) return;
    const src = typeof bgOpt === 'string' ? env.theme.skins[bgOpt] : bgOpt;
    this.bg = new NinePatchSprite(src, { color: this.opts.backgroundColor, opacity: this.opts.backgroundOpacity });
    this.bg.mesh.visible = this.visible; // 构造期置 false 的初始可见性在网格创建时落地
    env.stage.add(this.bg.mesh);
  }

  /** Panel 子类覆盖：默认皮肤键 */
  protected defaultBackground(): SkinKey | NinePatchSource | null | undefined {
    return this.opts.background;
  }

  add(...ws: Widget[]): this {
    for (const w of ws) {
      this.children.push(w);
      if (this.env) { w.bind(this.env); this.env.attachHandlers(w); }
    }
    this.env?.invalidate();
    return this;
  }

  remove(w: Widget): boolean {
    const i = this.children.indexOf(w);
    if (i < 0) return false;
    this.children.splice(i, 1);
    this.env?.detachHandlers(w);
    w.dispose();
    this.env?.invalidate();
    return true;
  }

  /**
   * 就地改背景乘色/不透明度（不重建控件 ⇒ 不打断命中注册与按压态机）。
   * 供「同一张贴图靠明暗表达可用性」用：亮态白乘色全不透明，暗态压暗乘色并降透明度。
   * 皮肤是自定义源时才生效（主题皮肤键由 onBind 解析，改了也不会重解析）。
   */
  setBackground(v: { color?: string; opacity?: number }): void {
    const bg = this.opts.background;
    if (typeof bg !== 'object' || bg === null) return;
    this.opts.backgroundColor = v.color ?? this.opts.backgroundColor;
    this.opts.backgroundOpacity = v.opacity ?? this.opts.backgroundOpacity;
    this.bg?.setColor(this.opts.backgroundColor ?? '#ffffff');
    this.bg?.setOpacity(this.opts.backgroundOpacity ?? 1);
  }

  node(): LayoutNode {
    const o = this.opts;
    const vis = this.children.filter(c => c.visible);
    const kidNodes = vis.map(c => c.node());
    // 产出顺序必须与 layout.arrange 一致（常规子项在前、绝对子项在后），
    // 否则 sync() 里 laidOut[i] 与 box.children[i] 会错位对不上。sort 稳定，组内保序。
    const order = vis.map((_, i) => i)
      .sort((a, b) => (kidNodes[a].absolute ? 1 : 0) - (kidNodes[b].absolute ? 1 : 0));
    this.laidOut = order.map(i => vis[i]);
    return {
      id: this.id,
      direction: o.direction, align: o.align, justify: o.justify, gap: o.gap,
      padding: o.padding, margin: o.margin, width: o.width, height: o.height,
      minWidth: o.minWidth, minHeight: o.minHeight, maxWidth: o.maxWidth, maxHeight: o.maxHeight,
      flex: o.flex, passthrough: o.passthrough,
      absolute: o.absolute, top: o.top, left: o.left, right: o.right, bottom: o.bottom,
      children: order.map(i => kidNodes[i]),
    };
  }

  sync(box: LayoutBox, ctx: PaintCtx): void {
    if (this.bg) this.bg.update(box.rect, ctx);
    const kids = box.children;
    for (let i = 0; i < this.laidOut.length; i++) {
      const cb = kids[i];
      if (cb) this.laidOut[i]!.sync(cb, this.childCtx(box, ctx));
    }
  }

  /** 滚动容器子类覆盖：给子树叠加裁剪面 */
  protected childCtx(_box: LayoutBox, ctx: PaintCtx): PaintCtx { return ctx; }

  override applyVisible(v: boolean): void {
    super.applyVisible(v);
    if (this.bg) this.bg.mesh.visible = v;
    for (const c of this.children) c.applyVisible(v && c.visible);
  }

  handlers(): NodeHandlers | undefined {
    const onClick = this.opts.onClick;
    return onClick ? { onClick: e => { if (!skipBubble(e)) onClick(); } } : undefined;
  }

  step(dt: number): void { for (const c of this.children) c.step(dt); }
  onInputCancel(): void { for (const c of this.children) c.onInputCancel(); }
  visit(fn: (w: Widget) => void): void { fn(this); for (const c of this.children) c.visit(fn); }

  dispose(): void {
    for (const c of this.children) c.dispose();
    if (this.bg) { this.env?.stage.remove(this.bg.mesh); this.bg.dispose(); this.bg = null; }
  }
}
