import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from './store'
import { api } from './lib/bridge'
import { DoodleFilter } from './components/DoodleFilter'
import { DoodleButton } from './components/doodle/DoodleButton'
import { TableView } from './features/table/TableView'
import { RecordDrawer } from './features/table/RecordDrawer'
import { CardContextMenu } from './features/table/CardContextMenu'
import { AlarmPanel } from './features/alarm/AlarmPanel'
import { TitleBar } from './components/TitleBar'
import { DoodleDialog } from './components/DoodleDialog'
import { UpdatePrompt } from './components/UpdatePrompt'
import logoUrl from '@assets/logo.png'

type Tab = 'board' | 'alarms'

export default function App(): JSX.Element {
  const init = useStore((s) => s.init)
  const ready = useStore((s) => s.ready)
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const [tab, setTab] = useState<Tab>('board')

  useEffect(() => {
    void init()
    // Delete key removes the record currently open in the drawer
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete') return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      const id = useStore.getState().selectedRecordId
      if (id) void api.command('records.delete', { id })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [init])

  // Fold any open alarm form AT THE SAME TIME as the tab slides away — no setTimeout, so the
  // form collapse and the page slide overlap into one continuous (iOS-like) spring motion
  // instead of two stop-start steps.
  const switchTab = (next: Tab): void => {
    if (next === tab) return
    useStore.getState().closeAlarmForm()
    setTab(next)
  }

  return (
    <div className="flex h-full flex-col">
      <DoodleFilter />

      <TitleBar />

      {/* relative z-30 keeps the tabs above the alarm form's blank-close overlay (z-20), so a
          single click on 项目看板 reaches the tab switch (collapse-then-flip) instead of being
          eaten by the overlay (which would just close the form, needing a second click). */}
      <header className="relative z-30 flex items-center gap-3 border-b-2 border-ink/80 px-5 py-3">
        <img src={logoUrl} alt="DoodlePilot" className="h-8 w-8" />
        <h1 className="font-doodle text-2xl font-bold">DoodlePilot</h1>

        <nav className="ml-6 flex gap-2">
          <DoodleButton variant={tab === 'board' ? 'primary' : 'ghost'} onClick={() => switchTab('board')}>
            🗂️ 项目看板
          </DoodleButton>
          <DoodleButton variant={tab === 'alarms' ? 'primary' : 'ghost'} onClick={() => switchTab('alarms')}>
            ⏰ 闹钟
          </DoodleButton>
        </nav>

        <div className="ml-auto">
          <DoodleButton variant="default" onClick={toggleTheme} title="切换 白天 / 夜间">
            {theme === 'dark' ? '🌙 夜间' : '☀️ 白天'}
          </DoodleButton>
        </div>
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        {!ready ? (
          <div className="flex h-full items-center justify-center font-doodle text-xl opacity-60">
            正在展开画板…
          </div>
        ) : (
          // animate the tab swap (a soft slide + fade, like turning a page) so that after an
          // alarm form folds away, the view continues smoothly into the board instead of cutting
          <AnimatePresence initial={false} mode="sync">
            <motion.div
              key={tab}
              className="absolute inset-0"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ x: { type: 'spring', stiffness: 300, damping: 30 }, opacity: { duration: 0.22 } }}
            >
              {tab === 'board' ? <TableView /> : <AlarmPanel />}
            </motion.div>
          </AnimatePresence>
        )}
        {tab === 'board' && <RecordDrawer />}
        {tab === 'board' && <CardContextMenu />}
      </main>

      <DoodleDialog />
      <UpdatePrompt />
    </div>
  )
}
