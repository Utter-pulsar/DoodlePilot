import { useEffect, useRef, useState } from 'react'
import type { ChecklistItem, DateRangeValue, FieldDef, Id, RecordItem } from '@shared/types'
import { DOODLE_PALETTE } from '@shared/constants'
import { useStore } from '../../store'
import { api } from '../../lib/bridge'
import { DoodleBox } from '../../components/doodle/DoodleBox'
import { primaryField, statusOption, isDoneStatus, recordFields } from '../../lib/fields'

const paletteHex = (token?: string): string => (token && DOODLE_PALETTE[token]) || '#FFD23F'
const stop = (e: { stopPropagation: () => void }): void => e.stopPropagation()

export function RecordCard({
  collectionId,
  recordId
}: {
  collectionId: Id
  recordId: Id
}): JSX.Element | null {
  const collection = useStore((s) => s.collectionById(collectionId))
  const record = useStore((s) => s.recordById(recordId))
  const select = useStore((s) => s.selectRecord)
  const openMenu = useStore((s) => s.openCardMenu)

  const pf = collection && primaryField(collection)
  const titleValue = pf && record ? String(record.fields[pf.id] ?? '') : ''
  const [draft, setDraft] = useState(titleValue)
  const focused = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  // keep the inline title in sync with external edits (e.g. via the drawer) — unless typing
  useEffect(() => {
    if (!focused.current) setDraft(titleValue)
  }, [titleValue])
  // grow the title box to fit its wrapped text, so a long name shows in full (never clipped)
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  if (!collection || !record) return null

  const commitTitle = (): void => {
    if (pf && draft !== record.fields[pf.id]) {
      void api.command('records.update', { id: recordId, fields: { [pf.id]: draft } })
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (e.key === 'Delete') {
      e.preventDefault()
      e.stopPropagation() // prevent the global Delete handler from also firing
      void api.command('records.delete', { id: recordId })
    }
  }

  const opt = statusOption(collection, record)
  const done = isDoneStatus(collection, record)
  // fields the user pinned to show on the collapsed card (status is already shown above)
  const showFields = recordFields(collection, record).filter(
    (f) => f.showOnCard && !f.primary && f.type !== 'status'
  )

  return (
    <div
      tabIndex={0}
      className="cursor-pointer rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-marker-blue"
      onClick={() => select(recordId)}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openMenu(recordId, e.clientX, e.clientY)
      }}
    >
      <DoodleBox className="font-doodle" fill={done ? '--card-done' : '--card'}>
        <div className="space-y-2 p-3">
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => {
              focused.current = true
            }}
            onBlur={() => {
              focused.current = false
              commitTitle()
            }}
            onClick={stop}
            // Enter commits + blurs (no newline) — the title is one value that just WRAPS to show
            // in full, instead of being clipped to one line like the old <input>.
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            // stop the pointer from reaching the card's framer drag-listener, otherwise the
            // whole-card reorder swallows the click and the textarea never focuses (can't type)
            onPointerDown={(e) => e.stopPropagation()}
            placeholder="写点什么…"
            className={`w-full resize-none overflow-hidden break-words bg-transparent text-base leading-snug outline-none ${done ? 'line-through opacity-60' : ''}`}
          />

          {opt && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="doodle-chip text-[#2B2B2B]" style={{ backgroundColor: paletteHex(opt.color) }}>
                {opt.label}
              </span>
            </div>
          )}

          {showFields.length > 0 && (
            <div className="space-y-1.5" onClick={stop}>
              {showFields.map((f) => (
                <CardField key={f.id} record={record} field={f} />
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1" onClick={stop}>
            {collection.kind === 'archive' && (
              <button
                onClick={() => void api.command('records.restore', { recordId })}
                onPointerDown={(e) => e.stopPropagation()}
                className="rounded-[8px] border-2 border-ink px-2 py-0.5 text-xs hover:bg-marker-yellow/40"
              >
                ↩ 恢复
              </button>
            )}
            {collection.kind === 'dailyTasks' && (
              <button
                onClick={() => void api.command('dailyTasks.rollover', { recordId })}
                onPointerDown={(e) => e.stopPropagation()}
                className="rounded-[8px] border-2 border-ink px-2 py-0.5 text-xs hover:bg-marker-yellow/40"
                title="把这一天归档到历史，并开启第二天（未完成的任务自动带过去）"
              >
                🌙 开启第二天
              </button>
            )}
            <button
              onClick={() => select(recordId)}
              onPointerDown={(e) => e.stopPropagation()}
              className="ml-auto text-xs opacity-50 hover:opacity-100"
            >
              展开 ↗
            </button>
          </div>
        </div>
      </DoodleBox>
    </div>
  )
}

/** Read-only compact render of one field's value, for the collapsed card. */
function CardField({ record, field }: { record: RecordItem; field: FieldDef }): JSX.Element | null {
  const titleOf = useStore((s) => s.titleOf)
  const v = record.fields[field.id]
  const opts = field.config?.options ?? []

  if (field.type === 'checklist') {
    const items = Array.isArray(v) ? (v as ChecklistItem[]) : []
    if (!items.length) return null
    return (
      <div className="space-y-1">
        {items.map((it) => {
          const o = opts.find((x) => x.id === it.status)
          const isDone = !!field.config?.doneOptionIds?.includes(it.status as string)
          return (
            <div key={it.id} className="flex items-center gap-1.5 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-ink/50"
                style={{ backgroundColor: o ? paletteHex(o.color) : 'transparent' }}
                title={o?.label}
              />
              <span className={isDone ? 'line-through opacity-50' : ''}>{it.text || '—'}</span>
            </div>
          )
        })}
      </div>
    )
  }

  if (field.type === 'relation' || field.type === 'person') {
    const ids = Array.isArray(v) ? (v as Id[]) : []
    if (!ids.length) return null
    return (
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => (
          <span key={id} className="doodle-chip text-xs">
            🔗 {titleOf(id)}
          </span>
        ))}
      </div>
    )
  }

  if (field.type === 'select' || field.type === 'multiSelect') {
    const ids =
      field.type === 'multiSelect' ? (Array.isArray(v) ? (v as Id[]) : []) : v ? [v as Id] : []
    if (!ids.length) return null
    return (
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => {
          const o = opts.find((x) => x.id === id)
          return o ? (
            <span
              key={id}
              className="doodle-chip text-[#2B2B2B]"
              style={{ backgroundColor: paletteHex(o.color) }}
            >
              {o.label}
            </span>
          ) : null
        })}
      </div>
    )
  }

  if (field.type === 'checkbox') {
    return <div className="text-sm opacity-70">{field.name}：{v ? '✓' : '—'}</div>
  }

  // multi-line text shows in FULL on the card, wrapping as needed (never truncated/scrolled)
  if (field.type === 'longText') {
    const t = typeof v === 'string' ? v : ''
    return t ? <div className="whitespace-pre-wrap break-words text-sm opacity-70">{t}</div> : null
  }

  // text / url / number / date / dateRange
  let text = ''
  if (typeof v === 'string') text = field.type === 'date' ? v.slice(0, 10) : v
  else if (typeof v === 'number') text = String(v)
  else if (v && typeof v === 'object' && !Array.isArray(v) && 'start' in v) {
    const r = v as DateRangeValue
    text = `${r.start?.slice(0, 10) ?? '…'} → ${r.end?.slice(0, 10) ?? '…'}`
  }
  return text ? <div className="truncate text-sm opacity-70">{text}</div> : null
}
