import { useEffect, useRef, useState } from 'react'
import { DoodleBox } from './DoodleBox'

/** A curated office-flavoured emoji set offered in the dropdown. The user can also TYPE any emoji
 *  in the field — these are just one-tap shortcuts. */
const PRESET_ICONS = [
  '📄', '📁', '🗂️', '📋', '📌', '📎', '🗒️',
  '📝', '✅', '⭐', '🚩', '🎯', '💡', '🔥',
  '⏰', '📅', '🗓️', '👥', '🧑‍🚀', '🧑‍💻', '🏢',
  '💼', '📦', '🛠️', '⚙️', '🚀', '🌱', '🌟',
  '🎨', '☕', '🍀', '❤️'
]

/** Keep just the FIRST grapheme so a lane icon stays a single glyph even if the user pastes a word
 *  or a ZWJ emoji (e.g. 🧑‍🚀 is one grapheme but several code points). */
function firstGrapheme(s: string): string {
  const t = s.trim()
  if (!t) return ''
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const first = seg.segment(t)[Symbol.iterator]().next()
    return first.done ? t : first.value.segment
  } catch {
    return [...t][0] ?? t
  }
}

/**
 * Hand-drawn lane-icon picker: a current-icon button + a free-text emoji field + a dropdown grid of
 * preset emojis. Controlled — `value` is the chosen icon (empty = falls back to 📄 at the call site).
 */
export function IconPicker({
  value,
  onChange
}: {
  value: string
  onChange: (icon: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  return (
    <div ref={rootRef} className="relative font-doodle">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border-2 border-ink text-xl transition-colors ${
            open ? 'bg-marker-yellow/40' : 'bg-card hover:bg-ink/5'
          }`}
          title="选择图标"
        >
          {value || '📄'}
        </button>
        <input
          value={value}
          onChange={(e) => onChange(firstGrapheme(e.target.value))}
          placeholder="emoji"
          className="w-16 rounded-[8px] border-2 border-ink bg-card px-2 py-1 text-center outline-none"
          title="可手动输入任意 emoji"
        />
        <span className="text-xs opacity-50">图标</span>
      </div>

      {open && (
        <div className="absolute left-0 top-11 z-50 w-56">
          <DoodleBox fill="--card" fillStyle="solid">
            <div className="grid grid-cols-7 gap-1 p-2">
              {PRESET_ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => {
                    onChange(ic)
                    setOpen(false)
                  }}
                  className={`flex h-7 w-7 items-center justify-center rounded-[6px] text-lg hover:bg-ink/10 ${
                    ic === value ? 'bg-marker-yellow/40' : ''
                  }`}
                >
                  {ic}
                </button>
              ))}
            </div>
          </DoodleBox>
        </div>
      )}
    </div>
  )
}
