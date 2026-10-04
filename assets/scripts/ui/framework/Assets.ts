import { AudioClip, Color, Graphics, isValid, Label, Layers, Node, Sprite, SpriteFrame, UITransform, resources } from 'cc';
import { Logger } from '../../core/framework/Logger';
import { Theme } from './Theme';

const log = new Logger();

const spriteCache = new Map<string, SpriteFrame>();
const audioCache = new Map<string, AudioClip>();
const spriteWaiters = new Map<string, Array<(frame: SpriteFrame | null) => void>>();
const audioWaiters = new Map<string, Array<(clip: AudioClip | null) => void>>();
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  log.warn(message);
}

function normalize(path: string | null | undefined): string {
  return typeof path === 'string' ? path.trim() : '';
}

/** 同步读取已缓存图片；未缓存返回 null（不发起加载）。 */
export function getCachedSprite(path: string): SpriteFrame | null {
  return spriteCache.get(normalize(path)) ?? null;
}

/** 按路径加载图片，结果缓存；失败回调 null 且同一路径只 warn 一次，绝不抛出。 */
export function loadSprite(path: string, cb?: (frame: SpriteFrame | null) => void): void {
  const key = normalize(path);
  if (!key) {
    cb?.(null);
    return;
  }
  const cached = spriteCache.get(key);
  if (cached) {
    cb?.(cached);
    return;
  }
  const inFlight = spriteWaiters.get(key);
  if (inFlight) {
    if (cb) inFlight.push(cb);
    return;
  }
  const waiters: Array<(frame: SpriteFrame | null) => void> = [];
  if (cb) waiters.push(cb);
  spriteWaiters.set(key, waiters);
  resources.load(key, SpriteFrame, (err, frame) => {
    const list = spriteWaiters.get(key) ?? [];
    spriteWaiters.delete(key);
    if (err || !frame) {
      warnOnce(`sprite:${key}`, `图片资源缺失，已使用占位降级：${key}`);
      for (const item of list) item(null);
      return;
    }
    spriteCache.set(key, frame);
    for (const item of list) item(frame);
  });
}

/** 按路径加载音频，结果缓存；失败回调 null 且同一路径只 warn 一次，绝不抛出。 */
export function loadAudio(path: string, cb?: (clip: AudioClip | null) => void): void {
  const key = normalize(path);
  if (!key) {
    cb?.(null);
    return;
  }
  const cached = audioCache.get(key);
  if (cached) {
    cb?.(cached);
    return;
  }
  const inFlight = audioWaiters.get(key);
  if (inFlight) {
    if (cb) inFlight.push(cb);
    return;
  }
  const waiters: Array<(clip: AudioClip | null) => void> = [];
  if (cb) waiters.push(cb);
  audioWaiters.set(key, waiters);
  resources.load(key, AudioClip, (err, clip) => {
    const list = audioWaiters.get(key) ?? [];
    audioWaiters.delete(key);
    if (err || !clip) {
      warnOnce(`audio:${key}`, `音频资源缺失，已静默降级：${key}`);
      for (const item of list) item(null);
      return;
    }
    audioCache.set(key, clip);
    for (const item of list) item(clip);
  });
}

/** 清空缓存与告警记录（编辑器热重载/测试用）。 */
export function clearAssetCache(): void {
  spriteCache.clear();
  audioCache.clear();
  spriteWaiters.clear();
  audioWaiters.clear();
  warned.clear();
}

export interface ApplySpriteOptions {
  /** 指定节点尺寸；未指定则沿用节点当前尺寸，为 0 时用 96×96 兜底。 */
  size?: { width: number; height: number };
  /** 占位块圆角，默认 Theme.radius.md。 */
  radius?: number;
  /** 占位块颜色，默认按路径关键词/哈希取色。 */
  color?: Color;
  /** 占位块首字文本（如道具名首字）；不传则只画色块。 */
  placeholderText?: string;
  textColor?: Color;
  /** 图片加载成功后的填充模式，默认：有 size 用 custom，否则按节点尺寸决定。 */
  sizeMode?: 'custom' | 'raw';
}

export interface SpriteHandle {
  readonly node: Node;
  readonly loaded: boolean;
  /** 调整目标尺寸；占位块会同步重绘。 */
  setSize(width: number, height: number): void;
  /** 运行时着色：同时影响占位块与已加载图片的 Sprite.color。 */
  setColor(color: Color): void;
  /** 更新占位块首字。 */
  setPlaceholderText(text: string): void;
  dispose(): void;
}

const DEFAULT_PLACEHOLDER_SIZE = 96;
const PALETTE = [Theme.color.skyBlue, Theme.color.sand, Theme.color.btnGreen, new Color(179, 107, 255, 255), new Color(255, 138, 101, 255)];

/** 依据路径关键词/哈希选择占位色，保证同类图标颜色稳定。 */
export function placeholderColorFor(path: string): Color {
  const p = path.toLowerCase();
  if (p.includes('gold')) return Theme.color.gold;
  if (p.includes('diamond')) return Theme.color.diamond;
  if (p.includes('red')) return Theme.color.red;
  if (p.includes('btn_start')) return Theme.color.sand;
  if (p.includes('btn_primary')) return Theme.color.btnPrimary;
  if (p.includes('btn_secondary')) return Theme.color.btnSecondary;
  if (p.includes('btn_green')) return Theme.color.btnGreen;
  if (p.includes('panel')) return Theme.color.panelDeep;
  let hash = 0;
  for (let i = 0; i < p.length; i += 1) hash = (hash * 31 + p.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

interface PlaceholderState {
  container: Node;
  graphics: Graphics;
  label: Label | null;
  text: string;
}

/**
 * 给节点应用图片：成功时赋 spriteFrame；失败/加载中绘制圆角占位块（可带首字）。
 * 占位块放在子节点上，素材到位后自动移除并显示真实图片。
 */
export function applySprite(node: Node, path: string | null | undefined, opts: ApplySpriteOptions = {}): SpriteHandle {
  const ui = node.getComponent(UITransform) ?? node.addComponent(UITransform);
  const key = normalize(path);
  const nodeHadSize = ui.width > 0 && ui.height > 0;
  const specifiedSize = !!opts.size;
  if (opts.size) ui.setContentSize(opts.size.width, opts.size.height);
  let width = ui.width;
  let height = ui.height;
  if (!(width > 0) || !(height > 0)) {
    width = DEFAULT_PLACEHOLDER_SIZE;
    height = DEFAULT_PLACEHOLDER_SIZE;
  }
  const resolvedSizeMode = opts.sizeMode ?? (specifiedSize || nodeHadSize ? 'custom' : 'raw');

  const sprite = node.getComponent(Sprite) ?? node.addComponent(Sprite);
  sprite.sizeMode = Sprite.SizeMode.CUSTOM;
  // 已有图片的节点不清空显示；加载新图失败时保留原图。
  const hadFrame = sprite.spriteFrame !== null;
  if (!hadFrame) sprite.enabled = false;
  // 重复 applySprite 时清掉旧占位，避免叠加。
  const stalePlaceholder = node.getChildByName('__placeholder');
  if (stalePlaceholder) {
    stalePlaceholder.removeFromParent();
    stalePlaceholder.destroy();
  }

  let placeholder: PlaceholderState | null = null;
  let disposed = false;
  let loaded = false;
  let tint: Color | null = null;

  const drawPlaceholder = (): void => {
    if (!placeholder || !isValid(placeholder.container)) return;
    const phUi = placeholder.container.getComponent(UITransform);
    phUi?.setContentSize(width, height);
    const ax = ui.anchorX;
    const ay = ui.anchorY;
    placeholder.container.setPosition((0.5 - ax) * width, (0.5 - ay) * height, 0);
    const g = placeholder.graphics;
    g.clear();
    g.fillColor = tint ?? opts.color ?? placeholderColorFor(key);
    const radius = Math.min(opts.radius ?? Theme.radius.md, Math.min(width, height) / 2);
    if (radius > 0) g.roundRect(-width / 2, -height / 2, width, height, radius);
    else g.rect(-width / 2, -height / 2, width, height);
    g.fill();
    if (placeholder.label) {
      placeholder.label.string = placeholder.text;
      placeholder.label.fontSize = Math.max(18, Math.round(Math.min(width, height) * 0.42));
    }
  };

  const ensurePlaceholder = (): void => {
    if (placeholder && isValid(placeholder.container)) return;
    const container = new Node('__placeholder');
    container.layer = node.layer;
    node.addChild(container);
    const graphics = container.addComponent(Graphics);
    let label: Label | null = null;
    if (opts.placeholderText) {
      const labelNode = new Node('text');
      labelNode.layer = Layers.Enum.UI_2D;
      container.addChild(labelNode);
      label = labelNode.addComponent(Label);
      label.string = opts.placeholderText;
      label.color = opts.textColor ?? Theme.color.white;
      label.horizontalAlign = Label.HorizontalAlign.CENTER;
      label.verticalAlign = Label.VerticalAlign.CENTER;
      label.overflow = Label.Overflow.SHRINK;
      const labelUi = labelNode.getComponent(UITransform)!;
      labelUi.setContentSize(Math.max(1, width * 0.8), Math.max(1, height * 0.8));
    }
    placeholder = { container, graphics, label, text: opts.placeholderText ?? '' };
    drawPlaceholder();
  };

  if (!hadFrame) ensurePlaceholder();

  const finish = (frame: SpriteFrame | null): void => {
    if (disposed || !isValid(node)) return;
    if (!frame) {
      if (hadFrame) sprite.enabled = true;
      return;
    }
    loaded = true;
    sprite.spriteFrame = frame;
    sprite.sizeMode = resolvedSizeMode === 'raw' ? Sprite.SizeMode.RAW : Sprite.SizeMode.CUSTOM;
    if (tint) sprite.color = tint;
    sprite.enabled = true;
    if (placeholder && isValid(placeholder.container)) placeholder.container.destroy();
    placeholder = null;
  };

  if (key) loadSprite(key, finish);
  return makeHandle();

  function makeHandle(): SpriteHandle {
    return {
      node,
      get loaded() {
        return loaded;
      },
      setSize(w: number, h: number): void {
        width = Math.max(1, w);
        height = Math.max(1, h);
        ui.setContentSize(width, height);
        drawPlaceholder();
      },
      setColor(color: Color): void {
        tint = color;
        if (loaded) sprite.color = color;
        drawPlaceholder();
      },
      setPlaceholderText(text: string): void {
        if (!placeholder) return;
        placeholder.text = text;
        if (!placeholder.label && text && isValid(placeholder.container)) {
          const labelNode = new Node('text');
          labelNode.layer = Layers.Enum.UI_2D;
          placeholder.container.addChild(labelNode);
          const label = labelNode.addComponent(Label);
          label.color = opts.textColor ?? Theme.color.white;
          label.horizontalAlign = Label.HorizontalAlign.CENTER;
          label.verticalAlign = Label.VerticalAlign.CENTER;
          label.overflow = Label.Overflow.SHRINK;
          labelNode.getComponent(UITransform)!.setContentSize(Math.max(1, width * 0.8), Math.max(1, height * 0.8));
          placeholder.label = label;
        }
        drawPlaceholder();
      },
      dispose(): void {
        disposed = true;
        if (placeholder && isValid(placeholder.container)) placeholder.container.destroy();
        placeholder = null;
      },
    };
  }
}
