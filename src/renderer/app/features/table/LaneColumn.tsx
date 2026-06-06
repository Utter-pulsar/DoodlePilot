import { useEffect, useRef, useState } from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import type { Id } from '@shared/types'
import { useStore } from '../../store'
import { api } from '../../lib/bridge'
import { useDoodleScrollbar } from '../../lib/useDoodleScrollbar'
import { DoodleButton } from '../../components/doodle/DoodleButton'
import { RecordCard } from './RecordCard'

const DEFAULT_WIDTH = 288
const MIN_WIDTH = 220
const MAX_WIDTH = 560
// width spring (per-frame): underdamped → a little overshoot = Q弹
const STIFF = 0.2
const DAMP = 0.72

const sameSet = (a: Id[], b: Id[]): boolean => a.length === b.length && a.every((x) => b.includes(x))
const clampW = (w: number): number => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w))

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
  const records = allRecords
    .filter((r) => r.collectionId === collectionId && !r.archived)
    .sort((a, b) => (isArchive ? b.order - a.order : a.order - b.order))
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

  const rename = async (): Promise<void> => {
    const name = await useStore.getState().askPrompt('重命名分类', collection.name)
    if (name && name !== collection.name) {
      void api.command('collections.update', { id: collectionId, patch: { name } })
    }
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
        <button className="opacity-40 hover:opacity-100" title="重命名" onClick={rename}>
          ✏️
        </button>
        <button className="opacity-40 hover:opacity-100" title="删除该列" onClick={remove}>
          🗑️
        </button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pr-3">
        <Reorder.Group
          axis="y"
          values={visibleRecordIds}
          onReorder={onReorderRecords}
          as="div"
          className="space-y-3"
        >
          {visibleRecordIds.map((id, i) => (
            <SortableCard key={id} collectionId={collectionId} recordId={id} index={i} />
          ))}
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
  index
}: {
  collectionId: Id
  recordId: Id
  index: number
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
    >
      <RecordCard collectionId={collectionId} recordId={recordId} />
    </Reorder.Item>
  )
}
