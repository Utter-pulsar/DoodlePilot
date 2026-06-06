import { useEffect, useState } from 'react'
import { eventToAccelerator } from '../lib/accelerator'

/**
 * Click the box → it listens for ONE key combo → records it as an Electron accelerator string
 * (e.g. "Ctrl+Shift+T"). Esc aborts recording; a modifier-only press keeps waiting. The parent
 * persists the value (and the main process actually registers the global hotkey).
 */
export function ShortcutRecorder({
  value,
  onChange,
  disabled = false
}: {
  value: string
  onChange: (accel: string) => void
  disabled?: boolean
}): JSX.Element {
  const [recording, setRecording] = useState(false)

  // stop recording (detaching the global key listener) if the recorder gets disabled mid-capture —
  // e.g. the user toggles 启用 off while it's armed; otherwise it would keep swallowing keystrokes
  useEffect(() => {
    if (disabled) setRecording(false)
  }, [disabled])

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        return
      }
      const accel = eventToAccelerator(e)
      if (accel) {
        onChange(accel)
        setRecording(false)
      }
      // otherwise (modifiers only) keep listening for the main key
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange])

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setRecording((r) => !r)}
        className={`doodle-edge min-w-[128px] rounded-[8px] border-2 border-ink px-3 py-1 text-sm transition disabled:opacity-40 ${
          recording ? 'animate-pulse bg-marker-yellow/50' : 'bg-card hover:bg-marker-yellow/20'
        }`}
      >
        {recording ? '按下组合键…' : value || '点击设置'}
      </button>
      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-xs opacity-50 hover:opacity-100"
          title="清除快捷键"
        >
          清除
        </button>
      )}
    </div>
  )
}
