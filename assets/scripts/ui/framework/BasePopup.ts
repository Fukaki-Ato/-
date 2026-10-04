import { BasePanel } from './BasePanel';

/**
 * 弹窗基类：默认带全屏遮罩并拦截下层输入，由 PanelManager 串行排队打开。
 * 子类在 onCreate 中把内容节点挂在 this.node 中央即可。
 */
export abstract class BasePopup extends BasePanel {
  /** 是否显示半透明遮罩并拦截下层点击（默认 true）。 */
  modal = true;

  /** 点击遮罩回调（默认不关闭，需要点击遮罩关闭请在子类调用 this.close()）。 */
  protected onBackdrop(): void {}

  /** @internal 由 PanelManager 转发遮罩点击。 */
  notifyBackdrop(): void {
    this.onBackdrop();
  }
}
