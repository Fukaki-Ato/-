/**
 * 启动页（P1）：标题 + 副标 + 装饰进度条 + 状态行。
 * 对照 DOM screens.renderBoot：boot-title/boot-sub/boot-bar/boot-status 四项一一对应；
 * CSS 无限滑动动画改为静态双色条（自绘层无 CSS 动画，装饰信息保留，见迁移对照表）。
 */
import { Box, Label, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { BootHandle } from '../flow/views.js';

export interface BootPage {
  view: UiView;
  handle: BootHandle;
}

export function buildBootPage(host: UiHost): BootPage {
  const c = host.theme.colors;
  const title = new Label({ text: '雷霆酷跑', fontSizePx: 34, color: c.neon, align: 'center' });
  const sub = new Label({ text: 'THUNDER RUN · 霓虹雷暴都市', fontSizePx: 12, color: c.muted, align: 'center' });
  const bar = new Box(
    { direction: 'row', width: { percent: 70 }, height: 6 },
    [
      new Box({ flex: 60, height: 6, background: host.solidSkin, backgroundColor: c.neon, backgroundOpacity: 0.85 }),
      new Box({ flex: 40, height: 6, background: host.solidSkin, backgroundColor: c.gold, backgroundOpacity: 0.6 }),
    ],
  );
  const status = new Label({ text: '正在启动…', fontSizePx: 12, color: c.muted, align: 'center' });

  const view = host.makeView();
  view.add(new Box(
    { direction: 'column', align: 'center', justify: 'center', gap: 10, flex: 1, padding: 24 },
    [title, sub, new Box({ padding: { top: 18, bottom: 8 } }, [bar]), status],
  ));

  return {
    view,
    handle: {
      setStatus(text, isError) {
        status.setText(text);
        status.setColor(isError ? c.danger : c.muted);
      },
    },
  };
}
