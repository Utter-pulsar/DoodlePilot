import { useEffect, useRef, useState } from 'react'

const SENS = 6 // px of vertical drag per ±1 step (wheel feel)
const SLOP = 4 // movement under this many px is treated as a click (so typing still works)

/**
 * A hand-drawn number field with two ways to set a value:
 *   • click → place the caret and type a number (native text editing)
 *   • press and drag UP/DOWN → scrub the value like a dial (up = more, down = less)
 * A tiny drag below SLOP px stays a click, so a normal click always lets you type.
 *
 * `value` may be null (an unset field); clearing the text commits null again, so "not set"
 * stays distinct from 0.
 */
export function DoodleNumber({
  value,
  onChange,
  min,
  max,
  className = ''
}: {
  value: number | null
  onChange: (n: number | null) => void
  min?: number
  max?: number
  className?: string
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const drag = useRef<{ y: number; start: number; scrubbing: boolean } | null>(null)
  const editing = useRef(false)
  const [draft, setDraft] = useState(value == null ? '' : String(value))

  // mirror external changes (scrub / parent) into the field unless the user is typing
  useEffect(() => {
    if (!editing.current) setDraft(value == null ? '' : String(value))
  }, [value])

  const clamp = (n: number): number => {
    if (Number.isNaN(n)) return min ?? 0
    let v = n
    if (min != null) v = Math.max(min, v)
    if (max != null) v = Math.min(max, v)
    return v
  }

  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>): void => {
    if (e.button !== 0) return
    // suppress the browser's auto-focus on press; we focus on pointer-UP only when it turns
    // out to be a click (no scrub), so a drag gesture never flashes a caret
    e.preventDefault()
    drag.current = { y: e.clientY, start: value ?? min ?? 0, scrubbing: false }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLInputElement>): void => {
    const d = drag.current
    if (!d) return
    const dy = e.clientY - d.y
    if (!d.scrubbing) {
      if (Math.abs(dy) < SLOP) return // still within click slop → let it be a click
      d.scrubbing = true
      e.currentTarget.setPointerCapture(e.pointerId)
      inputRef.current?.blur() // we're scrubbing, not typing
    }
    const next = clamp(d.start + Math.round(-dy / SENS)) // drag UP → larger
    if (next !== value) {
      onChange(next)
      setDraft(String(next))
    }
  }
  const endDrag = (e: React.PointerEvent<HTMLInputElement>): void => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.scrubbing) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* capture already released */
      }
    } else {
      e.currentTarget.focus() // a plain click → enter edit mode now (auto-focus was suppressed)
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={draft}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === '') onChange(null)
        else {
          const n = parseInt(raw, 10)
          if (!Number.isNaN(n)) onChange(clamp(n))
        }
      }}
      onFocus={(e) => {
        editing.current = true
        e.currentTarget.select()
      }}
      onBlur={() => {
        editing.current = false
        if (draft.trim() === '') {
          onChange(null)
          setDraft('')
        } else {
          const n = clamp(parseInt(draft, 10))
          onChange(n)
          setDraft(String(n))
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      title="点击输入，或按住上下拖动来调节"
      className={`w-16 cursor-ns-resize select-none rounded-[8px] border-2 border-ink bg-card px-2 py-1 text-center outline-none focus:cursor-text focus:bg-marker-yellow/30 ${className}`}
    />
  )
}
