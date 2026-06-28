import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import rough from 'roughjs'
import type { Id } from '@shared/types'
import { dailyDayKey } from '@shared/types'
import { DOODLE_PALETTE } from '@shared/constants'
import { useStore } from '../../store'
import { api } from '../../lib/bridge'
import { primaryField } from '../../lib/fields'
import { DialogShell } from '../../components/DialogShell'
import { DoodleButton } from '../../components/doodle/DoodleButton'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const GREEN = DOODLE_PALETTE['marker-green']
const pad = (n: number): string => String(n).padStart(2, '0')
const keyOf = (y: number, m: number, d: number): string => `${y}-${pad(m + 1)}-${pad(d)}`

/** A hand-drawn (roughjs) ring marking a day that has records. Filled = shown; hollow = hidden. */
function RoughRing({ filled }: { filled: boolean }): JSX.Element {
  const ref = useRef<SVGSVGElement>(null)
  const theme = useStore((s) => s.theme)
  useEffect(() => {
    const svg = ref.current
    if (!svg) return
    svg.innerHTML = ''
    const rc = rough.svg(svg)
    svg.appendChild(
      rc.circle(18, 18, 28, {
        roughness: 1.6,
        seed: 7, // stable sketch (no per-render dancing)
        stroke: GREEN,
        strokeWidth: 2,
        fill: filled ? GREEN : undefined,
        fillStyle: 'solid',
        fillWeight: 2
      })
    )
  }, [filled, theme])
  return (
    <svg ref={ref} viewBox="0 0 36 36" className="pointer-events-none absolute inset-0 h-full w-full" />
  )
}

/**
 * The 每日任务-历史 calendar (centered Q-bouncy modal via DialogShell). Days that have ≥1 archived
 * day-card get a hand-drawn green circle; clicking one toggles HIDING that day's cards in the lane.
 * 显示所有 / 隐藏所有 / 撤销(一步). The hidden set is persisted on the collection (hiddenDays) so the
 * lane and the calendar always agree.
 */
export function DailyHistoryCalendar({
  collectionId,
  open,
  onClose
}: {
  collectionId: Id
  open: boolean
  onClose: () => void
}): JSX.Element {
  const collection = useStore((s) => s.collectionById(collectionId))
  const allRecords = useStore((s) => s.records)
  const undo = useRef<string[] | null>(null)

  const pf = collection ? primaryField(collection) : undefined
  const pfId = pf?.id
  // day keys that HAVE >=1 history card — built from the UNFILTERED records, so a fully-hidden day
  // stays clickable in the calendar (otherwise it would vanish and could never be un-hidden).
  const recordDays = useMemo(() => {
    const set = new Set<string>()
    if (!pfId) return set
    for (const r of allRecords) {
      if (r.collectionId !== collectionId) continue
      const k = dailyDayKey(r.fields[pfId])
      if (k) set.add(k)
    }
    return set
  }, [allRecords, collectionId, pfId])

  // ----- hiddenDays as LOCAL optimistic state. A press-and-drag "paint" over many days must compute
  // each toggle SYNCHRONOUSLY: the store echo lags, so reading collection.hiddenDays mid-drag would
  // make successive toggles clobber one another. We mutate a working copy and persist ONCE per
  // gesture (so the lane's cards animate in/out in a single Q弹 batch on release). -----
  const stored = collection?.hiddenDays ?? []
  const storedKey = stored.join(',')
  const [hidden, setHidden] = useState<string[]>(stored)
  const draggingRef = useRef(false)
  const workingRef = useRef<string[]>(stored) // synchronous working copy during a drag
  // re-sync from the store when it changes externally — never mid-drag (would fight the paint)
  useEffect(() => {
    if (draggingRef.current) return
    setHidden(stored)
    workingRef.current = stored
  }, [storedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const hiddenSet = new Set(hidden)

  // one-shot ops (buttons): snapshot for the ONE-step undo, set local, persist immediately
  const commit = (next: string[]): void => {
    undo.current = hidden
    workingRef.current = next
    setHidden(next)
    void api.command('collections.update', { id: collectionId, patch: { hiddenDays: next } })
  }
  const showAll = (): void => commit([])
  const hideAll = (): void => commit([...recordDays])
  const doUndo = (): void => {
    if (undo.current === null) return
    const prev = undo.current
    undo.current = null
    workingRef.current = prev
    setHidden(prev)
    void api.command('collections.update', { id: collectionId, patch: { hiddenDays: prev } })
  }

  // press-and-drag paint: pressing a day toggles it; sliding onto a record-day toggles that one too.
  // pointerenter only fires on CROSSING into a cell (not while moving within it), so sliding back onto
  // a day re-toggles it — exactly what we want. Rings update live; the DB/lane update once on release.
  const paint = (k: string): void => {
    if (!draggingRef.current || !recordDays.has(k)) return
    const w = workingRef.current
    workingRef.current = w.includes(k) ? w.filter((x) => x !== k) : [...w, k]
    setHidden([...workingRef.current])
  }
  const startPaint = (k: string): void => {
    draggingRef.current = true
    workingRef.current = [...hidden]
    undo.current = [...hidden] // the whole drag is one undo step
    paint(k)
  }
  // end the gesture anywhere on the page → persist the accumulated working set once
  useEffect(() => {
    const onUp = (): void => {
      if (!draggingRef.current) return
      draggingRef.current = false
      void api.command('collections.update', { id: collectionId, patch: { hiddenDays: workingRef.current } })
    }
    window.addEventListener('pointerup', onUp)
    return () => window.removeEventListener('pointerup', onUp)
  }, [collectionId])

  // custom-title cards have no calendar day, so they get their own all-or-nothing switch (the 显示
  // 所有 / 隐藏所有 above only touch dated cards). One flat pair, independent of hiddenDays.
  const hideCustom = collection?.hideCustom ?? false
  const setHideCustom = (v: boolean): void => {
    void api.command('collections.update', { id: collectionId, patch: { hideCustom: v } })
  }
  const flatCls = (active: boolean): string =>
    `flex-1 rounded-[8px] border-2 border-dashed py-0 text-xs transition-colors ${
      active
        ? 'border-ink bg-marker-yellow/30'
        : 'border-ink/40 opacity-60 hover:bg-ink/5 hover:opacity-100'
    }`

  // jump to the latest record month each time the modal opens
  const latest = useMemo(() => {
    let max = ''
    for (const k of recordDays) if (k > max) max = k
    return max
  }, [recordDays])
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth() }
  })
  useEffect(() => {
    if (!open || !latest) return
    const [yy, mm] = latest.split('-').map(Number)
    setView({ y: yy, m: mm - 1 })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const { y, m } = view
  const firstDow = new Date(y, m, 1).getDay()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  const goMonth = (delta: number): void => {
    const d = new Date(y, m + delta, 1)
    setView({ y: d.getFullYear(), m: d.getMonth() })
  }

  // portal to <body>: the lane sits under framer-motion transforms (the tab container animates x) and
  // <main> clips overflow — both break a position:fixed modal. Rendering at the body root escapes them
  // so the dialog centers on the viewport like the ☰-menu dialogs.
  return createPortal(
    <DialogShell open={open} onClose={onClose} title={`${collection?.name ?? '历史'} · 日历`} width="w-[340px]">
      <div className="space-y-3 font-doodle">
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

        {/* select-none so a press-and-drag paint doesn't select the day numbers */}
        <div className="grid grid-cols-7 gap-1 select-none">
          {cells.map((d, i) => {
            if (d === null) return <div key={`b${i}`} />
            const k = keyOf(y, m, d)
            const has = recordDays.has(k)
            const isHidden = hiddenSet.has(k)
            return (
              <button
                key={d}
                type="button"
                disabled={!has}
                onPointerDown={(e) => {
                  if (!has) return
                  e.preventDefault() // no text selection / focus ring while painting
                  startPaint(k)
                }}
                onPointerEnter={() => paint(k)} // paint() self-guards on draggingRef
                className={`relative flex h-9 items-center justify-center rounded-[8px] text-sm ${
                  has ? 'cursor-pointer' : 'opacity-40'
                }`}
                title={has ? (isHidden ? '已隐藏 · 点击 / 滑过可显示这一天' : '点击 / 滑过可隐藏这一天') : undefined}
              >
                {has && <RoughRing filled={!isHidden} />}
                <span
                  className={`relative ${has && !isHidden ? 'font-bold text-[#2B2B2B]' : ''} ${
                    isHidden ? 'opacity-50' : ''
                  }`}
                >
                  {d}
                </span>
              </button>
            )
          })}
        </div>

        <div className="space-y-1.5 pt-1">
          {/* row 1: all DATED cards (calendar days) */}
          <div className="flex gap-2">
            <DoodleButton variant="default" className="flex-1" onClick={showAll}>
              显示所有
            </DoodleButton>
            <DoodleButton variant="default" className="flex-1" onClick={hideAll}>
              隐藏所有
            </DoodleButton>
          </div>
          {/* row 2: all CUSTOM-title cards (no date) — flat, sits directly under row 1 */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setHideCustom(false)} className={flatCls(!hideCustom)}>
              显示所有自定义
            </button>
            <button type="button" onClick={() => setHideCustom(true)} className={flatCls(hideCustom)}>
              隐藏所有自定义
            </button>
          </div>
          <button
            type="button"
            onClick={doUndo}
            className="w-full rounded-[8px] py-0.5 text-xs opacity-50 hover:bg-ink/5 hover:opacity-100"
          >
            ↩ 撤销
          </button>
        </div>

        <p className="text-xs leading-relaxed opacity-50">
          绿色圈 = 这一天有记录。点一下可隐藏 / 显示这一天，按住滑过多天可连续切换；上排按钮管所有「日期卡」，下排扁按钮管所有「自定义标题卡」，撤销可回退一步（针对日期）。
        </p>
      </div>
    </DialogShell>,
    document.body
  )
}
