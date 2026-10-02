/**
 * 角色缩略卡（大厅角色弹层 List 槽位）：色块＋名字＋稀有度＋选中标记，定高统一。
 * 槽位复用语义同 S13：构造即带初始数据，setData 只在窗口对账时触发。
 */
import { Box, Label, type NinePatchSource, type ThemeColors } from '@tr/framework/ui/index.js';
import type { Loadout } from '@tr/game/core/sim/character.js';
import { solidChip } from './parts.js';

export function rarityColor(c: ThemeColors, r: string): string {
  return r === 'SSR' ? c.gold : r === 'SR' ? c.neon : c.muted;
}

export interface CardEnv {
  colors: ThemeColors;
  solid: NinePatchSource;
  tintOf(i: number): string;
  live: Set<MiniCard>;
}

export class MiniCard extends Box {
  private chipHolder: Box;
  private nameL: Label;
  private rarityL: Label;
  private markL: Label;
  private chipTint = '';
  private boundIndex = -1;

  constructor(private envCard: CardEnv, i: number, load: Loadout, picked: boolean) {
    super({ direction: 'column', background: 'card', padding: 8, gap: 4, align: 'center', width: { percent: 100 } });
    this.chipHolder = new Box({ width: 26, height: 26, align: 'center', justify: 'center' });
    this.nameL = new Label({ text: load.name, fontSizePx: 13, color: this.envCard.colors.text });
    this.rarityL = new Label({ text: load.rarity, fontSizePx: 11, color: rarityColor(this.envCard.colors, load.rarity) });
    this.markL = new Label({ text: picked ? '✔ 已选' : '', fontSizePx: 11, color: this.envCard.colors.neon });
    this.add(new Box({ direction: 'row', gap: 6, align: 'center' }, [this.chipHolder, this.nameL]));
    this.add(this.rarityL, this.markL);
    this.setChip(this.envCard.tintOf(i));
    this.boundIndex = i;
    this.envCard.live.add(this);
  }

  setData(i: number, load: Loadout, picked: boolean): void {
    this.boundIndex = i;
    this.setChip(this.envCard.tintOf(i));
    this.nameL.setText(load.name);
    this.rarityL.setText(load.rarity);
    this.rarityL.setColor(rarityColor(this.envCard.colors, load.rarity));
    this.setPicked(picked);
  }

  setPicked(picked: boolean): void {
    this.markL.setText(picked ? '✔ 已选' : '');
  }

  get slotIndex(): number { return this.boundIndex; }

  private setChip(tint: string): void {
    if (tint === this.chipTint) return;
    this.chipTint = tint;
    for (const old of [...this.chipHolder.children]) this.chipHolder.remove(old);
    this.chipHolder.add(solidChip(this.envCard.solid, 26, tint));
  }

  override dispose(): void {
    this.envCard.live.delete(this);
    super.dispose();
  }
}
