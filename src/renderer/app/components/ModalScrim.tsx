const TITLEBAR_H = 44 // height of the draggable title-bar strip

/**
 * The dim layer behind a modal, split at the title bar:
 *  - BELOW the bar: dims AND catches outside-clicks to dismiss the modal.
 *  - OVER the bar: dims visually but is click-through (pointer-events-none), so the window
 *    controls (and hamburger) stay usable while a dialog is open.
 *
 * The modal's outer container must be `pointer-events-none` and its card `pointer-events-auto`
 * for the pass-through to reach the title bar beneath.
 */
export function ModalScrim({
  onDismiss,
  tint = 'bg-black/55'
}: {
  onDismiss: () => void
  tint?: string
}): JSX.Element {
  return (
    <>
      <div
        className={`pointer-events-auto absolute inset-x-0 bottom-0 ${tint}`}
        style={{ top: TITLEBAR_H }}
        onClick={onDismiss}
      />
      <div className={`pointer-events-none absolute inset-x-0 top-0 ${tint}`} style={{ height: TITLEBAR_H }} />
    </>
  )
}
