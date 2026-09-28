/**
 * Panel：默认带主题 panel 皮肤（九宫格圆角+描边）的容器。
 * 语义与 Box 完全一致，仅 background 默认值不同（'panel'；可传 'card'/自定义源/null 关闭）。
 */
import { Box, type BoxOptions } from './box.js';
import type { Widget } from '../widget.js';
import type { SkinKey } from '../theme.js';
import type { NinePatchSource } from '../render/ninePatch.js';

export interface PanelOptions extends BoxOptions {
  background?: SkinKey | NinePatchSource | null;
}

export class Panel extends Box {
  constructor(opts: PanelOptions = {}, children: Widget[] = []) {
    super({ padding: 16, gap: 8, ...opts }, children);
  }

  protected get kind(): string { return 'panel'; }

  protected defaultBackground(): SkinKey | NinePatchSource | null | undefined {
    return this.opts.background ?? 'panel';
  }
}
