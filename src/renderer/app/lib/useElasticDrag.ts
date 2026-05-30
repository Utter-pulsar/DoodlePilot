import { useEffect } from 'react'

// --- feel constants -------------------------------------------------------
const FRICTION = 0.94 // momentum decay per frame while in-bounds
const MIN_V = 0.4 // px/frame below which momentum stops
const MAX_V = 70 // flick speed clamp
const STIFF = 0.18 // overscroll spring stiffness (pull back to the edge)
const DAMP = 0.62 // overscroll spring damping (gives the bouncy settle)
const MAX_OVER = 100 // cap the rubber-band stretch (px); the spring bounces back from here
const SLOP = 5 // px before a press becomes a pan (so taps/clicks still work)

/**
 * Rubber-band resistance: an asymptotic curve that maps an unbounded over-drag to at most
 * MAX_OVER px. Pulling harder past the edge yields ever-smaller gains (stiffer near the cap),
 * so being already at the edge and dragging on never flings far — the bounce stays gentle.
 */
const resist = (x: number): number => MAX_OVER * (1 - 1 / (x / MAX_OVER + 1))

/** Don't hijack a press that lands on something draggable or typeable. */
function defaultCanPan(t: HTMLElement): boolean {
  return !t.closest(
    'input, textarea, button, a, select, svg, [contenteditable="true"], .cursor-grab, [data-no-pan]'
  )
}

/**
 * Adds "grab empty space and drag to scroll" to a native scroll container, with iOS-style
 * momentum and a Q-bouncy elastic overscroll. The OUTER ref is the overflow container
 * (its scrollLeft/scrollTop is driven); the INNER ref is the content, which is transformed
 * for the rubber-band stretch past the ends. Drag axis: 'x' (board) or 'y' (alarm panel).
 *
 * It coexists with framer-motion drag-reorder: a press on a `.cursor-grab` card/lane or any
 * form control is ignored (see `canPan`), so only empty space initiates a pan.
 */
export function useElasticDrag(
  scrollRef: React.RefObject<HTMLElement | null>,
  innerRef: React.RefObject<HTMLElement | null>,
  axis: 'x' | 'y',
  canPan: (t: HTMLElement) => boolean = defaultCanPan
): void {
  useEffect(() => {
    const el = scrollRef.current
    const inner = innerRef.current
    if (!el || !inner) return
    const horiz = axis === 'x'

    let raf = 0
    let armed = false // pointer is down but movement hasn't passed SLOP yet
    let dragging = false
    let startC = 0
    let lastC = 0
    let lastT = 0
    let startScroll = 0
    let pos = 0 // continuous desired scroll (may exceed bounds during overscroll)
    let vel = 0
    let pid = -1

    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
    const scrollMax = (): number =>
      horiz ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight
    const getScroll = (): number => (horiz ? el.scrollLeft : el.scrollTop)
    const setScroll = (v: number): void => {
      if (horiz) el.scrollLeft = v
      else el.scrollTop = v
    }

    const apply = (): void => {
      const max = scrollMax()
      const c = clamp(pos, 0, max)
      setScroll(c)
      // `pos` already encodes a resistance-bounded overscroll, so render it 1:1
      const over = pos - c
      inner.style.transform = over === 0 ? '' : horiz ? `translateX(${-over}px)` : `translateY(${-over}px)`
    }

    const stopRaf = (): void => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }

    const frame = (): void => {
      const max = scrollMax()
      if (pos < 0 || pos > max) {
        // overscrolled → critically-ish damped spring back to the edge (the bounce)
        const bound = pos < 0 ? 0 : max
        pos += vel
        vel += (bound - pos) * STIFF
        vel *= DAMP
        pos = clamp(pos, -MAX_OVER, max + MAX_OVER) // a hard fling can't exceed the visual cap
        if (Math.abs(pos - bound) < 0.5 && Math.abs(vel) < MIN_V) {
          pos = bound
          vel = 0
          apply()
          inner.style.transform = ''
          stopRaf()
          return
        }
      } else {
        // in bounds → momentum glide
        pos += vel
        vel *= FRICTION
        if (Math.abs(vel) < MIN_V) {
          vel = 0
          apply()
          stopRaf()
          return
        }
      }
      apply()
      raf = requestAnimationFrame(frame)
    }

    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      // ANY press in the scroll area halts a running fling and drops the rubber-band offset,
      // so a subsequent framer card/lane reorder measures clean (untransformed) geometry
      if (raf) {
        stopRaf()
        pos = getScroll()
        inner.style.transform = ''
      }
      if (scrollMax() <= 0) return // nothing to scroll on this axis
      if (!canPan(e.target as HTMLElement)) return
      armed = true
      dragging = false
      startC = horiz ? e.clientX : e.clientY
      lastC = startC
      lastT = performance.now()
      startScroll = getScroll()
      pos = startScroll
      vel = 0
      pid = e.pointerId
    }

    const onMove = (e: PointerEvent): void => {
      if (!armed) return
      const c = horiz ? e.clientX : e.clientY
      if (!dragging) {
        if (Math.abs(c - startC) < SLOP) return
        dragging = true
        try {
          el.setPointerCapture(pid)
        } catch {
          /* capture is best-effort */
        }
        el.style.cursor = 'grabbing'
      }
      const now = performance.now()
      const dt = Math.max(1, now - lastT)
      const max = scrollMax()
      const desired = startScroll - (c - startC)
      // past either edge, apply asymptotic resistance so pos stays within MAX_OVER of the bound
      if (desired < 0) pos = -resist(-desired)
      else if (desired > max) pos = max + resist(desired - max)
      else pos = desired
      vel = (-(c - lastC) / dt) * 16 // px/frame, opposite to pointer motion
      lastC = c
      lastT = now
      apply()
      e.preventDefault()
    }

    const onUp = (): void => {
      if (!armed) return
      armed = false
      el.style.cursor = ''
      try {
        el.releasePointerCapture(pid)
      } catch {
        /* may already be released */
      }
      if (dragging) {
        dragging = false
        vel = clamp(vel, -MAX_V, MAX_V)
        stopRaf()
        raf = requestAnimationFrame(frame)
      }
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      stopRaf()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.style.cursor = ''
      inner.style.transform = ''
    }
  }, [scrollRef, innerRef, axis, canPan])
}
