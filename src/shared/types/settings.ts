/** Which wire format the model endpoint speaks.
 *  - `openai` = /v1/chat/completions (default; OpenAI, vLLM, Ollama, most gateways)
 *  - `openai-responses` = /v1/responses (OpenAI Responses API; the shape Codex / GPT‑5 proxies use —
 *    some of them ONLY forward images through this endpoint, not chat-completions)
 *  - `anthropic` = /v1/messages (Claude models + relays) */
export type VisionProtocol = 'openai' | 'openai-responses' | 'anthropic'

/** Shared multimodal model config. Configured ONCE in 设置 and reused by every feature that needs
 *  vision (截屏翻译, 截屏分析, …). `validated` is the single gate: a feature can only be enabled when
 *  the model has passed 测试模型能力; changing any field clears it. */
export interface VisionModelConfig {
  /** API base, e.g. https://api.openai.com/v1 (a trailing slash and/or a missing /v1 are tolerated) */
  baseUrl: string
  /** bearer token; optional (some local gateways need none) */
  apiKey: string
  /** the multimodal model name, e.g. gpt-4o-mini */
  model: string
  /** a user-chosen display name for this preset, INDEPENDENT of the model name (e.g. "公司 Claude").
   *  Cosmetic — shown in the 设置 dropdown; falls back to the model name when empty. */
  label?: string
  /** wire format — OpenAI chat-completions / OpenAI responses / Anthropic messages. Defaults to
   *  'openai' on older DBs. */
  protocol?: VisionProtocol
  /** true only after 测试模型能力 confirms the model accepts images — gates every vision feature */
  validated: boolean
}

/** The suggested API base for a wire format — used to prefill the field and to swap it when the user
 *  flips 接口格式 while the URL is still a default (a hand-typed URL is left alone). */
export function defaultBaseUrlFor(protocol: VisionProtocol): string {
  return protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'
}

/** Every known default base URL (across protocols) — a URL equal to one of these is "untouched" and
 *  safe to replace when the protocol changes. */
export const KNOWN_DEFAULT_BASE_URLS: readonly string[] = [
  'https://api.openai.com/v1',
  'https://api.anthropic.com'
]

/** Best-effort guess of the wire format from the endpoint's shape, used when `protocol` is unset:
 *  an Anthropic key (sk-ant…), a claude model name, or an /messages URL imply Anthropic; a codex
 *  model or a /responses URL implies the OpenAI Responses API. */
export function detectVisionProtocol(cfg: {
  baseUrl?: string
  apiKey?: string
  model?: string
  protocol?: VisionProtocol
}): VisionProtocol {
  if (cfg.protocol === 'anthropic' || cfg.protocol === 'openai' || cfg.protocol === 'openai-responses') {
    return cfg.protocol
  }
  const url = (cfg.baseUrl ?? '').toLowerCase()
  const key = (cfg.apiKey ?? '').toLowerCase()
  const model = (cfg.model ?? '').toLowerCase()
  if (key.startsWith('sk-ant') || /anthropic|\/messages\b/.test(url) || /^claude/.test(model)) {
    return 'anthropic'
  }
  if (/\/responses\b/.test(url) || /codex/.test(model)) return 'openai-responses'
  return 'openai'
}

/** A saved multimodal-model preset. The user can keep several and load one into the ACTIVE config
 *  (settings.visionModel) at a time via the 设置 dropdown. Identity is `id`; the label is `model`. */
export interface SavedVisionModel extends VisionModelConfig {
  id: string
}

/** 截屏翻译 feature config (the model lives in `VisionModelConfig` now). */
export interface ScreenshotTranslateConfig {
  /** master on/off; only effective when the shared model is validated */
  enabled: boolean
  /** Electron accelerator that triggers a capture, e.g. "Ctrl+Shift+T"; '' = unset */
  shortcut: string
  /** stream the translation token-by-token (live render). false = wait for the whole result. */
  stream: boolean
}

/** One user-defined 截屏分析 action: a named prompt with its own global shortcut. */
export interface AnalysisFunction {
  id: string
  /** display name shown in the list, e.g. "识别公式" */
  name: string
  /** the instruction sent to the model, e.g. "识别图中的公式，用 LaTeX 表示" */
  prompt: string
  /** Electron accelerator that triggers THIS function's capture; '' = unset */
  shortcut: string
  /** keep the model's reasoning ON and show it as a collapsible block above the result */
  thinking?: boolean
  /** auto-copy the result to the clipboard when analysis finishes */
  autoCopy?: boolean
}

/** 截屏分析 feature config — multiple custom functions, same shared model. */
export interface ScreenshotAnalyzeConfig {
  /** master on/off; only effective when the shared model is validated */
  enabled: boolean
  /** stream the analysis token-by-token (live render). false = wait for the whole result. */
  stream: boolean
  /** the user's analysis functions (each with its own prompt + shortcut) */
  functions: AnalysisFunction[]
}

/** User-adjustable app settings, persisted in the main-process SQLite store. */
export interface AppSettings {
  /** color theme. NOTE: the renderer also mirrors this in localStorage to avoid a paint flash. */
  theme: 'paper' | 'dark'
  /** when true, closing the main window hides it to the system tray instead of quitting the app */
  runInBackground: boolean
  /** when true, DoodlePilot launches automatically at OS login (only applied in a packaged build) */
  launchAtLogin: boolean
  /** the ACTIVE multimodal model (mirror of the selected preset). Every vision feature reads this;
   *  backfilled on older DBs from screenshotTranslate. */
  visionModel: VisionModelConfig
  /** saved model presets the user switches between — the editable list. */
  visionModelPresets: SavedVisionModel[]
  /** id of the selected preset (the one shown/edited in 设置 and mirrored into visionModel). */
  visionModelActiveId: string
  /** screenshot-translation feature config. */
  screenshotTranslate: ScreenshotTranslateConfig
  /** screenshot-analysis feature config. */
  screenshotAnalyze: ScreenshotAnalyzeConfig
}

export const DEFAULT_VISION_MODEL: VisionModelConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  protocol: 'openai',
  validated: false
}

export const DEFAULT_SCREENSHOT_TRANSLATE: ScreenshotTranslateConfig = {
  enabled: false,
  shortcut: '',
  stream: true
}

export const DEFAULT_SCREENSHOT_ANALYZE: ScreenshotAnalyzeConfig = {
  enabled: false,
  stream: true,
  functions: []
}

/**
 * Defaults used to seed a fresh DB AND to backfill older settings blobs that predate a
 * newer key (the persisted JSON is merged over these on read, so missing keys fall back here).
 * NB: the top-level merge is shallow — each service re-reads its nested config as
 * `{ ...DEFAULT_X, ...persisted }` so a nested field added later still backfills.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'paper',
  runInBackground: false,
  launchAtLogin: false,
  visionModel: DEFAULT_VISION_MODEL,
  visionModelPresets: [],
  visionModelActiveId: '',
  screenshotTranslate: DEFAULT_SCREENSHOT_TRANSLATE,
  screenshotAnalyze: DEFAULT_SCREENSHOT_ANALYZE
}
