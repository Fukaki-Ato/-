import { Box, Button, type NinePatchSource } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { PlayerAccount } from '@tr/game/core/playerProfile.js';
import { createOverlayViews, type OverlayViewsDeps } from '@tr/game/ui/overlayViews.js';
import { buildCoastalLobby } from '@tr/game/ui/coastalLobby.js';
import { buildCoastalResult } from '@tr/game/ui/coastalResult.js';
import { mountLeaderboardPage } from '@tr/game/ui/leaderboardView.js';
import { mountWelfarePage } from '@tr/game/ui/welfareView.js';
import { buildHudPage } from '@tr/game/ui/hudView.js';
import type { WelfareService } from '@tr/game/core/welfare.js';
import type { CommerceService } from '@tr/game/core/commerce.js';
import { mountCommercePage } from '@tr/game/ui/commerceView.js';

/** 只改变页面的拥有标记；模拟与规则版本始终使用未经改写的原配置。 */
export function contentForAccount(content: GameContent, account: PlayerAccount): GameContent {
  const owned = new Set(account.read().inventory.characters);
  return { ...content, characters: { ...content.characters, items: content.characters.items?.map(character =>
    character.id.startsWith('char_') && !owned.has(character.id) ? { ...character, locked: true } : character) } };
}

export function createWxGameViews(host: UiHost, art: Pick<OverlayViewsDeps, 'badges' | 'backdrop'> & {
  portraits?: Partial<Record<string, NinePatchSource>> },
  account?: PlayerAccount, welfare?: WelfareService, finishRun?: () => boolean, commerce?: CommerceService) {
  let currentContent: GameContent | undefined;
  const base = createOverlayViews({
    host, ...art,
    lobbyRenderer(content, actions, currentCharId, extras) {
      host.mount(buildCoastalLobby(host, { content, actions, currentCharId, extras, portraits: art.portraits }).view);
      return () => {};
    },
    leaderboardRenderer: (service, actions) => mountLeaderboardPage(host, service, actions.onBack, { portraits: art.portraits }),
    welfareRenderer: (mode, actions) => mountWelfarePage(host, welfare, mode, actions.onBack),
    shopRenderer: (content, actions) => mountCommercePage(host, commerce, 'shop', actions,
      { content, portraits: art.portraits }),
    inventoryRenderer: actions => mountCommercePage(host, commerce, 'inventory', actions,
      { content: currentContent, portraits: art.portraits }),
    ...(commerce ? {
      selectRenderer: (content, actions) => mountCommercePage(host, commerce, 'characters', {
        onBack: actions.onBack, onStartRun: actions.onStartRun, onShop: actions.onShop, onSelected: actions.onSelect,
      }, { content, portraits: art.portraits }),
      settingsRenderer: (content, actions) => mountCommercePage(host, commerce, 'settings', {
        onBack: actions.onBack, onThemeSelected: actions.onSelectTheme,
      }, { content, portraits: art.portraits }),
    } satisfies Partial<OverlayViewsDeps> : {}),
    hudRenderer() {
      const page = buildHudPage(host, { touchOnly: true });
      if (finishRun) page.view.add(new Box({ absolute: true, left: 16, bottom: 16 }, [
        new Button({ label: '结束本局', fontSizePx: 14, height: 44, onClick: () => { finishRun(); } }),
      ]));
      host.mount(page.view, { transparent: true });
      return page.handle;
    },
    resultRenderer(summary, best, actions) {
      let active = true;
      const draw = (): void => {
        if (active) host.mount(buildCoastalResult(host, { summary, best, actions, portraits: art.portraits }).view);
      };
      draw();
      const unsubscribe = summary.ranking?.subscribe(draw);
      return () => { active = false; unsubscribe?.(); };
    },
  });
  return {
    ...base,
    renderSelect: (...args: Parameters<typeof base.renderSelect>): void => {
      currentContent = args[0];
      if (account) args[0] = contentForAccount(args[0], account);
      base.renderSelect(...args);
    },
  };
}
