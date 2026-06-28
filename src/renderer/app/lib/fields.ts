import type { Collection, FieldDef, RecordItem, SelectOption } from '@shared/types'

export function primaryField(col: Collection): FieldDef | undefined {
  return col.fields.find((f) => f.primary) ?? col.fields.find((f) => f.type === 'text')
}

/** A daily-task lane OR its 每日任务-历史 archive lane — where the title is a date/custom hybrid and
 *  the card title is display-only (edited only in the drawer). */
export function isDailyKind(col: Collection): boolean {
  return col.kind === 'dailyTasks' || (col.kind === 'archive' && col.sourceKind === 'dailyTasks')
}

export function titleOfRecord(col: Collection | undefined, rec: RecordItem | undefined): string {
  if (!col || !rec) return '—'
  const pf = primaryField(col)
  const v = pf ? rec.fields[pf.id] : undefined
  return typeof v === 'string' && v.trim() ? v : '未命名'
}

export function statusField(col: Collection): FieldDef | undefined {
  return col.fields.find((f) => f.type === 'status')
}

export function statusOption(col: Collection, rec: RecordItem): SelectOption | undefined {
  const sf = statusField(col)
  if (!sf) return undefined
  const value = rec.fields[sf.id]
  return sf.config?.options?.find((o) => o.id === value)
}

export function isDoneStatus(col: Collection, rec: RecordItem): boolean {
  const sf = statusField(col)
  if (!sf) return false
  const value = rec.fields[sf.id]
  return !!sf.config?.doneOptionIds?.includes(value as string)
}

export function relationFields(col: Collection): FieldDef[] {
  return col.fields.filter((f) => f.type === 'relation' || f.type === 'person')
}

/**
 * The fields THIS card displays — its own per-card subset of the lane's fields, in order.
 * Falls back to all of the collection's fields for legacy records created before per-card sets.
 */
export function recordFields(col: Collection, rec: RecordItem): FieldDef[] {
  if (!rec.fieldIds) return col.fields
  const byId = new Map(col.fields.map((f) => [f.id, f]))
  const out = rec.fieldIds.map((id) => byId.get(id)).filter((f): f is FieldDef => !!f)
  // never let a card lose its title field, even if it was somehow dropped from the set
  const pf = col.fields.find((f) => f.primary)
  if (pf && !out.some((f) => f.id === pf.id)) out.unshift(pf)
  return out
}
