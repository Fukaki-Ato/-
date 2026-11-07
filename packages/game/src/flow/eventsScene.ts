/**
 * 活动场景（登录签到，审查 M4-6）：状态/领取在 localEconomy，本文件只装配视图回调
 * （从 mainFlow 拆出：场景装配签名与 settingsScene 同式，保 mainFlow 行数预算）。
 */
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { GameViews } from './views.js';
import { claimSignIn, signInState } from './signIn.js';

export function createEventsScene(deps: {
  adapter: Pick<PlatformAdapter, 'storage'>;
  views: GameViews;
  content: () => GameContent | null;
  goSelect: () => void;
}): { onEnter(): void } {
  const { adapter, views } = deps;
  return {
    onEnter: () => {
      const content = deps.content();
      if (!content || !views.renderEvents) { deps.goSelect(); return; }
      // 签到数据/领取都在本机经济层；视图领完经 state() 自查刷新
      views.renderEvents(content, {
        onBack: deps.goSelect,
        state: () => signInState(adapter.storage, content, new Date()),
        onClaim: () => claimSignIn(adapter.storage, content, new Date()),
      });
    },
  };
}
