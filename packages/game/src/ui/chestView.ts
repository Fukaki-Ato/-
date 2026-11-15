/**
 * 宝箱页（canvas 版，overlayViews 装配；web DOM 版在 apps/web chestOverlay）。
 * 铜/银/金三档卡：钥匙扣价（1/2/3）→ 按档连抽（1/2/3 件）→ 发货。开启统一两步防误触。
 * 开启动效（框架无 tween，先例 slideOverlay 的「每帧改属性 + invalidate」）：ChestStage
 * step(dt) 驱动时间线——宝箱徽标摇晃衰减 → 稀有度色粒子从箱心抛散淡出。坐标全部在 72×72
 * 固定舞台内，不依赖页面宽度；移动用 MoveBox 公开写口（opts 是 protected，SlideBox 改的是
 * 自己的 opts，跨实例只能走公开方法）。奖励文案逻辑先行即时显示，动效纯装饰，headless
 * 测试不依赖动画帧；静止时绝不请求重排（SlideBox 纪律）。
 */
import { Box, Button, Label, mixHex, type NinePatchSource, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { ChestActions, ChestCardView, RewardView } from '../flow/chest.js';
import { rewardText } from '../flow/chest.js';
import { badgeImage, type BadgeSet } from './badges.js';

/** 档位主题色：铜/银/金 */
const TIER_COLORS: Record<ChestCardView['tier'], string> = {
  bronze: '#C88A4A', silver: '#B9C4CF', gold: '#FFD84D',
};
const RARITY_COLORS: Record<string, (c: UiHost['theme']['colors']) => string> = {
  common: c => c.muted, rare: c => c.neon, sr: c => c.gold, ssr: () => '#FF9DE2',
};

const STAGE = 72;          // 动效舞台固定边长（坐标系）
const BADGE = 56;          // 宝箱徽标边长
const SHAKE_MS = 600;      // 摇晃时长
const BURST_MS = 700;      // 粒子散开时长
const CHIP_COUNT = 6;      // 每次开启的粒子数

/** 可编程移动的 absolute 盒：公开 left/top/opacity 写口（SlideBox 的「每帧改 opts + invalidate」同式，跨实例走公开方法） */
class MoveBox extends Box {
  setPosition(x: number, y: number, opacity?: number): void {
    this.opts.left = x;
    this.opts.top = y;
    if (opacity !== undefined) this.setBackground({ opacity });
  }
}

/**
 * 开启动效舞台：摇晃徽标（left 正弦衰减）+ 粒子抛散淡出，MoveBox 每帧重定位；
 * t<0 为静止态，绝不 invalidate。
 */
class ChestStage extends Box {
  private t = -1;
  private readonly holder: MoveBox;
  private readonly chips: { box: MoveBox; angle: number; born: number }[] = [];

  constructor(skin: NinePatchSource, badge: Box) {
    super({ width: STAGE, height: STAGE });
    this.holder = new MoveBox({ absolute: true, width: BADGE, height: BADGE, left: (STAGE - BADGE) / 2, top: (STAGE - BADGE) / 2 }, [badge]);
    this.add(this.holder);
    for (let i = 0; i < CHIP_COUNT; i++) {
      const chip = new MoveBox({
        absolute: true, width: 9, height: 9,
        left: STAGE / 2 - 4.5, top: STAGE / 2 - 4.5, background: skin, backgroundColor: '#FFD84D',
      });
      chip.visible = false;
      this.chips.push({ box: chip, angle: Math.PI * 2 * (i / CHIP_COUNT) + 0.4, born: 60 + i * 55 });
      this.add(chip);
    }
  }

  /** 粒子主题色（每次开启前按档位色注入） */
  tint(color: string): void {
    for (const chip of this.chips) chip.box.setBackground({ color });
  }

  get animating(): boolean { return this.t >= 0; }

  play(): void {
    this.t = 0;
    this.requireEnv().invalidate();
  }

  override step(dt: number): void {
    super.step(dt);
    if (this.t < 0) return; // 静止时绝不每帧重排整棵树
    this.t += Math.max(0, dt) * 1000;
    const cx = STAGE / 2 - 4.5;
    const cy = STAGE / 2 - 4.5;
    if (this.t < SHAKE_MS) {
      const k = 1 - this.t / SHAKE_MS;
      this.holder.setPosition((STAGE - BADGE) / 2 + Math.sin(this.t / 22) * 7 * k, (STAGE - BADGE) / 2);
    } else {
      this.holder.setPosition((STAGE - BADGE) / 2, (STAGE - BADGE) / 2);
      const bt = this.t - SHAKE_MS;
      for (const chip of this.chips) {
        const p = (bt - chip.born) / BURST_MS;
        if (p < 0 || p > 1) {
          chip.box.visible = false;
          continue;
        }
        chip.box.visible = true;
        const dist = 26 + 10 * Math.sin(chip.angle * 3);
        chip.box.setPosition(
          cx + Math.cos(chip.angle) * dist * p,
          cy + Math.sin(chip.angle) * dist * p - 36 * p * (1 - p),
          Math.max(0, 1 - p),
        );
      }
    }
    if (this.t >= SHAKE_MS + BURST_MS + 200) {
      this.t = -1;
      for (const chip of this.chips) { chip.box.visible = false; chip.box.setPosition(cx, cy, 1); }
    }
    this.requireEnv().invalidate();
  }
}

export interface ChestPage { view: UiView }

export function buildChestPage(host: UiHost, content: GameContent, actions: ChestActions, badges?: BadgeSet): ChestPage {
  const c = host.theme.colors;
  const compact = host.adapter.canvas.windowSize().height < 800;
  const view = host.makeView();
  let pending: string | null = null;

  const walletText = new Label({ text: '', fontSizePx: 12, color: c.gold, align: 'center' });
  const hint = new Label({ text: '点宝箱开启，钥匙来自任务、活动与福利邮件奖励', fontSizePx: 11, color: c.muted, align: 'center' });
  const cards = new Box({ direction: 'column', flex: 1, gap: 8, align: 'stretch' });
  const rewardRow = new Box({ direction: 'row', align: 'center', justify: 'center', gap: 6, minHeight: 30 });
  const stage = new ChestStage(host.solidSkin, badgeImage(badges, 'chest', BADGE, BADGE));

  function refreshWallet(): void {
    const w = actions.wallet();
    walletText.setText(`余额：能量币 ${w.coins} · 钥匙 ${w.keys} · 钻石 ${w.diamonds}`);
  }

  /** 稀有度文字 chip（solidSkin 底 + 稀有度色字） */
  function rewardChip(reward: RewardView): Box {
    const color = (RARITY_COLORS[reward.rarity] ?? RARITY_COLORS.common!)(c);
    return new Box(
      { background: host.solidSkin, backgroundColor: mixHex(c.card, color, 0.18),
        padding: { top: 3, bottom: 3, left: 8, right: 8 } },
      [new Label({ text: rewardText(content, reward), fontSizePx: compact ? 11 : 13, color })],
    );
  }

  function confirmPair(card: ChestCardView): Box {
    return new Box({ direction: 'row', align: 'center', gap: 4 }, [
      new Button({
        label: '✔ 确认开启', fontSizePx: compact ? 10 : 12, backgroundColor: TIER_COLORS[card.tier],
        padding: { top: 4, bottom: 4, left: 10, right: 10 },
        onClick: () => {
          const r = actions.onOpen(card.tableId);
          pending = null;
          hint.setText(r.message);
          for (const old of [...rewardRow.children]) rewardRow.remove(old);
          for (const reward of r.rewards) rewardRow.add(rewardChip(reward));
          refreshWallet();
          update();
          if (r.ok) { stage.tint(TIER_COLORS[card.tier]); stage.play(); }
        },
      }),
      new Button({
        label: '取消', fontSizePx: compact ? 10 : 12,
        padding: { top: 4, bottom: 4, left: 10, right: 10 },
        onClick: () => { pending = null; update(); },
      }),
    ]);
  }

  function chestCard(card: ChestCardView): Box {
    const accent = TIER_COLORS[card.tier];
    const affordable = actions.wallet().keys >= card.costKeys;
    const action: Box | Button = pending === card.tableId ? confirmPair(card)
      : new Button({
        label: affordable ? `开启（钥匙×${card.costKeys}）` : '钥匙不足',
        fontSizePx: compact ? 10 : 12, disabled: !affordable, backgroundColor: accent,
        padding: { top: 4, bottom: 4, left: 10, right: 10 },
        onClick: () => { pending = card.tableId; update(); },
      });
    const pityText = card.pityEveryN > 0 ? ` · 保底${card.pityEveryN}次出高级` : '';
    return new Box(
      { direction: 'row', align: 'center', gap: 10, padding: compact ? 6 : 8, background: 'card', height: compact ? 74 : 86 },
      [
        new Box({ width: 5, height: 52, background: host.solidSkin, backgroundColor: accent }),
        new Box({ direction: 'column', flex: 1, align: 'stretch', gap: 3 }, [
          new Label({ text: card.name, fontSizePx: compact ? 13 : 16, color: c.text }),
          new Label({ text: `钥匙×${card.costKeys} 开一次 · 开出 ${card.draws} 件物品${pityText}`, fontSizePx: compact ? 10 : 11, color: c.gold }),
          new Box({ direction: 'row', align: 'center', gap: 6 }, [action]),
        ]),
      ],
    );
  }

  function update(): void {
    for (const old of [...cards.children]) cards.remove(old);
    const list = actions.chests();
    if (!list.length) {
      cards.add(new Label({ text: '暂无宝箱配置', fontSizePx: 14, color: c.muted, align: 'center' }));
      return;
    }
    for (const card of list) cards.add(chestCard(card));
  }

  // 开箱台：动效舞台 + 奖励行（开启后即时填充；粒子从箱心飞向奖励行方向）
  const stageBar = new Box(
    { direction: 'row', align: 'center', justify: 'center', gap: 14,
      background: host.solidSkin, backgroundColor: mixHex(c.panel, c.neon, 0.08),
      padding: { top: 8, bottom: 8, left: 10, right: 10 } },
    [stage, rewardRow],
  );

  const panel = new Box(
    { direction: 'column', width: { percent: 100 }, maxWidth: 560, flex: 1, gap: 8,
      padding: { top: 14, bottom: 14, left: 14, right: 14 }, background: 'panel' },
    [
      new Box({ direction: 'row', align: 'center', gap: 12 }, [
        new Button({ label: '返回', fontSizePx: 13, padding: { top: 6, bottom: 6, left: 10, right: 10 }, onClick: actions.onBack }),
        new Label({ text: '宝箱', fontSizePx: 22, color: c.neon }),
      ]),
      walletText,
      hint,
      stageBar,
      cards,
    ],
  );
  view.add(new Box({ direction: 'column', align: 'center', flex: 1, padding: 12 }, [panel]));
  refreshWallet();
  update();
  return { view };
}
