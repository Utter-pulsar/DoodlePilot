import { useEffect, useState } from 'react'
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

  return (
    <div className="flex h-full flex-col">
      <DoodleFilter />

      <TitleBar />

      <header className="flex items-center gap-3 border-b-2 border-ink/80 px-5 py-3">
        <img src={logoUrl} alt="DoodlePilot" className="h-8 w-8" />
        <h1 className="font-doodle text-2xl font-bold">DoodlePilot</h1>

        <nav className="ml-6 flex gap-2">
          <DoodleButton variant={tab === 'board' ? 'primary' : 'ghost'} onClick={() => setTab('board')}>
            🗂️ 项目看板
          </DoodleButton>
          <DoodleButton variant={tab === 'alarms' ? 'primary' : 'ghost'} onClick={() => setTab('alarms')}>
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
        ) : tab === 'board' ? (
          <TableView />
        ) : (
          <AlarmPanel />
        )}
        {tab === 'board' && <RecordDrawer />}
        {tab === 'board' && <CardContextMenu />}
      </main>

      <DoodleDialog />
    </div>
  )
}
