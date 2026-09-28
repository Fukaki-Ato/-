import test from 'node:test'
import assert from 'node:assert/strict'
import { ScrollPhysics, resolveScrollFeel, defaultScrollFeel, estimateVelocity } from '../packages/framework/dist/ui/index.js'

/** 以固定步长推进直到静止，返回步数（上限保护防止测试挂死） */
function runToRest(p, dt = 1 / 60, maxSteps = 60 * 20) {
  let steps = 0
  while (p.animating && steps < maxSteps) { p.step(dt); steps++ }
  return steps
}

test('resolveScrollFeel：缺省补全 + 局部覆盖', () => {
  const feel = resolveScrollFeel({ frictionPerS: 2 })
  assert.equal(feel.frictionPerS, 2)
  assert.equal(feel.bounceStiffness, defaultScrollFeel.bounceStiffness)
  assert.deepEqual(resolveScrollFeel(null), defaultScrollFeel)
  for (const v of Object.values(defaultScrollFeel)) assert.ok(Number.isFinite(v) && v > 0)
})

test('estimateVelocity：匀速采样 → px/s', () => {
  const samples = [0, 16, 32, 48].map((x, i) => ({ x, t: i * 0.016 }))
  assert.ok(Math.abs(estimateVelocity(samples) - 1000) < 1e-6)
})

test('estimateVelocity：采样不足或零时长返回 0', () => {
  assert.equal(estimateVelocity([]), 0)
  assert.equal(estimateVelocity([{ x: 5, t: 0 }]), 0)
  assert.equal(estimateVelocity([{ x: 0, t: 1 }, { x: 9, t: 1 }]), 0)
})

test('estimateVelocity：只用尾部 100ms 窗口（旧采样被忽略）', () => {
  const samples = [
    { x: 0, t: 0 }, { x: 1000, t: 0.5 },        // 很久以前的剧烈移动
    { x: 1000, t: 0.95 }, { x: 1010, t: 1.0 },  // 尾部 50ms 移动 10px → 200px/s
  ]
  assert.ok(Math.abs(estimateVelocity(samples) - 200) < 1e-6)
})

test('dragBy 跟手：offset 随指针反向移动', () => {
  const p = new ScrollPhysics({ content: 1000, viewport: 200 })
  p.dragStart(0)
  p.dragBy(-50, 0.016) // 手指上滑 50 → 内容下移，offset +50
  assert.equal(p.offset, 50)
  assert.equal(p.dragging, true)
})

test('拖拽越界：超出部分乘 overscrollResist（橡皮筋）', () => {
  const p = new ScrollPhysics({ content: 1000, viewport: 200, feel: { overscrollResist: 0.5 } })
  p.dragStart(0)
  p.dragBy(-850, 0.016) // raw=850，超过 maxOffset=800 → 800 + 50*0.5
  assert.equal(p.offset, 825)
  p.dragBy(-100, 0.032) // raw=925 → 800 + 125*0.5
  assert.equal(p.offset, 862.5)
  // 反向拉过头：raw = 862.5-1000 = -137.5 → -137.5*0.5
  p.dragBy(1000, 0.048)
  assert.equal(p.offset, -68.75)
})

test('dragEnd：由采样估 fling 初速（内容速度 = -指针速度）并夹住上限', () => {
  const p = new ScrollPhysics({ content: 5000, viewport: 200 })
  p.dragStart(0)
  p.dragBy(-10, 0.016) // 指针速度 ≈ -625 px/s
  p.dragBy(-10, 0.032)
  const v = p.dragEnd()
  assert.ok(v > 600 && v < 650, `fling 速度应约 +625，实际 ${v}`)
  assert.equal(p.dragging, false)
  // 上限
  const q = new ScrollPhysics({ content: 1e6, viewport: 200, feel: { flingMaxPxS: 3000 } })
  q.dragStart(0)
  q.dragBy(-500, 0.001)
  assert.equal(q.dragEnd(), 3000)
})

test('惯性衰减：速度单调收敛，最终静止且 offset 在界内', () => {
  const p = new ScrollPhysics({ content: 1e6, viewport: 200 }) // 无边界干扰，纯摩擦
  p.fling(2000)
  let prevV = Math.abs(p.velocityPxS)
  let prevOffset = p.offset
  for (let i = 0; i < 300 && p.animating; i++) {
    p.step(1 / 60)
    const v = Math.abs(p.velocityPxS)
    assert.ok(v <= prevV + 1e-9, '速度大小不得增加')
    assert.ok(p.offset >= prevOffset - 1e-9, '正向惯性 offset 单调不减')
    prevV = v
    prevOffset = p.offset
  }
  assert.equal(p.animating, false)
  assert.ok(Number.isFinite(p.offset))
})

test('惯性总位移有限且随初速增大（收敛性）', () => {
  const dist = (v0) => {
    const p = new ScrollPhysics({ content: 1e9, viewport: 100 })
    p.fling(v0)
    runToRest(p)
    return p.offset
  }
  const d1 = dist(500)
  const d2 = dist(1000)
  assert.ok(d1 > 0 && d2 > d1, `d1=${d1} d2=${d2}`)
  // 指数衰减理论位移 v0/friction，数值解应接近（±20%）
  const theory = 500 / defaultScrollFeel.frictionPerS
  assert.ok(Math.abs(d1 - theory) / theory < 0.2, `d1=${d1} theory=${theory}`)
})

test('低速 fling 直接静止（minVelocity 阈值）', () => {
  const p = new ScrollPhysics({ content: 1000, viewport: 200 })
  p.dragStart(0)
  p.dragBy(-0.1, 0.016) // 慢速拖拽
  const v = p.dragEnd()
  assert.equal(v, 0)
  assert.equal(p.animating, false)
})

test('回弹：fling 冲过底边界后弹回 [0,maxOffset] 并静止', () => {
  const p = new ScrollPhysics({ content: 400, viewport: 200 }) // maxOffset=200
  p.snapTo(190)
  p.fling(3000) // 高速冲向底部
  const steps = runToRest(p, 1 / 60, 60 * 10)
  assert.ok(steps < 60 * 10, '回弹必须在有限步内收敛')
  assert.ok(p.offset >= -1e-6 && p.offset <= 200 + 1e-6, `offset=${p.offset} 应回到界内`)
  assert.ok(Math.abs(p.offset - 200) < 1, '应收敛到底边界附近')
})

test('回弹：拖拽越过顶部松手（零速度）也弹回 0', () => {
  const p = new ScrollPhysics({ content: 1000, viewport: 200, feel: { overscrollResist: 1 } })
  p.dragStart(0)
  p.dragBy(120, 0.5) // 慢慢拖出顶部：raw=-120，resist=1 → offset=-120
  assert.ok(p.offset < 0)
  p.dragEnd() // 慢速 → 无 fling，仅回弹
  const steps = runToRest(p)
  assert.ok(steps > 0)
  assert.ok(Math.abs(p.offset) < 1e-6, `应精确回 0，实际 ${p.offset}`)
  assert.equal(p.animating, false)
})

test('content <= viewport：maxOffset=0，任何拖拽都弹回 0', () => {
  const p = new ScrollPhysics({ content: 100, viewport: 300 })
  assert.equal(p.maxOffset, 0)
  p.dragStart(0)
  p.dragBy(-80, 0.016)
  p.dragEnd()
  runToRest(p)
  assert.ok(Math.abs(p.offset) < 1e-6)
})

test('step：静止时返回 false；非法 dt 安全', () => {
  const p = new ScrollPhysics({ content: 1000, viewport: 200 })
  assert.equal(p.step(1 / 60), false)
  assert.equal(p.step(0), false)
  assert.equal(p.step(-1), false)
  assert.equal(p.step(NaN), false)
  p.dragStart(0)
  assert.equal(p.step(1 / 60), false) // 拖拽中不由 step 推进
})

test('大 dt 不炸：内部子步保持弹簧稳定（无 NaN/发散）', () => {
  const p = new ScrollPhysics({ content: 400, viewport: 200 })
  p.snapTo(200)
  p.fling(-4000) // 高速冲顶
  p.step(0.5)    // 单帧半秒（卡顿场景；内部子步且最多模拟 0.25s）
  assert.ok(Number.isFinite(p.offset))
  assert.ok(p.offset > -2000 && p.offset < 300, `offset=${p.offset} 不应发散`)
  runToRest(p, 1 / 30, 60 * 20)
  assert.ok(p.offset >= -1e-6 && p.offset <= 200 + 1e-6)
})

test('setBounds：内容变化后 offset 夹回合法区间', () => {
  const p = new ScrollPhysics({ content: 1000, viewport: 200 })
  p.snapTo(700)
  p.setBounds(500, 200) // maxOffset 变 300
  assert.equal(p.offset, 300)
})

test('snapTo：清速度并夹住范围', () => {
  const p = new ScrollPhysics({ content: 1000, viewport: 200 })
  p.fling(500)
  p.snapTo(9999)
  assert.equal(p.offset, 800)
  assert.equal(p.velocityPxS, 0)
  assert.equal(p.animating, false)
})
