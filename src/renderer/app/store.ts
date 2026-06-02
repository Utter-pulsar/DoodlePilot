import { create } from 'zustand'
import type { Alarm, Collection, Id, RecordItem } from '@shared/types'
import { titleOfRecord } from './lib/fields'
import { api } from './lib/bridge'

export type Theme = 'paper' | 'dark'
const THEME_KEY = 'doodlepilot-theme'
const readTheme = (): Theme => (localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'paper')
const applyTheme = (t: Theme): void => {
  document.documentElement.classList.toggle('dark', t === 'dark')
}
applyTheme(readTheme()) // apply at module load (before first paint) to avoid a theme flash

interface DoodleState {
  ready: boolean
  collections: Collection[]
  records: RecordItem[] // every record across all lanes (incl. archived; filter in UI)
  alarms: Alarm[]

  /** light ('paper') / dark color theme */
  theme: Theme
  toggleTheme: () => void

  /** record currently open in the detail drawer */
  selectedRecordId: Id | null
  selectRecord: (id: Id | null) => void

  /** right-click context menu for a card */
  cardMenu: { recordId: Id; x: number; y: number } | null
  openCardMenu: (recordId: Id, x: number, y: number) => void
  closeCardMenu: () => void

  /** alarm create/edit form open-state — lifted here so leaving the 闹钟 tab can collapse the
   *  open form (with its animation) before the tab actually switches */
  alarmCreating: boolean
  alarmEditingId: Id | null
  setAlarmCreating: (v: boolean) => void
  setAlarmEditingId: (id: Id | null) => void
  closeAlarmForm: () => void

  /** in-app prompt/confirm (Electron has no usable window.prompt; window.confirm looks off) */
  dialog: {
    kind: 'prompt' | 'confirm'
    title: string
    defaultValue: string
    resolve: (value: string | boolean | null) => void
  } | null
  askPrompt: (title: string, defaultValue?: string) => Promise<string | null>
  askConfirm: (title: string) => Promise<boolean>

  /** a downloaded app update awaiting the user's OK (null = none / dismissed / auto-update off) */
  updateVersion: string | null
  installUpdate: () => void
  dismissUpdate: () => void

  init: () => Promise<void>
  reloadRecords: () => Promise<void>

  // selectors
  collectionById: (id: Id) => Collection | undefined
  recordById: (id: Id) => RecordItem | undefined
  recordsOf: (collectionId: Id, includeArchived?: boolean) => RecordItem[]
  titleOf: (recordId: Id) => string
}

export const useStore = create<DoodleState>((set, get) => ({
  ready: false,
  collections: [],
  records: [],
  alarms: [],

  theme: readTheme(),
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'paper' : 'dark'
    localStorage.setItem(THEME_KEY, next)
    applyTheme(next)
    set({ theme: next })
  },

  selectedRecordId: null,
  selectRecord: (id) => set({ selectedRecordId: id }),
  cardMenu: null,
  openCardMenu: (recordId, x, y) => set({ cardMenu: { recordId, x, y } }),
  closeCardMenu: () => set({ cardMenu: null }),

  alarmCreating: false,
  alarmEditingId: null,
  setAlarmCreating: (v) => set({ alarmCreating: v }),
  setAlarmEditingId: (id) => set({ alarmEditingId: id }),
  closeAlarmForm: () => set({ alarmCreating: false, alarmEditingId: null }),

  dialog: null,
  askPrompt: (title, defaultValue = '') =>
    new Promise<string | null>((resolve) =>
      set({ dialog: { kind: 'prompt', title, defaultValue, resolve: (v) => resolve(v as string | null) } })
    ),
  askConfirm: (title) =>
    new Promise<boolean>((resolve) =>
      set({ dialog: { kind: 'confirm', title, defaultValue: '', resolve: (v) => resolve(!!v) } })
    ),

  updateVersion: null,
  installUpdate: () => void api.command('update.install', undefined),
  dismissUpdate: () => {
    void api.command('update.dismiss', undefined) // tell main to suppress until the next launch
    set({ updateVersion: null })
  },

  init: async () => {
    const [collections, alarms, pendingUpdate] = await Promise.all([
      api.query('collections.list', undefined),
      api.query('alarms.list', undefined),
      api.query('update.pending', undefined)
    ])
    set({ collections, alarms, updateVersion: pendingUpdate?.version ?? null })
    await get().reloadRecords()
    set({ ready: true })

    // keep the store live
    api.on('collections.changed', async (collections) => {
      set({ collections })
      await get().reloadRecords()
    })
    api.on('records.changed', () => void get().reloadRecords())
    api.on('alarms.changed', (alarms) => set({ alarms }))
    api.on('update.changed', (u) => set({ updateVersion: u?.version ?? null }))
  },

  reloadRecords: async () => {
    const cols = get().collections
    const lists = await Promise.all(
      cols.map((c) => api.query('records.list', { collectionId: c.id, includeArchived: true }))
    )
    const records = lists.flat()
    // drop a stale drawer selection if its record vanished
    const sel = get().selectedRecordId
    const patch = sel && !records.some((r) => r.id === sel) ? { selectedRecordId: null } : {}
    set({ records, ...patch })
  },

  collectionById: (id) => get().collections.find((c) => c.id === id),
  recordById: (id) => get().records.find((r) => r.id === id),
  recordsOf: (collectionId, includeArchived = false) =>
    get()
      .records.filter((r) => r.collectionId === collectionId && (includeArchived || !r.archived))
      .sort((a, b) => a.order - b.order),
  titleOf: (recordId) => {
    const rec = get().recordById(recordId)
    const col = rec && get().collectionById(rec.collectionId)
    return titleOfRecord(col, rec)
  }
}))
