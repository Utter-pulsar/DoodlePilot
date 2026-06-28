import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, Reorder, useDragControls } from 'framer-motion'
import rough from 'roughjs'
import type { Collection, Id, RecordItem } from '@shared/types'
import { dailyDayKey } from '@shared/types'
import { useStore } from '../../store'
import { api } from '../../lib/bridge'
import { cssColor } from '../../lib/theme'
import { useDoodleScrollbar } from '../../lib/useDoodleScrollbar'
import { primaryField } from '../../lib/fields'
import { DoodleButton } from '../../components/doodle/DoodleButton'
import { DoodleBox } from '../../components/doodle/DoodleBox'
import { IconPicker } from '../../components/doodle/IconPicker'
import { RecordCard } from './RecordCard'
import { DailyHistoryCalendar } from './DailyHistoryCalendar'

const DEFAULT_WIDTH = 288
const MIN_WIDTH = 220
const MAX_WIDTH = 560
// width spring (per-frame): underdamped → a little overshoot = Q弹
const STIFF = 0.2
const DAMP = 0.72

const sameSet = (a: Id[], b: Id[]): boolean => a.length === b.length && a.every((x) => b.includes(x))
const clampW = (w: number): number => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w))

/** The 每日任务-历史 lane's calendar button: the doodle-font character「历」inside a hand-drawn
 *  (roughjs) ring that signals "this is a button". Sized ~ an emoji so it sits inline with the
 *  ✏️ / 🗑️ header icons, and the ring redraws on a theme flip. */
function DoodleCalIcon(): JSX.Element {
  const ref = useRef<SVGSVGElement>(null)
  const theme = useStore((s) => s.theme)
  useEffect(() => {
    const svg = ref.current
    if (!svg) return
    svg.innerHTML = ''
    const rc = rough.svg(svg)
    svg.appendChild(
      rc.circle(16, 16, 29, { roughness: 1, stroke: cssColor('--ink'), strokeWidth: 1.5, seed: 11 })
    )
  }, [theme])
  return (
    <span className="relative inline-flex h-7 w-7 items-center justify-center">
      <svg ref={ref} viewBox="0 0 32 32" className="pointer-events-none absolute inset-0 h-full w-full" />
      <span className="relative font-doodle text-[13px] font-bold leading-none">历</span>
    </span>
  )
}

export function LaneColumn({
  collectionId,
  index
}: {
  collectionId: Id
  index: number
}): JSX.Element | null {
  const collection = useStore((s) => s.collectionById(collectionId))
  // STABLE raw array selector, derive locally (avoids the zustand v5 render loop).
  const allRecords = useStore((s) => s.records)
  const controls = useDragControls()
  const [width, setWidth] = useState(collection?.width ?? DEFAULT_WIDTH)
  const widthRef = useRef(width) // animated (displayed) width
  const target = useRef(width) // where the cursor wants the divider
  const vel = useRef(0)
  const raf = useRef<number | undefined>(undefined)
  const dragging = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  useDoodleScrollbar(listRef, 'y')
  const [order, setOrder] = useState<Id[]>([])
  const [editing, setEditing] = useState(false) // lane name + icon editor open
  const [calOpen, setCalOpen] = useState(false) // 每日任务-历史 calendar modal open

  useEffect(() => {
    if (collection?.width && collection.width !== widthRef.current && raf.current === undefined) {
      widthRef.current = collection.width
      target.current = collection.width
      setWidth(collection.width)
    }
  }, [collection?.width])

  useEffect(() => () => void (raf.current !== undefined && cancelAnimationFrame(raf.current)), [])

  // history ("…-历史") lanes read newest-first: a card's `order` grows as it's archived, so the
  // most recent one (highest order) sits on top. Normal lanes stay oldest-first (ascending).
  const isArchive = collection?.kind === 'archive'
  // the 每日任务-历史 lane: always-on calendar. The ONLY thing the calendar does is HIDE whole days —
  // it never reorders. Cards keep the normal archive order (earlier-archived lower, later on top), so
  // dated and custom-title cards interleave by when they were archived, and hiding/showing a day
  // leaves the survivors' order untouched.
  const isDailyHistory = isArchive && collection?.sourceKind === 'dailyTasks'
  const pf = collection ? primaryField(collection) : undefined
  const hiddenSet = new Set(collection?.hiddenDays ?? [])
  const dayKeyOf = (r: RecordItem): string | null => (pf ? dailyDayKey(r.fields[pf.id]) : null)

  let records = allRecords.filter((r) => r.collectionId === collectionId && !r.archived)
  if (isDailyHistory) {
    const hideCustom = !!collection?.hideCustom
    records = records.filter((r) => {
      const k = dayKeyOf(r)
      if (k) return !hiddenSet.has(k) // dated card → hidden iff its day is hidden
      return !hideCustom // custom-title card → hidden iff "隐藏所有自定义" is on
    })
  }
  records = records.sort((a, b) => (isArchive ? b.order - a.order : a.order - b.order))
  const recordIds = records.map((r) => r.id)
  const idsKey = recordIds.join(',')

  // keep local card order in sync with the store unless the SET of cards changed
  // (so an optimistic drag-reorder isn't clobbered by the store echo)
  useEffect(() => {
    setOrder((prev) => (sameSet(prev, recordIds) ? prev : recordIds))
  }, [idsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!collection) return null

  const visibleRecordIds = order.filter((id) => recordIds.includes(id))

  const onReorderRecords = (ids: Id[]): void => {
    setOrder(ids)
    // `records.reorder` writes order = array index (ascending). For a newest-first history lane the
    // displayed top must get the HIGHEST order, so persist the reverse — the descending re-sort
    // above then reproduces exactly what the user dragged.
    void api.command('records.reorder', {
      collectionId,
      orderedIds: isArchive ? [...ids].reverse() : ids
    })
  }

  const remove = async (): Promise<void> => {
    const ok = await useStore.getState().askConfirm(`删除「${collection.name}」整列？其中的记录会一并删除。`)
    if (ok) void api.command('collections.delete', { id: collectionId })
  }

  // Spring the divider toward the cursor target. Neighbours follow via flex flow, so they
  // move WITH the divider (can never overlap), and the overshoot gives the Q弹 catch-up.
  const springStep = (): void => {
    vel.current = (vel.current + (target.current - widthRef.current) * STIFF) * DAMP
    widthRef.current += vel.current
    const settled =
      !dragging.current &&
      Math.abs(target.current - widthRef.current) < 0.4 &&
      Math.abs(vel.current) < 0.4
    if (settled) {
      widthRef.current = Math.round(target.current)
      vel.current = 0
      raf.current = undefined
      setWidth(widthRef.current)
      void api.command('collections.update', { id: collectionId, patch: { width: widthRef.current } })
      return
    }
    setWidth(widthRef.current)
    raf.current = requestAnimationFrame(springStep)
  }
  const kick = (): void => {
    if (raf.current === undefined) raf.current = requestAnimationFrame(springStep)
  }

  const startResize = (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthRef.current
    dragging.current = true
    const move = (ev: PointerEvent): void => {
      target.current = clampW(startW + (ev.clientX - startX))
      kick()
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragging.current = false
      kick() // let the spring settle (and commit) after release
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <Reorder.Item
      value={collectionId}
      dragListener={false}
      dragControls={controls}
      // Only animate layout when the ORDER changes (reorder). A width-resize keeps the same
      // index → no layout animation fires → neighbours follow the divider via flex flow
      // (glued, no overtaking/overlap), and the divider is driven by our width spring.
      layout="position"
      layoutDependency={index}
      as="section"
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col"
    >
      {editing ? (
        <LaneHeaderEditor collection={collection} onClose={() => setEditing(false)} />
      ) : (
        <header className="mb-2 flex items-center gap-2">
          {/* drag handle (springy reorder starts here) */}
          <span
            onPointerDown={(e) => controls.start(e)}
            className="flex flex-1 cursor-grab items-center gap-2 rounded-[8px] px-1 py-1 hover:bg-ink/5 active:cursor-grabbing"
            title="拖动可换位"
          >
            <span className="text-xl">{collection.icon ?? '📄'}</span>
            <h2 className="font-doodle text-lg font-bold">{collection.name}</h2>
            <span className="rounded-full border-2 border-ink/40 px-2 text-sm opacity-60">
              {records.length}
            </span>
          </span>
          {isDailyHistory && (
            <button
              className="shrink-0 opacity-60 hover:opacity-100"
              title="日历"
              onClick={() => setCalOpen(true)}
            >
              <DoodleCalIcon />
            </button>
          )}
          <button className="opacity-40 hover:opacity-100" title="重命名 / 改图标" onClick={() => setEditing(true)}>
            ✏️
          </button>
          <button className="opacity-40 hover:opacity-100" title="删除该列" onClick={remove}>
            🗑️
          </button>
        </header>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pr-3">
        <Reorder.Group
          axis="y"
          values={visibleRecordIds}
          onReorder={onReorderRecords}
          as="div"
          className="space-y-3"
        >
          {isDailyHistory ? (
            // wrap in AnimatePresence so hiding/showing a day springs the cards in/out (Q弹), while
            // the survivors keep their archive order (layout="position" springs them into place)
            <AnimatePresence initial={false}>
              {visibleRecordIds.map((id, i) => (
                <SortableCard key={id} collectionId={collectionId} recordId={id} index={i} bouncy />
              ))}
            </AnimatePresence>
          ) : (
            visibleRecordIds.map((id, i) => (
              <SortableCard key={id} collectionId={collectionId} recordId={id} index={i} />
            ))
          )}
        </Reorder.Group>
        <DoodleButton
          variant="ghost"
          className="mt-3 w-full border-dashed"
          onClick={() => void api.command('records.create', { collectionId })}
        >
          ＋ 新增
        </DoodleButton>
      </div>

      {/* width resize handle (right edge) — data-no-pan so it never triggers board pan. z-50 keeps
          it ABOVE the overlaid scrollbar thumb (z-40), which clips ~3px into the handle when the
          lane overflows, so a press at the very edge still resizes the column instead of scrolling. */}
      <div
        data-no-pan
        onPointerDown={startResize}
        className="absolute -right-2 top-0 z-50 h-full w-3 cursor-col-resize"
        title="拖动调整列宽"
      />

      {isDailyHistory && (
        <DailyHistoryCalendar collectionId={collectionId} open={calOpen} onClose={() => setCalOpen(false)} />
      )}
    </Reorder.Item>
  )
}

/**
 * A record card. The WHOLE card is the drag handle: tap → open details, drag → reorder
 * up/down within the lane (springy, lifts while dragging). Same feel as lane swapping.
 */
function SortableCard({
  collectionId,
  recordId,
  index,
  bouncy = false
}: {
  collectionId: Id
  recordId: Id
  index: number
  /** daily-history lane: fade the card on enter/exit (show/hide a day) and pop it via an INNER
   *  scale spring — scale on the layout item itself fights framer's transforms (see note below). */
  bouncy?: boolean
}): JSX.Element {
  // theme-aware lift shadow (light ink is invisible on a dark board, and vice versa)
  const theme = useStore((s) => s.theme)
  const dragShadow =
    theme === 'dark' ? '0 8px 16px rgba(0,0,0,0.55)' : '0 6px 14px rgba(43,43,43,0.2)'
  return (
    <Reorder.Item
      value={recordId}
      as="div"
      // animate only on card reorder (index change), not on lane-resize width changes
      layout="position"
      layoutDependency={index}
      className="cursor-grab active:cursor-grabbing"
      // NOTE: no `scale` here — animating scale on a `layout` element fights framer's
      // transform corrections and leaves a residual transform (clips an edge) + a stuck
      // shadow. Lift via non-transform props only (shadow + z).
      whileDrag={{ zIndex: 20, boxShadow: dragShadow }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      {...(bouncy
        ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0.15 } } }
        : {})}
    >
      {bouncy ? (
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 14 }}
        >
          <RecordCard collectionId={collectionId} recordId={recordId} />
        </motion.div>
      ) : (
        <RecordCard collectionId={collectionId} recordId={recordId} />
      )}
    </Reorder.Item>
  )
}

/** Inline editor for a lane's name + icon (replaces the header while open). Saves via the existing
 *  collections.update command. Hand-drawn DoodleBox, matching the new-lane form. */
function LaneHeaderEditor({
  collection,
  onClose
}: {
  collection: Collection
  onClose: () => void
}): JSX.Element {
  const [name, setName] = useState(collection.name)
  const [icon, setIcon] = useState(collection.icon ?? '📄')
  const rootRef = useRef<HTMLDivElement>(null)
  const save = (): void => {
    void api.command('collections.update', {
      id: collection.id,
      patch: { name: name.trim() || collection.name, icon: icon || '📄' }
    })
    onClose()
  }
  // click anywhere outside the editor cancels it (the IconPicker dropdown is inside, so picking an
  // emoji doesn't dismiss the form)
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [onClose])
  return (
    <div ref={rootRef} className="mb-2">
      <DoodleBox fill="--card" fillStyle="solid">
        <div className="space-y-2 p-2 font-doodle">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="分类名称"
            className="w-full rounded-[8px] border-2 border-ink bg-card px-2 py-1 outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') onClose()
            }}
          />
          <IconPicker value={icon} onChange={setIcon} />
          <div className="flex gap-2">
            <DoodleButton variant="primary" onClick={save}>
              保存
            </DoodleButton>
            <DoodleButton variant="ghost" onClick={onClose}>
              取消
            </DoodleButton>
          </div>
        </div>
      </DoodleBox>
    </div>
  )
}
