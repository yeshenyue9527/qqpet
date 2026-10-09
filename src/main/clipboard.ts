import { clipboard } from 'electron'

/** No reads while disabled; restarting takes a fresh baseline without replaying old clipboard contents. */
export function createClipboardWatcher(onText: (text: string) => void): (enabled: boolean) => void {
  let stop = (): void => {}
  return (enabled) => {
    stop()
    if (!enabled) return
    let active = true
    let reading = false
    let copied: string | undefined
    const poll = async (): Promise<void> => {
      if (reading) return
      reading = true
      try {
        const text = await clipboard.readText()
        if (!active) return
        const previous = copied
        copied = text
        if (previous !== undefined && text !== previous && text.trim()) onText(text)
      } catch {
        // A temporarily unavailable clipboard must not stop future polls.
      } finally {
        reading = false
      }
    }
    const timer = setInterval(() => void poll(), 500)
    stop = () => {
      active = false
      clearInterval(timer)
    }
    void poll()
  }
}
