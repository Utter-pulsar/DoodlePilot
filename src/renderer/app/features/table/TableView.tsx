import { useEffect, useRef, useState } from 'react'
import { Reorder } from 'framer-motion'
import type { CollectionKind, FieldDef, Id } from '@shared/types'
import { newId } from '@shared/types'
import { useStore } from '../../store'
import { api } from '../../lib/bridge'
import { useElasticDrag } from '../../lib/useElasticDrag'
import { DoodleButton } from '../../components/doodle/DoodleButton'
import { DoodleBox } from '../../components/doodle/DoodleBox'
import { LaneColumn } from './LaneColumn'

const sameSet = (a: Id[], b: Id[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x))

/**
 * The Lark/Feishu-style board. Lanes reorder with an iOS-like springy drag
 * (framer-motion Reorder) and each lane is width-resizable.
 */
export function TableView(): JSX.Element {
  const collections = useStore((s) => s.collections)
  const [orderIds, setOrderIds] = useState<Id[]>([])
  const [creating, setCreating] = useState(false)
  // grab empty board space and drag left/right to pan (with Q-bouncy momentum)
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  useElasticDrag(scrollRef, innerRef, 'x')

  // sync local order with the store; keep the user's drag order unless the set changes
  useEffect(() => {
    const sorted = [...collections].sort((a, b) => a.order - b.order).map((c) => c.id)
    setOrderIds((prev) => (sameSet(prev, sorted) ? prev : sorted))
  }, [collections])

  const visibleIds = orderIds.filter((id) => collections.some((c) => c.id === id))

  const onReorder = (ids: Id[]): void => {
    setOrderIds(ids)
    void api.command('collections.reorder', { orderedIds: ids })
  }

  return (
    <div ref={scrollRef} className="h-full overflow-x-auto overflow-y-hidden">
      <div ref={innerRef} className="flex h-full items-stretch gap-4 p-4">
        <Reorder.Group
          as="div"
          axis="x"
          values={visibleIds}
          onReorder={onReorder}
          className="flex h-full items-stretch gap-4"
        >
          {visibleIds.map((id, i) => (
            <LaneColumn key={id} collectionId={id} index={i} />
          ))}
        </Reorder.Group>

        <div className="w-64 shrink-0">
          {creating ? (
            <NewLaneForm onClose={() => setCreating(false)} />
          ) : (
            <DoodleButton variant="ghost" className="w-full border-dashed" onClick={() => setCreating(true)}>
              ＋ 添加分类
            </DoodleButton>
          )}
        </div>
      </div>
    </div>
  )
}

const LANE_KINDS: { value: CollectionKind; label: string; icon: string }[] = [
  { value: 'generic', label: '普通分类', icon: '📄' },
  { value: 'weeklyTasks', label: '每周任务', icon: '📅' },
  { value: 'dailyTasks', label: '每日任务（日期 + 任务清单）', icon: '🗓️' }
]

function statusConfig() {
  const todo = { id: newId('opt'), label: '待办', color: 'marker-coral' }
  const doing = { id: newId('opt'), label: '进行中', color: 'marker-yellow' }
  const done = { id: newId('opt'), label: '已完成', color: 'marker-green' }
  return { options: [todo, doing, done], doneOptionIds: [done.id] }
}

/** Pre-built fields for the special lane kinds (generic lanes just get a default title). */
function templateFields(kind: CollectionKind): Omit<FieldDef, 'id'>[] {
  if (kind === 'dailyTasks')
    return [
      { name: '日期', type: 'text', primary: true },
      { name: '任务', type: 'checklist', config: statusConfig(), showOnCard: true }
    ]
  if (kind === 'weeklyTasks')
    return [
      { name: '本周任务', type: 'text', primary: true },
      { name: '状态', type: 'status', config: statusConfig() }
    ]
  return []
}

function NewLaneForm({ onClose }: { onClose: () => void }): JSX.Element {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CollectionKind>('generic')
  const meta = LANE_KINDS.find((k) => k.value === kind) ?? LANE_KINDS[0]

  const create = (): void => {
    void api.command('collections.create', {
      name: name.trim() || meta.label.replace(/（.*?）/, ''),
      kind,
      icon: meta.icon,
      fields: templateFields(kind)
    })
    onClose()
  }

  return (
    <DoodleBox>
      <div className="space-y-2 p-3 font-doodle">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="分类名称（如 人员 / 项目）"
          className="w-full rounded-[8px] border-2 border-ink bg-card px-2 py-1 outline-none"
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as CollectionKind)}
          className="w-full rounded-[8px] border-2 border-ink bg-card px-2 py-1"
        >
          {LANE_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <p className="text-xs opacity-60">
          列建好后，点开任意卡片可在右侧添加属性；关联属性能指向已有分类或新建分类。
        </p>
        <div className="flex gap-2">
          <DoodleButton variant="primary" onClick={create}>
            创建
          </DoodleButton>
          <DoodleButton variant="ghost" onClick={onClose}>
            取消
          </DoodleButton>
        </div>
      </div>
    </DoodleBox>
  )
}
