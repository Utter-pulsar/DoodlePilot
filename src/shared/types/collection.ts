import type { Id, ISODate, Timestamped } from './common'

// ---------------------------------------------------------------------------
// DoodlePilot's project board is a Lark/Feishu "Bitable"-style model:
//   Collection  = a vertical lane / table (e.g. Projects, People, Daily Tasks)
//   FieldDef    = a column definition inside a collection (fully user-defined)
//   RecordItem  = one cell/card in a lane (a project, a person, a task...)
// Lanes are linked through `relation`/`person` fields, so editing one side is
// visible from the other (computed via backlinks — see collection-service).
// ---------------------------------------------------------------------------

export type FieldType =
  | 'text'
  | 'longText'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'status' // a select whose options carry "done" semantics
  | 'checklist' // a list of sub-tasks, each with its own status (e.g. a day's tasks)
  | 'date'
  | 'dateRange'
  | 'checkbox'
  | 'url'
  | 'person' // relation to a collection of kind 'people'
  | 'relation' // generic two-way link to any collection

export interface SelectOption {
  id: Id
  label: string
  color: string // hand-drawn palette token, e.g. 'marker-yellow'
}

export interface FieldConfig {
  /** select / multiSelect / status */
  options?: SelectOption[]
  /** status: which option ids count as "completed" */
  doneOptionIds?: Id[]
  /** relation / person: the collection this field links to */
  targetCollectionId?: Id
  /** relation: optional field on the target collection that mirrors this link */
  reverseFieldId?: Id
}

export interface FieldDef {
  id: Id
  name: string
  type: FieldType
  config?: FieldConfig
  width?: number
  /** the title field used to label a record (e.g. the banner / card heading) */
  primary?: boolean
  /** show this field's value on the COLLAPSED card (not just in the detail drawer) */
  showOnCard?: boolean
}

/**
 * `kind` only drives optional behaviour (e.g. archive => an archive target).
 * Layout/fields stay 100% user-customizable regardless of kind.
 */
export type CollectionKind =
  | 'generic'
  | 'projects'
  | 'people'
  | 'weeklyTasks'
  | 'dailyTasks'
  | 'archive'

export interface Collection extends Timestamped {
  id: Id
  name: string
  icon?: string // emoji or sprite key
  kind: CollectionKind
  order: number
  fields: FieldDef[]
  /** lane width in px (user-resizable); falls back to a default when unset */
  width?: number
}

export interface DateRangeValue {
  start: ISODate | null
  end: ISODate | null
}

/** One sub-task inside a 'checklist' field (e.g. a daily task). */
export interface ChecklistItem {
  id: Id
  text: string
  /** an option id from the field's config.options (待办 / 进行中 / 已完成…) */
  status?: Id
}

/** A stored field value. Arrays hold option ids (select), record ids (relation),
 *  or ChecklistItem objects (checklist). */
export type FieldValue =
  | string
  | number
  | boolean
  | string[]
  | DateRangeValue
  | ChecklistItem[]
  | null

export interface RecordItem extends Timestamped {
  id: Id
  collectionId: Id
  fields: Record<Id, FieldValue>
  /** which of the collection's fields THIS card shows, in order. A new card inherits ALL of the
   *  collection's fields at creation; adding a field afterwards only reaches new cards, and each
   *  card can drop fields on its own. Undefined (legacy) is read as "all of the lane's fields". */
  fieldIds?: Id[]
  /** per-card override for whether a field is shown on the COLLAPSED card: keyed by field id,
   *  true = show here, false = hide here. A field with no entry follows the lane default
   *  (`FieldDef.showOnCard`). "应用到全部" clears these and writes the lane default instead. */
  cardFieldVisible?: Record<Id, boolean>
  archived: boolean
  order: number
  /** the lane this record was archived FROM, so 恢复 can put it back exactly */
  archivedFrom?: Id
}

/** A record together with its incoming links, grouped by source collection. */
export interface RecordWithLinks {
  record: RecordItem
  backlinks: { collectionId: Id; fieldId: Id; records: RecordItem[] }[]
}
