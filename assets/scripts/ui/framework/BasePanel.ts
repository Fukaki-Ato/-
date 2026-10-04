import { BlockInputEvents, Layers, Node, UIOpacity, UITransform, isValid } from 'cc';
import type { IGameContext } from '../../core/contracts';
import { Theme } from './Theme';
import { stretch } from './UIKit';

/**
 * 面板基类：纯代码建树，节点挂在 PanelManager 对应层。
 * 生命周期：onCreate（仅一次）→ onOpen（每次打开）→ onClose → onCover（被上层覆盖时）。
 */
export abstract class BasePanel {
  protected readonly ctx: IGameContext;

  /** @internal 由 PanelManager 注入的关闭回调。 */
  onCloseRequest: (() => void) | null = null;

  private _name = '';
  private _node: Node | null = null;
  private _opened = false;
  private _closedWaiters: Array<() => void> = [];

  constructor(ctx: IGameContext) {
    this.ctx = ctx;
  }

  get name(): string {
    return this._name;
  }

  get node(): Node {
    if (!this._node) throw new Error(`面板 ${this._name} 尚未创建，请先通过 PanelManager.open 打开`);
    return this._node;
  }

  get isOpen(): boolean {
    return this._opened;
  }

  /** @internal 设置面板名（PanelManager 调用）。 */
  setName(name: string): void {
    this._name = name;
  }

  /** @internal 建树一次；重复调用返回已有节点。 */
  ensureCreated(parent: Node): Node {
    if (this._node && isValid(this._node)) return this._node;
    const node = new Node(`Panel_${this._name}`);
    node.layer = Layers.Enum.UI_2D;
    const ui = node.addComponent(UITransform);
    ui.setContentSize(Theme.size.designWidth, Theme.size.designHeight);
    node.addComponent(UIOpacity);
    node.addComponent(BlockInputEvents);
    parent.addChild(node);
    // 全屏拉伸：适配不同机型的可视高度（设计宽固定 750）。
    stretch(node);
    // 节点被外部销毁（场景切换/UIRoot.reset）时唤醒 waitClosed，避免弹窗队列悬挂。
    node.once(Node.EventType.NODE_DESTROYED, () => this.notifyClosed());
    this._node = node;
    this.onCreate();
    return node;
  }

  /** 构建 UI 树：仅执行一次。子类在此创建全部节点，禁止依赖场景现有节点。 */
  protected onCreate(): void {}

  /** 每次打开/刷新数据时调用。 */
  protected onOpen(_data?: unknown): void {}

  /** 关闭时调用；节点保留以便复用，临时监听应在此解除。 */
  protected onClose(): void {}

  /** 被新面板覆盖时调用（如暂停动效）。 */
  protected onCover(): void {}

  /** 请求关闭自身（由 PanelManager 执行动画与栈管理）。 */
  close(): void {
    this.onCloseRequest?.();
  }

  /** 关闭动画结束的 Promise；未打开时立即完成。 */
  waitClosed(): Promise<void> {
    if (!this._opened) return Promise.resolve();
    return new Promise<void>((resolve) => this._closedWaiters.push(resolve));
  }

  /** @internal 标记打开并回调 onOpen。 */
  notifyOpen(data?: unknown): void {
    this._opened = true;
    this.onOpen(data);
  }

  /** @internal 回调 onClose。 */
  notifyClose(): void {
    this.onClose();
  }

  /** @internal 回调 onCover。 */
  notifyCover(): void {
    this.onCover();
  }

  /** @internal */
  notifyClosed(): void {
    this._opened = false;
    const waiters = this._closedWaiters;
    this._closedWaiters = [];
    for (const waiter of waiters) waiter();
  }
}
