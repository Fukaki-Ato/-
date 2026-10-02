/**
 * 大厅徽标系统（替代 S5 的 lucide 矢量图标，按用户参考图重做）：
 * 14 枚游戏徽标（参考图抠图 12 + AI 生成 2：排行榜/城堡），每枚两帧贴图——
 * normal 常态、glow 点击高亮（外圈淡黄描边），点击时换 glow 帧 160ms 后换回。
 * 贴图由 apps 壳从 assets/ui/badges/{normal,glow}/ 加载注入（本包禁令：零 DOM/fetch）。
 */
import { Box, Button, Label, type NinePatchSource } from '@tr/framework/ui/index.js';

export const BADGE_NAMES = [
  'avatar', 'coin', 'gem', 'settings', 'event', 'achieve', 'task', 'rank',
  'start', 'castle', 'shop', 'handbook', 'chest', 'character',
] as const;

export type BadgeName = (typeof BADGE_NAMES)[number];

export interface BadgeSet {
  normal: Partial<Record<BadgeName, NinePatchSource>>;
  glow: Partial<Record<BadgeName, NinePatchSource>>;
}

const GLOW_MS = 160;

/** 不可见名牌：visible=false 不进布局与渲染，但随控件树遍历可见（测试与调试锚点） */
function tagLabel(tag: string): Label {
  const l = new Label({ text: tag });
  l.visible = false;
  return l;
}

/** 静态徽标图（不可点，如货币 chip 里的金币/钻石）；缺贴图时退化为空槽 */
export function badgeImage(set: BadgeSet | undefined, name: BadgeName, w: number, h: number): Box {
  const src = set?.normal[name];
  return new Box({ width: w, height: h, ...(src ? { background: src } : {}) }, [tagLabel(name)]);
}

class BadgeHolder extends Box {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private set: BadgeSet, private name: BadgeName, private bw: number, private bh: number, tag: string, private onTap: () => void) {
    super({ width: bw, height: bh, align: 'center', justify: 'center' });
    this.add(this.makeEl(this.set.normal[this.name]));
    this.add(tagLabel(tag));
  }

  private makeEl(src: NinePatchSource | undefined): Box | Button {
    if (!src) return new Box({ width: this.bw, height: this.bh }); // 缺贴图：空槽不渲染灰按钮
    return new Button({
      skin: src, label: '', width: this.bw, height: this.bh, padding: 0,
      onClick: () => { this.flash(); this.onTap(); },
    });
  }

  private flash(): void {
    if (!this.set.glow[this.name]) return;
    this.swap(this.set.glow[this.name]);
    this.timer = setTimeout(() => { this.timer = null; this.swap(this.set.normal[this.name]); }, GLOW_MS);
  }

  private swap(src: NinePatchSource | undefined): void {
    for (const old of [...this.children]) {
      if (old instanceof Button) this.remove(old);
    }
    this.add(this.makeEl(src));
  }

  override dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    super.dispose();
  }
}

/**
 * 可点徽标按钮：w×h 定尺寸（glow 帧比 normal 大 10px，换帧时轻微缩进无感）。
 * tag 为中文名牌（默认取 name），测试/无障碍锚点。
 */
export function badgeButton(set: BadgeSet, name: BadgeName, w: number, h: number, onTap: () => void, tag: string = name): Box {
  return new BadgeHolder(set, name, w, h, tag, onTap);
}
