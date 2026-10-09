import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { loadTs } from './load.mjs'

async function fixture(platform) {
  let native
  let quit = false
  const actions = []
  class Tray extends EventEmitter {
    constructor() { super(); native = this }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu }
    destroy() { this.destroyed = true }
  }
  const { exports } = await loadTs('src/main/tray.ts', {
    electron: {
      app: { quit: () => { quit = true } }, Tray,
      Menu: { buildFromTemplate: (menu) => menu },
      nativeImage: { createFromBuffer() {}, createFromPath() {} },
    },
    'node:fs': { readFileSync: () => Buffer.alloc(0) },
    '../shared/tray': { TRAY_STATES: {}, trayTip() {} },
    './protocol': { resourcesRoot: '/unused' },
  }, { process: { platform }, clearTimeout() {} })
  const tray = exports.createPetTray((action) => actions.push(action))
  return { native, tray, actions, didQuit: () => quit }
}

for (const platform of ['darwin', 'linux']) {
  test(platform + ' exposes native status, settings, recovery and quit actions', async () => {
    const f = await fixture(platform)
    assert.ok(f.native.menu)
    for (const [label, kind] of [['宠物状态', 'state'], ['菜单', 'menu'], ['系统设置', 'settings'], ['找回宠物', 'recover']]) {
      f.native.menu.find((item) => item.label === label).click()
      assert.equal(f.actions.at(-1).kind, kind)
    }
    f.native.menu.find((item) => item.label === '退出').click()
    assert.equal(f.didQuit(), true, 'quit must not depend on the renderer responding')
    f.tray.destroy()
    assert.equal(f.native.destroyed, true)
  })
}

test('Windows retains distinct left/right click behavior', async () => {
  const f = await fixture('win32')
  assert.equal(f.native.menu, undefined)
  f.native.emit('click', {}, { x: 10, y: 20 })
  f.native.emit('right-click', {}, { x: 30, y: 40 })
  assert.deepEqual(f.actions.map((a) => [a.kind, a.x, a.y]), [['state', 10, 20], ['menu', 30, 40]])
})
