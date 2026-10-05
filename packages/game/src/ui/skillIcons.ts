/**
 * 局内技能图标（中右方两枚竖排，所有角色同一套图）：
 *   上＝主动技能（金色闪电）：亮=可释放，点击释放；暗=冷却中或未达积攒门槛。
 *   下＝被动天赋（青色盾牌）：亮=该被动增益此刻正在生效；不可点击、不可释放。
 *
 * 为什么亮暗靠 backgroundOpacity 而不是换两套贴图：
 * 素材生成侧（tools/gen_skill_icons.py）只烘「亮态」一张，暗态由 UI 乘暗 + 降透明度得到，
 * 少一半贴图体积，也避免两帧配准问题（同 badges 的 normal/glow 两帧不同路）。
 *
 * 亮态口径（与 fx 派生位一一对应，不猜）：
 *   主动 ready ← runnerScene 推来的 skill.ready（即 sim.canCastSkill()）
 *   被动 active ← 该角色 passive 原语在 fx 里有派生位为真（见 sim.passiveActive()）
 *   被动 charges ← fx.jumpCharges（奶蛙弹跳充能这类叠层被动，亮时显示次数）
 *
 * 坐标全走本文件常量表（与 menuLayout 同思路：设计 px × scaleOf），
 * 页面里不出现魔法数字；safeTop/safeBottom 吃 config params.ui。
 */
import { Box, Button, Label, type NinePatchSource, type Widget } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import { DEFAULT_SAFE, uiSafeFrom, type MenuSafe } from './menuLayout.js';

/** 设计基准：与主界面 menuLayout 同一套 1024×1536 归一坐标 */
export const SKILL_DESIGN_W = 1024;
export const SKILL_DESIGN_H = 1536;

/** 距右边缘与竖直中心线的偏移（设计 px）：中右方 = 水平偏右、竖直居中偏上 */
const EDGE_X = 28;
const CENTER_Y = 700;
/** 两枚图标的边长与间距（设计 px） */
const ICON = 108;
const GAP = 26;

/** 壳侧注入的两枚技能图标贴图（缺任一枚时该位退化为纯色圆，不阻塞进局） */
export interface SkillIconSet {
  active?: NinePatchSource;
  passive?: NinePatchSource;
}

export interface SkillIconRect { x: number; y: number; w: number; h: number }
export interface SkillIconLayout { active: SkillIconRect; passive: SkillIconRect; s: number }

export function skillIconScale(vw: number, vh: number): number {
  return Math.min(vw / SKILL_DESIGN_W, vh / SKILL_DESIGN_H);
}

/**
 * 两枚图标的位置：贴右边缘、竖直并排成一列，整体中心落在 CENTER_Y。
 * 纯函数便于单测（不进屏/不重叠/贴边三项断言）。
 */
export function skillIconLayout(vw: number, vh: number, safe: MenuSafe = DEFAULT_SAFE): SkillIconLayout {
  const s = skillIconScale(vw, vh);
  const w = Math.round(ICON * s);
  const h = Math.round(ICON * s);
  const gap = Math.round(GAP * s);
  const x = Math.max(0, vw - Math.round(EDGE_X * s) - w);
  const total = h * 2 + gap;
  // 竖直居中于 CENTER_Y，并吃安全区：底部不得压到 safeBottom
  let top = Math.round(CENTER_Y * s + safe.top * s - total / 2);
  const floor = vh - Math.round(safe.bottom * s) - total;
  if (top > floor) top = Math.max(0, floor);
  return {
    s,
    active: { x, y: top, w, h },
    passive: { x, y: top + h + gap, w, h },
  };
}

/** 图标下方的状态文案（短词，避免遮挡画面；冷却保留一位小数） */
export function skillCaption(kind: 'active' | 'passive', s: {
  ready: boolean; cd: number; charge: { now: number; need: number } | null;
  active: boolean; charges: number;
}): string {
  if (kind === 'active') {
    if (s.charge) return s.ready ? '可释放' : `${s.charge.now}/${s.charge.need}`;
    if (s.cd > 0) return `${s.cd.toFixed(1)}s`;
    return s.ready ? '可释放' : '准备中';
  }
  // 被动：亮时若有叠层次数则显示次数（奶蛙弹跳充能），否则只写「生效中」
  if (!s.active) return '';
  return s.charges > 0 ? `×${s.charges}` : '生效中';
}

/** 亮/暗的视觉参数：暗态压暗乘色 + 降不透明度（亮态=白）
 *  乘色取中性浅灰而非蓝灰：图标本体是琥珀金/青蓝两套色，压成蓝灰会把金色糊成灰饼、
 *  看不出是闪电；浅灰只降亮度不抢色相，暗态仍能辨形但明显「没点亮」。 */
const LIT_COLOR = '#ffffff';
const DIM_COLOR = '#9aa3b0';
const DIM_OPACITY = 0.72;
const LIT_OPACITY = 1;

/**
 * 一枚技能图标：九宫格贴图 + 下方状态小字。
 * onTap 为空 ⇒ 退化为不可点的 Box（被动天赋：亮=可触发，但不可释放）。
 */
class SkillIcon extends Box {
  /** 图标面：主动=Button（可点），被动=Box（不可点） */
  private readonly face: Widget;
  private readonly caption: Label;
  private readonly isButton: boolean;

  constructor(host: UiHost, set: SkillIconSet, kind: 'active' | 'passive', size: number, onTap: (() => void) | null) {
    super({ direction: 'column', align: 'center', gap: 2 });
    const src = kind === 'active' ? set.active : set.passive;
    // 缺贴图时用主题圆底占位：结构/命中区不变，测试与调试锚点照旧
    const base = {
      width: size, height: size, align: 'center' as const, justify: 'center' as const,
    };
    const bg = src ?? host.solidSkin;
    const tint = src ? LIT_COLOR : (kind === 'active' ? '#c8922e' : '#2b7fb0');
    this.isButton = onTap !== null;
    // 注意：Button 的背景只认 opts.skin（见 framework button.ts 的 onBind），传 background 会被
    // 静默忽略 ⇒ 图标画成通用按钮皮，闪电/盾牌根本不上屏。它也不收 backgroundColor：
    // 亮暗乘色统一由 setLit → setBackground 落，构造期不需要着色。
    this.face = onTap
      ? new Button({ ...base, skin: bg, padding: 0, onClick: () => onTap() })
      : new Box({ ...base, background: bg, backgroundColor: tint });
    this.caption = new Label({ text: '', fontSizePx: 11, color: host.theme.colors.gold, align: 'center' });
    // 名牌锚点（不可见）：测试按文本定位两枚图标，不依赖贴图
    const tag = new Label({ text: kind === 'active' ? '主动技能' : '被动天赋' });
    tag.visible = false;
    this.add(this.face, this.caption, tag);
  }

  /**
   * 亮=可用，暗=不可用。
   * 主动：暗时真的 setDisabled(true)（冷却中点了没反应，不误导玩家）。
   * 被动：永不 setDisabled——「亮了代表可触发、不可释放」是语义而非故障，
   * 吞掉点击即可（onTap 本来就是 null），保持可命中以便测试与调试遍历。
   */
  setLit(lit: boolean, litColor: string): void {
    const v = { color: lit ? LIT_COLOR : DIM_COLOR, opacity: lit ? LIT_OPACITY : DIM_OPACITY };
    if (this.isButton) {
      const btn = this.face as Button;
      // 顺序要紧：setDisabled 会走 applyVisual 把乘色/透明度覆盖成 disabled 的 0.45 白，
      // 先它后 setBackground，暗态参数才留得住（否则冷却中的图标只是半透明，压在亮沙上直接糊掉）。
      btn.setDisabled(!lit);
      btn.setBackground(v);
    } else {
      (this.face as Box).setBackground(v);
    }
    this.caption.setColor(lit ? litColor : '#8a93a6');
  }

  setCaption(text: string): void { this.caption.setText(text); }

  get captionLabel(): Label { return this.caption; }
  /** 主动图标是否可点（暗态被 setDisabled 吞掉点击） */
  get tappable(): boolean { return this.isButton; }
  /**
   * 测试锚点：图标面**实际**的乘色与不透明度（读渲染对象，不读 opts）。
   * 存在的理由：Button.setDisabled 会经 applyVisual 覆盖这两个值，
   * 只测「暗态点不动」测不出「暗态根本没画出来」——两者是不同的 bug。
   */
  get bgVisual(): { color: string; opacity: number } {
    const u = (this.face as unknown as {
      bg?: { material?: { uniforms?: Record<string, { value: unknown }> } };
    }).bg?.material?.uniforms;
    const col = u?.uColor?.value as { getHexString?: () => string } | undefined;
    return { color: col?.getHexString?.() ?? '', opacity: typeof u?.uOpacity?.value === 'number' ? u.uOpacity.value : -1 };
  }
}

/** HUD 右侧技能图标区：竖排两枚 + 更新句柄（root 交给调用方挂进自己的 view） */
export interface SkillIconsHandle {
  root: Box;
  update(s: {
    ready: boolean; cd: number; charge: { now: number; need: number } | null;
    active: boolean; charges: number;
  }): void;
  /** 测试锚点：两枚图标控件 */
  readonly activeIcon: SkillIcon;
  readonly passiveIcon: SkillIcon;
}

export function buildSkillIcons(
  host: UiHost,
  set: SkillIconSet,
  onCast: (() => void) | null,
  safe: MenuSafe = DEFAULT_SAFE,
): SkillIconsHandle {
  const { width: vw, height: vh } = host.adapter.canvas.windowSize();
  const L = skillIconLayout(vw, vh, safe);
  const size = L.active.w;
  const active = new SkillIcon(host, set, 'active', size, onCast);
  const passive = new SkillIcon(host, set, 'passive', size, null); // 被动永不释放
  const at = (r: SkillIconRect, child: Box): Box =>
    new Box({ absolute: true, left: r.x, top: r.y, width: r.w, height: r.h }, [child]);

  // 整棵容器 passthrough：只有两枚图标自身可命中，其余区域不拦局内滑动/点击
  const root = new Box({ direction: 'column', align: 'center', flex: 1, passthrough: true }, [
    at(L.active, active),
    at(L.passive, passive),
  ]);

  return {
    root,
    activeIcon: active,
    passiveIcon: passive,
    update(s) {
      const gold = host.theme.colors.gold;
      const neon = host.theme.colors.neon;
      // 主动：亮=可释放（暗态真禁用，冷却中点了不响应）；积攒期显示进度数字
      active.setLit(s.ready, gold);
      active.setCaption(skillCaption('active', s));
      // 被动：亮=此刻生效；叠层被动额外显示次数
      passive.setLit(s.active, neon);
      passive.setCaption(skillCaption('passive', s));
    },
  };
}

/** 安全区从 game.json params.ui 解析（缺省回DEFAULT_SAFE，与主界面同一来源） */
export function skillSafeFrom(raw: unknown): MenuSafe {
  return uiSafeFrom(raw);
}