/**
 * 主菜单（P3）：对照 DOM screens.renderMenu 逐项映射；角色卡片行 → 横向可滑动虚拟 List。
 * 卡内容：色块/名字/稀有度/皮肤数·id/技能/被动 + 选中态；点卡片换角色（即写本机记忆，
 * 与 DOM 版一致）；技能提示行按所选角色刷新；开始/清缓存按钮；配置来源与版本号行。
 */
import { Box, Button, Label, List, type NinePatchSource, type ThemeColors, type UiView } from '@tr/framework/ui/index.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { FileSource } from '@tr/game/core/config/configLoader.js';
import { buildLoadout, playableCharacters, type Loadout } from '@tr/game/core/sim/character.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { MenuActions } from '../flow/views.js';
import { solidChip } from './parts.js';
import { LAST_USER_KEY } from './loginView.js';

export const CHAR_KEY = 'thunderrun:character';

/** 菜单技能行：能量攒满所需里程由配置推导（skills.json energy.perMeter），不写死文案 */
export function skillLine(load: Loadout): string {
  const sk = load.skill;
  if (!sk) return `本局角色「${load.name}」：无主动技能`;
  const need = Number.isFinite(sk.energyPerMeter) && sk.energyPerMeter > 0
    ? `跑满 ${Math.ceil(sk.energyMax / sk.energyPerMeter)} 米攒满能量`
    : '开局即可释放';
  return `本局角色「${load.name}」：双击屏幕 / E 键释放「${sk.label}」（${sk.desc}；${need}，冷却 ${sk.cooldownS}s）`;
}

/** 卡片槽位复用需要的只读数据源（下标 → 展示数据） */
interface CardEnv {
  colors: ThemeColors;
  solid: NinePatchSource;
  tintOf(i: number): string;
  skinOf(i: number): number;
  live: Set<CharCard>;
}

/**
 * 角色卡片（List 槽位控件）。九宫格皮肤材质色相乘有限，换角色主色 = 替换色块子节点
 * （槽位复用时 setData 只在窗口对账时触发，开销可控）。
 * 构造即带初始数据（Label 初始文案走构造参数；bind 前不可 setText——List.reconcile 对新建
 * 槽位不再回调 updateItem，见 S13 API 语义）。
 */
class CharCard extends Box {
  private name: Label;
  private pickedMark: Label;
  private rarity: Label;
  private meta: Label;
  private skillL: Label;
  private passiveL: Label;
  private chipHolder: Box;
  private chipTint = '';
  private boundIndex = -1;

  constructor(private envCard: CardEnv, i: number, load: Loadout, picked: boolean) {
    super({ direction: 'column', background: 'card', padding: 12, gap: 5, width: { percent: 100 } });
    const c = envCard.colors;
    this.chipHolder = new Box({ width: 34, height: 34, align: 'center', justify: 'center' });
    this.name = new Label({ text: load.name, fontSizePx: 15, color: picked ? c.gold : c.text });
    this.pickedMark = new Label({ text: '✔ 已选', fontSizePx: 12, color: c.neon });
    this.rarity = new Label({
      text: load.rarity, fontSizePx: 11,
      color: load.rarity === 'SSR' ? c.gold : load.rarity === 'SR' ? c.neon : c.muted,
    });
    this.meta = new Label({ text: `皮肤 ×${envCard.skinOf(i)} · ${load.charId}`, fontSizePx: 11, color: c.muted });
    this.skillL = new Label({ text: load.skill ? `技能：${load.skill.label} — ${load.skill.desc}` : '技能：无', fontSizePx: 12, opacity: 0.85 });
    this.passiveL = new Label({ text: load.passive.length ? `被动：${load.talentLabel} — ${load.talentDesc}` : '被动：无', fontSizePx: 12, opacity: 0.85 });
    const info = new Box({ direction: 'column', flex: 1, gap: 2 }, [
      new Box({ direction: 'row', gap: 8, align: 'center' }, [this.name, this.pickedMark]),
      new Box({ direction: 'row', justify: 'spaceBetween', align: 'center' }, [this.rarity, this.meta]),
    ]);
    this.add(new Box({ direction: 'row', gap: 10, align: 'center' }, [this.chipHolder, info]));
    this.add(this.skillL, this.passiveL);
    this.pickedMark.visible = picked;
    this.chipTint = envCard.tintOf(i);
    this.chipHolder.add(solidChip(envCard.solid, 34, this.chipTint));
    this.boundIndex = i;
    envCard.live.add(this);
  }

  setData(i: number, load: Loadout, picked: boolean): void {
    const c = this.envCard.colors;
    this.boundIndex = i;
    const tint = this.envCard.tintOf(i);
    if (tint !== this.chipTint) {
      for (const old of [...this.chipHolder.children]) this.chipHolder.remove(old);
      this.chipHolder.add(solidChip(this.envCard.solid, 34, tint));
      this.chipTint = tint;
    }
    this.name.setText(load.name);
    this.rarity.setText(load.rarity);
    this.rarity.setColor(load.rarity === 'SSR' ? c.gold : load.rarity === 'SR' ? c.neon : c.muted);
    this.meta.setText(`皮肤 ×${this.envCard.skinOf(i)} · ${load.charId}`);
    this.skillL.setText(load.skill ? `技能：${load.skill.label} — ${load.skill.desc}` : '技能：无');
    this.passiveL.setText(load.passive.length ? `被动：${load.talentLabel} — ${load.talentDesc}` : '被动：无');
    this.setPicked(picked);
  }

  setPicked(picked: boolean): void {
    const c = this.envCard.colors;
    this.name.setColor(picked ? c.gold : c.text);
    this.pickedMark.visible = picked;
  }

  /** 槽位当前绑定的数据下标（选中态跨槽位刷新用） */
  get slotIndex(): number { return this.boundIndex; }

  override dispose(): void {
    this.envCard.live.delete(this);
    super.dispose();
  }
}

interface MenuPageDeps {
  content: GameContent;
  sources: Record<string, FileSource>;
  actions: MenuActions;
  currentCharId: string;
}

export interface MenuPage { view: UiView }

export function buildMenuPage(host: UiHost, d: MenuPageDeps): MenuPage {
  const c = host.theme.colors;
  const chars = playableCharacters(d.content);
  let chosen = chars.some(x => x.id === d.currentCharId) ? d.currentCharId : (chars[0]?.id ?? '');
  const loads = chars.map(x => buildLoadout(d.content, x.id));

  const live = new Set<CharCard>();
  const cardEnv: CardEnv = {
    colors: c,
    solid: host.solidSkin,
    tintOf: i => loads[i]?.tint ?? '#ffffff',
    skinOf: i => ((chars[i]?.skins as string[]) ?? []).length,
    live,
  };

  const skillHint = new Label({ text: '', fontSizePx: 13, color: c.text });

  const list = new List({
    itemCount: chars.length,
    itemExtent: 220,
    gap: 12,
    axis: 'x',
    height: 190, // 定高（List 语义要求确定交叉轴；卡片内容 ≈160 含换行余量）
    buildItem: i => new CharCard(cardEnv, i, loads[i]!, chosen === chars[i]!.id),
    updateItem: (w, i) => { (w as CharCard).setData(i, loads[i]!, chosen === chars[i]!.id); },
    onSelect: i => select(i),
  });

  function select(i: number): void {
    const id = chars[i]?.id;
    if (!id) return;
    chosen = id;
    host.adapter.storage.set(CHAR_KEY, id); // 与 DOM 版一致：点选即写本机记忆
    for (const card of live) card.setPicked(card.slotIndex === i); // 可见槽位全量刷选中态
    skillHint.setText(skillLine(buildLoadout(d.content, chosen)));
  }

  const btnStart = new Button({ label: '开始 · 跑酷！', variant: 'primary', fontSizePx: 17, onClick: () => d.actions.onStartRun(chosen) });
  const btnClear = new Button({ label: '清除本机缓存', fontSizePx: 15, onClick: d.actions.onClearCache });

  const lastUser = host.adapter.storage.get(LAST_USER_KEY);
  const userLabel = new Label({
    text: lastUser ? `账号：${lastUser}（本地演示）` : '游客模式', fontSizePx: 12, color: c.muted,
  });
  const srcText = Object.entries(d.sources).map(([k, v]) => `${k}:${v === 'network' ? '网络' : v === 'cache' ? '缓存' : '失败'}`).join('  ');
  const srcLabel = new Label({
    text: `配置来源 ${srcText} · characters v${String(d.content.characters.configVersion)}`,
    fontSizePx: 11, color: c.muted,
  });

  const view = host.makeView();
  view.add(new Box(
    { direction: 'column', align: 'center', flex: 1, padding: 16 },
    [new Box(
      {
        direction: 'column', width: { percent: 100 }, maxWidth: 720, flex: 1, align: 'stretch', gap: 12,
        background: 'panel', backgroundOpacity: 0.72, padding: { top: 16, bottom: 16, left: 18, right: 18 },
      },
      [
        new Box({ direction: 'row', justify: 'spaceBetween', align: 'center' }, [
          new Label({ text: '主菜单', fontSizePx: 20, color: c.text }),
          userLabel,
        ]),
        new Label({
          text: '操作：← → 换道 · ↑/空格 跳 · ↓ 滑铲 · 双击或 E 放技能 · Esc 退出。点卡片换角色。',
          fontSizePx: 12, color: c.muted,
        }),
        new Label({ text: '角色（左右滑动选择）', fontSizePx: 13, color: c.gold }),
        list,
        skillHint,
        new Box({ direction: 'row', gap: 12, justify: 'center', padding: { top: 4 } }, [btnStart, btnClear]),
        srcLabel,
      ],
    )],
  ));

  if (chars.length > 0) {
    host.adapter.storage.set(CHAR_KEY, chosen); // 初始选定也落本机（与 DOM 版等价）
    skillHint.setText(skillLine(buildLoadout(d.content, chosen)));
  }
  return { view };
}
