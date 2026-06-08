import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, Reorder, useDragControls } from 'framer-motion'
import rough from 'roughjs'
import type {
  ChecklistItem,
  Collection,
  DateRangeValue,
  FieldConfig,
  FieldDef,
  Id,
  RecordItem,
  SelectOption
} from '@shared/types'
import { newId } from '@shared/types'
import { DOODLE_PALETTE, PALETTE_TOKENS } from '@shared/constants'
import { useStore } from '../../store'
import { api } from '../../lib/bridge'
import { cssColor } from '../../lib/theme'
import { useAutoGrow } from '../../lib/useAutoGrow'
import { DoodleNumber } from '../../components/doodle/DoodleNumber'
import {
  DoodleDatePicker,
  DateTrigger,
  DoodleCalendar
} from '../../components/doodle/DoodleDatePicker'
import { DoodleBox } from '../../components/doodle/DoodleBox'
import { DoodleCheckbox } from '../../components/doodle/DoodleCheckbox'

const hex = (token?: string): string => (token && DOODLE_PALETTE[token]) || '#FFD23F'
const inputCls = 'w-full rounded-[8px] border-2 border-ink bg-card px-2 py-1 outline-none'
const sameSet = (a: Id[], b: Id[]): boolean => a.length === b.length && a.every((x) => b.includes(x))

export function FieldEditor({
  collection,
  record,
  field
}: {
  collection: Collection
  record: RecordItem
  field: FieldDef
}): JSX.Element {
  const value = record.fields[field.id]
  const commit = (v: unknown): void => {
    void api.command('records.update', { id: record.id, fields: { [field.id]: v } })
  }

  // the title field often holds a long name — let it WRAP and auto-grow here too (matching the
  // card title), instead of clipping to one line like a plain text input.
  if (field.primary) {
    return <TextArea value={String(value ?? '')} onCommit={commit} />
  }

  switch (field.type) {
    case 'longText':
      return <TextArea value={String(value ?? '')} onCommit={commit} />
    case 'number':
      return <DoodleNumber value={typeof value === 'number' ? value : null} onChange={(n) => commit(n)} />
    case 'checkbox':
      return <DoodleCheckbox checked={!!value} onChange={(c) => commit(c)} />
    case 'date':
      return (
        <DoodleDatePicker
          value={typeof value === 'string' ? value : null}
          onChange={(iso) => commit(iso)}
        />
      )
    case 'dateRange':
      return <DateRange value={(value as DateRangeValue) ?? { start: null, end: null }} onCommit={commit} />
    case 'select':
    case 'status':
      return <SelectEditor collection={collection} field={field} value={value as Id} multi={false} onCommit={commit} />
    case 'multiSelect':
      return <SelectEditor collection={collection} field={field} value={value as Id[]} multi onCommit={commit} />
    case 'relation':
    case 'person':
      return <RelationEditor record={record} field={field} />
    case 'checklist':
      return <ChecklistEditor field={field} value={value as ChecklistItem[] | undefined} onCommit={commit} />
    case 'url':
    case 'text':
    default:
      return (
        <input
          className={inputCls}
          defaultValue={String(value ?? '')}
          onBlur={(e) => commit(e.target.value)}
        />
      )
  }
}

function TextArea({ value, onCommit }: { value: string; onCommit: (v: string) => void }): JSX.Element {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  // grow to fit ALL the text — every line stays visible and wraps, no inner scrollbar — and
  // re-fit when the panel width changes so the text re-wraps cleanly (see useAutoGrow)
  useAutoGrow(ref, draft)
  return (
    <textarea
      ref={ref}
      className={`${inputCls} min-h-[44px] resize-none overflow-hidden break-words leading-snug`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
    />
  )
}

/** A hand-drawn capillary "water droplet" bridge — wide where it clings to the field and the
 *  calendar, concave (pinched) in the middle, like liquid held by surface tension. */
function DropletBridge(): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const theme = useStore((s) => s.theme)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    svg.innerHTML = ''
    const rc = rough.svg(svg)
    const W = 44
    const H = 18
    const pinch = 13 // how far the sides curve inward (concave waist)
    const d = [
      `M3,2`,
      `L${W - 3},2`, // top edge — clings to the field
      `Q${W - pinch},${H / 2} ${W - 3},${H - 2}`, // right side curves inward
      `L3,${H - 2}`, // bottom edge — clings to the calendar
      `Q${pinch},${H / 2} 3,2`, // left side curves inward
      'Z'
    ].join(' ')
    svg.appendChild(
      rc.path(d, {
        roughness: 1.2,
        stroke: cssColor('--ink'),
        strokeWidth: 2,
        fill: cssColor('--card'),
        fillStyle: 'solid'
      })
    )
  }, [theme])
  return <svg ref={svgRef} viewBox="0 0 44 18" width="44" height="18" className="block" />
}

function DateRange({
  value,
  onCommit
}: {
  value: DateRangeValue
  onCommit: (v: DateRangeValue) => void
}): JSX.Element {
  // only ONE calendar is ever open, so it can use the full row width; clicking the other
  // field switches to it (and closes the first).
  const [active, setActive] = useState<'start' | 'end' | null>(null)
  const toggle = (k: 'start' | 'end'): void => setActive((a) => (a === k ? null : k))
  const rootRef = useRef<HTMLDivElement>(null)

  // click anywhere outside the field/calendar collapses it (with the exit animation below)
  useEffect(() => {
    if (!active) return
    const onDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setActive(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [active])

  return (
    <div ref={rootRef} className="font-doodle">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <DateTrigger
            value={value.start}
            active={active === 'start'}
            onToggle={() => toggle('start')}
            onClear={() => onCommit({ ...value, start: null })}
            placeholder="开始日期"
          />
        </div>
        <span className="pt-2 text-sm opacity-50">→</span>
        <div className="min-w-0 flex-1">
          <DateTrigger
            value={value.end}
            active={active === 'end'}
            onToggle={() => toggle('end')}
            onClear={() => onCommit({ ...value, end: null })}
            placeholder="结束日期"
          />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {active && (
          <motion.div
            key="cal"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: { type: 'spring', stiffness: 320, damping: 26 }, opacity: { duration: 0.15 } }}
            style={{ overflow: 'hidden' }}
          >
            <div className="relative pt-3">
              {/* a hand-drawn concave "water droplet" — its wide top/bottom cling to the field
                  and the calendar, pinched in the middle as if by surface tension. Slides to
                  the active field when you switch start ↔ end. */}
              <div
                className="absolute top-0 z-10 -translate-x-1/2 transition-[left] duration-200"
                style={{ left: active === 'start' ? '25%' : '75%' }}
              >
                <DropletBridge />
              </div>
              <DoodleBox fill="--card" fillStyle="solid">
                <DoodleCalendar
                  key={active}
                  value={active === 'start' ? value.start : value.end}
                  onPick={(iso) => {
                    onCommit(active === 'start' ? { ...value, start: iso } : { ...value, end: iso })
                    setActive(null)
                  }}
                />
              </DoodleBox>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SelectEditor({
  collection,
  field,
  value,
  multi,
  onCommit
}: {
  collection: Collection
  field: FieldDef
  value: Id | Id[] | undefined
  multi: boolean
  onCommit: (v: Id | Id[] | null) => void
}): JSX.Element {
  const options = field.config?.options ?? []
  const selected = multi ? ((value as Id[]) ?? []) : value ? [value as Id] : []

  const toggle = (optId: Id): void => {
    if (multi) {
      const set = new Set(selected)
      set.has(optId) ? set.delete(optId) : set.add(optId)
      onCommit([...set])
    } else {
      onCommit(selected[0] === optId ? null : optId)
    }
  }

  const addOption = async (): Promise<void> => {
    const label = await useStore.getState().askPrompt('新选项名称')
    if (!label) return
    const color = PALETTE_TOKENS[options.length % PALETTE_TOKENS.length]
    const next = [...options, { id: newId('opt'), label, color }]
    void api.command('collections.updateField', {
      collectionId: collection.id,
      fieldId: field.id,
      patch: { config: { ...field.config, options: next } }
    })
  }

  // delete a tag from the field definition (so it disappears everywhere this field is used)
  const removeOption = async (optId: Id): Promise<void> => {
    const opt = options.find((o) => o.id === optId)
    const ok = await useStore
      .getState()
      .askConfirm(`删除标签「${opt?.label ?? ''}」？该分类里所有卡片上的这个标签都会被移除。`)
    if (!ok) return
    const config: FieldConfig = { ...field.config, options: options.filter((o) => o.id !== optId) }
    if (config.doneOptionIds) config.doneOptionIds = config.doneOptionIds.filter((id) => id !== optId)
    void api.command('collections.updateField', {
      collectionId: collection.id,
      fieldId: field.id,
      patch: { config }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((o) => {
        const on = selected.includes(o.id)
        return (
          <span
            key={o.id}
            className={`doodle-chip ${on ? 'text-[#2B2B2B]' : ''}`}
            style={{ backgroundColor: on ? hex(o.color) : 'transparent', opacity: on ? 1 : 0.6 }}
          >
            <button type="button" onClick={() => toggle(o.id)} className="outline-none">
              {o.label}
            </button>
            <button
              type="button"
              onClick={() => void removeOption(o.id)}
              className="-mr-0.5 opacity-50 hover:opacity-100"
              title="删除这个标签"
            >
              ✕
            </button>
          </span>
        )
      })}
      <button onClick={addOption} className="doodle-chip border-dashed">
        ＋
      </button>
    </div>
  )
}

function ChecklistEditor({
  field,
  value,
  onCommit
}: {
  field: FieldDef
  value: ChecklistItem[] | undefined
  onCommit: (v: ChecklistItem[]) => void
}): JSX.Element {
  const items = Array.isArray(value) ? value : []
  const options = field.config?.options ?? []
  const optOf = (id?: Id): SelectOption | undefined => options.find((o) => o.id === id)
  const isDone = (id?: Id): boolean => !!field.config?.doneOptionIds?.includes(id as Id)

  // local optimistic item order (by id), so a drag-reorder isn't clobbered by the async store echo
  // before it round-trips back — mirrors the lane / card / field reorder pattern.
  const ids = items.map((it) => it.id)
  const idsKey = ids.join(',')
  const [order, setOrder] = useState<Id[]>(ids)
  useEffect(() => {
    setOrder((prev) => (sameSet(prev, ids) ? prev : ids))
  }, [idsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(items.map((it) => [it.id, it]))
  // the items in the user's optimistic order. Appends any brand-new item the local `order` hasn't
  // picked up yet (the one render before the effect resyncs) so a row can never vanish. EVERY commit
  // below maps over `view`, so editing / cycling / deleting / adding all PRESERVE the dragged order
  // instead of reverting to the store order (which the next echo would otherwise restore).
  const view: ChecklistItem[] = [
    ...order.map((id) => byId.get(id)).filter((x): x is ChecklistItem => !!x),
    ...items.filter((it) => !order.includes(it.id))
  ]

  // click the status chip to cycle 待办 → 进行中 → 已完成 → …
  const cycle = (it: ChecklistItem): void => {
    if (!options.length) return
    const i = options.findIndex((o) => o.id === it.status)
    const next = options[(i + 1) % options.length].id
    onCommit(view.map((x) => (x.id === it.id ? { ...x, status: next } : x)))
  }

  // drag a row (by its status chip) to reorder; persist the new order
  const onReorder = (newIds: Id[]): void => {
    setOrder(newIds)
    onCommit(newIds.map((id) => byId.get(id)).filter((x): x is ChecklistItem => !!x))
  }

  return (
    <div className="space-y-1">
      <Reorder.Group
        axis="y"
        values={view.map((it) => it.id)}
        onReorder={onReorder}
        as="div"
        className="space-y-1"
      >
        {view.map((it) => (
          <ChecklistItemRow
            key={it.id}
            item={it}
            opt={optOf(it.status)}
            done={isDone(it.status)}
            onCycle={() => cycle(it)}
            onChangeText={(text) =>
              onCommit(view.map((x) => (x.id === it.id ? { ...x, text } : x)))
            }
            onDelete={() => onCommit(view.filter((x) => x.id !== it.id))}
          />
        ))}
      </Reorder.Group>
      <button
        onClick={() => onCommit([...view, { id: newId('ck'), text: '', status: options[0]?.id }])}
        className="doodle-chip border-dashed"
      >
        ＋ 添加任务
      </button>
    </div>
  )
}

/**
 * One checklist row. The task text uses a LOCAL draft committed on BLUR (not on every keystroke):
 * the old per-keystroke onCommit re-rendered the parent and reset the input mid-composition, so a
 * Chinese IME leaked its pinyin buffer (typing "看"+空格 produced "kkakan看"). It's a textarea that
 * auto-grows + wraps, so a long task name shows in full instead of being clipped.
 */
function ChecklistItemRow({
  item,
  opt,
  done,
  onCycle,
  onChangeText,
  onDelete
}: {
  item: ChecklistItem
  opt: SelectOption | undefined
  done: boolean
  onCycle: () => void
  onChangeText: (text: string) => void
  onDelete: () => void
}): JSX.Element {
  const [draft, setDraft] = useState(item.text)
  const focused = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const controls = useDragControls()
  // true once a real drag started this gesture, so the pointerup-click doesn't ALSO cycle the status
  const dragged = useRef(false)
  // pull external edits in unless the user is actively typing in this row
  useEffect(() => {
    if (!focused.current) setDraft(item.text)
  }, [item.text])
  // grow to fit the wrapped text (no inner scrollbar), re-fitting on panel-width changes too
  useAutoGrow(ref, draft)

  return (
    <Reorder.Item
      value={item.id}
      dragListener={false}
      dragControls={controls}
      as="div"
      // animate only position on reorder (rows vary in height as text wraps; animating size fights
      // the auto-grow), and lift the dragged row above its neighbours
      layout="position"
      onDragStart={() => {
        dragged.current = true
      }}
      whileDrag={{ zIndex: 10, boxShadow: '0 6px 14px rgba(0,0,0,0.18)' }}
      className="flex items-start gap-1"
    >
      <button
        type="button"
        // press + drag the chip to reorder; a plain click (no drag) still cycles the status
        onPointerDown={(e) => {
          dragged.current = false
          controls.start(e)
        }}
        onClick={() => {
          if (dragged.current) return
          onCycle()
        }}
        className="doodle-chip mt-0.5 shrink-0 cursor-grab select-none text-[#2B2B2B] active:cursor-grabbing"
        style={{ backgroundColor: opt ? hex(opt.color) : 'transparent' }}
        title="点击切换状态 · 按住可拖动排序"
      >
        {opt?.label ?? '状态'}
      </button>
      <textarea
        ref={ref}
        rows={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          focused.current = false
          if (draft !== item.text) onChangeText(draft)
        }}
        placeholder="任务内容…"
        className={`min-h-[36px] flex-1 resize-none overflow-hidden break-words rounded-[8px] border-2 border-ink bg-card px-2 py-1 leading-snug outline-none ${
          done ? 'line-through opacity-60' : ''
        }`}
      />
      <button onClick={onDelete} className="mt-1.5 opacity-40 hover:opacity-100" title="删除任务">
        🗑️
      </button>
    </Reorder.Item>
  )
}

function RelationEditor({ record, field }: { record: RecordItem; field: FieldDef }): JSX.Element {
  const targetId = field.config?.targetCollectionId
  const allRecords = useStore((s) => s.records)
  const titleOf = useStore((s) => s.titleOf)
  const [adding, setAdding] = useState(false)

  const linked = (record.fields[field.id] as Id[] | undefined) ?? []
  const candidates = allRecords.filter(
    (r) => r.collectionId === targetId && !r.archived && !linked.includes(r.id)
  )

  const link = (toId: Id): void => {
    void api.command('records.link', { fromId: record.id, fieldId: field.id, toId })
    setAdding(false)
  }
  const unlink = (toId: Id): void => {
    void api.command('records.unlink', { fromId: record.id, fieldId: field.id, toId })
  }
  const createAndLink = async (): Promise<void> => {
    if (!targetId) return
    const name = await useStore.getState().askPrompt('新建并关联：名称')
    if (!name) return
    const col = useStore.getState().collectionById(targetId)
    const pf = col?.fields.find((f) => f.primary) ?? col?.fields.find((f) => f.type === 'text')
    const created = await api.command('records.create', {
      collectionId: targetId,
      fields: pf ? { [pf.id]: name } : {}
    })
    link(created.id)
  }

  if (!targetId) return <span className="text-sm opacity-60">未设置关联分类</span>

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {linked.map((id) => (
          <span key={id} className="doodle-chip bg-card">
            🔗 {titleOf(id)}
            <button onClick={() => unlink(id)} className="opacity-50 hover:opacity-100">
              ✕
            </button>
          </span>
        ))}
        <button onClick={() => setAdding((v) => !v)} className="doodle-chip border-dashed">
          ＋ 关联
        </button>
      </div>
      {adding && (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-[8px] border-2 border-ink/40 p-1">
          {candidates.map((r) => (
            <button
              key={r.id}
              onClick={() => link(r.id)}
              className="block w-full rounded px-2 py-1 text-left hover:bg-marker-yellow/40"
            >
              {titleOf(r.id)}
            </button>
          ))}
          <button
            onClick={() => void createAndLink()}
            className="block w-full rounded px-2 py-1 text-left text-marker-blue hover:bg-marker-blue/10"
          >
            ＋ 新建并关联…
          </button>
        </div>
      )}
    </div>
  )
}
