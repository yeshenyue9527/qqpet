import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTs, settle } from './load.mjs'

async function fixture(position = { lastX: 500, lastY: 300 }, moveToCursor) {
  const info = { ...position }
  const listeners = []
  const pet = Object.assign(new EventTarget(), {
    style: {}, hidden: false, classList: { contains: () => false },
    setPointerCapture() { this.captured = true },
    hasPointerCapture() { return Boolean(this.captured) },
    releasePointerCapture() { this.captured = false; this.dispatchEvent(new Event('lostpointercapture')) },
  })
  const window = new EventTarget()
  let cursorListener
  let trayListener
  let recoveries = 0
  let settings = 0
  const through = []
  const warnings = []
  const machine = { pose: { a: 'normal' }, play(pose) { this.pose = pose } }
  window.qqpet = {
    moveToCursor,
    onCursor: (listener) => { cursorListener = listener },
    onTrayClick: (listener) => { trayListener = listener },
    onClipboard() {}, onPresence() {}, onFront() {},
    setClickThrough: (value) => through.push(value),
  }
  const mocks = {
    './pet/ai': { clipAsk() {}, IDLE: '', note() {} },
    './pet/jobs': { resumeTask() {} },
    './pet/pet': { machine, speak() {}, startPet() {} },
    './pet/store': {
      info, save: { havePet: true, settings: {} },
      petSize: () => 146 * context.innerWidth / 1920,
      onInfoChange: (fn) => listeners.push(fn),
      setInfo(key, value) {
        if (info[key] === value) return
        info[key] = value
        for (const fn of listeners) fn(key)
      },
    },
    './ui/adopt': { adopt() {} },
    './ui/control': { scheduleHide() {}, showControl() {} },
    './ui/dom': { div() {}, pageX: (e) => e.clientX, pageY: (e) => e.clientY, touch: false },
    './ui/face': {}, './ui/music': {},
    './ui/menu': { closeMenu() {}, openMenu() {} },
    './ui/state': { openState() {} },
    './ui/setup': { homing: () => recoveries++, openSetup: () => settings++ },
  }
  // The mocked store reads the same viewport that the renderer sees.
  const context = { innerWidth: 1512, innerHeight: 898 }
  const result = await loadTs('src/renderer/main.ts', mocks, {
    ...context, window, AbortController,
    console: { ...console, warn: (...args) => warnings.push(args) },
    document: { getElementById: () => pet, elementFromPoint: () => null },
    ShadowRoot: class {},
    requestAnimationFrame: (fn) => queueMicrotask(() => fn(0)),
    setInterval() {}, setTimeout, clearTimeout,
  })
  const fire = (type, x, y, pointerId = 1) => pet.dispatchEvent(Object.assign(new Event(type), {
    button: 0, pointerId, clientX: x, clientY: y,
  }))
  return {
    info, machine, fire, through, window, warnings,
    resize(width, height) {
      context.innerWidth = result.context.innerWidth = width
      context.innerHeight = result.context.innerHeight = height
      window.dispatchEvent(new Event('resize'))
    },
    cursor(x, y) { cursorListener({ x, y }) },
    tray(kind) { trayListener({ kind }) },
    recovered: () => recoveries, settingsOpened: () => settings,
    size: () => 146 * context.innerWidth / 1920,
  }
}

test('startup restores an off-screen saved pet without changing valid positions', async () => {
  const lost = await fixture({ lastX: 1397, lastY: 1037 })
  assert.ok(lost.info.lastY + lost.size() <= 898)
  const valid = await fixture()
  assert.deepEqual(valid.info, { lastX: 500, lastY: 300 })
  const fresh = await fixture({ lastX: -1, lastY: -1 })
  assert.equal(fresh.info.lastX, (1512 - fresh.size()) / 2)
})

test('right-edge release clamps Y before playing the edge animation', async () => {
  const f = await fixture()
  f.fire('pointerdown', 550, 330)
  f.fire('pointermove', 1700, 1200)
  f.fire('pointerup', 1700, 1200)
  await settle()
  assert.ok(f.info.lastY + f.size() <= 898)
  assert.equal(f.machine.pose.a, 'hideright')
})

for (const event of ['pointercancel', 'lostpointercapture']) {
  test(event + ' cleans up dragging and restores an on-screen position', async () => {
    let moved = false
    const f = await fixture(undefined, async () => { moved = true })
    f.fire('pointerdown', 550, 330)
    f.fire('pointermove', -500, -300)
    f.fire(event, -500, -300)
    await settle()
    assert.equal(moved, false)
    assert.equal(f.info.lastX, 0)
    assert.equal(f.info.lastY, 0)
    f.cursor(10, 10)
    f.cursor(500, 500)
    assert.equal(f.through.at(-1), true)
  })
}

test('resizing clamps both axes, including viewports smaller than the pet', async () => {
  const f = await fixture({ lastX: 1300, lastY: 700 })
  f.resize(800, 400)
  assert.ok(f.info.lastX + f.size() <= 800)
  assert.ok(f.info.lastY + f.size() <= 400)
  f.resize(800, 20)
  assert.equal(f.info.lastY, 0)
})

test('cross-screen release places the pet relative to the new viewport', async () => {
  let f
  f = await fixture(undefined, async () => {
    f.resize(2560, 1400)
    return { x: 800, y: 500 }
  })
  f.fire('pointerdown', 550, 330)
  f.fire('pointermove', 1800, 700)
  f.fire('pointerup', 1800, 700)
  await settle()
  assert.equal(f.info.lastX, 800 - f.size() * 0.73)
  assert.equal(f.info.lastY, 500 - f.size() * 0.14)
})

test('a failed screen move still restores a usable pet', async () => {
  const f = await fixture(undefined, async () => { throw new Error('display removed') })
  f.fire('pointerdown', 550, 330)
  f.fire('pointermove', 1800, 1200)
  f.fire('pointerup', 1800, 1200)
  await settle()
  assert.ok(f.info.lastY + f.size() <= 898)
  assert.equal(f.warnings.length, 1)
})

test('another pointer cannot move or end the active drag', async () => {
  const f = await fixture()
  f.fire('pointerdown', 550, 330)
  f.fire('pointermove', -100, -100, 2)
  f.fire('pointerup', -100, -100, 2)
  assert.deepEqual(f.info, { lastX: 500, lastY: 300 })
  f.fire('pointermove', 800, 500)
  f.fire('pointerup', 800, 500)
  await settle()
  assert.equal(f.info.lastX, 800 - f.size() * 0.73)
})

test('native tray recovery and settings reuse existing UI actions', async () => {
  const f = await fixture()
  f.tray('recover')
  f.tray('settings')
  assert.equal(f.recovered(), 1)
  assert.equal(f.settingsOpened(), 1)
})
