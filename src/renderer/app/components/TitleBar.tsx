import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/bridge'
import { DoodleBox } from './doodle/DoodleBox'
import logoUrl from '@assets/logo.png'

const TITLEBAR_H = 44 // matches the native titleBarOverlay height set in the main process

/**
 * The integrated window title bar. A hamburger menu on the LEFT mirrors the native
 * min/max/close controls on the RIGHT (visual symmetry); the bar is drag-to-move and
 * uses a solid paper fill (no dot texture) so it blends seamlessly with the native
 * controls overlay. The "版本" item pops a Q-bouncy About card.
 */
export function TitleBar(): JSX.Element {
  // ☰ mirrors the native window controls into the opposite corner: controls are on the
  // RIGHT on Win/Linux (so ☰ goes left), and on the LEFT on macOS (so ☰ goes right).
  const isMac = window.platform === 'darwin'
  const [menuOpen, setMenuOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [info, setInfo] = useState<{ name: string; version: string } | null>(null)

  useEffect(() => {
    void api.query('app.info', undefined).then(setInfo)
  }, [])

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
      </div>

      {/* dropdown under the hamburger */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <motion.div
              className="fixed z-50 font-doodle"
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
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    setAboutOpen(true)
                  }}
                  className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-left text-base hover:bg-marker-yellow/40"
                >
                  🏷️ 版本
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Q-bouncy version / about card */}
      <AnimatePresence>
        {aboutOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/55" onClick={() => setAboutOpen(false)} />
            <motion.div
              className="relative"
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
                  <button
                    onClick={() => setAboutOpen(false)}
                    className="mt-2 rounded-[8px] border-2 border-ink px-5 py-1 text-base hover:bg-marker-yellow/40"
                  >
                    好的
                  </button>
                </div>
              </DoodleBox>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
