/**
 * 主界面（P3 v4，按 issue #12 参考图 1024×1536 重排）：
 * 顶栏＝合并货币胶囊（金币+钻石各带「+」）｜右上角设置；左＝活动、任务；右＝成就、排行榜；
 * 中下＝「开始酷跑」大牌匾（设计稿原字整块抠图）；底部棕条＝商店｜福利手册｜仓库｜角色＋竖分隔线。
 * 布局坐标全走 menuLayout 常量表（等比缩放、顶贴顶/底贴底锚定）；控件一律 absolute 叠在背景上。
 * 未定义入口（设置/活动/成就/任务/排行榜/商店/手册/仓库/货币+）只有按下/松开视觉反馈
 * （badgeButton 换 glow 帧），不导航不弹窗不读写——LobbySlotHandlers 留作后续注入真实实现。
 * 选角面板复用现有选角 UI（lobbyPanels），由「角色」格开关；开始酷跑沿用 选角→跑酷 流程。
 */
import { Box, Label, type UiView } from '@tr/framework/ui/index.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import { isCharacterLocked, playableCharacters } from '@tr/game/core/sim/character.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { SelectActions } from '../flow/views.js';
import { badgeButton, badgeImage, type BadgeSet } from './badges.js';
import { buildCharPanel } from './lobbyPanels.js';
import { menuLayout, uiSafeFrom, type Rect } from './menuLayout.js';

export interface LobbyExtras {
  coins: number;
  diamonds: number;
  badges?: BadgeSet;
}

/** 预留功能接口：壳/流程注入真实实现后替换空操作（未定义入口默认仅按压反馈） */
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
  extras?: LobbyExtras;
  slots?: LobbySlotHandlers;
}

export interface LobbyPage { view: UiView }

// 参考图配色：货币胶囊/底栏棕底、分隔线白
const PILL_BG = '#5e4b3a';
const BAR_BG = '#6b4a33';
const DIVIDER = '#ffffff';

export function buildLobbyPage(host: UiHost, d: LobbyDeps): LobbyPage {
  const c = host.theme.colors;
  const set = d.extras?.badges;
  const { width: vw, height: vh } = host.adapter.canvas.windowSize();
  const L = menuLayout(vw, vh, uiSafeFrom(d.content.game.params?.['ui']));
  const dpx = (n: number): number => Math.round(n * L.s);

  const slot = (key: keyof LobbySlotHandlers): (() => void) => d.slots?.[key] ?? (() => undefined);
  /** 徽标按钮；缺贴图时退化为带隐藏名牌的空槽（测试锚点不变） */
  const badge = (r: Rect, name: Parameters<typeof badgeButton>[1], onTap: () => void, tag: string): Box => {
    if (set) return badgeButton(set, name, r.w, r.h, onTap, tag);
    const holder = new Box({ width: r.w, height: r.h, onClick: onTap });
    const l = new Label({ text: tag });
    l.visible = false;
    holder.add(l);
    return holder;
  };
  /** 叠到舞台绝对位置 */
  const at = (r: Rect, child: Box): Box =>
    new Box({ absolute: true, left: r.x, top: r.y, width: r.w, height: r.h }, [child]);

  // ---------- 顶栏：合并货币胶囊 ----------
  const pressOnly = (): void => undefined;   // 货币「+」＝未定义入口，仅按压反馈
  const plus = (tint: string): Box => new Box(
    { width: dpx(40), height: dpx(40), align: 'center', justify: 'center', onClick: pressOnly },
    [new Label({ text: '+', fontSizePx: dpx(30), color: tint })],
  );
  const icon = dpx(44);
  const pill = new Box(
    {
      direction: 'row', align: 'center', gap: dpx(10),
      background: host.solidSkin, backgroundColor: PILL_BG,
      padding: { top: dpx(6), bottom: dpx(6), left: dpx(14), right: dpx(14) },
    },
    [
      badgeImage(set, 'coin', icon, icon),
      new Label({ text: String(d.extras?.coins ?? 0), fontSizePx: dpx(28), color: c.gold }),
      plus(c.gold),
      new Box({ width: Math.max(1, dpx(2)), height: dpx(40), background: host.solidSkin, backgroundColor: DIVIDER, backgroundOpacity: 0.35 }),
      badgeImage(set, 'gem', icon, icon),
      new Label({ text: String(d.extras?.diamonds ?? 0), fontSizePx: dpx(28), color: '#BFE3FF' }),
      plus('#BFE3FF'),
    ],
  );

  // ---------- 选角面板（角色格开关） ----------
  // 面板宿主盒只在开着时挂上：框架命中是「反向扫描第一个 rect 含命中点的分支就返回」，
  // 常驻的空宿主盒哪怕 passthrough 也会把它那一带的点击判死；高度给足面板自然高，
  // 否则 absolute 父盒高度 0 会把子的自动高度压成 0（List 塌掉点不中）。
  const roster = playableCharacters(d.content);
  const initial = roster.find(character => character.id === d.currentCharId && !isCharacterLocked(character))
    ?? roster.find(character => !isCharacterLocked(character));
  let chosen = initial?.id ?? '';
  let panelHost: Box | null = null;
  // 背景由 menuBackdrop 的网格铺（视频/静态图同一套），这里只留透明容器；
  // absolute 子项排在常规子项之后 ⇒ 控件叠在背景上、命中优先
  const root = new Box({ direction: 'column', flex: 1 }, []);
  const toggleChar = (): void => {
    if (panelHost) {
      root.remove(panelHost);
      panelHost = null;
      return;
    }
    panelHost = new Box({ absolute: true, left: L.panel.x, top: L.panel.y, width: L.panel.w, height: dpx(268) });
    const cp = buildCharPanel(host, {
      content: d.content, currentCharId: chosen, width: L.panel.w,
      onClose: toggleChar,
      onChoose: id => {
        if (!d.actions.onChooseCharacter(id)) return false;
        chosen = id;
        return true;
      },
    });
    panelHost.add(cp.panel);
    root.add(panelHost);
    cp.refresh();
  };

  // ---------- 底栏：四格 + 竖分隔线 ----------
  const cell = (name: Parameters<typeof badgeButton>[1], tag: string, onTap: () => void): Box =>
    badge({ x: 0, y: 0, w: L.cells[0]!.w, h: L.cells[0]!.h }, name, onTap, tag);
  const div = (): Box => {
    const r = L.dividers[0]!;
    return new Box({ width: r.w, height: r.h, background: host.solidSkin, backgroundColor: DIVIDER, backgroundOpacity: 0.3 });
  };
  const bar = new Box(
    {
      direction: 'row', align: 'center', justify: 'spaceAround',
      background: host.solidSkin, backgroundColor: BAR_BG,
      padding: { top: dpx(10), bottom: dpx(10) },
    },
    [
      cell('shop', '商店', slot('onShop')), div(),
      cell('handbook', '福利手册', slot('onHandbook')), div(),
      cell('chest', '仓库', slot('onChest')), div(),
      cell('character', '角色', toggleChar),
    ],
  );

  const view = host.makeView();
  for (const child of [
    at(L.pill, pill),
    at(L.settings, badge(L.settings, 'settings', slot('onSettings'), '设置')),
    at(L.event, badge(L.event, 'event', slot('onEvent'), '活动')),
    at(L.task, badge(L.task, 'task', slot('onTasks'), '任务')),
    at(L.achieve, badge(L.achieve, 'achieve', slot('onAchievements'), '成就')),
    at(L.rank, badge(L.rank, 'rank', slot('onRank'), '排行榜')),
    at(L.plaque, badge(L.plaque, 'start', () => d.actions.onStartRun(chosen), '开始酷跑')),
    at(L.bar, bar),
  ]) root.add(child);
  view.add(root);
  return { view };
}
