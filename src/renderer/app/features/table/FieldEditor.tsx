import { useState } from 'react'
import type {
  ChecklistItem,
  Collection,
  DateRangeValue,
  FieldDef,
  Id,
  RecordItem,
  SelectOption
} from '@shared/types'
import { newId } from '@shared/types'
import { DOODLE_PALETTE, PALETTE_TOKENS } from '@shared/constants'
import { useStore } from '../../store'
import { api } from '../../lib/bridge'
import { DoodleNumber } from '../../components/doodle/DoodleNumber'
import { DoodleDatePicker } from '../../components/doodle/DoodleDatePicker'
import { DoodleCheckbox } from '../../components/doodle/DoodleCheckbox'

const hex = (token?: string): string => (token && DOODLE_PALETTE[token]) || '#FFD23F'
const inputCls = 'w-full rounded-[8px] border-2 border-ink bg-card px-2 py-1 outline-none'

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
  return (
    <textarea
      className={`${inputCls} min-h-[70px] resize-y`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
    />
  )
}

function DateRange({
  value,
  onCommit
}: {
  value: DateRangeValue
  onCommit: (v: DateRangeValue) => void
}): JSX.Element {
  return (
    <div className="space-y-1">
      <DoodleDatePicker
        value={value.start}
        onChange={(s) => onCommit({ ...value, start: s })}
        placeholder="开始日期"
      />
      <div className="text-center text-sm opacity-50">↓</div>
      <DoodleDatePicker
        value={value.end}
        onChange={(e) => onCommit({ ...value, end: e })}
        placeholder="结束日期"
      />
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

  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((o) => {
        const on = selected.includes(o.id)
        return (
          <button
            key={o.id}
            onClick={() => toggle(o.id)}
            className={`doodle-chip ${on ? 'text-[#2B2B2B]' : ''}`}
            style={{ backgroundColor: on ? hex(o.color) : 'transparent', opacity: on ? 1 : 0.6 }}
          >
            {o.label}
          </button>
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

  // click the status chip to cycle 待办 → 进行中 → 已完成 → …
  const cycle = (it: ChecklistItem): void => {
    if (!options.length) return
    const i = options.findIndex((o) => o.id === it.status)
    const next = options[(i + 1) % options.length].id
    onCommit(items.map((x) => (x.id === it.id ? { ...x, status: next } : x)))
  }

  return (
    <div className="space-y-1">
      {items.map((it) => {
        const opt = optOf(it.status)
        return (
          <div key={it.id} className="flex items-center gap-1">
            <button
              onClick={() => cycle(it)}
              className="doodle-chip shrink-0 text-[#2B2B2B]"
              style={{ backgroundColor: opt ? hex(opt.color) : 'transparent' }}
              title="点击切换状态"
            >
              {opt?.label ?? '状态'}
            </button>
            <input
              value={it.text}
              onChange={(e) =>
                onCommit(items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))
              }
              placeholder="任务内容…"
              className={`flex-1 rounded-[8px] border-2 border-ink bg-card px-2 py-1 outline-none ${
                isDone(it.status) ? 'line-through opacity-60' : ''
              }`}
            />
            <button
              onClick={() => onCommit(items.filter((x) => x.id !== it.id))}
              className="opacity-40 hover:opacity-100"
              title="删除任务"
            >
              🗑️
            </button>
          </div>
        )
      })}
      <button
        onClick={() => onCommit([...items, { id: newId('ck'), text: '', status: options[0]?.id }])}
        className="doodle-chip border-dashed"
      >
        ＋ 添加任务
      </button>
    </div>
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
