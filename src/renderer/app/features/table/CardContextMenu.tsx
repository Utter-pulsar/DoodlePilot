import { useEffect } from 'react'
import { useStore } from '../../store'
import { api } from '../../lib/bridge'

/** Custom right-click menu for a card. Uses the unified doodle font. */
export function CardContextMenu(): JSX.Element | null {
  const menu = useStore((s) => s.cardMenu)
  const close = useStore((s) => s.closeCardMenu)
  const select = useStore((s) => s.selectRecord)

  useEffect(() => {
    if (!menu) return
    const onClick = (): void => close()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, close])

  if (!menu) return null

  const Item = ({
    label,
    onPick,
    danger
  }: {
    label: string
    onPick: () => void
    danger?: boolean
  }): JSX.Element => (
    <button
      onClick={() => {
        onPick()
        close()
      }}
      className={`block w-full rounded px-3 py-1.5 text-left font-doodle hover:bg-ink/5 ${
        danger ? 'text-marker-coral' : 'text-ink'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div
      className="fixed z-50 min-w-[140px] rounded-[10px] border-2 border-ink bg-paper p-1 font-doodle shadow-doodle"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <Item label="打开详情" onPick={() => select(menu.recordId)} />
      <Item label="归档" onPick={() => void api.command('records.archive', { id: menu.recordId })} />
      <Item label="删除" danger onPick={() => void api.command('records.delete', { id: menu.recordId })} />
    </div>
  )
}
