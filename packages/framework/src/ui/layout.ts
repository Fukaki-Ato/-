/**
 * flex 子集布局引擎：输入约束树（LayoutNode）+ 视口尺寸，输出绝对坐标矩形树（LayoutBox）。
 * 纯函数、无副作用、不修改输入。两遍算法：
 *   measureNode —— 自底向上求 auto 尺寸（此遍中「父为 auto 的百分比」按 auto 处理）；
 *   arrange     —— 自顶向下摆放（此时每层盒子尺寸已确定，子级百分比按父内容盒解析）。
 * 已支持：row/column、gap、padding、margin、align/justify、固定+百分比尺寸、min/max、
 *         flex 增长（仅正剩余空间）、滚动容器（主轴无限测量 + clip + ScrollMetrics）。
 * 不支持清单见 API.md。
 */
import {
  edges, resolveLength,
  type LayoutBox, type LayoutNode, type Rect, type Size,
} from './types.js'

const INF = Infinity

function isScroll(n: LayoutNode): boolean {
  return !!n.scroll
}

function scrollAxisOf(n: LayoutNode): 'x' | 'y' {
  if (n.scroll === 'x') return 'x'
  if (n.scroll === 'y') return 'y'
  return (n.direction ?? 'column') === 'row' ? 'x' : 'y'
}

function applyMinMax(v: number, min?: number, max?: number): number {
  let r = v
  if (min !== undefined) r = Math.max(r, min)
  if (max !== undefined) r = Math.min(r, max)
  return Math.max(0, r)
}

/**
 * 测量期望 border-box 尺寸。basisW/basisH 为百分比解析基准（父内容盒）；
 * Infinity 表示无基准：百分比按 auto 处理、auto 尺寸不做可用空间收缩。
 */
export function measureNode(node: LayoutNode, basisW: number, basisH: number): Size {
  const pad = edges(node.padding)
  const padW = pad.left + pad.right
  const padH = pad.top + pad.bottom
  const declW = resolveLength(node.width, basisW)
  const declH = resolveLength(node.height, basisH)
  const contentW = declW !== undefined ? Math.max(0, declW - padW) : INF
  const contentH = declH !== undefined ? Math.max(0, declH - padH) : INF

  const horizontal = (node.direction ?? 'column') === 'row'
  const gap = node.gap ?? 0
  const scrolling = isScroll(node)
  const kids = node.children ?? []
  // 滚动容器：子项在滚动轴上按无限空间测量（内容可超出视口）
  const childBasisW = scrolling && horizontal ? INF : contentW
  const childBasisH = scrolling && !horizontal ? INF : contentH

  let main = 0
  let cross = 0
  for (const c of kids) {
    const cm = edges(c.margin)
    const s = measureNode(c, childBasisW, childBasisH)
    const outerW = s.w + cm.left + cm.right
    const outerH = s.h + cm.top + cm.bottom
    if (horizontal) { main += outerW; cross = Math.max(cross, outerH) }
    else { main += outerH; cross = Math.max(cross, outerW) }
  }
  if (kids.length > 1) main += gap * (kids.length - 1)

  const leafW = node.content?.w ?? 0
  const leafH = node.content?.h ?? 0
  const desiredW = kids.length ? (horizontal ? main : cross) : leafW
  const desiredH = kids.length ? (horizontal ? cross : main) : leafH

  // auto 尺寸收缩到可用空间（basis 有限时），再过 min/max；声明尺寸只过 min/max
  const autoW = Number.isFinite(basisW) ? Math.min(desiredW + padW, basisW) : desiredW + padW
  const autoH = Number.isFinite(basisH) ? Math.min(desiredH + padH, basisH) : desiredH + padH
  return {
    w: applyMinMax(declW !== undefined ? declW : autoW, node.minWidth, node.maxWidth),
    h: applyMinMax(declH !== undefined ? declH : autoH, node.minHeight, node.maxHeight),
  }
}

interface ChildFrame {
  node: LayoutNode
  mt: number; mr: number; mb: number; ml: number
  w: number; h: number
  baseMain: number
  flex: number
}

/** 计算子项基础尺寸（百分比按父内容盒解析；交叉轴 stretch 填满） */
function childFrames(node: LayoutNode, content: Rect, horizontal: boolean, scrolling: boolean): ChildFrame[] {
  const align = node.align ?? 'stretch'
  const childBasisW = scrolling && horizontal ? INF : content.w
  const childBasisH = scrolling && !horizontal ? INF : content.h
  return (node.children ?? []).map((c) => {
    const cm = edges(c.margin)
    const ms = measureNode(c, childBasisW, childBasisH)
    let w = resolveLength(c.width, childBasisW)
    let h = resolveLength(c.height, childBasisH)
    w = w !== undefined ? applyMinMax(w, c.minWidth, c.maxWidth) : ms.w
    h = h !== undefined ? applyMinMax(h, c.minHeight, c.maxHeight) : ms.h
    if (!horizontal && align === 'stretch' && c.width === undefined) {
      w = applyMinMax(Math.max(0, content.w - cm.left - cm.right), c.minWidth, c.maxWidth)
    }
    if (horizontal && align === 'stretch' && c.height === undefined) {
      h = applyMinMax(Math.max(0, content.h - cm.top - cm.bottom), c.minHeight, c.maxHeight)
    }
    const baseMain = horizontal ? w + cm.left + cm.right : h + cm.top + cm.bottom
    return { node: c, mt: cm.top, mr: cm.right, mb: cm.bottom, ml: cm.left, w, h, baseMain, flex: c.flex ?? 0 }
  })
}

/** flex 增长：主轴尺寸确定且非滚动时，把正剩余空间按权重分给 flex>0 的子项（不支持收缩） */
function distributeFlex(frames: ChildFrame[], horizontal: boolean, mainAvail: number, totalMain: number, gap: number): number {
  const flexSum = frames.reduce((s, f) => s + f.flex, 0)
  const free = mainAvail - totalMain - (frames.length > 1 ? gap * (frames.length - 1) : 0)
  if (!(free > 0) || flexSum <= 0 || !Number.isFinite(mainAvail)) return totalMain
  let distributed = 0
  for (const f of frames) {
    if (f.flex <= 0) continue
    const grow = (free * f.flex) / flexSum
    if (horizontal) f.w += grow
    else f.h += grow
    f.baseMain += grow
    distributed += grow
  }
  return totalMain + distributed
}

/** justify：返回主轴起点额外偏移 lead 与子项间实际间距 between */
function justifySpacing(justify: JustifyOf, n: number, gap: number, extra: number): { lead: number; between: number } {
  const e = Number.isFinite(extra) ? Math.max(0, extra) : 0
  switch (justify) {
    case 'center': return { lead: e / 2, between: gap }
    case 'end': return { lead: e, between: gap }
    case 'spaceBetween': return { lead: 0, between: gap + (n > 1 ? e / (n - 1) : 0) }
    case 'spaceAround': return { lead: e / n / 2, between: gap + e / n }
    case 'spaceEvenly': return { lead: e / (n + 1), between: gap + e / (n + 1) }
    default: return { lead: 0, between: gap }
  }
}
type JustifyOf = NonNullable<LayoutNode['justify']>

/** 交叉轴定位（stretch 且声明了尺寸的按 start 处理） */
function crossPos(align: NonNullable<LayoutNode['align']>, contentStart: number, contentExtent: number, mStart: number, mEnd: number, size: number): number {
  switch (align) {
    case 'center': return contentStart + (contentExtent - size - mStart - mEnd) / 2 + mStart
    case 'end': return contentStart + contentExtent - size - mEnd
    default: return contentStart + mStart
  }
}

/** 摆放一个已确定 border-box 的节点，递归产出矩形树 */
function arrange(node: LayoutNode, rect: Rect): LayoutBox {
  const pad = edges(node.padding)
  const content: Rect = {
    x: rect.x + pad.left,
    y: rect.y + pad.top,
    w: Math.max(0, rect.w - pad.left - pad.right),
    h: Math.max(0, rect.h - pad.top - pad.bottom),
  }
  const box: LayoutBox = { id: node.id, rect, contentRect: content, passthrough: node.passthrough, children: [] }
  const kids = node.children ?? []
  const horizontal = (node.direction ?? 'column') === 'row'
  const scrolling = isScroll(node)
  const gap = node.gap ?? 0

  if (scrolling) {
    box.clip = { ...content }
  }
  if (!kids.length) {
    if (scrolling) {
      const axis = scrollAxisOf(node)
      box.scroll = { axis, offset: node.scrollOffset ?? 0, content: 0, viewport: axis === 'x' ? content.w : content.h, maxOffset: 0 }
    }
    return box
  }

  const frames = childFrames(node, content, horizontal, scrolling)
  let totalMain = frames.reduce((s, f) => s + f.baseMain, 0)
  const mainAvail = horizontal ? content.w : content.h
  if (!scrolling) {
    totalMain = distributeFlex(frames, horizontal, mainAvail, totalMain, gap)
  }
  const contentMain = totalMain + (frames.length > 1 ? gap * (frames.length - 1) : 0)
  const { lead, between } = justifySpacing(node.justify ?? 'start', frames.length, gap, mainAvail - contentMain)
  const align = node.align ?? 'stretch'
  const shift = scrolling ? (node.scrollOffset ?? 0) : 0

  let cursor = (horizontal ? content.x : content.y) + lead - shift
  for (const f of frames) {
    const mainLead = horizontal ? f.ml : f.mt
    const mainTrail = horizontal ? f.mr : f.mb
    const childRect: Rect = horizontal
      ? {
          x: cursor + mainLead,
          y: crossPos(align, content.y, content.h, f.mt, f.mb, f.h),
          w: f.w, h: f.h,
        }
      : {
          x: crossPos(align, content.x, content.w, f.ml, f.mr, f.w),
          y: cursor + mainLead,
          w: f.w, h: f.h,
        }
    box.children.push(arrange(f.node, childRect))
    cursor += mainLead + (horizontal ? f.w : f.h) + mainTrail + between
  }

  if (scrolling) {
    const axis = scrollAxisOf(node)
    const viewport = axis === 'x' ? content.w : content.h
    box.scroll = {
      axis,
      offset: node.scrollOffset ?? 0,
      content: contentMain,
      viewport,
      maxOffset: Math.max(0, contentMain - viewport),
    }
  }
  return box
}

/**
 * 布局入口。根节点未声明的轴默认铺满视口（overlay 屏幕根语义）。
 * 返回全新矩形树；不修改输入 spec。
 */
export function layout(root: LayoutNode, viewport: Size): LayoutBox {
  const ms = measureNode(root, viewport.w, viewport.h)
  const w = root.width === undefined ? viewport.w : ms.w
  const h = root.height === undefined ? viewport.h : ms.h
  return arrange(root, { x: 0, y: 0, w, h })
}

/** 按 id 在矩形树中查找节点（S4 滚动回填 offset 前定位 box 用） */
export function findBox(root: LayoutBox, id: string): LayoutBox | undefined {
  if (root.id === id) return root
  for (const c of root.children) {
    const hit = findBox(c, id)
    if (hit) return hit
  }
  return undefined
}
