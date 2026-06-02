/** User-adjustable app settings, persisted in the main-process SQLite store. */
export interface AppSettings {
  /** color theme. NOTE: the renderer also mirrors this in localStorage to avoid a paint flash. */
  theme: 'paper' | 'dark'
  /** when true, closing the main window hides it to the system tray instead of quitting the app */
  runInBackground: boolean
  /** when true, DoodlePilot launches automatically at OS login (only applied in a packaged build) */
  launchAtLogin: boolean
}

/**
 * Defaults used to seed a fresh DB AND to backfill older settings blobs that predate a
 * newer key (the persisted JSON is merged over these on read, so missing keys fall back here).
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'paper',
  runInBackground: false,
  launchAtLogin: false
}
