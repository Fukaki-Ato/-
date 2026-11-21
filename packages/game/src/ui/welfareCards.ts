import { Box, Label } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { MissionView } from '../core/missions/types.js';
import type { HandbookChapter } from '../core/welfare.js';

export const coast = {
  sand: '#f4ecdd', paper: '#fffdf6', ink: '#153e52', muted: '#526d76',
  line: '#cfddd7', sea: '#287d86', foam: '#e2efea', coral: '#f5aa83', gold: '#f3d58d',
};

export function text(value: string, size = 14, color = coast.ink): Label {
  return new Label({ text: value, fontSizePx: size, color, lineHeightMul: 1.35 });
}

/** Solid coastal controls retain their own colors through press/release. */
export class WelfareAction extends Box {
  readonly label: Label;
  constructor(host: UiHost, title: string, action: () => void, readonly enabled = true,
    private readonly fill = coast.coral, width?: number) {
    const label = text(title, 14, enabled ? coast.ink : coast.muted);
    super({ background: host.solidSkin, backgroundColor: enabled ? fill : coast.foam,
      minHeight: 44, minWidth: 44, width, padding: { top: 11, bottom: 11, left: 12, right: 12 },
      align: 'center', justify: 'center', onClick: () => { if (enabled) action(); } }, [label]);
    this.label = label;
  }
  override handlers() {
    return { ...super.handlers(), onPressChange: (pressed: boolean) => {
      if (this.enabled) this.setBackground({ color: pressed ? coast.gold : this.fill });
    } };
  }
}

export function rewardText(reward: Record<string, number | string>): string {
  const names: Record<string, string> = { coin: '金币', diamond: '钻石', key: '钥匙' };
  return Object.entries(reward).map(([kind, value]) => {
    if (kind === 'shard') return `角色碎片 ×${String(value).split(':').pop()}`;
    return `${names[kind] ?? '奖励'} ×${value}`;
  }).join(' · ') || '无奖励';
}

export function progressBar(host: UiHost, value: number, target: number, locked = false): Box {
  const percent = target > 0 ? Math.max(0, Math.min(100, value / target * 100)) : 100;
  return new Box({ direction: 'row', height: 8, background: host.solidSkin, backgroundColor: coast.foam }, [
    new Box({ width: { percent }, height: 8, background: host.solidSkin,
      backgroundColor: locked ? coast.line : coast.sea }),
  ]);
}

export function welfareCard(host: UiHost, item: MissionView | HandbookChapter, index: number,
  handbook: boolean, pending: boolean, busy: boolean, onClaim: () => void): Box {
  const locked = 'unlocked' in item && !item.unlocked;
  const ready = !locked && item.progress >= item.target && !item.claimed;
  const state = item.claimed ? '已领取' : pending ? '领取中…' : locked ? '锁定' : ready ? '可领取' : '进行中';
  const card = new Box({ background: host.solidSkin, backgroundColor: coast.paper, padding: 14, gap: 8 }, [
    new Box({ direction: 'row', gap: 8, justify: 'spaceBetween' }, [
      text(handbook ? `第 ${index + 1} 章` : `任务 ${index + 1}`, 12, coast.muted),
      text(state, 12, ready ? coast.sea : coast.muted),
    ]),
    text(item.title, 18),
  ]);
  if ('description' in item) card.add(text(item.description, 13, coast.muted));
  card.add(text(`进度 ${item.progress} / ${item.target}`, 13, coast.muted),
    progressBar(host, item.progress, item.target, locked),
    text(`奖励：${rewardText(item.reward)}`, 14));
  if (locked) card.add(text('完成并领取上一章后解锁', 12, coast.muted));
  card.add(new WelfareAction(host, pending ? '领取中…' : item.claimed ? '已领取' : locked ? '未解锁'
    : ready ? '领取奖励' : '未达标', onClaim, ready && !busy));
  return new Box({ background: host.solidSkin, backgroundColor: ready ? coast.sea : coast.line,
    padding: 1 }, [card]);
}
