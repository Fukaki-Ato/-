/**
 * 成就页（canvas 版，overlayViews 装配；web DOM 版在 apps/web/src/mobileAchievements）：
 * 版式对齐设置页（居中 maxWidth 720 panel + 分节标题 + 卡片行）；数据由场景层合并服务端快照与
 * 本机 totals 后传入（AchievementsPageView），本页只做布局与交互，不碰存储/API。
 * 档位以行外框颜色表达（框架 Box 无描边 → 外层档位色底 + 内层 card 双层底色实现）；bronze/silver
 * 是固定语义色的有意例外（settingsView 头注「不硬编码颜色」针对主题配置字段；模块级调色板先例=
 * lobbyView 的 PILL_BG/BAR_BG），gold 沿用主题金色；进度条填充同用档位色。
 * 文案来自 config/achievements.json（名称/描述）+ 场景层 rewardText/分节标题（渲染层不硬编码配置文案）。
 */
import { Box, Button, Label, ScrollView, mixHex, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { AchievementsActions, AchievementsPageView, AchievementRowView } from '../flow/views.js';

/** 档位色：铜/银为固定语义色（有意例外，见文件头）；金=主题金色。银取中间调以免浅色底上不可辨 */
const TIER_FIXED_COLORS: Record<string, string> = { bronze: '#C98850', silver: '#A7B6C4' };

export interface AchievementsPageDeps {
  page: AchievementsPageView;
  actions: AchievementsActions;
}

export function buildAchievementsPage(host: UiHost, d: AchievementsPageDeps): { view: UiView } {
  const c = host.theme.colors;
  const tierColor = (tier: string): string => (tier === 'gold' ? c.gold : TIER_FIXED_COLORS[tier] ?? c.muted);

  /** 点「领取」：结果 message 交 toast（ok 的状态标记重绘由场景层整页刷新完成，失败保持原状） */
  const claim = (row: AchievementRowView): void => {
    host.toast(d.actions.onClaim(row.id).message);
  };

  /** 行右端状态框：未达成=白底灰字；可领取=绿底白字「领取」（Button.backgroundColor 固定语义色）；
   *  离线锁定=同款绿置灰；已领取=灰底 muted「已领取 ✓」。白/绿为固定语义色的有意例外（同档位色口径） */
  const statusOf = (row: AchievementRowView): Box => {
    if (row.claimed) {
      return new Box(
        { align: 'center', minWidth: 64, padding: { top: 4, bottom: 4, left: 10, right: 10 }, background: host.solidSkin, backgroundColor: mixHex(c.card, c.text, 0.15) },
        [new Label({ text: '已领取 ✓', fontSizePx: 12, color: c.muted })],
      );
    }
    if (row.claimable || row.locked) {
      return new Box({ align: 'center', minWidth: 64 }, [new Button({
        label: '领取', labelColor: '#ffffff', backgroundColor: '#2EA44F', fontSizePx: 13, disabled: row.locked || row.claiming,
        padding: { top: 6, bottom: 6, left: 12, right: 12 }, onClick: () => claim(row),
      })]);
    }
    return new Box(
      { align: 'center', minWidth: 64, padding: { top: 4, bottom: 4, left: 10, right: 10 }, background: host.solidSkin, backgroundColor: '#ffffff' },
      [new Label({ text: '未达成', fontSizePx: 12, color: mixHex('#ffffff', '#000000', 0.45) })],
    );
  };

  /** 进度条：高 8 轨道盒内按百分比宽的填充子盒；填充=档位色，已领取置灰（配色先例=settingsView 的 mixHex 轨道） */
  const progressBar = (row: AchievementRowView): Box => {
    const pct = row.target > 0 ? Math.max(0, Math.min(100, row.progress / row.target * 100)) : 0;
    return new Box(
      { flex: 1, height: 8, background: host.solidSkin, backgroundColor: mixHex(c.card, c.text, 0.3) },
      [new Box({ height: 8, width: { percent: pct }, background: host.solidSkin, backgroundColor: row.claimed ? mixHex(c.card, c.text, 0.5) : tierColor(row.tier) })],
    );
  };

  /** 成就行：档位色外框（外层 2px 档位色底 + 内层 card 卡片）+ 名称/描述/奖励列 + 进度条 + 计数 + 状态 */
  const achRow = (row: AchievementRowView): Box => new Box(
    { padding: { top: 2, bottom: 2, left: 2, right: 2 }, background: host.solidSkin, backgroundColor: tierColor(row.tier) },
    [new Box(
      {
        direction: 'row', align: 'center', gap: 10,
        padding: { top: 8, bottom: 8, left: 10, right: 10 }, background: 'card',
      },
      [
        new Box({ direction: 'column', gap: 2, width: { percent: 26 } }, [
          new Label({ text: row.name, fontSizePx: 14, color: c.text }),
          new Label({ text: row.desc, fontSizePx: 11, color: c.muted }),
          new Label({ text: row.rewardText, fontSizePx: 11, color: c.gold }),
        ]),
        progressBar(row),
        new Label({ text: `${Math.floor(row.progress).toLocaleString()}/${row.target.toLocaleString()}`, fontSizePx: 11, color: c.muted }),
        statusOf(row),
      ],
    )],
  );

  const sections = d.page.sections.map(section => new Box(
    { direction: 'column', gap: 6, align: 'stretch', padding: { top: 4 } },
    [
      new Label({ text: section.title, fontSizePx: 14, color: c.gold }),
      new Label({ text: section.note, fontSizePx: 12, color: c.muted }),
      ...section.rows.map(achRow),
    ],
  ));

  const view = host.makeView();
  view.add(new Box(
    { direction: 'column', align: 'center', justify: 'center', flex: 1, padding: 12 },
    [new Box(
      {
        direction: 'column', width: { percent: 100 }, maxWidth: 720, flex: 1, gap: 10,
        padding: { top: 14, bottom: 14, left: 14, right: 14 }, background: 'panel',
      },
      [
        new Box({ direction: 'row', align: 'center', gap: 12 }, [
          new Button({
            label: '返回', fontSizePx: 13,
            padding: { top: 6, bottom: 6, left: 10, right: 10 }, onClick: d.actions.onBack,
          }),
          new Label({ text: '成就', fontSizePx: 22, color: c.neon }),
          new Box({ flex: 1 }),
          new Label({ text: `已领取 ${d.page.claimedCount}/${d.page.total}`, fontSizePx: 13, color: c.gold }),
        ]),
        // 离线口径：本地 totals 预览照常展示，run 类「领取」置灰；任务服务恢复后重进成就页自动取数。
        // 状态行优先展示场景层给的最新消息（load 失败的真实原因），无则用默认离线文案
        ...(d.page.offline ? [new Label({ text: d.page.statusMessage ?? d.page.offlineMessage, fontSizePx: 12, color: c.muted })] : []),
        ...(d.page.rows.length ? [new ScrollView({ axis: 'y', flex: 1, content: new Box(
          { direction: 'column', gap: 10, align: 'stretch', padding: { top: 2 } }, sections,
        ) })] : [new Label({ text: '暂无成就', fontSizePx: 13, color: c.muted })]),
      ],
    )],
  ));
  return { view };
}
