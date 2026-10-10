/**
 * 开始页（P2，替代原账号/openid 输入页）：品牌跑酷封面 + 恰好两个入口「微信登录」「游客登录」。
 * 无文本框、无键盘录入、无格式校验；微信登录由 mainFlow 调注入的 adapter.extras.login()，
 * 仅 wx 环境可点（web 壳 extras.login 是本地游客兜底，不冒充微信登录）。
 * 登录中锁按钮、失败原因经 StartHandle 回写反馈行，玩家停留本页可重试或改选游客。
 */
import { Box, Button, Label, Panel, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { StartActions, StartHandle } from '../flow/views.js';

export interface StartPage {
  view: UiView;
  handle: StartHandle;
}

export function buildStartPage(host: UiHost, actions: StartActions): StartPage {
  const c = host.theme.colors;
  const canWechat = actions.wechatAvailable;

  const btnWechat = new Button({
    label: '微信登录', variant: 'primary', fontSizePx: 17, width: { percent: 100 },
    disabled: !canWechat, onClick: actions.onWechat,
  });
  const btnGuest = new Button({ label: '游客登录', fontSizePx: 16, width: { percent: 100 }, onClick: actions.onGuest });
  const feedback = new Label({ text: '', fontSizePx: 12, color: c.muted, align: 'center' });
  const note = new Label({
    text: canWechat ? '进度暂存本机，账号云存档后续开放' : '网页端暂不支持微信登录，请选择游客登录',
    fontSizePx: 11, color: c.muted, align: 'center',
  });

  // 霓虹双色跑道条（与启动页同款装饰，保持品牌一致）
  const stripe = new Box(
    { direction: 'row', width: { percent: 80 }, height: 6 },
    [
      new Box({ flex: 60, height: 6, background: host.solidSkin, backgroundColor: c.neon, backgroundOpacity: 0.85 }),
      new Box({ flex: 40, height: 6, background: host.solidSkin, backgroundColor: c.gold, backgroundOpacity: 0.6 }),
    ],
  );

  const card = new Panel(
    { width: { percent: 88 }, maxWidth: 400, direction: 'column', align: 'center', gap: 10,
      padding: { top: 28, bottom: 22, left: 24, right: 24 } },
    [
      new Label({ text: '雷霆酷跑', fontSizePx: 38, color: c.neon, align: 'center' }),
      new Label({ text: 'THUNDER RUN · 霓虹雷暴都市', fontSizePx: 12, color: c.muted, align: 'center' }),
      new Box({ padding: { top: 6, bottom: 6 }, width: { percent: 100 }, align: 'center' }, [stripe]),
      new Label({ text: '穿梭雷暴街区，闪避、收集、一路狂奔', fontSizePx: 13, color: c.text, align: 'center' }),
      new Box({ direction: 'column', gap: 10, width: { percent: 100 }, align: 'stretch', padding: { top: 8 } },
        [btnWechat, btnGuest]),
      feedback,
      note,
    ],
  );

  const view = host.makeView();
  view.add(new Box({ direction: 'column', align: 'center', justify: 'center', flex: 1, padding: 16 }, [card]));

  return {
    view,
    handle: {
      setBusy(busy) {
        btnWechat.setDisabled(busy || !canWechat);
        btnGuest.setDisabled(busy);
      },
      setFeedback(text, isError) {
        feedback.setText(text);
        feedback.setColor(isError ? c.danger : c.muted);
      },
    },
  };
}
