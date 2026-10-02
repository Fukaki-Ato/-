/**
 * 登录后大厅页（P3 v2，替代原选角页单列布局）：
 * 顶栏＝头像｜金币｜钻石｜设置；左列＝活动；右列＝成就、任务；
 * 主体＝当前选中角色展示 + 「开始·酷跑」「场景切换」两板块；
 * 底部四联框＝商店｜角色｜宝箱｜福利手册（有分界）。
 * 角色/场景两个板块可用（点选即写本机记忆），其余板块经 LobbySlotHandlers 预留接口，
 * 未注入时统一 toast「开发中」占位，后续功能逐个接入不改布局。
 */
import { Box, Button, Label, List, type NinePatchSource, type UiView } from '@tr/framework/ui/index.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import { buildLoadout, playableCharacters, type Loadout } from '@tr/game/core/sim/character.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { SelectActions } from '../flow/views.js';
import { CHAR_KEY, THEME_KEY } from '../flow/mainFlow.js';
import { entryLabel, type EntryMethod } from '../flow/session.js';
import { solidChip } from './parts.js';
import { MiniCard, rarityColor, type CardEnv } from './charCard.js';
import { iconBox, type IconName, type IconSet } from './icons.js';

export interface LobbyExtras {
  coins: number;
  diamonds: number;
  icons?: IconSet;
  /** 全屏背景贴图（用户自备插画）；缺省回主题纯色底 */
  background?: NinePatchSource;
}

/** 预留功能接口：壳/流程注入真实实现后替换 toast 占位 */
export interface LobbySlotHandlers {
  onSettings?: () => void;
  onEvent?: () => void;
  onAchievements?: () => void;
  onTasks?: () => void;
  onShop?: () => void;
  onChest?: () => void;
  onHandbook?: () => void;
}

export interface LobbyDeps {
  content: GameContent;
  actions: SelectActions;
  currentCharId: string;
  entry: EntryMethod | null;
  extras?: LobbyExtras;
  slots?: LobbySlotHandlers;
}

export interface LobbyPage { view: UiView }

/** 选角页技能行：能量攒满所需里程由配置推导（skills.json energy.perMeter），不写死文案 */
export function skillLine(load: Loadout): string {
  const sk = load.skill;
  if (!sk) return '技能：无';
  const need = Number.isFinite(sk.energyPerMeter) && sk.energyPerMeter > 0
    ? `跑满 ${Math.ceil(sk.energyMax / sk.energyPerMeter)} 米攒满能量`
    : '开局即可释放';
  return `技能：${sk.label} — ${sk.desc}（双击屏幕 / E 释放；${need}，冷却 ${sk.cooldownS}s）`;
}

/** 被动行：与技能行同规格展示 */
export function passiveLine(load: Loadout): string {
  return load.passive.length ? `被动：${load.talentLabel} — ${load.talentDesc}` : '被动：无';
}

export function buildLobbyPage(host: UiHost, d: LobbyDeps): LobbyPage {
  const c = host.theme.colors;
  const icons = d.extras?.icons;
  const chars = playableCharacters(d.content);
  const loads = chars.map(x => buildLoadout(d.content, x.id));
  let chosen = chars.some(x => x.id === d.currentCharId) ? d.currentCharId : (chars[0]?.id ?? '');
  const chosenIndex = (): number => Math.max(0, chars.findIndex(x => x.id === chosen));

  const stub = (name: string) => (): void => { host.toast(`「${name}」开发中，敬请期待`); };
  const slot = (key: keyof LobbySlotHandlers, name: string): (() => void) => d.slots?.[key] ?? stub(name);

  /** 可点图标槽（方形小九宫格卡）：图标＋可选文字 */
  const iconTile = (icon: IconName, label: string | null, size: number, onClick: () => void, tint = c.text): Box => {
    const iconW = iconBox(icons, icon, Math.round(size * 0.58), tint);
    const kids = label ? [iconW, new Label({ text: label, fontSizePx: 11, color: c.muted })] : [iconW];
    return new Box(
      { direction: 'column', background: 'card', padding: 6, gap: 4, align: 'center', justify: 'center', width: size, height: size, onClick },
      kids,
    );
  };

  /** 顶栏货币chip：图标＋数值 */
  const currencyChip = (icon: IconName, value: number, tint: string): Box => new Box(
    { direction: 'row', background: 'card', padding: { top: 6, bottom: 6, left: 8, right: 8 }, gap: 6, align: 'center' },
    [iconBox(icons, icon, 18, tint), new Label({ text: String(value), fontSizePx: 13, color: tint })],
  );

  // ---------- 主体：选中角色展示 ----------
  const chipHolder = new Box({ width: 84, height: 84, align: 'center', justify: 'center' });
  const nameL = new Label({ text: '', fontSizePx: 20, color: c.text });
  const rarityL = new Label({ text: '', fontSizePx: 12, color: c.muted });
  const skillL = new Label({ text: '', fontSizePx: 12, color: c.muted, align: 'center' });
  const passiveL = new Label({ text: '', fontSizePx: 12, color: c.muted, align: 'center' });
  const entryL = new Label({ text: `登录方式：${entryLabel(d.entry)}`, fontSizePx: 11, color: c.muted });
  const applyChosen = (): void => {
    const load = loads[chosenIndex()];
    if (!load) return;
    for (const old of [...chipHolder.children]) chipHolder.remove(old);
    chipHolder.add(solidChip(host.solidSkin, 64, load.tint));
    nameL.setText(load.name);
    rarityL.setText(load.rarity);
    rarityL.setColor(rarityColor(c, load.rarity));
    skillL.setText(skillLine(load));
    passiveL.setText(passiveLine(load));
  };

  // ---------- 弹层面板（角色 / 场景），同一时刻只开一个 ----------
  const panelHost = new Box({ direction: 'column', gap: 8 });
  let openKind: 'char' | 'theme' | null = null;
  const setPanel = (kind: 'char' | 'theme' | null, panel: Box | null): void => {
    for (const old of [...panelHost.children]) panelHost.remove(old);
    openKind = kind;
    if (panel) panelHost.add(panel);
  };

  const live = new Set<MiniCard>();
  const cardEnv: CardEnv = { colors: c, solid: host.solidSkin, tintOf: i => loads[i]?.tint ?? '#ffffff', live };
  const refreshMarks = (): void => {
    for (const card of live) card.setPicked(card.slotIndex === chosenIndex());
  };
  const choose = (i: number): void => {
    const id = chars[i]?.id;
    if (!id) return;
    chosen = id;
    host.adapter.storage.set(CHAR_KEY, id); // 点选即写本机记忆
    applyChosen();
    refreshMarks();
  };

  const buildCharPanel = (): Box => {
    const list = new List({
      itemCount: chars.length,
      itemExtent: 150,
      gap: 10,
      axis: 'x',
      height: 118,
      buildItem: i => new MiniCard(cardEnv, i, loads[i]!, chosen === chars[i]!.id),
      updateItem: (w, i) => { (w as MiniCard).setData(i, loads[i]!, chosen === chars[i]!.id); },
      onSelect: i => choose(i),
    });
    return new Box(
      { direction: 'column', background: 'panel', backgroundOpacity: 0.85, padding: 10, gap: 8 },
      [
        new Box({ direction: 'row', justify: 'spaceBetween', align: 'center' }, [
          new Label({ text: '选择角色（点选即保存）', fontSizePx: 14, color: c.gold }),
          new Button({ label: '收起', fontSizePx: 12, padding: { top: 4, bottom: 4, left: 12, right: 12 }, onClick: () => setPanel(null, null) }),
        ]),
        list,
      ],
    );
  };

  const buildThemePanel = (): Box => {
    const items = (d.content.themes.items ?? []) as Record<string, unknown>[];
    const cur = host.adapter.storage.get(THEME_KEY);
    const btns = items.map(t => {
      const id = String(t['id'] ?? '');
      const name = (t['name'] as Record<string, string> | undefined)?.['zh-CN'] ?? id;
      return new Button({
        label: id === cur ? `${name}（当前）` : name,
        fontSizePx: 13,
        padding: { top: 6, bottom: 6, left: 14, right: 14 },
        onClick: () => {
          host.adapter.storage.set(THEME_KEY, id);
          host.toast(`已选场景「${name}」，下一局生效`);
          setPanel(null, null);
        },
      });
    });
    return new Box(
      { direction: 'column', background: 'panel', backgroundOpacity: 0.85, padding: 10, gap: 8 },
      [
        new Box({ direction: 'row', justify: 'spaceBetween', align: 'center' }, [
          new Label({ text: '场景切换（下一局生效）', fontSizePx: 14, color: c.gold }),
          new Button({ label: '收起', fontSizePx: 12, padding: { top: 4, bottom: 4, left: 12, right: 12 }, onClick: () => setPanel(null, null) }),
        ]),
        new Box({ direction: 'row', gap: 8, justify: 'center' }, btns),
      ],
    );
  };

  const toggleChar = (): void => {
    if (openKind === 'char') setPanel(null, null);
    else setPanel('char', buildCharPanel());
  };
  const toggleTheme = (): void => {
    if (openKind === 'theme') setPanel(null, null);
    else setPanel('theme', buildThemePanel());
  };

  // ---------- 四段布局 ----------
  const topBar = new Box(
    { direction: 'row', align: 'center', gap: 8 },
    [
      new Box({ width: 46, height: 46, background: 'card', align: 'center', justify: 'center' },
        [iconBox(icons, 'circle-user', 30, c.neon)]),
      currencyChip('coins', d.extras?.coins ?? 0, c.gold),
      currencyChip('gem', d.extras?.diamonds ?? 0, c.neon),
      new Box({ flex: 1 }),
      iconTile('settings', null, 40, slot('onSettings', '设置')),
    ],
  );

  const midRow = new Box(
    { direction: 'row', flex: 1, gap: 8, align: 'stretch' },
    [
      new Box({ direction: 'column', width: 68, gap: 8 }, [iconTile('calendar-days', '活动', 68, slot('onEvent', '活动'))]),
      new Box({ direction: 'column', flex: 1, width: 0, gap: 10, align: 'center', justify: 'center' }, [
        new Box(
          { direction: 'column', background: 'panel', backgroundOpacity: 0.72, padding: 14, gap: 6, width: { percent: 100 }, maxWidth: 460 },
          [
            new Box({ direction: 'row', justify: 'center' }, [chipHolder]),
            new Box({ direction: 'row', gap: 8, justify: 'center', align: 'center' }, [nameL, rarityL]),
            skillL,
            passiveL,
            entryL,
          ],
        ),
        new Box({ direction: 'row', gap: 12, justify: 'center' }, [
          new Button({
            label: '开始·酷跑', variant: 'primary', fontSizePx: 18,
            padding: { top: 10, bottom: 10, left: 26, right: 26 },
            onClick: () => d.actions.onStartRun(chosen),
          }),
          new Button({
            label: '场景切换', fontSizePx: 14,
            padding: { top: 10, bottom: 10, left: 18, right: 18 },
            onClick: toggleTheme,
          }),
        ]),
      ]),
      new Box({ direction: 'column', width: 68, gap: 8 }, [
        iconTile('trophy', '成就', 68, slot('onAchievements', '成就')),
        iconTile('clipboard-list', '任务', 68, slot('onTasks', '任务')),
      ]),
    ],
  );

  const sep = (): Box => new Box({ width: 1, background: host.solidSkin, backgroundColor: c.muted, backgroundOpacity: 0.4 });
  const bottomCell = (icon: IconName, label: string, onClick: () => void): Box => new Box(
    { direction: 'column', flex: 1, align: 'center', justify: 'center', gap: 4, padding: { top: 8, bottom: 8 }, onClick },
    [iconBox(icons, icon, 26, c.text), new Label({ text: label, fontSizePx: 12, color: c.text })],
  );
  const bottomBar = new Box(
    { direction: 'row', background: 'panel', padding: 4, align: 'stretch' },
    [
      bottomCell('store', '商店', slot('onShop', '商店')), sep(),
      bottomCell('user-round', '角色', toggleChar), sep(),
      bottomCell('archive', '宝箱', slot('onChest', '宝箱')), sep(),
      bottomCell('book-open', '福利手册', slot('onHandbook', '福利手册')),
    ],
  );

  const view = host.makeView();
  view.add(new Box(
    // 背景图铺满整屏（九宫格零 insets 拉伸），面板/文字按绘制顺序叠在其上
    { direction: 'column', flex: 1, padding: 10, gap: 8, background: d.extras?.background ?? null },
    [topBar, midRow, panelHost, bottomBar],
  ));
  applyChosen(); // 入视图后才能 setText（Label bind 语义，同 S13）
  return { view };
}
