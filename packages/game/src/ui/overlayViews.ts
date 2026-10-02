/**
 * GameViews 的 overlay 版实现（S5，两端同源）：把五页面装配接到 UiHost。
 * 页面代码全部来自同目录 ui/*（@tr/ui 控件树），本文件只做「场景机视图接口 ↔ 页面构造器」胶水。
 * 页面均为点击交互（开始页两个入口按钮、选角卡片），无文本录入，故不再需要壳侧 onKey 转发；
 * 局内 Esc 由 mainFlow 经 adapter.onInput 处理。
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
import type { IconSet } from './icons.js';
import type { NinePatchSource } from '@tr/framework/ui/index.js';

export interface OverlayViewsDeps {
  host: UiHost;
  /** 大厅图标贴图（壳侧加载注入；缺省时图标位退化为空槽） */
  icons?: IconSet;
  /** 大厅背景图贴图（壳侧加载注入；缺省回主题纯色底） */
  background?: NinePatchSource;
}

export type OverlayViews = GameViews;

export function createOverlayViews(deps: OverlayViewsDeps): OverlayViews {
  const { host } = deps;

  return {
    renderBoot(): BootHandle {
      const page = buildBootPage(host);
      host.mount(page.view);
      return page.handle;
    },

    renderStart(actions: StartActions): StartHandle {
      const page = buildStartPage(host, actions);
      host.mount(page.view);
      return page.handle;
    },

    renderSelect(
      content: GameContent,
      actions: SelectActions,
      currentCharId: string,
      entry: EntryMethod | null,
      extras?: SelectExtras,
    ): void {
      host.mount(buildLobbyPage(host, {
        content,
        actions,
        currentCharId,
        entry,
        extras: { coins: extras?.coins ?? 0, diamonds: extras?.diamonds ?? 0, icons: deps.icons, background: deps.background },
      }).view);
    },

    mountHud(): HudHandle {
      const page = buildHudPage(host);
      host.mount(page.view, { transparent: true });
      return page.handle;
    },

    renderResult(summary: RunSummary, best: number, actions: ResultActions): void {
      host.mount(buildResultPage(host, { summary, best, actions }).view);
    },

    toast(msg: string): void {
      host.toast(msg);
    },
  };
}
