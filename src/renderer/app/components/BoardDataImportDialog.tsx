import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { assertBoardExportFile, type BoardExportFile } from '@shared/types'
import { api } from '../lib/bridge'
import { useStore } from '../store'
import { DoodleBox } from './doodle/DoodleBox'
import { DoodleButton } from './doodle/DoodleButton'
import { ModalScrim } from './ModalScrim'

type ImportPhase =
  | { kind: 'idle' }
  | { kind: 'busy'; fileName: string }
  | { kind: 'success'; fileName: string; collections: number; records: number }
  | { kind: 'error'; message: string }

const ACCEPT = '.doodlepilot-board.json,.json,application/json'

function readError(err: unknown): string {
  return err instanceof Error ? err.message : '导入失败，请换一个文件试试'
}

function UploadArrow({ active }: { active: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 160 92"
      className={`doodle-edge h-24 w-40 transition ${active ? 'scale-105 text-marker-blue' : 'text-ink/75'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M25 61 C30 44, 45 37, 60 43 C67 22, 101 19, 109 46 C125 44, 138 53, 137 67 C136 79, 126 84, 112 84 L48 84 C34 84, 23 76, 25 61 Z" />
      <path d="M80 72 C80 60, 80 48, 80 34" />
      <path d="M63 49 C69 42, 74 37, 80 31 C86 37, 92 42, 98 49" />
      <path d="M45 22 C33 23, 25 29, 20 39" strokeDasharray="5 8" />
      <path d="M115 20 C128 24, 137 32, 143 43" strokeDasharray="5 8" />
    </svg>
  )
}

export function BoardDataImportDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [phase, setPhase] = useState<ImportPhase>({ kind: 'idle' })

  const resetAndClose = (): void => {
    if (phase.kind === 'busy') return
    setDragging(false)
    setPhase({ kind: 'idle' })
    onClose()
  }

  const importFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setDragging(false)
    setPhase({ kind: 'busy', fileName: file.name })
    try {
      const payload = JSON.parse(await file.text()) as unknown
      assertBoardExportFile(payload)
      const result = await api.command('board.importData', { payload: payload as BoardExportFile })
      useStore.getState().selectRecord(null)
      setPhase({
        kind: 'success',
        fileName: file.name,
        collections: result.collections,
        records: result.records
      })
    } catch (err) {
      setPhase({ kind: 'error', message: readError(err) })
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const busy = phase.kind === 'busy'
  const success = phase.kind === 'success'

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center font-doodle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <ModalScrim onDismiss={resetAndClose} />
          <motion.div
            className="pointer-events-auto relative"
            initial={{ scale: 0.78, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.86, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 390, damping: 14 }}
          >
            <DoodleBox fill="--card" fillStyle="solid">
              <div className="flex w-[440px] flex-col gap-4 p-6 text-center">
                <div>
                  <div className="text-2xl font-bold">导入项目看板数据</div>
                  <p className="mt-1 text-sm opacity-60">
                    拖进 DoodlePilot 导出的统一格式文件，当前项目看板会被它覆盖。
                  </p>
                </div>

                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => void importFile(e.currentTarget.files?.[0])}
                />

                <button
                  type="button"
                  disabled={busy || success}
                  onClick={() => inputRef.current?.click()}
                  onDragEnter={(e) => {
                    e.preventDefault()
                    if (!busy && !success) setDragging(true)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (!busy && !success) e.dataTransfer.dropEffect = 'copy'
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (!busy && !success) void importFile(e.dataTransfer.files?.[0])
                  }}
                  className={`doodle-edge flex min-h-64 flex-col items-center justify-center gap-3 rounded-[18px] border-2 border-dashed px-6 py-7 transition ${
                    dragging
                      ? 'border-marker-blue bg-marker-blue/10'
                      : success
                        ? 'border-marker-green bg-marker-green/10'
                        : 'border-ink/45 bg-card-muted/40 hover:bg-marker-yellow/20'
                  } disabled:cursor-default`}
                >
                  <UploadArrow active={dragging || busy} />
                  {phase.kind === 'idle' && (
                    <>
                      <div className="text-lg font-bold">把文件拖到这里</div>
                      <div className="text-sm opacity-60">或点击这张手绘纸片，从本地选择文件</div>
                    </>
                  )}
                  {phase.kind === 'busy' && (
                    <>
                      <div className="text-lg font-bold">正在展开「{phase.fileName}」…</div>
                      <div className="text-sm opacity-60">请稍等，正在检查格式并覆盖看板</div>
                    </>
                  )}
                  {phase.kind === 'success' && (
                    <>
                      <div className="text-lg font-bold text-marker-green">导入完成 ✓</div>
                      <div className="text-sm opacity-70">
                        已导入 {phase.collections} 个分类、{phase.records} 张卡片
                      </div>
                    </>
                  )}
                  {phase.kind === 'error' && (
                    <>
                      <div className="text-lg font-bold text-marker-coral">没有导入成功</div>
                      <div className="max-w-full break-words text-sm opacity-70">{phase.message}</div>
                      <div className="text-xs opacity-50">可以再拖入一个正确的导出文件</div>
                    </>
                  )}
                </button>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-left text-xs leading-relaxed opacity-55">
                    只覆盖项目看板数据；闹钟、设置、多模态模型和 API Key 不会被导入文件改动。
                  </p>
                  <div className="flex shrink-0 gap-2">
                    {phase.kind === 'error' && (
                      <DoodleButton variant="ghost" onClick={() => setPhase({ kind: 'idle' })}>
                        重试
                      </DoodleButton>
                    )}
                    <DoodleButton variant={success ? 'primary' : 'default'} disabled={busy} onClick={resetAndClose}>
                      {success ? '完成' : '取消'}
                    </DoodleButton>
                  </div>
                </div>
              </div>
            </DoodleBox>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
