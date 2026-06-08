import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { AnalysisFunction, ScreenshotAnalyzeConfig } from '@shared/types'
import { newId } from '@shared/types'
import { api } from '../lib/bridge'
import { DialogShell } from './DialogShell'
import { DoodleToggle } from './doodle/DoodleToggle'
import { ShortcutRecorder } from './ShortcutRecorder'

const fieldCls =
  'w-full rounded-[8px] border-2 border-ink bg-card px-2 py-1 text-sm outline-none disabled:opacity-40'

/**
 * The 截屏分析 config dialog. Reuses the shared model (configured in 设置). Holds 启用 / 流式输出,
 * then a collapsible list of user-defined functions (each = name + prompt + its own global shortcut),
 * with add/delete and a per-function editor below. 启用 is gated on the shared model being 已验证.
 */
export function ScreenshotAnalyzeDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element {
  const [cfg, setCfg] = useState<ScreenshotAnalyzeConfig | null>(null)
  const [validated, setValidated] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false) // collapsed by default; the editor shows below
  // local drafts for the selected function's text fields — committed on blur so a Chinese IME isn't
  // reset mid-composition by the optimistic re-render (same reason as the checklist rows)
  const [nameDraft, setNameDraft] = useState('')
  const [promptDraft, setPromptDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      void api.query('screenshotAnalyze.config', undefined).then(setCfg)
      void api.query('visionModel.config', undefined).then((m) => setValidated(m.validated))
    }
  }, [open])

  // clicking anywhere outside the list (elsewhere in the dialog, or the scrim) collapses it
  useEffect(() => {
    if (!listOpen) return
    const onDown = (e: PointerEvent): void => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) setListOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [listOpen])

  // optimistic LOCAL update is authoritative for the open dialog; fire-and-forget the persist (the
  // backend just merges the patch — nothing to read back). NOT replacing state with the response
  // avoids out-of-order responses from rapid edits clobbering a newer local edit with stale data.
  const update = (patch: Partial<ScreenshotAnalyzeConfig>): void => {
    setCfg((c) => (c ? { ...c, ...patch } : c))
    void api.command('screenshotAnalyze.updateConfig', { patch })
  }

  const functions = cfg?.functions ?? []
  const enabled = !!cfg?.enabled
  const sel = functions.find((f) => f.id === selectedId) ?? null

  // always keep a function selected (when any exist) so the editor below is present — that gives the
  // dialog box its height, so the expanded list (an absolute overlay) is contained instead of
  // spilling past the card. Also recovers from a selection pointing at a deleted function.
  useEffect(() => {
    if (open && functions.length && !functions.some((f) => f.id === selectedId)) {
      setSelectedId(functions[0].id)
    }
  }, [open, functions.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // when the selection changes, load that function's text into the local drafts
  useEffect(() => {
    setNameDraft(sel?.name ?? '')
    setPromptDraft(sel?.prompt ?? '')
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const writeFns = (fns: AnalysisFunction[]): void => update({ functions: fns })
  const patchFn = (id: string, patch: Partial<AnalysisFunction>): void =>
    writeFns(functions.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const dirty = (): boolean => !!sel && (nameDraft !== sel.name || promptDraft !== sel.prompt)
  // the functions array with the in-progress name/prompt draft folded into the selected function, so
  // every STRUCTURAL change (select / add / delete) bakes the edit into ONE write — never dropping it
  // (blur timing) nor clobbering it with a stale-closure second write.
  const withDraft = (): AnalysisFunction[] =>
    sel && dirty()
      ? functions.map((f) =>
          f.id === sel.id ? { ...f, name: nameDraft.trim() || '未命名', prompt: promptDraft } : f
        )
      : functions

  const selectFn = (id: string): void => {
    if (id !== selectedId && dirty()) writeFns(withDraft())
    setSelectedId(id)
    setListOpen(false) // collapse the overlay so the editor below is revealed
  }
  const addFn = (): void => {
    const fn: AnalysisFunction = {
      id: newId('fn'),
      name: `分析 ${functions.length + 1}`,
      prompt: '',
      shortcut: '',
      thinking: false,
      autoCopy: false
    }
    writeFns([...withDraft(), fn])
    setSelectedId(fn.id)
    setListOpen(false) // reveal the editor for the new function
  }
  const deleteFn = (id: string): void => {
    const remaining = withDraft().filter((f) => f.id !== id)
    writeFns(remaining)
    if (selectedId === id) setSelectedId(null)
    // when the list UI disappears (no functions left), collapse so the click-away listener detaches
    if (remaining.length === 0) setListOpen(false)
  }

  return (
    <DialogShell open={open} onClose={onClose} title="截屏分析">
      {!validated && (
        <div className="rounded-[8px] border-2 border-dashed border-ink/40 px-3 py-2 text-xs opacity-70">
          请先在「设置」里配置并验证多模态模型，才能启用截屏分析。
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-base">启用截屏分析</span>
          <span className="text-xs opacity-60">用各功能的快捷键框选屏幕区域即可分析</span>
        </div>
        <DoodleToggle
          label="启用截屏分析"
          checked={enabled && validated}
          disabled={!validated}
          onChange={(v) => update({ enabled: v })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-base">流式输出</span>
          <span className="text-xs opacity-60">
            开启：边生成边显示（公式实时渲染）。关闭：等全部生成完再一起显示
          </span>
        </div>
        <DoodleToggle
          label="流式输出"
          checked={cfg?.stream ?? true}
          disabled={!validated}
          onChange={(v) => update({ stream: v })}
        />
      </div>

      {/* No functions yet → a plain in-flow add button (nothing to overlay, so the card stays
          correctly sized). Once there are functions, it becomes a collapsible list that OVERLAYS the
          editor below when open (absolute, height-capped + scroll, springy), so expanding it never
          pushes the editor down — and the editor (always present via the auto-select effect) gives
          the card enough height to contain the overlay. Clicking elsewhere collapses it. */}
      {validated && functions.length === 0 && (
        <button
          onClick={addFn}
          className="w-full rounded-[10px] border-2 border-dashed border-ink/40 px-3 py-2 text-sm hover:bg-marker-yellow/30"
        >
          ＋ 添加分析功能
        </button>
      )}
      {validated && functions.length > 0 && (
        <div ref={listRef} className="relative">
          <button
            className="flex w-full items-center justify-between rounded-[10px] border-2 border-ink/30 px-3 py-2 text-sm"
            onClick={() => setListOpen((v) => !v)}
          >
            <span>分析功能列表（{functions.length}）</span>
            <span className="opacity-60">{listOpen ? '▾' : '▸'}</span>
          </button>
          <AnimatePresence>
            {listOpen && (
              <motion.div
                className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 space-y-1 overflow-y-auto rounded-[10px] border-2 border-ink bg-card p-2 shadow-md"
                style={{ transformOrigin: 'top' }}
                initial={{ opacity: 0, scale: 0.9, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: -6 }}
                transition={{ type: 'spring', stiffness: 460, damping: 22 }}
              >
                {functions.map((f) => (
                  <div
                    key={f.id}
                    onClick={() => selectFn(f.id)}
                    className={`flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1 ${
                      f.id === selectedId ? 'bg-marker-yellow/40' : 'hover:bg-ink/5'
                    }`}
                  >
                    <span className="flex-1 truncate text-sm">{f.name || '未命名'}</span>
                    <span className="rounded border border-ink/30 px-1.5 text-xs opacity-60">
                      {f.shortcut || '无快捷键'}
                    </span>
                    <button
                      className="opacity-40 hover:opacity-100"
                      title="删除该功能"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteFn(f.id)
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                ))}
                <button
                  onClick={addFn}
                  className="mt-1 w-full rounded-[8px] border-2 border-dashed border-ink/40 px-2 py-1 text-sm hover:bg-marker-yellow/30"
                >
                  ＋ 添加分析功能
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* editor for the selected function */}
      {validated && sel && (
        <div className="flex flex-col gap-1.5 rounded-[10px] border-2 border-ink/30 p-3">
                    <span className="text-sm opacity-70">功能名称</span>
                    <input
                      className={fieldCls}
                      value={nameDraft}
                      placeholder="例如：识别公式"
                      onChange={(e) => setNameDraft(e.target.value)}
                      onBlur={() => patchFn(sel.id, { name: nameDraft.trim() || '未命名' })}
                    />
                    <span className="mt-1 text-sm opacity-70">分析需求</span>
                    <textarea
                      className={`${fieldCls} min-h-[88px] resize-y leading-snug`}
                      value={promptDraft}
                      placeholder="例如：识别图中的数学公式，用 LaTeX 表示；或：用中文总结这段内容的要点"
                      onChange={(e) => setPromptDraft(e.target.value)}
                      onBlur={() => patchFn(sel.id, { prompt: promptDraft })}
                    />
                    <div className="mt-1 flex items-center justify-between gap-4">
                      <div className="flex flex-col">
                        <span className="text-sm">开启思考（thinking）</span>
                        <span className="text-xs opacity-60">分析后显示一段可折叠的思考过程，正文照常显示</span>
                      </div>
                      <DoodleToggle
                        label="开启思考"
                        checked={!!sel.thinking}
                        onChange={(v) => patchFn(sel.id, { thinking: v })}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col">
                        <span className="text-sm">完成后自动复制</span>
                        <span className="text-xs opacity-60">分析结束自动把结果放到剪贴板</span>
                      </div>
                      <DoodleToggle
                        label="完成后自动复制"
                        checked={!!sel.autoCopy}
                        onChange={(v) => patchFn(sel.id, { autoCopy: v })}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col">
                        <span className="text-sm">快捷键</span>
                        <span className="text-xs opacity-60">点击后按下组合键录入</span>
                      </div>
                      <ShortcutRecorder
                        value={sel.shortcut}
                        onChange={(s) => patchFn(sel.id, { shortcut: s })}
                      />
                    </div>
        </div>
      )}

      <button
        onClick={onClose}
        className="mx-auto mt-1 block rounded-[8px] border-2 border-ink px-5 py-1 text-base hover:bg-marker-yellow/40"
      >
        好的
      </button>
    </DialogShell>
  )
}
