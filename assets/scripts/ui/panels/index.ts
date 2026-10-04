/**
 * 面板注册表。
 * S05+ 在各面板文件中实现 BasePanel 后，在 registerAllPanels 内调用
 * `PanelManager.register(PANEL_NAMES.xxx, (ctx) => new XxxPanel(ctx))` 登记。
 * 未登记的名字由调用方（如 MainMenu）降级为「开发中」Toast。
 */
import { PanelManager } from '../framework/PanelManager';
import { MainMenuPanel } from './MainMenuPanel';
import { PANEL_NAMES } from './panelNames';
import { SettingsPanel } from './SettingsPanel';

export { PANEL_NAMES } from './panelNames';
export type { PanelName } from './panelNames';

export function registerAllPanels(): void {
  PanelManager.register(PANEL_NAMES.mainMenu, (ctx) => new MainMenuPanel(ctx));
  PanelManager.register(PANEL_NAMES.settings, (ctx) => new SettingsPanel(ctx));
  // S06+: Shop / Warehouse / Characters / Welfare / Tasks / Achievements / Activities / Leaderboard / RunSettlement
}
