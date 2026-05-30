/**
 * A hand-drawn checkbox: a sketchy bordered box that fills green with a wobbly ✓ when on.
 * Replaces the native <input type="checkbox"> so the board keeps its Excalidraw look.
 */
export function DoodleCheckbox({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      title={checked ? '已勾选（点击取消）' : '未勾选（点击勾上）'}
      className={`doodle-edge flex h-7 w-7 items-center justify-center rounded-[6px] border-2 border-ink text-[#2B2B2B] transition-colors ${
        checked ? 'bg-marker-green' : 'bg-card hover:bg-marker-green/20'
      }`}
    >
      {checked && <span className="font-doodle text-lg leading-none">✓</span>}
    </button>
  )
}
