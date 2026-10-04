import { isValid, Node, tween, UIOpacity, v3 } from 'cc';
import type { IGameContext } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';
import { AudioService } from './AudioService';
import { BasePanel } from './BasePanel';
import { BasePopup } from './BasePopup';
import { Theme } from './Theme';
import { Toast } from './Toast';
import { overlay, stretch } from './UIKit';
import { UIRoot } from './UIRoot';

const log = new Logger();
const OPEN_SCALE = 0.92;

function playIn(panelNode: Node): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!isValid(panelNode)) {
      resolve();
      return;
    }
    panelNode.active = true;
    panelNode.setScale(OPEN_SCALE, OPEN_SCALE, 1);
    const opacity = panelNode.getComponent(UIOpacity) ?? panelNode.addComponent(UIOpacity);
    opacity.opacity = 0;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      panelNode.off(Node.EventType.NODE_DESTROYED, finish);
      resolve();
    };
    // 节点被销毁时 tween 不会回调，用销毁事件兜底避免 Promise 悬挂。
    panelNode.once(Node.EventType.NODE_DESTROYED, finish);
    tween(panelNode).to(Theme.duration.panel, { scale: v3(1, 1, 1) }, { easing: 'quadOut' }).start();
    tween(opacity).to(Theme.duration.panel, { opacity: 255 }, { easing: 'quadOut' }).call(finish).start();
  });
}

function playOut(panelNode: Node): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!isValid(panelNode)) {
      resolve();
      return;
    }
    const opacity = panelNode.getComponent(UIOpacity) ?? panelNode.addComponent(UIOpacity);
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      panelNode.off(Node.EventType.NODE_DESTROYED, finish);
      if (isValid(panelNode)) panelNode.active = false;
      resolve();
    };
    panelNode.once(Node.EventType.NODE_DESTROYED, finish);
    tween(panelNode).to(Theme.duration.panel, { scale: v3(OPEN_SCALE, OPEN_SCALE, 1) }, { easing: 'quadIn' }).start();
    tween(opacity).to(Theme.duration.panel, { opacity: 0 }, { easing: 'quadIn' }).call(finish).start();
  });
}

export type PanelFactory<T extends BasePanel = BasePanel> = (ctx: IGameContext) => T;

/**
 * 面板管理器（静态 API，便于跨模块调用 PanelManager.open('MainMenu')）。
 * - 面板：入栈，同一面板不重复创建，打开期间由面板根节点 BlockInputEvents 拦截下层。
 * - 弹窗：走 Promise 队列串行，前一个关闭后下一个才打开；遮罩拦截输入。
 */
export class PanelManager {
  private static ctx: IGameContext | null = null;
  private static root: UIRoot | null = null;
  private static readonly registry = new Map<string, PanelFactory>();
  private static readonly instances = new Map<string, BasePanel>();
  private static readonly openPanels: BasePanel[] = [];
  private static readonly openPopups: BasePopup[] = [];
  private static readonly pendingPopups = new Map<string, Promise<BasePopup | null>>();
  private static readonly canceledPopups = new Set<string>();
  private static popupChain: Promise<void> = Promise.resolve();
  private static generation = 0;

  static init(ctx: IGameContext, root?: UIRoot | null): void {
    PanelManager.ctx = ctx;
    if (root) PanelManager.root = root;
    // 统一桥接：'toast' 事件出口 + 音频开关存档绑定；重复调用无副作用。
    Toast.init(ctx);
    AudioService.init(ctx);
  }

  static get initialized(): boolean {
    return PanelManager.ctx !== null;
  }

  static register<T extends BasePanel>(name: string, factory: PanelFactory<T>): void {
    if (PanelManager.registry.has(name)) log.warn(`面板重复注册，已覆盖：${name}`);
    PanelManager.registry.set(name, factory as PanelFactory);
  }

  static has(name: string): boolean {
    return PanelManager.registry.has(name);
  }

  static getOpened(): string[] {
    return [...PanelManager.openPanels.map((p) => p.name), ...PanelManager.openPopups.map((p) => p.name)];
  }

  static getPanel<T extends BasePanel = BasePanel>(name: string): T | null {
    const panel = PanelManager.instances.get(name);
    return (panel as T | undefined) ?? null;
  }

  static async open<T extends BasePanel = BasePanel>(name: string, data?: unknown): Promise<T | null> {
    const factory = PanelManager.registry.get(name);
    if (!factory) {
      log.warn(`面板未注册：${name}`);
      return null;
    }
    const existing = PanelManager.instances.get(name);
    if (existing && existing.isOpen) {
      // 同一面板不重复打开，仅刷新数据。
      existing.notifyOpen(data);
      return existing as T;
    }
    const panel = existing ?? factory(PanelManager.requireCtx());
    panel.setName(name);
    panel.onCloseRequest = () => {
      void PanelManager.close(name);
    };
    PanelManager.instances.set(name, panel);
    const root = PanelManager.requireRoot();
    const isPopup = panel instanceof BasePopup;
    panel.ensureCreated(root.getLayer(isPopup ? 'popup' : 'panel'));
    if (!isPopup) {
      const top = PanelManager.openPanels[PanelManager.openPanels.length - 1];
      if (top && top !== panel) top.notifyCover();
      PanelManager.openPanels.push(panel);
      panel.notifyOpen(data);
      await playIn(panel.node);
      return panel as T;
    }
    const pending = PanelManager.pendingPopups.get(name);
    if (pending) return pending as unknown as Promise<T>;
    const promise = PanelManager.enqueuePopup(name, panel as BasePopup, data);
    PanelManager.pendingPopups.set(name, promise);
    void promise.then(() => PanelManager.pendingPopups.delete(name));
    return promise as unknown as Promise<T>;
  }

  static async close(name?: string): Promise<void> {
    if (name === undefined) {
      const popup = PanelManager.openPopups[PanelManager.openPopups.length - 1];
      if (popup) {
        await PanelManager.closePopup(popup);
        return;
      }
      const top = PanelManager.openPanels[PanelManager.openPanels.length - 1];
      if (top) await PanelManager.closePanel(top);
      return;
    }
    const popupIndex = PanelManager.openPopups.findIndex((p) => p.name === name);
    if (popupIndex >= 0) {
      // 已开始打开/已打开的弹窗按正常关闭处理，清除误标记的取消。
      PanelManager.canceledPopups.delete(name);
      await PanelManager.closePopup(PanelManager.openPopups[popupIndex]);
      return;
    }
    const panelIndex = PanelManager.openPanels.findIndex((p) => p.name === name);
    if (panelIndex >= 0) {
      await PanelManager.closePanel(PanelManager.openPanels[panelIndex]);
      return;
    }
    if (PanelManager.pendingPopups.has(name)) {
      // 排队中的弹窗：标记取消，轮到它时直接跳过。
      PanelManager.canceledPopups.add(name);
      return;
    }
    log.warn(`关闭失败，面板未打开：${name}`);
  }

  /** 关闭全部面板与弹窗（排队中的弹窗会被取消）。 */
  static async closeAll(): Promise<void> {
    PanelManager.generation += 1;
    while (PanelManager.openPopups.length > 0) {
      await PanelManager.closePopup(PanelManager.openPopups[PanelManager.openPopups.length - 1]);
    }
    while (PanelManager.openPanels.length > 0) {
      await PanelManager.closePanel(PanelManager.openPanels[PanelManager.openPanels.length - 1]);
    }
  }

  /** 清空运行期状态（注册表保留），用于编辑器重载/测试。 */
  static reset(): void {
    PanelManager.openPanels.length = 0;
    PanelManager.openPopups.length = 0;
    PanelManager.pendingPopups.clear();
    PanelManager.canceledPopups.clear();
    PanelManager.instances.clear();
    PanelManager.popupChain = Promise.resolve();
    PanelManager.ctx = null;
    PanelManager.root = null;
    PanelManager.generation += 1;
  }

  private static enqueuePopup(name: string, panel: BasePopup, data?: unknown): Promise<BasePopup | null> {
    const generation = PanelManager.generation;
    return new Promise<BasePopup | null>((resolve) => {
      PanelManager.popupChain = PanelManager.popupChain
        .then(async () => {
          if (generation !== PanelManager.generation || PanelManager.canceledPopups.has(name)) {
            PanelManager.canceledPopups.delete(name);
            resolve(null);
            return;
          }
          if (panel.isOpen) {
            panel.notifyOpen(data);
            resolve(panel);
            await panel.waitClosed();
            return;
          }
          PanelManager.ensureBackdrop(panel);
          PanelManager.openPopups.push(panel);
          try {
            panel.notifyOpen(data);
            await playIn(panel.node);
          } catch (err) {
            // onOpen/onCreate 抛错时回滚队列，避免卡死后续弹窗。
            log.error(`弹窗打开失败：${name}`, err);
            const index = PanelManager.openPopups.indexOf(panel);
            if (index >= 0) PanelManager.openPopups.splice(index, 1);
            panel.notifyClosed();
            if (isValid(panel.node)) panel.node.active = false;
            resolve(null);
            return;
          }
          resolve(panel);
          await panel.waitClosed();
        })
        .catch((err) => {
          log.error(`弹窗队列异常：${name}`, err);
          resolve(null);
        });
    });
  }

  private static async closePanel(panel: BasePanel): Promise<void> {
    const index = PanelManager.openPanels.indexOf(panel);
    if (index < 0) return;
    if (index !== PanelManager.openPanels.length - 1) {
      log.warn(`请先关闭上层面板：${PanelManager.openPanels[PanelManager.openPanels.length - 1].name}`);
      return;
    }
    PanelManager.openPanels.pop();
    panel.notifyClose();
    await playOut(panel.node);
    panel.notifyClosed();
  }

  private static async closePopup(panel: BasePopup): Promise<void> {
    const index = PanelManager.openPopups.indexOf(panel);
    if (index < 0) return;
    if (index !== PanelManager.openPopups.length - 1) {
      log.warn(`请先关闭上层弹窗：${PanelManager.openPopups[PanelManager.openPopups.length - 1].name}`);
      return;
    }
    PanelManager.openPopups.pop();
    panel.notifyClose();
    await playOut(panel.node);
    panel.notifyClosed();
  }

  private static ensureBackdrop(panel: BasePopup): void {
    if (!panel.modal) return;
    if (panel.node.getChildByName('__backdrop')) return;
    const backdrop = overlay({ parent: panel.node });
    backdrop.name = '__backdrop';
    backdrop.setSiblingIndex(0);
    stretch(backdrop);
    backdrop.on(Node.EventType.TOUCH_END, () => {
      if (panel.isOpen) panel.notifyBackdrop();
    });
  }

  private static requireCtx(): IGameContext {
    if (!PanelManager.ctx) throw new Error('PanelManager 尚未初始化，请先调用 PanelManager.init(ctx)');
    return PanelManager.ctx;
  }

  private static requireRoot(): UIRoot {
    // 场景切换后旧 UIRoot 节点可能已销毁，回退到当前有效实例。
    const cached = PanelManager.root;
    const root = cached && isValid(cached.root) ? cached : UIRoot.instance;
    if (!root || !isValid(root.root)) throw new Error('PanelManager 需要 UIRoot，请先调用 UIRoot.initialize()');
    PanelManager.root = root;
    return root;
  }
}
