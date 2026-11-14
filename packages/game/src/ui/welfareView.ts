import { Box, ScrollView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { MissionPeriod, MissionView } from '../core/missions/types.js';
import type { HandbookChapter, WelfareService, WelfareSnapshot } from '../core/welfare.js';
import { coast, text, WelfareAction, welfareCard } from './welfareCards.js';

export function mountWelfarePage(host: UiHost, service: WelfareService | undefined,
  mode: 'tasks' | 'handbook', onBack: () => void): () => void {
  let disposed = false, loading = false, pending = '';
  let data: WelfareSnapshot | undefined, period: MissionPeriod = 'daily';
  let message = service ? '加载中…' : '云服务未配置，暂时无法读取进度和领取奖励。';
  let retry: (() => void) | undefined;
  const header = new Box({ direction: 'row', gap: 12, padding: 14, align: 'center' });
  const content = new Box({ gap: 12, padding: { left: 14, right: 14, bottom: 18 } });
  const scroll = new ScrollView({ axis: 'y', height: 0, flex: 1, content });
  const view = host.makeView();
  const active = (): boolean => !disposed && host.overlay.current === view;
  const back = (): void => { if (!active()) return; disposed = true; onBack(); };
  const group = (): (MissionView | HandbookChapter)[] => !data ? []
    : mode === 'handbook' ? data.handbook : data[period].missions;
  const claimKey = (item: MissionView | HandbookChapter): string => mode === 'handbook'
    ? `handbook:${item.id}` : `${period}:${data![period].periodId}:${item.id}`;

  const paint = (): void => {
    if (!active()) return;
    for (const child of [...header.children]) header.remove(child);
    header.add(new WelfareAction(host, '返回', back, true, coast.paper, 64),
      new Box({ width: 0, flex: 1 }, [text(mode === 'handbook' ? '福利手册' : '任务', 22)]),
      new WelfareAction(host, '刷新', () => { void load(); }, !!service && !loading && !pending, coast.paper, 64));
    for (const child of [...content.children]) content.remove(child);
    content.add(new Box({ background: host.solidSkin, backgroundColor: coast.foam, padding: 14, gap: 6 }, [
      text('海滨跑酷俱乐部', 12, coast.sea),
      text(mode === 'handbook' ? '免费手册 · 海岸之旅' : '每次出发，都有收获', 22),
      text(mode === 'handbook' ? '完成章节，逐步解锁奖励。' : '完成每日与每周任务，领取跑酷奖励。', 13, coast.muted),
    ]));
    if (data) {
      const wallet = data.profile.wallet;
      content.add(new Box({ padding: { left: 2, right: 2 }, gap: 4 }, [
        text(`金币 ${wallet.coin}  ·  钻石 ${wallet.diamond}`, 16),
        text(`有效跑局至少 ${data.minRunSeconds} 秒，进度以服务器记录为准。`, 12, coast.muted),
      ]));
      if (mode === 'tasks') {
        const tabs = new Box({ direction: 'row', gap: 8 });
        for (const [key, title] of [['daily', '每日任务'], ['weekly', '每周任务']] as const) {
          tabs.add(new Box({ width: 0, flex: 1 }, [new WelfareAction(host, title, () => {
            if (!active() || period === key) return;
            period = key; scroll.physics.snapTo(0); paint();
          }, true, period === key ? coast.gold : coast.paper)]));
        }
        content.add(tabs);
        const stamp = new Date(data[period].resetsAt + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
        content.add(text(`服务器重置：${stamp}（北京时间）`, 12, coast.muted));
      }
    }
    const notice = new Box({ gap: 8, padding: 12, background: host.solidSkin, backgroundColor: coast.paper }, [
      text(message, 13, coast.muted),
    ]);
    if (retry) notice.add(new WelfareAction(host, data ? '重试领取' : '重试加载', retry, !loading && !pending));
    content.add(notice);
    if (!data) return;
    const items = group();
    const unlocked = (item: MissionView | HandbookChapter): boolean => !('unlocked' in item) || item.unlocked;
    const ready = items.filter(item => unlocked(item) && !item.claimed && item.progress >= item.target).length;
    const done = items.filter(item => unlocked(item) && item.progress >= item.target).length;
    content.add(text(`已达标 ${done}/${items.length}  ·  可领取 ${ready}  ·  已领取 ${items.filter(item => item.claimed).length}`, 13));
    if (!items.length) content.add(text(mode === 'handbook' ? '暂无手册章节' : '本期暂无任务', 16, coast.muted));
    items.forEach((item, index) => content.add(welfareCard(host, item, index, mode === 'handbook',
      pending === claimKey(item), loading || !!pending, () => { void claim(item); })));
  };

  const load = async (): Promise<void> => {
    if (!service || !active() || loading || pending) return;
    loading = true; retry = undefined; message = '加载中…'; paint();
    try {
      const snapshot = await service.load();
      if (!active()) return;
      data = snapshot; message = '奖励由服务器确认，领取后自动更新。';
    } catch {
      if (!active()) return;
      message = '加载失败，请重试。'; retry = () => { void load(); };
    } finally { loading = false; if (active()) paint(); }
  };
  const claim = async (item: MissionView | HandbookChapter, requestPeriod = period,
    periodId = data?.[requestPeriod].periodId): Promise<void> => {
    if (!service || !data || !active() || loading || pending || item.claimed
      || item.progress < item.target || ('unlocked' in item && !item.unlocked)) return;
    if (!periodId) return;
    pending = mode === 'handbook' ? `handbook:${item.id}` : `${requestPeriod}:${periodId}:${item.id}`;
    retry = undefined; message = '领取中…'; paint();
    try {
      const snapshot = await (mode === 'handbook' ? service.claimChapter(item.id)
        : service.claimMission(requestPeriod, periodId, item.id));
      if (!active()) return;
      data = snapshot; message = '领取成功，奖励已到账。';
    } catch {
      if (!active()) return;
      message = '领取失败，可重试或刷新进度。'; retry = () => { void claim(item, requestPeriod, periodId); };
    } finally { pending = ''; if (active()) paint(); }
  };

  view.add(new Box({ height: { percent: 100 }, background: host.solidSkin, backgroundColor: coast.sand }, [
    header, scroll,
  ]));
  host.mount(view); paint();
  if (service) void load();
  return () => { disposed = true; };
}
