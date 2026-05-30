import { useState } from 'react'
import { DoodleBox } from './DoodleBox'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * A hand-drawn date field: clicking it expands an inline Rough.js calendar (matching
 * DoodleTimePicker's sketchy look) right below — no native <input type="date">, so it
 * stays in the Excalidraw style. It expands in document flow (not a popover) so it never
 * gets clipped by the scrolling drawer.
 *
 * Calendar math is done on plain integer {year, month, day} — never on a stored Date in
 * local time — so days never drift across timezones. A picked day is stored as UTC-midnight
 * ISO (e.g. 2026-05-31T00:00:00.000Z); the rest of the app shows a date via iso.slice(0,10),
 * which reads exactly those UTC digits back.
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
  const sel = value ? new Date(value) : null
  const sY = sel ? sel.getUTCFullYear() : 0
  const sM = sel ? sel.getUTCMonth() : 0
  const sD = sel ? sel.getUTCDate() : 0

  const now = new Date()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<{ y: number; m: number }>(() =>
    sel ? { y: sY, m: sM } : { y: now.getFullYear(), m: now.getMonth() }
  )
  const { y, m } = view

  const firstDow = new Date(y, m, 1).getDay() // weekday of the 1st (TZ-agnostic for layout)
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const [tY, tM, tD] = [now.getFullYear(), now.getMonth(), now.getDate()]

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const goMonth = (delta: number): void => {
    const d = new Date(y, m + delta, 1)
    setView({ y: d.getFullYear(), m: d.getMonth() })
  }
  const pick = (yy: number, mm: number, dd: number): void => {
    onChange(new Date(Date.UTC(yy, mm, dd)).toISOString())
    setOpen(false)
  }
  const label = sel ? `${sY}年${sM + 1}月${sD}日` : placeholder

  return (
    <div className="font-doodle">
      <div className="flex w-full items-center gap-2 rounded-[8px] border-2 border-ink bg-card px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 text-left outline-none"
        >
          <span>📅</span>
          <span className={sel ? '' : 'opacity-50'}>{label}</span>
        </button>
        {sel && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="px-1 opacity-40 hover:opacity-100"
            title="清除"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <DoodleBox className="mt-2" fill="--card" fillStyle="solid">
          <div className="w-[252px] space-y-2 p-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => goMonth(-1)}
                className="h-7 w-7 rounded-[8px] hover:bg-ink/10"
                title="上个月"
              >
                ‹
              </button>
              <span className="font-bold">
                {y}年{m + 1}月
              </span>
              <button
                type="button"
                onClick={() => goMonth(1)}
                className="h-7 w-7 rounded-[8px] hover:bg-ink/10"
                title="下个月"
              >
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
        </DoodleBox>
      )}
    </div>
  )
}
