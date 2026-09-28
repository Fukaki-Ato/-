/**
 * GameViews 的 overlay 版实现（S5，两端同源）：把五页面装配接到 UiHost。
 * 页面代码全部来自同目录 ui/*（@tr/ui 控件树），本文件只做「场景机视图接口 ↔ 页面构造器」胶水。
 * 接口外扩展（壳侧注入）：
 * - onKey(code)：web 壳把 adapter key-down 事件转发进来（Esc 退出在 mainFlow，Enter 在登录页内）；
 * - submitLogin()：与 onKey('Enter') 等价的编程入口（保留 DOM 版 LoginHandle.submit 语义）。
 */
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { FileSource } from '@tr/game/core/config/configLoader.js';
import type {
  BootHandle, GameViews, HudHandle, LoginHandle, MenuActions, RunSummary,
} from '../flow/views.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import { buildBootPage } from './bootView.js';
import { buildLoginPage } from './loginView.js';
import { buildMenuPage } from './menuView.js';
import { buildHudPage } from './hudView.js';
import { buildResultPage } from './resultView.js';

export interface OverlayViewsDeps {
  host: UiHost;
  /** wx 侧注入 WxExtras.login 占位（guest 模式）；web 侧不传（保留测试 openid 手输） */
  autoLogin?: () => Promise<string>;
}

export interface OverlayViews extends GameViews {
  onKey(code: string): void;
  submitLogin(): void;
}

export function createOverlayViews(deps: OverlayViewsDeps): OverlayViews {
  const { host } = deps;
  let login: { handle: LoginHandle; onKey(code: string): void } | null = null;

  return {
    renderBoot(): BootHandle {
      const page = buildBootPage(host);
      host.mount(page.view);
      return page.handle;
    },

    renderLogin(actions: { onGuest(): void }): LoginHandle {
      const page = buildLoginPage(host, { actions, autoLogin: deps.autoLogin });
      host.mount(page.view, { frame: page.frame });
      login = page;
      return page.handle;
    },

    renderMenu(
      content: GameContent,
      sources: Record<string, FileSource>,
      actions: MenuActions,
      currentCharId: string,
    ): void {
      login = null;
      host.mount(buildMenuPage(host, { content, sources, actions, currentCharId }).view);
    },

    mountHud(): HudHandle {
      login = null;
      const page = buildHudPage(host);
      host.mount(page.view, { transparent: true });
      return page.handle;
    },

    renderResult(summary: RunSummary, best: number, actions: { onRetry(): void; onMenu(): void }): void {
      host.mount(buildResultPage(host, { summary, best, actions }).view);
    },

    toast(msg: string): void {
      host.toast(msg);
    },

    onKey(code: string): void {
      // 页面级 keymap：目前仅登录页消费（录入 + Enter 提交）；其余页面 Esc 由 mainFlow 处理
      if (login) login.onKey(code);
    },

    submitLogin(): void {
      login?.handle.submit();
    },
  };
}
