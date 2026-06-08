import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DoodleBox } from '@app/components/doodle/DoodleBox'
import { api } from '../lib/bridge'
import { fitFontSize } from '../lib/fitText'
import { MarkdownView } from '../lib/markdown'
import { Toast } from './Toast'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const PAD = 14
const MIN_FONT = 14
const MAX_FONT = 40
const STREAM_FONT = 18 // fixed, comfortable size while streaming (no fit-to-box jitter mid-stream)

const toolBtn =
  'doodle-edge rounded-[8px] border-2 border-ink bg-card px-2 py-0.5 text-xs text-ink transition hover:bg-marker-yellow/40 disabled:opacity-50'

/**
 * The translation result, anchored at the selection. The translation markdown is fitted to the box
 * (fill + auto-scale font, grow the card if it can't fit at the min size). Clicking the body (or the
 * 原文/译文 chip) flips between the translation and the ORIGINAL cropped image — both are already in
 * hand (passed from main), so the flip and 复制译文 are instant, no extra model calls. 提取文本/公式
 * still OCR the image (those produce NEW text/LaTeX) and copy to the clipboard.
 */
export function ResultCard({
  rect,
  markdown,
  reasoning = '',
  thinkingEnabled = false,
  cropDataUri,
  theme,
  streaming = false,
  mode = 'translate',
  copied = false,
  onClose
}: {
  rect: Rect
  markdown: string
  reasoning?: string
  thinkingEnabled?: boolean
  cropDataUri: string
  theme: 'paper' | 'dark'
  streaming?: boolean
  mode?: 'translate' | 'analyze'
  copied?: boolean
  onClose: () => void
}): JSX.Element {
  const analyze = mode === 'analyze'
  const measureRef = useRef<HTMLDivElement>(null)
  const thinkRef = useRef<HTMLDivElement>(null)
  const [fontSize, setFontSize] = useState(MAX_FONT)
  const [cardH, setCardH] = useState(rect.h)
  const [showOriginal, setShowOriginal] = useState(false)
  const [thinkOpen, setThinkOpen] = useState(true) // 思考过程 shown by default; collapsible anytime
  const [extracting, setExtracting] = useState<'text' | 'formula' | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  // while STREAMING, hold the font fixed and just grow the card to fit (capping at the available
  // height → it scrolls), so the result doesn't jump around as text arrives. Once DONE, fit the font
  // to the box like before. Only runs in translation view (measureRef is unmounted in image view).
  const renderFont = streaming ? STREAM_FONT : fontSize
  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    const maxCardH = Math.max(rect.h, window.innerHeight - rect.y - 56)
    if (streaming) {
      // grow from a compact pill as tokens arrive (don't force the full selection height → no big
      // blank box while waiting for the first token); cap at the viewport, then it scrolls
      setCardH(Math.min(maxCardH, Math.max(52, el.scrollHeight + PAD * 2)))
    } else {
      const { fontSize: fs, neededHeight } = fitFontSize(el, rect.w - PAD * 2, rect.h - PAD * 2, MIN_FONT, MAX_FONT)
      setFontSize(fs)
      setCardH(Math.min(maxCardH, Math.max(rect.h, neededHeight + PAD * 2)))
    }
  }, [markdown, showOriginal, streaming, rect.w, rect.h, rect.y])

  // keep the freshly streamed tail in view as content grows past the card height
  useLayoutEffect(() => {
    if (!streaming) return
    const el = measureRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [markdown, streaming])

  // same for the (expanded) 思考过程 block while it streams
  useLayoutEffect(() => {
    if (!streaming || !thinkOpen) return
    const el = thinkRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [reasoning, streaming, thinkOpen])

  const showToast = (msg: string): void => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1600)
  }

  // the main process auto-copied the finished result → confirm it to the user
  useEffect(() => {
    if (copied) showToast('已自动复制到剪贴板 ✓')
  }, [copied])

  // copy the RAW markdown — formulas stay as their original $…$ LaTeX source (the on-screen render is
  // KaTeX, but what you paste is the source), which is exactly what analysis/extraction wants.
  const copyResult = async (): Promise<void> => {
    await api.command('screenshotTranslate.copy', { text: markdown })
    showToast(analyze ? '已复制 ✓' : '已复制译文 ✓')
  }
  const extract = async (kind: 'text' | 'formula'): Promise<void> => {
    setExtracting(kind)
    try {
      const res = await api.command('screenshotTranslate.extract', { kind })
      showToast(res.ok ? '已复制到剪贴板 ✓' : res.error || '提取失败')
    } finally {
      setExtracting(null)
    }
  }

  const corners = (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setShowOriginal((v) => !v)
        }}
        className="absolute right-8 top-1 z-10 rounded-full bg-card/70 px-2 py-0.5 text-xs text-ink/70 hover:bg-ink/10 hover:text-ink"
        title="点击切换 原文 / 译文"
      >
        {showOriginal ? '译文' : '原文'}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-card/70 text-ink/60 hover:bg-ink/10 hover:text-ink"
        title="关闭 (Esc)"
      >
        ✕
      </button>
    </>
  )

  return (
    <>
      <div className="absolute" style={{ left: rect.x, top: rect.y, width: rect.w }}>
        {/* 截屏分析「思考」: a collapsible reasoning block above the result; the answer shows as usual
            below. Shown whenever the function enabled 思考 — so the expand/collapse control is always
            findable — with a status line when the model returns no reasoning. */}
        {thinkingEnabled && (
          <div className="mb-1 rounded-[10px] border-2 border-ink/40 bg-card/90 text-ink">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setThinkOpen((v) => !v)
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-xs"
            >
              <span>💭 思考过程{streaming && !reasoning ? '（思考中…）' : ''}</span>
              <span className="opacity-60">{thinkOpen ? '▾ 收起' : '▸ 展开'}</span>
            </button>
            {thinkOpen && (
              <div
                ref={thinkRef}
                className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-t-2 border-ink/20 px-3 py-2 text-xs leading-snug opacity-80"
              >
                {reasoning || (streaming ? '思考中…' : '（该模型未返回思考过程）')}
              </div>
            )}
          </div>
        )}
        {showOriginal ? (
          // 原文：原始截图按 1:1 选区尺寸显示（不缩小、不变形）
          <div
            className="relative cursor-pointer"
            style={{ width: rect.w, height: rect.h }}
            onClick={() => setShowOriginal((v) => !v)}
            title="点击切换 原文 / 译文"
          >
            <img
              src={cropDataUri}
              alt="原文"
              className="doodle-edge block rounded-[10px] border-2 border-ink"
              style={{ width: rect.w, height: rect.h, objectFit: 'fill' }}
            />
            {corners}
          </div>
        ) : (
          <div style={{ height: cardH }}>
            <DoodleBox theme={theme} fill="--card" fillStyle="solid" className="h-full w-full">
              <div
                className="relative cursor-pointer"
                style={{ padding: PAD }}
                onClick={() => setShowOriginal((v) => !v)}
                title="点击切换 原文 / 译文"
              >
                {corners}
                <div
                  ref={measureRef}
                  className="doodle-md text-ink"
                  style={{ fontSize: renderFont, width: rect.w - PAD * 2, maxHeight: cardH - PAD * 2, overflow: 'auto' }}
                >
                  {streaming && !markdown.trim() ? (
                    <div className="flex items-center gap-2 text-ink/50">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-marker-blue" />
                      {analyze ? '正在分析…' : '正在翻译…'}
                    </div>
                  ) : (
                    <MarkdownView streaming={streaming}>{markdown}</MarkdownView>
                  )}
                </div>
              </div>
            </DoodleBox>
          </div>
        )}
        {/* toolbar BELOW the card. 复制译文 is instant; 提取文本/公式 OCR the image to the clipboard. */}
        <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
          {streaming && (
            <span className="mr-auto flex items-center gap-1 text-xs text-ink/60">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-marker-blue" />
              {analyze ? '分析中…' : '翻译中…'}
            </span>
          )}
          <button className={toolBtn} onClick={() => void copyResult()}>
            {analyze ? '⧉ 复制内容' : '⧉ 复制译文'}
          </button>
          {/* 提取文本/公式 are translation-side OCR helpers; analysis only needs 复制内容 + 看原文 */}
          {!analyze && (
            <>
              <button className={toolBtn} disabled={!!extracting} onClick={() => void extract('text')}>
                {extracting === 'text' ? '提取中…' : '📋 提取文本'}
              </button>
              <button className={toolBtn} disabled={!!extracting} onClick={() => void extract('formula')}>
                {extracting === 'formula' ? '提取中…' : '∑ 提取公式'}
              </button>
            </>
          )}
        </div>
      </div>
      <Toast message={toast} />
    </>
  )
}
