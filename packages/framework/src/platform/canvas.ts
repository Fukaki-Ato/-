/**
 * 画布抽象（PlatformAdapter v2 §1，S10 契约；原 drafts/platform-adapter-v2.ts 定稿移入本包）
 * 接口面零 DOM/wx 类型：画布用结构化 GLCanvas，上下文用不透明 ContextHandle（D3）。
 */

/** 所有 on* 订阅方法的返回值：调用即退订（与 v1 一致，幂等）。 */
export type Unsubscribe = () => void;

/** requestFrame 返回的帧句柄（web/wx 两端均为 number）。 */
export type FrameHandle = number;

/**
 * 窗口/画布逻辑尺寸。width/height 为 CSS 逻辑像素（与 v1 CanvasHost 同语义：
 * 渲染尺寸 = 尺寸 × dpr）；dpr 上限策略属于实现（两端均 min(原生, 2)，S11 坑 K6）。
 */
export interface WindowSize {
  width: number;
  height: number;
  dpr: number;
}

/**
 * 不透明的原生渲染上下文句柄。运行时即平台原生 WebGL/WebGL2/2D 上下文对象；
 * 类型层刻意不展开——全仓唯一需要真实类型的地方是 render 层喂给 three 的
 * 单点断言处（docs/platform-adapter-v2.md §7 第 6 条）。
 */
export type ContextHandle = object;

/** WebGL 上下文创建参数（结构化最小子集，字段语义同 WebGLContextAttributes）。 */
export interface GLContextAttributes {
  alpha?: boolean;
  antialias?: boolean;
  depth?: boolean;
  stencil?: boolean;
  premultipliedAlpha?: boolean;
  preserveDrawingBuffer?: boolean;
  powerPreference?: 'default' | 'low-power' | 'high-performance';
  failIfMajorPerformanceCaveat?: boolean;
}

/**
 * 平台无关画布（v1 CanvasHost.canvas: HTMLCanvasElement 的替代）。
 * width/height 为绘图缓冲区物理像素（three setSize 会写它，与 web canvas.width 语义一致）。
 */
export interface GLCanvas {
  width: number;
  height: number;
  getContext(contextId: 'webgl2', attrs?: GLContextAttributes): ContextHandle | null;
  getContext(contextId: 'webgl', attrs?: GLContextAttributes): ContextHandle | null;
  /** 仅对离屏画布有意义；wx 屏幕画布不支持 2d 时实现返回 null。 */
  getContext(contextId: '2d', attrs?: unknown): ContextHandle | null;
  /**
   * three.js 部分代码路径会写 canvas.style（setSize updateStyle 分支等）。
   * web 实现即真实 CSSStyleDeclaration（结构化兼容）；wx 垫片给可写空对象，不得缺省（D13）。
   */
  readonly style?: Record<string, string | undefined>;
}

/**
 * 画布工厂（v1 createCanvasHost(container) 的替代，容器参数删除，D2）。
 * 关键契约：主画布是单例——wx 的屏幕画布全局唯一且不可重建，web 实现保持同构，
 * 跨场景（run 进出）复用同一 GLCanvas，v1「每局新建 canvas」的生命周期废止（D1）。
 */
export interface CanvasFactory {
  /** 屏幕主画布：首次调用创建并挂载（web 挂到实现内部持有的挂载点；wx 包装首个 wx.createCanvas()），重复调用返回同一实例。 */
  mainCanvas(): GLCanvas;
  /** 离屏画布：每次返回独立新实例（web: createElement 不挂载；wx: 后续 wx.createCanvas()），尺寸为物理像素。 */
  createOffscreenCanvas(width: number, height: number): GLCanvas;
  /** 当前窗口逻辑尺寸（v1 CanvasHost.width/height/dpr 的替代，画布创建前后均可调用）。 */
  windowSize(): WindowSize;
  /** v2 新增：窗口尺寸/横竖屏变化订阅（web: resize+orientationchange；wx: wx.onWindowResize，D9）。 */
  onResize(cb: (size: WindowSize) => void): Unsubscribe;
}
