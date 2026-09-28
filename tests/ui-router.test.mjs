import test from 'node:test'
import assert from 'node:assert/strict'
import { layout, InputRouter } from '../packages/framework/dist/ui/index.js'

/**
 * 典型场景树：panel(滚动容器) > btn(按钮)，root 包一层。
 * root 0..400x300；panel y=0..200；btn 在 panel 内 (0,0,100,40)。
 */
function scene() {
  return layout({
    id: 'root', children: [
      { id: 'panel', scroll: true, height: 200, children: [{ id: 'btn', height: 40, width: 100 }] },
    ],
  }, { w: 400, h: 300 })
}

function rec() {
  const log = []
  return { log, h: (name) => ({
    onDown: (e) => log.push(`${name}:down:${e.phase}`),
    onMove: (e) => log.push(`${name}:move:${e.phase}`),
    onUp: (e) => log.push(`${name}:up:${e.phase}`),
    onCancel: (e) => log.push(`${name}:cancel:${e.phase}`),
    onClick: (e) => log.push(`${name}:click:${e.phase}`),
    onPressChange: (p) => log.push(`${name}:press:${p}`),
  }) }
}

function wiredRouter(tree, names, opts) {
  const r = rec()
  const router = new InputRouter(opts)
  router.setTree(tree)
  for (const n of names) router.register(n, r.h(n))
  return { router, log: r.log }
}

test('down/up 同点：捕获→目标→冒泡 完整顺序 + click', () => {
  const { router, log } = wiredRouter(scene(), ['root', 'panel', 'btn'])
  router.dispatch({ type: 'down', x: 10, y: 10, t: 0 })
  router.dispatch({ type: 'up', x: 10, y: 10, t: 0.1 })
  assert.deepEqual(log, [
    'btn:press:true',
    'root:down:capture', 'panel:down:capture', 'btn:down:target', 'panel:down:bubble', 'root:down:bubble',
    'btn:press:false',
    'root:up:capture', 'panel:up:capture', 'btn:up:target', 'panel:up:bubble', 'root:up:bubble',
    'root:click:capture', 'panel:click:capture', 'btn:click:target', 'panel:click:bubble', 'root:click:bubble',
  ])
})

test('捕获阶段 stopPropagation：目标收不到事件', () => {
  const { router, log } = wiredRouter(scene(), ['root', 'panel', 'btn'])
  router.register('root', { onDown: (e) => { log.push('root:stop'); e.stopPropagation() } })
  router.dispatch({ type: 'down', x: 10, y: 10, t: 0 })
  // 按压通知（onPressChange）在分发前独立发出；down 的捕获/冒泡被 root 截断
  assert.deepEqual(log, ['btn:press:true', 'root:stop'])
  assert.equal(router.isPressing, true) // stopPropagation 只截断分发，不改变按压追踪
})

test('目标阶段 stopPropagation：冒泡到不了根', () => {
  const tree = scene()
  const log = []
  const router = new InputRouter()
  router.setTree(tree)
  router.register('root', { onDown: () => log.push('root') })
  router.register('panel', { onDown: () => log.push('panel') })
  router.register('btn', { onDown: (e) => { log.push('btn'); e.stopPropagation() } })
  router.dispatch({ type: 'down', x: 10, y: 10, t: 0 })
  assert.deepEqual(log, ['root', 'panel', 'btn'])
})

test('移动超过 slop：按压取消（cancel + press:false），up 后无 click', () => {
  const { router, log } = wiredRouter(scene(), ['root', 'panel', 'btn'], { slop: 8 })
  router.dispatch({ type: 'down', x: 10, y: 10, t: 0 })
  router.dispatch({ type: 'move', x: 10, y: 30, t: 0.05 }) // 位移 20 > 8
  router.dispatch({ type: 'up', x: 10, y: 30, t: 0.1 })
  assert.ok(log.includes('btn:press:false'))
  assert.ok(log.includes('btn:cancel:target'))
  assert.ok(!log.some((s) => s.includes('click')))
  // 滚动容器在 cancel 后仍继续收 move（拖拽滚动不中断）
  assert.ok(log.includes('panel:move:capture'))
})

test('移动小于 slop：保持按压，up 触发 click', () => {
  const { router, log } = wiredRouter(scene(), ['root', 'panel', 'btn'], { slop: 8 })
  router.dispatch({ type: 'down', x: 10, y: 10, t: 0 })
  router.dispatch({ type: 'move', x: 12, y: 13, t: 0.05 }) // 位移 ~3.6 < 8
  assert.equal(router.isPressing, true)
  router.dispatch({ type: 'up', x: 12, y: 13, t: 0.1 })
  assert.ok(log.includes('btn:click:target'))
})

test('up 落在目标矩形外：无 click（按压已释放）', () => {
  const { router, log } = wiredRouter(scene(), ['root', 'panel', 'btn'], { slop: 1000 })
  router.dispatch({ type: 'down', x: 10, y: 10, t: 0 })
  router.dispatch({ type: 'up', x: 300, y: 10, t: 0.1 }) // slop 巨大未触发 cancel，但 up 不在 btn 内
  assert.ok(log.includes('btn:press:false'))
  assert.ok(!log.some((s) => s.includes('click')))
})

test('cancel 输入：释放按压并发 cancel', () => {
  const { router, log } = wiredRouter(scene(), ['root', 'panel', 'btn'])
  router.dispatch({ type: 'down', x: 10, y: 10, t: 0 })
  router.dispatch({ type: 'cancel', x: 10, y: 10, t: 0.1 })
  assert.equal(router.isPressing, false)
  assert.ok(log.includes('btn:cancel:target'))
  assert.ok(!log.some((s) => s.includes('click')))
})

test('未注册 handler 的区域：无按压目标，isPressing 保持 false', () => {
  const { router, log } = wiredRouter(scene(), ['btn'])
  router.dispatch({ type: 'down', x: 300, y: 250, t: 0 }) // panel 内、btn 外的空白
  assert.equal(router.isPressing, false)
  assert.deepEqual(log, [])
  router.dispatch({ type: 'up', x: 300, y: 250, t: 0.1 })
  assert.deepEqual(log, [])
})

test('按压目标取路径中最深的已注册节点', () => {
  const { router, log } = wiredRouter(scene(), ['root', 'panel']) // btn 未注册
  router.dispatch({ type: 'down', x: 10, y: 10, t: 0 })
  assert.equal(router.isPressing, true)
  router.dispatch({ type: 'up', x: 10, y: 10, t: 0.1 })
  assert.ok(log.includes('panel:press:true'))
  // 事件 target 仍是最深命中节点 btn（未注册），panel 以 capture/bubble 相位收到
  assert.ok(log.includes('panel:click:capture'))
  assert.ok(log.includes('panel:click:bubble'))
})

test('down 未命中任何节点：后续 move/up 被忽略', () => {
  const { router, log } = wiredRouter(scene(), ['root', 'panel', 'btn'])
  router.dispatch({ type: 'down', x: 500, y: 500, t: 0 }) // 视口外
  router.dispatch({ type: 'move', x: 10, y: 10, t: 0.05 })
  router.dispatch({ type: 'up', x: 10, y: 10, t: 0.1 })
  assert.deepEqual(log, [])
})

test('重复 down（第二指）：先释放旧按压再开新按压', () => {
  const { router, log } = wiredRouter(scene(), ['root', 'panel', 'btn'])
  router.dispatch({ type: 'down', x: 10, y: 10, t: 0 })
  router.dispatch({ type: 'down', x: 10, y: 10, t: 0.05 })
  assert.deepEqual(log.filter((s) => s === 'btn:press:false').length, 1)
  assert.deepEqual(log.filter((s) => s === 'btn:press:true').length, 2)
})
