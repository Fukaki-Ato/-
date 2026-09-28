/**
 * OrthoOverlay：与主场景共享 WebGLRenderer 的自绘 UI 图层（重设计 §3.3「两 pass 渲染」）。
 * 独立 THREE.Scene + 正交相机（left=0, right=w, top=0, bottom=-h → 世界系 worldY=-uiY，
 * 与 S13 屏幕坐标系 x右/y下 对齐）；render() 关 autoClear 叠加在主场景之后。
 * 宿主每帧：主场景 render → overlay.tick(dt)（物理/布局/同步 + 独立 render pass）。
 * 输入：宿主把平台事件归一化为 UiInput（t 单位=秒）喂 handleInput；
 *   v1 Gesture 适配见 input/gestureAdapter.ts（S3 v2 合入后的切换点在此文件汇报）。
 * 坐标单位：CSS 逻辑像素（renderer.setPixelRatio 由宿主负责，dpr 只影响 SDF spreadK）。
 */
import * as THREE from 'three';
import type { LayoutBox } from './types.js';
import { InputRouter, type UiInput } from './router.js';
import type { UiView } from './view.js';

export interface OverlayHost {
  /** 与主场景共享的渲染器（overlay 不改其 clear/尺寸状态，仅渲染期临时翻转 autoClear 等） */
  renderer: THREE.WebGLRenderer;
  width: number;
  height: number;
  dpr: number;
}

export interface OverlayOptions {
  /**
   * 独立背景色（scene.background）：three 对 Color 背景强制 clear，standalone 渲染（demo/整屏 UI）用。
   * 与主场景共享 renderer 叠加渲染时（S5 HUD）不设——保持透明，主场景自己 clear。
   */
  background?: THREE.ColorRepresentation;
}

export interface Overlay {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  /** 挂载视图（替换旧视图：旧视图 unmount 但不 dispose，归调用方） */
  mount(view: UiView): void;
  /** 卸下当前视图（断开 router 注册与 stage） */
  unmount(): void;
  /** 归一化输入（down/move/up/cancel，t=秒，坐标=CSS px 相对画布左上角） */
  handleInput(evt: UiInput): void;
  /** 每帧推进：物理 → 按需重布局 → 独立 render pass */
  tick(dt: number): void;
  /** 只渲染不推进（宿主自行控制节奏时用） */
  render(): void;
  /** 视口变化（CSS px + dpr） */
  resize(width: number, height: number, dpr?: number): void;
  readonly current: UiView | null;
  /** 最近一次布局产出的矩形树（调试/?ui=demo 探针用；未布局为 null） */
  readonly tree: LayoutBox | null;
  dispose(): void;
}

export function createOverlay(host: OverlayHost, opts?: OverlayOptions): Overlay {
  const scene = new THREE.Scene();
  // 注意：scene.background 走 three 的 unlit clear 路径，会按 outputColorSpace 做 linear→sRGB 编码，
  // 因此这里必须传「色彩管理版」Color（sRGB hex → linear 存储 → clear 时编码回原值，所见即所得）；
  // 而 UI 材质走自定义直通 shader，颜色用 uiColor()（原始值）——两条路径各自成立，勿混用。
  if (opts?.background !== undefined) scene.background = new THREE.Color(opts.background);
  const camera = new THREE.OrthographicCamera(0, host.width, 0, -host.height, 1, 3000);
  camera.position.set(0, 0, 1000);
  let view: UiView | null = null;
  let router = new InputRouter();
  let tree: LayoutBox | null = null;

  function rebuild(): void {
    if (!view) return;
    tree = view.relayout(); // 布局 + 控件回放 + router.setTree（S13 每帧闭环）
  }

  return {
    scene,
    camera,

    get current() { return view; },
    get tree() { return tree; },

    mount(v: UiView): void {
      if (view === v) return;
      this.unmount();
      view = v;
      router = new InputRouter({ slop: v.config.press.slopPx });
      scene.add(v.stage);
      v.setRouter(router);
      v.setSize(host.width, host.height);
      v.setPixelRatio(host.dpr);
      v.invalidate();
      rebuild();
    },

    unmount(): void {
      if (!view) return;
      view.setRouter(null);
      scene.remove(view.stage);
      view = null;
      tree = null;
    },

    handleInput(evt: UiInput): void {
      if (!view) return;
      router.dispatch(evt);
      if (evt.type === 'cancel') view.inputCancelled();
    },

    tick(dt: number): void {
      if (view) {
        view.step(dt);
        if (view.consumeDirty()) rebuild();
      }
      this.render();
    },

    render(): void {
      const r = host.renderer;
      const prevAutoClear = r.autoClear;
      r.autoClear = false; // 叠加在主场景之后；滚动裁剪走材质 uniform（paint.ts）
      r.render(scene, camera);
      r.autoClear = prevAutoClear;
    },

    resize(width: number, height: number, dpr?: number): void {
      camera.left = 0;
      camera.right = Math.max(0, width);
      camera.top = 0;
      camera.bottom = -Math.max(0, height);
      camera.updateProjectionMatrix();
      host.width = width;
      host.height = height;
      if (dpr !== undefined) host.dpr = dpr;
      if (view) {
        view.setSize(width, height);
        if (dpr !== undefined) view.setPixelRatio(dpr);
      }
    },

    dispose(): void {
      this.unmount();
      tree = null;
    },
  };
}
