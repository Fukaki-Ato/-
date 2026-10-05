import { Button, Color, Graphics, Node, SafeArea, Widget } from 'cc';
import type { GameplayLaunchOptions, ItemId, RedDotKey } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';
import { delay } from '../../core/framework/Utils';
import { applySprite } from '../framework/Assets';
import { AudioService } from '../framework/AudioService';
import { BasePanel } from '../framework/BasePanel';
import { CurrencyBar } from '../framework/CurrencyBar';
import { LoadingMask } from '../framework/LoadingMask';
import { PanelManager } from '../framework/PanelManager';
import { RedDots } from '../framework/RedDots';
import { Theme } from '../framework/Theme';
import { Toast } from '../framework/Toast';
import { label, node, stretch } from '../framework/UIKit';
import { PANEL_NAMES } from './panelNames';
import { openSettlementPanel } from './RunFlow';

const log = new Logger();

/** useItem 写入的待生效道具前缀（docs/03 §2.6）。 */
const PENDING_BUFF_PREFIX = 'pendingBuff.';
/** 单个 buff 单局最多携带份数（防脏存档撑爆 items）。 */
const MAX_BUFF_STACK = 99;
/** preload 等待上限（docs/06 §4：超时忽略继续进入）。 */
const PRELOAD_TIMEOUT_MS = 3000;

const DESIGN_W = Theme.size.designWidth;
const DESIGN_H = Theme.size.designHeight;

/** 背景缺失时的占位色（天空/海面/沙滩三段）。 */
const BG_SKY = new Color(78, 195, 247, 255);
const BG_SEA = new Color(96, 200, 240, 255);
const BG_SAND = new Color(245, 208, 122, 255);
/** 底部导航木条（占位样式，素材到位后可替换）。 */
const NAV_WOOD = new Color(122, 74, 43, 235);

interface WidgetSpec {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  centerX?: boolean;
  /** 水平居中时的垂直偏移（使用 AlignVerticalCenter）。 */
  centerY?: number;
}

function alignWidget(target: Node, spec: WidgetSpec): Widget {
  const widget = target.getComponent(Widget) ?? target.addComponent(Widget);
  if (spec.top !== undefined) {
    widget.isAlignTop = true;
    widget.top = spec.top;
  }
  if (spec.bottom !== undefined) {
    widget.isAlignBottom = true;
    widget.bottom = spec.bottom;
  }
  if (spec.left !== undefined) {
    widget.isAlignLeft = true;
    widget.left = spec.left;
  }
  if (spec.right !== undefined) {
    widget.isAlignRight = true;
    widget.right = spec.right;
  }
  if (spec.centerX) {
    widget.isAlignHorizontalCenter = true;
    widget.horizontalCenter = 0;
  }
  if (spec.centerY !== undefined) {
    widget.isAlignVerticalCenter = true;
    widget.verticalCenter = spec.centerY;
  }
  widget.alignMode = Widget.AlignMode.ALWAYS;
  return widget;
}

function drawRoundRect(target: Node, width: number, height: number, color: Color, radius: number, stroke?: Color): void {
  const g = target.getComponent(Graphics) ?? target.addComponent(Graphics);
  const r = Math.min(radius, Math.min(width, height) / 2);
  g.fillColor = color;
  g.roundRect(-width / 2, -height / 2, width, height, r);
  g.fill();
  if (stroke) {
    g.strokeColor = stroke;
    g.lineWidth = 3;
    g.roundRect(-width / 2, -height / 2, width, height, r);
    g.stroke();
  }
}

/**
 * 主界面面板（docs/04 §3.2，对应设计截图）：
 * 顶部货币条 + 设置、两侧活动/任务/成就/排行榜、中央开始酷跑、底部四入口。
 * 未实现面板入口降级为「开发中」Toast；所有入口走 RedDots 绑定。
 */
export class MainMenuPanel extends BasePanel {
  private startButton: Button | null = null;
  private running = false;

  protected override onCreate(): void {
    this.buildBackground();
    const safe = this.buildSafeAreaHost();
    this.buildTopBar(safe);
    this.buildSideEntries(safe);
    this.buildStartButton(safe);
    this.buildBottomNav(safe);
    this.buildDebugBadge(safe);
  }

  protected override onOpen(): void {
    // BGM 延后到主界面打开时播放（素材缺失静默）。
    AudioService.playBgm(Theme.assets.bgmMain);
  }

  // -------------------------------------------------------------------------
  // 布局
  // -------------------------------------------------------------------------

  private buildBackground(): void {
    const bg = node('Background', { parent: this.node, size: { width: DESIGN_W, height: DESIGN_H } });
    stretch(bg);
    const g = bg.addComponent(Graphics);
    // 覆盖整屏的三段占位；实际背景图就位后覆盖其上。
    g.fillColor = BG_SKY;
    g.rect(-DESIGN_W / 2, 100, DESIGN_W, 4000);
    g.fill();
    g.fillColor = BG_SEA;
    g.rect(-DESIGN_W / 2, -430, DESIGN_W, 530);
    g.fill();
    g.fillColor = BG_SAND;
    g.rect(-DESIGN_W / 2, -4000, DESIGN_W, 3570);
    g.fill();
    // 透明占位色：图片缺失时不遮挡上面的三段色块，加载成功则完全覆盖。
    applySprite(bg, Theme.assets.bgMain, { radius: 0, color: new Color(0, 0, 0, 0) });
  }

  /** 安全区容器：顶部货币栏与底部导航挂其下，自动避开刘海/手势条。 */
  private buildSafeAreaHost(): Node {
    const safe = node('SafeArea', { parent: this.node, size: { width: DESIGN_W, height: DESIGN_H } });
    stretch(safe);
    safe.addComponent(SafeArea).updateArea();
    return safe;
  }

  private buildTopBar(safe: Node): void {
    const top = node('TopBar', { parent: safe, size: { width: DESIGN_W, height: 96 } });
    alignWidget(top, { top: 16, centerX: true });

    const barBg = node('currencyBg', { parent: top, size: { width: 520, height: 92 } });
    drawRoundRect(barBg, 520, 92, new Color(122, 74, 43, 235), 46, Theme.color.sand);
    new CurrencyBar(top, this.ctx, {
      goldPlus: () => this.openShop('gold'),
      diamondPlus: () => this.openShop('diamond'),
    }).node.setPosition(0, 0, 0);

    const gear = this.iconButton(top, 'SettingsButton', Theme.assets.iconSettings, '设置', 88, () => {
      this.openPanel(PANEL_NAMES.settings);
    });
    gear.setPosition(320, 0, 0);
  }

  private buildSideEntries(safe: Node): void {
    const left = node('LeftColumn', { parent: safe, size: { width: 180, height: 460 } });
    alignWidget(left, { top: 130, left: 16 });
    this.sideEntry(left, 'Activities', Theme.assets.iconActivity, '活动', 'menu.activities', () => {
      this.openPanel(PANEL_NAMES.activities);
    }).setPosition(0, 112, 0);
    this.sideEntry(left, 'Tasks', Theme.assets.iconTask, '任务', 'menu.tasks', () => {
      this.openPanel(PANEL_NAMES.tasks);
    }).setPosition(0, -112, 0);

    const right = node('RightColumn', { parent: safe, size: { width: 180, height: 460 } });
    alignWidget(right, { top: 130, right: 16 });
    this.sideEntry(right, 'Achievements', Theme.assets.iconAchievement, '成就', 'menu.achievements', () => {
      this.openPanel(PANEL_NAMES.achievements);
    }).setPosition(0, 112, 0);
    this.sideEntry(right, 'Leaderboard', Theme.assets.iconRank, '排行榜', null, () => {
      this.openPanel(PANEL_NAMES.leaderboard);
    }).setPosition(0, -112, 0);
  }

  private buildStartButton(safe: Node): void {
    const start = node('StartButton', { parent: safe, size: { width: 620, height: 214 } });
    alignWidget(start, { centerX: true, centerY: -140 });
    const content = node('content', { parent: start, size: { width: 620, height: 214 } });
    applySprite(content, Theme.assets.btnStart, {
      size: { width: 620, height: 214 },
      radius: Theme.radius.lg,
      color: Theme.color.gold,
      placeholderText: '开始酷跑',
    });
    const buttonComp = start.addComponent(Button);
    buttonComp.transition = Button.Transition.SCALE;
    buttonComp.target = content;
    buttonComp.zoomScale = 0.93;
    buttonComp.duration = 0.08;
    start.on(Button.EventType.CLICK, () => AudioService.playSfx(Theme.assets.sfxClick));
    start.on(Button.EventType.CLICK, () => void this.onStartRun());
    this.startButton = buttonComp;
  }

  private buildBottomNav(safe: Node): void {
    const nav = node('BottomNav', { parent: safe, size: { width: DESIGN_W, height: 210 } });
    alignWidget(nav, { bottom: 0, centerX: true });
    const navBg = node('navBg', { parent: nav, size: { width: DESIGN_W, height: 260 } });
    const g = navBg.addComponent(Graphics);
    g.fillColor = NAV_WOOD;
    g.roundRect(-DESIGN_W / 2, -130, DESIGN_W, 260, 36);
    g.fill();
    g.fillColor = Theme.color.sand;
    g.rect(-DESIGN_W / 2, 116, DESIGN_W, 6);
    g.fill();

    const xs = [-281.25, -93.75, 93.75, 281.25];
    this.navEntry(nav, 'Shop', Theme.assets.iconShop, '商店', xs[0], 'menu.shop', () => {
      this.openShop('gold');
    });
    this.navEntry(nav, 'Welfare', Theme.assets.iconWelfare, '福利手册', xs[1], 'menu.welfare', () => {
      this.openPanel(PANEL_NAMES.welfare);
    });
    this.navEntry(nav, 'Warehouse', Theme.assets.iconWarehouse, '仓库', xs[2], null, () => {
      this.openPanel(PANEL_NAMES.warehouse);
    });
    this.navEntry(nav, 'Characters', Theme.assets.iconCharacter, '角色', xs[3], 'menu.characters', () => {
      this.openPanel(PANEL_NAMES.characters);
    });
  }

  private buildDebugBadge(safe: Node): void {
    if (this.ctx.config.app().debug !== true) return;
    const badge = node('SandboxBadge', { parent: safe, size: { width: 190, height: 48 } });
    alignWidget(badge, { bottom: 230, left: 20 });
    drawRoundRect(badge, 190, 48, new Color(38, 30, 22, 210), 24);
    label('沙盒模式', {
      parent: badge,
      size: { width: 170, height: 40 },
      fontSize: Theme.fontSize.small,
      color: Theme.color.sand,
      align: 'center',
      overflow: 'shrink',
    });
  }

  // -------------------------------------------------------------------------
  // 元素工厂
  // -------------------------------------------------------------------------

  private iconButton(parent: Node, name: string, icon: string, placeholder: string, size: number, onClick: () => void): Node {
    const root = node(name, { parent, size: { width: size, height: size } });
    const content = node('content', { parent: root, size: { width: size, height: size } });
    applySprite(content, icon, { size: { width: size, height: size }, radius: Theme.radius.md, placeholderText: placeholder.slice(0, 1) });
    this.bindClick(root, content, onClick);
    return root;
  }

  private sideEntry(parent: Node, name: string, icon: string, text: string, redKey: RedDotKey | null, onClick: () => void): Node {
    const root = node(name, { parent, size: { width: 170, height: 200 } });
    const content = node('content', { parent: root, size: { width: 170, height: 200 } });
    const iconNode = node('icon', { parent: content, size: { width: 130, height: 118 }, position: [0, 22] });
    applySprite(iconNode, icon, { size: { width: 130, height: 118 }, radius: Theme.radius.md, placeholderText: text.slice(0, 1) });
    label(text, {
      parent: content,
      size: { width: 170, height: 44 },
      position: [0, -84],
      fontSize: Theme.fontSize.small,
      color: Theme.color.textOnDark,
      align: 'center',
      overflow: 'shrink',
      outline: { color: Theme.color.wood, width: 3 },
    });
    this.bindClick(root, content, onClick);
    if (redKey) RedDots.bind(root, redKey, { offset: [0, -6] });
    return root;
  }

  private navEntry(parent: Node, name: string, icon: string, text: string, x: number, redKey: RedDotKey | null, onClick: () => void): Node {
    const root = node(name, { parent, size: { width: 176, height: 200 }, position: [x, 0] });
    const content = node('content', { parent: root, size: { width: 176, height: 200 } });
    const iconNode = node('icon', { parent: content, size: { width: 112, height: 112 }, position: [0, 26] });
    applySprite(iconNode, icon, { size: { width: 112, height: 112 }, radius: Theme.radius.md, placeholderText: text.slice(0, 1) });
    label(text, {
      parent: content,
      size: { width: 176, height: 40 },
      position: [0, -70],
      fontSize: Theme.fontSize.small,
      color: Theme.color.textOnDark,
      align: 'center',
      overflow: 'shrink',
      outline: { color: Theme.color.wood, width: 3 },
    });
    this.bindClick(root, content, onClick);
    if (redKey) RedDots.bind(root, redKey, { offset: [0, -4] });
    return root;
  }

  private bindClick(root: Node, content: Node, onClick: () => void): void {
    const buttonComp = root.addComponent(Button);
    buttonComp.transition = Button.Transition.SCALE;
    buttonComp.target = content;
    buttonComp.zoomScale = 0.9;
    buttonComp.duration = 0.08;
    root.on(Button.EventType.CLICK, () => AudioService.playSfx(Theme.assets.sfxClick));
    root.on(Button.EventType.CLICK, onClick);
  }

  // -------------------------------------------------------------------------
  // 交互
  // -------------------------------------------------------------------------

  /** 未实现面板入口降级：已注册则打开，否则「开发中」Toast。 */
  private openPanel(name: string): void {
    if (PanelManager.has(name)) {
      void PanelManager.open(name);
      return;
    }
    Toast.show('开发中');
  }

  /** 商店入口（S06 前仅 Toast）；data 约定 `{ tab }` 供 S06 定位页签。 */
  private openShop(tab: 'gold' | 'diamond'): void {
    if (PanelManager.has(PANEL_NAMES.shop)) {
      void PanelManager.open(PANEL_NAMES.shop, { tab });
      return;
    }
    Toast.show('商店开发中');
  }

  /**
   * 开始酷跑（docs/06 §4 集成时序）：
   * 携带 pendingBuff → preload（3s 超时忽略）→ run.started → launch →
   * run.finished（S03 装配响应任务/成就/活动）→ 结算计算 → RunSettlementPanel。
   * launch 异常/拒绝：Toast「本局无效」，不发奖，携带道具放回存档，LoadingMask 保证关闭。
   */
  private async onStartRun(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (this.startButton) this.startButton.interactable = false;
    LoadingMask.show('准备出发...');
    const buffs = this.takePendingBuffs();
    const opts = this.buildLaunchOptions(buffs.items);
    try {
      await this.preloadGameplay(PRELOAD_TIMEOUT_MS);
      this.ctx.events.emit('run.started', opts);
      const result = await this.ctx.gameplay.launch(opts);
      this.ctx.events.emit('run.finished', result);
      await openSettlementPanel(this.ctx, result, () => {
        void this.onStartRun();
      });
    } catch (err) {
      log.error('跑酷启动失败', err);
      buffs.restore();
      Toast.show('本局无效');
    } finally {
      LoadingMask.hide();
      this.running = false;
      if (this.startButton) this.startButton.interactable = true;
    }
  }

  /** 组装本局进入参数：当前角色 + 角色属性 + pendingBuff 道具。 */
  private buildLaunchOptions(items: ItemId[]): GameplayLaunchOptions {
    const characterId = this.ctx.save.characters.selected;
    return {
      mode: 'classic',
      characterId,
      attrs: this.ctx.character.attrsOf(characterId),
      ...(items.length > 0 ? { items } : {}),
    };
  }

  /**
   * 从 flags 取出本局携带的 buff 道具（取出即清空，避免重复携带）。
   * 返回 restore() 供 launch 失败时原样放回，防止白扣道具。
   */
  private takePendingBuffs(): { items: ItemId[]; restore: () => void } {
    const flags = this.ctx.save.flags;
    const items: ItemId[] = [];
    const original: Record<string, number> = {};
    for (const key of Object.keys(flags)) {
      if (!key.startsWith(PENDING_BUFF_PREFIX)) continue;
      const raw = flags[key];
      const rawCount = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
      original[key] = rawCount;
      const buffId = key.slice(PENDING_BUFF_PREFIX.length);
      delete flags[key];
      if (buffId.length === 0) continue;
      const count = Math.min(MAX_BUFF_STACK, rawCount);
      for (let i = 0; i < count; i += 1) items.push(buffId);
    }
    if (items.length > 0) {
      this.ctx.markDirty();
      log.info(`本局携带道具：${items.join(',')}`);
    }
    return {
      items,
      restore: () => {
        for (const [key, count] of Object.entries(original)) {
          const current = flags[key];
          const base = typeof current === 'number' && Number.isFinite(current)
            ? Math.max(0, Math.trunc(current))
            : 0;
          flags[key] = base + count;
        }
        if (items.length > 0) {
          this.ctx.markDirty();
          log.warn(`本局无效，已放回携带道具：${items.join(',')}`);
        }
      },
    };
  }

  /** preload 不阻塞进入：超时或 reject 均忽略（docs/06 §4）。 */
  private async preloadGameplay(timeoutMs: number): Promise<void> {
    let timedOut = false;
    try {
      await Promise.race([
        this.ctx.gameplay.preload().catch((err) => {
          log.warn('玩法 preload 失败，已忽略', err);
        }),
        delay(timeoutMs).then(() => {
          timedOut = true;
        }),
      ]);
    } catch (err) {
      log.warn('玩法 preload 异常，已忽略', err);
    }
    if (timedOut) log.warn(`玩法 preload 超过 ${timeoutMs}ms，继续进入`);
  }
}
