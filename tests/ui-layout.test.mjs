import test from 'node:test'
import assert from 'node:assert/strict'
import { layout, measureNode } from '../packages/framework/dist/ui/index.js'

/** 在矩形树中按 id 查找 */
function find(box, id) {
  if (box.id === id) return box
  for (const c of box.children) {
    const hit = find(c, id)
    if (hit) return hit
  }
  return undefined
}
const VP = { w: 400, h: 300 }

test('根节点 auto 尺寸铺满视口', () => {
  const box = layout({ id: 'root' }, VP)
  assert.deepEqual(box.rect, { x: 0, y: 0, w: 400, h: 300 })
})

test('根节点声明尺寸时按声明（不强制铺满）', () => {
  const box = layout({ id: 'root', width: 200, height: 100 }, VP)
  assert.deepEqual(box.rect, { x: 0, y: 0, w: 200, h: 100 })
})

test('padding 内缩 contentRect，子项排在内容盒内', () => {
  const box = layout({ id: 'root', padding: 10, children: [{ id: 'a', content: { w: 50, h: 20 } }] }, VP)
  assert.deepEqual(box.contentRect, { x: 10, y: 10, w: 380, h: 280 })
  assert.deepEqual(find(box, 'a').rect, { x: 10, y: 10, w: 380, h: 20 }) // 默认 stretch：宽填满
})

test('padding 四边可分别指定', () => {
  const box = layout({ id: 'root', padding: { top: 5, left: 20 } }, VP)
  assert.deepEqual(box.contentRect, { x: 20, y: 5, w: 380, h: 295 })
})

test('margin 推移子项位置且不参与 stretch 填满', () => {
  const box = layout({
    id: 'root', padding: 10,
    children: [{ id: 'a', margin: { top: 5, left: 8 }, content: { w: 0, h: 20 } }],
  }, VP)
  const a = find(box, 'a')
  assert.equal(a.rect.x, 10 + 8)
  assert.equal(a.rect.y, 10 + 5)
  assert.equal(a.rect.w, 380 - 8) // stretch 扣除 margin
})

test('column 依次纵向堆叠并计 gap', () => {
  const box = layout({
    id: 'root', direction: 'column', gap: 8, align: 'start',
    children: [
      { id: 'a', width: 50, height: 20 },
      { id: 'b', width: 50, height: 30 },
      { id: 'c', width: 50, height: 40 },
    ],
  }, VP)
  assert.equal(find(box, 'a').rect.y, 0)
  assert.equal(find(box, 'b').rect.y, 28)
  assert.equal(find(box, 'c').rect.y, 66)
})

test('row 依次横向排列并计 gap', () => {
  const box = layout({
    id: 'root', direction: 'row', gap: 4, align: 'start',
    children: [
      { id: 'a', width: 50, height: 20 },
      { id: 'b', width: 60, height: 20 },
    ],
  }, VP)
  assert.equal(find(box, 'a').rect.x, 0)
  assert.equal(find(box, 'b').rect.x, 54)
})

test('align=center/end 控制交叉轴定位', () => {
  const c = layout({ id: 'root', direction: 'row', align: 'center', height: 100, children: [{ id: 'a', width: 10, height: 20 }] }, VP)
  assert.equal(find(c, 'a').rect.y, 40)
  const e = layout({ id: 'root', direction: 'row', align: 'end', height: 100, children: [{ id: 'a', width: 10, height: 20 }] }, VP)
  assert.equal(find(e, 'a').rect.y, 80)
})

test('justify=center/end 分配主轴剩余空间', () => {
  const c = layout({ id: 'root', justify: 'center', children: [{ id: 'a', width: 10, height: 20 }] }, { w: 100, h: 100 })
  assert.equal(find(c, 'a').rect.y, 40)
  const e = layout({ id: 'root', justify: 'end', children: [{ id: 'a', width: 10, height: 20 }] }, { w: 100, h: 100 })
  assert.equal(find(e, 'a').rect.y, 80)
})

test('justify=spaceBetween/spaceEvenly/spaceAround 间距公式', () => {
  const kids = () => [{ id: 'a', width: 10, height: 10 }, { id: 'b', width: 10, height: 10 }, { id: 'c', width: 10, height: 10 }]
  const sb = layout({ id: 'root', justify: 'spaceBetween', children: kids() }, { w: 100, h: 90 })
  assert.deepEqual([0, 1, 2].map((i) => find(sb, 'abc'[i]).rect.y), [0, 40, 80])
  const se = layout({ id: 'root', justify: 'spaceEvenly', children: kids() }, { w: 100, h: 90 })
  assert.deepEqual([0, 1, 2].map((i) => find(se, 'abc'[i]).rect.y), [15, 40, 65])
  const sa = layout({ id: 'root', justify: 'spaceAround', children: kids() }, { w: 100, h: 90 })
  assert.deepEqual([0, 1, 2].map((i) => find(sa, 'abc'[i]).rect.y), [10, 40, 70])
})

test('gap 与 spaceBetween 叠加', () => {
  const box = layout({
    id: 'root', gap: 10, justify: 'spaceBetween',
    children: [{ id: 'a', width: 10, height: 10 }, { id: 'b', width: 10, height: 10 }],
  }, { w: 100, h: 100 })
  assert.equal(find(box, 'b').rect.y, 90)
})

test('百分比尺寸按父内容盒解析', () => {
  const box = layout({
    id: 'root', width: 200, height: 100, padding: 10, align: 'start',
    children: [{ id: 'a', width: { percent: 50 }, height: { percent: 50 } }],
  }, VP)
  // 基准 = 200-20 = 180 内容宽；100-20=80 内容高
  assert.deepEqual(find(box, 'a').rect, { x: 10, y: 10, w: 90, h: 40 })
})

test('百分比嵌套：孙子相对子内容盒', () => {
  const box = layout({
    id: 'root', width: 400, align: 'start',
    children: [{ id: 'p', width: { percent: 50 }, padding: 10, align: 'start', children: [{ id: 'c', width: { percent: 50 }, height: 10 }] }],
  }, VP)
  assert.equal(find(box, 'p').rect.w, 200)
  assert.equal(find(box, 'c').rect.w, 90) // (200-20)*50%
})

test('flex 按权重分配正剩余空间', () => {
  const box = layout({
    id: 'root', direction: 'row', width: 300, align: 'start',
    children: [
      { id: 'a', width: 60, height: 10 },
      { id: 'b', flex: 1, height: 10 },
      { id: 'c', flex: 2, height: 10 },
    ],
  }, VP)
  assert.equal(find(box, 'b').rect.w, 80) // 剩余 240 按 1:2
  assert.equal(find(box, 'c').rect.w, 160)
})

test('flex 无剩余空间时不增长也不收缩', () => {
  const box = layout({
    id: 'root', direction: 'row', width: 100, align: 'start',
    children: [{ id: 'a', width: 80, height: 10 }, { id: 'b', flex: 1, width: 50, height: 10 }],
  }, VP)
  assert.equal(find(box, 'a').rect.w, 80)
  assert.equal(find(box, 'b').rect.w, 50) // 溢出父盒（不支持 shrink）
})

test('min/max 夹住声明与 auto 尺寸', () => {
  const box = layout({
    id: 'root', direction: 'row', align: 'start',
    children: [
      { id: 'a', width: 10, height: 10, minWidth: 30 },
      { id: 'b', width: 900, height: 10, maxWidth: 100 },
    ],
  }, VP)
  assert.equal(find(box, 'a').rect.w, 30)
  assert.equal(find(box, 'b').rect.w, 100)
})

test('叶子固有尺寸 content 参与测量', () => {
  const size = measureNode({ padding: 4, content: { w: 60, h: 16 } }, Infinity, Infinity)
  assert.deepEqual(size, { w: 68, h: 24 })
})

test('auto 容器收缩到可用空间（不溢出父盒）', () => {
  const box = layout({
    id: 'root', width: 100, align: 'start',
    children: [{ id: 'a', content: { w: 500, h: 10 } }],
  }, VP)
  assert.equal(find(box, 'a').rect.w, 100)
})

test('三层嵌套位置逐级合成', () => {
  const box = layout({
    id: 'root', padding: 10, children: [
      { id: 'l1', padding: 5, children: [{ id: 'l2', padding: 2, children: [{ id: 'leaf', width: 20, height: 8 }] }] },
    ],
  }, VP)
  // 默认全 stretch：leaf x = 10+5+2
  assert.deepEqual(find(box, 'leaf').rect, { x: 17, y: 17, w: 20, h: 8 })
})

test('布局为纯函数：不修改输入 spec', () => {
  const spec = {
    id: 'root', padding: 10, direction: 'row', gap: 4,
    children: [{ id: 'a', width: { percent: 50 }, height: 20, margin: 2 }, { id: 'b', flex: 1, height: 20 }],
  }
  const snapshot = JSON.stringify(spec)
  layout(spec, VP)
  assert.equal(JSON.stringify(spec), snapshot)
})

test('滚动容器：ScrollMetrics 给出 content/viewport/maxOffset', () => {
  const box = layout({
    id: 'root', width: 100, height: 50, scroll: true,
    children: [{ id: 's1', height: 40 }, { id: 's2', height: 40 }, { id: 's3', height: 40 }],
  }, VP)
  assert.deepEqual(box.scroll, { axis: 'y', offset: 0, content: 120, viewport: 50, maxOffset: 70 })
  assert.deepEqual(box.clip, box.contentRect)
})

test('滚动偏移把子项整体上移（渲染坐标系）', () => {
  const box = layout({
    id: 'root', width: 100, height: 50, scroll: true, scrollOffset: 20,
    children: [{ id: 's1', height: 40 }, { id: 's2', height: 40 }],
  }, VP)
  assert.equal(find(box, 's1').rect.y, -20)
  assert.equal(find(box, 's2').rect.y, 20)
  assert.equal(box.scroll.offset, 20)
})

test('横向滚动（char-row 场景）：axis=x，子项超出宽度', () => {
  const box = layout({
    id: 'row', direction: 'row', scroll: true, width: 200, height: 120, gap: 8, scrollOffset: 30,
    children: [{ id: 'c1', width: 150, height: 100 }, { id: 'c2', width: 150, height: 100 }, { id: 'c3', width: 150, height: 100 }],
  }, VP)
  assert.equal(box.scroll.axis, 'x')
  assert.equal(box.scroll.content, 150 * 3 + 16)
  assert.equal(box.scroll.maxOffset, 466 - 200)
  assert.equal(find(box, 'c1').rect.x, -30)
  assert.equal(find(box, 'c2').rect.x, 128) // 150+gap8-30
})

test('滚动容器内 flex 不分剩余空间（主轴无限测量）', () => {
  const box = layout({
    id: 'root', scroll: true, width: 100, height: 50,
    children: [{ id: 'a', flex: 1, width: 30, height: 10 }],
  }, VP)
  assert.equal(find(box, 'a').rect.w, 30)
})

test('内容不超视口时 maxOffset=0', () => {
  const box = layout({ id: 'root', scroll: true, width: 100, height: 50, children: [{ id: 'a', height: 20 }] }, VP)
  assert.equal(box.scroll.maxOffset, 0)
  assert.equal(box.scroll.content, 20)
})
