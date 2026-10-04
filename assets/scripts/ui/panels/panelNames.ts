/**
 * 面板名常量（独立文件：避免 index.ts 与各面板之间的循环引用）。
 * 对外仍可从 `../panels`（index.ts）统一导入。
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
