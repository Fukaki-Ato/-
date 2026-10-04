/**
 * 面板注册表。
 * S05+ 在各面板文件中实现 BasePanel 后，在 registerAllPanels 内调用
 * `PanelManager.register(PANEL_NAMES.xxx, (ctx) => new XxxPanel(ctx))` 登记。
 * 未登记的名字由调用方（如 MainMenu）降级为「开发中」Toast。
 */
export const PANEL_NAMES = {
  boot: 'Boot',
  mainMenu: 'MainMenu',
  settings: 'Settings',
  shop: 'Shop',
  warehouse: 'Warehouse',
  characters: 'Characters',
  welfare: 'Welfare',
  tasks: 'Tasks',
  achievements: 'Achievements',
  activities: 'Activities',
  leaderboard: 'Leaderboard',
  runSettlement: 'RunSettlement',
} as const;

export type PanelName = (typeof PANEL_NAMES)[keyof typeof PANEL_NAMES];

export function registerAllPanels(): void {
  // S05: PanelManager.register(PANEL_NAMES.mainMenu, (ctx) => new MainMenuPanel(ctx));
  // S05: PanelManager.register(PANEL_NAMES.settings, (ctx) => new SettingsPanel(ctx));
  // S06+: Shop / Warehouse / Characters ...
}
