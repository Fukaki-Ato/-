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

const SEA = {
  ink: '#315667',
  muted: '#567b83',
  teal: '#167f8e',
  sand: '#bd7d36',
  cream: '#fff5dc',
};

export function buildStartPage(host: UiHost, actions: StartActions): StartPage {
  const canWechat = actions.wechatAvailable;

  const btnWechat = new Button({
    label: 'WeChat 登录', variant: 'primary', skin: host.solidSkin, labelColor: SEA.teal,
    fontSizePx: 17, width: { percent: 100 },
    disabled: !canWechat, onClick: actions.onWechat,
  });
  const btnGuest = new Button({
    label: '游客登录', skin: host.solidSkin, labelColor: SEA.ink,
    fontSizePx: 16, width: { percent: 100 }, onClick: actions.onGuest,
  });
  const feedback = new Label({ text: '', fontSizePx: 12, color: SEA.muted, align: 'center' });
  const note = new Label({
    text: canWechat ? '进度暂存本机，账号云存档后续开放' : 'Web 不支持 WeChat 登录，选择游客登录',
    fontSizePx: 11, color: SEA.muted, align: 'center',
  });

  const stripe = new Box(
    { direction: 'row', width: { percent: 80 }, height: 6 },
    [
      new Box({ flex: 60, height: 6, background: host.solidSkin, backgroundColor: SEA.teal, backgroundOpacity: 0.9 }),
      new Box({ flex: 40, height: 6, background: host.solidSkin, backgroundColor: SEA.sand, backgroundOpacity: 0.86 }),
    ],
  );

  const card = new Panel(
    { width: { percent: 88 }, maxWidth: 400, direction: 'column', align: 'center', gap: 10,
      background: host.solidSkin, backgroundColor: SEA.cream, backgroundOpacity: 0.94,
      padding: { top: 28, bottom: 22, left: 24, right: 24 } },
    [
      new Label({ text: '雷霆酷跑', fontSizePx: 38, color: SEA.ink, align: 'center' }),
      new Label({ text: 'THUNDER RUN · 清风快跑', fontSizePx: 12, color: SEA.teal, align: 'center' }),
      new Box({ padding: { top: 6, bottom: 6 }, width: { percent: 100 }, align: 'center' }, [stripe]),
      new Label({ text: '清风中穿行，闪避、收集、一路前行', fontSizePx: 13, color: SEA.ink, align: 'center' }),
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
        feedback.setColor(isError ? '#a8493f' : SEA.muted);
      },
    },
  };
}
