import { app, clipboard, desktopCapturer, globalShortcut, nativeImage, screen } from 'electron'
import type { Display, NativeImage } from 'electron'
import { DEFAULT_SCREENSHOT_TRANSLATE } from '@shared/types'
import type { ScreenshotTranslateConfig } from '@shared/types'
import type { AppCore } from './context'
import type { WindowManager } from '../windows/window-manager'
import { chatVision, VisionError } from './vision-client'

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

/** Crop the user's selection (already in FROZEN-FRAME PIXELS — the renderer maps from window CSS)
 *  out of the frame → PNG data URI. */
function cropToDataUri(image: NativeImage, rect: { x: number; y: number; w: number; h: number }): string {
  const sz = image.getSize()
  const x = Math.max(0, Math.min(Math.round(rect.x), sz.width - 1))
  const y = Math.max(0, Math.min(Math.round(rect.y), sz.height - 1))
  const w = Math.max(1, Math.min(Math.round(rect.w), sz.width - x))
  const h = Math.max(1, Math.min(Math.round(rect.h), sz.height - y))
  return `data:image/png;base64,${image.crop({ x, y, width: w, height: h }).toPNG().toString('base64')}`
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

/**
 * 截屏翻译 feature service: persists the model/shortcut config, owns the global hotkey, and drives
 * the multi-display freeze-frame region capture + vision translation. 提取文本/公式 (Stage 4)
 * re-uses the cropped image cached here. Follows the registerXxx(core) pattern.
 */
export function registerScreenshotTranslate(core: AppCore, windows: WindowManager): void {
  const readConfig = (): ScreenshotTranslateConfig => ({
    ...DEFAULT_SCREENSHOT_TRANSLATE,
    ...core.store.data.settings.screenshotTranslate
  })

  // ---- capture session state ----
  let capturing = false
  const frames = new Map<number, CaptureEntry>()
  let lastCropDataUri: string | null = null // the chosen crop, re-used by 提取文本/公式 (Stage 4)

  const endCapture = (): void => {
    windows.closeCaptureWindows()
    frames.clear()
    lastCropDataUri = null
    capturing = false
  }

  // ---- global hotkey ----
  const syncShortcut = (): void => {
    globalShortcut.unregisterAll()
    const c = readConfig()
    if (!c.enabled || !c.shortcut) return
    let ok = false
    try {
      ok = globalShortcut.register(c.shortcut, () => {
        void core.commands.execute('screenshotTranslate.trigger', undefined)
      })
    } catch {
      ok = false
    }
    if (!ok) core.broadcast('toast', { kind: 'error', message: `快捷键 ${c.shortcut} 被占用，请换一个` })
  }

  // ---- config ----
  core.queries.register('screenshotTranslate.config', () => readConfig())

  core.commands.register('screenshotTranslate.updateConfig', ({ patch }) => {
    core.store.mutate((db) => {
      const prev = { ...DEFAULT_SCREENSHOT_TRANSLATE, ...db.settings.screenshotTranslate }
      const next: ScreenshotTranslateConfig = { ...prev, ...patch }
      // changing the model identity invalidates a prior capability check — but ONLY when the value
      // actually changed, so a no-op blur (focus-out with the same text) doesn't silently un-validate
      const modelChanged =
        (patch.baseUrl !== undefined && patch.baseUrl !== prev.baseUrl) ||
        (patch.model !== undefined && patch.model !== prev.model) ||
        (patch.apiKey !== undefined && patch.apiKey !== prev.apiKey)
      if (modelChanged && !('validated' in patch)) next.validated = false
      db.settings.screenshotTranslate = next
    })
    syncShortcut()
    return readConfig()
  })

  // ---- capture flow ----
  core.commands.register('screenshotTranslate.trigger', async () => {
    const c = readConfig()
    if (!c.enabled || !c.validated) return // gated: enabled AND a passed capability test
    if (capturing) return // re-entrancy guard (R12)
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
      console.log(`[screenshot] captured ${map.size} display(s)`)
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
  })

  core.queries.register('capture.context', ({ displayId }) => {
    const theme = core.store.data.settings.theme
    const e = frames.get(displayId)
    if (!e) return { theme, frame: null } // screenshot still in flight → arrives via capture.frame
    const sz = e.image.getSize()
    return {
      theme,
      frame: { frameDataUri: e.jpegDataUri, frameW: sz.width, frameH: sz.height, scaleFactor: e.display.scaleFactor }
    }
  })

  // crop → translate. Keep the chosen display's window open (it shows the result); close the others.
  core.commands.register('capture.selectRegion', async ({ displayId, rect }) => {
    const e = frames.get(displayId)
    if (!e) {
      endCapture()
      return { ok: false, error: '截图已失效，请重试' }
    }
    const dataUri = cropToDataUri(e.image, rect)
    lastCropDataUri = dataUri
    windows.keepOnlyCaptureWindow(displayId)
    const c = readConfig()
    try {
      const markdown = await chatVision({
        baseUrl: c.baseUrl,
        apiKey: c.apiKey,
        model: c.model,
        dataUri,
        system: TRANSLATE_SYSTEM,
        user: '翻译图片里的文字。'
      })
      return { ok: true, markdown, cropDataUri: dataUri } // cropDataUri = the source image for 看原文
    } catch (err) {
      return { ok: false, error: err instanceof VisionError ? err.message : '翻译失败，请重试' }
    }
  })

  // copy text to the clipboard (复制译文 — instant; translation is already in hand)
  core.commands.register('screenshotTranslate.copy', ({ text }) => {
    clipboard.writeText(text)
    return { ok: true }
  })

  core.commands.register('capture.cancel', () => {
    endCapture()
  })

  // ---- 提取文本 / 公式 → clipboard, and the capability test ----
  const setValidated = (v: boolean): void => {
    core.store.mutate((db) => {
      db.settings.screenshotTranslate = {
        ...DEFAULT_SCREENSHOT_TRANSLATE,
        ...db.settings.screenshotTranslate,
        validated: v
      }
    })
  }

  core.commands.register('screenshotTranslate.extract', async ({ kind, copy = true }) => {
    if (!lastCropDataUri) return { ok: false, error: '没有可提取的截图' }
    const c = readConfig()
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
        baseUrl: c.baseUrl,
        apiKey: c.apiKey,
        model: c.model,
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

  core.commands.register('screenshotTranslate.testModel', async () => {
    const c = readConfig()
    if (!c.baseUrl || !c.model) return { ok: false, message: '请先填写 API 地址与模型名称' }
    try {
      const reply = await chatVision({
        baseUrl: c.baseUrl,
        apiKey: c.apiKey,
        model: c.model,
        dataUri: makeTestImage(),
        system: 'You are a vision capability test. Look at the image and answer in ONE short word.',
        user: 'What color is this image? Answer in one word.',
        maxTokens: 256 // not 20: reasoning models can burn a tiny budget before any visible token
      })
      // any sensible, non-refusal reply means the model actually accepted the image
      const refused = /cannot|can.?t|unable|no image|don.?t see|无法|不能|看不到|没有图/i.test(reply)
      const ok = reply.trim().length > 0 && !refused
      setValidated(ok)
      return ok
        ? { ok: true, message: '模型支持图片输入 ✓' }
        : { ok: false, message: '该模型似乎不支持图片输入，请更换模型' }
    } catch (err) {
      setValidated(false)
      return { ok: false, message: err instanceof VisionError ? err.message : '测试失败，请重试' }
    }
  })

  // if a capture window dies unexpectedly (Alt+F4, renderer crash, load failure) instead of via
  // capture.cancel, the session must still reset — otherwise `capturing` stays true and the hotkey
  // silently stops working until restart.
  windows.onCaptureGone = endCapture

  syncShortcut() // pick up a saved shortcut on launch
  app.on('will-quit', () => globalShortcut.unregisterAll())
}
