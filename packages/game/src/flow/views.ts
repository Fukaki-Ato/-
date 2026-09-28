/**
 * GameViews —— 主流程对「页面视图」的结构化要求（@tr/game，S3 提取；S5 起接口不变）。
 * S5：apps/web 与未来的 apps/wx 统一用 overlay 版实现（packages/game/src/ui/overlayViews.ts，
 * 基于 @tr/ui 自绘控件，两端同源）；DOM screens.ts 已退役。壳侧装配差异（renderer/canvas/
 * 输入注入/onKey）经 UiHost 端口进入，不扩本接口。
 * 本包受禁令约束：这里禁止出现任何 DOM/wx 类型，视图内部长什么样由实现方自决。
 */
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { FileSource } from '@tr/game/core/config/configLoader.js';
import type { RunnerSim } from '@tr/game/core/sim/runnerSim.js';
import type { RunCallbacks } from '@tr/game/render/runnerScene.js';

/** 结算摘要（与 core RunnerSim.summary() 同源）；charName 由 mainFlow 查 characters 配置补入，供结果页显示 */
export type RunSummary = ReturnType<RunnerSim['summary']> & { charName?: string };
/** HUD 快照（与 render RunCallbacks.onHud 参数同源，避免双份定义漂移） */
export type HudData = Parameters<RunCallbacks['onHud']>[0];

export interface MenuActions {
  onStartRun(charId: string): void;
  onClearCache(): void;
}

/** 启动页句柄：setStatus(text, isError) —— 错误样式（换行/红色）属视图细节，由实现方自理 */
export interface BootHandle {
  setStatus(text: string, isError: boolean): void;
}

/** 登录页句柄：submit = 「回车提交」入口（v1 的 .btn-primary DOM click hack 收进视图实现，S10 §7.4） */
export interface LoginHandle {
  submit(): void;
}

/** 局内 HUD：挂载即创建（DOM 层 append 由实现方自理），dispose 即移除 */
export interface HudHandle {
  update(h: HudData): void;
  dispose(): void;
}

export interface GameViews {
  renderBoot(): BootHandle;
  renderLogin(actions: { onGuest(): void }): LoginHandle;
  renderMenu(
    content: GameContent,
    sources: Record<string, FileSource>,
    actions: MenuActions,
    currentCharId: string,
  ): void;
  mountHud(): HudHandle;
  renderResult(summary: RunSummary, best: number, actions: { onRetry(): void; onMenu(): void }): void;
  toast(msg: string): void;
}
