import { Box, Label, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { HudData, HudHandle } from '../flow/views.js';
import { coast } from './welfareCards.js';

/** 手机HUD：数据分层、按真实可用宽度折行；不让增益列表挤掉得分或手势说明。 */
export function buildTouchHudPage(host: UiHost): { view: UiView; handle: HudHandle } {
  const label = (size: number, color = coast.ink) => new Label({ text: '', fontSizePx: size, color, lineHeightMul: 1.3 });
  const score = label(20), lives = label(13, coast.muted), coins = label(13), distance = label(13);
  const skill = label(13, coast.sea), buffs = label(12, coast.muted);
  buffs.visible = false;
  const cell = (child: Label, flex = 1) => new Box({ width: 0, flex, passthrough: true }, [child]);
  const view = host.makeView();
  view.add(new Box({ padding: { top: 12, left: 12, right: 12 }, align: 'center', passthrough: true }, [
    new Box({ width: { percent: 100 }, maxWidth: 420, padding: 12, gap: 7, passthrough: true,
      background: host.solidSkin, backgroundColor: coast.paper, backgroundOpacity: .94 }, [
      new Box({ direction: 'row', align: 'center', gap: 8, passthrough: true }, [cell(score, 3), cell(lives)]),
      new Box({ direction: 'row', gap: 8, passthrough: true }, [cell(coins), cell(distance)]), skill, buffs,
    ]),
  ]));
  let disposed = false;
  return { view, handle: {
    update(h: HudData) {
      if (disposed) return;
      const total = h.lives ?? 1;
      score.setText(`${h.score.toLocaleString()} 分`);
      lives.setText(`生命 ${Math.max(0, total - h.hits)}/${total}`);
      coins.setText(`采集金币 ${h.coins.toLocaleString()}`);
      distance.setText(`里程 ${Math.floor(h.distance).toLocaleString()} m`);
      const sk = h.skill;
      skill.visible = !!sk;
      if (sk) {
        const gate = sk.charge ? `下滑 ${sk.charge.now}/${sk.charge.need}` : '准备中';
        skill.setText(sk.cd > 0 ? `${sk.label}：冷却 ${sk.cd.toFixed(1)}s`
          : sk.ready ? `${sk.label}：就绪（双击屏幕）` : `${sk.label}：${gate}`);
        skill.setColor(sk.ready ? coast.sea : coast.muted);
      }
      const merged = new Map<string, number>();
      for (const buff of h.buffs ?? []) merged.set(buff.name, Math.max(merged.get(buff.name) ?? -Infinity, buff.left));
      buffs.visible = merged.size > 0;
      buffs.setText([...merged].map(([name, left]) => `${name}${Number.isFinite(left) ? ` ${Math.ceil(left)}s` : ''}`).join(' · '));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (host.overlay.current === view) host.clear();
    },
  } };
}
