import test from 'node:test'
import assert from 'node:assert/strict'
import { computeVirtualWindow, contentExtentOf, itemStart, clampOffset } from '../packages/framework/dist/ui/index.js'

const spec = (over = {}) => ({ itemCount: 100, itemExtent: 40, gap: 0, viewportExtent: 200, overscan: 1, ...over })

test('offset=0：首屏窗口 = 可见项 + 单侧 overscan', () => {
  const w = computeVirtualWindow(spec(), 0)
  assert.deepEqual({ start: w.start, end: w.end, count: w.count, leading: w.leading },
    { start: 0, end: 6, count: 6, leading: 0 }) // 可见 0..4（第5项跨边界），+1 overscan
})

test('中段滚动：窗口随 offset 平移', () => {
  const w = computeVirtualWindow(spec(), 400) // 视口 [400,600] → 严格可见项 10..14
  assert.equal(w.start, 9)  // 10 - overscan
  assert.equal(w.end, 16)   // 14 + 1（end 不含）+ 1 overscan
  assert.equal(w.leading, 9 * 40)
})

test('contentExtent / maxOffset / itemStart', () => {
  const s = spec({ itemCount: 10, gap: 5 })
  assert.equal(contentExtentOf(s), 10 * 40 + 9 * 5)
  const w = computeVirtualWindow(s, 0)
  assert.equal(w.contentExtent, 445)
  assert.equal(w.maxOffset, 445 - 200)
  assert.equal(itemStart(s, 3), 3 * 45)
})

test('gap 参与 pitch：窗口边界按 itemExtent+gap 计算', () => {
  const s = spec({ itemCount: 50, gap: 10 }) // pitch 50
  const w = computeVirtualWindow(s, 250) // 视口 [250,450]：项5(250..290)…项8(400..440)
  assert.equal(w.start, 4)
  assert.ok(w.end >= 10)
  assert.equal(w.leading, 4 * 50)
})

test('overscan 在头尾被夹住（不出负索引/不越 itemCount）', () => {
  const head = computeVirtualWindow(spec({ overscan: 5 }), 0)
  assert.equal(head.start, 0)
  const tail = computeVirtualWindow(spec({ itemCount: 8, overscan: 5 }), 1e9) // offset 夹到 maxOffset=120
  assert.equal(tail.end, 8)
  assert.ok(tail.count <= 8)
})

test('offset 越界夹回：负数按 0、超大按 maxOffset', () => {
  const neg = computeVirtualWindow(spec(), -100)
  assert.equal(neg.start, 0)
  const max = spec().itemCount * 40 - 200 // 3800
  assert.equal(clampOffset(spec(), -5), 0)
  assert.equal(clampOffset(spec(), 99999), max)
  const w = computeVirtualWindow(spec(), 99999)
  assert.equal(w.end, 100) // 末尾窗口含最后一项
  assert.ok(w.start >= 94)
})

test('空列表：count=0，contentExtent=0，maxOffset=0', () => {
  const w = computeVirtualWindow(spec({ itemCount: 0 }), 0)
  assert.deepEqual({ start: w.start, end: w.end, count: w.count, contentExtent: w.contentExtent, maxOffset: w.maxOffset },
    { start: 0, end: 0, count: 0, contentExtent: 0, maxOffset: 0 })
  assert.equal(contentExtentOf(spec({ itemCount: 0 })), 0)
})

test('视口大于内容：全部项入窗且 maxOffset=0', () => {
  const w = computeVirtualWindow(spec({ itemCount: 3, viewportExtent: 500 }), 0)
  assert.equal(w.start, 0)
  assert.equal(w.end, 3)
  assert.equal(w.maxOffset, 0)
  assert.equal(w.contentExtent, 120)
})

test('overscan=0：只渲染严格可见项', () => {
  const w = computeVirtualWindow(spec({ overscan: 0 }), 0)
  assert.equal(w.start, 0)
  assert.equal(w.end, 5) // 项0..3 完整 + 项4 跨下边界（160..200 恰满）
})

test('非整数 offset / NaN 防呆', () => {
  const w = computeVirtualWindow(spec(), 40.5)
  assert.ok(Number.isInteger(w.start) && Number.isInteger(w.end))
  assert.equal(computeVirtualWindow(spec(), NaN).start, 0) // NaN 夹为 0
})

test('视口恰好整除 pitch：不多渲染整项', () => {
  const w = computeVirtualWindow(spec({ viewportExtent: 160, overscan: 0 }), 0)
  assert.equal(w.end, 4) // [0,160) 恰好 4 项
})
