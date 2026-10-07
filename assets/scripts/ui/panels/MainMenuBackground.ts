import { Camera, Canvas, Color, Component, Graphics, isValid, Node, Texture2D, sys } from 'cc';
import { Logger } from '../../core/framework/Logger';
import { applySprite, loadSprite } from '../framework/Assets';
import { Theme } from '../framework/Theme';
import { node, stretch } from '../framework/UIKit';
import { createParallaxLayers } from './ParallaxLayers';
import type { ParallaxHandle } from './ParallaxLayers';

const log = new Logger();

export type BackgroundMode = 'static' | 'parallax' | 'video';

export interface MainMenuBackgroundHandle {
  dispose(): void;
}

const DESIGN_W = Theme.size.designWidth;
const DESIGN_H = Theme.size.designHeight;

/** 背景缺失时的占位色（天空/海面/沙滩三段，沿用 S05 的颜色与矩形参数）。 */
const BG_SKY = new Color(78, 195, 247, 255);
const BG_SEA = new Color(96, 200, 240, 255);
const BG_SAND = new Color(245, 208, 122, 255);

/**
 * web 上读取 location.search 的 bg 参数（static|parallax|video；BG4 外壳与 BG5 测量脚本同口径）。
 * 其它平台、缺省与解析异常一律 'static'。
 */
export function resolveBackgroundMode(): BackgroundMode {
  try {
    if (!sys.isBrowser) return 'static';
    const search = typeof location === 'undefined' ? '' : location.search;
    const value = new URLSearchParams(search).get('bg');
    if (value === 'parallax' || value === 'video') return value;
    return 'static';
  } catch {
    return 'static';
  }
}

/** 沿父链找到 UI Canvas 及其相机（video 模式需要把该相机清屏色 alpha 置 0）。 */
function findCanvasCamera(start: Node): Camera | null {
  let cursor: Node | null = start;
  while (cursor) {
    const canvas = cursor.getComponent(Canvas);
    if (canvas) return canvas.cameraComponent ?? cursor.getComponentInChildren(Camera) ?? null;
    cursor = cursor.parent;
  }
  return null;
}

/** 挂在 Background 根节点的私有驱动器：转发 update 给视差句柄，销毁时停止并释放。 */
class BackgroundTicker extends Component {
  private target: ParallaxHandle | null = null;

  setTarget(target: ParallaxHandle | null): void {
    this.target = target;
  }

  /** 停止驱动并释放视差（幂等：dispose 与 onDestroy 双路径只释放一次）。 */
  stop(): void {
    const target = this.target;
    this.target = null;
    target?.dispose();
  }

  protected override update(dt: number): void {
    this.target?.update(dt);
  }

  protected override onDestroy(): void {
    this.stop();
  }
}

/**
 * 创建主界面背景结构（BG1 框架层）：
 * - static / parallax：`fallback`（三段色块）与 `image`（底图 SpriteFrame）拆成两棵独立子树，
 *   修复同一节点挂 Graphics + Sprite 的引擎告警与色块盖图问题（image 在 fallback 之上）。
 * - parallax：底图加载成功后委托 `createParallaxLayers` 播放滚动条带，由 `BackgroundTicker` 驱动。
 * - video：不创建渲染内容，并把 Canvas 相机清屏色 alpha 置 0，供 web 外壳的 DOM 视频透出。
 */
export function createMainMenuBackground(parent: Node, mode: BackgroundMode): MainMenuBackgroundHandle {
  const root = node('Background', { parent, size: { width: DESIGN_W, height: DESIGN_H } });
  stretch(root);

  let disposed = false;
  let ticker: BackgroundTicker | null = null;
  let camera: Camera | null = null;
  let originalClearColor: Color | null = null;

  if (mode === 'video') {
    camera = findCanvasCamera(parent);
    if (camera) {
      const current = camera.clearColor;
      originalClearColor = new Color(current.r, current.g, current.b, current.a);
      camera.clearColor = new Color(current.r, current.g, current.b, 0);
    } else {
      log.warn('video 背景未找到 Canvas 相机，画布可能不透明');
    }
  } else {
    const fallback = node('fallback', { parent: root, size: { width: DESIGN_W, height: DESIGN_H } });
    stretch(fallback);
    const g = fallback.addComponent(Graphics);
    g.fillColor = BG_SKY;
    g.rect(-DESIGN_W / 2, 100, DESIGN_W, 4000);
    g.fill();
    g.fillColor = BG_SEA;
    g.rect(-DESIGN_W / 2, -430, DESIGN_W, 530);
    g.fill();
    g.fillColor = BG_SAND;
    g.rect(-DESIGN_W / 2, -4000, DESIGN_W, 3570);
    g.fill();

    const image = node('image', { parent: root, size: { width: DESIGN_W, height: DESIGN_H } });
    stretch(image);
    // 透明占位色：图片缺失时不遮挡 fallback 色块，加载成功则完全覆盖。
    applySprite(image, Theme.assets.bgMain, { radius: 0, color: new Color(0, 0, 0, 0) });

    if (mode === 'parallax') {
      loadSprite(Theme.assets.bgMain, (frame) => {
        if (disposed || !frame || !isValid(root)) return;
        const texture = frame.texture;
        if (!(texture instanceof Texture2D)) return;
        const parallax = createParallaxLayers(root, {
          texture,
          textureSize: { width: texture.width, height: texture.height },
          designSize: { width: DESIGN_W, height: DESIGN_H },
        });
        const created = root.addComponent(BackgroundTicker);
        if (!created) {
          parallax.dispose();
          return;
        }
        created.setTarget(parallax);
        ticker = created;
      });
    }
  }

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (ticker && isValid(ticker)) ticker.stop();
      ticker = null;
      if (camera && originalClearColor) camera.clearColor = originalClearColor;
      camera = null;
      originalClearColor = null;
      if (isValid(root)) root.destroy();
    },
  };
}
