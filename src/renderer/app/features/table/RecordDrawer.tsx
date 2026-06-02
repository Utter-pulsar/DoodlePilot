import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, Reorder, useDragControls } from 'framer-motion'
import type { Collection, FieldDef, FieldType, Id, RecordItem } from '@shared/types'
import { useStore } from '../../store'
import { api } from '../../lib/bridge'
import { recordFields } from '../../lib/fields'
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

// ----- resizable drawer width (persisted, springy "豆腐脑" settle like the lane columns) -----
const DRAWER_WIDTH_KEY = 'doodlepilot-drawer-width'
const MIN_W = 300
const MAX_W = 680
const DEFAULT_W = 380
const STIFF = 0.2 // underdamped width spring → a little overshoot = Q弹/豆腐脑
const DAMP = 0.72
const clampW = (w: number): number => Math.max(MIN_W, Math.min(MAX_W, w))
const readDrawerWidth = (): number => {
  const v = Number(localStorage.getItem(DRAWER_WIDTH_KEY))
  return Number.isFinite(v) && v > 0 ? clampW(v) : DEFAULT_W
}
const sameSet = (a: Id[], b: Id[]): boolean => a.length === b.length && a.every((x) => b.includes(x))

export function RecordDrawer(): JSX.Element {
  const recordId = useStore((s) => s.selectedRecordId)
  const record = useStore((s) => (recordId ? s.recordById(recordId) : undefined))
  const collection = useStore((s) => (record ? s.collectionById(record.collectionId) : undefined))
  const select = useStore((s) => s.selectRecord)
  const open = !!(recordId && record && collection)
  return (
    <>
      {/* dim/click-away scrim — a PLAIN element (no exit animation), so closing removes it
          instantly and it can never linger to swallow clicks on the board behind it */}
      {open && (
        <div className="absolute inset-0 z-10 bg-ink/10" onClick={() => select(null)} />
      )}
      <AnimatePresence>
        {open && (
          <DrawerInner key="drawer" recordId={recordId} record={record} collection={collection} />
        )}
      </AnimatePresence>
    </>
  )
}

function DrawerInner({
  recordId,
  record,
  collection
}: {
  recordId: Id
  record: RecordItem
  collection: Collection
}): JSX.Element {
  const select = useStore((s) => s.selectRecord)

  // ----- resizable width with a per-frame spring (same feel as the lane resize) -----
  // Driven by DIRECT DOM mutation (not React state): re-rendering every property row each frame
  // is what made the old version lag behind the drag. The aside's width is written straight to the
  // node, so the panel tracks the cursor 1:1 and the contents reflow via CSS, no React work.
  const asideRef = useRef<HTMLElement | null>(null)
  const initialWidth = useRef(readDrawerWidth()).current
  const widthRef = useRef(initialWidth)
  const target = useRef(initialWidth)
  const vel = useRef(0)
  const raf = useRef<number | undefined>(undefined)
  const dragging = useRef(false)
  useEffect(() => () => void (raf.current !== undefined && cancelAnimationFrame(raf.current)), [])

  const applyWidth = (w: number): void => {
    widthRef.current = w
    if (asideRef.current) asideRef.current.style.width = `${w}px`
  }

  const springStep = (): void => {
    vel.current = (vel.current + (target.current - widthRef.current) * STIFF) * DAMP
    applyWidth(widthRef.current + vel.current)
    const settled =
      !dragging.current &&
      Math.abs(target.current - widthRef.current) < 0.4 &&
      Math.abs(vel.current) < 0.4
    if (settled) {
      applyWidth(Math.round(target.current))
      vel.current = 0
      raf.current = undefined
      localStorage.setItem(DRAWER_WIDTH_KEY, String(widthRef.current))
      return
    }
    raf.current = requestAnimationFrame(springStep)
  }
  const kick = (): void => {
    if (raf.current === undefined) raf.current = requestAnimationFrame(springStep)
  }
  // the handle is on the LEFT edge; since the panel is anchored right, dragging left widens it
  const startResize = (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthRef.current
    dragging.current = true
    const move = (ev: PointerEvent): void => {
      target.current = clampW(startW - (ev.clientX - startX))
      kick()
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragging.current = false
      kick() // let the spring settle (and persist) after release
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ----- per-card field order (#9): title pinned first, the rest are drag-reorderable -----
  const fields = recordFields(collection, record)
  const primary = fields.find((f) => f.primary)
  const rest = fields.filter((f) => !f.primary)
  const restIds = rest.map((f) => f.id)
  const restKey = restIds.join(',')
  const [order, setOrder] = useState<Id[]>(restIds)
  // keep local order synced with the store unless the SET of fields changed (so an optimistic
  // drag isn't clobbered by the store echo) — mirrors the lane/card reorder pattern
  useEffect(() => {
    setOrder((prev) => (sameSet(prev, restIds) ? prev : restIds))
  }, [restKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(fields.map((f) => [f.id, f]))
  const orderedRest = order.filter((id) => restIds.includes(id))
  const onReorder = (ids: Id[]): void => {
    setOrder(ids)
    const orderedFieldIds = [...(primary ? [primary.id] : []), ...ids]
    void api.command('records.reorderFields', { recordId, orderedFieldIds })
  }

  return (
    <motion.aside
      ref={asideRef}
      className="absolute right-0 top-0 z-20 flex h-full flex-col border-l-2 border-ink bg-paper shadow-doodle"
      // width applied here on (re)render reads the CURRENT animated width, so a reorder re-render
      // never snaps the panel back to its initial size; live resizing mutates the node directly
      style={{ width: widthRef.current }}
      initial={{ x: initialWidth }}
      animate={{ x: 0 }}
      exit={{ x: widthRef.current }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
    >
      {/* left-edge resize handle — data-no-pan so a drag never starts a board pan */}
      <div
        data-no-pan
        onPointerDown={startResize}
        className="absolute -left-1.5 top-0 z-30 h-full w-3 cursor-col-resize"
        title="拖动调整宽度"
      />

        <header className="flex items-center gap-2 border-b-2 border-ink/40 px-4 py-3">
          <span>{collection.icon ?? '📄'}</span>
          <span className="font-doodle opacity-70">{collection.name}</span>
          <button className="ml-auto text-xl" onClick={() => select(null)} title="关闭">
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 font-doodle">
          {primary && (
            <DrawerFieldRow
              collection={collection}
              record={record}
              recordId={recordId}
              field={primary}
              draggable={false}
            />
          )}
          <Reorder.Group
            axis="y"
            values={orderedRest}
            onReorder={onReorder}
            as="div"
            className="space-y-4"
          >
            {orderedRest.map((id, i) => {
              const f = byId.get(id)
              return f ? (
                <DrawerFieldRow
                  key={f.id}
                  index={i}
                  collection={collection}
                  record={record}
                  recordId={recordId}
                  field={f}
                  draggable
                />
              ) : null
            })}
          </Reorder.Group>

          <AddProperty recordId={recordId} />
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
    </motion.aside>
  )
}

/** One field's header (name + controls) and its editor. Non-primary rows are wrapped in a
 *  Reorder.Item — drag the property TITLE itself to reorder (no separate grip handle). */
function DrawerFieldRow({
  collection,
  record,
  recordId,
  field,
  draggable,
  index = 0
}: {
  collection: Collection
  record: RecordItem
  recordId: Id
  field: FieldDef
  draggable: boolean
  index?: number
}): JSX.Element {
  const controls = useDragControls()
  // effective card-visibility for THIS card: per-card override, else the lane default
  const ov = record.cardFieldVisible?.[field.id]
  const effVisible = ov === undefined ? !!field.showOnCard : ov

  const body = (
    <>
      <div className="mb-1 flex items-center gap-2 text-sm opacity-70">
        {draggable ? (
          <span
            onPointerDown={(e) => controls.start(e)}
            className="-mx-1 cursor-grab select-none rounded px-1 hover:bg-ink/5 active:cursor-grabbing"
            title="拖动标题可调整顺序"
          >
            {field.name}
          </span>
        ) : (
          <span>{field.name}</span>
        )}
        {field.primary && <span title="标题字段">⭐</span>}
        <span className="ml-auto flex items-center gap-2">
          {!field.primary && (
            <>
              <button
                className={`${effVisible ? 'opacity-100' : 'opacity-30'} hover:opacity-100`}
                title={effVisible ? '此卡片上已显示（点击在本卡片隐藏）' : '在本卡片上显示此属性'}
                onClick={() =>
                  void api.command('records.setFieldCardVisible', {
                    recordId,
                    fieldId: field.id,
                    visible: !effVisible
                  })
                }
              >
                👁
              </button>
              <button
                className="text-xs opacity-40 hover:opacity-100"
                title="把当前的显示 / 隐藏应用到该分类的所有卡片"
                onClick={() =>
                  void api.command('records.setFieldCardVisible', {
                    recordId,
                    fieldId: field.id,
                    visible: effVisible,
                    applyToLane: true
                  })
                }
              >
                全部
              </button>
            </>
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
              title="从这张卡片移除该属性"
              onClick={() => void api.command('records.removeField', { recordId, fieldId: field.id })}
            >
              🗑️
            </button>
          )}
        </span>
      </div>
      <FieldEditor collection={collection} record={record} field={field} />
    </>
  )

  if (!draggable) return <div>{body}</div>
  return (
    <Reorder.Item
      value={field.id}
      dragListener={false}
      dragControls={controls}
      as="div"
      // animate layout ONLY when the order index changes (a reorder); a panel-width resize keeps
      // the same index, so no layout animation fires and the contents track the drag 1:1
      layout="position"
      layoutDependency={index}
    >
      {body}
    </Reorder.Item>
  )
}

async function renameField(collectionId: Id, fieldId: Id, current: string): Promise<void> {
  const name = await useStore.getState().askPrompt('重命名属性', current)
  if (name && name !== current) {
    void api.command('collections.updateField', { collectionId, fieldId, patch: { name } })
  }
}

/** Adds a new property to JUST this card (and registers it on the lane for future cards). */
function AddProperty({ recordId }: { recordId: Id }): JSX.Element {
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
    await api.command('records.addField', {
      recordId,
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
