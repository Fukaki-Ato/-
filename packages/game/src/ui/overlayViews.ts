/**
 * GameViews 的 overlay 版实现（S5，两端同源）：把六页面装配接到 UiHost。
 * 页面代码全部来自同目录 ui/*（@tr/ui 控件树），本文件只做「场景机视图接口 ↔ 页面构造器」胶水。
 * 页面均为点击交互（开始页两个入口按钮、选角卡片），无文本录入，故不再需要壳侧 onKey 转发；
 * 局内 Esc 由 mainFlow 经 adapter.onInput 处理。
 */
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type {
  BootHandle, GameViews, HudHandle, MainMenuActions, ResultActions, RunSummary, SelectActions, ShopActions, StartActions, StartHandle,
} from '../flow/views.js';
import type { EntryMethod } from '../flow/session.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import { buildBootPage } from './bootView.js';
import { buildStartPage } from './startView.js';
import { buildMainMenuPage } from './mainMenuView.js';
import { buildSelectPage } from './menuView.js';
import { buildHudPage } from './hudView.js';
import { buildResultPage } from './resultView.js';
import { buildShopPage } from './shopView.js';
import type { ShopImageAssets } from './shopImage.js';

export interface OverlayViewsDeps {
  host: UiHost;
  shopAssets?: ShopImageAssets;
  loadShopAssets?: () => Promise<ShopImageAssets | undefined>;
  shopRenderer?: (content: GameContent, actions: ShopActions) => () => void;
  mainMenuRenderer?: (actions: MainMenuActions) => () => void;
}

export interface OverlayViews extends GameViews { dispose(): void }

export function createOverlayViews(deps: OverlayViewsDeps): OverlayViews {
  const { host } = deps;
  const { shopAssets } = deps;
  const { loadShopAssets } = deps;
  const { shopRenderer } = deps;
  const { mainMenuRenderer } = deps;
  let disposeShopRenderer: (() => void) | null = null;
  let disposeMainMenuRenderer: (() => void) | null = null;

  function disposeShop(): void {
    const dispose = disposeShopRenderer;
    disposeShopRenderer = null;
    dispose?.();
  }

  function disposeMainMenu(): void {
    const dispose = disposeMainMenuRenderer;
    disposeMainMenuRenderer = null;
    dispose?.();
  }

  function disposeTransientViews(): void {
    disposeMainMenu();
    disposeShop();
  }

  return {
    renderBoot(): BootHandle {
      disposeTransientViews();
      const page = buildBootPage(host);
      host.mount(page.view);
      return page.handle;
    },

    renderStart(actions: StartActions): StartHandle {
      disposeTransientViews();
      const page = buildStartPage(host, actions);
      host.mount(page.view, { transparent: true });
      return page.handle;
    },

    renderMainMenu(actions: MainMenuActions): void {
      disposeTransientViews();
      if (mainMenuRenderer) {
        host.mount(host.makeView(), { transparent: true });
        disposeMainMenuRenderer = mainMenuRenderer(actions);
        return;
      }
      host.mount(buildMainMenuPage(host, actions).view, { transparent: true });
    },

    renderSelect(
      content: GameContent,
      actions: SelectActions,
      currentCharId: string,
      entry: EntryMethod | null,
    ): void {
      disposeTransientViews();
      host.mount(buildSelectPage(host, { content, actions, currentCharId, entry }).view, { transparent: true });
    },

    renderShop(content, actions): void {
      disposeTransientViews();
      if (shopRenderer) {
        host.mount(host.makeView(), { transparent: true });
        disposeShopRenderer = shopRenderer(content, actions);
        return;
      }
      const page = buildShopPage(host, content, actions, shopAssets);
      host.mount(page.view);
      if (loadShopAssets) {
        void Promise.resolve().then(loadShopAssets).then(assets => {
          if (assets && host.overlay.current === page.view) page.setAssets(assets);
        }).catch(() => undefined);
      }
    },

    mountHud(): HudHandle {
      disposeTransientViews();
      const page = buildHudPage(host);
      host.mount(page.view, { transparent: true });
      return page.handle;
    },

    renderResult(summary: RunSummary, best: number, actions: ResultActions): void {
      disposeTransientViews();
      host.mount(buildResultPage(host, { summary, best, actions }).view);
    },

    toast(msg: string): void {
      host.toast(msg);
    },

    dispose(): void {
      disposeTransientViews();
    },
  };
}
