import { Node } from 'cc';
import { createModal } from './Modal';
import { Theme } from './Theme';
import { button, label } from './UIKit';

export interface ConfirmDialogOptions {
  title?: string;
  content: string;
  okText?: string;
  /** 传 null 表示只显示确认按钮。 */
  cancelText?: string | null;
}

/** 确认弹窗：Promise<boolean>，true 为确认、false 为取消/关闭。 */
export class ConfirmDialog {
  static show(opts: ConfirmDialogOptions): Promise<boolean> {
    const title = opts.title ?? '提示';
    const okText = opts.okText ?? '确定';
    const cancelText = opts.cancelText === undefined ? '取消' : opts.cancelText;
    const lines = Math.max(1, Math.min(8, Math.ceil(opts.content.length / 17)));
    const height = Math.min(640, 300 + (lines - 1) * 38);
    const modal = createModal({ width: 600, height, closeOnBackdrop: false });

    label(title, {
      parent: modal.content,
      size: { width: 520, height: 60 },
      position: [0, height / 2 - 58],
      fontSize: Theme.fontSize.subtitle,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    label(opts.content, {
      parent: modal.content,
      size: { width: 520, height: height - 190 },
      position: [0, 4],
      fontSize: Theme.fontSize.body,
      color: Theme.color.textSub,
      maxWidth: 520,
      align: 'center',
    });

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (value: boolean): void => {
        if (settled) return;
        settled = true;
        void modal.close();
        resolve(value);
      };
      // 弹窗被外部销毁（场景切换）时按取消处理，避免调用方 Promise 悬挂。
      modal.root.once(Node.EventType.NODE_DESTROYED, () => settle(false));
      const buttonY = -height / 2 + 72;
      if (cancelText === null) {
        button({
          parent: modal.content,
          size: { width: 300, height: 84 },
          position: [0, buttonY],
          text: okText,
          variant: 'primary',
          onClick: () => settle(true),
        });
      } else {
        button({
          parent: modal.content,
          size: { width: 220, height: 84 },
          position: [-128, buttonY],
          text: cancelText,
          variant: 'secondary',
          onClick: () => settle(false),
        });
        button({
          parent: modal.content,
          size: { width: 220, height: 84 },
          position: [128, buttonY],
          text: okText,
          variant: 'primary',
          onClick: () => settle(true),
        });
      }
      void modal.openIn();
    });
  }
}
