import { Graphics, Node, tween, UIOpacity } from 'cc';
import type { IGameContext } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';
import { Theme } from './Theme';
import { label, node } from './UIKit';
import { UIRoot } from './UIRoot';

const log = new Logger();
const MAX_QUEUE = 3;

/**
 * 轻提示：2s 自动消失，队列上限 3，层级 Toast。
 * Toast.init(ctx) 后同时监听 'toast' 事件（由服务层 emit 的提示统一走这里）。
 */
export class Toast {
  private static queue: string[] = [];
  private static showing = false;
  private static boundCtx: IGameContext | null = null;

  /** 绑定事件总线；同一 ctx 重复调用无副作用，换 ctx 会先解绑旧监听。 */
  static init(ctx: IGameContext): void {
    if (Toast.boundCtx === ctx) return;
    Toast.boundCtx?.events.offTarget(Toast);
    Toast.boundCtx = ctx;
    ctx.events.on('toast', (payload) => Toast.show(payload.text), Toast);
  }

  static destroy(): void {
    Toast.queue.length = 0;
    Toast.showing = false;
    Toast.boundCtx?.events.offTarget(Toast);
    Toast.boundCtx = null;
  }

  static show(text: string): void {
    const message = typeof text === 'string' ? text.trim() : '';
    if (!message) return;
    if (Toast.queue.length >= MAX_QUEUE) {
      log.warn(`Toast 队列已满（${MAX_QUEUE}），丢弃：${message}`);
      return;
    }
    Toast.queue.push(message);
    void Toast.drain();
  }

  private static async drain(): Promise<void> {
    if (Toast.showing) return;
    Toast.showing = true;
    while (Toast.queue.length > 0) {
      const message = Toast.queue.shift();
      if (message) await Toast.present(message);
    }
    Toast.showing = false;
  }

  private static present(text: string): Promise<void> {
    const root = UIRoot.instance;
    if (!root) {
      log.warn('UIRoot 未初始化，Toast 不显示');
      return Promise.resolve();
    }
    const lines = Math.max(1, Math.min(3, Math.ceil(text.length / 18)));
    const width = Math.min(660, 80 + Math.min(18, text.length) * 32);
    const height = 30 * lines + 44;
    const toastNode = node('Toast', { parent: root.getLayer('toast'), size: { width, height }, position: [0, -360] });
    const background = toastNode.addComponent(Graphics);
    background.fillColor = Theme.color.toastBg;
    background.roundRect(-width / 2, -height / 2, width, height, Theme.radius.md);
    background.fill();
    label(text, {
      parent: toastNode,
      size: { width: width - 32, height: height - 16 },
      fontSize: Theme.fontSize.small,
      color: Theme.color.textOnDark,
      maxWidth: width - 32,
      align: 'center',
      overflow: 'clamp',
    });
    const opacity = toastNode.addComponent(UIOpacity);
    opacity.opacity = 0;
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        toastNode.off(Node.EventType.NODE_DESTROYED, finish);
        if (toastNode.isValid) toastNode.destroy();
        resolve();
      };
      toastNode.once(Node.EventType.NODE_DESTROYED, finish);
      tween(opacity)
        .to(Theme.duration.toastIn, { opacity: 255 })
        .delay(Theme.duration.toastHold)
        .to(Theme.duration.toastOut, { opacity: 0 })
        .call(finish)
        .start();
    });
  }
}
