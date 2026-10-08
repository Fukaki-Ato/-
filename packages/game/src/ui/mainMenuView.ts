import { Box, Button, Label, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { MainMenuActions } from '../flow/views.js';

export interface MainMenuPage { view: UiView }

export function buildMainMenuPage(host: UiHost, actions: MainMenuActions): MainMenuPage {
  const button = (label: string, onClick: () => void, primary = false) => new Button({
    label,
    skin: host.solidSkin,
    ...(primary ? { variant: 'primary' as const } : {}),
    fontSizePx: primary ? 22 : 15,
    onClick,
  });
  const unsupported = () => actions.onUnsupported();
  const view = host.makeView();
  view.add(new Box({ direction: 'column', align: 'center', justify: 'spaceBetween', flex: 1, padding: 16, gap: 12 }, [
    new Box({ direction: 'row', justify: 'center', align: 'center', gap: 12 }, [
      new Label({ text: '金币 1,891', fontSizePx: 16 }),
      button('金币 +', actions.onShop),
      new Label({ text: '钻石 0', fontSizePx: 16 }),
      button('钻石 +', actions.onShop),
      button('设置', unsupported),
    ]),
    new Box({ direction: 'row', justify: 'spaceBetween', flex: 1, align: 'center', gap: 12 }, [
      new Box({ direction: 'column', gap: 12 }, [button('活动', unsupported), button('任务', unsupported)]),
      button('开始酷跑', actions.onStartRun, true),
      new Box({ direction: 'column', gap: 12 }, [button('成就', unsupported), button('排行榜', unsupported)]),
    ]),
    new Box({ direction: 'row', justify: 'spaceBetween', gap: 8 }, [
      button('商店', actions.onShop),
      button('福利手册', unsupported),
      button('仓库', unsupported),
      button('角色', unsupported),
    ]),
  ]));
  return { view };
}
