/**
 * Label：SDF 文本控件（中英混排/换行/对齐，排版在 text/layoutText.ts）。
 * 尺寸语义：node() 用 measureText 结果作 content（auto 尺寸）；
 * sync 时按实际盒宽重排（stretch 拉宽后 center/right 对齐以盒宽为基准）。
 * maxWidthPx 显式指定折行宽（不随盒宽变化）。
 */
import type { LayoutBox, LayoutNode } from '../types.js';
import { Widget } from '../widget.js';
import type { PaintCtx } from '../paint.js';
import { TextMesh } from '../text/textMesh.js';
import type { TextAlign } from '../text/layoutText.js';
import { measureText } from '../text/layoutText.js';

export interface LabelOptions {
  text?: string;
  fontSizePx?: number;
  /** 默认 theme.colors.text */
  color?: string;
  align?: TextAlign;
  /** 折行宽 px；缺省 = 盒宽（stretch）或自然宽（auto） */
  maxWidthPx?: number;
  lineHeightMul?: number;
  opacity?: number;
}

export class Label extends Widget {
  private opts: LabelOptions;
  private text: string;
  private mesh: TextMesh | null = null;
  /**
   * 两遍收敛的盒宽提示：首遍按自然宽测量（stretch 场景下盒宽由父决定，与内容无关），
   * sync 时回填实际盒宽并 invalidate，次遍 node() 即按盒宽折行测量（高度随之修正）。
   * 显式 maxWidthPx 时不启用。盒宽变化（窗口 resize 等）同样经此路径重排。
   */
  private hintWidth = 0;

  constructor(opts: LabelOptions = {}) {
    super();
    this.opts = opts;
    this.text = opts.text ?? '';
  }

  protected get kind(): string { return 'label'; }

  protected onBind(): void {
    const env = this.requireEnv();
    this.mesh = new TextMesh(env.fonts, {
      color: this.opts.color ?? env.theme.colors.text,
      opacity: this.opts.opacity ?? 1,
      pixelRatio: env.pixelRatio,
    });
    this.mesh.object.visible = this.visible; // 构造期置 false 的初始可见性在网格创建时落地
    env.stage.add(this.mesh.object);
  }

  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.requireEnv().invalidate(); // 尺寸可能变化 → 重布局（网格内容在 sync 重建）
  }

  getText(): string { return this.text; }

  setColor(color: string): void {
    this.opts.color = color;
    this.mesh?.setColor(color);
  }

  setOpacity(opacity: number): void {
    this.opts.opacity = opacity;
    this.mesh?.setOpacity(opacity);
  }

  private style(maxWidthPx?: number) {
    const env = this.requireEnv();
    return {
      fontSizePx: this.opts.fontSizePx ?? env.config.text.fontSizePx,
      lineHeightMul: this.opts.lineHeightMul ?? env.config.text.lineHeightMul,
      align: this.opts.align ?? 'left',
      maxWidthPx: this.opts.maxWidthPx ?? maxWidthPx,
    };
  }

  node(): LayoutNode {
    const env = this.requireEnv();
    const content = measureText(env.fonts, this.text, this.style(this.hintWidth > 0 ? this.hintWidth : undefined));
    return { id: this.id, content };
  }

  sync(box: LayoutBox, ctx: PaintCtx): void {
    const mesh = this.mesh;
    if (!mesh) return;
    const r = box.contentRect;
    mesh.set(this.text, this.style(r.w > 0 ? r.w : undefined));
    mesh.object.position.set(r.x, -r.y, 0);
    mesh.object.visible = this.visible;
    mesh.setPaint(ctx);
    // hintWidth 两遍收敛：盒宽≠自然宽说明宽度由父级决定（stretch 拉宽或定宽折行），
    // 回填盒宽让文本按它排版；盒宽==自然宽则是 auto 标签，不回填（S5 缺陷修复：
    // 此前无条件回填会把 auto 标签首帧短文本的窄宽锁死，长文本竖排成列）。
    if (this.opts.maxWidthPx === undefined && r.w > 0) {
      const env = this.requireEnv();
      const natural = measureText(env.fonts, this.text, this.style(undefined)).w;
      const want = Math.abs(r.w - natural) > 0.5 ? r.w : 0;
      if (Math.abs(want - this.hintWidth) > 0.5) {
        this.hintWidth = want;
        env.invalidate(); // 下一帧按实际盒宽重测（两遍收敛）
      }
    }
  }

  protected override onVisible(v: boolean): void {
    if (this.mesh) this.mesh.object.visible = v;
  }

  pixelRatioChanged(): void {
    this.mesh?.setPixelRatio(this.requireEnv().pixelRatio);
  }

  dispose(): void {
    if (this.mesh) {
      this.requireEnv().stage.remove(this.mesh.object);
      this.mesh.dispose();
      this.mesh = null;
    }
  }
}
