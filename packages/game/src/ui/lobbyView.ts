/**
 * 登录后大厅页（P3 v3，按用户参考图重做）：
 * 顶栏＝头像｜金币｜钻石｜设置；左＝活动（下挂登录方式）；右＝成就、任务、排行榜；
 * 中下＝「开始·酷跑」「场景切换」两枚大徽标；底部棕条＝商店｜福利手册｜宝箱｜角色。
 * 徽标全部为图片按钮（badges.ts，点击换淡黄描边帧反馈）；角色/场景面板可用，
 * 左上角头像＝玩家档案半屏弹层（profileView.ts：换头像/改昵称），
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
import { buildProfileOverlay, createAvatarSlot, type AvatarSlot } from './profileView.js';
import { profileParamsFrom } from '../core/profile/playerProfile.js';

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
// 底栏别太暗：旧 #5a4d42 把四枚徽标压得发闷（用户反馈），提亮成暖中棕
const BAR_BG = '#7d6550';
const TITLE_ON_BG = '#6b4a2b';
const LABEL_ON_BAR = '#FFF3D6';

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

  /** 图标 + 真文字标签：生图重做的六枚不再把字烤进图里（AI 写字必糊，旧「活动」标签即乱码） */
  const labeledBadge = (name: Parameters<typeof badgeButton>[1], size: number, label: string, color: string, onTap: () => void): Box => new Box(
    { direction: 'column', align: 'center', gap: 2 },
    [badge(name, size, size, onTap, label), new Label({ text: label, fontSizePx: 13, color })],
  );

  /** 货币框右端的「+」：在框内、数字右侧；暂无获取入口，先走预留槽的 toast */
  const plusInPill = (tint: string, tag: string): Box => new Box(
    { width: 18, height: 18, align: 'center', justify: 'center', onClick: stub(`加${tag}`) },
    [new Label({ text: '+', fontSizePx: 15, color: tint })],
  );

  /** 顶栏货币胶囊：纯色棕底（自动随数字扩容）+ 图标（正方形）+ 数字 + 「+」；
   *  数字 Label 提到外面，档案面板改名扣钻后要能刷新同一块 */
  const coinsL = new Label({ text: String(d.extras?.coins ?? 0), fontSizePx: 14, color: c.gold });
  const gemsL = new Label({ text: String(d.extras?.diamonds ?? 0), fontSizePx: 14, color: '#BFE3FF' });
  const currencyChip = (icon: 'coin' | 'gem', iconW: number, tint: string, tag: string, value: Label): Box => new Box(
    { direction: 'row', background: host.solidSkin, backgroundColor: PILL_BG, padding: { top: 3, bottom: 3, left: 5, right: 5 }, gap: 5, align: 'center' },
    [badgeImage(set, icon, iconW, iconW), value, plusInPill(tint, tag)],
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
  // 头像＝玩家档案弹层入口。onAvatar 回调在 avatarSlot 赋值前也会被触达，故用 let + 可选链。
  let avatarSlot: AvatarSlot | null = null;
  const overlay = buildProfileOverlay(host, {
    params: profileParamsFrom(d.content.game.params?.['profile']),
    badges: set,
    storage: host.adapter.storage,
    onDiamonds: n => gemsL.setText(String(n)),
    onAvatar: k => avatarSlot?.setImage(k),
  });
  avatarSlot = createAvatarSlot(set, 46, overlay.avatarKey(), () => overlay.toggle());

  const topBar = new Box(
    { direction: 'row', align: 'center', gap: 8 },
    [
      avatarSlot.box,
      currencyChip('coin', 22, c.gold, '金币', coinsL),
      currencyChip('gem', 22, '#BFE3FF', '钻石', gemsL),
      new Box({ flex: 1 }),
      badge('settings', 36, 36, slot('onSettings', '设置'), '设置'),
    ],
  );

  const leftCol = new Box({ direction: 'column', width: 61, gap: 14, align: 'center' }, [
    // 左列也压在亮天/棕榈上，米白标签在横窗下几乎看不见，与「成就」统一取深棕
    labeledBadge('event', 55, '活动', TITLE_ON_BG, slot('onEvent', '活动')),
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
    // 勋章是生图重做的纯图标（AI 烤字必糊），板块名改由真文字渲染；这块压在亮天上，
    // 用左列那套米白会糊成一片，所以取「开始·酷跑」同款的深棕标题字
    labeledBadge('achieve', 55, '成就', TITLE_ON_BG, slot('onAchievements', '成就')),
    badge('task', 55, 66, slot('onTasks', '任务'), '任务'),
    badge('rank', 55, 55, slot('onRank', '排行榜'), '排行榜'),
  ]);

  const midRow = new Box({ direction: 'row', flex: 1, gap: 6, align: 'stretch' }, [leftCol, centerCol, rightCol]);

  const bottomBar = new Box(
    { direction: 'row', background: host.solidSkin, backgroundColor: BAR_BG, padding: { top: 4, bottom: 4 }, align: 'center', justify: 'spaceAround' },
    [
      labeledBadge('shop', 62, '商店', LABEL_ON_BAR, slot('onShop', '商店')),
      labeledBadge('handbook', 62, '福利手册', LABEL_ON_BAR, slot('onHandbook', '福利手册')),
      labeledBadge('chest', 62, '宝箱', LABEL_ON_BAR, slot('onChest', '宝箱')),
      labeledBadge('character', 62, '角色', LABEL_ON_BAR, toggleChar),
    ],
  );

  const view = host.makeView();
  view.add(new Box(
    // 背景图铺满整屏（等比裁切），徽标/面板按绘制顺序叠在其上；
    // 档案弹层的两个 absolute 兄弟放最后＝画在最上层，捕获层在前故面板吃点击优先
    { direction: 'column', flex: 1, padding: 8, gap: 6, background: d.extras?.background ?? null },
    [topBar, midRow, panelHost, bottomBar, overlay.catcher, overlay.panel],
  ));
  return { view };
}
