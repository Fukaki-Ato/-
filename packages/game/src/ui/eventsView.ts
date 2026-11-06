/**
 * 活动页（canvas 版，overlayViews 装配；web DOM 版在 apps/web eventsOverlay）。
 * 登录签到列表：每天一行（奖励 + 领取状态），今天可领时「领取今日签到」点亮。
 * 状态数据全在 flow/localEconomy.signInState，本文件只摆放与派发（审查 M4-6）。
 */
import { Box, Button, Label, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { EventsActions } from '../flow/views.js';

export function buildEventsPage(host: UiHost, content: GameContent, actions: EventsActions): { view: UiView } {
  void content; // 活动数据经 actions.state() 注入（mainFlow 闭包持有 content），参数保留稳定装配签名
  const c = host.theme.colors;
  const view = host.makeView();
  const list = new Box({ direction: 'column', gap: 6, flex: 1, align: 'stretch' });
  const hint = new Label({ text: '', fontSizePx: 12, color: c.muted, align: 'center' });

  function update(): void {
    const state = actions.state();
    for (const old of [...list.children]) list.remove(old);
    if (!state) {
      list.add(new Label({ text: '当前没有进行中的活动', fontSizePx: 14, color: c.muted, align: 'center' }));
      return;
    }
    list.add(new Label({ text: state.name, fontSizePx: 18, color: c.neon, align: 'center' }));
    for (const d of state.days) {
      list.add(new Box({ direction: 'row', align: 'center', gap: 8, background: 'card', padding: 6 }, [
        new Label({ text: `第 ${d.day} 天`, fontSizePx: 13, color: c.text }),
        new Label({ text: d.rewardText, fontSizePx: 13, color: c.gold }),
        new Box({ flex: 1, height: 0 }),
        new Label({
          text: d.status === 'claimed' ? '已领取' : d.status === 'today' ? '今天' : '未开放',
          fontSizePx: 12, color: d.status === 'today' ? c.neon : c.muted,
        }),
      ]));
    }
  }
  update();

  view.add(new Box(
    { direction: 'column', align: 'center', flex: 1, padding: 12 },
    [new Box(
      { direction: 'column', width: { percent: 100 }, maxWidth: 720, flex: 1, gap: 10,
        padding: { top: 14, bottom: 14, left: 14, right: 14 }, background: 'panel' },
      [
        new Box({ direction: 'row', align: 'center', gap: 12 }, [
          new Button({ label: '返回', fontSizePx: 13, padding: { top: 6, bottom: 6, left: 10, right: 10 }, onClick: actions.onBack }),
          new Label({ text: '活动', fontSizePx: 22, color: c.neon }),
        ]),
        list,
        hint,
        new Button({
          label: '领取今日签到', fontSizePx: 14,
          padding: { top: 8, bottom: 8, left: 14, right: 14 },
          onClick: () => { const r = actions.onClaim(); hint.setText(r.message); update(); },
        }),
      ],
    )],
  ));
  return { view };
}
