import test from 'node:test'
import assert from 'node:assert/strict'
import { createButton, buttonNext, buttonActivates } from '../packages/framework/dist/ui/index.js'

test('初始态：默认 normal，可指定 disabled', () => {
  assert.equal(createButton().state, 'normal')
  assert.equal(createButton({ disabled: true }).state, 'disabled')
})

test('normal --down--> pressed --up--> normal 且激活', () => {
  const b = createButton()
  assert.deepEqual(b.send('down'), { state: 'pressed', changed: true, activated: false })
  assert.deepEqual(b.send('up'), { state: 'normal', changed: true, activated: true })
})

test('disabled 吞掉除 enable 外的一切事件', () => {
  const b = createButton({ disabled: true })
  for (const ev of ['down', 'up', 'leave', 'enter', 'cancel', 'disable']) {
    const r = b.send(ev)
    assert.equal(r.state, 'disabled')
    assert.equal(r.changed, false)
    assert.equal(r.activated, false)
  }
  assert.equal(b.send('enable').state, 'normal')
})

test('pressed 中 leave/cancel → normal 且不激活', () => {
  for (const ev of ['leave', 'cancel']) {
    const b = createButton()
    b.send('down')
    const r = b.send(ev)
    assert.equal(r.state, 'normal')
    assert.equal(r.activated, false)
    assert.equal(b.send('up').activated, false) // 已释放，再 up 不算点击
  }
})

test('pressed 中 disable → disabled；enable 回 normal（不复活按压）', () => {
  const b = createButton()
  b.send('down')
  assert.equal(b.send('disable').state, 'disabled')
  assert.equal(b.send('enable').state, 'normal')
})

test('buttonActivates 仅在 (pressed, up) 为真', () => {
  assert.equal(buttonActivates('pressed', 'up'), true)
  assert.equal(buttonActivates('normal', 'up'), false)
  assert.equal(buttonActivates('disabled', 'up'), false)
  assert.equal(buttonActivates('pressed', 'cancel'), false)
  assert.equal(buttonActivates('pressed', 'leave'), false)
})

test('buttonNext 为纯函数：同输入同输出，enter 不改 normal', () => {
  assert.equal(buttonNext('normal', 'down'), 'pressed')
  assert.equal(buttonNext('normal', 'down'), 'pressed')
  assert.equal(buttonNext('normal', 'enter'), 'normal')
  assert.equal(buttonNext('pressed', 'enter'), 'pressed')
  assert.equal(buttonNext('pressed', 'down'), 'pressed')
  assert.equal(buttonNext('normal', 'enable'), 'normal')
  assert.equal(buttonNext('normal', 'disable'), 'disabled')
})
