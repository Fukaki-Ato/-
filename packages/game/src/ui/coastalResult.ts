import { Box, ScrollView, type NinePatchSource, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { ResultActions, RunSummary } from '../flow/views.js';
import { coast, coastalText as text, CoastalAction, coastalCard, coastalCell, coastalPortrait } from './coastalWidgets.js';

export interface CoastalResultDeps {
  summary: RunSummary;
  best: number;
  actions: ResultActions;
  portraits?: Partial<Record<string, NinePatchSource>>;
}

/** Snapshot builder: the owner subscribes to ranking and rebuilds when it changes. */
export function buildCoastalResult(host: UiHost, d: CoastalResultDeps): { view: UiView } {
  const view = host.makeView();
  const s = d.summary;
  const pending = s.ranking?.pending === true;
  const failed = !!s.ranking?.retry;
  const isNew = s.score > d.best && s.score > 0;
  const root = new Box({ height: { percent: 100 }, background: host.solidSkin, backgroundColor: coast.sand });
  let leave: (() => void) | undefined;
  const confirm = new Box({ absolute: true, top: 0, left: 0, width: { percent: 100 }, height: { percent: 100 },
    background: host.solidSkin, backgroundColor: coast.ink, backgroundOpacity: .7,
    padding: 18, justify: 'center' });
  confirm.visible = false;
  confirm.add(new ScrollView({ axis: 'y', content: coastalCard(host, [
    text('离开将放弃本局未确认奖励', 20),
    text('可先重试上传原回放；继续离开后，本局奖励将放弃。', 14, coast.muted),
    new CoastalAction(host, '留在本页', () => { confirm.visible = false; leave = undefined; view.invalidate(); }),
    new CoastalAction(host, '确认离开', () => {
      if (s.ranking?.pending) return;
      const action = leave;
      confirm.visible = false; leave = undefined; view.invalidate(); action?.();
    }, { fill: coast.coral }),
  ]) }));
  const navigate = (action: () => void): (() => void) => () => {
    if (s.ranking?.pending) return;
    if (s.ranking?.retry) { leave = action; confirm.visible = true; view.invalidate(); }
    else action();
  };
  const stat = (title: string, value: string): Box => coastalCell(coastalCard(host, [
    text(title, 12, coast.muted), text(value, 20),
  ]));
  const content = new Box({ gap: 12, padding: { left: 14, right: 14, bottom: 16 } }, [
    coastalPortrait(d.portraits?.[s.charId], true),
    coastalCard(host, [
      text(isNew ? '新纪录！' : '到站休息', 22, coast.sea),
      text(s.score.toLocaleString(), 44), text('本局得分', 12, coast.muted),
      text(s.charName || s.charId, 19),
      text(`历史最佳 ${Math.max(d.best, s.score).toLocaleString()}`, 14, coast.muted),
    ]),
    new Box({ direction: 'row', gap: 8 }, [stat('里程', `${Math.floor(s.distance)} m`), stat('本局采集金币', String(s.coins))]),
    new Box({ direction: 'row', gap: 8 }, [stat('惊险擦身', `${s.nearMiss} 次`), stat('受击', `${s.hits} 次`)]),
    coastalCard(host, [text('技能释放', 12, coast.muted), text(`${s.casts ?? 0} 次 · ${s.charName || s.charId}`, 17)]),
  ]);
  if (s.beforeFirstCoin) content.add(coastalCard(host, [
    text('首次金币前成绩', 17, coast.sea),
    text(`${s.beforeFirstCoin.distance.toFixed(2)} m · ${s.beforeFirstCoin.score.toLocaleString()} 分`, 19),
    text(s.beforeFirstCoin.stoppedByCoin ? '首次拾取金币时记录，之后的里程不计入此榜单。'
      : '本局结束前未拾取金币，按结束时的距离记录。', 12, coast.muted),
    text('此处为本局记录；是否入榜以云端确认为准。', 12, coast.muted),
  ]));
  const notice = coastalCard(host, [
    text(pending ? '云端确认中' : failed ? '云端确认失败' : '本局结算状态', 17, coast.sea),
    text(s.ranking?.message ?? '本局采集已展示，云端奖励未确认。', 14),
    text(pending || failed ? '采集金币尚未确认到账。' : '金币到账与榜单结果以云端确认为准。', 12, coast.muted),
  ], { backgroundColor: coast.foam });
  if (failed) notice.add(new CoastalAction(host, '重试上传', pending ? undefined : () => {
    if (!s.ranking?.pending) s.ranking?.retry?.();
  }, { fill: coast.gold, subtitle: '使用本局原回放' }));
  if (failed) notice.add(text('离开将放弃本局未确认奖励', 13, coast.muted));
  content.add(notice);
  if (d.actions.onLeaderboard) content.add(new CoastalAction(host, '查看榜单', pending ? undefined : navigate(d.actions.onLeaderboard)));
  root.add(
    new Box({ padding: 14, gap: 3 }, [text('海滨跑酷俱乐部', 12, coast.sea), text('本局成绩', 23)]),
    new ScrollView({ axis: 'y', height: 0, flex: 1, content }),
    new Box({ padding: { top: 8, left: 14, right: 14, bottom: 12 }, gap: 8 }, [
      ...(pending ? [text('确认中，请稍候…', 12, coast.muted)] : []),
      new Box({ direction: 'row', gap: 8 }, [
        coastalCell(new CoastalAction(host, '返回大厅', pending ? undefined : navigate(d.actions.onSelect))),
        coastalCell(new CoastalAction(host, '再跑一次', pending ? undefined : navigate(d.actions.onRetry), { fill: coast.coral })),
      ]),
    ]), confirm,
  );
  view.add(root);
  return { view };
}
