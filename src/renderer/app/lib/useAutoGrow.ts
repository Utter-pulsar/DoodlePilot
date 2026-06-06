import { useEffect } from 'react'

/**
 * Keep a `<textarea>` sized to its wrapped content — not only when the text changes, but also when
 * its WIDTH changes. Resizing the drawer re-wraps the text into a different number of lines; a plain
 * `[value]` effect misses that, so a note typed across two lines stays pinned at two lines (clipping
 * the rest behind a hidden scroll) after the panel narrows. A ResizeObserver re-fits on every width
 * change. Height-only changes (the ones we cause by fitting) are ignored via the width guard, so
 * observing the very element we resize can't feed back into a loop.
 */
export function useAutoGrow(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = (): void => {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
    fit()
    let lastWidth = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return
      lastWidth = el.clientWidth
      fit()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, value])
}
