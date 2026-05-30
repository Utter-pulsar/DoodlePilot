import { useEffect, useState } from 'react'
import type { FieldType, Id } from '@shared/types'
import type { RecordWithLinks } from '@shared/types'
import { useStore } from '../../store'
import { api } from '../../lib/bridge'
import { DoodleButton } from '../../components/doodle/DoodleButton'
import { FieldEditor } from './FieldEditor'

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'longText', label: '多行文本' },
  { value: 'number', label: '数字' },
  { value: 'status', label: '状态' },
  { value: 'checklist', label: '任务清单' },
  { value: 'select', label: '单选标签' },
  { value: 'multiSelect', label: '多选标签' },
  { value: 'date', label: '日期' },
  { value: 'dateRange', label: '日期区间' },
  { value: 'checkbox', label: '勾选' },
  { value: 'url', label: '链接' },
  { value: 'relation', label: '关联' }
]

// short, plain-language explanation of each type (shown under the type picker)
const FIELD_TYPE_HINTS: Record<FieldType, string> = {
  text: '一行文字',
  longText: '一大段文字',
  number: '数字，可点击输入或按住上下拖动调节',
  status: '带“完成”含义的状态，如 待办 / 进行中 / 已完成',
  checklist: '一组小任务，每条都能单独选状态',
  select: '从一组彩色标签里只选 1 个',
  multiSelect: '从一组彩色标签里选多个',
  date: '一个日期',
  dateRange: '一段时间：开始日期 → 结束日期',
  checkbox: '打勾 / 不打勾',
  url: '一个可点击的网址',
  relation: '关联到另一个分类里的卡片',
  person: '关联人员'
}

export function RecordDrawer(): JSX.Element | null {
  const recordId = useStore((s) => s.selectedRecordId)
  const select = useStore((s) => s.selectRecord)
  const record = useStore((s) => (recordId ? s.recordById(recordId) : undefined))
  const collection = useStore((s) => (record ? s.collectionById(record.collectionId) : undefined))
  const titleOf = useStore((s) => s.titleOf)
  const [links, setLinks] = useState<RecordWithLinks | null>(null)

  useEffect(() => {
    if (!recordId) return setLinks(null)
    void api.query('records.withLinks', { id: recordId }).then(setLinks)
  }, [recordId, record?.updatedAt])

  if (!recordId || !record || !collection) return null

  return (
    <>
      <div className="absolute inset-0 z-10 bg-ink/10" onClick={() => select(null)} />
      <aside className="absolute right-0 top-0 z-20 flex h-full w-[380px] flex-col border-l-2 border-ink bg-paper shadow-doodle">
        <header className="flex items-center gap-2 border-b-2 border-ink/40 px-4 py-3">
          <span>{collection.icon ?? '📄'}</span>
          <span className="font-doodle opacity-70">{collection.name}</span>
          <button className="ml-auto text-xl" onClick={() => select(null)} title="关闭">
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 font-doodle">
          {collection.fields.map((field) => (
            <div key={field.id}>
              <div className="mb-1 flex items-center gap-2 text-sm opacity-70">
                <span>{field.name}</span>
                {field.primary && <span title="标题字段">⭐</span>}
                <span className="ml-auto flex items-center gap-2">
                  {!field.primary && (
                    <button
                      className={`${field.showOnCard ? 'opacity-100' : 'opacity-30'} hover:opacity-100`}
                      title={field.showOnCard ? '已在卡片显示（点击隐藏）' : '在卡片上显示此属性'}
                      onClick={() =>
                        void api.command('collections.updateField', {
                          collectionId: collection.id,
                          fieldId: field.id,
                          patch: { showOnCard: !field.showOnCard }
                        })
                      }
                    >
                      👁
                    </button>
                  )}
                  <button
                    className="opacity-40 hover:opacity-100"
                    title="重命名属性"
                    onClick={() => void renameField(collection.id, field.id, field.name)}
                  >
                    ✏️
                  </button>
                  {!field.primary && (
                    <button
                      className="opacity-40 hover:opacity-100"
                      title="删除属性"
                      onClick={() =>
                        void api.command('collections.removeField', {
                          collectionId: collection.id,
                          fieldId: field.id
                        })
                      }
                    >
                      🗑️
                    </button>
                  )}
                </span>
              </div>
              <FieldEditor collection={collection} record={record} field={field} />
            </div>
          ))}

          <AddProperty collectionId={collection.id} />

          {links && links.backlinks.length > 0 && (
            <div className="border-t-2 border-dashed border-ink/30 pt-3">
              <div className="mb-1 text-sm opacity-70">被这些引用：</div>
              {links.backlinks.map((g) => {
                const fromCol = useStore.getState().collectionById(g.collectionId)
                const fromField = fromCol?.fields.find((f) => f.id === g.fieldId)
                return (
                  <div key={`${g.collectionId}:${g.fieldId}`} className="mb-2">
                    <div className="text-xs opacity-50">
                      {fromCol?.name} · {fromField?.name}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {g.records.map((r) => (
                        <button key={r.id} className="doodle-chip bg-card" onClick={() => select(r.id)}>
                          🔗 {titleOf(r.id)}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <footer className="flex gap-2 border-t-2 border-ink/40 p-3">
          <DoodleButton variant="primary" onClick={() => select(null)} title="内容已自动保存，关闭面板">
            ✓ 完成
          </DoodleButton>
          {collection.kind === 'archive' ? (
            <DoodleButton
              onClick={() => void api.command('records.restore', { recordId }).then(() => select(null))}
            >
              ↩ 恢复
            </DoodleButton>
          ) : (
            <DoodleButton
              onClick={() => void api.command('records.archive', { id: recordId }).then(() => select(null))}
            >
              📦 归档
            </DoodleButton>
          )}
          <DoodleButton
            className="ml-auto"
            onClick={() => void api.command('records.delete', { id: recordId }).then(() => select(null))}
          >
            🗑️ 删除
          </DoodleButton>
        </footer>
      </aside>
    </>
  )
}

async function renameField(collectionId: Id, fieldId: Id, current: string): Promise<void> {
  const name = await useStore.getState().askPrompt('重命名属性', current)
  if (name && name !== current) {
    void api.command('collections.updateField', { collectionId, fieldId, patch: { name } })
  }
}

function AddProperty({ collectionId }: { collectionId: Id }): JSX.Element {
  const collections = useStore((s) => s.collections)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const [target, setTarget] = useState<string>('') // existing collection id, or '__new__'

  const isRelation = type === 'relation' || type === 'person'

  const submit = async (): Promise<void> => {
    const fieldName = name.trim() || '新属性'
    let targetCollectionId: Id | undefined
    if (isRelation) {
      if (target === '__new__') {
        const newName = await useStore.getState().askPrompt('新建关联分类名称', fieldName)
        if (!newName) return
        const created = await api.command('collections.create', { name: newName, kind: 'generic' })
        targetCollectionId = created.id
      } else {
        targetCollectionId = target || collections[0]?.id
      }
    }
    await api.command('collections.addField', {
      collectionId,
      field: {
        name: fieldName,
        type,
        ...(isRelation ? { config: { targetCollectionId } } : {})
      }
    })
    setName('')
    setType('text')
    setTarget('')
    setOpen(false)
  }

  if (!open) {
    return (
      <DoodleButton variant="ghost" className="w-full border-dashed" onClick={() => setOpen(true)}>
        ＋ 添加属性
      </DoodleButton>
    )
  }

  return (
    <div className="space-y-2 rounded-[10px] border-2 border-ink/40 p-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="属性名称"
        className="w-full rounded-[8px] border-2 border-ink bg-card px-2 py-1 outline-none"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as FieldType)}
        className="w-full rounded-[8px] border-2 border-ink bg-card px-2 py-1"
      >
        {FIELD_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <p className="px-1 text-xs opacity-60">{FIELD_TYPE_HINTS[type]}</p>
      {isRelation && (
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="w-full rounded-[8px] border-2 border-ink bg-card px-2 py-1"
        >
          <option value="">选择关联分类…</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new__">＋ 新建分类…</option>
        </select>
      )}
      <div className="flex gap-2">
        <DoodleButton variant="primary" onClick={() => void submit()}>
          添加
        </DoodleButton>
        <DoodleButton variant="ghost" onClick={() => setOpen(false)}>
          取消
        </DoodleButton>
      </div>
    </div>
  )
}
