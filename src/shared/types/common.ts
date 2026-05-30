// Primitive shared types used across main, preload and renderer.

export type Id = string

/** ISO-8601 timestamp string, e.g. "2026-05-29T08:00:00.000Z". */
export type ISODate = string

export interface Timestamped {
  createdAt: ISODate
  updatedAt: ISODate
}

/** Works in both the Electron main process (Node) and the renderer (browser). */
export function newId(prefix = ''): Id {
  const uuid = globalThis.crypto?.randomUUID?.()
  const core = uuid ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
  return prefix ? `${prefix}_${core}` : core
}

export function nowISO(): ISODate {
  return new Date().toISOString()
}
