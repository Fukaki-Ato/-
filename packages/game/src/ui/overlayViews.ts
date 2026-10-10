/**
 * GameViews 的 overlay 版实现（S5，两端同源）：把五页面装配接到 UiHost。
 * 页面代码全部来自同目录 ui/*（@tr/ui 控件树），本文件只做「场景机视图接口 ↔ 页面构造器」胶水。
 * 主界面额外挂分层背景动效（menuBackdrop）：网格进宿主现有场景、时间走 mount 的 frame
 * 回调——页面卸载时 frame 钩子随宿主清空、动效对象在此 dispose，天然「离开即暂停」。
 * 本包受禁令约束：零 DOM/wx。
 */
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type {
  BootHandle, GameViews, HudHandle, ResultActions, RunSummary, SelectActions, SelectExtras, StartActions, StartHandle,
} from '../flow/views.js';
import type { EntryMethod } from '../flow/session.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import { buildBootPage } from './bootView.js';
import { buildStartPage } from './startView.js';
import { buildLobbyPage } from './lobbyView.js';
import { buildHudPage } from './hudView.js';
import { buildResultPage } from './resultView.js';
import { createMenuBackdrop, type BackdropSet, type MenuBackdrop } from './menuBackdrop.js';
import type { BadgeSet } from './badges.js';

export interface OverlayViewsDeps {
  host: UiHost;
  /** 大厅徽标贴图（壳侧加载注入；缺省时徽标位退化为空槽） */
  badges?: BadgeSet;
  /** 主界面背景贴图（Web 为循环视频；缺省回主题纯色底） */
  backdrop?: BackdropSet;
  /**
   * 「现在是不是主界面」的通报口：背景是循环视频，而视频元素只能待在壳层
   * （本包禁令：零 DOM），所以由壳层注入回调，视图只报可见性。缺省＝没人管视频。
   */
  onLobbyVisible?(visible: boolean): void;
}

export type OverlayViews = GameViews;

export function createOverlayViews(deps: OverlayViewsDeps): OverlayViews {
  const { host } = deps;
  let backdrop: MenuBackdrop | null = null;
  const lobby = (visible: boolean): void => deps.onLobbyVisible?.(visible);
  const stopBackdrop = (): void => { backdrop?.dispose(); backdrop = null; lobby(false); };

  return {
    renderBoot(): BootHandle {
      stopBackdrop();
      const page = buildBootPage(host);
      host.mount(page.view);
      return page.handle;
    },

    renderStart(actions: StartActions): StartHandle {
      stopBackdrop();
      const page = buildStartPage(host, actions);
      host.mount(page.view);
      return page.handle;
    },

    renderSelect(
      content: GameContent,
      actions: SelectActions,
      currentCharId: string,
      _entry: EntryMethod | null,
      extras?: SelectExtras,
    ): void {
      const page = buildLobbyPage(host, {
        content,
        actions,
        currentCharId,
        extras: { coins: extras?.coins ?? 0, diamonds: extras?.diamonds ?? 0, badges: deps.badges },
      });
      stopBackdrop();
      let frame: ((t: number) => void) | undefined;
      if (deps.backdrop) {
        backdrop = createMenuBackdrop(host.overlay.scene, host.overlay.camera, deps.backdrop);
        const bd = backdrop;
        frame = t => bd.step(t);
      }
      host.mount(page.view, { frame });
      lobby(true);
    },

    mountHud(): HudHandle {
      stopBackdrop();
      const page = buildHudPage(host);
      host.mount(page.view, { transparent: true });
      return page.handle;
    },

    renderResult(summary: RunSummary, best: number, actions: ResultActions): void {
      stopBackdrop();
      host.mount(buildResultPage(host, { summary, best, actions }).view);
    },

    toast(msg: string): void {
      host.toast(msg);
    },
  };
}
