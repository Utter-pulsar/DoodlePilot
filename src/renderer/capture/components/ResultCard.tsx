import { useLayoutEffect, useRef, useState } from 'react'
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
  cropDataUri,
  theme,
  onClose
}: {
  rect: Rect
  markdown: string
  cropDataUri: string
  theme: 'paper' | 'dark'
  onClose: () => void
}): JSX.Element {
  const measureRef = useRef<HTMLDivElement>(null)
  const [fontSize, setFontSize] = useState(MAX_FONT)
  const [cardH, setCardH] = useState(rect.h)
  const [showOriginal, setShowOriginal] = useState(false)
  const [extracting, setExtracting] = useState<'text' | 'formula' | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  // fit the translation font to the box; only runs in translation view (measureRef is unmounted in
  // image view, so the effect early-returns)
  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    const { fontSize: fs, neededHeight } = fitFontSize(el, rect.w - PAD * 2, rect.h - PAD * 2, MIN_FONT, MAX_FONT)
    setFontSize(fs)
    const maxCardH = Math.max(rect.h, window.innerHeight - rect.y - 56)
    setCardH(Math.min(maxCardH, Math.max(rect.h, neededHeight + PAD * 2)))
  }, [markdown, showOriginal, rect.w, rect.h, rect.y])

  const showToast = (msg: string): void => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1600)
  }

  const copyTranslation = async (): Promise<void> => {
    await api.command('screenshotTranslate.copy', { text: markdown })
    showToast('已复制译文 ✓')
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
                  style={{ fontSize, width: rect.w - PAD * 2, maxHeight: cardH - PAD * 2, overflow: 'auto' }}
                >
                  <MarkdownView>{markdown}</MarkdownView>
                </div>
              </div>
            </DoodleBox>
          </div>
        )}
        {/* toolbar BELOW the card. 复制译文 is instant; 提取文本/公式 OCR the image to the clipboard. */}
        <div className="mt-1 flex flex-wrap justify-end gap-1">
          <button className={toolBtn} onClick={() => void copyTranslation()}>
            ⧉ 复制译文
          </button>
          <button className={toolBtn} disabled={!!extracting} onClick={() => void extract('text')}>
            {extracting === 'text' ? '提取中…' : '📋 提取文本'}
          </button>
          <button className={toolBtn} disabled={!!extracting} onClick={() => void extract('formula')}>
            {extracting === 'formula' ? '提取中…' : '∑ 提取公式'}
          </button>
        </div>
      </div>
      <Toast message={toast} />
    </>
  )
}
