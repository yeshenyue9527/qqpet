import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

/** Execute the real module with only its platform/DOM boundaries replaced. */
export async function loadTs(path, mocks, globals = {}) {
  const context = createContext({ console, Buffer, process, ...globals })
  const url = new URL('../' + path, import.meta.url)
  const source = await readFile(url, 'utf8')
  const module = new SourceTextModule(stripTypeScriptTypes(source), {
    context,
    initializeImportMeta(meta) { meta.dirname = dirname(fileURLToPath(url)); meta.url = url.href },
  })
  await module.link(async (name) => {
    const values = mocks[name] ?? (name.startsWith('node:') ? await import(name) : null)
    if (!values) throw new Error('Unmocked dependency: ' + name)
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  return { exports: module.namespace, context }
}

export const settle = () => new Promise(setImmediate)

export function clock() {
  const timers = new Map()
  let id = 0
  return {
    timers,
    setInterval(fn) { timers.set(++id, fn); return id },
    clearInterval(id) { timers.delete(id) },
    async tick() {
      for (const fn of [...timers.values()]) fn()
      await settle()
    },
  }
}
