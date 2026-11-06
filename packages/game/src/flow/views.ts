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
import type { LeaderboardService, RankingFeedback } from './leaderboard.js';
import type { FirstCoinStats } from '../core/sim/firstCoinRecord.js';
import type { SignInState } from './signIn.js';

/** 结算摘要（与 core RunnerSim.summary() 同源）；charName 由 mainFlow 查 characters 配置补入，供结果页显示 */
export type RunSummary = ReturnType<RunnerSim['summary']> & {
  charName?: string; ranking?: RankingFeedback; beforeFirstCoin?: FirstCoinStats;
};
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
  /** Validate and persist a role choice made by the built-in lobby panel. */
  onChooseCharacter(charId: string): boolean;
  onBack(): void;
  onCharacterSelect?(): void;
  onShop?(): void;
  onTasks?(): void;
  /** 打开限时活动页（大厅「活动」入口）；缺省＝该入口只有按压反馈 */
  onEvents?(): void;
  /** 打开设置页（右上「设置」徽标）；缺省＝该入口只有按压反馈 */
  onSettings?(): void;
  onLeaderboard?(): void;
}

export interface CharacterSelectPageActions {
  onSelect(charId: string): void;
  onStartRun(charId: string): void;
  onBack(): void;
  onShop(charId: string): void;
  /** 解锁门槛（本机经济，localEconomy）：视图据此把「出战」换成「解锁/合成」并显示价格 */
  isGated?(charId: string): boolean;
  gatedPriceText?(charId: string): string;
  canUnlock?(charId: string): boolean;
  onUnlock?(charId: string): { ok: boolean; message: string };
  onSynthesize?(charId: string): { ok: boolean; message: string };
}

/** 本机钱包快照（商店购买按钮可用态与余额显示用） */
export interface WalletView { coins: number; keys: number; diamonds: number }

export interface BuyResult { ok: boolean; message: string }

export interface ShopActions {
  onBack(): void;
  wallet(): WalletView;
  /** 本机购买（限购/余额/发货都在流程层）；视图消费返回的 message */
  onBuy(offerId: string): BuyResult;
}

/** 活动页动作（签到等）：state() 每次取最新签到视图（领取后由视图自查刷新） */
export interface EventsActions {
  onBack(): void;
  onClaim(): BuyResult;
  state(): SignInState | null;
}

/** 设置页音量声道（存储与音频面同名语义：music＝BGM，sfx＝一次性音效） */
export type VolumeKind = 'music' | 'sfx';

/** 生效音量（0..1）：流程从本机记忆 + 配置默认解析后传给设置页展示 */
export interface VolumeSettings {
  music: number;
  sfx: number;
}

/** 设置页动作：返回大厅；选定跑酷场景主题；调节音量（流程校验并写本机记忆，返回是否生效） */
export interface SettingsActions {
  onBack(): void;
  onSelectTheme(themeId: string): boolean;
  /** value ∈ 0..1；流程落盘整数百分比并回 true，非法声道/值回 false（视图保持原显示） */
  onSetVolume(kind: VolumeKind, value: number): boolean;
}

/** 大厅页本机统计（mainFlow 从 storage 读出注入；视图不直接碰存储键定义方） */
export interface SelectExtras {
  coins: number;
  diamonds: number;
}

export interface ResultActions {
  onRetry(): void;
  onSelect(): void;
  onLeaderboard?(): void;
}

/** 局内 HUD：挂载即创建（DOM 层 append 由实现方自理），dispose 即移除 */
export interface HudHandle {
  update(h: HudData): void;
  dispose(): void;
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
  /** 活动页（登录签到等）；缺省＝大厅「活动」入口只有按压反馈 */
  renderEvents?(content: GameContent, actions: EventsActions): void;
  /** 设置页（每个游戏都必须有）：切换跑酷场景 + 音量；currentThemeId/volumePrefs 为流程解析出的生效值 */
  renderSettings(
    content: GameContent,
    actions: SettingsActions,
    currentThemeId: string | null,
    volumePrefs?: VolumeSettings,
  ): void;
  renderLeaderboard?(service: LeaderboardService, actions: { onBack(): void }): void;
  mountHud(): HudHandle;
  renderResult(summary: RunSummary, best: number, actions: ResultActions): void;
  toast(msg: string): void;
}
