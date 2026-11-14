/**
 * 开始场景（从 mainFlow 抽出，settingsScene/eventsScene 同式装配）：品牌封面 + 微信/游客两入口。
 * ⚠startGen 代次线程随场景整体迁移：原 mainFlow 闭包状态 `let startGen` 的全部读写都在
 * start.onEnter 闭包内（无外部读者），故移入本工厂闭包——登录 promise 回来时若已离开/重进
 * 开始页则丢弃结果（gen 挡重进，deps.atStart 挡中途离开，行为与抽取前等价）。
 * enterSelect 留在 mainFlow（触及 entry/saveEntry 状态且 boot 内联赋值依赖 entry），经 deps.goSelect 传入。
 */
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import type { SceneDef } from '@tr/game/core/scene/sceneMachine.js';
import type { GameViews } from './views.js';
import { wechatAvailable, wechatLogin, type EntryMethod } from './session.js';

export interface StartSceneDeps {
  adapter: Pick<PlatformAdapter, 'env' | 'extras'>;
  views: GameViews;
  /** 入口选择落库并跳主界面（mainFlow.enterSelect：写 ENTRY_KEY + machine.go('select')） */
  goSelect(method: EntryMethod): void;
  /** 是否仍在开始页（代次守卫的另一半：登录 promise 回来时场景可能已被切走） */
  atStart(): boolean;
}

export function createStartScene(d: StartSceneDeps): SceneDef {
  /** 开始页进入代次：每次 onEnter 递增，旧 promise 的结果按 gen 丢弃 */
  let startGen = 0;
  return {
    onEnter: () => {
      const gen = ++startGen;
      const canWechat = wechatAvailable(d.adapter);
      let busy = false;
      const handle = d.views.renderStart({
        wechatAvailable: canWechat,
        onGuest: () => { if (!busy) d.goSelect('guest'); },
        onWechat: () => {
          if (!canWechat || busy) return;
          busy = true;
          handle.setBusy(true);
          handle.setFeedback('微信登录中…', false);
          wechatLogin(d.adapter).then(
            () => { if (gen === startGen && d.atStart()) d.goSelect('wechat'); },
            (err: unknown) => {
              if (gen !== startGen || !d.atStart()) return;
              busy = false;
              handle.setBusy(false);
              const msg = err instanceof Error ? err.message : String(err);
              handle.setFeedback(`微信登录失败：${msg}。可重试，或选择游客登录`, true);
            },
          );
        },
      });
    },
  };
}
