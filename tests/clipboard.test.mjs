import assert from 'node:assert/strict'
import test from 'node:test'
import { clock, loadTs, settle } from './load.mjs'

async function fixture(readText) {
  const timer = clock()
  const sent = []
  const { exports } = await loadTs('src/main/clipboard.ts', {
    electron: { clipboard: { readText } },
  }, timer)
  return { watch: exports.createClipboardWatcher((text) => sent.push(text)), sent, timer }
}

test('disabled clipboard watcher does not read or schedule polling', async () => {
  let reads = 0
  const f = await fixture(async () => { reads++; return 'private' })
  f.watch(false)
  await f.timer.tick()
  assert.equal(reads, 0)
  assert.equal(f.timer.timers.size, 0)
})

test('enabling takes a baseline, emits only changed nonempty text, and disabling stops reads', async () => {
  let text = 'before enabling'
  let reads = 0
  const f = await fixture(async () => { reads++; return text })
  f.watch(true)
  await settle()
  assert.deepEqual(f.sent, [])
  await f.timer.tick()
  text = 'new text'
  await f.timer.tick()
  await f.timer.tick()
  text = ' '
  await f.timer.tick()
  assert.deepEqual(f.sent, ['new text'])
  f.watch(false)
  const stoppedAt = reads
  await f.timer.tick()
  assert.equal(reads, stoppedAt)
  assert.equal(f.timer.timers.size, 0)
})

test('a read completing after disable cannot send clipboard contents', async () => {
  let finish
  let reads = 0
  const f = await fixture(() => ++reads === 1 ? Promise.resolve('baseline') : new Promise((r) => { finish = r }))
  f.watch(true)
  await settle()
  await f.timer.tick()
  await f.timer.tick()
  assert.equal(reads, 2, 'slow reads must not overlap')
  f.watch(false)
  finish('secret copied just before disabling')
  await settle()
  assert.deepEqual(f.sent, [])
})

test('re-enabling discards in-flight reads and starts a new baseline', async () => {
  let finish
  let reads = 0
  const f = await fixture(() => ++reads === 1 ? new Promise((r) => { finish = r }) : Promise.resolve('new baseline'))
  f.watch(true)
  f.watch(false)
  f.watch(true)
  await settle()
  finish('old session')
  await settle()
  await f.timer.tick()
  assert.deepEqual(f.sent, [])
  assert.equal(f.timer.timers.size, 1)
  f.watch(false)
})

test('clipboard read failure is caught and later polls can recover', async () => {
  let reads = 0
  const f = await fixture(async () => {
    if (++reads === 1) throw new Error('temporarily unavailable')
    return reads === 2 ? 'baseline' : 'changed'
  })
  f.watch(true)
  await settle()
  await f.timer.tick()
  await f.timer.tick()
  assert.deepEqual(f.sent, ['changed'])
  f.watch(false)
})
