/**
 * GameViews —— 主流程对「页面视图」的结构化要求（@tr/game，S3 提取）。
 * S5：apps/web 与未来的 apps/wx 统一用 overlay 版实现（packages/game/src/ui/overlayViews.ts，
 * 基于 @tr/ui 自绘控件，两端同源）；DOM screens.ts 已退役。壳侧装配差异（renderer/canvas/
 * 输入注入）经 UiHost 端口进入，不扩本接口。
 * 本包受禁令约束：这里禁止出现任何 DOM/wx 类型，视图内部长什么样由实现方自决。
 */
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { RunnerSim } from '@tr/game/core/sim/runnerSim.js';
import type { RunCallbacks } from '@tr/game/render/runnerScene.js';
import type { EntryMethod } from './session.js';

/** 结算摘要（与 core RunnerSim.summary() 同源）；charName 由 mainFlow 查 characters 配置补入，供结果页显示 */
export type RunSummary = ReturnType<RunnerSim['summary']> & { charName?: string };
/** HUD 快照（与 render RunCallbacks.onHud 参数同源，避免双份定义漂移） */
export type HudData = Parameters<RunCallbacks['onHud']>[0];

/** 启动页句柄：setStatus(text, isError) —— 错误样式（换行/红色）属视图细节，由实现方自理 */
export interface BootHandle {
  setStatus(text: string, isError: boolean): void;
}

/** 开始页入口：恰好两项；wechatAvailable=false 时「微信登录」置灰（web 壳无真实微信登录） */
export interface StartActions {
  wechatAvailable: boolean;
  onWechat(): void;
  onGuest(): void;
}

/** 开始页句柄：登录进行中锁按钮 + 反馈行（失败停留本页显示原因） */
export interface StartHandle {
  setBusy(busy: boolean): void;
  setFeedback(text: string, isError: boolean): void;
}

export interface MainMenuActions {
  onStartRun(): void;
  onShop(): void;
  onUnsupported(): void;
}

export interface SelectActions {
  onStartRun(charId: string): void;
  /** Validate and persist an active-role choice made by the built-in lobby panel. */
  onChooseCharacter(charId: string): boolean;
  onBack(): void;
  onCharacterSelect?(): void;
  onShop?(): void;
}

export interface CharacterSelectPageActions {
  onSelect(charId: string): void;
  onStartRun(charId: string): void;
  onBack(): void;
  onShop(charId: string): void;
}

export interface ShopActions { onBack(): void }

/** 大厅页本机统计（mainFlow 从 storage 读出注入；视图不直接碰存储键定义方） */
export interface SelectExtras {
  coins: number;
  diamonds: number;
}

export interface ResultActions {
  onRetry(): void;
  onSelect(): void;
}

/**
 * 局内 HUD：挂载即创建（DOM 层 append 由实现方自理），dispose 即移除。
 * onCastSkill：技能图标点击回调（主动技能亮了可点）。缺省时图标只做状态展示。
 */
export interface HudHandle {
  update(h: HudData): void;
  dispose(): void;
}

/** mountHud 的入参：主动技能图标的点击出口 */
export interface HudActions {
  onCastSkill?(): void;
}

export interface GameViews {
  renderBoot(): BootHandle;
  renderStart(actions: StartActions): StartHandle;
  renderSelect(
    content: GameContent,
    actions: SelectActions,
    currentCharId: string,
    entry: EntryMethod | null,
    extras?: SelectExtras,
  ): void;
  renderCharacterSelectPage?(
    content: GameContent,
    actions: CharacterSelectPageActions,
    currentCharId: string,
    entry: EntryMethod | null,
  ): void;
  renderShop(content: GameContent, actions: ShopActions): void;
  mountHud(actions?: HudActions): HudHandle;
  renderResult(summary: RunSummary, best: number, actions: ResultActions): void;
  toast(msg: string): void;
}
