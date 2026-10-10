/**
 * 局内 HUD（run 页）：数据源仍是 runnerScene 的 onHud 推送（HudData 与 render 层同源）。
 * 对照 DOM createRunHud：分数·金币·里程·爱心 + buff 合并行；技能行三态（冷却/就绪/下滑积攒），
 * 就绪金色高亮。buff 合并规则（同名取最长剩余、永久被动不显倒计时）逐字移植。
 */
import { Box, Label, Panel, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { HudData, HudHandle } from '../flow/views.js';

export interface HudPage { view: UiView; handle: HudHandle }

export function buildHudPage(host: UiHost): HudPage {
  const c = host.theme.colors;
  // maxWidthPx 显式给定：Label 的 hintWidth 两遍收敛只增不减，auto 宽面板会被首帧短文本锁宽；
  // 注意不可配 align:center——行内对齐以 maxWidthPx 为基准会把文本推离面板中心。
  const line = new Label({ text: '', fontSizePx: 14, color: c.text, maxWidthPx: 560 });
  const skill = new Label({ text: '', fontSizePx: 12, color: c.muted, maxWidthPx: 560 });
  const panel = new Panel(
    { background: 'card', backgroundOpacity: 0.82, direction: 'column', align: 'center', gap: 3,
      padding: { top: 8, bottom: 8, left: 18, right: 18 } },
    [line, skill],
  );
  const view = host.makeView();
  view.add(new Box(
    { direction: 'column', align: 'center', passthrough: true, padding: { top: 14 } },
    [panel],
  ));

  let disposed = false;
  const handle: HudHandle = {
    update(h: HudData) {
      if (disposed) return;
      const lives = h.lives ?? 1;
      const hearts = '❤'.repeat(Math.max(0, lives - h.hits)) + '♡'.repeat(Math.min(h.hits, lives));
      const merged = new Map<string, number>();
      for (const b of h.buffs ?? []) {
        const prev = merged.get(b.name);
        merged.set(b.name, prev === undefined ? b.left : Math.max(prev, b.left));
      }
      const buffs = [...merged].map(([name, left]) => `${name}${Number.isFinite(left) ? ` ${Math.ceil(left)}s` : ''}`).join(' · ');
      line.setText(`${h.score.toLocaleString()} 分 · ${h.coins} 金币 · ${Math.floor(h.distance)} m · ${hearts}${buffs ? ' · ' + buffs : ''}`);
      const sk = h.skill;
      if (!sk) { skill.setText(''); return; }
      // 未就绪且不在冷却 = 下滑积攒没满（或本局已结束），门槛文案来自配置推导的 need
      const gate = sk.charge ? `下滑 ${sk.charge.now}/${sk.charge.need}` : '准备中';
      skill.setText(sk.cd > 0
        ? `${sk.label}：冷却 ${sk.cd.toFixed(1)}s`
        : sk.ready ? `${sk.label}：就绪（双击 / E）` : `${sk.label}：${gate}`);
      skill.setColor(sk.ready ? c.gold : c.muted);
    },
    dispose() {
      disposed = true;
      host.clear();
    },
  };
  return { view, handle };
}
