/**
 * 音量滑条（game 本地控件）：胶囊底轨 + 填充条，点按/拖动取值。
 * 放在 packages/game 而非 framework：framework 公共 API 变更需维护者评审（CONTRIBUTING），
 * 而这是纯展示件——用公开的 Widget 基类 + NinePatchSprite 组合即可，游戏自留。
 * 拖动语义：InputRouter 对 down 锁定的命中路径持续发 move（超过 slop 只取消「按压态」，
 * 不中断 move 分发），因此 onDown/onMove 都按「把 x 换算成 0..1」处理即可覆盖点选与拖动；
 * 取值统一用 e.target.rect（headless 测试只走布局不走 sync，也能算）。
 * 值量化为整数百分比（1% 步进），经 onChange 回传流程；流程拒绝（false）时保持原值。
 * sync 之外的改值（setValue/拖动）只置脏标记 + invalidate，下一帧 step 用缓存的 PaintCtx
 * 重算填充几何——与 ToastChip 同一模式，不在帧间乱建网格。
 */
import type { Texture } from 'three';
import {
  NinePatchSprite, createSkinTexture, skipBubble, Widget,
  type LayoutBox, type LayoutNode, type NodeHandlers, type NinePatchSource, type PaintCtx, type UiEvent,
} from '@tr/framework/ui/index.js';

export interface VolumeSliderOptions {
  /** 轨道宽度 px；flex:true 时忽略宽度、占满主轴剩余空间 */
  width?: number;
  /** 轨道高度 px（默认 12，胶囊圆角＝高度一半） */
  height?: number;
  /** 占满父行剩余空间（与 width 二选一） */
  flex?: boolean;
  /** 初始值 0..1（越界夹回） */
  value: number;
  /** 底轨色（卡片底色上亮一档） */
  trackColor: string;
  /** 填充色（主题强调色，settingsView 传 gold） */
  fillColor: string;
  /** 取值回调（0..1，已按 1% 量化）；返回 false＝流程拒绝，滑条保持原值 */
  onChange(value: number): boolean;
}

const asUnit = (v: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;

export class VolumeSlider extends Widget {
  private opts: VolumeSliderOptions;
  private _value: number;
  private track: NinePatchSprite | null = null;
  private fill: NinePatchSprite | null = null;
  /** 自建皮肤纹理 ×2（底轨/填充）：NinePatchSprite.dispose 不含纹理，由本控件释放 */
  private textures: Texture[] = [];
  private lastRect: LayoutBox['rect'] | null = null;
  private lastCtx: PaintCtx | null = null;
  /** sync 之外改了值，等下一帧 step 重算填充 */
  private dirty = false;

  constructor(opts: VolumeSliderOptions) {
    super();
    this.opts = opts;
    this._value = asUnit(opts.value);
  }

  protected get kind(): string { return 'slider'; }

  protected onBind(): void {
    const env = this.requireEnv();
    const radius = Math.floor((this.opts.height ?? 12) / 2);
    for (const color of [this.opts.trackColor, this.opts.fillColor]) {
      const { texture, insets, sizePx } = createSkinTexture({ fill: '#ffffff', border: null, radiusPx: radius, borderPx: 0, fillAlpha: 1 });
      this.textures.push(texture);
      const src: NinePatchSource = { texture, insets, texSize: { w: sizePx, h: sizePx } };
      const sprite = new NinePatchSprite(src, { color });
      sprite.mesh.visible = this.visible;
      env.stage.add(sprite.mesh);
      if (this.track === null) this.track = sprite; else this.fill = sprite;
    }
  }

  /** 外部同步值（步进按钮/流程拒绝回退后调用）；与当前值相同则空操作 */
  setValue(v: number): void {
    const next = asUnit(v);
    if (next === this._value) return;
    this._value = next;
    this.markDirty();
  }

  get value(): number { return this._value; }

  private markDirty(): void {
    this.dirty = true;
    this.requireEnv().invalidate();
  }

  private applyFill(rect: LayoutBox['rect'], ctx: PaintCtx): void {
    if (!this.fill) return;
    const radius = Math.floor((this.opts.height ?? 12) / 2);
    const show = this._value > 0;
    this.fill.mesh.visible = this.visible && show;
    if (show) this.fill.update({
      x: rect.x + radius + 2,
      y: rect.y + 2,
      w: Math.max(radius * 2, Math.round((rect.w - (radius + 2) * 2) * this._value)),
      h: rect.h - 4,
    }, ctx);
  }

  node(): LayoutNode {
    const o = this.opts;
    return {
      id: this.id,
      ...(o.flex ? { flex: 1 } : { width: o.width ?? 140 }),
      height: o.height ?? 12,
      children: [],
    };
  }

  sync(box: LayoutBox, ctx: PaintCtx): void {
    this.lastRect = box.rect;
    this.lastCtx = ctx;
    this.dirty = false;
    this.track?.update(box.rect, ctx);
    this.applyFill(box.rect, ctx);
  }

  step(_dt: number): void {
    if (!this.dirty || !this.lastRect || !this.lastCtx) return;
    this.dirty = false;
    this.applyFill(this.lastRect, this.lastCtx);
  }

  handlers(): NodeHandlers {
    const pick = (e: UiEvent): void => {
      if (skipBubble(e)) return;
      const r = e.target.rect;
      const q = Math.round(Math.min(1, Math.max(0, (e.x - r.x) / Math.max(1, r.w))) * 100) / 100;
      if (q === this._value) return;
      if (!this.opts.onChange(q)) return; // 流程拒绝：滑条保持原值
      this._value = q;
      this.markDirty();
    };
    return { onDown: pick, onMove: pick };
  }

  override applyVisible(v: boolean): void {
    super.applyVisible(v);
    if (this.track) this.track.mesh.visible = v;
    if (this.fill) this.fill.mesh.visible = v && this._value > 0;
  }

  dispose(): void {
    if (this.track) { this.requireEnv().stage.remove(this.track.mesh); this.track.dispose(); this.track = null; }
    if (this.fill) { this.requireEnv().stage.remove(this.fill.mesh); this.fill.dispose(); this.fill = null; }
    for (const t of this.textures) t.dispose();
    this.textures = [];
  }
}
