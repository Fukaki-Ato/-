/**
 * 主界面设置面板（右上「设置」徽标开合，与「角色」面板同一个槽位、互斥）。
 * 目前只有一项：切换跑酷场景。徽标按 themes.json 顺序换到下一个场景，
 * 与选角面板同规格「点选即保存」——所选 id 写 THEME_KEY，mainFlow 进 run 时读它注入
 * createRunnerScene，所以「下一局生效」（本局画面不动，也不需要重建 GL 场景）。
 * 徽标图暂借现成的 castle（城堡+海滩+昼夜，语义最接近「场景」），专属美术到位后换名即可。
 */
import { Box, Button, Label } from '@tr/framework/ui/index.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import { THEME_KEY } from '../flow/mainFlow.js';
import { badgeButton, type BadgeSet } from './badges.js';

export interface SettingsPanelDeps {
  content: GameContent;
  /** 面板宽度 px（布局常量表给出） */
  width: number;
  /** 徽标贴图组；缺省时该项退化为文字按钮（headless 测试与贴图缺失都能点） */
  badges?: BadgeSet;
  onClose(): void;
}

/** 场景名取 config 的 name.zh-CN，渲染层不硬编码文案 */
const sceneName = (t: Record<string, unknown> | undefined): string =>
  ((t?.['name'] as Record<string, string> | undefined)?.['zh-CN']) ?? String(t?.['id'] ?? '');

export function buildSettingsPanel(host: UiHost, d: SettingsPanelDeps): { panel: Box; refresh(): void } {
  const c = host.theme.colors;
  const scenes = (d.content.themes.items ?? []) as unknown as Record<string, unknown>[];
  /** 本机记忆优先；没存过就对上首个 live 主题（与 runnerScene 的缺省口径一致） */
  const saved = scenes.findIndex(t => t['id'] === host.adapter.storage.get(THEME_KEY));
  let at = saved >= 0 ? saved : Math.max(0, scenes.findIndex(t => t['status'] === 'live'));

  const nameL = new Label({ text: '', fontSizePx: 14, color: c.text });
  const show = (): void => nameL.setText(`跑酷场景：${sceneName(scenes[at])}`);
  const next = (): void => {
    if (!scenes.length) return;
    at = (at + 1) % scenes.length;
    const id = scenes[at]?.['id'];
    if (typeof id === 'string') host.adapter.storage.set(THEME_KEY, id);
    show();
    host.toast(`已切到「${sceneName(scenes[at])}」，下一局生效`);
  };

  const icon = 72;
  const switchBtn: Box | Button = d.badges
    ? badgeButton(d.badges, 'castle', icon, icon, next, '切换场景')
    : new Button({ label: '切换场景', fontSizePx: 13, width: icon, height: icon, padding: 4, onClick: next });
  const panel = new Box(
    { direction: 'column', background: 'panel', backgroundOpacity: 0.9, padding: 10, gap: 8, width: d.width },
    [
      new Box({ direction: 'row', justify: 'spaceBetween', align: 'center' }, [
        new Label({ text: '设置', fontSizePx: 14, color: c.gold }),
        new Button({ label: '收起', fontSizePx: 12, padding: { top: 4, bottom: 4, left: 12, right: 12 }, onClick: d.onClose }),
      ]),
      new Box({ direction: 'row', align: 'center', gap: 12 }, [
        switchBtn,
        new Box({ direction: 'column', gap: 4 }, [
          nameL,
          new Label({ text: '点徽标换两侧场景', fontSizePx: 12, color: c.muted }),
        ]),
      ]),
    ],
  );
  // 文案刷新同选角面板：Label 入视图后才可布局，交给调用方在 add 之后调
  return { panel, refresh: show };
}
