import { Graphics, Label, Node, isValid } from 'cc';
import { Theme } from '../framework/Theme';
import { type ButtonView, button, label, node, stretch } from '../framework/UIKit';
import { UIRoot } from '../framework/UIRoot';

/** 版本号长按阈值（ms）。 */
const LONG_PRESS_MS = 2000;
const DESIGN_W = Theme.size.designWidth;
const DESIGN_H = Theme.size.designHeight;

export interface BootErrorHandlers {
  onRetry: () => void;
  onReset: () => void;
}

/**
 * 启动页视图：Logo/游戏名、加载文本、版本号（左下）与错误兜底、隐私入口。
 * 纯视图不持有 ctx；由 Boot 创建与销毁。
 */
export class BootScreen {
  /** 版本号长按 2 秒回调（Boot 判断 debug 后打开调试面板）。 */
  onVersionLongPress: (() => void) | null = null;
  /** 「隐私政策」查看回调（仅查看全文）。 */
  onPolicyView: (() => void) | null = null;
  /** 「隐私授权」同意流程回调。 */
  onConsentRetry: (() => void) | null = null;

  private readonly root: Node;
  private readonly statusLabel: Label;
  private readonly versionLabel: Label;
  private readonly consentButton: ButtonView;
  private readonly errorBox: Node;
  private readonly errorLabel: Label;
  private errorHandlers: BootErrorHandlers | null = null;
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor() {
    this.root = node('BootScreen', {
      parent: UIRoot.getLayer('panel'),
      size: { width: DESIGN_W, height: DESIGN_H },
    });
    stretch(this.root);

    label('雷霆酷跑', {
      parent: this.root,
      size: { width: 660, height: 100 },
      position: [0, 250],
      fontSize: 76,
      bold: true,
      color: Theme.color.white,
      align: 'center',
      overflow: 'shrink',
      outline: { color: Theme.color.wood, width: 6 },
    });
    label('夏日沙滩跑酷', {
      parent: this.root,
      size: { width: 500, height: 52 },
      position: [0, 176],
      fontSize: Theme.fontSize.body,
      color: Theme.color.sand,
      align: 'center',
      overflow: 'shrink',
      outline: { color: Theme.color.wood, width: 3 },
    });
    this.statusLabel = label('正在启动...', {
      parent: this.root,
      size: { width: 600, height: 60 },
      position: [0, 60],
      fontSize: Theme.fontSize.body,
      color: Theme.color.white,
      align: 'center',
      overflow: 'shrink',
      outline: { color: Theme.color.wood, width: 3 },
    }).getComponent(Label)!;

    // 版本号（左下，长按 2 秒触发调试入口）。
    const versionNode = node('Version', {
      parent: this.root,
      size: { width: 360, height: 52 },
      anchor: [0, 0.5],
      position: [-DESIGN_W / 2 + 40, -DESIGN_H / 2 + 46],
    });
    this.versionLabel = label('版本 -', {
      parent: versionNode,
      size: { width: 360, height: 52 },
      anchor: [0, 0.5],
      position: [0, 0],
      fontSize: Theme.fontSize.small,
      color: Theme.color.white,
      align: 'left',
      overflow: 'shrink',
      outline: { color: Theme.color.wood, width: 3 },
    }).getComponent(Label)!;
    versionNode.on(Node.EventType.TOUCH_START, this.onPressStart, this);
    versionNode.on(Node.EventType.TOUCH_END, this.onPressCancel, this);
    versionNode.on(Node.EventType.TOUCH_CANCEL, this.onPressCancel, this);

    // 隐私入口：查看全文 + 授权（不同意后重新发起）。
    button({
      parent: this.root,
      size: { width: 280, height: 76 },
      position: [0, -DESIGN_H / 2 + 130],
      text: '隐私政策',
      variant: 'ghost',
      onClick: () => this.onPolicyView?.(),
    });
    this.consentButton = button({
      parent: this.root,
      size: { width: 380, height: 96 },
      position: [0, -170],
      text: '隐私授权',
      variant: 'primary',
      onClick: () => this.onConsentRetry?.(),
    });
    this.consentButton.node.active = false;

    // 错误兜底（默认隐藏）。
    this.errorBox = node('ErrorBox', {
      parent: this.root,
      size: { width: 640, height: 460 },
    });
    const box = this.errorBox.addComponent(Graphics);
    box.fillColor = Theme.color.panel;
    box.roundRect(-320, -230, 640, 460, Theme.radius.lg);
    box.fill();
    label('启动失败', {
      parent: this.errorBox,
      size: { width: 560, height: 64 },
      position: [0, 160],
      fontSize: Theme.fontSize.subtitle,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    this.errorLabel = label('', {
      parent: this.errorBox,
      size: { width: 560, height: 170 },
      position: [0, 30],
      fontSize: Theme.fontSize.body,
      color: Theme.color.textSub,
      maxWidth: 560,
      align: 'center',
    }).getComponent(Label)!;
    button({
      parent: this.errorBox,
      size: { width: 360, height: 88 },
      position: [0, -95],
      text: '重试',
      variant: 'primary',
      onClick: () => this.errorHandlers?.onRetry(),
    });
    button({
      parent: this.errorBox,
      size: { width: 360, height: 88 },
      position: [0, -200],
      text: '重置存档',
      variant: 'danger',
      onClick: () => this.errorHandlers?.onReset(),
    });
    this.errorBox.active = false;
  }

  setStatus(text: string): void {
    if (!this.disposed) this.statusLabel.string = text;
  }

  setVersion(version: string): void {
    if (!this.disposed) this.versionLabel.string = `版本 ${version}`;
  }

  /** 隐私未同意时显示「隐私授权」按钮。 */
  showConsentRetry(show: boolean): void {
    if (!this.disposed) this.consentButton.node.active = show;
  }

  showError(message: string, handlers: BootErrorHandlers): void {
    if (this.disposed) return;
    this.errorHandlers = handlers;
    this.errorLabel.string = message;
    this.errorBox.active = true;
  }

  hideError(): void {
    if (!this.disposed) this.errorBox.active = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearPress();
    if (isValid(this.root)) this.root.destroy();
  }

  private onPressStart(): void {
    if (this.disposed) return;
    this.clearPress();
    this.pressTimer = setTimeout(() => {
      this.pressTimer = null;
      if (!this.disposed) this.onVersionLongPress?.();
    }, LONG_PRESS_MS);
  }

  private onPressCancel(): void {
    this.clearPress();
  }

  private clearPress(): void {
    if (this.pressTimer !== null) {
      clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }
  }
}
