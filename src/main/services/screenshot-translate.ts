import { app, clipboard, desktopCapturer, globalShortcut, nativeImage, screen } from 'electron'
import type { Display, NativeImage } from 'electron'
import {
  DEFAULT_SCREENSHOT_ANALYZE,
  DEFAULT_SCREENSHOT_TRANSLATE,
  DEFAULT_VISION_MODEL
} from '@shared/types'
import type {
  AnalysisFunction,
  ScreenshotAnalyzeConfig,
  ScreenshotTranslateConfig,
  VisionModelConfig
} from '@shared/types'
import type { AppCore } from './context'
import type { WindowManager } from '../windows/window-manager'
import { chatVision, chatVisionOnce, chatVisionStream, VisionError } from './vision-client'

interface CaptureEntry {
  display: Display
  image: NativeImage // frozen full-display screenshot (physical px) — cropped to PNG for the model
  jpegDataUri: string // a JPEG of the same frame for the capture window's <img> (small → fast)
}

// Smart-translate: non-Chinese → 简体中文; Chinese → English. Output only GFM markdown.
const TRANSLATE_SYSTEM =
  'You are a precise translation engine. Read ALL text in the image and detect its dominant ' +
  'language. If it is NOT Simplified Chinese, translate everything into Simplified Chinese (简体中文). ' +
  'If it already IS Chinese, translate everything into English. Output ONLY the translation as ' +
  'GitHub-Flavored Markdown, preserving structure (paragraphs, lists, tables, code blocks, inline ' +
  'code). Do not add explanations, notes, or the original text. If the image contains no readable ' +
  'text, output exactly: [无文字]'

// Screenshot ANALYSIS: the user's per-function prompt becomes the user message; this fixes the
// OUTPUT FORMAT so math always renders (KaTeX) and copy keeps raw LaTeX.
const ANALYZE_SYSTEM =
  'You are a precise multimodal assistant. Carefully read the image, then complete the user\'s ' +
  'request about it. Output ONLY the result as GitHub-Flavored Markdown, preserving structure ' +
  '(headings, lists, tables, code blocks). For ANY mathematics, use LaTeX: $…$ for inline and ' +
  '$$…$$ for display. Do not add commentary beyond what the user asked for.'

// Cap the longest side of the crop sent to the model. A full-width selection on a HiDPI display can
// be 3000+ px, whose image-token prefill is the bulk of the "blank, waiting for the first token"
// delay; downscaling to ~2000 cuts upload/encode (and often prefill) with no real OCR/translation
// quality loss, and 看原文 at 2000px is still sharp.
const MAX_CROP_SIDE = 2000

/** Crop the user's selection (already in FROZEN-FRAME PIXELS — the renderer maps from window CSS)
 *  out of the frame, downscaled if huge → PNG data URI. */
function cropToDataUri(image: NativeImage, rect: { x: number; y: number; w: number; h: number }): string {
  const sz = image.getSize()
  const x = Math.max(0, Math.min(Math.round(rect.x), sz.width - 1))
  const y = Math.max(0, Math.min(Math.round(rect.y), sz.height - 1))
  const w = Math.max(1, Math.min(Math.round(rect.w), sz.width - x))
  const h = Math.max(1, Math.min(Math.round(rect.h), sz.height - y))
  let crop = image.crop({ x, y, width: w, height: h })
  const longest = Math.max(w, h)
  if (longest > MAX_CROP_SIDE) {
    const scale = MAX_CROP_SIDE / longest
    crop = crop.resize({ width: Math.round(w * scale), height: Math.round(h * scale), quality: 'better' })
  }
  return `data:image/png;base64,${crop.toPNG().toString('base64')}`
}

/** A small solid-red PNG built without touching disk — the capability test asks the model to name
 *  its color; a vision model answers, a text-only model errors out or refuses. */
function makeTestImage(): string {
  const w = 64
  const h = 64
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = 0 // B
    buf[i * 4 + 1] = 0 // G
    buf[i * 4 + 2] = 255 // R
    buf[i * 4 + 3] = 255 // A
  }
  return nativeImage.createFromBitmap(buf, { width: w, height: h }).toDataURL()
}

/** Grab a full-resolution screenshot of every display BEFORE any capture window is shown, so the
 *  selection UI can never appear in the shot. Keyed by display id. */
async function captureAllDisplays(): Promise<Map<number, CaptureEntry>> {
  const displays = screen.getAllDisplays()
  // ONE getSources call (fast). thumbnailSize = the per-axis max of every display's native size, so
  // each display whose width OR height equals that max comes back at its true native resolution
  // (no upscale, aspect preserved). Smaller displays may upscale, but display + crop use the frame's
  // ACTUAL size, so it stays correct.
  const maxW = Math.round(Math.max(...displays.map((d) => d.bounds.width * d.scaleFactor)))
  const maxH = Math.round(Math.max(...displays.map((d) => d.bounds.height * d.scaleFactor)))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxW, height: maxH }
  })
  const map = new Map<number, CaptureEntry>()
  const pool = [...sources]
  for (const display of displays) {
    const pw = Math.round(display.bounds.width * display.scaleFactor)
    const ph = Math.round(display.bounds.height * display.scaleFactor)
    // prefer display_id, then a source whose frame matches this display's physical size, then order
    let idx = pool.findIndex((s) => s.display_id === String(display.id))
    if (idx < 0) {
      idx = pool.findIndex((s) => {
        const t = s.thumbnail.getSize()
        return Math.abs(t.width - pw) <= 4 && Math.abs(t.height - ph) <= 4
      })
    }
    if (idx < 0) idx = 0
    const src = pool.splice(idx, 1)[0]
    if (!src || src.thumbnail.isEmpty()) continue
    map.set(display.id, {
      display,
      image: src.thumbnail,
      jpegDataUri: `data:image/jpeg;base64,${src.thumbnail.toJPEG(85).toString('base64')}`
    })
  }
  return map
}

/** What the current capture should DO once a region is chosen (set when a shortcut/trigger fires). */
type CaptureJob = { kind: 'translate' } | { kind: 'analyze'; fn: AnalysisFunction }

/**
 * Capture feature service: owns the shared multimodal model config (set in 设置), the 截屏翻译 +
 * 截屏分析 feature configs, the global hotkeys, and the multi-display freeze-frame region capture →
 * vision call. Both features reuse the SAME validated model and the SAME capture flow; only the
 * prompt + result-view differ. Follows the registerXxx(core) pattern.
 */
export function registerScreenshotTranslate(core: AppCore, windows: WindowManager): void {
  const readModel = (): VisionModelConfig => ({
    ...DEFAULT_VISION_MODEL,
    ...core.store.data.settings.visionModel
  })
  const readTranslate = (): ScreenshotTranslateConfig => ({
    ...DEFAULT_SCREENSHOT_TRANSLATE,
    ...core.store.data.settings.screenshotTranslate
  })
  const readAnalyze = (): ScreenshotAnalyzeConfig => ({
    ...DEFAULT_SCREENSHOT_ANALYZE,
    ...core.store.data.settings.screenshotAnalyze
  })

  // ---- capture session state ----
  let capturing = false
  const frames = new Map<number, CaptureEntry>()
  let lastCropDataUri: string | null = null // the chosen crop, re-used by 提取文本/公式
  let pendingJob: CaptureJob = { kind: 'translate' } // what capture.selectRegion should run

  const endCapture = (): void => {
    windows.closeCaptureWindows()
    frames.clear()
    lastCropDataUri = null
    capturing = false
  }

  // ---- global hotkeys (ALL gated on a VALIDATED shared model — no model, nothing fires) ----
  const syncShortcuts = (): void => {
    globalShortcut.unregisterAll()
    if (!readModel().validated) return
    const conflicts: string[] = []
    const reg = (accel: string, run: () => void): void => {
      if (!accel) return
      let ok = false
      try {
        ok = globalShortcut.register(accel, run)
      } catch {
        ok = false
      }
      if (!ok) conflicts.push(accel)
    }
    const t = readTranslate()
    if (t.enabled) reg(t.shortcut, () => void core.commands.execute('screenshotTranslate.trigger', undefined))
    const a = readAnalyze()
    if (a.enabled) {
      for (const fn of a.functions) {
        reg(fn.shortcut, () => void core.commands.execute('screenshotAnalyze.trigger', { functionId: fn.id }))
      }
    }
    if (conflicts.length) {
      core.broadcast('toast', { kind: 'error', message: `快捷键被占用：${conflicts.join('、')}，请换一个` })
    }
  }

  // shared: open the capture windows, screenshot every display, reveal. The caller sets `pendingJob`
  // (and gates on validated/enabled) BEFORE calling this.
  const beginCapture = async (): Promise<void> => {
    if (capturing) return // re-entrancy guard
    capturing = true
    frames.clear()
    // Open the windows HIDDEN: they load (React, fonts) in PARALLEL while we screenshot the DESKTOP.
    // A visible capture window would get captured instead of the desktop (that was the black screen).
    windows.openCaptureWindows(screen.getAllDisplays())
    try {
      const map = await captureAllDisplays()
      if (map.size === 0) {
        core.broadcast('toast', { kind: 'error', message: '截屏失败：没有可用的屏幕画面' })
        endCapture()
        return
      }
      for (const [id, e] of map) {
        frames.set(id, e)
        const sz = e.image.getSize()
        core.broadcast('capture.frame', {
          displayId: id,
          frameDataUri: e.jpegDataUri,
          frameW: sz.width,
          frameH: sz.height,
          scaleFactor: e.display.scaleFactor
        })
      }
      windows.showCaptureWindows() // reveal now that frames are ready (query+event both deliver them)
    } catch (e) {
      console.error('[screenshot] capture failed', e)
      endCapture()
    }
  }

  // ---- shared multimodal model config (lives in 设置) ----
  core.queries.register('visionModel.config', () => readModel())

  core.commands.register('visionModel.updateConfig', ({ patch }) => {
    core.store.mutate((db) => {
      const prev = { ...DEFAULT_VISION_MODEL, ...db.settings.visionModel }
      const next: VisionModelConfig = { ...prev, ...patch }
      // changing the model identity invalidates a prior capability check — but ONLY when the value
      // actually changed, so a no-op blur (focus-out with the same text) doesn't silently un-validate
      const modelChanged =
        (patch.baseUrl !== undefined && patch.baseUrl !== prev.baseUrl) ||
        (patch.model !== undefined && patch.model !== prev.model) ||
        (patch.apiKey !== undefined && patch.apiKey !== prev.apiKey)
      if (modelChanged && !('validated' in patch)) next.validated = false
      db.settings.visionModel = next
    })
    syncShortcuts() // validated may have flipped → re-gate every feature's shortcut
    return readModel()
  })

  const setValidated = (v: boolean): void => {
    core.store.mutate((db) => {
      db.settings.visionModel = { ...DEFAULT_VISION_MODEL, ...db.settings.visionModel, validated: v }
    })
  }

  core.commands.register('visionModel.testModel', async () => {
    const m = readModel()
    if (!m.baseUrl || !m.model) return { ok: false, message: '请先填写 API 地址与模型名称' }
    try {
      const reply = await chatVision({
        baseUrl: m.baseUrl,
        apiKey: m.apiKey,
        model: m.model,
        dataUri: makeTestImage(),
        system: 'You are a vision capability test. Look at the image and answer in ONE short word.',
        user: 'What color is this image? Answer in one word.',
        maxTokens: 256 // not 20: reasoning models can burn a tiny budget before any visible token
      })
      // any sensible, non-refusal reply means the model actually accepted the image
      const refused = /cannot|can.?t|unable|no image|don.?t see|无法|不能|看不到|没有图/i.test(reply)
      const ok = reply.trim().length > 0 && !refused
      setValidated(ok)
      syncShortcuts() // validating unlocks the feature shortcuts
      return ok
        ? { ok: true, message: '模型支持图片输入 ✓' }
        : { ok: false, message: '该模型似乎不支持图片输入，请更换模型' }
    } catch (err) {
      setValidated(false)
      syncShortcuts()
      return { ok: false, message: err instanceof VisionError ? err.message : '测试失败，请重试' }
    }
  })

  // ---- 截屏翻译 config ----
  core.queries.register('screenshotTranslate.config', () => readTranslate())

  core.commands.register('screenshotTranslate.updateConfig', ({ patch }) => {
    core.store.mutate((db) => {
      db.settings.screenshotTranslate = {
        ...DEFAULT_SCREENSHOT_TRANSLATE,
        ...db.settings.screenshotTranslate,
        ...patch
      }
    })
    syncShortcuts()
    return readTranslate()
  })

  // ---- 截屏分析 config ----
  core.queries.register('screenshotAnalyze.config', () => readAnalyze())

  core.commands.register('screenshotAnalyze.updateConfig', ({ patch }) => {
    core.store.mutate((db) => {
      db.settings.screenshotAnalyze = {
        ...DEFAULT_SCREENSHOT_ANALYZE,
        ...db.settings.screenshotAnalyze,
        ...patch
      }
    })
    syncShortcuts()
    return readAnalyze()
  })

  // ---- triggers (gated: validated model AND the feature enabled) ----
  core.commands.register('screenshotTranslate.trigger', async () => {
    if (capturing) return
    if (!readModel().validated || !readTranslate().enabled) return
    pendingJob = { kind: 'translate' }
    await beginCapture()
  })

  core.commands.register('screenshotAnalyze.trigger', async ({ functionId }) => {
    if (capturing) return
    if (!readModel().validated || !readAnalyze().enabled) return
    const fn = readAnalyze().functions.find((f) => f.id === functionId)
    if (!fn) return
    pendingJob = { kind: 'analyze', fn }
    await beginCapture()
  })

  core.queries.register('capture.context', ({ displayId }) => {
    const theme = core.store.data.settings.theme
    const mode = pendingJob.kind === 'analyze' ? 'analyze' : 'translate'
    const thinking = pendingJob.kind === 'analyze' && !!pendingJob.fn.thinking
    const e = frames.get(displayId)
    if (!e) return { theme, mode, thinking, frame: null } // screenshot in flight → arrives via capture.frame
    const sz = e.image.getSize()
    return {
      theme,
      mode,
      thinking,
      frame: { frameDataUri: e.jpegDataUri, frameW: sz.width, frameH: sz.height, scaleFactor: e.display.scaleFactor }
    }
  })

  // crop → run the pending job (translate OR analyze). Keep the chosen display's window open (it shows
  // the result); close the others. Streaming per the feature's `stream` flag — the window flips to its
  // result view on 'start' (carrying the original for 看原文) and re-renders on each 'delta'; a
  // non-streaming run stays in the loading state and shows the whole result on 'done'.
  core.commands.register('capture.selectRegion', async ({ displayId, rect }) => {
    const e = frames.get(displayId)
    if (!e) {
      endCapture()
      return { ok: false, error: '截图已失效，请重试' }
    }
    const dataUri = cropToDataUri(e.image, rect)
    lastCropDataUri = dataUri
    windows.keepOnlyCaptureWindow(displayId)
    const m = readModel()
    const job = pendingJob
    const analyze = job.kind === 'analyze'
    const wantThinking = analyze && !!job.fn.thinking // keep + show the model's reasoning
    const wantAutoCopy = analyze && !!job.fn.autoCopy // copy the result to the clipboard when done
    const stream = analyze ? readAnalyze().stream : readTranslate().stream
    const common = {
      baseUrl: m.baseUrl,
      apiKey: m.apiKey,
      model: m.model,
      dataUri,
      system: analyze ? ANALYZE_SYSTEM : TRANSLATE_SYSTEM,
      user: analyze ? job.fn.prompt.trim() || '分析这张图片的内容。' : '翻译图片里的文字。',
      thinking: wantThinking
    }
    const failMsg = analyze ? '分析失败，请重试' : '翻译失败，请重试'
    // reasoning is only surfaced when this job asked for thinking (translate never shows it)
    const reason = (r: string): string | undefined => (wantThinking ? r : undefined)
    // settle the result: optionally drop it on the clipboard, then tell the window (the non-stream
    // path has no 'start', so it also attaches the original image here for 看原文).
    const done = (answer: string, reasoning: string, withCrop: boolean): void => {
      const copied = wantAutoCopy && !!answer
      if (copied) clipboard.writeText(answer)
      core.broadcast('capture.result', {
        displayId,
        phase: 'done',
        text: answer,
        reasoning: reason(reasoning),
        copied,
        ...(withCrop ? { cropDataUri: dataUri } : {})
      })
    }
    try {
      if (stream) {
        core.broadcast('capture.result', { displayId, phase: 'start', cropDataUri: dataUri })
        const { answer, reasoning } = await chatVisionStream({
          ...common,
          onDelta: (a, r) => core.broadcast('capture.result', { displayId, phase: 'delta', text: a, reasoning: reason(r) })
        })
        done(answer, reasoning, false) // original already sent in 'start'
        return { ok: true, markdown: answer, cropDataUri: dataUri }
      }
      const { answer, reasoning } = await chatVisionOnce(common)
      done(answer, reasoning, true)
      return { ok: true, markdown: answer, cropDataUri: dataUri }
    } catch (err) {
      const error = err instanceof VisionError ? err.message : failMsg
      core.broadcast('capture.result', { displayId, phase: 'error', error })
      return { ok: false, error }
    }
  })

  // copy text to the clipboard (复制译文 / 复制内容 — instant; the result is already in hand)
  core.commands.register('screenshotTranslate.copy', ({ text }) => {
    clipboard.writeText(text)
    return { ok: true }
  })

  core.commands.register('capture.cancel', () => {
    endCapture()
  })

  // ---- 提取文本 / 公式 → clipboard (translate result helper; OCRs the cached crop) ----
  core.commands.register('screenshotTranslate.extract', async ({ kind, copy = true }) => {
    if (!lastCropDataUri) return { ok: false, error: '没有可提取的截图' }
    const m = readModel()
    const system =
      kind === 'formula'
        ? 'You are an OCR engine. Extract ONLY the mathematical formula(s) in the image as LaTeX. ' +
          'Output raw LaTeX only — no code fences, no explanation, no surrounding prose. If there is ' +
          'no formula, output nothing.'
        : 'You are an OCR engine. Extract ALL text in the image EXACTLY as written, preserving line ' +
          'breaks and the original language. Do NOT translate. Output only the raw text — no code ' +
          'fences, no explanation.'
    try {
      const text = await chatVision({
        baseUrl: m.baseUrl,
        apiKey: m.apiKey,
        model: m.model,
        dataUri: lastCropDataUri,
        system,
        user: kind === 'formula' ? '提取图片中的公式为 LaTeX。' : '提取图片中的文字。'
      })
      if (copy) clipboard.writeText(text) // 看原文 toggle passes copy:false (don't touch clipboard)
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: err instanceof VisionError ? err.message : '提取失败，请重试' }
    }
  })

  // if a capture window dies unexpectedly (Alt+F4, renderer crash, load failure) instead of via
  // capture.cancel, the session must still reset — otherwise `capturing` stays true and the hotkey
  // silently stops working until restart.
  windows.onCaptureGone = endCapture

  syncShortcuts() // pick up saved shortcuts on launch (no-op until the model is validated)
  app.on('will-quit', () => globalShortcut.unregisterAll())
}
