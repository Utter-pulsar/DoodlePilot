import { newId, nowISO, isDailyDate, todayUTCMidnightISO, addDaysUTCISO } from '@shared/types'
import type {
  ChecklistItem,
  Collection,
  FieldDef,
  FieldValue,
  Id,
  RecordItem,
  RecordWithLinks,
  SelectOption
} from '@shared/types'
import type { AppCore } from './context'
import type { Database } from './store'

// ---- helpers --------------------------------------------------------------

const findCollection = (db: Database, id: Id): Collection | undefined =>
  db.collections.find((c) => c.id === id)

const findRecord = (db: Database, id: Id): RecordItem | undefined =>
  db.records.find((r) => r.id === id)

const isRelationField = (f: FieldDef): boolean => f.type === 'relation' || f.type === 'person'

// a "（历史）" mirror field (carries historyOfFieldId): a frozen snapshot of archived links. The
// two-way sync engine must never touch it (see archive ⇄ history mirroring below).
const isMirrorField = (f: FieldDef): boolean => !!f.config?.historyOfFieldId

const asIdArray = (v: FieldValue | undefined): Id[] => (Array.isArray(v) ? (v as Id[]) : [])

function nextOrder(db: Database, collectionId: Id): number {
  const items = db.records.filter((r) => r.collectionId === collectionId)
  return items.reduce((m, r) => Math.max(m, r.order + 1), 0)
}

/**
 * A brand-new checklist field needs working statuses out of the box. Unlike a `status` field you
 * can't add checklist options from the UI, so without them the status chip is an un-clickable grey
 * "状态". Seed the same 待办 / 进行中 / 已完成 set the first-launch seed uses (fresh option ids, so
 * each field owns its own), with 已完成 as the "done" status that rollover drops. Other field types
 * and any checklist that already carries options are returned untouched.
 */
function withChecklistDefaults<T extends Omit<FieldDef, 'id'>>(field: T): T {
  if (field.type !== 'checklist' || field.config?.options?.length) return field
  const todo: SelectOption = { id: newId('opt'), label: '待办', color: 'marker-coral' }
  const doing: SelectOption = { id: newId('opt'), label: '进行中', color: 'marker-yellow' }
  const done: SelectOption = { id: newId('opt'), label: '已完成', color: 'marker-green' }
  return {
    ...field,
    config: { ...field.config, options: [todo, doing, done], doneOptionIds: [done.id] }
  }
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
  // a frozen "（历史）" mirror is never two-way synced (it would resurrect/erase archived links)
  if (isMirrorField(field)) return false
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

// ---- archive ⇄ "（历史）" relation mirroring -------------------------------
// When a linked record is archived, its id moves from the LIVE relation field into an auto-created
// "…（历史）" MIRROR field on the linking card (and back on restore). A mirror is a frozen snapshot:
// it carries `config.historyOfFieldId`, so the two-way sync engine + the startup backfill must
// leave it alone (never materialize a reverse, never re-sync its links — that would corrupt the
// archived record's own frozen relations on every restart).

/** Find (or create) the "（历史）" mirror of `liveField` ON ITS OWN collection `col`, pointed at the
 *  history lane the archived targets now live in. Paired with the live field by id (so renaming the
 *  live field never breaks the link). The mirror inherits the live field's card visibility. */
function ensureMirrorField(col: Collection, liveField: FieldDef, historyColId: Id): FieldDef {
  let mf = liveField.config?.historyFieldId
    ? col.fields.find((f) => f.id === liveField.config!.historyFieldId)
    : undefined
  if (!mf) mf = col.fields.find((f) => f.config?.historyOfFieldId === liveField.id)
  if (!mf) {
    mf = {
      id: newId('fld'),
      name: `${liveField.name}（历史）`,
      type: liveField.type,
      showOnCard: liveField.showOnCard,
      config: { targetCollectionId: historyColId, historyOfFieldId: liveField.id }
    }
    col.fields.push(mf)
    col.updatedAt = nowISO()
  } else if (mf.config?.targetCollectionId !== historyColId || mf.config?.historyOfFieldId !== liveField.id) {
    mf.config = { ...mf.config, targetCollectionId: historyColId, historyOfFieldId: liveField.id }
    col.updatedAt = nowISO()
  }
  if (liveField.config?.historyFieldId !== mf.id) {
    liveField.config = { ...liveField.config, historyFieldId: mf.id }
    col.updatedAt = nowISO()
  }
  return mf
}

/** Record `recordId` was just archived (now sitting in `historyColId`). For every LIVE relation that
 *  points at it, move it into that field's "（历史）" mirror (raw splices — NEVER syncReverse, so the
 *  archived record's own reverse links stay frozen). Returns the set of touched source lane ids. */
function historizeLinks(db: Database, recordId: Id, historyColId: Id): Set<Id> {
  const touched = new Set<Id>()
  for (const col of db.collections) {
    for (const f of col.fields) {
      if (!isRelationField(f) || isMirrorField(f)) continue
      for (const s of db.records) {
        if (s.collectionId !== col.id) continue
        const vals = asIdArray(s.fields[f.id])
        if (!vals.includes(recordId)) continue
        const mf = ensureMirrorField(col, f, historyColId)
        s.fields[f.id] = vals.filter((id) => id !== recordId)
        const mfVals = asIdArray(s.fields[mf.id])
        if (!mfVals.includes(recordId)) s.fields[mf.id] = [...mfVals, recordId]
        if (s.fieldIds && !s.fieldIds.includes(mf.id)) s.fieldIds.push(mf.id)
        s.updatedAt = nowISO()
        touched.add(s.collectionId)
      }
    }
  }
  return touched
}

/** Inverse of historizeLinks: `recordId` was restored, so move it back out of every "（历史）" mirror
 *  into the live field it shadows (additive — the user may have edited the live field meanwhile). An
 *  emptied mirror is dropped from that card's field set so no blank "（历史）" property lingers. */
function dehistorizeLinks(db: Database, recordId: Id): Set<Id> {
  const touched = new Set<Id>()
  for (const col of db.collections) {
    for (const mf of col.fields) {
      if (!isMirrorField(mf)) continue
      const liveId = mf.config?.historyOfFieldId
      for (const s of db.records) {
        if (s.collectionId !== col.id) continue
        const mfVals = asIdArray(s.fields[mf.id])
        if (!mfVals.includes(recordId)) continue
        const nextMf = mfVals.filter((id) => id !== recordId)
        s.fields[mf.id] = nextMf
        if (liveId) {
          const live = asIdArray(s.fields[liveId])
          if (!live.includes(recordId)) s.fields[liveId] = [...live, recordId]
        }
        // tidy a now-empty mirror off this card (re-added next time something is archived)
        if (nextMf.length === 0) {
          delete s.fields[mf.id]
          if (s.fieldIds) s.fieldIds = s.fieldIds.filter((id) => id !== mf.id)
        }
        s.updatedAt = nowISO()
        touched.add(s.collectionId)
      }
    }
  }
  return touched
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
      // Skip archived records: their live relation fields are a FROZEN snapshot (kept so restore
      // can rebuild the links). Re-syncing them here would re-materialize the reverse onto the
      // linking card's LIVE field — resurrecting a link that archive had moved into its "（历史）"
      // mirror, so it shows in BOTH the current and history buckets after a reload.
      if (col.kind === 'archive') continue
      for (const f of col.fields) {
        if (!isRelationField(f) || isMirrorField(f)) continue // never re-sync a frozen mirror
        const vals = asIdArray(r.fields[f.id])
        if (vals.length && syncReverse(db, col, f, r.id, [], vals)) dirty = true
      }
    }
    // 2b) heal DBs already corrupted by the pre-fix backfill: an id historized into a "（历史）"
    // mirror must NOT also sit in the live field it shadows (live ⇄ mirror are mutually exclusive —
    // archive moves an id from one to the other, restore moves it back). Drop any such duplicate
    // from the live side so the link shows only under history. Never touches the mirror or the
    // archived record's own frozen links, so restore keeps working.
    for (const r of db.records) {
      const col = findCollection(db, r.collectionId)
      if (!col) continue
      for (const mf of col.fields) {
        if (!isMirrorField(mf)) continue
        const liveId = mf.config?.historyOfFieldId
        if (!liveId) continue
        const mirrored = asIdArray(r.fields[mf.id])
        if (!mirrored.length) continue
        const live = asIdArray(r.fields[liveId])
        const cleaned = live.filter((id) => !mirrored.includes(id))
        if (cleaned.length !== live.length) {
          r.fields[liveId] = cleaned
          r.updatedAt = nowISO()
          dirty = true
        }
      }
    }
    // 3) collapse PLAIN fields a lane accidentally duplicated (the pre-fix addField minted a fresh
    //    field per card, so a new card inherited several identical-named columns). Keep the first,
    //    repoint every record's value + fieldIds + per-card visibility to it, drop the rest. The
    //    title field and relations (identity = the link pair, not the name) are left untouched.
    for (const col of db.collections) {
      const canonOf = new Map<string, Id>() // `${name} ${type}` → kept field id
      const remap = new Map<Id, Id>() // duplicate field id → kept field id
      col.fields = col.fields.filter((f) => {
        if (f.primary || isRelationField(f)) return true
        const key = `${f.name} ${f.type}`
        const canon = canonOf.get(key)
        if (canon === undefined) {
          canonOf.set(key, f.id)
          return true
        }
        remap.set(f.id, canon)
        return false
      })
      if (!remap.size) continue
      dirty = true
      col.updatedAt = nowISO()
      for (const r of db.records) {
        if (r.collectionId !== col.id) continue
        for (const [dupId, canon] of remap) {
          if (dupId in r.fields) {
            const cur = r.fields[canon]
            if (cur === undefined || cur === null || cur === '') r.fields[canon] = r.fields[dupId]
            delete r.fields[dupId]
          }
          if (r.cardFieldVisible && dupId in r.cardFieldVisible) {
            if (!(canon in r.cardFieldVisible)) r.cardFieldVisible[canon] = r.cardFieldVisible[dupId]
            delete r.cardFieldVisible[dupId]
          }
        }
        if (r.fieldIds) {
          const next: Id[] = []
          for (const id of r.fieldIds) {
            const mapped = remap.get(id) ?? id
            if (!next.includes(mapped)) next.push(mapped)
          }
          r.fieldIds = next
        }
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
        if (!isRelationField(f) || isMirrorField(f)) continue
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
      col.fields.push({ ...withChecklistDefaults(field), id: newId('fld') })
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
      // a new card inherits ALL of the lane's current fields, EXCEPT auto "（历史）" mirrors (those
      // attach only to a card that actually had a link archived); later additions only reach newer cards
      fieldIds: col.fields.filter((f) => !isMirrorField(f)).map((f) => f.id),
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
          if (col && field && isRelationField(field) && !isMirrorField(field)) {
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
    let touched = new Set<Id>()
    store.mutate((db) => {
      let history = db.collections.find((c) => c.name === historyName && c.kind === 'archive')
      if (!history) {
        history = {
          id: newId('col'),
          name: historyName,
          icon: '📦',
          kind: 'archive',
          sourceKind: sourceCol.kind,
          order: db.collections.length,
          fields: sourceCol.fields.map((f) => ({ ...f })),
          createdAt: nowISO(),
          updatedAt: nowISO()
        }
        db.collections.push(history)
      } else if (!history.sourceKind) {
        history.sourceKind = sourceCol.kind
      }
      const hid = history.id
      rec.collectionId = hid
      rec.archivedFrom = fromId
      rec.archived = false
      rec.order = db.records.filter((r) => r.collectionId === hid && r.id !== rec.id).length
      rec.updatedAt = nowISO()
      // an archived record's live links become "（历史）" attributes on the cards that linked it
      touched = historizeLinks(db, rec.id, hid)
    })
    events.emit('collections.changed', store.data.collections)
    events.emit('records.changed', { collectionId: fromId })
    events.emit('records.changed', { collectionId: rec.collectionId })
    for (const cid of touched) events.emit('records.changed', { collectionId: cid })
    return rec
  })

  // restore a "<lane>-历史" card back to its source lane (the inverse of archive)
  commands.register('records.restore', ({ recordId }) => {
    const rec = findRecord(store.data, recordId)
    if (!rec) throw new Error(`record ${recordId} not found`)
    const col = findCollection(store.data, rec.collectionId)
    if (!col || col.kind !== 'archive') return rec
    const fromId = rec.collectionId
    let touched = new Set<Id>()
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
      // a restored record's "（历史）" attributes move back to the live link on the cards that hold them
      touched = dehistorizeLinks(db, rec.id)
    })
    events.emit('collections.changed', store.data.collections)
    events.emit('records.changed', { collectionId: fromId })
    events.emit('records.changed', { collectionId: rec.collectionId })
    for (const cid of touched) events.emit('records.changed', { collectionId: cid })
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
    // carry the UNFINISHED tasks of EVERY checklist property this card has (not just the first), each
    // into its own fresh items — so a day with several task lists rolls them all over, done removed.
    const recFieldIds = rec.fieldIds ?? col.fields.map((f) => f.id)
    const checklistFields = col.fields.filter(
      (f) => f.type === 'checklist' && recFieldIds.includes(f.id)
    )
    const carryByField = new Map<Id, ChecklistItem[]>()
    for (const cl of checklistFields) {
      const doneIds = cl.config?.doneOptionIds ?? []
      const items = Array.isArray(rec.fields[cl.id]) ? (rec.fields[cl.id] as ChecklistItem[]) : []
      carryByField.set(
        cl.id,
        items
          .filter((it) => !doneIds.includes(it.status as Id))
          .map((it) => ({ id: newId('ck'), text: it.text, status: it.status }))
      )
    }
    const dateField = col.fields.find((f) => f.primary)
    // the new day's date = (this card's date, if it has one) + 1 day, else tomorrow. Stored as a
    // UTC-midnight ISO so the calendar/title reads it as a real date; still editable in the drawer.
    const curDate = dateField ? rec.fields[dateField.id] : undefined
    const nextDate = addDaysUTCISO(isDailyDate(curDate) ? curDate : todayUTCMidnightISO(), 1)
    let touched = new Set<Id>()

    store.mutate((db) => {
      const historyName = `${col.name}-历史`
      let history = db.collections.find((c) => c.name === historyName && c.kind === 'archive')
      if (!history) {
        history = {
          id: newId('col'),
          name: historyName,
          icon: '📦',
          kind: 'archive',
          sourceKind: col.kind,
          order: db.collections.length,
          fields: col.fields.map((f) => ({ ...f })),
          createdAt: nowISO(),
          updatedAt: nowISO()
        }
        db.collections.push(history)
      } else if (!history.sourceKind) {
        history.sourceKind = col.kind
      }
      const hid = history.id
      rec.collectionId = hid
      rec.archivedFrom = fromId
      rec.archived = false
      rec.order = db.records.filter((r) => r.collectionId === hid && r.id !== rec.id).length
      rec.updatedAt = nowISO()
      touched = historizeLinks(db, rec.id, hid)

      const nextFields: Record<Id, FieldValue> = {}
      if (dateField) nextFields[dateField.id] = nextDate
      for (const [fid, carry] of carryByField) nextFields[fid] = carry
      const next: RecordItem = {
        id: newId('rec'),
        collectionId: fromId,
        fields: nextFields,
        // mirror the rolled-over day's own property set, so a card-specific second task list (and any
        // other added properties) reappears on the new day instead of being dropped
        fieldIds: [...recFieldIds],
        archived: false,
        order: db.records.filter((r) => r.collectionId === fromId).length,
        createdAt: nowISO(),
        updatedAt: nowISO()
      }
      db.records.push(next)
    })
    events.emit('collections.changed', store.data.collections)
    events.emit('records.changed', { collectionId: fromId })
    for (const cid of touched) events.emit('records.changed', { collectionId: cid })
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
      // Reuse an existing PLAIN field with the same name+type instead of minting a duplicate. A
      // lane is one set of columns: adding "岗位" to several cards must converge on ONE field, so
      // a later-created card inherits a single "岗位" — not one copy per card (the old bug). Two-way
      // relations are exempt (their identity is the link pair, not the name).
      const isRel = field.type === 'relation' || field.type === 'person'
      const existing = isRel
        ? undefined
        : col.fields.find((f) => !isRelationField(f) && f.name === field.name && f.type === field.type)
      let fieldId: Id
      if (existing) {
        fieldId = existing.id
      } else {
        const newField: FieldDef = { ...withChecklistDefaults(field), id: newId('fld') }
        col.fields.push(newField)
        fieldId = newField.id
      }
      col.updatedAt = nowISO()
      rec.fieldIds = base.includes(fieldId) ? [...base] : [...base, fieldId]
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
      if (rec.cardFieldVisible) delete rec.cardFieldVisible[fieldId]
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

  // reorder THIS card's own fields (per-card order = RecordItem.fieldIds). The title/primary field
  // is always pinned first (the card render + recordFields() force it to the front anyway).
  commands.register('records.reorderFields', ({ recordId, orderedFieldIds }) => {
    const rec = findRecord(store.data, recordId)
    if (!rec) throw new Error(`record ${recordId} not found`)
    const col = findCollection(store.data, rec.collectionId)
    store.mutate(() => {
      const current = rec.fieldIds ?? (col ? col.fields.map((f) => f.id) : Object.keys(rec.fields))
      const has = new Set(current)
      // honour the requested order, but only for ids this card actually has; append anything the
      // client left out so a field can never silently vanish.
      const next = orderedFieldIds.filter((id) => has.has(id))
      for (const id of current) if (!next.includes(id)) next.push(id)
      const pf = col?.fields.find((f) => f.primary)
      rec.fieldIds =
        pf && next.includes(pf.id) ? [pf.id, ...next.filter((id) => id !== pf.id)] : next
      rec.updatedAt = nowISO()
    })
    events.emit('records.changed', { collectionId: rec.collectionId })
    return rec
  })

  // show/hide a field on the COLLAPSED card. Per-card by default (a RecordItem.cardFieldVisible
  // override); applyToLane=true instead writes the lane default (FieldDef.showOnCard) and clears
  // every card's override for that field, so the whole category follows it.
  commands.register('records.setFieldCardVisible', ({ recordId, fieldId, visible, applyToLane }) => {
    const rec = findRecord(store.data, recordId)
    if (!rec) throw new Error(`record ${recordId} not found`)
    const col = findCollection(store.data, rec.collectionId)
    store.mutate((db) => {
      if (applyToLane && col) {
        const field = col.fields.find((f) => f.id === fieldId)
        if (field) {
          field.showOnCard = visible
          col.updatedAt = nowISO()
        }
        for (const r of db.records) {
          if (r.collectionId === col.id && r.cardFieldVisible && fieldId in r.cardFieldVisible) {
            delete r.cardFieldVisible[fieldId]
            r.updatedAt = nowISO()
          }
        }
      } else {
        rec.cardFieldVisible = { ...(rec.cardFieldVisible ?? {}), [fieldId]: visible }
        rec.updatedAt = nowISO()
      }
    })
    if (applyToLane) events.emit('collections.changed', store.data.collections)
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
