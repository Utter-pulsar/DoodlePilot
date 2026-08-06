import type { Collection, CollectionKind, FieldDef, FieldType, RecordItem } from './collection'

export const BOARD_EXPORT_APP = 'DoodlePilot'
export const BOARD_EXPORT_KIND = 'project-board'
export const BOARD_EXPORT_FORMAT_VERSION = 1

export interface BoardExportFile {
  app: typeof BOARD_EXPORT_APP
  kind: typeof BOARD_EXPORT_KIND
  formatVersion: typeof BOARD_EXPORT_FORMAT_VERSION
  exportedAt: string
  schemaVersion: number
  data: {
    collections: Collection[]
    records: RecordItem[]
  }
}

export interface BoardExportResult {
  ok: boolean
  canceled?: boolean
  filePath?: string
  collections: number
  records: number
}

export interface BoardImportResult {
  ok: boolean
  collections: number
  records: number
}

const FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  'text',
  'longText',
  'number',
  'select',
  'multiSelect',
  'status',
  'checklist',
  'date',
  'dateRange',
  'checkbox',
  'url',
  'person',
  'relation'
])

const COLLECTION_KINDS: ReadonlySet<CollectionKind> = new Set([
  'generic',
  'projects',
  'people',
  'dailyTasks',
  'archive'
])

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isBooleanMap(value: unknown): value is Record<string, boolean> {
  return isObject(value) && Object.values(value).every((item) => typeof item === 'boolean')
}

function isFieldDef(value: unknown): value is FieldDef {
  if (!isObject(value)) return false
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false
  if (typeof value.type !== 'string' || !FIELD_TYPES.has(value.type as FieldType)) return false
  if (value.config !== undefined && !isObject(value.config)) return false
  if (value.width !== undefined && !isFiniteNumber(value.width)) return false
  if (value.primary !== undefined && typeof value.primary !== 'boolean') return false
  if (value.showOnCard !== undefined && typeof value.showOnCard !== 'boolean') return false
  return true
}

function isCollection(value: unknown): value is Collection {
  if (!isObject(value)) return false
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false
  if (typeof value.kind !== 'string' || !COLLECTION_KINDS.has(value.kind as CollectionKind)) return false
  if (!isFiniteNumber(value.order)) return false
  if (!Array.isArray(value.fields) || !value.fields.every(isFieldDef)) return false
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false
  if (value.icon !== undefined && typeof value.icon !== 'string') return false
  if (value.width !== undefined && !isFiniteNumber(value.width)) return false
  if (value.sourceKind !== undefined) {
    if (typeof value.sourceKind !== 'string' || !COLLECTION_KINDS.has(value.sourceKind as CollectionKind)) {
      return false
    }
  }
  if (value.hiddenDays !== undefined && !isStringArray(value.hiddenDays)) return false
  if (value.hideCustom !== undefined && typeof value.hideCustom !== 'boolean') return false
  return true
}

function isRecordItem(value: unknown): value is RecordItem {
  if (!isObject(value)) return false
  if (typeof value.id !== 'string' || typeof value.collectionId !== 'string') return false
  if (!isObject(value.fields)) return false
  if (typeof value.archived !== 'boolean') return false
  if (!isFiniteNumber(value.order)) return false
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false
  if (value.fieldIds !== undefined && !isStringArray(value.fieldIds)) return false
  if (value.cardFieldVisible !== undefined && !isBooleanMap(value.cardFieldVisible)) return false
  if (value.archivedFrom !== undefined && typeof value.archivedFrom !== 'string') return false
  return true
}

function hasUniqueIds(items: Array<{ id: string }>): boolean {
  return new Set(items.map((item) => item.id)).size === items.length
}

export function isBoardExportFile(value: unknown): value is BoardExportFile {
  if (!isObject(value)) return false
  if (value.app !== BOARD_EXPORT_APP) return false
  if (value.kind !== BOARD_EXPORT_KIND) return false
  if (value.formatVersion !== BOARD_EXPORT_FORMAT_VERSION) return false
  if (typeof value.exportedAt !== 'string') return false
  if (!isFiniteNumber(value.schemaVersion)) return false
  if (!isObject(value.data)) return false

  const { collections, records } = value.data
  if (!Array.isArray(collections) || !collections.every(isCollection)) return false
  if (!Array.isArray(records) || !records.every(isRecordItem)) return false
  if (!hasUniqueIds(collections) || !hasUniqueIds(records)) return false

  const collectionIds = new Set(collections.map((collection) => collection.id))
  return records.every((record) => collectionIds.has(record.collectionId))
}

export function assertBoardExportFile(value: unknown): asserts value is BoardExportFile {
  if (!isBoardExportFile(value)) {
    throw new Error('这不是有效的 DoodlePilot 项目看板导出文件')
  }
}
