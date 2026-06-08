import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/bridge'
import { useStore } from '../store'
import { DoodleBox } from './doodle/DoodleBox'
import { ModalScrim } from './ModalScrim'
import { SettingsDialog } from './SettingsDialog'
import { ScreenshotTranslateDialog } from './ScreenshotTranslateDialog'
import { ScreenshotAnalyzeDialog } from './ScreenshotAnalyzeDialog'
import logoUrl from '@assets/logo.png'

type MenuDialog = 'settings' | 'translate' | 'analyze' | 'about' | null

const TITLEBAR_H = 44 // height of the draggable title-bar strip

/**
 * The integrated window title bar: a hamburger menu + the window controls. On Win/Linux the
 * window is frameless, so we draw our own hand-drawn min/max/close on the RIGHT (they dim with
 * the page like everything else — no native-overlay colour flash); on macOS the native traffic
 * lights sit top-left, so the hamburger moves to the right instead. Drag-to-move, solid paper
 * fill. The "版本" item pops a Q-bouncy About card.
 */
export function TitleBar(): JSX.Element {
  // ☰ mirrors the native window controls into the opposite corner: controls are on the
  // RIGHT on Win/Linux (so ☰ goes left), and on the LEFT on macOS (so ☰ goes right).
  const isMac = window.platform === 'darwin'
  const [menuOpen, setMenuOpen] = useState(false)
  // exactly one menu dialog is open at a time → a single state (switching is trivial, no cross-resets)
  const [dialog, setDialog] = useState<MenuDialog>(null)
  const [info, setInfo] = useState<{ name: string; version: string; author: string } | null>(null)
  const updateStatus = useStore((s) => s.updateStatus)
  const checkForUpdate = useStore((s) => s.checkForUpdate)

  useEffect(() => {
    void api.query('app.info', undefined).then(setInfo)
  }, [])

  // 检查更新 lives in the 版本 card (updating is a version concern). The button label shows live
  // progress; the line above it is the static description, swapped for the terminal result.
  const updateBusy =
    updateStatus.phase === 'checking' ||
    updateStatus.phase === 'downloading' ||
    updateStatus.phase === 'installing'
  const updateLabel =
    updateStatus.phase === 'checking'
      ? '检查中…'
      : updateStatus.phase === 'downloading'
        ? `下载中 ${updateStatus.percent}%`
        : updateStatus.phase === 'installing'
          ? '即将重启安装…'
          : '检查更新'
  const updateHint =
    updateStatus.phase === 'none'
      ? '已是最新版本 ✓'
      : updateStatus.phase === 'error'
        ? `更新失败：${updateStatus.message}`
        : '自动检查更新的话，会自动检查、下载、安装并重启'

  return (
    <>
      <div
        className="app-drag relative z-30 flex shrink-0 items-center border-b border-ink/15 px-2"
        style={{ height: TITLEBAR_H, backgroundColor: 'rgb(var(--paper))' }}
      >
        <button
          aria-label="菜单"
          onClick={() => setMenuOpen((v) => !v)}
          className={`app-no-drag flex h-8 w-8 items-center justify-center rounded-[8px] text-ink/80 transition hover:bg-ink/10${isMac ? ' ml-auto' : ''}`}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="3.5" y1="6" x2="16.5" y2="6" />
            <line x1="3.5" y1="10" x2="16.5" y2="10" />
            <line x1="3.5" y1="14" x2="16.5" y2="14" />
          </svg>
        </button>

        {/* hand-drawn min/max/close on Win/Linux (macOS uses its native traffic lights) */}
        {!isMac && <WindowControls />}
      </div>

      {/* dropdown under the hamburger */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setMenuOpen(false)} />
            <motion.div
              className="fixed z-[80] font-doodle"
              style={{
                top: TITLEBAR_H - 4,
                ...(isMac ? { right: 8 } : { left: 8 }),
                transformOrigin: isMac ? 'top right' : 'top left'
              }}
              initial={{ opacity: 0, scale: 0.85, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -6 }}
              transition={{ type: 'spring', stiffness: 460, damping: 24 }}
            >
              <div className="min-w-[150px] rounded-[10px] border-2 border-ink bg-card p-1 shadow-md">
                {(
                  [
                    { id: 'settings', label: '⚙️ 设置' },
                    { id: 'translate', label: '🌐 截屏翻译' },
                    { id: 'analyze', label: '🔍 截屏分析' },
                    { id: 'about', label: '🏷️ 版本' }
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setMenuOpen(false)
                      setDialog(item.id) // switches directly even if another dialog is already open
                    }}
                    className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-left text-base hover:bg-marker-yellow/40"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Q-bouncy version / about card */}
      <AnimatePresence>
        {dialog === 'about' && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ModalScrim onDismiss={() => setDialog(null)} />
            <motion.div
              className="pointer-events-auto relative"
              initial={{ scale: 0.8, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: 8 }}
              transition={{ type: 'spring', stiffness: 380, damping: 15 }}
            >
              <DoodleBox fill="--card" fillStyle="solid">
                <div className="flex w-72 flex-col items-center gap-2 p-6 text-center font-doodle">
                  <img src={logoUrl} alt="" className="h-14 w-14" />
                  <div className="text-2xl font-bold">{info?.name ?? 'DoodlePilot'}</div>
                  <div className="text-base opacity-70">版本 {info?.version ?? '…'}</div>
                  <div className="text-sm opacity-50">作者 {info?.author ?? 'Utter_pulsar'}</div>
                  {/* centered description (or the latest update status) */}
                  <p className="px-1 text-xs leading-relaxed opacity-50">{updateHint}</p>
                  {/* 检查更新 bottom-left, 好的 bottom-right, equal width for symmetry */}
                  <div className="mt-3 flex w-full gap-3">
                    <button
                      onClick={checkForUpdate}
                      disabled={updateBusy}
                      className="flex-1 rounded-[8px] border-2 border-ink px-3 py-1 text-base hover:bg-marker-yellow/40 disabled:opacity-50"
                    >
                      {updateLabel}
                    </button>
                    <button
                      onClick={() => setDialog(null)}
                      className="flex-1 rounded-[8px] border-2 border-ink px-3 py-1 text-base hover:bg-marker-yellow/40"
                    >
                      好的
                    </button>
                  </div>
                </div>
              </DoodleBox>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <SettingsDialog open={dialog === 'settings'} onClose={() => setDialog(null)} />
      <ScreenshotTranslateDialog open={dialog === 'translate'} onClose={() => setDialog(null)} />
      <ScreenshotAnalyzeDialog open={dialog === 'analyze'} onClose={() => setDialog(null)} />
    </>
  )
}

/** Hand-drawn minimize / maximize-restore / close for the frameless Win/Linux window. */
function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    void api.query('window.isMaximized', undefined).then(setMaximized)
    return api.on('window.maximized', setMaximized) // keep the icon in sync with the real state
  }, [])
  const btn =
    'app-no-drag flex h-8 w-8 items-center justify-center rounded-[8px] text-ink/80 transition hover:bg-ink/10'
  return (
    <div className="ml-auto flex items-center gap-1">
      <button
        aria-label="最小化"
        title="最小化"
        onClick={() => void api.command('window.minimize', undefined)}
        className={btn}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="13" x2="16" y2="13" />
        </svg>
      </button>
      <button
        aria-label={maximized ? '还原' : '最大化'}
        title={maximized ? '还原' : '最大化'}
        onClick={() => void api.command('window.toggleMaximize', undefined)}
        className={btn}
      >
        {maximized ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4.5" y="6.5" width="9" height="9" rx="1.5" />
            <path d="M7.5 6.5 V4.5 H15.5 V12.5 H13.5" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4.5" y="4.5" width="11" height="11" rx="1.5" />
          </svg>
        )}
      </button>
      <button
        aria-label="关闭"
        title="关闭"
        onClick={() => void api.command('window.close', undefined)}
        className={`${btn} hover:bg-marker-coral hover:text-[#2B2B2B]`}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="5.5" y1="5.5" x2="14.5" y2="14.5" />
          <line x1="14.5" y1="5.5" x2="5.5" y2="14.5" />
        </svg>
      </button>
    </div>
  )
}
