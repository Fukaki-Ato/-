/**
 * 登录后大厅页（P3 v3，按用户参考图重做）：
 * 顶栏＝头像｜金币｜钻石｜设置；左＝活动（下挂登录方式）；右＝成就、任务、排行榜；
 * 中下＝「开始·酷跑」「场景切换」两枚大徽标；底部棕条＝商店｜福利手册｜宝箱｜角色。
 * 徽标全部为图片按钮（badges.ts，点击换淡黄描边帧反馈）；角色/场景面板可用，
 * 其余板块经 LobbySlotHandlers 预留接口，未注入时 toast「开发中」占位。
 */
import { Box, Button, Label, List, type NinePatchSource, type UiView } from '@tr/framework/ui/index.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import { buildLoadout, playableCharacters, type Loadout } from '@tr/game/core/sim/character.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { SelectActions } from '../flow/views.js';
import { CHAR_KEY, THEME_KEY } from '../flow/mainFlow.js';
import { entryLabel, type EntryMethod } from '../flow/session.js';
import { MiniCard, type CardEnv } from './charCard.js';
import { badgeButton, badgeImage, type BadgeSet } from './badges.js';

export interface LobbyExtras {
  coins: number;
  diamonds: number;
  badges?: BadgeSet;
  /** 全屏背景贴图；缺省回主题纯色底 */
  background?: NinePatchSource;
}

/** 预留功能接口：壳/流程注入真实实现后替换 toast 占位 */
export interface LobbySlotHandlers {
  onSettings?: () => void;
  onEvent?: () => void;
  onAchievements?: () => void;
  onTasks?: () => void;
  onRank?: () => void;
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

/** 选角面板技能行：能量攒满所需里程由配置推导（skills.json energy.perMeter），不写死文案 */
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

// 参考图配色：棕色胶囊/底条 + 沙滩上的深棕标题字
const PILL_BG = '#5e4b3a';
const BAR_BG = '#5a4d42';
const TITLE_ON_BG = '#6b4a2b';

export function buildLobbyPage(host: UiHost, d: LobbyDeps): LobbyPage {
  const c = host.theme.colors;
  const set = d.extras?.badges;
  const chars = playableCharacters(d.content);
  const loads = chars.map(x => buildLoadout(d.content, x.id));
  let chosen = chars.some(x => x.id === d.currentCharId) ? d.currentCharId : (chars[0]?.id ?? '');
  const chosenIndex = (): number => Math.max(0, chars.findIndex(x => x.id === chosen));

  const stub = (name: string) => (): void => { host.toast(`「${name}」开发中，敬请期待`); };
  const slot = (key: keyof LobbySlotHandlers, name: string): (() => void) => d.slots?.[key] ?? stub(name);
  const badge = (name: Parameters<typeof badgeButton>[1], w: number, h: number, onTap: () => void, tag: string): Box => {
    if (set) return badgeButton(set, name, w, h, onTap, tag);
    const holder = new Box({ width: w, height: h, onClick: onTap });
    const l = new Label({ text: tag });
    l.visible = false;
    holder.add(l);
    return holder;
  };

  /** 顶栏货币胶囊：棕色 pill + 徽标 + 动态数字 */
  const currencyChip = (icon: 'coin' | 'gem', value: number, tint: string): Box => new Box(
    { direction: 'row', background: host.solidSkin, backgroundColor: PILL_BG, padding: { top: 3, bottom: 3, left: 5, right: 10 }, gap: 5, align: 'center' },
    [badgeImage(set, icon, 24, 24), new Label({ text: String(value), fontSizePx: 14, color: tint })],
  );

  /** 中部大徽标组：标题字 + 徽标 */
  const bigBadge = (title: string, name: Parameters<typeof badgeButton>[1], w: number, h: number, onTap: () => void, tag: string): Box => new Box(
    { direction: 'column', align: 'center', gap: 4 },
    [new Label({ text: title, fontSizePx: 17, color: TITLE_ON_BG }), badge(name, w, h, onTap, tag)],
  );

  // ---------- 角色 / 场景弹层 ----------
  const panelHost = new Box({ direction: 'column', gap: 6 });
  let openKind: 'char' | 'theme' | null = null;
  const setPanel = (kind: 'char' | 'theme' | null, panel: Box | null): void => {
    for (const old of [...panelHost.children]) panelHost.remove(old);
    openKind = kind;
    if (panel) panelHost.add(panel);
  };

  const live = new Set<MiniCard>();
  const cardEnv: CardEnv = { colors: c, solid: host.solidSkin, tintOf: i => loads[i]?.tint ?? '#ffffff', live };
  const infoL = new Label({ text: '', fontSizePx: 12, color: c.muted, align: 'center' });
  const refreshMarks = (): void => { for (const card of live) card.setPicked(card.slotIndex === chosenIndex()); };
  const choose = (i: number): void => {
    const id = chars[i]?.id;
    if (!id) return;
    chosen = id;
    host.adapter.storage.set(CHAR_KEY, id); // 点选即写本机记忆
    const load = loads[i]!;
    infoL.setText(`${load.name}：${skillLine(load)}　${passiveLine(load)}`);
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
      { direction: 'column', background: 'panel', backgroundOpacity: 0.9, padding: 10, gap: 6 },
      [
        new Box({ direction: 'row', justify: 'spaceBetween', align: 'center' }, [
          new Label({ text: '选择角色（点选即保存）', fontSizePx: 14, color: c.gold }),
          new Button({ label: '收起', fontSizePx: 12, padding: { top: 4, bottom: 4, left: 12, right: 12 }, onClick: () => setPanel(null, null) }),
        ]),
        list,
        infoL,
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
      { direction: 'column', background: 'panel', backgroundOpacity: 0.9, padding: 10, gap: 8 },
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
    else { setPanel('char', buildCharPanel()); choose(chosenIndex()); }
  };
  const toggleTheme = (): void => {
    if (openKind === 'theme') setPanel(null, null);
    else setPanel('theme', buildThemePanel());
  };

  // ---------- 四段布局（对齐参考图） ----------
  const topBar = new Box(
    { direction: 'row', align: 'center', gap: 8 },
    [
      badge('avatar', 41, 41, slot('onSettings', '头像'), '头像'),
      currencyChip('coin', d.extras?.coins ?? 0, c.gold),
      currencyChip('gem', d.extras?.diamonds ?? 0, '#BFE3FF'),
      new Box({ flex: 1 }),
      badge('settings', 36, 36, slot('onSettings', '设置'), '设置'),
    ],
  );

  const leftCol = new Box({ direction: 'column', width: 61, gap: 10, align: 'center' }, [
    badge('event', 55, 66, slot('onEvent', '活动'), '活动'),
    new Box({ direction: 'column', background: host.solidSkin, backgroundColor: PILL_BG, backgroundOpacity: 0.55, padding: { top: 3, bottom: 3, left: 4, right: 4 } },
      [new Label({ text: `登录方式：${entryLabel(d.entry)}`, fontSizePx: 10, color: '#FFE9A0', align: 'center' })]),
  ]);

  const centerCol = new Box({ direction: 'column', flex: 1, width: 0, justify: 'end', align: 'center', gap: 6, padding: { bottom: 6 } }, [
    new Box({ direction: 'row', gap: 18, align: 'end', justify: 'center' }, [
      bigBadge('开始·酷跑', 'start', 150, 68, () => d.actions.onStartRun(chosen), '开始酷跑'),
      bigBadge('场景切换', 'castle', 66, 66, toggleTheme, '场景切换'),
    ]),
  ]);

  const rightCol = new Box({ direction: 'column', width: 61, gap: 6, align: 'center' }, [
    badge('achieve', 55, 66, slot('onAchievements', '成就'), '成就'),
    badge('task', 55, 66, slot('onTasks', '任务'), '任务'),
    badge('rank', 55, 55, slot('onRank', '排行榜'), '排行榜'),
  ]);

  const midRow = new Box({ direction: 'row', flex: 1, gap: 6, align: 'stretch' }, [leftCol, centerCol, rightCol]);

  const bottomBar = new Box(
    { direction: 'row', background: host.solidSkin, backgroundColor: BAR_BG, padding: { top: 4, bottom: 4 }, align: 'center', justify: 'spaceAround' },
    [
      badge('shop', 77, 80, slot('onShop', '商店'), '商店'),
      badge('handbook', 77, 80, slot('onHandbook', '福利手册'), '福利手册'),
      badge('chest', 77, 80, slot('onChest', '宝箱'), '宝箱'),
      badge('character', 77, 80, toggleChar, '角色'),
    ],
  );

  const view = host.makeView();
  view.add(new Box(
    // 背景图铺满整屏（九宫格零 insets 拉伸），徽标/面板按绘制顺序叠在其上
    { direction: 'column', flex: 1, padding: 8, gap: 6, background: d.extras?.background ?? null },
    [topBar, midRow, panelHost, bottomBar],
  ));
  return { view };
}
