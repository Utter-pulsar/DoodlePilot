import type {
  Alarm,
  AppSettings,
  Collection,
  CollectionKind,
  FieldDef,
  Id,
  RecordItem,
  RecordWithLinks
} from '../types'
import type { BannerView, OverlayLayout } from '../types/overlay'

// ===========================================================================
// The complete API surface of DoodlePilot.
//   QueryMap   — reads (no side effects)
//   CommandMap — writes / actions (may emit events, run hooks)
//   EventMap   — pushes from main -> renderer windows
// Renderer calls these via window.api; AI/harness will call the same registry.
// ===========================================================================

// NOTE: these maps are `type` aliases (not interfaces) so they satisfy the
// `Record<string, ...>` constraints on the generic buses.
export type QueryMap = {
  'collections.list': { input: void; result: Collection[] }
  'collections.get': { input: { id: Id }; result: Collection | null }
  'records.list': { input: { collectionId: Id; includeArchived?: boolean }; result: RecordItem[] }
  'records.get': { input: { id: Id }; result: RecordItem | null }
  'records.withLinks': { input: { id: Id }; result: RecordWithLinks | null }
  'alarms.list': { input: void; result: Alarm[] }
  'overlay.layout': { input: void; result: OverlayLayout }
  'app.info': { input: void; result: { name: string; version: string; author: string } }
  'settings.get': { input: void; result: AppSettings }
  'window.isMaximized': { input: void; result: boolean }
}

/** The self-update flow's progress, pushed main → renderer as `update.status`. The home screen
 *  shows it under the "DoodlePilot" title; the whole flow runs automatically after the user
 *  presses 检查更新 (check → download → install → relaunch). */
export type UpdateStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'downloading'; percent: number; version?: string }
  | { phase: 'none' } // already on the latest version
  | { phase: 'installing'; version: string } // download done → quitting to install + relaunch
  | { phase: 'error'; message: string }

export type CommandMap = {
  // ---- collections (lanes) ----
  'collections.create': {
    input: { name: string; kind?: CollectionKind; icon?: string; fields?: Omit<FieldDef, 'id'>[] }
    result: Collection
  }
  'collections.update': { input: { id: Id; patch: Partial<Collection> }; result: Collection }
  'collections.delete': { input: { id: Id }; result: void }
  'collections.reorder': { input: { orderedIds: Id[] }; result: void }
  'collections.addField': { input: { collectionId: Id; field: Omit<FieldDef, 'id'> }; result: Collection }
  'collections.updateField': {
    input: { collectionId: Id; fieldId: Id; patch: Partial<FieldDef> }
    result: Collection
  }
  'collections.removeField': { input: { collectionId: Id; fieldId: Id }; result: Collection }

  // ---- records (cells / cards) ----
  'records.create': { input: { collectionId: Id; fields?: Record<Id, unknown> }; result: RecordItem }
  'records.update': {
    input: { id: Id; fields?: Record<Id, unknown>; patch?: Partial<RecordItem> }
    result: RecordItem
  }
  'records.delete': { input: { id: Id }; result: void }
  'records.archive': { input: { id: Id }; result: RecordItem }
  'records.reorder': { input: { collectionId: Id; orderedIds: Id[] }; result: void }
  'records.restore': { input: { recordId: Id }; result: RecordItem } // a "<lane>-历史" card back to its source lane
  'dailyTasks.rollover': { input: { recordId: Id }; result: void } // archive today, open tomorrow with carry-over
  // two-way linking between lanes
  'records.link': { input: { fromId: Id; fieldId: Id; toId: Id }; result: void }
  'records.unlink': { input: { fromId: Id; fieldId: Id; toId: Id }; result: void }

  // ---- per-card field set (each card owns which of the lane's fields it shows) ----
  // addField creates the field in the lane registry AND attaches it to this one card; new cards
  // inherit it, existing cards do not. removeField drops it from this card only (and GCs the
  // lane definition once no card uses it).
  'records.addField': { input: { recordId: Id; field: Omit<FieldDef, 'id'> }; result: RecordItem }
  'records.removeField': { input: { recordId: Id; fieldId: Id }; result: RecordItem }
  // reorder THIS card's fields (per-card order lives in RecordItem.fieldIds; primary stays first)
  'records.reorderFields': { input: { recordId: Id; orderedFieldIds: Id[] }; result: RecordItem }
  // show/hide a field on the collapsed card for THIS card; applyToLane=true makes it the lane
  // default (FieldDef.showOnCard) and clears every card's per-card override for that field
  'records.setFieldCardVisible': {
    input: { recordId: Id; fieldId: Id; visible: boolean; applyToLane?: boolean }
    result: RecordItem
  }

  // ---- semantic task actions (these run hooks + may drive the desktop) ----
  'task.complete': { input: { recordId: Id }; result: RecordItem }

  // ---- alarms ----
  'alarms.create': { input: Partial<Alarm> & { label: string }; result: Alarm }
  'alarms.update': { input: { id: Id; patch: Partial<Alarm> }; result: Alarm }
  'alarms.delete': { input: { id: Id }; result: void }
  'alarms.test': { input: { id: Id }; result: void } // fire this alarm right now

  // ---- desktop overlay control ----
  // overlay window toggles its own click-through when the cursor enters/leaves a sprite
  'overlay.setInteractive': { input: { interactive: boolean }; result: void }
  'banner.show': { input: BannerView; result: void }
  // custom (renderer-drawn) window controls — the window is frameless on Win/Linux, so the
  // title bar provides its own min/max/close (they dim naturally with the page, no native flash)
  'window.minimize': { input: void; result: void }
  'window.toggleMaximize': { input: void; result: void }
  'window.close': { input: void; result: void }

  // ---- app settings ----
  // merge a partial patch into the persisted settings; returns the full updated settings.
  // The main process applies side effects (tray for runInBackground, OS login item for
  // launchAtLogin) before returning.
  'settings.update': { input: { patch: Partial<AppSettings> }; result: AppSettings }

  // ---- app self-update (electron-updater) ----
  // manual, fully-automatic: check → download → install → relaunch. Progress arrives via the
  // `update.status` event (shown under the home title). Packaged Win/Linux only.
  'update.check': { input: void; result: void }
}

export type EventMap = {
  'collections.changed': Collection[]
  'records.changed': { collectionId: Id }
  'alarms.changed': Alarm[]
  'overlay.banner': BannerView
  'alarm.ring': { alarmId: Id; label: string } // renderer plays a sound on this
  'toast': { kind: 'info' | 'success' | 'error'; message: string }
  'window.maximized': boolean // main → renderer: the main window's maximized state changed
  'update.status': UpdateStatus // self-update progress (checking / downloading / installing / …)
}

export type QueryName = keyof QueryMap
export type CommandName = keyof CommandMap
export type EventName = keyof EventMap

/** The object exposed on `window.api` by the preload script. */
export interface DoodleApi {
  query<K extends QueryName>(name: K, input: QueryMap[K]['input']): Promise<QueryMap[K]['result']>
  command<K extends CommandName>(
    name: K,
    input: CommandMap[K]['input']
  ): Promise<CommandMap[K]['result']>
  on<K extends EventName>(name: K, cb: (payload: EventMap[K]) => void): () => void
  onAny(cb: (name: EventName, payload: unknown) => void): () => void
}
