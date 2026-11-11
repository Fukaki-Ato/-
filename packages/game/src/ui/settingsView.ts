/**
 * 设置页（P3 第 1 版）：从大厅右上「设置」徽标进入；当前项＝切换跑酷场景 + 音乐/音效音量。
 * 场景列表直接来自 config/themes.json（名称取 name.zh-CN、配色取主题字段——渲染层不硬编码文案/颜色）；
 * 点选主题即回传流程校验并写本机记忆（THEME_KEY），下一局进 run 时生效——本页不读写存储、不重建 GL 场景。
 * 音量行＝图标 + 名称 + 可拖动滑条 + 百分比 + 「< / >」步进：滑条拖动 1% 粒度、按钮 10% 步进，
 * 全部即时回传流程落盘，行内即时更新（立即生效语义）。图标用 ♪/♬ 字形（字体图集收录，缺字形＝空白）。
 * 本文件只组合 @tr/ui 基础控件，零 DOM（包内铁律）；后续设置项按「分节标题 + 行」继续往下加即可。
 */
import { Box, Button, Label, mixHex, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { SettingsActions, VolumeKind, VolumeSettings } from '../flow/views.js';
import { solidChip } from './parts.js';
import { VolumeSlider } from './volumeSlider.js';

export interface SettingsPageDeps {
  content: GameContent;
  actions: SettingsActions;
  /** 生效中的场景主题 id（流程从本机记忆解析后传入；null＝配置里一条主题都没有） */
  currentThemeId: string | null;
  /** 生效音量（流程从本机记忆 + 配置默认解析后传入；行内步进即时更新） */
  volumePrefs: VolumeSettings;
}

export interface SettingsPage { view: UiView }

export interface ThemeOption {
  id: string;
  name: string;
  /** 场景配色预览（sky.baseColor / groundColor；字段缺失时回渲染层同款兜底色） */
  sky: string;
  ground: string;
}

/** 主题条目 → 设置页选项；id 缺失的条目跳过（不维护 id 白名单，删/加主题只动配置） */
export function themeOptions(content: GameContent): ThemeOption[] {
  const items = (content.themes.items ?? []) as Record<string, unknown>[];
  return items.flatMap(item => {
    const id = typeof item['id'] === 'string' ? item['id'] : '';
    if (!id || (item['status'] !== 'live' && item['status'] !== 'draft')) return [];
    const name = (item['name'] as Record<string, string> | undefined)?.['zh-CN'];
    const sky = (item['sky'] as Record<string, string> | undefined)?.['baseColor'];
    return [{
      id,
      name: name ?? id,
      sky: sky ?? '#8ED0F2',
      ground: (item['groundColor'] as string | undefined) ?? '#E3CFA4',
    }];
  });
}

export function buildSettingsPage(host: UiHost, d: SettingsPageDeps): SettingsPage {
  const c = host.theme.colors;
  const options = themeOptions(d.content);
  let current = d.currentThemeId ?? options[0]?.id ?? null;
  const markers = new Map<string, Label>();
  const paint = (): void => {
    for (const [id, marker] of markers) {
      const on = id === current;
      marker.setText(on ? '使用中' : '选择');
      marker.setColor(on ? c.gold : c.muted);
    }
  };
  const select = (id: string): void => {
    if (id === current) return;
    if (!d.actions.onSelectTheme(id)) return; // 流程校验未通过（配置里没有这条主题）：保持原选择
    current = id;
    paint();
  };

  // 场景行：配色双色块（天空/地面）+ 名称 + 右端「使用中／选择」标记；点行即切换
  const rows = options.map(option => {
    const marker = new Label({ text: '选择', fontSizePx: 12, color: c.muted });
    markers.set(option.id, marker);
    return new Box(
      {
        direction: 'row', align: 'center', gap: 10, padding: { top: 8, bottom: 8, left: 10, right: 10 },
        background: 'card', onClick: () => select(option.id),
      },
      [
        new Box({ direction: 'row', gap: 2 }, [
          solidChip(host.solidSkin, 24, option.sky),
          solidChip(host.solidSkin, 24, option.ground),
        ]),
        new Label({ text: option.name, fontSizePx: 15, color: c.text }),
        new Box({ flex: 1 }),
        marker,
      ],
    );
  });

  // 音量行：图标 + 名称 + 可拖动滑条（1% 粒度）+ 百分比 + 「< / >」步进（10%）；
  // 全部即时回传流程落盘，行内即时更新；滑条被流程拒绝时回退显示原值；端点不再回调
  const volume = { music: d.volumePrefs.music, sfx: d.volumePrefs.sfx };
  const volumeLabels = new Map<VolumeKind, Label>();
  const sliders = new Map<VolumeKind, VolumeSlider>();
  const paintVolume = (): void => {
    for (const [kind, label] of volumeLabels) label.setText(`${Math.round(volume[kind] * 100)}%`);
    for (const [kind, slider] of sliders) slider.setValue(volume[kind]);
  };
  const slideVolume = (kind: VolumeKind) => (v: number): boolean => {
    if (!d.actions.onSetVolume(kind, v)) { sliders.get(kind)?.setValue(volume[kind]); return false; }
    volume[kind] = v;
    paintVolume();
    return true;
  };
  const stepVolume = (kind: VolumeKind, delta: number): void => {
    const next = Math.min(1, Math.max(0, Math.round((volume[kind] + delta) * 100) / 100));
    if (next === volume[kind]) return; // 端点：不回调
    slideVolume(kind)(next);
  };
  /** 图标（♪ 音乐 / ♬ 音效）与配色：取主题强调色，音乐金、音效霓虹青 */
  const icons: Record<VolumeKind, { glyph: string; color: string }> = {
    music: { glyph: '♪', color: c.gold },
    sfx: { glyph: '♬', color: c.neon },
  };
  const volumeRow = (name: string, kind: VolumeKind): Box => {
    const icon = icons[kind];
    const value = new Label({ text: '', fontSizePx: 15, color: c.gold });
    volumeLabels.set(kind, value);
    const slider = new VolumeSlider({
      flex: true, height: 12, value: volume[kind],
      trackColor: mixHex(c.card, c.text, 0.3), fillColor: icon.color,
      onChange: slideVolume(kind),
    });
    sliders.set(kind, slider);
    const stepButton = (glyph: string, delta: number): Button => new Button({
      label: glyph, fontSizePx: 13, padding: { top: 4, bottom: 4, left: 10, right: 10 },
      onClick: () => stepVolume(kind, delta),
    });
    return new Box(
      {
        direction: 'row', align: 'center', gap: 10, padding: { top: 8, bottom: 8, left: 10, right: 10 },
        background: 'card',
      },
      [
        new Label({ text: icon.glyph, fontSizePx: 16, color: icon.color }),
        new Label({ text: name, fontSizePx: 15, color: c.text }),
        slider,
        value,
        stepButton('<', -0.1),
        stepButton('>', 0.1),
      ],
    );
  };

  const view = host.makeView();
  view.add(new Box(
    { direction: 'column', align: 'center', justify: 'center', flex: 1, padding: 12 },
    [new Box(
      {
        direction: 'column', width: { percent: 100 }, maxWidth: 720, gap: 10,
        padding: { top: 14, bottom: 14, left: 14, right: 14 }, background: 'panel',
      },
      [
        new Box({ direction: 'row', align: 'center', gap: 12 }, [
          new Button({
            label: '返回', fontSizePx: 13,
            padding: { top: 6, bottom: 6, left: 10, right: 10 }, onClick: d.actions.onBack,
          }),
          new Label({ text: '设置', fontSizePx: 22, color: c.neon }),
        ]),
        new Box({ direction: 'column', gap: 6, align: 'stretch', padding: { top: 4 } }, [
          new Label({ text: '跑酷场景', fontSizePx: 14, color: c.gold }),
          new Label({ text: '点选即保存，下一局生效', fontSizePx: 12, color: c.muted }),
          ...(rows.length ? rows : [new Label({ text: '暂无可选场景', fontSizePx: 13, color: c.muted })]),
        ]),
        new Box({ direction: 'column', gap: 6, align: 'stretch', padding: { top: 4 } }, [
          new Label({ text: '音量', fontSizePx: 14, color: c.gold }),
          new Label({ text: '拖动或点按，立即生效', fontSizePx: 12, color: c.muted }),
          volumeRow('音乐音量', 'music'),
          volumeRow('音效音量', 'sfx'),
        ]),
      ],
    )],
  ));
  paint();
  paintVolume(); // Label 入视图后才可 setText（与选角面板同一口径）
  return { view };
}
