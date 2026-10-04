import { Node, UITransform } from 'cc';
import { createModal } from './Modal';
import { Theme } from './Theme';
import { button, label, scrollView } from './UIKit';

export interface TextDialogOptions {
  title?: string;
  text: string;
  closeText?: string;
}

/** 长文本弹窗：隐私政策/用户协议/活动规则；正文可滚动。 */
export class TextDialog {
  static show(opts: TextDialogOptions): Promise<void> {
    const width = 660;
    const height = 1180;
    const modal = createModal({ width, height });

    label(opts.title ?? '详情', {
      parent: modal.content,
      size: { width: 560, height: 64 },
      position: [0, height / 2 - 70],
      fontSize: Theme.fontSize.subtitle,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });

    const viewHeight = 940;
    const fontSize = Theme.fontSize.small;
    const lineHeight = 38;
    const charsPerLine = 22;
    const lines = Math.max(1, Math.ceil(opts.text.length / charsPerLine));
    const contentHeight = Math.max(viewHeight, lines * lineHeight + 48);
    const scroll = scrollView({ parent: modal.content, width: 580, height: viewHeight });
    scroll.node.setPosition(0, -8, 0);
    scroll.content.getComponent(UITransform)?.setContentSize(580, contentHeight);
    label(opts.text, {
      parent: scroll.content,
      size: { width: 540, height: contentHeight },
      anchor: [0.5, 1],
      position: [0, 0],
      fontSize,
      lineHeight,
      align: 'left',
      valign: 'top',
      maxWidth: 540,
      overflow: 'clamp',
    });

    return new Promise<void>((resolve) => {
      let settled = false;
      // 弹窗被外部销毁时直接结束，避免 Promise 悬挂。
      modal.root.once(Node.EventType.NODE_DESTROYED, () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      button({
        parent: modal.content,
        size: { width: 320, height: 86 },
        position: [0, -height / 2 + 74],
        text: opts.closeText ?? '关闭',
        variant: 'primary',
        onClick: () => {
          if (settled) return;
          settled = true;
          void modal.close().then(resolve);
        },
      });
      void modal.openIn();
    });
  }
}
