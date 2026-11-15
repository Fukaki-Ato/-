/**
 * GameViews —— 主流程对「页面视图」的结构化要求（@tr/game，S3 提取）。
 * S5：apps/web 与未来的 apps/wx 统一用 overlay 版实现（packages/game/src/ui/overlayViews.ts，
 * 基于 @tr/ui 自绘控件，两端同源）；DOM screens.ts 已退役。壳侧装配差异（renderer/canvas/
 * 输入注入）经 UiHost 端口进入，不扩本接口。
 * 本包受禁令约束：这里禁止出现任何 DOM/wx 类型，视图内部长什么样由实现方自决。
 */
import type { AchievementGroup, AchievementSource, AchievementTier, GameContent } from '@tr/game/core/config/configTypes.js';
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
  /** 打开成就页（大厅「成就」勋章）；缺省＝该入口不亮（mainFlow 侧按 views.renderAchievements && 成就 API 同条件置空） */
  onAchievements?(): void;
  /** 打开宝箱页（大厅底栏「宝箱」格）；缺省＝该入口只有按压反馈 */
  onChest?(): void;
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
  canSynthesize?(charId: string): boolean;
  onUnlock?(charId: string): { ok: boolean; message: string };
  onSynthesize?(charId: string): { ok: boolean; message: string };
}

/** 本机钱包快照（商店购买按钮可用态与余额显示用） */
export interface WalletView { coins: number; keys: number; diamonds: number }

export interface BuyResult { ok: boolean; message: string }

/** 单个商品的限购快照（购买按钮可用态与「今日剩余」文案用） */
export interface OfferPurchaseView {
  /** 剩余可购次数：null=不限购；0=已售罄（once 已购或 perDay 用完） */
  remaining: number | null;
  perDay: number | null;
  boughtToday: number;
  /** once 型商品是否已购买 */
  oncePurchased: boolean;
}

/** 道具强化卡快照（道具栏：+0.5s/次、进度条与阶梯价） */
export interface ItemUpgradeView {
  /** 已强化次数（0 基进度） */
  count: number;
  max: number;
  /** 下一次强化的能量币价格 */
  priceCoin: number;
  /** 当前时长加成（秒） */
  bonusS: number;
}

/** 角色碎片卡快照（进度条/自动合成/升级一体） */
export interface ShardCardView {
  charId: string;
  owned: boolean;
  level: number;
  maxLevel: number;
  /** 当前碎片余额 */
  shards: number;
  /** 合成门槛 = 每级升级消耗（统一 50） */
  step: number;
  /** 每包碎片数与能量币价格（视图拼价格文案） */
  packSize: number;
  packPriceCoin: number;
}

/** 场景卡快照（商店场景分类：1000 能量币解锁，设置页切换校验同口径） */
export interface ThemeCardView {
  themeId: string;
  /** 已解锁（解锁表里有，或正在使用中的主题视为已拥有） */
  owned: boolean;
  /** 当前生效中的场景（下一局用它） */
  active: boolean;
  /** 解锁价（能量币，来自 themes.json price） */
  priceCoin: number;
}

/** 角色本体卡快照（商店角色分类：coin/key 直接解锁，loot/event 引导攒碎片） */
export interface CharacterCardView {
  charId: string;
  owned: boolean;
  /** 解锁途径：coin/key 可直接买；loot/event/free 只展示 */
  unlockKind: 'coin' | 'key' | 'loot' | 'event' | 'free';
  /** 解锁价文案（如「4500金币」「3把钥匙」「宝箱产出」「活动解锁」） */
  priceText: string;
}

export interface ShopActions {
  onBack(): void;
  wallet(): WalletView;
  /** 本机购买（限购/余额/发货都在流程层）；视图消费返回的 message */
  onBuy(offerId: string): BuyResult;
  /** 限购快照（可选：缺省时视图按不限购渲染，最小测试壳不必实现） */
  purchaseState?(offerId: string): OfferPurchaseView | null;
  /** 道具强化（可选）：快照/购买/升级链 */
  itemUpgradeState?(itemId: string): ItemUpgradeView | null;
  onBuyItemUpgrade?(itemId: string): BuyResult;
  /** 角色碎片卡（可选）：进度快照/买碎片包/碎片升级 */
  shardCardState?(charId: string): ShardCardView | null;
  onBuyShardPack?(charId: string): BuyResult;
  onUpgradeCharacter?(charId: string): BuyResult;
  /** 场景卡（可选）：解锁快照/购买（1000 能量币，配置 price 可调） */
  themeCardState?(themeId: string): ThemeCardView | null;
  onBuyTheme?(themeId: string): BuyResult;
  /** 角色本体卡（可选）：解锁快照/直接解锁（coin/key 型） */
  characterCardState?(charId: string): CharacterCardView | null;
  onUnlockCharacter?(charId: string): BuyResult;
}

/** 活动页动作（签到等）：state() 每次取最新签到视图（领取后由视图自查刷新） */
export interface EventsActions {
  onBack(): void;
  onClaim(): BuyResult;
  state(): SignInState | null;
}

/** 成就页单行进度（场景层合并服务端快照与本机 totals 后传入；视图不碰存储/API） */
export interface AchievementRowView {
  id: string;
  name: string;
  desc: string;
  tier: AchievementTier;
  group: AchievementGroup;
  source: AchievementSource;
  target: number;
  progress: number;
  /** 已领取（run 类以服务端为准；离线时 run 条目按未领展示，联网重进即校正） */
  claimed: boolean;
  /** 可领取：达标、未领、且（run 类）服务端快照可用 */
  claimable: boolean;
  /** 达标但服务端不可得（离线口径）：领取按钮置灰而非隐藏 */
  locked: boolean;
  /** 受理中（run 条目乐观受理→快照回包之间）：领取按钮置灰防连点（服务端幂等，重复 POST 仍属冗余） */
  claiming: boolean;
  rewardText: string;
}

/** 成就页分节（UI 骨架标题由场景层给出，两端视图共用一份文案） */
export interface AchievementSectionView {
  group: AchievementGroup;
  title: string;
  note: string;
  rows: AchievementRowView[];
}

/** 成就页整页数据（场景层算好，canvas/DOM 两端视图只做布局） */
export interface AchievementsPageView {
  sections: AchievementSectionView[];
  rows: AchievementRowView[];
  /** 服务端快照不可得：页面状态行提示，run 类领取置灰 */
  offline: boolean;
  offlineMessage: string;
  /** 最近一次需随整页重绘保留的状态行消息（load 失败原因/领取提示）；缺省=offlineMessage/联网说明的默认口径 */
  statusMessage?: string;
  claimedCount: number;
  total: number;
}

/** 成就页动作：onClaim 返回 {ok,message}（BuyResult 语义，同商店/签到） */
export interface AchievementsActions {
  onBack(): void;
  onClaim(achievementId: string): BuyResult;
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
  /** 场景是否可用（商店解锁表或当前主题；可选——未实现时设置页不做锁定标记） */
  isThemeUnlocked?(themeId: string): boolean;
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
  /** 成就页（大厅「成就」勋章）；缺省＝该入口不亮（防死按钮） */
  renderAchievements?(content: GameContent, page: AchievementsPageView, actions: AchievementsActions): void;
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
