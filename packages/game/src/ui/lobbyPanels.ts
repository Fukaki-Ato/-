/**
 * 主界面内复用的选角面板（issue #12：「开始酷跑」沿用现有选角 → 跑酷流程，
 * 已有可复用页面只复用不扩展）。从 lobbyView 拆出以守住单文件 300 行门禁。
 * 点选即写本机记忆 CHAR_KEY（既有行为，不新增数据读写）。
 */
import { Box, Button, Label, List } from '@tr/framework/ui/index.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import { buildLoadout, playableCharacters, type Loadout } from '@tr/game/core/sim/character.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import { CHAR_KEY } from '../flow/mainFlow.js';
import { MiniCard, type CardEnv } from './charCard.js';

/** 选角面板技能行：释放门槛与冷却全部由 skills.json 推导（charge.slides / cooldownS），不写死文案 */
export function skillLine(load: Loadout): string {
  const sk = load.skill;
  if (!sk) return '技能：无';
  const gate = sk.chargeSlides > 0
    ? `主动下滑 ${sk.chargeSlides} 次可释放${sk.cooldownS > 0 ? `，之后冷却 ${sk.cooldownS}s` : ''}`
    : `开局即可释放，冷却 ${sk.cooldownS}s`;
  return `技能：${sk.label} — ${sk.desc}（双击屏幕 / E 释放；${gate}）`;
}

/** 被动行：与技能行同规格展示 */
export function passiveLine(load: Loadout): string {
  return load.passive.length ? `被动：${load.talentLabel} — ${load.talentDesc}` : '被动：无';
}

export interface CharPanelDeps {
  content: GameContent;
  currentCharId: string;
  /** 面板宽度 px（布局常量表给出） */
  width: number;
  onClose(): void;
  /** 点选角色时回传 id（主界面据此决定「开始酷跑」跑谁） */
  onChoose?(id: string): void;
}

export function buildCharPanel(host: UiHost, d: CharPanelDeps): { panel: Box; refresh(): void } {
  const c = host.theme.colors;
  const chars = playableCharacters(d.content);
  const loads = chars.map(x => buildLoadout(d.content, x.id));
  let chosen = chars.some(x => x.id === d.currentCharId) ? d.currentCharId : (chars[0]?.id ?? '');
  const chosenIndex = (): number => Math.max(0, chars.findIndex(x => x.id === chosen));

  const live = new Set<MiniCard>();
  const cardEnv: CardEnv = { colors: c, solid: host.solidSkin, tintOf: i => loads[i]?.tint ?? '#ffffff', live };
  const infoL = new Label({ text: '', fontSizePx: 12, color: c.muted, align: 'center' });
  const refreshMarks = (): void => { for (const card of live) card.setPicked(card.slotIndex === chosenIndex()); };
  const choose = (i: number): void => {
    const id = chars[i]?.id;
    if (!id) return;
    chosen = id;
    host.adapter.storage.set(CHAR_KEY, id);
    d.onChoose?.(id);
    const load = loads[i]!;
    infoL.setText(`${load.name}：${skillLine(load)}　${passiveLine(load)}`);
    refreshMarks();
  };

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
  const panel = new Box(
    { direction: 'column', background: 'panel', backgroundOpacity: 0.9, padding: 10, gap: 6, width: d.width },
    [
      new Box({ direction: 'row', justify: 'spaceBetween', align: 'center' }, [
        new Label({ text: '选择角色（点选即保存）', fontSizePx: 14, color: c.gold }),
        new Button({ label: '收起', fontSizePx: 12, padding: { top: 4, bottom: 4, left: 12, right: 12 }, onClick: d.onClose }),
      ]),
      list,
      infoL,
    ],
  );
  // 首次刷新交给调用方在 panel 入视图后调（Label.setText 的 bind 语义：入视图前不可布局）
  return { panel, refresh: () => choose(chosenIndex()) };
}
