/**
 * 页面共用小件（S5）：色块/信息行。
 * 只组合 @tr/ui 基础控件，零 DOM。
 */
import { Box, Label, type NinePatchSource, type ThemeColors } from '@tr/framework/ui/index.js';

/** 纯色圆角色块（角色 chip / 状态点） */
export function solidChip(solid: NinePatchSource, size: number, color: string): Box {
  return new Box({ width: size, height: size, background: solid, backgroundColor: color });
}

/** 结算信息行：左标签（muted）+ 右值（text 加粗感用亮色替代），spaceBetween */
export function kvRow(colors: ThemeColors, key: string, val: string): Box {
  return new Box(
    { direction: 'row', justify: 'spaceBetween', align: 'center', padding: { top: 5, bottom: 5, left: 4, right: 4 } },
    [
      new Label({ text: key, fontSizePx: 13, color: colors.muted }),
      new Label({ text: val, fontSizePx: 13, color: colors.text }),
    ],
  );
}
