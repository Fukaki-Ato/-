/**
 * 控件基类与运行环境（WidgetEnv 由 UiView 在 bind 时注入）。
 * 生命周期：构造（无环境，纯选项）→ bind(env)（拿 id/字体/主题/stage，可建 three 对象）
 * → node()（每次布局产出 LayoutNode 子树）→ sync(box, ctx)（按布局盒摆放视觉对象）→ dispose()。
 * 输入：handlers() 非空的控件由 view 注册进 InputRouter（按 id 命中，S13 契约 §3）。
 */
import type * as THREE from 'three';
import type { LayoutBox, LayoutNode } from './types.js';
import type { NodeHandlers, UiEvent } from './router.js';
import type { FontSet } from './text/metrics.js';
import type { Theme } from './theme.js';
import type { UiConfig } from './uiConfig.js';
import type { PaintCtx } from './paint.js';

/**
 * 控件事件相位约定：InputRouter 对路径上的注册节点会各发一次 capture 与 bubble（DOM 语义），
 * 控件 handler 一律「capture/target 响应、bubble 跳过」，保证每个事件恰好处理一次。
 */
export function skipBubble(e: UiEvent): boolean {
  return e.phase === 'bubble';
}

export interface WidgetEnv {
  fonts: FontSet;
  theme: Theme;
  config: UiConfig;
  /** 设备像素比（SDF spreadK 换算） */
  pixelRatio: number;
  /** 视觉对象挂载根（overlay scene 内） */
  stage: THREE.Object3D;
  /** 请求重新布局（下一 tick 生效） */
  invalidate(): void;
  nextId(prefix: string): string;
  /** 动态子树（列表槽位/运行期 add）注册输入处理器；未挂载 router 时为空操作 */
  attachHandlers(w: Widget): void;
  detachHandlers(w: Widget): void;
}

export abstract class Widget {
  /** bind 时由 env.nextId 分配（全树唯一，InputRouter 注册键） */
  id = '';
  private _visible = true;
  /**
   * 可见性。false 时退出布局（Box.node 过滤）——但 sync 随之不再运行，
   * 视觉对象的隐藏必须由 applyVisible 级联即时完成（S5 缺陷修复：此前置 false 会留下残影网格）。
   */
  get visible(): boolean { return this._visible; }
  set visible(v: boolean) {
    if (this._visible === v) return;
    this._visible = v;
    this.applyVisible(v);
  }

  /** 容器覆写：把自己的生效可见性级联给背景与子控件（v 已含父链状态） */
  /** 内部级联机制（public 仅为跨实例调用；业务请用 visible） */
  applyVisible(v: boolean): void { this.onVisible(v); }

  /** 自身视觉对象响应生效可见性变化（bind 前调用需自行判空） */
  protected onVisible(_v: boolean): void {}
  protected env: WidgetEnv | null = null;

  bind(env: WidgetEnv): void {
    if (this.env) return;
    this.env = env;
    this.id = env.nextId(this.kind);
    this.onBind();
  }

  get bound(): boolean { return this.env !== null; }

  /** 子类环境就绪钩子（建 three 对象、解析主题皮肤等） */
  protected onBind(): void {}

  /** id 前缀（调试可读；同 view 内由 nextId 计数器保证唯一） */
  protected get kind(): string { return 'w'; }

  protected requireEnv(): WidgetEnv {
    if (!this.env) throw new Error('控件尚未加入 UiView（bind 前不可布局）');
    return this.env;
  }

  /** 产出布局子树（S13 LayoutNode）；容器负责递归 children */
  abstract node(): LayoutNode;

  /** 布局完成后摆放视觉对象；容器负责递归子控件（box.children 与 node() 顺序一致） */
  abstract sync(box: LayoutBox, ctx: PaintCtx): void;

  /** 输入处理器（注册进 InputRouter）；无则不注册 */
  handlers(): NodeHandlers | undefined { return undefined; }

  /** 每帧推进（滚动物理/动效） */
  step(_dt: number): void {}

  /** 宿主级 touchcancel（滚动手势中止收尾；router 的 slop cancel 不走这里） */
  onInputCancel(): void {}

  /** 设备像素比变化（SDF spreadK 等需要刷新的视觉参数） */
  pixelRatioChanged(): void {}

  /** 深度优先遍历（含自身） */
  visit(fn: (w: Widget) => void): void { fn(this); }

  abstract dispose(): void;
}
