import { useEffect, useRef, useState } from 'react'
import rough from 'roughjs'
import { DoodleWheel } from './DoodleWheel'
import { useStore } from '../../store'
import { cssColor } from '../../lib/theme'

const SIZE = 240
const C = SIZE / 2
const NUM_R = 86
const HAND_R = 70

const pad = (n: number): string => String(n).padStart(2, '0')
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const HOURS24 = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

/** A typeable hand-drawn number field (commits on blur / Enter). */
function NumField({
  value,
  min,
  max,
  onCommit
}: {
  value: number
  min: number
  max: number
  onCommit: (n: number) => void
}): JSX.Element {
  const [text, setText] = useState(pad(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(pad(value))
  }, [value])
  const commit = (): void => {
    const n = parseInt(text, 10)
    const next = isNaN(n) ? value : clamp(n, min, max)
    onCommit(next)
    setText(pad(next))
  }
  return (
    <input
      value={text}
      inputMode="numeric"
      onFocus={(e) => {
        focused.current = true
        e.target.select()
      }}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
      onBlur={() => {
        focused.current = false
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className="w-14 rounded-[8px] border-2 border-ink bg-card text-center outline-none focus:bg-marker-yellow/40"
    />
  )
}

interface Props {
  value: string // "HH:mm" (24h)
  onChange: (value: string) => void
}

/**
 * Excalidraw-style hand-drawn clock dial. Drag the hand or tap a number; type the
 * digits directly in the header. Toggle between 24-hour and 12-hour.
 */
export function DoodleTimePicker({ value, onChange }: Props): JSX.Element {
  const [mode, setMode] = useState<'hour' | 'minute'>('hour')
  const [is24, setIs24] = useState(true)
  const svgRef = useRef<SVGSVGElement>(null)
  const faceRef = useRef<SVGGElement>(null)
  const dragging = useRef(false)
  const theme = useStore((s) => s.theme) // re-render + redraw the dial on theme change
  const ink = cssColor('--ink')
  const paper = cssColor('--paper')

  const [hhStr, mmStr] = (value || '09:00').split(':')
  const h24 = clamp(Number(hhStr) || 0, 0, 23)
  const min = clamp(Number(mmStr) || 0, 0, 59)
  const isPM = h24 >= 12
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12

  useEffect(() => {
    const svg = svgRef.current
    const g = faceRef.current
    if (!svg || !g) return
    g.innerHTML = ''
    const rc = rough.svg(svg)
    g.appendChild(
      rc.circle(C, C, 214, { roughness: 1.4, stroke: ink, strokeWidth: 2.5, fill: paper, fillStyle: 'solid' })
    )
    g.appendChild(rc.circle(C, C, 8, { roughness: 1, stroke: ink, strokeWidth: 2, fill: ink, fillStyle: 'solid' }))
  }, [is24, theme]) // redraw on dial mount + theme change

  const commit = (newH24: number, newMin: number): void => {
    onChange(`${pad((newH24 + 24) % 24)}:${pad((newMin + 60) % 60)}`)
  }
  const setHourFrom12 = (newH12: number): void => commit((newH12 % 12) + (isPM ? 12 : 0), min)

  const setFromPointer = (clientX: number, clientY: number): void => {
    const svg = svgRef.current
    if (!svg) return
    const r = svg.getBoundingClientRect()
    const dx = clientX - (r.left + r.width / 2)
    const dy = clientY - (r.top + r.height / 2)
    let ang = (Math.atan2(dx, -dy) * 180) / Math.PI
    ang = (ang + 360) % 360
    if (mode === 'hour') {
      if (is24) commit(Math.round(ang / 15) % 24, min)
      else {
        const h = Math.round(ang / 30) % 12
        setHourFrom12(h === 0 ? 12 : h)
      }
    } else {
      commit(h24, Math.round(ang / 6) % 60)
    }
  }

  const onDown = (e: React.PointerEvent): void => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    setFromPointer(e.clientX, e.clientY)
  }
  const onMove = (e: React.PointerEvent): void => {
    if (dragging.current) setFromPointer(e.clientX, e.clientY)
  }
  const onUp = (): void => {
    dragging.current = false
    if (mode === 'hour') setMode('minute')
  }

  const handAng = mode === 'minute' ? min * 6 : is24 ? h24 * 15 : (h12 % 12) * 30
  const rad = (handAng * Math.PI) / 180
  const handX = C + HAND_R * Math.sin(rad)
  const handY = C - HAND_R * Math.cos(rad)

  // ring numbers
  const count = mode === 'hour' && is24 ? 24 : 12
  const step = 360 / count
  const numbers = Array.from({ length: count }, (_, i) => {
    if (mode === 'minute') return { i, text: pad(i * 5), n: i * 5 }
    if (is24) return { i, text: pad(i), n: i } // 00..23
    return { i, text: String(i === 0 ? 12 : i), n: i === 0 ? 12 : i } // 12,1..11
  })

  return (
    <div className="flex flex-col items-center gap-3 font-doodle">
      {/* typeable digital header */}
      <div className="flex items-center gap-2 text-2xl">
        <span onFocusCapture={() => setMode('hour')} onClick={() => setMode('hour')}>
          <NumField
            value={is24 ? h24 : h12}
            min={is24 ? 0 : 1}
            max={is24 ? 23 : 12}
            onCommit={(n) => (is24 ? commit(n, min) : setHourFrom12(n))}
          />
        </span>
        <span className="text-3xl">:</span>
        <span onFocusCapture={() => setMode('minute')} onClick={() => setMode('minute')}>
          <NumField value={min} min={0} max={59} onCommit={(n) => commit(h24, n)} />
        </span>

        {!is24 && (
          <button
            onClick={() => commit((h24 + 12) % 24, min)}
            className="doodle-edge ml-1 rounded-[8px] border-2 border-ink px-2 text-base"
          >
            {isPM ? '下午' : '上午'}
          </button>
        )}
        <button
          onClick={() => setIs24((v) => !v)}
          className="doodle-edge ml-1 rounded-[8px] border-2 border-ink px-2 text-sm"
          title="切换 12/24 小时"
        >
          {is24 ? '24时' : '12时'}
        </button>
      </div>

      {is24 ? (
        // 24-hour: Apple-style scroll wheels (the clock face is cramped with 24 ticks)
        <div className="flex items-center gap-2">
          <DoodleWheel values={HOURS24} value={h24} onChange={(n) => commit(n, min)} format={pad} />
          <span className="text-3xl">:</span>
          <DoodleWheel values={MINUTES} value={min} onChange={(n) => commit(h24, n)} format={pad} />
        </div>
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-56 w-56 touch-none select-none"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          <g ref={faceRef} />
        <line x1={C} y1={C} x2={handX} y2={handY} stroke={ink} strokeWidth={3} strokeLinecap="round" />
        <circle cx={handX} cy={handY} r={9} fill="#FFD23F" stroke={ink} strokeWidth={2.5} />
        {numbers.map(({ i, text }) => {
          const a = (i * step * Math.PI) / 180
          return (
            <text
              key={i}
              x={C + NUM_R * Math.sin(a)}
              y={C - NUM_R * Math.cos(a)}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="Excalifont, Xiaolai, 'Patrick Hand', sans-serif"
              fontSize={count === 24 ? 13 : 18}
              fill={ink}
            >
              {text}
            </text>
          )
        })}
        </svg>
      )}
    </div>
  )
}
