/**
 * 结算页（P6）：对照 DOM screens.renderResult 逐行映射。
 * 信息：标题（新纪录判定）/大分数/里程/金币/惊险擦身/受击/技能释放(casts·charName)/历史最佳/
 * 两个按钮（再跑一次 / 返回主界面）。
 */
import { Box, Button, Label, Panel, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { ResultActions, RunSummary } from '../flow/views.js';
import { kvRow } from './parts.js';

export interface ResultDeps {
  summary: RunSummary;
  best: number;
  actions: ResultActions;
}

export interface ResultPage { view: UiView }

export function buildResultPage(host: UiHost, d: ResultDeps): ResultPage {
  const c = host.theme.colors;
  const s = d.summary;
  const isNew = s.score > d.best && s.score > 0; // 同分不记新纪录（f2d1948 裁决交接项）
  const view = host.makeView();

  const charText = s.charName || s.charId; // 显示角色名（char_volt→小电）；无名时退回 id
  const castLine = `${s.casts ?? 0} 次${charText ? ' · ' + charText : ''}`;
  const card = new Panel(
    { width: { percent: 88 }, maxWidth: 420, direction: 'column', gap: 6, padding: { top: 24, bottom: 20, left: 24, right: 24 }, align: 'center' },
    [
      new Label({ text: isNew ? '新纪录！' : '到站休息', fontSizePx: 22, color: isNew ? c.gold : c.text, align: 'center' }),
      new Label({ text: s.score.toLocaleString(), fontSizePx: 42, color: c.gold, align: 'center' }),
      new Box({ align: 'stretch', width: { percent: 100 }, gap: 0, padding: { top: 6, bottom: 4 } }, [
        kvRow(c, '里程', `${Math.floor(s.distance)} m`),
        kvRow(c, '金币', String(s.coins)),
        kvRow(c, '惊险擦身', `${s.nearMiss} 次`),
        kvRow(c, '受击', `${s.hits} 次`),
        kvRow(c, '技能释放', castLine),
        kvRow(c, '历史最佳', Math.max(d.best, s.score).toLocaleString()),
      ]),
      new Box(
        { direction: 'row', gap: 12, justify: 'center', padding: { top: 14 } },
        [
          new Button({ label: '再跑一次', variant: 'primary', fontSizePx: 17, onClick: d.actions.onRetry }),
          new Button({ label: '返回主界面', fontSizePx: 15, onClick: d.actions.onSelect }),
        ],
      ),
    ],
  );
  view.add(new Box({ direction: 'column', align: 'center', justify: 'center', flex: 1 }, [card]));
  return { view };
}
