/**
 * Button：九宫格底 + 居中 Label，绑定 S13 buttonNext 状态机（normal/pressed/disabled）。
 * 激活语义由 InputRouter 保证（click 仅在 up 落于目标 rect 内时发出），状态机负责三态视觉：
 *   press 开始 → send('down')；slop 取消/移出 → send('cancel')；click → send('up') 且 activated 才回调。
 * 按压反馈 = 底色乘 pressedTint 变暗；禁用 = 整体半透明且吞掉激活。
 */
import type { EdgesInput, Length, LayoutBox, LayoutNode } from '../types.js';
import { containsPoint } from '../types.js';
import { skipBubble, Widget } from '../widget.js';
import type { PaintCtx } from '../paint.js';
import { NinePatchSprite, type NinePatchSource } from '../render/ninePatch.js';
import { createButton, type ButtonMachine } from '../button.js';
import type { NodeHandlers } from '../router.js';
import { Label } from './label.js';

export interface ButtonOptions {
  label?: string;
  fontSizePx?: number;
  /** 默认 theme.colors.text */
  labelColor?: string;
  variant?: 'normal' | 'primary';
  /** 覆盖主题皮肤 */
  skin?: NinePatchSource;
  padding?: EdgesInput;
  width?: Length;
  height?: Length;
  minWidth?: number;
  minHeight?: number;
  disabled?: boolean;
  onClick?: () => void;
}

export class Button extends Widget {
  readonly label: Label;
  readonly machine: ButtonMachine;
  private opts: ButtonOptions;
  private bg: NinePatchSprite | null = null;

  constructor(opts: ButtonOptions = {}) {
    super();
    this.opts = opts;
    this.machine = createButton({ disabled: opts.disabled });
    this.label = new Label({
      text: opts.label ?? '',
      fontSizePx: opts.fontSizePx,
      color: opts.labelColor,
      align: 'center',
    });
  }

  protected get kind(): string { return 'btn'; }

  protected onBind(): void {
    const env = this.requireEnv();
    const src = this.opts.skin ?? env.theme.skins[this.opts.variant === 'primary' ? 'buttonPrimary' : 'button'];
    this.bg = new NinePatchSprite(src);
    this.bg.mesh.visible = this.visible;
    env.stage.add(this.bg.mesh);
    this.label.bind(env);
    this.applyVisual();
  }

  setLabel(text: string): void { this.label.setText(text); }

  setDisabled(disabled: boolean): void {
    const r = this.machine.send(disabled ? 'disable' : 'enable');
    if (r.changed) { this.applyVisual(); this.requireEnv().invalidate(); }
  }

  get state() { return this.machine.state; }

  private applyVisual(): void {
    if (!this.bg || !this.env) return;
    const pressed = this.machine.state === 'pressed';
    const disabled = this.machine.state === 'disabled';
    this.bg.setColor(pressed ? this.env.theme.pressedTint : '#ffffff');
    this.bg.setOpacity(disabled ? 0.45 : 1);
    this.label.setOpacity(disabled ? 0.45 : 1);
  }

  node(): LayoutNode {
    const o = this.opts;
    return {
      id: this.id,
      align: 'center',
      justify: 'center',
      padding: o.padding ?? { top: 10, right: 18, bottom: 10, left: 18 },
      width: o.width, height: o.height, minWidth: o.minWidth, minHeight: o.minHeight,
      children: [this.label.node()],
    };
  }

  sync(box: LayoutBox, ctx: PaintCtx): void {
    this.bg?.update(box.rect, ctx);
    const labelBox = box.children[0];
    if (labelBox) this.label.sync(labelBox, ctx);
  }

  handlers(): NodeHandlers {
    return {
      onPressChange: pressed => {
        if (pressed) this.machine.send('down');
        this.applyVisual();
      },
      onCancel: e => { if (skipBubble(e)) return; this.machine.send('cancel'); this.applyVisual(); },
      onUp: e => {
        // up 落在目标外：router 不发 click，这里自行回到 normal（slop 取消时已是 normal，幂等）
        if (skipBubble(e)) return;
        if (!containsPoint(e.target.rect, e.x, e.y)) { this.machine.send('cancel'); this.applyVisual(); }
      },
      onClick: e => {
        if (skipBubble(e)) return;
        const r = this.machine.send('up');
        this.applyVisual();
        if (r.activated) this.opts.onClick?.();
      },
    };
  }

  override applyVisible(v: boolean): void {
    super.applyVisible(v);
    if (this.bg) this.bg.mesh.visible = v;
    this.label.applyVisible(v && this.label.visible);
  }

  dispose(): void {
    this.label.dispose();
    if (this.bg) { this.requireEnv().stage.remove(this.bg.mesh); this.bg.dispose(); this.bg = null; }
  }
}
