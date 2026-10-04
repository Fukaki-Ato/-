import { Node } from 'cc';
import { applySprite } from './Assets';
import { Theme } from './Theme';
import { label, node } from './UIKit';

export interface EmptyStateOptions {
  width?: number;
  height?: number;
  icon?: string;
  offsetY?: number;
}

/** 空态占位：插画（素材缺失为圆角块+「空」字）+ 文案。 */
export class EmptyState {
  static show(parent: Node, text = '暂无内容', opts: EmptyStateOptions = {}): Node {
    const width = opts.width ?? 320;
    const height = opts.height ?? 320;
    const root = node('EmptyState', { parent, size: { width, height }, position: [0, opts.offsetY ?? 0] });
    const iconSize = Math.round(Math.min(width, height) * 0.52);
    const iconNode = node('icon', { parent: root, size: { width: iconSize, height: iconSize }, position: [0, height * 0.12] });
    applySprite(iconNode, opts.icon ?? Theme.assets.emptyDefault, {
      size: { width: iconSize, height: iconSize },
      radius: Theme.radius.lg,
      color: Theme.color.placeholder,
      placeholderText: '空',
    });
    label(text, {
      parent: root,
      size: { width, height: Math.max(40, Math.round(height * 0.3)) },
      position: [0, -height * 0.28],
      fontSize: Theme.fontSize.small,
      color: Theme.color.textSub,
      maxWidth: width,
      align: 'center',
      overflow: 'clamp',
    });
    return root;
  }
}
