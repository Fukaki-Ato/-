/**
 * 大厅图标集（feat/lobby-layout）：源为 lucide 开源图标库（ISC 协议）的 96px 白色 PNG，
 * 存放 assets/ui/icons/，由 apps 壳加载成贴图后经 IconSet 注入（本包禁令：不 fetch/DOM）。
 * 图标以「零 insets 九宫格」接入 Box 背景：整图拉伸 = 普通图片位，backgroundColor 乘色改图标颜色。
 */
import { Box, type NinePatchSource } from '@tr/framework/ui/index.js';

export const ICON_NAMES = [
  'circle-user', 'coins', 'gem', 'settings', 'trophy', 'clipboard-list',
  'calendar-days', 'store', 'user-round', 'archive', 'book-open', 'play', 'map',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** 壳侧加载结果：缺某个图标时该键缺席，iconBox 退化为空槽（不阻塞页面） */
export type IconSet = Partial<Record<IconName, NinePatchSource>>;

/** 图标控件：定宽定高图片位；tint 默认白 = 保留 PNG 原色 */
export function iconBox(icons: IconSet | undefined, name: IconName, size: number, tint = '#ffffff'): Box {
  const src = icons?.[name];
  if (!src) return new Box({ width: size, height: size });
  return new Box({ width: size, height: size, background: src, backgroundColor: tint });
}
