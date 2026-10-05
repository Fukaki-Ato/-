/**
 * 局内 HUD（run 页）：顶部一行数据（分数·金币·里程·爱心 + buff 合并行），
 * 技能状态改由中右方两枚图标表达（skillIcons.ts）：主动亮=可点释放、被动亮=此刻生效但不可释放。
 * 数据源仍是 runnerScene 的 onHud 推送（HudData 与 render 层同源）；
 * buff 合并规则（同名取最长剩余、永久被动不显倒计时）逐字移植。
 */
import { Box, Label, Panel, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { HudActions, HudData, HudHandle } from '../flow/views.js';
import { buildSkillIcons, skillSafeFrom, type SkillIconSet, type SkillIconsHandle } from './skillIcons.js';

export interface HudPage {
  view: UiView;
  handle: HudHandle;
  /** 技能图标区句柄（测试锚点：读图标文字/可点性） */
  icons: SkillIconsHandle;
}

export interface HudDeps {
  /** 技能图标贴图（壳侧加载注入；缺省时图标位退化为纯色圆） */
  icons?: SkillIconSet;
  /** 安全区来源（game.json params.ui）；缺省用默认 */
  content?: GameContent;
  actions?: HudActions;
}

export function buildHudPage(host: UiHost, d: HudDeps = {}): HudPage {
  const c = host.theme.colors;
  // maxWidthPx 显式给定：Label 的 hintWidth 两遍收敛只增不减，auto 宽面板会被首帧短文本锁宽；
  // 注意不可配 align:center——行内对齐以 maxWidthPx 为基准会把文本推离面板中心。
  const line = new Label({ text: '', fontSizePx: 14, color: c.text, maxWidthPx: 560 });
  const panel = new Panel(
    { background: 'card', backgroundOpacity: 0.82, direction: 'column', align: 'center', gap: 3,
      padding: { top: 8, bottom: 8, left: 18, right: 18 } },
    [line],
  );
  const icons = buildSkillIcons(
    host,
    d.icons ?? {},
    d.actions?.onCastSkill ? () => d.actions?.onCastSkill?.() : null,
    skillSafeFrom(d.content?.game.params?.['ui']),
  );
  const view = host.makeView();
  view.add(new Box(
    { direction: 'column', align: 'center', passthrough: true, padding: { top: 14 } },
    [panel],
  ));
  // 技能图标挂同一棵 view：absolute 定位，不受顶部数据行的布局影响
  view.add(icons.root);

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
      // 技能状态交给图标：主动取 ready/cd/charge，被动取 active/charges（无被动的角色全暗）
      const sk = h.skill;
      icons.update({
        ready: sk?.ready ?? false,
        cd: sk?.cd ?? 0,
        charge: sk?.charge ?? null,
        active: h.passive?.active ?? false,
        charges: h.passive?.charges ?? 0,
      });
    },
    dispose() {
      disposed = true;
      host.clear();
    },
  };
  return { view, handle, icons };
}
