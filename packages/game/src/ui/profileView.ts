/**
 * 玩家档案半屏弹层：大厅点左上角头像 → 面板从顶边滑下（占屏高 params.profile.panelHeightPct）；
 * 点面板下方的空白区收回。内容＝头像（点大头像/点候选行均可换）、账号 ID、昵称（点候选改名）、最高记录。
 *
 * 数据读写全在 core/profile/playerProfile（本文件只负责摆放与点击派发）；
 * 头像贴图在 assets/ui/badges/{normal,glow}/ava_01..10.png，加/换头像只改 AVATAR_KEYS 这张表。
 */
import { Box, Button, Label, type Widget } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { SyncStorage } from '@tr/framework/platform/platformAdapter.js';
import { SlideBox, tapCatcher } from './slideOverlay.js';
import { badgeButton, type BadgeName, type BadgeSet } from './badges.js';
import {
  loadProfile, saveProfile, tryRename, withAvatar,
  type ProfileParams, type RenameFail,
} from '../core/profile/playerProfile.js';
import { BEST_KEY, DIAMOND_KEY } from '../flow/mainFlow.js';

/**
 * 候选头像＝档案专用的一批二次元头像（5 女 5 男，金圆框与参考图的 avatar 同一套风格）。
 * 一排 10 枚、每枚 32px：10×32 + 9×3 间距 = 347，375 宽的手机也放得下；
 * 再多一枚就得换 List 横滚（框架布局没有 wrap，超一行会被截到屏外）。
 */
export const AVATAR_KEYS: BadgeName[] = [
  'ava_01', 'ava_02', 'ava_03', 'ava_04', 'ava_05',
  'ava_06', 'ava_07', 'ava_08', 'ava_09', 'ava_10',
];
const AVATAR_PX = 32;
const NAME_PER_ROW = 3;
/** 内容实测约 311px 高；屏太矮也至少开到这个数，否则末行「返回」提示会被挤到面板外 */
const MIN_PANEL_H = 330;

/** 面板底色跟大厅棕色系（主题的 'panel' 皮肤是深蓝底，压在沙滩背景上很跳） */
const PANEL_BG = '#5e4b3a';
const TEXT_ON_PANEL = '#FFE9A0';
const MUTED_ON_PANEL = '#D8C3A0';

/** 无贴图退化槽：不可见名牌留着当测试锚点（与 lobbyView 的徽标退化口径一致） */
function tagOnly(size: number, tag: string, onTap: () => void): Box {
  const holder = new Box({ width: size, height: size, onClick: onTap });
  const l = new Label({ text: tag });
  l.visible = false;
  holder.add(l);
  return holder;
}

/** 头像槽：外框尺寸固定，换头像只重画内部，不动兄弟节点的排布 */
export interface AvatarSlot { box: Box; setImage(key: BadgeName): void }

export function createAvatarSlot(
  set: BadgeSet | undefined, size: number, key: BadgeName, onTap: () => void,
): AvatarSlot {
  const box = new Box({ width: size, height: size, align: 'center', justify: 'center' });
  const paint = (k: BadgeName): void => {
    for (const old of [...box.children]) box.remove(old);
    box.add(set ? badgeButton(set, k, size, size, onTap, '头像') : tagOnly(size, '头像', onTap));
  };
  paint(key);
  return { box, setImage: paint };
}

export interface ProfileOverlayDeps {
  params: ProfileParams;
  badges?: BadgeSet;
  storage: SyncStorage;
  /** 改名扣钻后刷新顶栏钻石数字 */
  onDiamonds(left: number): void;
  /** 换头像后刷新顶栏头像 */
  onAvatar(key: BadgeName): void;
}

export interface ProfileOverlay {
  /** 全屏点击捕获层：与 panel 一起按「catcher 在前、panel 在后」加入页面根 Box */
  catcher: Box;
  /** 半屏滑入面板本体 */
  panel: SlideBox;
  toggle(): void;
  isOpen(): boolean;
  /** 当前档案头像对应的徽标名（顶栏头像初始帧） */
  avatarKey(): BadgeName;
}

function readCount(storage: SyncStorage, key: string): number {
  const n = Number(storage.get(key) ?? '0');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function failText(reason: RenameFail, cost: number): string {
  if (reason === 'need-diamonds') return `改名需要 ${cost} 钻石，钻石不足`;
  return reason === 'same' ? '已经是这个名字了' : '名字不合规，换一个';
}

/** 定长分块：框架布局没有 wrap，超一行会被截到屏外，所以行数与每行个数都由这里定死 */
function chunk<T>(items: T[], per: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out;
}

const rows = (cells: Widget[][], gap: number): Widget[] =>
  cells.map(row => new Box({ direction: 'row', gap, align: 'center', justify: 'center' }, row));

export function buildProfileOverlay(host: UiHost, d: ProfileOverlayDeps): ProfileOverlay {
  const c = host.theme.colors;
  const p = d.params;
  const set = d.badges;
  let prof = loadProfile(d.storage, p);

  const keyOf = (i: number): BadgeName => AVATAR_KEYS[i] ?? AVATAR_KEYS[0];
  /** 文案先算成函数：构造期只能进 Label 构造函数（setText 要求控件已入视图），开面板时才允许回写 */
  const bestText = (): string => `最高记录：${readCount(d.storage, BEST_KEY)} 米`;
  /** 免费次数与价格都读自 config，文案跟着档案状态走，别写死；提示与标题合并成一行省高度 */
  const hintText = (): string => {
    const freeLeft = Math.max(0, p.freeRenames - prof.renames);
    return freeLeft > 0
      ? `点名字改一个 · 免费 ${freeLeft} 次`
      : `点名字改一个 · 每次 ${p.renameCostDiamonds} 钻（余额 ${readCount(d.storage, DIAMOND_KEY)}）`;
  };
  const nameL = new Label({ text: prof.name, fontSizePx: 20, color: c.gold });
  const idL = new Label({ text: `账号 ID：${prof.id}`, fontSizePx: 13, color: TEXT_ON_PANEL });
  const bestL = new Label({ text: bestText(), fontSizePx: 13, color: TEXT_ON_PANEL });
  const hintL = new Label({ text: hintText(), fontSizePx: 11, color: MUTED_ON_PANEL });

  const applyAvatar = (i: number): void => {
    const next = withAvatar(prof, i, AVATAR_KEYS.length);
    if (next === prof) return; // 越界或同号：不写盘、不提示
    prof = next;
    saveProfile(d.storage, prof);
    const key = keyOf(i);
    bigAvatar.setImage(key);
    d.onAvatar(key);
    host.toast('头像已更换');
  };

  const applyName = (candidate: string): void => {
    const r = tryRename(prof, p, candidate, readCount(d.storage, DIAMOND_KEY));
    if (!r.ok) {
      host.toast(failText(r.reason, r.cost));
      return;
    }
    prof = r.profile;
    saveProfile(d.storage, prof);
    d.storage.set(DIAMOND_KEY, String(r.diamondsLeft)); // 余额回落盘，顶栏数字同步
    d.onDiamonds(r.diamondsLeft);
    nameL.setText(prof.name);
    hintL.setText(hintText());
    host.toast(r.cost > 0 ? `已改名为「${prof.name}」，花费 ${r.cost} 钻石` : `已改名为「${prof.name}」（免费）`);
  };

  const badge = (k: BadgeName, i: number): Box =>
    (set ? badgeButton(set, k, AVATAR_PX, AVATAR_PX, () => applyAvatar(i), `头像${k}`) : tagOnly(AVATAR_PX, `头像${k}`, () => applyAvatar(i)));
  const bigAvatar = createAvatarSlot(set, 92, keyOf(prof.avatar), () => applyAvatar((prof.avatar + 1) % AVATAR_KEYS.length));

  const panelH = Math.max(MIN_PANEL_H, Math.round(host.adapter.canvas.windowSize().height * p.panelHeightPct / 100));
  const slide = new SlideBox(
    {
      closedTop: -panelH, durationMs: p.slideDurationMs, height: panelH, width: { percent: 100 },
      direction: 'column', background: host.solidSkin, backgroundColor: PANEL_BG, backgroundOpacity: 0.97, padding: 12, gap: 5,
    },
    [
      new Box({ direction: 'row', gap: 12, align: 'center' }, [
        bigAvatar.box,
        // 自适应列必须 width:0 + flex:1（框架 flex 只增不减，基线取内容宽）
        new Box({ direction: 'column', flex: 1, width: 0, gap: 3 }, [nameL, idL, bestL]),
      ]),
      new Label({ text: '点头像换一个（大头像按顺序换）', fontSizePx: 12, color: MUTED_ON_PANEL }),
      new Box({ direction: 'row', gap: 3, align: 'center', justify: 'center' }, AVATAR_KEYS.map(badge)),
      hintL,
      ...rows(chunk(p.nameCandidates.map(n => new Button({
        label: n, fontSizePx: 13, padding: { top: 5, bottom: 5, left: 9, right: 9 }, onClick: () => applyName(n),
      })), NAME_PER_ROW), 6),
      new Box({ flex: 1, height: 0 }),
      new Label({ text: '点击下方空白处返回', fontSizePx: 12, color: c.muted, align: 'center' }),
    ],
  );
  const catcher = tapCatcher(() => close());
  // 不再包一层全屏容器：hit 测试是「反向扫描到第一个包含命中点的分支就返回」，
  // 全屏透传壳会先吃掉整屏命中、把底下的商店/角色格全判死（2026-10-03 实测踩到）。
  // 所以把捕获层与面板作为两个 absolute 兄弟直接交给页面根 Box（顺序＝捕获层在前、面板在后）。

  const open = (): void => {
    bestL.setText(bestText()); // 打完一局再开面板要看到新纪录
    hintL.setText(hintText());
    catcher.visible = true;
    slide.open();
  };
  function close(): void {
    catcher.visible = false; // 收起后必须让出命中，否则整屏点击都被捕获层吃掉
    slide.close();
  }

  return {
    catcher,
    panel: slide,
    toggle: () => (slide.isOpen ? close() : open()),
    isOpen: () => slide.isOpen,
    avatarKey: () => keyOf(prof.avatar),
  };
}
