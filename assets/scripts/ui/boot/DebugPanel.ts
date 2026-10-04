import { Graphics, isValid, Node } from 'cc';
import type { IGameContext } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';
import { MockGameplayLauncher } from '../../core/gameplay/MockGameplayLauncher';
import { button, label, node, overlay } from '../framework/UIKit';
import { ConfirmDialog } from '../framework/ConfirmDialog';
import { Theme } from '../framework/Theme';
import { Toast } from '../framework/Toast';
import { UIRoot } from '../framework/UIRoot';
import { openSettlementPanel } from '../panels/RunFlow';
import { resetSaveAndRestart } from './ResetSupport';

const log = new Logger();

/**
 * 简易调试面板（仅 app.json.debug=true 时可达；长按启动页版本号 2 秒打开）。
 * 提供 +1000 金币 / +100 钻石 / 跑一局（跳过动画直通结算）/ 清空存档 / 当前游戏日展示。
 */
export class DebugPanel {
  private static current: DebugPanel | null = null;

  static toggle(ctx: IGameContext): void {
    if (DebugPanel.current) {
      DebugPanel.current.dispose();
      DebugPanel.current = null;
      return;
    }
    DebugPanel.current = new DebugPanel(ctx);
  }

  private readonly root: Node;

  private constructor(private readonly ctx: IGameContext) {
    const root = node('DebugPanel', {
      parent: UIRoot.getLayer('debug'),
      size: { width: Theme.size.designWidth, height: Theme.size.designHeight },
    });
    this.root = root;
    overlay({ parent: root });

    const panel = node('panel', { parent: root, size: { width: 620, height: 760 } });
    const panelBg = panel.addComponent(Graphics);
    panelBg.fillColor = Theme.color.panel;
    panelBg.roundRect(-310, -380, 620, 760, Theme.radius.lg);
    panelBg.fill();

    label('调试面板（沙盒）', {
      parent: panel,
      size: { width: 560, height: 64 },
      position: [0, 320],
      fontSize: Theme.fontSize.subtitle,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    label(`游戏日：${this.ctx.clock.gameDay()}`, {
      parent: panel,
      size: { width: 560, height: 52 },
      position: [0, 240],
      fontSize: Theme.fontSize.body,
      color: Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    });
    label(`周：${this.ctx.clock.weekKey()}`, {
      parent: panel,
      size: { width: 560, height: 52 },
      position: [0, 182],
      fontSize: Theme.fontSize.small,
      color: Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    });

    button({
      parent: panel,
      size: { width: 440, height: 88 },
      position: [0, 100],
      text: '+1000 金币',
      variant: 'green',
      onClick: () => this.grant('gold', 1000),
    });
    button({
      parent: panel,
      size: { width: 440, height: 88 },
      position: [0, 0],
      text: '+100 钻石',
      variant: 'green',
      onClick: () => this.grant('diamond', 100),
    });
    button({
      parent: panel,
      size: { width: 440, height: 88 },
      position: [0, -100],
      text: '跑一局（跳过动画）',
      variant: 'primary',
      onClick: () => void this.quickRun(),
    });
    button({
      parent: panel,
      size: { width: 440, height: 88 },
      position: [0, -200],
      text: '清空存档',
      variant: 'danger',
      onClick: () => void this.confirmReset(),
    });
    button({
      parent: panel,
      size: { width: 440, height: 88 },
      position: [0, -300],
      text: '关闭',
      variant: 'secondary',
      onClick: () => this.dispose(),
    });
  }

  dispose(): void {
    if (isValid(this.root)) this.root.destroy();
  }

  private grant(type: 'gold' | 'diamond', amount: number): void {
    this.ctx.currency.add(type, amount, 'debug');
    Toast.show(type === 'gold' ? `+${amount} 金币` : `+${amount} 钻石`);
  }

  /** 直通结算：零延迟 Mock 立即出结果，跳过 mask/preload，便于快速冒烟结算流程。 */
  private async quickRun(): Promise<void> {
    this.dispose();
    DebugPanel.current = null;
    try {
      const launcher = new MockGameplayLauncher({ delayMs: 0 });
      const result = await launcher.launch({ mode: 'classic', characterId: this.ctx.save.characters.selected });
      this.ctx.events.emit('run.finished', result);
      await openSettlementPanel(this.ctx, result);
    } catch (err) {
      log.error('调试跑一局失败', err);
      Toast.show('调试跑一局失败');
    }
  }

  private async confirmReset(): Promise<void> {
    const ok = await ConfirmDialog.show({
      title: '清空存档',
      content: '将清空本地存档并重新启动，确定继续吗？',
      okText: '清空并重启',
      cancelText: '取消',
    });
    if (!ok) return;
    this.dispose();
    DebugPanel.current = null;
    resetSaveAndRestart(this.ctx, this.ctx.platform.storage);
  }
}
