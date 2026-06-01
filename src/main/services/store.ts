import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database as SqlDb } from 'sql.js'
import { DATA_FILE } from '@shared/constants'
import type { Alarm, AppSettings, Collection, RecordItem } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { seedDatabase, SEED_VERSION } from './seed'

/** In-memory snapshot the services read/mutate. Persisted to a real SQLite file. */
export interface Database {
  version: number
  collections: Collection[]
  records: RecordItem[]
  alarms: Alarm[]
  settings: AppSettings
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, data TEXT NOT NULL, ord INTEGER);
CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, collection_id TEXT, data TEXT NOT NULL, ord INTEGER);
CREATE TABLE IF NOT EXISTS alarms (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

/**
 * Persistence backed by a real SQLite file (sql.js / WASM — no native build, so it
 * compiles & ships identically on Windows/macOS/Linux). The whole DB is small and
 * lives in memory; mutations write through to disk (debounced) in one transaction.
 * Services only ever touch `data` + `mutate`, so swapping the engine never reaches them.
 */
export class Store {
  private writeTimer: ReturnType<typeof setTimeout> | null = null

  private constructor(
    private readonly sql: SqlDb,
    private readonly path: string,
    private db: Database
  ) {}

  /** Async because the WASM engine must initialize before the file can be read. */
  static async open(filePath?: string): Promise<Store> {
    const path = filePath ?? join(app.getPath('userData'), DATA_FILE)
    const wasmFile = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
    const wasmBinary = wasmFile.buffer.slice(
      wasmFile.byteOffset,
      wasmFile.byteOffset + wasmFile.byteLength
    ) as ArrayBuffer
    const SQL = await initSqlJs({ wasmBinary })

    const fileExists = existsSync(path)
    const sql: SqlDb = fileExists
      ? new SQL.Database(new Uint8Array(readFileSync(path)))
      : new SQL.Database()
    sql.run(SCHEMA)

    let db: Database
    let fresh = !fileExists
    if (fileExists) {
      db = Store.read(sql)
      // structure changed since this DB was written → re-seed (early stage; once real
      // user data matters this becomes a proper migration instead of a reset)
      if (db.version < SEED_VERSION) {
        db = seedDatabase()
        fresh = true
      }
    } else {
      db = seedDatabase()
      mkdirSync(dirname(path), { recursive: true })
    }
    const store = new Store(sql, path, db)
    if (fresh) store.flush() // write the (re)seed immediately
    return store
  }

  private static read(sql: SqlDb): Database {
    const rows = (table: string, order = ''): string[] => {
      const res = sql.exec(`SELECT data FROM ${table} ${order}`)
      return res.length ? res[0].values.map((v) => v[0] as string) : []
    }
    const settingsRes = sql.exec("SELECT value FROM settings WHERE key = 'settings'")
    // merge persisted values over the defaults so a blob written by an older version
    // (missing newer keys like runInBackground) is transparently backfilled.
    const settings: AppSettings = settingsRes.length
      ? { ...DEFAULT_SETTINGS, ...(JSON.parse(settingsRes[0].values[0][0] as string) as Partial<AppSettings>) }
      : { ...DEFAULT_SETTINGS }
    const versionRes = sql.exec("SELECT value FROM settings WHERE key = 'version'")
    const version = versionRes.length ? Number(versionRes[0].values[0][0]) : 1

    return {
      version,
      collections: rows('collections', 'ORDER BY ord').map((d) => JSON.parse(d) as Collection),
      records: rows('records', 'ORDER BY ord').map((d) => JSON.parse(d) as RecordItem),
      alarms: rows('alarms').map((d) => JSON.parse(d) as Alarm),
      settings
    }
  }

  get data(): Database {
    return this.db
  }

  mutate(fn: (db: Database) => void): void {
    fn(this.db)
    this.schedulePersist()
  }

  private schedulePersist(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => this.persistNow(), 150)
  }

  private persistNow(): void {
    const { sql, db } = this
    sql.run('BEGIN')
    try {
      sql.run('DELETE FROM collections; DELETE FROM records; DELETE FROM alarms; DELETE FROM settings;')

      const col = sql.prepare('INSERT INTO collections (id, data, ord) VALUES (?, ?, ?)')
      db.collections.forEach((c) => col.run([c.id, JSON.stringify(c), c.order]))
      col.free()

      const rec = sql.prepare('INSERT INTO records (id, collection_id, data, ord) VALUES (?, ?, ?, ?)')
      db.records.forEach((r) => rec.run([r.id, r.collectionId, JSON.stringify(r), r.order]))
      rec.free()

      const alm = sql.prepare('INSERT INTO alarms (id, data) VALUES (?, ?)')
      db.alarms.forEach((a) => alm.run([a.id, JSON.stringify(a)]))
      alm.free()

      const set = sql.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      set.run(['settings', JSON.stringify(db.settings)])
      set.run(['version', String(db.version)])
      set.free()

      sql.run('COMMIT')
    } catch (e) {
      sql.run('ROLLBACK')
      throw e
    }

    writeFileSync(this.path, Buffer.from(this.sql.export()))
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.persistNow()
  }
}
