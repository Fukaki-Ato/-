import { _decorator, Component } from 'cc';
import type { CurrencyType, IGameContext } from '../../core/contracts';
import { EventBus } from '../../core/framework/EventBus';
import { Logger } from '../../core/framework/Logger';
import { BasePanel } from '../framework/BasePanel';
import { ConfirmDialog } from '../framework/ConfirmDialog';
import { CurrencyBar } from '../framework/CurrencyBar';
import { PanelManager } from '../framework/PanelManager';
import { progressBar, button, label } from '../framework/UIKit';
import { Theme } from '../framework/Theme';
import { RewardPopup } from '../framework/RewardPopup';
import { Toast } from '../framework/Toast';
import { UIRoot } from '../framework/UIRoot';

const { ccclass } = _decorator;

/**
 * S04 临时自检组件（S05 完成后可删除）。
 * 用法：任意场景 → Canvas 下新建空节点 → 挂载 S04Smoke → 预览。
 * 依次验证：UIRoot 层级 / PanelManager 打开关闭 / Toast / ConfirmDialog / RewardPopup。
 */
@ccclass('S04Smoke')
export class S04Smoke extends Component {
  protected override start(): void {
    const root = UIRoot.initialize(this.node);
    PanelManager.init(createStubContext(), root);
    PanelManager.register('S04SmokePanel', (ctx) => new S04SmokePanel(ctx));
    void PanelManager.open('S04SmokePanel');
  }
}

function createStubContext(): IGameContext {
  const events = new EventBus(new Logger());
  return {
    events,
    currency: {
      get: (type: CurrencyType) => (type === 'gold' ? 1234 : 56),
    },
    redDot: {
      isOn: () => false,
      refresh: () => undefined,
      subscribe: () => () => undefined,
    },
    markDirty: () => undefined,
  } as unknown as IGameContext;
}

class S04SmokePanel extends BasePanel {
  protected override onCreate(): void {
    label('S04 UI 基座自检', {
      parent: this.node,
      size: { width: 690, height: 80 },
      position: [0, 480],
      fontSize: Theme.fontSize.title,
      bold: true,
      align: 'center',
    });
    new CurrencyBar(this.node, this.ctx, { showPlus: true }).node.setPosition(0, 360, 0);
    const bar = progressBar({ parent: this.node, width: 520, position: [0, 260] });
    bar.setProgress(0.65);

    button({
      parent: this.node,
      size: { width: 420, height: 96 },
      position: [0, 100],
      text: 'Toast',
      onClick: () => Toast.show('这是一条测试提示'),
    });
    button({
      parent: this.node,
      size: { width: 420, height: 96 },
      position: [0, -30],
      text: 'ConfirmDialog',
      variant: 'secondary',
      onClick: () => {
        void ConfirmDialog.show({ title: '测试', content: '确认或取消？' }).then((ok) => Toast.show(ok ? '已确认' : '已取消'));
      },
    });
    button({
      parent: this.node,
      size: { width: 420, height: 96 },
      position: [0, -160],
      text: 'RewardPopup',
      variant: 'green',
      onClick: () => {
        void RewardPopup.show(
          [
            { kind: 'gold', name: '金币', icon: Theme.assets.iconGold, count: 1888 },
            { kind: 'diamond', name: '钻石', icon: Theme.assets.iconDiamond, count: 66 },
            { kind: 'item', name: '道具', icon: Theme.assets.iconTask, count: 2 },
          ],
          { doubleText: '双倍领取', onDouble: () => Toast.show('双倍回调（S08 接广告）') },
        );
      },
    });
    button({
      parent: this.node,
      size: { width: 420, height: 90 },
      position: [0, -320],
      text: '关闭面板',
      variant: 'ghost',
      onClick: () => this.close(),
    });
  }
}
