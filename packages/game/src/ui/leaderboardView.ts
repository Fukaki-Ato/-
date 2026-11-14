import { Box, ScrollView, type NinePatchSource } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { LeaderboardData, LeaderboardEntry, LeaderboardService } from '../core/leaderboard.js';
import { coast, text, WelfareAction } from './welfareCards.js';

interface LeaderboardArtwork { portraits?: Partial<Record<string, NinePatchSource>> }

/** 首次金币前距离榜。只展示服务端排名，不将本局分数或拥有角色误当榜单数据。 */
export function mountLeaderboardPage(host: UiHost, service: LeaderboardService, onBack: () => void,
  art: LeaderboardArtwork = {}): () => void {
  let disposed = false, busy = false, expanded = false, failed = false;
  let data: LeaderboardData | undefined;
  let message = '加载中…';
  const view = host.makeView();
  const active = (): boolean => !disposed && host.overlay.current === view;
  const header = new Box({ direction: 'row', gap: 8, padding: 14, align: 'center' });
  const content = new Box({ gap: 12, padding: { left: 14, right: 14, bottom: 18 } });
  const footer = new Box({ padding: { left: 14, right: 14, top: 8, bottom: 12 } });
  const scroll = new ScrollView({ axis: 'y', height: 0, flex: 1, content });
  const line = (entry: LeaderboardEntry): string => `${entry.rank}. ${entry.playerName}`;
  const row = (entry: LeaderboardEntry, personal = false): Box => {
    const portrait = art.portraits?.[entry.charId];
    const values = new Box({ width: 0, flex: 1, gap: 5 }, [
      text(personal ? `个人最佳：${line(entry)}` : line(entry), personal ? 17 : 16),
      text(`${entry.distance.toFixed(2)} m`, personal ? 27 : 23, coast.sea),
      text(`金币前得分 ${entry.score}`, 12, coast.muted),
    ]);
    return new Box({ direction: 'row', gap: 12, padding: 14, align: 'center',
      background: host.solidSkin, backgroundColor: personal ? coast.gold : coast.paper }, [
      ...(portrait ? [new Box({ width: 48, height: 64, background: portrait })] : []), values,
    ]);
  };
  const paint = (): void => {
    if (!active()) return;
    for (const box of [header, content, footer]) for (const child of [...box.children]) box.remove(child);
    header.add(new WelfareAction(host, '返回', () => { if (active()) { disposed = true; onBack(); } }, true, coast.paper, 64),
      new Box({ width: 0, flex: 1 }, [text('排行榜', 22)]),
      new WelfareAction(host, '刷新', () => { void refresh(); }, !busy, coast.paper, 64));
    content.add(new Box({ background: host.solidSkin, backgroundColor: coast.foam, padding: 14, gap: 6 }, [
      text('海滨跑酷俱乐部', 12, coast.sea), text('首次金币前，能跑多远？', 22),
      text('按第一次吃金币前的距离排名；同距离比较金币前得分。', 13, coast.muted),
    ]));
    content.add(text(message, 13, coast.muted));
    if (!data) {
      if (failed) content.add(new WelfareAction(host, '重试加载', () => { void refresh(); }, !busy));
      return;
    }
    content.add(data.personal ? row(data.personal, true) : new Box({ background: host.solidSkin,
      backgroundColor: coast.paper, padding: 14, gap: 5 }, [text('个人最佳：暂无纪录', 17),
      text('完成一局后，由服务器校验成绩。', 13, coast.muted)]));
    content.add(text(expanded ? '全服前50名' : '全服前4名', 16));
    for (const entry of data.entries.slice(0, expanded ? 50 : 4)) content.add(row(entry));
    if (!data.entries.length) content.add(text('暂无纪录', 16, coast.muted));
    footer.add(new WelfareAction(host, expanded ? '收起为前4名' : '查看完整50名排行', () => {
      if (!active() || busy) return;
      expanded = !expanded; scroll.physics.snapTo(0); paint();
    }, !busy && data.entries.length > 4, coast.paper));
  };
  const refresh = async (): Promise<void> => {
    if (busy || !active()) return;
    busy = true; failed = false; message = '加载中…'; paint();
    try {
      const result = await service.list();
      if (!active()) return;
      data = result; if (data.entries.length <= 4) expanded = false;
      message = '按第一次吃金币前的距离排名';
    } catch {
      if (!active()) return;
      failed = true; message = '加载失败，请重试';
    } finally { busy = false; if (active()) paint(); }
  };
  view.add(new Box({ height: { percent: 100 }, background: host.solidSkin, backgroundColor: coast.sand }, [header, scroll, footer]));
  host.mount(view); void refresh();
  return () => { disposed = true; };
}
