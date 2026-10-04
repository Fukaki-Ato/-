import type { AppConfig } from '../../core/contracts';
import { AudioService } from '../framework/AudioService';
import { BasePanel } from '../framework/BasePanel';
import { ConfirmDialog } from '../framework/ConfirmDialog';
import { TextDialog } from '../framework/TextDialog';
import { Theme } from '../framework/Theme';
import { Toast } from '../framework/Toast';
import { type ToggleView, button, divider, label, panelBg, toggle } from '../framework/UIKit';
import { resetSaveAndRestart } from '../boot/ResetSupport';

/** 客服文案：优先 QQ，其次微信、邮箱；均未配置时返回空串（入口隐藏）。 */
function contactText(contact: AppConfig['contact']): string {
  if (contact.qq) return `QQ：${contact.qq}`;
  if (contact.wechat) return `微信：${contact.wechat}`;
  if (contact.email) return `邮箱：${contact.email}`;
  return '';
}

/**
 * 设置面板（docs/04 §3.3）：
 * 音乐/音效开关（AudioService + 存档）、隐私政策/用户协议（TextDialog）、
 * 联系客服（有配置则复制并 Toast）、重置存档（二次确认）、版本号、返回。
 */
export class SettingsPanel extends BasePanel {
  private musicToggle: ToggleView | null = null;
  private sfxToggle: ToggleView | null = null;

  protected override onCreate(): void {
    const app = this.ctx.config.app();
    const bg = panelBg({ parent: this.node, size: { width: 660, height: 1040 } });

    label('设置', {
      parent: bg,
      size: { width: 520, height: 72 },
      position: [0, 440],
      fontSize: Theme.fontSize.title,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    divider({ parent: bg, width: 560, position: [0, 392] });

    let cursor = 330;
    const row = (height: number): number => {
      const centerY = cursor;
      cursor -= height;
      return centerY;
    };

    this.musicToggle = toggle({
      parent: bg,
      label: '音乐',
      value: AudioService.isMusicOn(),
      width: 540,
      labelWidth: 400,
      onChange: (value) => AudioService.setMusic(value),
    });
    this.musicToggle.node.setPosition(0, row(96), 0);

    this.sfxToggle = toggle({
      parent: bg,
      label: '音效',
      value: AudioService.isSfxOn(),
      width: 540,
      labelWidth: 400,
      onChange: (value) => AudioService.setSfx(value),
    });
    this.sfxToggle.node.setPosition(0, row(96), 0);

    divider({ parent: bg, width: 560, position: [0, row(40)] });

    button({
      parent: bg,
      size: { width: 520, height: 92 },
      position: [0, row(108)],
      text: '隐私政策',
      variant: 'secondary',
      onClick: () => {
        void TextDialog.show({ title: '隐私政策', text: app.privacyPolicy });
      },
    });
    button({
      parent: bg,
      size: { width: 520, height: 92 },
      position: [0, row(108)],
      text: '用户协议',
      variant: 'secondary',
      onClick: () => {
        void TextDialog.show({ title: '用户协议', text: app.userAgreement });
      },
    });

    const contact = contactText(app.contact);
    if (contact) {
      button({
        parent: bg,
        size: { width: 520, height: 92 },
        position: [0, row(108)],
        text: '联系客服',
        variant: 'secondary',
        onClick: () => {
          this.ctx.platform.copyText(contact);
          Toast.show(`已复制：${contact}`);
        },
      });
    }

    button({
      parent: bg,
      size: { width: 520, height: 92 },
      position: [0, row(120)],
      text: '重置存档',
      variant: 'danger',
      onClick: () => void this.confirmReset(),
    });

    label(`版本 ${app.version}`, {
      parent: bg,
      size: { width: 520, height: 48 },
      position: [0, -430],
      fontSize: Theme.fontSize.small,
      color: Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    });
    button({
      parent: bg,
      size: { width: 360, height: 88 },
      position: [0, -490],
      text: '返回',
      variant: 'primary',
      onClick: () => this.close(),
    });
  }

  protected override onOpen(): void {
    // 存档设置可能在别处变更（如调试面板），打开时同步一次。
    this.musicToggle?.setValue(AudioService.isMusicOn());
    this.sfxToggle?.setValue(AudioService.isSfxOn());
  }

  private async confirmReset(): Promise<void> {
    const ok = await ConfirmDialog.show({
      title: '重置存档',
      content: '将清空本地存档并重新启动，确定继续吗？',
      okText: '重置并重启',
      cancelText: '取消',
    });
    if (!ok) return;
    resetSaveAndRestart(this.ctx, this.ctx.platform.storage);
  }
}
