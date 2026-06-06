// Map a browser KeyboardEvent to an Electron accelerator string (e.g. "Ctrl+Shift+T") for the
// shortcut recorder. Returns null for a modifier-only / unsupported / un-modified combo (a bare
// letter makes a terrible global hotkey, so at least one modifier is required).

const isMac = (): boolean =>
  (typeof window !== 'undefined' && window.platform === 'darwin') ||
  (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform))

/** physical key (KeyboardEvent.code) → Electron accelerator key token, or null if unsupported */
function mainKeyFromCode(code: string): string | null {
  const m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1] // KeyT → T
  const d = /^Digit([0-9])$/.exec(code)
  if (d) return d[1] // Digit1 → 1
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code // F1..F24
  const named: Record<string, string> = {
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Return',
    NumpadEnter: 'Return',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`'
  }
  return named[code] ?? null
}

export function eventToAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.metaKey) mods.push(isMac() ? 'Command' : 'Super')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const main = mainKeyFromCode(e.code)
  if (!main || mods.length === 0) return null // modifier-only or no-modifier → not valid yet
  return [...mods, main].join('+')
}

export function isValidAccelerator(s: string): boolean {
  if (!s) return false
  const parts = s.split('+')
  return parts.length >= 2 && parts.every(Boolean)
}
