import { isValid, Node, tween, UIOpacity, v3 } from 'cc';
import { applySprite } from './Assets';
import { Theme } from './Theme';
import { node, overlay } from './UIKit';
import { UIRoot } from './UIRoot';

export interface ModalOptions {
  width: number;
  height: number;
  /** 点击遮罩是否关闭，默认 false（确认类弹窗避免误触）。 */
  closeOnBackdrop?: boolean;
}

export interface ModalHandle {
  /** 全屏遮罩（挂 Popup 层，拦截下层输入）。 */
  readonly root: Node;
  /** 居中面板节点，弹窗内容全部挂在这里。 */
  readonly content: Node;
  /** 播放入场动画。 */
  openIn(): Promise<void>;
  /** 播放退场动画并销毁；可重复调用。 */
  close(): Promise<void>;
}

/**
 * 弹窗外壳（内部通用）：遮罩 + 居中面板 + 缩放/透明动画。
 * ConfirmDialog/RewardPopup/TextDialog 共用，保证交互与动画一致。
 */
export function createModal(opts: ModalOptions): ModalHandle {
  const root = UIRoot.instance;
  const overlayNode = overlay({ parent: root ? root.getLayer('popup') : null });
  const content = node('ModalPanel', { parent: overlayNode, size: { width: opts.width, height: opts.height } });
  applySprite(content, Theme.assets.panelCommon, {
    size: { width: opts.width, height: opts.height },
    radius: Theme.radius.lg,
    color: Theme.color.panel,
  });
  const opacity = content.addComponent(UIOpacity);
  content.setScale(0.92, 0.92, 1);
  opacity.opacity = 0;

  let closed = false;
  if (opts.closeOnBackdrop) {
    overlayNode.on(Node.EventType.TOUCH_END, () => {
      void close();
    });
  }

  const openIn = (): Promise<void> => {
    if (closed || !isValid(content)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        content.off(Node.EventType.NODE_DESTROYED, finish);
        resolve();
      };
      content.once(Node.EventType.NODE_DESTROYED, finish);
      tween(content).to(Theme.duration.panel, { scale: v3(1, 1, 1) }, { easing: 'quadOut' }).start();
      tween(opacity).to(Theme.duration.panel, { opacity: 255 }, { easing: 'quadOut' }).call(finish).start();
    });
  };

  const close = (): Promise<void> => {
    if (closed) return Promise.resolve();
    closed = true;
    if (!isValid(content)) {
      if (isValid(overlayNode)) overlayNode.destroy();
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        content.off(Node.EventType.NODE_DESTROYED, finish);
        if (isValid(overlayNode)) overlayNode.destroy();
        resolve();
      };
      content.once(Node.EventType.NODE_DESTROYED, finish);
      tween(content).to(Theme.duration.panel, { scale: v3(0.92, 0.92, 1) }, { easing: 'quadIn' }).start();
      tween(opacity).to(Theme.duration.panel, { opacity: 0 }, { easing: 'quadIn' }).call(finish).start();
    });
  };

  return { root: overlayNode, content, openIn, close };
}
