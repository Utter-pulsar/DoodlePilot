/** OpenAI-compatible multimodal model + global-shortcut config for the 截屏翻译 feature. */
export interface ScreenshotTranslateConfig {
  /** master on/off; the model fields are only editable in the UI when this is true */
  enabled: boolean
  /** API base, e.g. https://api.openai.com/v1 (a trailing slash and/or a missing /v1 are tolerated) */
  baseUrl: string
  /** bearer token; optional (some local gateways need none) */
  apiKey: string
  /** the multimodal model name, e.g. gpt-4o-mini */
  model: string
  /** Electron accelerator that triggers a capture, e.g. "Ctrl+Shift+T"; '' = unset */
  shortcut: string
  /** true only after 测试模型能力 confirms the model accepts images — gates the shortcut */
  validated: boolean
}

/** User-adjustable app settings, persisted in the main-process SQLite store. */
export interface AppSettings {
  /** color theme. NOTE: the renderer also mirrors this in localStorage to avoid a paint flash. */
  theme: 'paper' | 'dark'
  /** when true, closing the main window hides it to the system tray instead of quitting the app */
  runInBackground: boolean
  /** when true, DoodlePilot launches automatically at OS login (only applied in a packaged build) */
  launchAtLogin: boolean
  /** screenshot-translation feature config (model + shortcut). Backfilled on older DBs. */
  screenshotTranslate: ScreenshotTranslateConfig
}

export const DEFAULT_SCREENSHOT_TRANSLATE: ScreenshotTranslateConfig = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  shortcut: '',
  validated: false
}

/**
 * Defaults used to seed a fresh DB AND to backfill older settings blobs that predate a
 * newer key (the persisted JSON is merged over these on read, so missing keys fall back here).
 * NB: the merge is shallow — read `screenshotTranslate` as `{ ...DEFAULT_SCREENSHOT_TRANSLATE, ...persisted }`
 * so a nested field added later still backfills.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'paper',
  runInBackground: false,
  launchAtLogin: false,
  screenshotTranslate: DEFAULT_SCREENSHOT_TRANSLATE
}
