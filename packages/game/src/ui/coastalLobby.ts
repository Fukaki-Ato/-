import { Box, ScrollView, type NinePatchSource, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { GameContent } from '../core/config/configTypes.js';
import { buildLoadout, isCharacterLocked, playableCharacters } from '../core/sim/character.js';
import type { SelectActions, SelectExtras } from '../flow/views.js';
import { coast, coastalText as text, CoastalAction, coastalCard, coastalCell, coastalPortrait } from './coastalWidgets.js';

export interface CoastalLobbyDeps {
  content: GameContent;
  actions: SelectActions;
  currentCharId: string;
  extras?: SelectExtras;
  portraits?: Partial<Record<string, NinePatchSource>>;
}

export function buildCoastalLobby(host: UiHost, d: CoastalLobbyDeps): { view: UiView } {
  const view = host.makeView();
  const roster = playableCharacters(d.content);
  let chosen = (roster.find(character => character.id === d.currentCharId && !isCharacterLocked(character))
    ?? roster.find(character => !isCharacterLocked(character)))?.id ?? '';
  const hero = new Box({ gap: 0 });
  const choices = new Box({ gap: 8 });
  choices.visible = false;
  const refreshHero = (): void => {
    for (const child of [...hero.children]) hero.remove(child);
    const load = buildLoadout(d.content, chosen);
    const stage = coastalPortrait(d.portraits?.[chosen]);
    stage.add(new Box({ absolute: true, top: 78, left: 8, width: 132, gap: 4, padding: 8,
      background: host.solidSkin, backgroundColor: coast.paper, backgroundOpacity: .97 }, [
      text(chosen ? '当前出战' : '暂无可用角色', 12, coast.sea),
      text(chosen ? load.name : '请先获取角色', 19),
      text(chosen ? load.tagline : '拥有角色后即可开始酷跑', 12, coast.muted),
    ]));
    hero.add(stage);
  };
  const refreshChoices = (): void => {
    for (const child of [...choices.children]) choices.remove(child);
    choices.add(text('选择角色 · 点选即保存', 17));
    for (const character of roster) {
      const load = buildLoadout(d.content, character.id);
      const locked = isCharacterLocked(character);
      choices.add(new CoastalAction(host,
        `${load.name} · ${locked ? '未拥有' : character.id === chosen ? '当前出战' : '出战'}`,
        locked ? undefined : () => {
          if (!d.actions.onChooseCharacter(character.id)) return;
          chosen = character.id; refreshHero(); refreshChoices();
        }, { subtitle: load.tagline, fill: character.id === chosen ? coast.gold : coast.paper }));
    }
    choices.add(new CoastalAction(host, '收起角色', () => { choices.visible = false; view.invalidate(); }));
  };
  const characters = (): void => {
    if (d.actions.onCharacterSelect) { d.actions.onCharacterSelect(); return; }
    choices.visible = !choices.visible;
    if (choices.visible) refreshChoices();
    view.invalidate();
  };
  const content = new Box({ gap: 12, padding: { left: 14, right: 14, bottom: 16 } }, [
    new Box({ direction: 'row', gap: 8 }, [
      coastalCell(coastalCard(host, [text('金币', 12, coast.muted), text(String(d.extras?.coins ?? 0), 19)])),
      coastalCell(coastalCard(host, [text('钻石', 12, coast.muted), text(String(d.extras?.diamonds ?? 0), 19)])),
    ]), hero, choices,
  ]);
  const entries = [
    ['角色', characters, '选择出战'], ['商店', d.actions.onShop, '俱乐部兑换'],
    ['仓库', d.actions.onInventory, '查看已拥有'], ['任务', d.actions.onTasks, '每日与每周'],
    ['免费福利手册', d.actions.onHandbook, '海岸之旅'], ['榜单', d.actions.onLeaderboard, '查看跑酷成绩'],
  ] as const;
  for (let i = 0; i < entries.length; i += 2) {
    const row = new Box({ direction: 'row', gap: 8 });
    for (const [title, action, subtitle] of entries.slice(i, i + 2)) {
      row.add(coastalCell(new CoastalAction(host, title, action, { subtitle })));
    }
    content.add(row);
  }
  content.add(coastalCard(host, [text('操作指南', 15, coast.sea),
    text('左右划切换车道，上划跳跃，下划滑铲。', 13, coast.muted),
    text('双击屏幕释放角色技能，冷却和积攒状态见局内提示。', 13, coast.muted),
  ]));
  view.add(new Box({ height: { percent: 100 }, background: host.solidSkin, backgroundColor: coast.sand }, [
    new Box({ direction: 'row', gap: 10, padding: 14, align: 'center' }, [
      new Box({ width: 0, flex: 1, gap: 3 }, [text('雷霆酷跑', 23), text('海滨跑酷俱乐部', 12, coast.sea)]),
      new Box({ width: 64 }, [new CoastalAction(host, '设置', d.actions.onSettings)]),
    ]),
    new ScrollView({ axis: 'y', height: 0, flex: 1, content }),
    new Box({ padding: { left: 14, right: 14, bottom: 12, top: 8 }, gap: 4 }, [
      new CoastalAction(host, '开始酷跑', chosen ? () => d.actions.onStartRun(chosen) : undefined,
        { primary: true, fill: coast.coral }),
    ]),
  ]));
  refreshHero();
  return { view };
}
