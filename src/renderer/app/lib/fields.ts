import type { Collection, FieldDef, RecordItem, SelectOption } from '@shared/types'

export function primaryField(col: Collection): FieldDef | undefined {
  return col.fields.find((f) => f.primary) ?? col.fields.find((f) => f.type === 'text')
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
