import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import type { SceneDef } from '../core/scene/sceneMachine.js';
import type { GameViews } from './views.js';
import { wechatAvailable, wechatLogin, type EntryMethod } from './session.js';

/** 保留旧登录页的异步代次与离页语义，主流程默认仍直入大厅。 */
export function createStartScene(adapter: PlatformAdapter, views: GameViews,
  enterSelect: (method: EntryMethod) => void, isCurrent: () => boolean): SceneDef {
  let generation = 0;
  return {
    onEnter() {
      const gen = ++generation, canWechat = wechatAvailable(adapter);
      let busy = false;
      const handle = views.renderStart({
        wechatAvailable: canWechat,
        onGuest: () => { if (!busy) enterSelect('guest'); },
        onWechat: () => {
          if (!canWechat || busy) return;
          busy = true; handle.setBusy(true); handle.setFeedback('微信登录中…', false);
          wechatLogin(adapter).then(
            () => { if (gen === generation && isCurrent()) enterSelect('wechat'); },
            (error: unknown) => {
              if (gen !== generation || !isCurrent()) return;
              busy = false; handle.setBusy(false);
              const message = error instanceof Error ? error.message : String(error);
              handle.setFeedback(`微信登录失败：${message}。可重试，或选择游客登录`, true);
            },
          );
        },
      });
    },
    onExit() { generation++; },
  };
}
