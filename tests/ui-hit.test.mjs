import test from 'node:test'
import assert from 'node:assert/strict'
import { layout, hitPath, topTarget } from '../packages/framework/dist/ui/index.js'

const ids = (path) => path.map((b) => b.id)
const VP = { w: 400, h: 300 }

test('命中返回 root→leaf 路径（捕获序）', () => {
  const box = layout({
    id: 'root', padding: 10, children: [
      { id: 'panel', padding: 5, children: [{ id: 'btn', width: 50, height: 20 }] },
    ],
  }, VP)
  assert.deepEqual(ids(hitPath(box, 20, 20)), ['root', 'panel', 'btn'])
})

test('视口外未命中返回空路径', () => {
  const box = layout({ id: 'root', width: 100, height: 100 }, VP)
  assert.deepEqual(hitPath(box, 150, 50), [])
  assert.deepEqual(hitPath(box, -1, 50), [])
})

test('最深节点优先：嵌套按钮取内层', () => {
  const box = layout({
    id: 'outer', width: 200, height: 200,
    children: [{ id: 'inner', width: 100, height: 100 }],
  }, VP)
  const path = hitPath(box, 50, 50)
  assert.equal(path[path.length - 1].id, 'inner')
})

test('兄弟重叠时后声明者（绘制上层）优先', () => {
  // 用负 margin 制造重叠（row 下 over 盖在 under 上）
  const box = layout({
    id: 'root', width: 200, height: 200, direction: 'row', align: 'start',
    children: [
      { id: 'under', width: 200, height: 200 },
      { id: 'over', width: 200, height: 200, margin: { left: -200 } },
    ],
  }, VP)
  const path = hitPath(box, 100, 100)
  assert.deepEqual(ids(path), ['root', 'over'])
})

test('padding 区域命中容器但不命中子项', () => {
  const box = layout({
    id: 'root', padding: 20, children: [{ id: 'btn', width: 50, height: 50 }],
  }, VP)
  assert.deepEqual(ids(hitPath(box, 10, 10)), ['root']) // 落在 padding
  assert.deepEqual(ids(hitPath(box, 30, 30)), ['root', 'btn'])
})

test('滚动裁剪：滚出视口的子项不可命中', () => {
  const box = layout({
    id: 'root', width: 100, height: 50, scroll: true, scrollOffset: 0,
    children: [{ id: 's1', height: 40 }, { id: 's2', height: 40 }],
  }, VP)
  // s2 布局在 y=40..80，视口 clip y=0..50：点 (10, 45) 命中 s2
  assert.deepEqual(ids(hitPath(box, 10, 45)), ['root', 's2'])
  // 点 (10, 55) 在 clip 外 → 整棵子树不可命中
  assert.deepEqual(hitPath(box, 10, 55), [])
})

test('滚动偏移后：滚出上边界的子项不可命中', () => {
  const box = layout({
    id: 'root', width: 100, height: 50, scroll: true, scrollOffset: 40,
    children: [{ id: 's1', height: 40 }, { id: 's2', height: 40 }],
  }, VP)
  // s1 布局在 y=-40..0，完全滚出 → 视口内只有 s2（y=0..40）
  assert.deepEqual(ids(hitPath(box, 10, 10)), ['root', 's2'])
  // s1 的绝对坐标处（y=-10）不可命中
  assert.deepEqual(hitPath(box, 10, -10), [])
})

test('passthrough：自身不参与命中目标，子项仍可命中', () => {
  const box = layout({
    id: 'hud', passthrough: true, children: [
      { id: 'btn', width: 80, height: 30 },
    ],
  }, VP)
  const path = hitPath(box, 10, 10)
  assert.deepEqual(ids(path), ['hud', 'btn'])
  assert.equal(topTarget(path).id, 'btn')
  // 只命中 passthrough 底板时 topTarget 为 undefined
  const bare = layout({ id: 'hud', passthrough: true }, VP)
  assert.equal(topTarget(hitPath(bare, 10, 10)), undefined)
})

test('嵌套滚动容器：clip 取祖先交集', () => {
  const box = layout({
    id: 'outer', width: 100, height: 60, scroll: true, scrollOffset: 0,
    children: [{
      id: 'inner', width: 100, height: 200, scroll: true, scrollOffset: 150,
      children: [{ id: 'deep', height: 40 }],
    }],
  }, VP)
  // deep 相对 inner 在 y=-150..-110 → 在 inner 视口外，不可命中
  assert.deepEqual(ids(hitPath(box, 50, 30)), ['outer', 'inner'])
  // inner 本身高度 200 超出 outer clip(60)：y=100 在外层 clip 外
  assert.deepEqual(hitPath(box, 50, 100), [])
})

test('溢出父盒（无裁剪）的子项不可命中：命中要求路径每层都包含点', () => {
  const box = layout({
    id: 'root', width: 50, height: 50, align: 'start', justify: 'start',
    children: [{ id: 'big', width: 200, height: 200 }],
  }, VP)
  // big 覆盖 (0..200)，但 root 只有 50x50：点 (100,100) 不在 root 内
  assert.deepEqual(hitPath(box, 100, 100), [])
  // root 内部的点仍能命中 big
  assert.deepEqual(ids(hitPath(box, 10, 10)), ['root', 'big'])
})

test('边界语义：右/下边缘开区间（x == rect.x+w 不命中）', () => {
  const box = layout({ id: 'root', width: 100, height: 100 }, VP)
  assert.deepEqual(ids(hitPath(box, 99, 99)), ['root'])
  assert.deepEqual(hitPath(box, 100, 99), [])
})
