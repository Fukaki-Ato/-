/**
 * 弹层滑动容器与全屏点击捕获（ui 层，零宿主 API）。
 *
 * 为什么要自己写：框架没有任何动画能力（无 tween / easing / 透明度接口，Widget 只有
 * step(dt) 钩子），而且控件的视觉位置就是布局算出的绝对坐标 —— 每个控件把自己的网格
 * 直接挂到 stage 上（Box.onBind / Label.sync），没有可以整体平移的父节点，所以滑入只能
 * 「每帧改 top + 请求重排」。
 *
 * 为什么必须依赖 types.ts 新增的 absolute：用负 margin 伪造叠层会被 flex 增长吸收掉
 * （推导过一次：子项落点只取决于它的 outer 尺寸，与 margin.top 无关，改 margin 不动位置），
 * 而且会把兄弟节点的落点一起带偏。
 */
import { Box, type BoxOptions, type Widget } from '@tr/framework/ui/index.js';

export interface SlideBoxOptions extends BoxOptions {
  /** 收起态 top（一般是 -height，整块藏在屏幕上沿之外） */
  closedTop: number;
  /** 展开态 top，缺省 0（贴父内容盒上沿） */
  openTop?: number;
  /** 单程时长（毫秒）；0 = 不做动画直接跳位 */
  durationMs: number;
}

/** easeOutCubic：起步快、收尾稳。关闭时 progress 反向走同一条曲线，自然得到 easeIn 手感。 */
function easeOut(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - k, 3);
}

export class SlideBox extends Box {
  private readonly closedTop: number;
  private readonly openTop: number;
  private readonly durationMs: number;
  /** 0=收起 … 1=展开 */
  private progress = 0;
  private goal = 0;

  constructor(opts: SlideBoxOptions, children: Widget[] = []) {
    const { closedTop, openTop = 0, durationMs, ...rest } = opts;
    super({ ...rest, absolute: true, top: closedTop }, children);
    this.closedTop = closedTop;
    this.openTop = openTop;
    this.durationMs = Math.max(0, durationMs);
  }

  /** 动画进行中：测试靠它判断是否已经停稳（参照 ScrollView.physics.animating 的用法） */
  get animating(): boolean { return this.progress !== this.goal; }

  get isOpen(): boolean { return this.goal === 1; }

  open(): void { this.moveTo(1); }

  close(): void { this.moveTo(0); }

  private moveTo(g: number): void {
    if (this.goal === g) return;
    this.goal = g;
    this.env?.invalidate(); // 未 bind 时只改目标，布局会在 bind 后跑到
  }

  override step(dt: number): void {
    super.step(dt);
    if (this.progress === this.goal) return; // 静止时绝不每帧重排整棵树
    const stepSize = this.durationMs > 0 ? (Math.max(0, dt) * 1000) / this.durationMs : 1;
    this.progress = this.progress < this.goal
      ? Math.min(this.goal, this.progress + stepSize)
      : Math.max(this.goal, this.progress - stepSize);
    this.opts.top = this.closedTop + (this.openTop - this.closedTop) * easeOut(this.progress);
    this.requireEnv().invalidate();
  }
}

/**
 * 全屏点击捕获层：点面板以外的地方关闭弹层。
 * 必须比 SlideBox **先**加入同一个父容器 —— 布局把绝对子项按声明序产出，命中反向扫描，
 * 后声明的盖在上面并优先吃点击；反过来放会让面板内部的点击先被这层捕获，一点就误关。
 */
export function tapCatcher(onTap: () => void): Box {
  const box = new Box({
    absolute: true, top: 0, left: 0, width: { percent: 100 }, height: { percent: 100 },
    onClick: onTap,
  });
  // 出厂即不可见＝不吃点击：捕获层只在弹层打开期间武装，否则整屏点击都被它吞掉（大厅全废）。
  box.visible = false;
  return box;
}
