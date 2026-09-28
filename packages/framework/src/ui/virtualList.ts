/**
 * List 虚拟滚动窗口计算：给定条目数/条目尺寸/间距/视口/滚动偏移，
 * 输出应渲染的窗口 [start, end) 与首项内容偏移（S4 只按窗口渲染可见项）。
 * 纯函数；等尺寸条目（itemExtent 固定 + gap），纵向横向通用（extent 语义为滚动轴长度）。
 */

export interface VirtualListSpec {
  itemCount: number
  /** 单条目在滚动轴上的尺寸 px */
  itemExtent: number
  /** 条目间距 px，默认 0 */
  gap?: number
  /** 视口在滚动轴上的长度 px */
  viewportExtent: number
  /** 屏幕外预渲染条目数（每侧），默认 1 */
  overscan?: number
}

export interface VirtualWindow {
  /** 首个渲染条目索引（含） */
  start: number
  /** 末后渲染条目索引（不含） */
  end: number
  count: number
  /** start 条目在内容坐标系中的偏移 px（S4 用它摆放首个可见项） */
  leading: number
  /** 内容总长 px */
  contentExtent: number
  /** 合法滚动偏移上限 px */
  maxOffset: number
}

function pitchOf(spec: VirtualListSpec): number {
  return Math.max(0, spec.itemExtent) + Math.max(0, spec.gap ?? 0)
}

/** 内容总长（末项后无 gap） */
export function contentExtentOf(spec: VirtualListSpec): number {
  const n = Math.max(0, spec.itemCount)
  if (n === 0 || spec.itemExtent <= 0) return 0
  return n * spec.itemExtent + (n - 1) * Math.max(0, spec.gap ?? 0)
}

/** 第 index 项在内容坐标系中的起点偏移 */
export function itemStart(spec: VirtualListSpec, index: number): number {
  return index * pitchOf(spec)
}

/** 滚动偏移夹到合法区间 [0, maxOffset] */
export function clampOffset(spec: VirtualListSpec, offset: number): number {
  const max = Math.max(0, contentExtentOf(spec) - Math.max(0, spec.viewportExtent))
  if (!Number.isFinite(offset)) return 0
  return offset < 0 ? 0 : offset > max ? max : offset
}

export function computeVirtualWindow(spec: VirtualListSpec, scrollOffset: number): VirtualWindow {
  const content = contentExtentOf(spec)
  const viewport = Math.max(0, spec.viewportExtent)
  const maxOffset = Math.max(0, content - viewport)
  const n = Math.max(0, spec.itemCount)
  const overscan = Math.max(0, spec.overscan ?? 1)
  if (n === 0 || spec.itemExtent <= 0 || viewport <= 0) {
    return { start: 0, end: 0, count: 0, leading: 0, contentExtent: content, maxOffset }
  }
  const off = clampOffset(spec, scrollOffset)
  const pitch = pitchOf(spec)
  // 项 i 占 [i*pitch, i*pitch+itemExtent]；与视口 [off, off+viewport] 相交的即需渲染
  const first = Math.floor(off / pitch)
  const last = Math.ceil((off + viewport) / pitch) - 1
  const start = Math.max(0, first - overscan)
  const end = Math.min(n, Math.max(first, last) + 1 + overscan)
  return { start, end, count: Math.max(0, end - start), leading: start * pitch, contentExtent: content, maxOffset }
}
