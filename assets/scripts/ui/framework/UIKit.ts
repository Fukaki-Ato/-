import { BlockInputEvents, Button, Color, Graphics, Label, Layers, Layout, Mask, Node, ScrollView, Size, UIOpacity, UITransform, Widget } from 'cc';
import { applySprite, ApplySpriteOptions, loadSprite } from './Assets';
import { AudioService } from './AudioService';
import { Theme } from './Theme';

// ---------------------------------------------------------------------------
// 基础工厂
// ---------------------------------------------------------------------------

export interface NodeSize {
  width: number;
  height: number;
}

export interface NodeOptions {
  parent?: Node | null;
  /** 宽度/高度；传 number 表示正方形。 */
  size?: NodeSize | number;
  anchor?: [number, number];
  position?: [number, number];
  active?: boolean;
}

export function toSize(size?: NodeSize | number): NodeSize | null {
  if (size === undefined) return null;
  if (typeof size === 'number') return { width: size, height: size };
  return { width: size.width, height: size.height };
}

/** 创建带 UITransform 的空节点；size 缺省为 100×100 以避免 0 尺寸占位问题。 */
export function node(name: string, opts: NodeOptions = {}): Node {
  const result = new Node(name);
  // 纯代码节点默认在 DEFAULT 层，不会被 UI 相机渲染；统一归入 UI_2D。
  result.layer = Layers.Enum.UI_2D;
  const ui = result.addComponent(UITransform);
  const size = toSize(opts.size) ?? { width: 100, height: 100 };
  ui.setContentSize(size.width, size.height);
  if (opts.anchor) ui.setAnchorPoint(opts.anchor[0], opts.anchor[1]);
  if (opts.position) result.setPosition(opts.position[0], opts.position[1], 0);
  if (opts.active === false) result.active = false;
  if (opts.parent) opts.parent.addChild(result);
  return result;
}

/** 给节点添加四边拉伸 Widget（自适应父级尺寸），返回该节点。 */
export function stretch(target: Node, margin = 0): Node {
  const widget = target.getComponent(Widget) ?? target.addComponent(Widget);
  widget.isAlignTop = true;
  widget.isAlignBottom = true;
  widget.isAlignLeft = true;
  widget.isAlignRight = true;
  widget.top = margin;
  widget.bottom = margin;
  widget.left = margin;
  widget.right = margin;
  widget.alignMode = Widget.AlignMode.ALWAYS;
  return target;
}

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

export type TextAlign = 'left' | 'center' | 'right';
export type TextVAlign = 'top' | 'center' | 'bottom';

export interface LabelOptions extends NodeOptions {
  fontSize?: number;
  color?: Color;
  bold?: boolean;
  align?: TextAlign;
  valign?: TextVAlign;
  lineHeight?: number;
  /** 给定最大宽度即开启自动换行 + CLAMP，防长文本溢出。 */
  maxWidth?: number;
  overflow?: 'none' | 'clamp' | 'shrink';
  wrap?: boolean;
  outline?: { color: Color; width: number };
}

export function label(text: string, opts: LabelOptions = {}): Node {
  const result = node('Label', opts);
  const comp = result.addComponent(Label);
  const fontSize = opts.fontSize ?? Theme.fontSize.body;
  comp.string = text;
  comp.fontSize = fontSize;
  comp.lineHeight = opts.lineHeight ?? Math.round(fontSize * 1.25);
  comp.color = opts.color ?? Theme.color.text;
  comp.isBold = opts.bold ?? false;
  comp.horizontalAlign = opts.align === 'left' ? Label.HorizontalAlign.LEFT : opts.align === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER;
  comp.verticalAlign = opts.valign === 'top' ? Label.VerticalAlign.TOP : opts.valign === 'bottom' ? Label.VerticalAlign.BOTTOM : Label.VerticalAlign.CENTER;
  const overflow = opts.overflow ?? (opts.maxWidth !== undefined ? 'clamp' : 'none');
  comp.overflow = overflow === 'shrink' ? Label.Overflow.SHRINK : overflow === 'clamp' ? Label.Overflow.CLAMP : Label.Overflow.NONE;
  comp.enableWrapText = opts.wrap ?? (opts.maxWidth !== undefined && overflow === 'clamp');
  if (opts.outline) {
    comp.enableOutline = true;
    comp.outlineColor = opts.outline.color;
    comp.outlineWidth = opts.outline.width;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'green' | 'ghost' | 'danger';

export interface ButtonOptions extends NodeOptions {
  text?: string;
  variant?: ButtonVariant;
  icon?: string;
  fontSize?: number;
  textColor?: Color;
  radius?: number;
  /** 点击音效路径；false 关闭默认音效。 */
  sound?: string | false;
  onClick?: () => void;
}

export interface ButtonView {
  readonly node: Node;
  readonly content: Node;
  readonly button: Button;
  readonly label: Label | null;
  setText(text: string): void;
  setInteractable(value: boolean): void;
  onClick(cb: () => void): void;
  offClick(cb?: () => void): void;
}

function variantPath(variant: ButtonVariant): string {
  if (variant === 'secondary') return Theme.assets.btnSecondary;
  if (variant === 'green') return Theme.assets.btnGreen;
  return Theme.assets.btnPrimary;
}

function variantColor(variant: ButtonVariant): Color {
  if (variant === 'secondary') return Theme.color.btnSecondary;
  if (variant === 'green') return Theme.color.btnGreen;
  if (variant === 'danger') return Theme.color.btnDanger;
  return Theme.color.btnPrimary;
}

export function button(opts: ButtonOptions = {}): ButtonView {
  const size = toSize(opts.size) ?? { width: 240, height: 88 };
  const variant = opts.variant ?? 'primary';
  const root = node('Button', { ...opts, size });
  const content = node('content', { parent: root, size });
  const opacity = content.addComponent(UIOpacity);

  if (variant === 'ghost') {
    const g = content.addComponent(Graphics);
    g.strokeColor = Theme.color.border;
    g.lineWidth = 2;
    const r = Math.min(opts.radius ?? Theme.radius.md, Math.min(size.width, size.height) / 2);
    g.roundRect(-size.width / 2, -size.height / 2, size.width, size.height, r);
    g.stroke();
  } else if (variant !== 'danger') {
    applySprite(content, variantPath(variant), { size, radius: opts.radius ?? Theme.radius.md, color: variantColor(variant) });
  } else {
    applySprite(content, '', { size, radius: opts.radius ?? Theme.radius.md, color: Theme.color.btnDanger });
  }

  let labelComp: Label | null = null;
  const pad = Math.max(12, Math.round(size.height * 0.22));
  const textColor = opts.textColor ?? (variant === 'secondary' ? Theme.color.text : Theme.color.textOnDark);
  const iconW = opts.icon ? Math.round(size.height * 0.55) : 0;
  if (opts.icon) {
    const iconNode = node('icon', { parent: content, size: { width: iconW, height: iconW }, position: [-size.width / 2 + pad + iconW / 2, 0] });
    applySprite(iconNode, opts.icon, { size: { width: iconW, height: iconW }, radius: Theme.radius.sm, placeholderText: (opts.text ?? '').slice(0, 1) });
  }
  if (opts.text !== undefined) {
    const textWidth = opts.icon ? size.width - pad * 3 - iconW : size.width - pad * 2;
    const textX = opts.icon ? pad + iconW + textWidth / 2 - size.width / 2 + pad / 2 : 0;
    const textNode = label(opts.text, {
      parent: content,
      size: { width: textWidth, height: size.height },
      fontSize: opts.fontSize ?? Theme.fontSize.button,
      color: textColor,
      align: opts.icon ? 'left' : 'center',
      overflow: 'shrink',
      position: [textX, 0],
    });
    labelComp = textNode.getComponent(Label);
  }

  const buttonComp = root.addComponent(Button);
  buttonComp.transition = Button.Transition.SCALE;
  buttonComp.target = content;
  buttonComp.zoomScale = 0.92;
  buttonComp.duration = 0.08;

  const sound = opts.sound === undefined ? Theme.assets.sfxClick : opts.sound;
  // 音效独立注册：后续通过 view.onClick 追加的回调同样带默认点击音。
  root.on(Button.EventType.CLICK, () => {
    if (sound !== false) AudioService.playSfx(sound);
  });
  if (opts.onClick) root.on(Button.EventType.CLICK, opts.onClick);

  const view: ButtonView = {
    node: root,
    content,
    button: buttonComp,
    get label() {
      return labelComp;
    },
    setText(text: string): void {
      if (labelComp) labelComp.string = text;
    },
    setInteractable(value: boolean): void {
      buttonComp.interactable = value;
      opacity.opacity = value ? 255 : 120;
    },
    onClick(cb: () => void): void {
      root.on(Button.EventType.CLICK, cb);
    },
    offClick(cb?: () => void): void {
      if (cb) root.off(Button.EventType.CLICK, cb);
      else root.off(Button.EventType.CLICK);
    },
  };
  return view;
}

// ---------------------------------------------------------------------------
// Sprite / 面板底 / 遮罩
// ---------------------------------------------------------------------------

export interface SpriteOptions extends NodeOptions {
  radius?: number;
  color?: Color;
  placeholderText?: string;
  textColor?: Color;
  sizeMode?: 'custom' | 'raw';
}

export function sprite(path: string, opts: SpriteOptions = {}): Node {
  const result = node('Sprite', opts);
  const baseSize = toSize(opts.size);
  const applyOpts: ApplySpriteOptions = {
    size: baseSize ?? undefined,
    radius: opts.radius,
    color: opts.color,
    placeholderText: opts.placeholderText,
    textColor: opts.textColor,
    sizeMode: opts.sizeMode,
  };
  applySprite(result, path, applyOpts);
  return result;
}

export interface PanelBgOptions {
  parent?: Node | null;
  size?: NodeSize | number;
  color?: Color;
  radius?: number;
}

/** 通用面板底：panel_common 素材，缺失时圆角色块。 */
export function panelBg(opts: PanelBgOptions = {}): Node {
  const size = toSize(opts.size) ?? { width: 690, height: 1080 };
  const result = node('PanelBg', { parent: opts.parent, size });
  applySprite(result, Theme.assets.panelCommon, { size, radius: opts.radius ?? Theme.radius.lg, color: opts.color ?? Theme.color.panel });
  return result;
}

export interface OverlayOptions {
  parent?: Node | null;
  color?: Color;
  block?: boolean;
}

/** 全屏遮罩：默认半透明 + BlockInputEvents（按父节点当前尺寸取最大，兼容超高屏）。 */
export function overlay(opts: OverlayOptions = {}): Node {
  const parentUi = opts.parent?.getComponent(UITransform);
  const width = Math.max(Theme.size.designWidth, parentUi?.width ?? 0);
  const height = Math.max(Theme.size.designHeight, parentUi?.height ?? 0);
  const result = node('Overlay', { parent: opts.parent, size: { width, height } });
  const g = result.addComponent(Graphics);
  g.fillColor = opts.color ?? Theme.color.overlay;
  g.fillRect(-width / 2, -height / 2, width, height);
  g.fill();
  if (opts.block !== false) result.addComponent(BlockInputEvents);
  return result;
}

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

export interface ProgressBarOptions {
  parent?: Node | null;
  width: number;
  height?: number;
  trackColor?: Color;
  fillColor?: Color;
  position?: [number, number];
}

export interface ProgressBarView {
  readonly node: Node;
  readonly track: Node;
  readonly fill: Node;
  setProgress(value: number): void;
}

export function progressBar(opts: ProgressBarOptions): ProgressBarView {
  const height = opts.height ?? 24;
  const root = node('ProgressBar', { parent: opts.parent, size: { width: opts.width, height }, position: opts.position });
  const track = node('track', { parent: root, size: { width: opts.width, height } });
  applySprite(track, Theme.assets.progressBg, { size: { width: opts.width, height }, radius: height / 2, color: opts.trackColor ?? Theme.color.track });
  const innerW = Math.max(1, opts.width - 6);
  const innerH = Math.max(1, height - 6);
  const fill = node('fill', { parent: track, size: { width: innerW, height: innerH }, anchor: [0, 0.5], position: [-opts.width / 2 + 3, 0] });
  const fillHandle = applySprite(fill, Theme.assets.progressFill, { size: { width: innerW, height: innerH }, radius: innerH / 2, color: opts.fillColor ?? Theme.color.gold });
  const view: ProgressBarView = {
    node: root,
    track,
    fill,
    setProgress(value: number): void {
      const p = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
      fill.active = p > 0;
      fillHandle.setSize(Math.max(1, innerW * p), innerH);
    },
  };
  view.setProgress(0);
  return view;
}

// ---------------------------------------------------------------------------
// Toggle / Tabs
// ---------------------------------------------------------------------------

export interface ToggleOptions {
  parent?: Node | null;
  label?: string;
  value?: boolean;
  onChange?: (value: boolean) => void;
  width?: number;
  labelWidth?: number;
}

export interface ToggleView {
  readonly node: Node;
  readonly value: boolean;
  setValue(value: boolean, notify?: boolean): void;
}

export function toggle(opts: ToggleOptions = {}): ToggleView {
  const width = opts.width ?? 320;
  const height = 64;
  const root = node('Toggle', { parent: opts.parent, size: { width, height } });
  if (opts.label) {
    label(opts.label, {
      parent: root,
      size: { width: opts.labelWidth ?? width - 130, height },
      anchor: [0, 0.5],
      position: [-width / 2 + 8, 0],
      align: 'left',
      fontSize: Theme.fontSize.body,
    });
  }
  const switchW = 104;
  const switchH = 54;
  const switchNode = node('switch', { parent: root, size: { width: switchW, height: switchH }, position: [width / 2 - switchW / 2, 0] });
  const switchBg = switchNode.addComponent(Graphics);
  const knob = node('knob', { parent: switchNode, size: { width: 42, height: 42 } });
  const knobBg = knob.addComponent(Graphics);
  let value = opts.value ?? false;

  const draw = (): void => {
    switchBg.clear();
    switchBg.fillColor = value ? Theme.color.btnGreen : Theme.color.textDisabled;
    switchBg.roundRect(-switchW / 2, -switchH / 2, switchW, switchH, switchH / 2);
    switchBg.fill();
    knob.setPosition(value ? switchW / 2 - switchH / 2 : -switchW / 2 + switchH / 2, 0, 0);
    knobBg.clear();
    knobBg.fillColor = Theme.color.white;
    knobBg.circle(0, 0, 21);
    knobBg.fill();
  };
  draw();

  const apply = (next: boolean, notify: boolean): void => {
    if (next === value) return;
    value = next;
    draw();
    if (notify) opts.onChange?.(value);
  };

  const buttonComp = root.addComponent(Button);
  buttonComp.transition = Button.Transition.NONE;
  root.on(Button.EventType.CLICK, () => {
    AudioService.playSfx(Theme.assets.sfxClick);
    apply(!value, true);
  });

  return {
    node: root,
    get value() {
      return value;
    },
    setValue(next: boolean, notify = false): void {
      apply(next, notify);
    },
  };
}

export interface TabItem {
  text: string;
  icon?: string;
}

export interface TabsOptions {
  parent?: Node | null;
  items: Array<string | TabItem>;
  index?: number;
  onChange?: (index: number) => void;
  width?: number;
  height?: number;
  gap?: number;
  position?: [number, number];
}

export interface TabsView {
  readonly node: Node;
  readonly activeIndex: number;
  setActive(index: number, notify?: boolean): void;
}

export function tabs(opts: TabsOptions): TabsView {
  const width = opts.width ?? 690;
  const height = opts.height ?? 76;
  const gap = opts.gap ?? 8;
  const items: TabItem[] = opts.items.map((item) => (typeof item === 'string' ? { text: item } : item));
  const root = node('Tabs', { parent: opts.parent, size: { width, height }, position: opts.position });
  const tabW = items.length > 0 ? (width - gap * (items.length - 1)) / items.length : width;
  let active = Math.max(0, Math.min(items.length - 1, opts.index ?? 0));
  const activeBgs: Node[] = [];
  const normalBgs: Node[] = [];
  const texts: Label[] = [];

  items.forEach((item, i) => {
    const tabNode = node(`tab_${i}`, {
      parent: root,
      size: { width: tabW, height },
      position: [-width / 2 + i * (tabW + gap) + tabW / 2, 0],
    });
    // 两套底色子节点切换，素材缺失时用不同占位色，素材就位后自动显示 tab_active/tab_normal。
    const activeBg = node('bg_active', { parent: tabNode, size: { width: tabW, height } });
    applySprite(activeBg, Theme.assets.tabActive, { size: { width: tabW, height }, radius: Theme.radius.md, color: Theme.color.skyBlue });
    const normalBg = node('bg_normal', { parent: tabNode, size: { width: tabW, height } });
    applySprite(normalBg, Theme.assets.tabNormal, { size: { width: tabW, height }, radius: Theme.radius.md, color: Theme.color.panelDeep });
    activeBgs.push(activeBg);
    normalBgs.push(normalBg);
    const textNode = label(item.text, {
      parent: tabNode,
      size: { width: tabW - 12, height },
      fontSize: Theme.fontSize.small,
      align: 'center',
      overflow: 'shrink',
    });
    texts.push(textNode.getComponent(Label)!);
    tabNode.addComponent(Button);
    tabNode.on(Button.EventType.CLICK, () => view.setActive(i, true));
  });

  const refresh = (): void => {
    activeBgs.forEach((bg, i) => {
      const on = i === active;
      bg.active = on;
      if (normalBgs[i]) normalBgs[i].active = !on;
      texts[i].color = on ? Theme.color.textOnDark : Theme.color.textSub;
    });
  };
  refresh();

  const view: TabsView = {
    node: root,
    get activeIndex() {
      return active;
    },
    setActive(index: number, notify = false): void {
      const next = Math.max(0, Math.min(items.length - 1, index));
      if (next === active) return;
      active = next;
      AudioService.playSfx(Theme.assets.sfxClick);
      refresh();
      if (notify) opts.onChange?.(active);
    },
  };
  return view;
}

// ---------------------------------------------------------------------------
// Grid / ScrollView / Divider
// ---------------------------------------------------------------------------

export interface GridOptions extends NodeOptions {
  cellWidth: number;
  cellHeight: number;
  columns: number;
  gapX?: number;
  gapY?: number;
  padding?: number;
}

export interface GridView {
  readonly node: Node;
  readonly layout: Layout;
}

export function grid(opts: GridOptions): GridView {
  const root = node('Grid', opts);
  const layoutComp = root.addComponent(Layout);
  layoutComp.type = Layout.Type.GRID;
  layoutComp.resizeMode = Layout.ResizeMode.CONTAINER;
  layoutComp.cellSize = new Size(opts.cellWidth, opts.cellHeight);
  layoutComp.startAxis = Layout.AxisDirection.HORIZONTAL;
  layoutComp.spacingX = opts.gapX ?? 16;
  layoutComp.spacingY = opts.gapY ?? 16;
  layoutComp.paddingLeft = opts.padding ?? 0;
  layoutComp.paddingRight = opts.padding ?? 0;
  layoutComp.paddingTop = opts.padding ?? 0;
  layoutComp.paddingBottom = opts.padding ?? 0;
  return { node: root, layout: layoutComp };
}

export interface ScrollViewOptions {
  parent?: Node | null;
  width: number;
  height: number;
  vertical?: boolean;
  horizontal?: boolean;
  position?: [number, number];
}

export interface ScrollViewView {
  readonly node: Node;
  readonly view: Node;
  readonly content: Node;
  readonly scrollView: ScrollView;
}

export function scrollView(opts: ScrollViewOptions): ScrollViewView {
  const root = node('ScrollView', { parent: opts.parent, size: { width: opts.width, height: opts.height }, position: opts.position });
  const viewNode = node('view', { parent: root, size: { width: opts.width, height: opts.height } });
  viewNode.addComponent(Mask);
  const content = node('content', { parent: viewNode, size: { width: opts.width, height: opts.height }, anchor: [0.5, 1], position: [0, opts.height / 2] });
  const scroll = root.addComponent(ScrollView);
  // ScrollView.view 为只读派生属性（取 content.parent），结构固定为 root > view(Mask) > content。
  scroll.content = content;
  scroll.vertical = opts.vertical ?? true;
  scroll.horizontal = opts.horizontal ?? false;
  scroll.brake = 0.6;
  return { node: root, view: viewNode, content, scrollView: scroll };
}

export interface DividerOptions {
  parent?: Node | null;
  width: number;
  color?: Color;
  thickness?: number;
  position?: [number, number];
}

export function divider(opts: DividerOptions): Node {
  const thickness = opts.thickness ?? 2;
  const root = node('Divider', { parent: opts.parent, size: { width: opts.width, height: thickness }, position: opts.position });
  const g = root.addComponent(Graphics);
  g.fillColor = opts.color ?? Theme.color.border;
  g.fillRect(-opts.width / 2, -thickness / 2, opts.width, thickness);
  g.fill();
  return root;
}

/** 预加载一组图片（失败仅告警一次，不阻塞）。 */
export function preloadSprites(paths: readonly string[]): void {
  for (const path of paths) loadSprite(path);
}

export const UIKit = {
  node,
  label,
  button,
  sprite,
  panelBg,
  overlay,
  progressBar,
  toggle,
  tabs,
  grid,
  scrollView,
  divider,
  stretch,
  preloadSprites,
};
