import { isValid, Node, UITransform } from 'cc';
import type { IGameContext, RedDotKey } from '../../core/contracts';
import { applySprite } from './Assets';
import { Theme } from './Theme';
import { node } from './UIKit';

export interface RedDotOptions {
  size?: number;
  /** 相对默认位置（目标节点右上角）的偏移。 */
  offset?: [number, number];
}

interface RedDotBinding {
  target: Node;
  marker: Node;
  key: RedDotKey;
}

/**
 * 红点绑定：订阅 reddot.changed，节点销毁自动解绑。
 * 使用前由 GameRoot 调用 RedDots.setup(ctx)；未 setup 时红点保持隐藏。
 */
export class RedDots {
  private static ctxRef: IGameContext | null = null;
  private static unsubscribe: (() => void) | null = null;
  private static bindings: RedDotBinding[] = [];

  static setup(ctx: IGameContext): void {
    RedDots.ctxRef = ctx;
    RedDots.unsubscribe?.();
    RedDots.unsubscribe = ctx.redDot.subscribe((key, on) => RedDots.apply(key, on));
    RedDots.refresh();
  }

  static bind(target: Node, key: RedDotKey, opts: RedDotOptions = {}): Node {
    const size = opts.size ?? 26;
    const marker = node('RedDot', { parent: target, size: { width: size, height: size } });
    applySprite(marker, Theme.assets.redDot, { size: { width: size, height: size }, radius: size / 2, color: Theme.color.red });
    const ui = target.getComponent(UITransform);
    const width = ui?.width ?? 0;
    const height = ui?.height ?? 0;
    const anchorX = ui?.anchorX ?? 0.5;
    const anchorY = ui?.anchorY ?? 0.5;
    const [offsetX, offsetY] = opts.offset ?? [0, 0];
    marker.setPosition((1 - anchorX) * width - size / 2 + offsetX, (1 - anchorY) * height - size / 2 + offsetY, 0);
    marker.active = false;

    RedDots.bindings.push({ target, marker, key });
    target.once(Node.EventType.NODE_DESTROYED, () => RedDots.unbind(target));
    RedDots.apply(key, RedDots.ctxRef ? RedDots.ctxRef.redDot.isOn(key) : false);
    return marker;
  }

  static unbind(target: Node): void {
    const remain: RedDotBinding[] = [];
    for (const binding of RedDots.bindings) {
      if (binding.target === target) {
        if (isValid(binding.marker)) binding.marker.destroy();
      } else {
        remain.push(binding);
      }
    }
    RedDots.bindings = remain;
  }

  static unbindAll(): void {
    for (const binding of RedDots.bindings) {
      if (isValid(binding.marker)) binding.marker.destroy();
    }
    RedDots.bindings = [];
  }

  /** 按服务当前状态刷新全部绑定。 */
  static refresh(): void {
    if (!RedDots.ctxRef) return;
    for (const binding of RedDots.bindings) {
      RedDots.apply(binding.key, RedDots.ctxRef.redDot.isOn(binding.key));
    }
  }

  /** 解绑所有监听（编辑器重置/测试用）。 */
  static destroy(): void {
    RedDots.unsubscribe?.();
    RedDots.unsubscribe = null;
    RedDots.unbindAll();
    RedDots.ctxRef = null;
  }

  private static apply(key: RedDotKey, on: boolean): void {
    for (const binding of RedDots.bindings) {
      if (binding.key === key && isValid(binding.marker)) binding.marker.active = on;
    }
  }
}
