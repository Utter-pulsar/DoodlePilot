import { newId, nowISO } from '@shared/types'
import type {
  ChecklistItem,
  Collection,
  FieldDef,
  FieldValue,
  Id,
  RecordItem,
  RecordWithLinks
} from '@shared/types'
import type { AppCore } from './context'
import type { Database } from './store'

// ---- helpers --------------------------------------------------------------

const findCollection = (db: Database, id: Id): Collection | undefined =>
  db.collections.find((c) => c.id === id)

const findRecord = (db: Database, id: Id): RecordItem | undefined =>
  db.records.find((r) => r.id === id)

const isRelationField = (f: FieldDef): boolean => f.type === 'relation' || f.type === 'person'

const asIdArray = (v: FieldValue | undefined): Id[] => (Array.isArray(v) ? (v as Id[]) : [])

function nextOrder(db: Database, collectionId: Id): number {
  const items = db.records.filter((r) => r.collectionId === collectionId)
  return items.reduce((m, r) => Math.max(m, r.order + 1), 0)
}

/**
 * Find (or create) the field on `field`'s target collection that mirrors this relation back to
 * `sourceCol`. Prefers an EXISTING relation field on the target already pointing at sourceCol —
 * so a pre-existing "人员" column gets reused and filled in, instead of a duplicate appearing —
 * otherwise creates one named after sourceCol. Returns the reverse field id + whether it
 * created/paired anything (so a one-time migration can know if it must persist).
 */
function ensureReverseField(
  db: Database,
  sourceCol: Collection,
  field: FieldDef
): { id?: Id; changed: boolean } {
  const targetColId = field.config?.targetCollectionId
  if (!targetColId) return { changed: false }
  const targetCol = findCollection(db, targetColId)
  if (!targetCol) return { changed: false }

  // already paired and the partner still exists → use it
  const paired = field.config?.reverseFieldId
  if (paired && targetCol.fields.some((f) => f.id === paired)) return { id: paired, changed: false }

  let changed = false
  // reuse an existing relation field on the target that points back at the source lane
  let rev = targetCol.fields.find(
    (f) =>
      (f.type === 'relation' || f.type === 'person') &&
      f.id !== field.id &&
      f.config?.targetCollectionId === sourceCol.id &&
      (!f.config?.reverseFieldId || f.config.reverseFieldId === field.id)
  )
  if (!rev) {
    rev = {
      id: newId('fld'),
      name: sourceCol.name,
      type: 'relation',
      config: { targetCollectionId: sourceCol.id, reverseFieldId: field.id }
    }
    targetCol.fields.push(rev)
    targetCol.updatedAt = nowISO()
    changed = true
  } else if (rev.config?.reverseFieldId !== field.id) {
    rev.config = { ...rev.config, targetCollectionId: sourceCol.id, reverseFieldId: field.id }
    targetCol.updatedAt = nowISO()
    changed = true
  }
  if (field.config?.reverseFieldId !== rev.id) {
    field.config = { ...field.config, reverseFieldId: rev.id }
    sourceCol.updatedAt = nowISO()
    changed = true
  }
  return { id: rev.id, changed }
}

/**
 * Mirror a relation change onto the (auto-materialized) reverse field of each linked record, and
 * make that reverse field show up on the linked card (its per-card field set). Returns whether
 * anything changed, so the startup migration can persist only when needed.
 */
function syncReverse(
  db: Database,
  sourceCol: Collection,
  field: FieldDef,
  fromId: Id,
  before: Id[],
  after: Id[]
): boolean {
  const { id: reverseFieldId, changed: fieldChanged } = ensureReverseField(db, sourceCol, field)
  if (!reverseFieldId) return false
  let changed = fieldChanged
  const added = after.filter((id) => !before.includes(id))
  const removed = before.filter((id) => !after.includes(id))
  for (const targetId of added) {
    const target = findRecord(db, targetId)
    if (!target) continue
    let touched = false
    const cur = asIdArray(target.fields[reverseFieldId])
    if (!cur.includes(fromId)) {
      target.fields[reverseFieldId] = [...cur, fromId]
      touched = true
    }
    // surface the reverse field on the linked card without touching other cards
    if (target.fieldIds && !target.fieldIds.includes(reverseFieldId)) {
      target.fieldIds.push(reverseFieldId)
      touched = true
    }
    if (touched) {
      target.updatedAt = nowISO()
      changed = true
    }
  }
  for (const targetId of removed) {
    const target = findRecord(db, targetId)
    if (!target) continue
    const cur = asIdArray(target.fields[reverseFieldId])
    if (cur.includes(fromId)) {
      target.fields[reverseFieldId] = cur.filter((id) => id !== fromId)
      target.updatedAt = nowISO()
      changed = true
    }
  }
  return changed
}

// ---- registration ---------------------------------------------------------

export function registerCollectionService(core: AppCore): void {
  const { store, queries, commands, events, hooks } = core

  // One-time migration for DBs written before per-card field sets + two-way relation
  // materialization existed. Idempotent: it persists only when it actually changes something,
  // so later launches are a no-op. Mutates the live snapshot directly, then flushes if dirty.
  ;(function migrate(): void {
    const db = store.data
    let dirty = false
    // 1) give every legacy record an explicit field set = its lane's current fields
    for (const r of db.records) {
      if (!r.fieldIds) {
        const col = findCollection(db, r.collectionId)
        r.fieldIds = col ? col.fields.map((f) => f.id) : Object.keys(r.fields)
        dirty = true
      }
    }
    // 2) materialize reverse links for relations created before two-way materialization
    for (const r of db.records) {
      const col = findCollection(db, r.collectionId)
      if (!col) continue
      for (const f of col.fields) {
        if (!isRelationField(f)) continue
        const vals = asIdArray(r.fields[f.id])
        if (vals.length && syncReverse(db, col, f, r.id, [], vals)) dirty = true
      }
    }
    if (dirty) store.flush()
  })()

  // ===== queries =====
  queries.register('collections.list', () =>
    [...store.data.collections].sort((a, b) => a.order - b.order)
  )
  queries.register('collections.get', ({ id }) => findCollection(store.data, id) ?? null)

  queries.register('records.list', ({ collectionId, includeArchived }) =>
    store.data.records
      .filter((r) => r.collectionId === collectionId && (includeArchived || !r.archived))
      .sort((a, b) => a.order - b.order)
  )
  queries.register('records.get', ({ id }) => findRecord(store.data, id) ?? null)

  queries.register('records.withLinks', ({ id }): RecordWithLinks | null => {
    const record = findRecord(store.data, id)
    if (!record) return null
    // backlinks: every record whose relation/person field points back at `id`
    const groups = new Map<string, { collectionId: Id; fieldId: Id; records: RecordItem[] }>()
    for (const c of store.data.collections) {
      for (const f of c.fields) {
        if (!isRelationField(f)) continue
        for (const r of store.data.records) {
          if (r.collectionId !== c.id) continue
          if (asIdArray(r.fields[f.id]).includes(id)) {
            const key = `${c.id}:${f.id}`
            if (!groups.has(key)) groups.set(key, { collectionId: c.id, fieldId: f.id, records: [] })
            groups.get(key)!.records.push(r)
          }
        }
      }
    }
    return { record, backlinks: [...groups.values()] }
  })

  // ===== collection commands =====
  commands.register('collections.create', ({ name, kind = 'generic', icon, fields = [] }) => {
    const col: Collection = {
      id: newId('col'),
      name,
      icon,
      kind,
      order: store.data.collections.length,
      fields: fields.map((f) => ({ ...f, id: newId('fld') })),
      createdAt: nowISO(),
      updatedAt: nowISO()
    }
    if (!col.fields.some((f) => f.primary)) {
      col.fields.unshift({ id: newId('fld'), name: '名称', type: 'text', primary: true })
    }
    store.mutate((db) => db.collections.push(col))
    events.emit('collections.changed', store.data.collections)
    return col
  })

  commands.register('collections.update', ({ id, patch }) => {
    const col = findCollection(store.data, id)
    if (!col) throw new Error(`collection ${id} not found`)
    store.mutate(() => Object.assign(col, patch, { updatedAt: nowISO() }))
    events.emit('collections.changed', store.data.collections)
    return col
  })

  commands.register('collections.delete', ({ id }) => {
    store.mutate((db) => {
      db.collections = db.collections.filter((c) => c.id !== id)
      db.records = db.records.filter((r) => r.collectionId !== id)
    })
    events.emit('collections.changed', store.data.collections)
  })

  commands.register('collections.reorder', ({ orderedIds }) => {
    store.mutate((db) => {
      orderedIds.forEach((id, i) => {
        const c = db.collections.find((x) => x.id === id)
        if (c) c.order = i
      })
    })
    events.emit('collections.changed', store.data.collections)
  })

  commands.register('collections.addField', ({ collectionId, field }) => {
    const col = findCollection(store.data, collectionId)
    if (!col) throw new Error(`collection ${collectionId} not found`)
    store.mutate(() => {
      col.fields.push({ ...field, id: newId('fld') })
      col.updatedAt = nowISO()
    })
    events.emit('collections.changed', store.data.collections)
    return col
  })

  commands.register('collections.updateField', ({ collectionId, fieldId, patch }) => {
    const col = findCollection(store.data, collectionId)
    const field = col?.fields.find((f) => f.id === fieldId)
    if (!col || !field) throw new Error('field not found')
    store.mutate(() => {
      Object.assign(field, patch)
      col.updatedAt = nowISO()
    })
    events.emit('collections.changed', store.data.collections)
    return col
  })

  commands.register('collections.removeField', ({ collectionId, fieldId }) => {
    const col = findCollection(store.data, collectionId)
    if (!col) throw new Error(`collection ${collectionId} not found`)
    store.mutate((db) => {
      col.fields = col.fields.filter((f) => f.id !== fieldId)
      col.updatedAt = nowISO()
      for (const r of db.records) if (r.collectionId === collectionId) delete r.fields[fieldId]
    })
    events.emit('collections.changed', store.data.collections)
    return col
  })

  // ===== record commands =====
  commands.register('records.create', async ({ collectionId, fields = {} }) => {
    const col = findCollection(store.data, collectionId)
    if (!col) throw new Error(`collection ${collectionId} not found`)
    const hooked = await hooks.run('record.beforeCreate', { collectionId, fields })
    if (hooked.vetoed) throw new Error(`record creation vetoed by ${hooked.vetoedBy}`)

    const rec: RecordItem = {
      id: newId('rec'),
      collectionId,
      fields: hooked.value.fields as Record<Id, FieldValue>,
      // a new card inherits ALL of the lane's current fields; later additions only reach newer cards
      fieldIds: col.fields.map((f) => f.id),
      archived: false,
      order: nextOrder(store.data, collectionId),
      createdAt: nowISO(),
      updatedAt: nowISO()
    }
    store.mutate((db) => db.records.push(rec))
    events.emit('records.changed', { collectionId })
    return rec
  })

  commands.register('records.update', ({ id, fields, patch }) => {
    const rec = findRecord(store.data, id)
    if (!rec) throw new Error(`record ${id} not found`)
    const col = findCollection(store.data, rec.collectionId)
    store.mutate(() => {
      if (fields) {
        for (const [fieldId, value] of Object.entries(fields)) {
          const field = col?.fields.find((f) => f.id === fieldId)
          if (col && field && isRelationField(field)) {
            const before = asIdArray(rec.fields[fieldId])
            const after = asIdArray(value as FieldValue)
            rec.fields[fieldId] = after
            syncReverse(store.data, col, field, rec.id, before, after)
          } else {
            rec.fields[fieldId] = value as FieldValue
          }
        }
      }
      if (patch) Object.assign(rec, patch)
      rec.updatedAt = nowISO()
    })
    events.emit('records.changed', { collectionId: rec.collectionId })
    return rec
  })

  commands.register('records.delete', ({ id }) => {
    const rec = findRecord(store.data, id)
    if (!rec) return
    store.mutate((db) => {
      db.records = db.records.filter((r) => r.id !== id)
      // clean up any links pointing at the deleted record
      for (const r of db.records) {
        for (const key of Object.keys(r.fields)) {
          const v = r.fields[key]
          if (Array.isArray(v)) r.fields[key] = (v as Id[]).filter((x) => x !== id)
        }
      }
    })
    events.emit('records.changed', { collectionId: rec.collectionId })
  })

  // Archiving moves the card into a per-lane "<lane>-历史" collection (created on demand,
  // appended at the end). The history lane clones the source fields (SAME ids) so the
  // archived values still resolve. No single global archive lane.
  commands.register('records.archive', ({ id }) => {
    const rec = findRecord(store.data, id)
    if (!rec) throw new Error(`record ${id} not found`)
    const sourceCol = findCollection(store.data, rec.collectionId)
    if (!sourceCol) throw new Error('source collection not found')
    if (sourceCol.kind === 'archive') return rec // already in a history lane
    const fromId = rec.collectionId
    const historyName = `${sourceCol.name}-历史`
    store.mutate((db) => {
      let history = db.collections.find((c) => c.name === historyName && c.kind === 'archive')
      if (!history) {
        history = {
          id: newId('col'),
          name: historyName,
          icon: '📦',
          kind: 'archive',
          order: db.collections.length,
          fields: sourceCol.fields.map((f) => ({ ...f })),
          createdAt: nowISO(),
          updatedAt: nowISO()
        }
        db.collections.push(history)
      }
      const hid = history.id
      rec.collectionId = hid
      rec.archivedFrom = fromId
      rec.archived = false
      rec.order = db.records.filter((r) => r.collectionId === hid && r.id !== rec.id).length
      rec.updatedAt = nowISO()
    })
    events.emit('collections.changed', store.data.collections)
    events.emit('records.changed', { collectionId: fromId })
    events.emit('records.changed', { collectionId: rec.collectionId })
    return rec
  })

  // restore a "<lane>-历史" card back to its source lane (the inverse of archive)
  commands.register('records.restore', ({ recordId }) => {
    const rec = findRecord(store.data, recordId)
    if (!rec) throw new Error(`record ${recordId} not found`)
    const col = findCollection(store.data, rec.collectionId)
    if (!col || col.kind !== 'archive') return rec
    const fromId = rec.collectionId
    store.mutate((db) => {
      // prefer the recorded source lane id; fall back to matching by name; finally recreate it
      let target = rec.archivedFrom
        ? db.collections.find((c) => c.id === rec.archivedFrom)
        : undefined
      if (!target) {
        const sourceName = col.name.replace(/-历史$/, '')
        target = db.collections.find((c) => c.name === sourceName && c.kind !== 'archive')
      }
      if (!target) {
        target = {
          id: newId('col'),
          name: col.name.replace(/-历史$/, '') || '恢复',
          icon: '📄',
          kind: 'generic',
          order: db.collections.length,
          fields: col.fields.map((f) => ({ ...f })),
          createdAt: nowISO(),
          updatedAt: nowISO()
        }
        db.collections.push(target)
      }
      const tid = target.id
      rec.collectionId = tid
      rec.archived = false
      rec.archivedFrom = undefined
      rec.order = db.records.filter((r) => r.collectionId === tid && r.id !== rec.id).length
      rec.updatedAt = nowISO()
    })
    events.emit('collections.changed', store.data.collections)
    events.emit('records.changed', { collectionId: fromId })
    events.emit('records.changed', { collectionId: rec.collectionId })
    return rec
  })

  // one-tap "start tomorrow": archive today's day-card (all tasks + statuses) into the
  // "<lane>-历史" lane, then create the next day pre-filled with the unfinished tasks.
  commands.register('dailyTasks.rollover', ({ recordId }) => {
    const rec = findRecord(store.data, recordId)
    if (!rec) throw new Error(`record ${recordId} not found`)
    const col = findCollection(store.data, rec.collectionId)
    if (!col || col.kind !== 'dailyTasks') return
    const fromId = rec.collectionId
    const checklist = col.fields.find((f) => f.type === 'checklist')
    const doneIds = checklist?.config?.doneOptionIds ?? []
    const items = checklist && Array.isArray(rec.fields[checklist.id])
      ? (rec.fields[checklist.id] as ChecklistItem[])
      : []
    const carry: ChecklistItem[] = items
      .filter((it) => !doneIds.includes(it.status as Id))
      .map((it) => ({ id: newId('ck'), text: it.text, status: it.status }))
    const dateField = col.fields.find((f) => f.primary)

    store.mutate((db) => {
      const historyName = `${col.name}-历史`
      let history = db.collections.find((c) => c.name === historyName && c.kind === 'archive')
      if (!history) {
        history = {
          id: newId('col'),
          name: historyName,
          icon: '📦',
          kind: 'archive',
          order: db.collections.length,
          fields: col.fields.map((f) => ({ ...f })),
          createdAt: nowISO(),
          updatedAt: nowISO()
        }
        db.collections.push(history)
      }
      const hid = history.id
      rec.collectionId = hid
      rec.archivedFrom = fromId
      rec.archived = false
      rec.order = db.records.filter((r) => r.collectionId === hid && r.id !== rec.id).length
      rec.updatedAt = nowISO()

      const next: RecordItem = {
        id: newId('rec'),
        collectionId: fromId,
        fields: {
          ...(dateField ? { [dateField.id]: '' } : {}),
          ...(checklist ? { [checklist.id]: carry } : {})
        },
        fieldIds: col.fields.map((f) => f.id),
        archived: false,
        order: db.records.filter((r) => r.collectionId === fromId).length,
        createdAt: nowISO(),
        updatedAt: nowISO()
      }
      db.records.push(next)
    })
    events.emit('collections.changed', store.data.collections)
    events.emit('records.changed', { collectionId: fromId })
  })

  commands.register('records.reorder', ({ collectionId, orderedIds }) => {
    store.mutate((db) => {
      orderedIds.forEach((id, i) => {
        const r = db.records.find((x) => x.id === id)
        if (r && r.collectionId === collectionId) r.order = i
      })
    })
    events.emit('records.changed', { collectionId })
  })

  const linkOp = (fromId: Id, fieldId: Id, toId: Id, add: boolean): void => {
    const from = findRecord(store.data, fromId)
    const col = from && findCollection(store.data, from.collectionId)
    const field = col?.fields.find((f) => f.id === fieldId)
    if (!from || !col || !field) throw new Error('link: record/field not found')
    store.mutate(() => {
      const before = asIdArray(from.fields[fieldId])
      const after = add
        ? before.includes(toId)
          ? before
          : [...before, toId]
        : before.filter((x) => x !== toId)
      from.fields[fieldId] = after
      from.updatedAt = nowISO()
      syncReverse(store.data, col, field, fromId, before, after)
    })
    events.emit('records.changed', { collectionId: from.collectionId })
  }

  commands.register('records.link', ({ fromId, fieldId, toId }) => linkOp(fromId, fieldId, toId, true))
  commands.register('records.unlink', ({ fromId, fieldId, toId }) =>
    linkOp(fromId, fieldId, toId, false)
  )

  // ===== per-card field set =====
  // add a brand-new field to the lane registry AND attach it to just this one card. New cards
  // (which inherit the whole registry) get it too; existing cards are untouched.
  commands.register('records.addField', ({ recordId, field }) => {
    const rec = findRecord(store.data, recordId)
    if (!rec) throw new Error(`record ${recordId} not found`)
    const col = findCollection(store.data, rec.collectionId)
    if (!col) throw new Error('collection not found')
    store.mutate(() => {
      const base = rec.fieldIds ?? col.fields.map((f) => f.id) // this card's set BEFORE adding
      const newField: FieldDef = { ...field, id: newId('fld') }
      col.fields.push(newField)
      col.updatedAt = nowISO()
      rec.fieldIds = [...base, newField.id]
      rec.updatedAt = nowISO()
    })
    events.emit('collections.changed', store.data.collections)
    events.emit('records.changed', { collectionId: rec.collectionId })
    return rec
  })

  // drop a field from THIS card only (delete its value too). If no card in the lane uses the
  // field anymore, garbage-collect its definition so future cards stop inheriting it.
  commands.register('records.removeField', ({ recordId, fieldId }) => {
    const rec = findRecord(store.data, recordId)
    if (!rec) throw new Error(`record ${recordId} not found`)
    const col = findCollection(store.data, rec.collectionId)
    store.mutate((db) => {
      const def = col?.fields.find((f) => f.id === fieldId)
      // a relation: dissolve this card's links through it, cleaning BOTH sides symmetrically so
      // the other lane is never left pointing back at a link this card no longer has
      if (col && def && isRelationField(def)) {
        const before = asIdArray(rec.fields[fieldId])
        if (before.length) syncReverse(db, col, def, rec.id, before, [])
      }
      const base = rec.fieldIds ?? (col ? col.fields.map((f) => f.id) : Object.keys(rec.fields))
      rec.fieldIds = base.filter((id) => id !== fieldId)
      delete rec.fields[fieldId]
      rec.updatedAt = nowISO()
      // GC a PLAIN field's definition once no card in the lane still uses it (keep the title
      // field), so future cards stop inheriting it. Relation fields are deliberately NOT GC'd:
      // dropping one half of a two-way pair could strand its partner on the other lane.
      if (col && def && !def.primary && !isRelationField(def)) {
        // a legacy record (no fieldIds) implicitly still uses every field, so keep it then
        const stillUsed = db.records.some(
          (r) => r.collectionId === col.id && (r.fieldIds ? r.fieldIds.includes(fieldId) : true)
        )
        if (!stillUsed) {
          col.fields = col.fields.filter((f) => f.id !== fieldId)
          col.updatedAt = nowISO()
        }
      }
    })
    events.emit('collections.changed', store.data.collections)
    events.emit('records.changed', { collectionId: rec.collectionId })
    return rec
  })

  // ===== semantic task action =====
  commands.register('task.complete', async ({ recordId }) => {
    const rec = findRecord(store.data, recordId)
    if (!rec) throw new Error(`record ${recordId} not found`)
    const col = findCollection(store.data, rec.collectionId)

    const before = await hooks.run('task.beforeComplete', rec)
    if (before.vetoed) {
      events.emit('toast', { kind: 'error', message: `任务完成被拦截（${before.vetoedBy}）` })
      return rec
    }

    store.mutate(() => {
      const statusField = col?.fields.find((f) => f.type === 'status')
      const doneId = statusField?.config?.doneOptionIds?.[0]
      if (statusField && doneId) rec.fields[statusField.id] = doneId
      rec.updatedAt = nowISO()
    })

    await hooks.run('task.afterComplete', rec)
    events.emit('records.changed', { collectionId: rec.collectionId })
    return rec
  })
}
