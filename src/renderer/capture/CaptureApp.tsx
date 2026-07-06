import { useEffect, useRef, useState } from 'react'
import { newId } from '@shared/types'
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

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi))
const MIN_RECT = 24 // smallest selection we let a resize shrink to (px)

/** 8 resize directions with their anchor point on the selection border (fraction of w/h). */
const HANDLES: Array<{ dir: string; fx: number; fy: number; cursor: string }> = [
  { dir: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { dir: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { dir: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { dir: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { dir: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { dir: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { dir: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { dir: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' }
]

/** Apply a resize of `dir` by (dx,dy) to a start rect, keeping the opposite edge fixed and clamping
 *  inside the frame [0..fw]×[0..fh] with a minimum size. Pure — used live and on commit. */
function resizeRect(s: Rect, dir: string, dx: number, dy: number, fw: number, fh: number): Rect {
  let { x, y, w, h } = s
  const right = s.x + s.w
  const bottom = s.y + s.h
  if (dir.includes('e')) w = clamp(s.w + dx, MIN_RECT, fw - s.x)
  if (dir.includes('s')) h = clamp(s.h + dy, MIN_RECT, fh - s.y)
  if (dir.includes('w')) {
    x = clamp(s.x + dx, 0, right - MIN_RECT)
    w = right - x
  }
  if (dir.includes('n')) {
    y = clamp(s.y + dy, 0, bottom - MIN_RECT)
    h = bottom - y
  }
  return { x, y, w, h }
}

const rectsDiffer = (a: Rect, b: Rect): boolean =>
  a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h

/**
 * The region-capture overlay (one instance per display). Shows that display's FROZEN screenshot at
 * 1:1 — the frame's physical pixels divided by the display scale, pinned top-left and filling the
 * window WIDTH — so it never stretches or shrinks regardless of resolution / DPI / orientation. (We
 * deliberately don't fit to window HEIGHT: the Windows taskbar shaves ~48px off the usable viewport,
 * and fitting to that shrank + letterboxed the image.) The selection is mapped back into frame
 * pixels via the same ratio, so the crop is exact. After the first selection the box is draggable
 * (drag inside to move) and resizable (drag an edge/corner) — each adjustment re-runs the model on
 * the new region.
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
  // the id of the LATEST selectRegion run — capture.result events for any other id are stale (a
  // superseded resize/move/retry, or a leftover stream from a box that was closed) and are ignored.
  const reqIdRef = useRef('')
  // move-drag bookkeeping: the grab origin + rect at grab time, the pointer id, and whether we've
  // grabbed the pointer yet. We DON'T capture on pointerdown — a pure click must still reach the
  // card's 原文/译文 toggle (a <div onClick>); capturing early would retarget that click to the root
  // and kill the flip. We only grab once the move threshold is crossed (in onMove).
  const moveRef = useRef<{ startX: number; startY: number; rect: Rect; pointerId: number; captured: boolean } | null>(
    null
  )
  const movedRef = useRef(false)

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
      if (m.requestId !== reqIdRef.current) return // stale run (superseded / closed) — drop it
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

  const failMsg = mode === 'analyze' ? '分析失败，请重试' : '翻译失败，请重试'

  /** Run (or re-run) the model on a committed CSS rect: mint a fresh request id (which supersedes and
   *  aborts any prior in-flight call for this box), flip to loading, and let the capture.result events
   *  drive the view. The awaited result is only a safety net for a failure that never arrived as an
   *  event. */
  const runRegion = (r: Rect): void => {
    const reqId = newId('cap')
    reqIdRef.current = reqId
    finishedRef.current = false
    setErrMsg('')
    setResult('')
    setReasoning('')
    setPhase('loading')
    void api
      .command('capture.selectRegion', { displayId, rect: toFramePixels(r), requestId: reqId })
      .then((res) => {
        if (
          !res.ok &&
          res.requestId === reqIdRef.current &&
          !finishedRef.current &&
          res.error !== '已取消'
        ) {
          setErrMsg(res.error || failMsg)
          setPhase('error')
        }
      })
  }

  const onDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!hasFrame) return // wait until the screenshot has arrived
    movedRef.current = false
    if (phase === 'select') {
      e.currentTarget.setPointerCapture(e.pointerId) // keep tracking past the window edge
      startRef.current = { x: e.clientX, y: e.clientY }
      setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
      return
    }
    // committed box: arm a potential MOVE if the press lands inside it and not on a control/handle.
    // Capture is deferred to onMove (see moveRef comment) so a plain click still flips the card.
    if (!rect) return
    const el = e.target as HTMLElement
    if (el.closest('button, a, input, textarea, [data-nomove]')) return
    const inside =
      e.clientX >= rect.x && e.clientX <= rect.x + rect.w && e.clientY >= rect.y && e.clientY <= rect.y + rect.h
    if (!inside) return
    moveRef.current = { startX: e.clientX, startY: e.clientY, rect, pointerId: e.pointerId, captured: false }
  }

  const onMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (phase === 'select') {
      const s = startRef.current
      if (!s) return
      setRect({
        x: Math.min(s.x, e.clientX),
        y: Math.min(s.y, e.clientY),
        w: Math.abs(e.clientX - s.x),
        h: Math.abs(e.clientY - s.y)
      })
      return
    }
    const mv = moveRef.current
    if (!mv) return
    const dx = e.clientX - mv.startX
    const dy = e.clientY - mv.startY
    if (!movedRef.current && Math.hypot(dx, dy) < 5) return // below threshold → still a click
    if (!mv.captured) {
      // now it's a real drag — grab the pointer so it keeps tracking past the window edge / over the card
      try {
        e.currentTarget.setPointerCapture(mv.pointerId)
      } catch {
        /* pointer already released — harmless */
      }
      mv.captured = true
    }
    movedRef.current = true
    setRect({
      ...mv.rect,
      x: clamp(mv.rect.x + dx, 0, imgW - mv.rect.w),
      y: clamp(mv.rect.y + dy, 0, imgH - mv.rect.h)
    })
  }

  const onUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (phase === 'select') {
      const r = rect
      startRef.current = null
      if (!r || r.w < 8 || r.h < 8) {
        cancel() // a click / tiny drag = cancel
        return
      }
      runRegion(r)
      return
    }
    const mv = moveRef.current
    moveRef.current = null
    if (mv && movedRef.current) {
      const nr: Rect = {
        ...mv.rect,
        x: clamp(mv.rect.x + (e.clientX - mv.startX), 0, imgW - mv.rect.w),
        y: clamp(mv.rect.y + (e.clientY - mv.startY), 0, imgH - mv.rect.h)
      }
      setRect(nr)
      // a drag that ended back where it started (net-zero jiggle) must NOT discard the finished result
      // or spend a fresh model call — only re-run when the region actually changed.
      if (rectsDiffer(nr, mv.rect)) runRegion(nr)
    }
  }

  // a resize handle changed the box → live-follow during the drag, re-run on release
  const onResizeLive = (r: Rect): void => setRect(r)
  const onResizeCommit = (r: Rect): void => {
    setRect(r)
    runRegion(r)
  }

  const selecting = phase === 'select'
  const showOutline = selecting || phase === 'loading'
  const adjustable = !selecting && !!rect && hasFrame // draggable/resizable once committed

  return (
    <div
      className="fixed inset-0 select-none overflow-hidden bg-black/40 font-doodle text-ink"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      // a completed move fires a click on the card body afterwards — swallow it so the box doesn't
      // flip 原文/译文 at the end of a drag. A genuine click never sets movedRef, so it passes through.
      onClickCapture={(e) => {
        if (movedRef.current) {
          e.stopPropagation()
          e.preventDefault()
          movedRef.current = false
        }
      }}
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
            boxShadow: '0 0 0 99999px rgba(0,0,0,0.4)',
            cursor: adjustable ? 'move' : undefined
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
              <div className="flex gap-2">
                <button
                  data-nomove
                  onClick={() => rect && runRegion(rect)}
                  className="rounded-[8px] border-2 border-ink px-3 py-1 text-sm hover:bg-marker-yellow/40"
                >
                  ↻ 重试
                </button>
                <button
                  data-nomove
                  onClick={cancel}
                  className="rounded-[8px] border-2 border-ink px-3 py-1 text-sm hover:bg-marker-yellow/40"
                >
                  关闭
                </button>
              </div>
            </div>
          </DoodleBox>
        </div>
      )}

      {/* resize handles — visible once the box is committed; each drag re-runs the model on release */}
      {adjustable && rect && (
        <ResizeHandles
          rect={rect}
          frameW={imgW}
          frameH={imgH}
          onLive={onResizeLive}
          onCommit={onResizeCommit}
        />
      )}
    </div>
  )
}

/** The 8 drag handles overlaid on the committed selection's border. The container is click-through
 *  (pointer-events-none) so only the small handles grab; everything else falls through to the card. */
function ResizeHandles({
  rect,
  frameW,
  frameH,
  onLive,
  onCommit
}: {
  rect: Rect
  frameW: number
  frameH: number
  onLive: (r: Rect) => void
  onCommit: (r: Rect) => void
}): JSX.Element {
  const dragRef = useRef<{ dir: string; sx: number; sy: number; rect: Rect } | null>(null)

  const down = (dir: string) => (e: React.PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { dir, sx: e.clientX, sy: e.clientY, rect }
  }
  const move = (e: React.PointerEvent<HTMLDivElement>): void => {
    const st = dragRef.current
    if (!st) return
    e.stopPropagation()
    onLive(resizeRect(st.rect, st.dir, e.clientX - st.sx, e.clientY - st.sy, frameW, frameH))
  }
  const up = (e: React.PointerEvent<HTMLDivElement>): void => {
    const st = dragRef.current
    if (!st) return
    e.stopPropagation()
    dragRef.current = null
    const nr = resizeRect(st.rect, st.dir, e.clientX - st.sx, e.clientY - st.sy, frameW, frameH)
    if (rectsDiffer(nr, st.rect)) onCommit(nr)
  }

  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      {HANDLES.map((h) => {
        const isCorner = h.dir.length === 2
        // corners are small squares; edges are thin bars centered on their side
        const w = isCorner ? 14 : h.fx === 0.5 ? Math.max(24, rect.w * 0.4) : 10
        const hh = isCorner ? 14 : h.fy === 0.5 ? Math.max(24, rect.h * 0.4) : 10
        return (
          <div
            key={h.dir}
            data-nomove
            onPointerDown={down(h.dir)}
            onPointerMove={move}
            onPointerUp={up}
            className="pointer-events-auto absolute rounded-[3px] border border-ink/70 bg-card/80 shadow-sm"
            style={{
              left: `${h.fx * 100}%`,
              top: `${h.fy * 100}%`,
              width: w,
              height: hh,
              transform: 'translate(-50%, -50%)',
              cursor: h.cursor,
              opacity: isCorner ? 0.95 : 0.6
            }}
          />
        )
      })}
    </div>
  )
}
