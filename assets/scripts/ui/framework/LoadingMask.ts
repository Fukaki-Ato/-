import { Color, Graphics, isValid, Label, Node, tween } from 'cc';
import { Theme } from './Theme';
import { label, node, overlay } from './UIKit';
import { UIRoot } from './UIRoot';

/** 全屏加载遮罩：Loading 层、拦截输入；show/hide 计数配对，支持嵌套。 */
export class LoadingMask {
  private static count = 0;
  private static maskNode: Node | null = null;
  private static textLabel: Label | null = null;

  static get isShowing(): boolean {
    return LoadingMask.count > 0;
  }

  static show(text = '加载中...'): void {
    LoadingMask.count += 1;
    if (LoadingMask.maskNode && isValid(LoadingMask.maskNode)) {
      if (LoadingMask.textLabel && isValid(LoadingMask.textLabel.node)) LoadingMask.textLabel.string = text;
      return;
    }
    const root = UIRoot.instance;
    if (!root) return;
    const mask = overlay({ parent: root.getLayer('loading'), color: new Color(0, 0, 0, 120) });
    const spinner = node('spinner', { parent: mask, size: { width: 72, height: 72 }, position: [0, 40] });
    const graphics = spinner.addComponent(Graphics);
    graphics.lineWidth = 7;
    graphics.strokeColor = Theme.color.white;
    graphics.arc(0, 0, 26, 0, Math.PI * 1.5, false);
    graphics.stroke();
    tween(spinner).by(1, { angle: -360 }).repeatForever().start();
    const textLabel = label(text, {
      parent: mask,
      size: { width: 520, height: 60 },
      position: [0, -50],
      fontSize: Theme.fontSize.body,
      color: Theme.color.textOnDark,
      align: 'center',
      overflow: 'shrink',
    }).getComponent(Label);
    LoadingMask.maskNode = mask;
    LoadingMask.textLabel = textLabel;
  }

  static hide(): void {
    LoadingMask.count = Math.max(0, LoadingMask.count - 1);
    if (LoadingMask.count > 0) return;
    if (LoadingMask.maskNode && isValid(LoadingMask.maskNode)) LoadingMask.maskNode.destroy();
    LoadingMask.maskNode = null;
    LoadingMask.textLabel = null;
  }
}
