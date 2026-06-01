import { useState } from 'react'
import { DoodleBox } from './DoodleBox'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * UTC date parts for a two-line label — "2026年" on top, "5月30日" below — so a narrow field
 * reads cleanly in two lines without a slash. A picked day is stored as UTC-midnight ISO.
 */
function dateParts(iso: string): { year: number; md: string } {
  const d = new Date(iso)
  return { year: d.getUTCFullYear(), md: `${d.getUTCMonth() + 1}月${d.getUTCDate()}日` }
}

/** The clickable date field (📅 + label + clear). `active` highlights the one whose calendar is open. */
export function DateTrigger({
  value,
  placeholder = '选择日期',
  active = false,
  onToggle,
  onClear
}: {
  value: string | null
  placeholder?: string
  active?: boolean
  onToggle: () => void
  onClear?: () => void
}): JSX.Element {
  const parts = value ? dateParts(value) : null
  return (
    <div
      className={`flex w-full items-center gap-2 rounded-[8px] border-2 border-ink px-2 py-1 transition-colors ${
        active ? 'bg-marker-yellow/30' : 'bg-card'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
      >
        <span className="shrink-0">📅</span>
        {parts ? (
          <span className="flex flex-col leading-tight">
            <span>{parts.year}年</span>
            <span>{parts.md}</span>
          </span>
        ) : (
          <span className="opacity-50">{placeholder}</span>
        )}
      </button>
      {value && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 px-1 opacity-40 hover:opacity-100"
          title="清除"
        >
          ✕
        </button>
      )}
    </div>
  )
}

/**
 * The hand-drawn month grid (no native <input type="date">). Calendar math runs on plain
 * integer {y, m, d} — never a stored Date in local time — so days never drift across
 * timezones. `onPick` receives a UTC-midnight ISO; the rest of the app reads iso.slice(0,10).
 * Width is driven by the parent so it can be full-width inside a date-range row.
 */
export function DoodleCalendar({
  value,
  onPick
}: {
  value: string | null
  onPick: (iso: string) => void
}): JSX.Element {
  const sel = value ? new Date(value) : null
  const sY = sel ? sel.getUTCFullYear() : 0
  const sM = sel ? sel.getUTCMonth() : 0
  const sD = sel ? sel.getUTCDate() : 0

  const now = new Date()
  const [view, setView] = useState<{ y: number; m: number }>(() =>
    sel ? { y: sY, m: sM } : { y: now.getFullYear(), m: now.getMonth() }
  )
  const { y, m } = view

  const firstDow = new Date(y, m, 1).getDay()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const [tY, tM, tD] = [now.getFullYear(), now.getMonth(), now.getDate()]

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const goMonth = (delta: number): void => {
    const d = new Date(y, m + delta, 1)
    setView({ y: d.getFullYear(), m: d.getMonth() })
  }
  const pick = (yy: number, mm: number, dd: number): void => onPick(new Date(Date.UTC(yy, mm, dd)).toISOString())

  return (
    <div className="space-y-2 p-3 font-doodle">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => goMonth(-1)} className="h-7 w-7 rounded-[8px] hover:bg-ink/10" title="上个月">
          ‹
        </button>
        <span className="font-bold">
          {y}年{m + 1}月
        </span>
        <button type="button" onClick={() => goMonth(1)} className="h-7 w-7 rounded-[8px] hover:bg-ink/10" title="下个月">
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs opacity-50">
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} />
          const isSel = !!sel && y === sY && m === sM && d === sD
          const isToday = y === tY && m === tM && d === tD
          return (
            <button
              key={d}
              type="button"
              onClick={() => pick(y, m, d)}
              className={`h-8 rounded-[8px] border-2 text-sm transition-colors ${
                isSel
                  ? 'border-ink bg-marker-yellow text-[#2B2B2B]'
                  : isToday
                    ? 'border-dashed border-ink/50 hover:bg-ink/5'
                    : 'border-transparent hover:bg-ink/5'
              }`}
            >
              {d}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => {
          setView({ y: tY, m: tM })
          pick(tY, tM, tD)
        }}
        className="w-full rounded-[8px] py-1 text-xs opacity-60 hover:bg-ink/5 hover:opacity-100"
      >
        今天
      </button>
    </div>
  )
}

/**
 * A single date field: trigger + an inline calendar that expands right below it (document
 * flow, so it never gets clipped by the scrolling drawer). For a start/end range, use two
 * DateTriggers + one shared DoodleCalendar instead (see FieldEditor's DateRange).
 */
export function DoodleDatePicker({
  value,
  onChange,
  placeholder = '选择日期'
}: {
  value: string | null
  onChange: (iso: string | null) => void
  placeholder?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="font-doodle">
      <DateTrigger
        value={value}
        placeholder={placeholder}
        active={open}
        onToggle={() => setOpen((o) => !o)}
        onClear={() => onChange(null)}
      />
      {open && (
        <DoodleBox className="mt-2" fill="--card" fillStyle="solid">
          <div className="w-[252px]">
            <DoodleCalendar
              value={value}
              onPick={(iso) => {
                onChange(iso)
                setOpen(false)
              }}
            />
          </div>
        </DoodleBox>
      )}
    </div>
  )
}
