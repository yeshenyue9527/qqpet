import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { clock, loadTs } from './load.mjs'

const main = { id: 1, workArea: { x: 0, y: 33, width: 1512, height: 898 } }
const left = { id: 2, workArea: { x: -2560, y: -400, width: 2560, height: 1400 } }

async function fixture(displayId) {
  const saved = { settings: { displayId } }
  let displays = [main, left]
  let destination = main
  let cursor = { x: 200, y: 100 }
  const timer = clock()
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => main,
    getDisplayNearestPoint: () => destination,
    getCursorScreenPoint: () => cursor,
  })
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super()
      this.bounds = Object.fromEntries(['x', 'y', 'width', 'height'].map((k) => [k, options[k]]))
      this.webContents = Object.assign(new EventEmitter(), { send() {}, setWindowOpenHandler() {} })
    }
    getBounds() { return this.bounds }
    setBounds(bounds) { this.bounds = { ...bounds } }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() {}
    showInactive() {}
    loadURL() { return Promise.resolve() }
  }
  const { exports } = await loadTs('src/main/window.ts', {
    electron: { BrowserWindow, screen },
    '../shared/ipc': { IPC: { cursor: 'cursor' } },
    './protocol': { APP_ORIGIN: 'app://bundle' },
    './save': { getSave: () => saved, patchSave: (p) => Object.assign(saved.settings, p.settings) },
  }, { ...timer, process: { platform: 'darwin', env: {} } })
  return {
    ...exports, saved, screen, timer,
    target(display, point) { destination = display; cursor = point },
    displays(value) { displays = value },
  }
}

test('old saves start on the primary display; saved displays are restored', async () => {
  const old = await fixture()
  assert.deepEqual(old.createPetWindow().getBounds(), main.workArea)
  assert.equal(old.saved.settings.displayId, 1)
  const restored = await fixture(2)
  assert.deepEqual(restored.createPetWindow().getBounds(), left.workArea)
})

test('cross-screen drop uses display-local coordinates, including negative origins', async () => {
  const f = await fixture(1)
  const win = f.createPetWindow()
  f.target(left, { x: -2000, y: -100 })
  const p = f.movePetToCursor(win)
  assert.equal(p.x, 560)
  assert.equal(p.y, 300)
  assert.equal(f.saved.settings.displayId, 2)
  assert.deepEqual(win.getBounds(), left.workArea)
  assert.equal(f.movePetToCursor(win), null, 'same-display drops retain renderer positioning')
})

test('display removal falls back to primary and work-area changes resize the overlay', async () => {
  const f = await fixture(2)
  const win = f.createPetWindow()
  f.displays([main])
  f.screen.emit('display-removed', {}, left)
  assert.deepEqual(win.getBounds(), main.workArea)
  assert.equal(f.saved.settings.displayId, 1)
  const resized = { ...main, workArea: { x: 0, y: 33, width: 1000, height: 700 } }
  f.displays([resized])
  f.screen.emit('display-metrics-changed', {}, resized, ['workArea'])
  assert.deepEqual(win.getBounds(), resized.workArea)
  win.emit('closed')
  assert.equal(f.screen.listenerCount('display-removed'), 0)
  assert.equal(f.screen.listenerCount('display-metrics-changed'), 0)
  assert.equal(f.timer.timers.size, 0)
})

test('a disconnected saved display is repaired at launch', async () => {
  const f = await fixture(999)
  assert.deepEqual(f.createPetWindow().getBounds(), main.workArea)
  assert.equal(f.saved.settings.displayId, 1)
})

test('initial macOS show cannot leave the overlay shifted past the display edge', async () => {
  const f = await fixture(1)
  const win = f.createPetWindow()
  win.showInactive = () => { win.bounds = { ...win.bounds, x: 221 } }
  win.emit('ready-to-show')
  assert.deepEqual(win.getBounds(), main.workArea)
})

test('drop coordinates use actual window-manager-adjusted bounds', async () => {
  const f = await fixture(1)
  const win = f.createPetWindow()
  win.setBounds = (bounds) => { win.bounds = { ...bounds, y: bounds.y + 25 } }
  f.target(left, { x: -2000, y: -100 })
  assert.equal(f.movePetToCursor(win).y, 275)
})
