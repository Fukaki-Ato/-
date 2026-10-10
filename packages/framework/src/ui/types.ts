/**
 * 公共类型与几何工具（S13 spike，纯逻辑，零依赖）。
 * 坐标系：x 向右、y 向下，单位 px，与 three 正交 overlay 的屏幕坐标约定一致（y 翻转由 S4 渲染层处理）。
 */

export interface Size { w: number; h: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Edges { top: number; right: number; bottom: number; left: number }
export type EdgesInput = number | Partial<Edges>

/** 长度：固定 px，或百分比（相对父节点内容盒；父在该轴为 auto 时按 auto 处理） */
export type Length = number | { percent: number }

export type Direction = 'row' | 'column'
export type Align = 'start' | 'center' | 'end' | 'stretch'
export type Justify = 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly'

/** 布局输入（约束树节点）。纯数据，可序列化，不含回调。 */
export interface LayoutNode {
  /** 稳定 id：命中分发按 id 找 handler；虚拟列表/调试也靠它 */
  id?: string
  /** 主轴方向，默认 column */
  direction?: Direction
  /** 交叉轴对齐，默认 stretch */
  align?: Align
  /** 主轴对齐，默认 start */
  justify?: Justify
  /** 子项主轴间距 px，默认 0 */
  gap?: number
  padding?: EdgesInput
  margin?: EdgesInput
  width?: Length
  height?: Length
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  /** 主轴增长权重（父容器主轴尺寸确定且有剩余空间时生效；不支持收缩） */
  flex?: number
  /** true=沿主轴可滚动并裁剪；'x'/'y'=指定滚动轴。默认 false */
  scroll?: boolean | 'x' | 'y'
  /** 滚动偏移 px（由 ScrollPhysics 产出后回填，布局引擎只消费） */
  scrollOffset?: number
  /** 叶子固有尺寸（如 SDF 文本测量结果），由宿主填入 */
  content?: Size
  /** true=自身不参与命中（如全屏 HUD 底板），子节点仍可命中 */
  passthrough?: boolean
  /**
   * true=脱离常规流：不占父容器主轴空间、不参与父尺寸测量，按 top/left（或 right/bottom）
   * 相对父内容盒定位。半屏弹层、全屏点击捕获层必需——用负 margin 伪造叠层会被 flex 增长
   * 吸收掉（子项落点只取决于其 outer 尺寸，与 margin.top 无关），调不动位置。
   * 绝对子项统一排在常规子项之后产出 ⇒ 绘制在其上、命中优先。
   */
  absolute?: boolean
  /** 绝对定位偏移 px（仅 absolute=true 时消费；缺省贴父内容盒对应边） */
  top?: number
  left?: number
  right?: number
  bottom?: number
  children?: LayoutNode[]
}

/** 滚动容器的度量信息（布局产出，供物理/滚动条消费） */
export interface ScrollMetrics {
  axis: 'x' | 'y'
  offset: number
  /** 内容总长（主轴） */
  content: number
  /** 视口长（主轴，= contentRect 对应边） */
  viewport: number
  maxOffset: number
}

/** 布局输出（矩形树）。全部绝对坐标（相对布局根左上角）。 */
export interface LayoutBox {
  id?: string
  /** 边框盒 */
  rect: Rect
  /** 内容盒（rect 去掉 padding） */
  contentRect: Rect
  /** 滚动容器：可见裁剪区（= contentRect），命中测试据此裁掉滚出视口的子项 */
  clip?: Rect
  scroll?: ScrollMetrics
  passthrough?: boolean
  children: LayoutBox[]
}

export function edges(input?: EdgesInput): Edges {
  if (input === undefined) return { top: 0, right: 0, bottom: 0, left: 0 }
  if (typeof input === 'number') return { top: input, right: input, bottom: input, left: input }
  return { top: input.top ?? 0, right: input.right ?? 0, bottom: input.bottom ?? 0, left: input.left ?? 0 }
}

/** 解析长度：px 原样；百分比相对 basis；basis 非有限（父 auto）时返回 undefined（按 auto 处理） */
export function resolveLength(len: Length | undefined, basis: number): number | undefined {
  if (len === undefined) return undefined
  if (typeof len === 'number') return Math.max(0, len)
  if (!Number.isFinite(basis)) return undefined
  return Math.max(0, (basis * len.percent) / 100)
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function containsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}

export function intersectRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) }
}
