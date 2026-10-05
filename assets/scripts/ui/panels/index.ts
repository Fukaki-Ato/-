/**
 * 面板注册表：所有面板在此登记（S05–S09）。
 * 未登记的名字由调用方（如 MainMenu）降级为「开发中」Toast。
 */
import { PanelManager } from '../framework/PanelManager';
import { AchievementsPanel } from './AchievementsPanel';
import { ActivitiesPanel } from './ActivitiesPanel';
import { CharactersPanel } from './CharactersPanel';
import { LeaderboardPanel } from './LeaderboardPanel';
import { MainMenuPanel } from './MainMenuPanel';
import { PANEL_NAMES } from './panelNames';
import { RunSettlementPanel } from './RunSettlementPanel';
import { SettingsPanel } from './SettingsPanel';
import { ShopPanel } from './ShopPanel';
import { TasksPanel } from './TasksPanel';
import { WarehousePanel } from './WarehousePanel';
import { WelfarePanel } from './WelfarePanel';

export { PANEL_NAMES } from './panelNames';
export type { PanelName } from './panelNames';

export function registerAllPanels(): void {
  PanelManager.register(PANEL_NAMES.mainMenu, (ctx) => new MainMenuPanel(ctx));
  PanelManager.register(PANEL_NAMES.settings, (ctx) => new SettingsPanel(ctx));
  PanelManager.register(PANEL_NAMES.shop, (ctx) => new ShopPanel(ctx));
  PanelManager.register(PANEL_NAMES.warehouse, (ctx) => new WarehousePanel(ctx));
  PanelManager.register(PANEL_NAMES.characters, (ctx) => new CharactersPanel(ctx));
  PanelManager.register(PANEL_NAMES.welfare, (ctx) => new WelfarePanel(ctx));
  PanelManager.register(PANEL_NAMES.tasks, (ctx) => new TasksPanel(ctx));
  PanelManager.register(PANEL_NAMES.achievements, (ctx) => new AchievementsPanel(ctx));
  PanelManager.register(PANEL_NAMES.activities, (ctx) => new ActivitiesPanel(ctx));
  PanelManager.register(PANEL_NAMES.leaderboard, (ctx) => new LeaderboardPanel(ctx));
  PanelManager.register(PANEL_NAMES.runSettlement, (ctx) => new RunSettlementPanel(ctx));
}
