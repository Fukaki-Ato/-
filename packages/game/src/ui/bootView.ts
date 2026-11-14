/**
 * 共享配置启动页：海滨品牌与真实状态行，不伪造下载百分比。
 */
import { Box, Label, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { BootHandle } from '../flow/views.js';
import { CoastalBay, coast } from './coastalWidgets.js';

export interface BootPage {
  view: UiView;
  handle: BootHandle;
}

export function buildBootPage(host: UiHost): BootPage {
  const title = new Label({ text: '雷霆酷跑', fontSizePx: 34, color: coast.ink, align: 'center' });
  const sub = new Label({ text: 'THUNDER RUN · 海滨跑酷俱乐部', fontSizePx: 12, color: coast.sea, align: 'center' });
  const status = new Label({ text: '正在启动…', fontSizePx: 13, color: coast.muted, align: 'center' });

  const view = host.makeView();
  view.add(new Box(
    { direction: 'column', align: 'center', justify: 'center', gap: 14, flex: 1, padding: 24,
      background: host.solidSkin, backgroundColor: coast.sand },
    [title, sub, new Box({ width: { percent: 100 }, maxWidth: 360, height: 128 }, [new CoastalBay(128)]),
      new Box({ width: { percent: 100 }, maxWidth: 360, padding: 16,
        background: host.solidSkin, backgroundColor: coast.paper }, [status])],
  ));

  return {
    view,
    handle: {
      setStatus(text, isError) {
        status.setText(text);
        status.setColor(isError ? '#a43835' : coast.muted);
      },
    },
  };
}
