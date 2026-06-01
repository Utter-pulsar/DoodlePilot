import { useEffect, useRef, useState } from 'react'

const ITEM_H = 38
const VISIBLE = 5 // odd → a clear centre row
const PAD = (ITEM_H * (VISIBLE - 1)) / 2
const FRICTION = 0.94 // momentum decay per frame
const MIN_V = 0.5 // px/frame below which momentum ends → settle
const MAX_V = 70 // clamp flick speed
const SETTLE = 0.2 // settle lerp factor

interface Props {
  values: number[]
  value: number
  onChange: (n: number) => void
  format?: (n: number) => string
}

/**
 * iOS-style wheel (转轮): smooth 1:1 drag, flick momentum, soft snap, LIVE highlight.
 * The committed value only changes on settle/click; the scroll position is only synced
 * FROM `value` on a genuine external change (e.g. typed in the header) — so the wheel
 * never fights itself / teleports back. Hand-drawn font.
 */
export function DoodleWheel({ values, value, onChange, format }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const raf = useRef<number | undefined>(undefined)
  const programmatic = useRef(false)
  const nativeScroll = useRef(false)
  const drag = useRef<{ startY: number; startScroll: number; lastT: number; vel: number } | null>(
    null
  )
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const centerRef = useRef(Math.max(0, values.indexOf(value)))
  const [centerView, setCenterView] = useState(centerRef.current)

  const maxScroll = (values.length - 1) * ITEM_H
  const clampTop = (t: number): number => Math.min(maxScroll, Math.max(0, t))

  const cancelRaf = (): void => {
    if (raf.current !== undefined) cancelAnimationFrame(raf.current)
    raf.current = undefined
    programmatic.current = false
  }

  // update the LIVE centred index (highlight) AND commit it, so the bound display (e.g. the
  // time-picker header) tracks the wheel in real time. Committing live is safe: the `value`
  // sync effect below is guarded during drag/momentum/native-scroll, so the wheel never
  // teleports back / fights itself.
  const recenter = (): void => {
    const el = ref.current
    if (!el) return
    const i = Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)))
    if (i !== centerRef.current) {
      centerRef.current = i
      setCenterView(i)
      const v = values[i]
      if (v !== value) onChange(v)
    }
  }
  const commitFinal = (): void => {
    const v = values[centerRef.current]
    if (v !== value) onChange(v)
  }

  const settle = (): void => {
    const target = centerRef.current * ITEM_H
    programmatic.current = true
    const stepFn = (): void => {
      const el = ref.current
      if (!el) return
      const d = target - el.scrollTop
      if (Math.abs(d) < 0.5) {
        el.scrollTop = target
        cancelRaf()
        commitFinal()
        return
      }
      el.scrollTop += d * SETTLE
      raf.current = requestAnimationFrame(stepFn)
    }
    raf.current = requestAnimationFrame(stepFn)
  }

  const momentum = (v0: number): void => {
    let v = Math.max(-MAX_V, Math.min(MAX_V, v0))
    programmatic.current = true
    const stepFn = (): void => {
      const el = ref.current
      if (!el) return
      const next = clampTop(el.scrollTop + v)
      el.scrollTop = next
      recenter()
      v *= FRICTION
      if (next <= 0 || next >= maxScroll || Math.abs(v) < MIN_V) {
        cancelRaf()
        settle()
        return
      }
      raf.current = requestAnimationFrame(stepFn)
    }
    raf.current = requestAnimationFrame(stepFn)
  }

  // initial scroll position
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = centerRef.current * ITEM_H
  }, [])
  useEffect(() => () => cancelRaf(), [])

  // external value change (e.g. typed in header) → jump there; never during interaction
  useEffect(() => {
    if (drag.current || programmatic.current || nativeScroll.current) return
    const i = values.indexOf(value)
    if (i >= 0 && i !== centerRef.current) {
      centerRef.current = i
      setCenterView(i)
      if (ref.current) ref.current.scrollTop = i * ITEM_H
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = (): void => {
    if (drag.current || programmatic.current) return
    nativeScroll.current = true
    recenter()
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      nativeScroll.current = false
      settle()
    }, 120)
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 || !ref.current) return
    cancelRaf()
    ref.current.setPointerCapture(e.pointerId)
    drag.current = {
      startY: e.clientY,
      startScroll: ref.current.scrollTop,
      lastT: performance.now(),
      vel: 0
    }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const el = ref.current
    if (!drag.current || !el) return
    const newTop = clampTop(drag.current.startScroll - (e.clientY - drag.current.startY))
    const now = performance.now()
    const dt = now - drag.current.lastT
    if (dt > 0) drag.current.vel = (newTop - el.scrollTop) / dt
    el.scrollTop = newTop
    drag.current.lastT = now
    recenter()
  }
  const onPointerUp = (): void => {
    if (!drag.current) return
    const vFrame = drag.current.vel * 16
    drag.current = null
    momentum(vFrame)
  }

  return (
    <div className="relative font-doodle" style={{ height: ITEM_H * VISIBLE, width: 76 }}>
      <div
        className="pointer-events-none absolute inset-x-1 top-1/2 z-10 -translate-y-1/2 rounded-[8px] border-2 border-ink/50"
        style={{ height: ITEM_H }}
      />
      <div
        ref={ref}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="h-full cursor-grab overflow-y-scroll active:cursor-grabbing [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none' }}
      >
        <div style={{ height: PAD }} />
        {values.map((v, j) => (
          <div
            key={v}
            onClick={() => {
              cancelRaf()
              onChange(v)
            }}
            className="flex cursor-pointer items-center justify-center transition-[font-size,opacity] duration-100"
            style={{ height: ITEM_H, fontSize: j === centerView ? 26 : 18, opacity: j === centerView ? 1 : 0.4 }}
          >
            {format ? format(v) : v}
          </div>
        ))}
        <div style={{ height: PAD }} />
      </div>
    </div>
  )
}
