import { useEffect, useRef, useState } from 'react'
import { DoodleFilter } from '@app/components/DoodleFilter'
import { DoodleBox } from '@app/components/doodle/DoodleBox'
import { api } from './lib/bridge'
import { ResultCard } from './components/ResultCard'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}
type Phase = 'select' | 'loading' | 'result' | 'error'

/** which display this window covers — passed by main as ?d=<id> (see loadEntry) */
function displayIdFromQuery(): number {
  const d = new URLSearchParams(window.location.search).get('d')
  return d ? Number(d) : -1
}

/**
 * The region-capture overlay (one instance per display). Shows that display's FROZEN screenshot at
 * 1:1 — the frame's physical pixels divided by the display scale, pinned top-left and filling the
 * window WIDTH — so it never stretches or shrinks regardless of resolution / DPI / orientation. (We
 * deliberately don't fit to window HEIGHT: the Windows taskbar shaves ~48px off the usable viewport,
 * and fitting to that shrank + letterboxed the image.) The selection is mapped back into frame
 * pixels via the same ratio, so the crop is exact.
 */
export function CaptureApp(): JSX.Element {
  const displayId = useRef(displayIdFromQuery()).current
  const [frame, setFrame] = useState('')
  const [frameSize, setFrameSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [scaleFactor, setScaleFactor] = useState(1)
  const [theme, setTheme] = useState<'paper' | 'dark'>('paper')
  const [mode, setMode] = useState<'translate' | 'analyze'>('translate')
  const [thinkingEnabled, setThinkingEnabled] = useState(false) // analyze job asked for 思考
  const [phase, setPhase] = useState<Phase>('select')
  const [result, setResult] = useState('')
  const [cropUri, setCropUri] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [reasoning, setReasoning] = useState('') // 截屏分析 thinking (when the function enabled it)
  const [copied, setCopied] = useState(false) // result auto-copied to the clipboard on finish
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  // streamed tokens land here and are flushed to state at most once per frame, so a fast token stream
  // can't thrash React + KaTeX (which re-renders the whole markdown each update)
  const pendingRef = useRef<string | null>(null)
  const pendingReasonRef = useRef<string | null>(null)
  const rafRef = useRef<number | undefined>(undefined)
  // the current translation has reached 'done' or 'error' — guards against a late 'delta' overwriting
  // the final text, and tells onUp's awaited fallback that the events already settled the view. A ref
  // (not the `streaming` state) because the event listener closes over its mount-time value.
  const finishedRef = useRef(false)

  useEffect(() => {
    const applyFrame = (f: {
      frameDataUri: string
      frameW: number
      frameH: number
      scaleFactor: number
    }): void => {
      setFrame(f.frameDataUri)
      setFrameSize({ w: f.frameW, h: f.frameH })
      setScaleFactor(f.scaleFactor || 1)
    }
    // listen FIRST (sync) so a push can't slip past, then pull in case it already finished
    const off = api.on('capture.frame', (f) => {
      if (f.displayId === displayId) applyFrame(f)
    })
    void api.query('capture.context', { displayId }).then((ctx) => {
      document.documentElement.classList.toggle('dark', ctx.theme === 'dark')
      setTheme(ctx.theme)
      setMode(ctx.mode)
      setThinkingEnabled(ctx.thinking)
      if (ctx.frame) applyFrame(ctx.frame)
    })
    return off
  }, [displayId])

  const cancel = (): void => void api.command('capture.cancel', undefined)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // streaming result (翻译 OR 分析): flip to the result view on 'start' (with the original in hand for
  // 看原文), live-render the markdown-so-far on each coalesced 'delta'; 'done'/'error' settle the view.
  useEffect(() => {
    const flush = (): void => {
      rafRef.current = undefined
      if (pendingRef.current !== null) {
        setResult(pendingRef.current)
        pendingRef.current = null
      }
      if (pendingReasonRef.current !== null) {
        setReasoning(pendingReasonRef.current)
        pendingReasonRef.current = null
      }
    }
    const off = api.on('capture.result', (m) => {
      if (m.displayId !== displayId) return
      if (m.phase === 'start') {
        finishedRef.current = false
        setCropUri(m.cropDataUri || '')
        setResult('')
        setReasoning('')
        setCopied(false)
        setErrMsg('')
        pendingRef.current = null
        pendingReasonRef.current = null
        setStreaming(true)
        setPhase('result')
      } else if (m.phase === 'delta') {
        if (finishedRef.current) return // ignore a stray late delta after done/error
        pendingRef.current = m.text ?? ''
        pendingReasonRef.current = m.reasoning ?? ''
        if (rafRef.current === undefined) rafRef.current = requestAnimationFrame(flush)
      } else if (m.phase === 'done') {
        finishedRef.current = true
        if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
        rafRef.current = undefined
        pendingRef.current = null
        pendingReasonRef.current = null
        setResult(m.text ?? '')
        setReasoning(m.reasoning ?? '')
        setCopied(!!m.copied)
        // non-streaming has no 'start' event, so the original image arrives here instead
        if (m.cropDataUri) setCropUri(m.cropDataUri)
        setStreaming(false)
        setPhase('result')
      } else if (m.phase === 'error') {
        finishedRef.current = true
        setErrMsg(m.error || '翻译失败，请重试')
        setStreaming(false)
        setPhase('error')
      }
    })
    return () => {
      off()
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
    }
  }, [displayId])

  // 1:1 layout: physical px per CSS px (== the display's scaleFactor, derived from frame width ÷
  // window width so we never hard-code a resolution). The frozen frame fills the window width and
  // keeps its true height (overflowing the taskbar-shortened viewport at the bottom, which is fine).
  const hasFrame = frameSize.w > 0 && frameSize.h > 0
  // 1:1 = frame physical px ÷ display scaleFactor. Pin top-left at native CSS size; the bottom edge
  // (taskbar) simply overflows the viewport. Using scaleFactor (not innerWidth) stays correct even
  // if the taskbar is docked on a side.
  const imgW = hasFrame ? frameSize.w / scaleFactor : 0
  const imgH = hasFrame ? frameSize.h / scaleFactor : 0

  /** window-CSS rect → frozen-frame pixels (clamped into the frame) */
  const toFramePixels = (r: Rect): Rect => {
    const fx = Math.max(0, Math.min(r.x * scaleFactor, frameSize.w))
    const fy = Math.max(0, Math.min(r.y * scaleFactor, frameSize.h))
    return {
      x: fx,
      y: fy,
      w: Math.max(1, Math.min(r.w * scaleFactor, frameSize.w - fx)),
      h: Math.max(1, Math.min(r.h * scaleFactor, frameSize.h - fy))
    }
  }

  const onDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (phase !== 'select' || !hasFrame) return // wait until the screenshot has arrived
    e.currentTarget.setPointerCapture(e.pointerId) // keep tracking past the window edge
    startRef.current = { x: e.clientX, y: e.clientY }
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const s = startRef.current
    if (!s || phase !== 'select') return
    setRect({
      x: Math.min(s.x, e.clientX),
      y: Math.min(s.y, e.clientY),
      w: Math.abs(e.clientX - s.x),
      h: Math.abs(e.clientY - s.y)
    })
  }
  const onUp = async (): Promise<void> => {
    if (phase !== 'select') return
    const r = rect
    startRef.current = null
    if (!r || r.w < 8 || r.h < 8) {
      cancel() // a click / tiny drag = cancel
      return
    }
    finishedRef.current = false // new session — clear any prior 'done'/'error'
    setPhase('loading')
    // the view is driven by the `capture.result` events above; this awaited result is only a
    // safety net for a failure that somehow never arrived as an 'error' event (events already
    // settled → finishedRef is set → don't clobber what they showed).
    const res = await api.command('capture.selectRegion', { displayId, rect: toFramePixels(r) })
    if (!res.ok && !finishedRef.current) {
      setErrMsg(res.error || (mode === 'analyze' ? '分析失败，请重试' : '翻译失败，请重试'))
      setPhase('error')
    }
  }

  const selecting = phase === 'select'
  const showOutline = selecting || phase === 'loading'

  return (
    <div
      className="fixed inset-0 select-none overflow-hidden bg-black/40 font-doodle text-ink"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => void onUp()}
    >
      <DoodleFilter />
      {/* frozen frame at 1:1 (fills width, true height) — NOT object-fill / contain, so no distortion */}
      {hasFrame && frame && (
        <img
          src={frame}
          draggable={false}
          alt=""
          className="absolute left-0 top-0"
          style={{ width: imgW, height: imgH }}
        />
      )}
      {/* dim the whole screen until a selection exists, so it reads as "capture mode" */}
      {!rect && <div className="absolute inset-0 bg-black/35" />}
      {/* selection: a box-shadow scrim dims everything OUTSIDE it; outline only while choosing */}
      {rect && (
        <div
          className={`absolute ${showOutline ? 'doodle-edge border-2 border-ink' : ''}`}
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
            boxShadow: '0 0 0 99999px rgba(0,0,0,0.4)'
          }}
        >
          {showOutline && (
            <div className="absolute -top-6 left-0 whitespace-nowrap rounded-[6px] bg-ink px-2 py-0.5 text-xs text-paper">
              {Math.round(rect.w)} × {Math.round(rect.h)}
            </div>
          )}
        </div>
      )}

      {!hasFrame && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="animate-pulse rounded-[10px] border-2 border-ink bg-card px-4 py-2 text-ink">
            截图中…
          </div>
        </div>
      )}
      {hasFrame && selecting && !rect && (
        <div className="pointer-events-none absolute inset-x-0 top-8 flex justify-center">
          <div className="rounded-full border-2 border-ink bg-card/90 px-4 py-1 text-sm text-ink">
            拖动框选要翻译的区域 · Esc 取消
          </div>
        </div>
      )}

      {phase === 'loading' && rect && (
        <div
          className="pointer-events-none absolute flex items-center justify-center"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        >
          <div className="animate-pulse rounded-[10px] border-2 border-ink bg-card px-4 py-2 text-ink">
            {mode === 'analyze' ? '分析中…' : '翻译中…'}
          </div>
        </div>
      )}

      {phase === 'result' && rect && (
        <ResultCard
          rect={rect}
          markdown={result}
          reasoning={reasoning}
          thinkingEnabled={thinkingEnabled}
          cropDataUri={cropUri}
          theme={theme}
          streaming={streaming}
          mode={mode}
          copied={copied}
          onClose={cancel}
        />
      )}

      {phase === 'error' && rect && (
        <div className="absolute" style={{ left: rect.x, top: rect.y, minWidth: 200, maxWidth: 380 }}>
          <DoodleBox theme={theme} fill="--card" fillStyle="solid">
            <div className="p-3 text-ink">
              <div className="mb-2 text-marker-coral">⚠ {errMsg}</div>
              <button
                onClick={cancel}
                className="rounded-[8px] border-2 border-ink px-3 py-1 text-sm hover:bg-marker-yellow/40"
              >
                关闭
              </button>
            </div>
          </DoodleBox>
        </div>
      )}
    </div>
  )
}
