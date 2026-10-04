import { Camera, Canvas, Color, director, isValid, Layers, Node, ResolutionPolicy, SafeArea, UITransform, view } from 'cc';
import { Logger } from '../../core/framework/Logger';
import { Theme } from './Theme';
import { stretch } from './UIKit';

const log = new Logger();

export type UILayer = 'scene' | 'panel' | 'popup' | 'toast' | 'loading' | 'debug';

const LAYER_ORDER: readonly UILayer[] = ['scene', 'panel', 'popup', 'toast', 'loading', 'debug'];

/**
 * UI 根：确保一个 750×1624 的 Canvas，并创建六个逻辑层（自上而下渲染顺序即数组顺序）。
 * 说明：采用静态单例 UIRoot.instance 便于面板代码取层；单例仅持有节点引用，
 * 面板逻辑不依赖它做业务决策，编辑器/测试可通过 initialize/reset 重建。
 */
export class UIRoot {
  private static _instance: UIRoot | null = null;

  static get instance(): UIRoot | null {
    return UIRoot._instance;
  }

  static initialize(host?: Node): UIRoot {
    // 场景切换/重置后旧实例的节点已销毁，需要重建。
    if (UIRoot._instance && isValid(UIRoot._instance.root)) return UIRoot._instance;
    UIRoot._instance = null;
    try {
      view.setDesignResolutionSize(Theme.size.designWidth, Theme.size.designHeight, ResolutionPolicy.FIXED_WIDTH);
    } catch (err) {
      log.warn('设置设计分辨率失败（编辑器环境可忽略）', err);
    }
    const scene = director.getScene();
    const canvas = findOrCreateCanvas(host, scene);
    const root = new Node('UIRoot');
    root.layer = Layers.Enum.UI_2D;
    const rootUi = root.addComponent(UITransform);
    rootUi.setContentSize(Theme.size.designWidth, Theme.size.designHeight);
    if (canvas) canvas.addChild(root);
    else if (scene) scene.addChild(root);
    if (canvas) stretch(root);

    const instance = new UIRoot(root, createdCanvas);
    for (const name of LAYER_ORDER) {
      const layerNode = new Node(name);
      layerNode.layer = Layers.Enum.UI_2D;
      const ui = layerNode.addComponent(UITransform);
      ui.setContentSize(Theme.size.designWidth, Theme.size.designHeight);
      root.addChild(layerNode);
      stretch(layerNode);
      instance.layers.set(name, layerNode);
    }
    UIRoot._instance = instance;
    return instance;
  }

  static getLayer(layer: UILayer): Node {
    return UIRoot.require().getLayer(layer);
  }

  static reset(): void {
    if (!UIRoot._instance) return;
    UIRoot._instance.dispose();
    UIRoot._instance = null;
  }

  private static require(): UIRoot {
    if (!UIRoot._instance) throw new Error('UIRoot 尚未初始化，请先调用 UIRoot.initialize()');
    return UIRoot._instance;
  }

  readonly root: Node;
  private readonly layers = new Map<UILayer, Node>();
  private readonly createdCanvas: Node | null;
  private safeAreaNode: Node | null = null;

  private constructor(root: Node, createdCanvas: Node | null) {
    this.root = root;
    this.createdCanvas = createdCanvas;
  }

  getLayer(layer: UILayer): Node {
    const result = this.layers.get(layer);
    if (!result || !isValid(result)) throw new Error(`UIRoot 层不存在：${layer}`);
    return result;
  }

  /**
   * 安全区节点（懒创建，位于 Panel 层最底、覆盖全屏并应用 SafeArea）。
   * 顶部货币栏/底部导航可作为其子节点用 Widget 对齐，从而避开刘海与手势条。
   */
  getSafeArea(): Node {
    if (this.safeAreaNode && isValid(this.safeAreaNode)) return this.safeAreaNode;
    const node = new Node('SafeArea');
    node.layer = Layers.Enum.UI_2D;
    const ui = node.addComponent(UITransform);
    ui.setContentSize(Theme.size.designWidth, Theme.size.designHeight);
    const panel = this.getLayer('panel');
    panel.addChild(node);
    node.setSiblingIndex(0);
    stretch(node);
    try {
      node.addComponent(SafeArea).updateArea();
    } catch (err) {
      log.warn('SafeArea 适配失败（非异形屏可忽略）', err);
    }
    this.safeAreaNode = node;
    return node;
  }

  private dispose(): void {
    if (this.root && isValid(this.root)) this.root.destroy();
    if (this.createdCanvas && isValid(this.createdCanvas)) this.createdCanvas.destroy();
    this.layers.clear();
    this.safeAreaNode = null;
  }
}

let createdCanvas: Node | null = null;

function findOrCreateCanvas(host: Node | undefined, scene: Node | null): Node | null {
  createdCanvas = null;
  let canvas: Node | null = null;
  let cursor: Node | null = host ?? null;
  while (cursor && !canvas) {
    if (cursor.getComponent(Canvas)) canvas = cursor;
    else cursor = cursor.parent;
  }
  if (!canvas && scene) {
    canvas = scene.getComponentInChildren(Canvas)?.node ?? null;
  }
  if (!canvas && scene) {
    canvas = createCanvas(scene);
    createdCanvas = canvas;
  }
  if (canvas && !canvas.getComponent(Canvas)?.cameraComponent) {
    ensureCanvasCamera(canvas);
  }
  return canvas;
}

/** 兜底：场景无 Canvas 时纯代码创建（需挂 Boot 的场景通常已自带 Canvas）。 */
function createCanvas(scene: Node): Node {
  const canvasNode = new Node('Canvas');
  canvasNode.layer = Layers.Enum.UI_2D;
  const ui = canvasNode.addComponent(UITransform);
  ui.setContentSize(Theme.size.designWidth, Theme.size.designHeight);
  scene.addChild(canvasNode);
  const canvas = canvasNode.addComponent(Canvas);
  canvas.cameraComponent = createCanvasCamera(canvasNode);
  return canvasNode;
}

function ensureCanvasCamera(canvasNode: Node): void {
  const canvas = canvasNode.getComponent(Canvas);
  if (!canvas) return;
  try {
    canvas.cameraComponent = createCanvasCamera(canvasNode);
  } catch (err) {
    log.warn('Canvas 相机创建失败，UI 可能不可见', err);
  }
}

function createCanvasCamera(canvasNode: Node): Camera {
  const camNode = new Node('Camera');
  camNode.layer = Layers.Enum.UI_2D;
  canvasNode.addChild(camNode);
  camNode.setPosition(0, 0, 1000);
  const camera = camNode.addComponent(Camera);
  camera.projection = Camera.ProjectionType.ORTHO;
  camera.orthoHeight = Theme.size.designHeight / 2;
  camera.near = 0;
  camera.far = 2000;
  camera.visibility = Layers.Enum.UI_2D;
  camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
  camera.clearColor = new Color(78, 195, 247, 255);
  return camera;
}
