/**
 * 矩形树命中测试。规则：
 * - 返回 root→最深命中节点 的路径（数组序即捕获序，反序即冒泡序）；
 * - 路径上每个 box 的 rect 都必须包含命中点（不支持溢出父盒的子节点被命中）；
 * - 祖先链上所有 clip（滚动容器）取交集，点落在裁剪区外则整棵子树不可命中；
 * - 兄弟重叠时后声明者（绘制在上层）优先。
 */
import { containsPoint, intersectRect, type LayoutBox, type Rect } from './types.js'

function descend(box: LayoutBox, x: number, y: number, ancestorClip: Rect | undefined): LayoutBox[] {
  if (ancestorClip && !containsPoint(ancestorClip, x, y)) return []
  if (!containsPoint(box.rect, x, y)) return []
  const ownClip = box.clip ? (ancestorClip ? intersectRect(ancestorClip, box.clip) : box.clip) : ancestorClip
  for (let i = box.children.length - 1; i >= 0; i--) {
    const path = descend(box.children[i]!, x, y, ownClip)
    if (path.length) return [box, ...path]
  }
  return [box]
}

/** 命中路径（root→leaf）；未命中返回空数组 */
export function hitPath(root: LayoutBox, x: number, y: number): LayoutBox[] {
  return descend(root, x, y, undefined)
}

/** 路径中最深的非 passthrough 节点（即「实际响应目标」）；全是 passthrough 返回 undefined */
export function topTarget(path: LayoutBox[]): LayoutBox | undefined {
  for (let i = path.length - 1; i >= 0; i--) {
    if (!path[i]!.passthrough) return path[i]
  }
  return undefined
}

/** 点是否落在 box 自身可命中区域（rect 内且未被祖先 clip 裁掉；clip 参数可选） */
export function isPointInBox(box: LayoutBox, x: number, y: number, clip?: Rect): boolean {
  if (clip && !containsPoint(clip, x, y)) return false
  return containsPoint(box.rect, x, y)
}
