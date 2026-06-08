import { useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useDoodleScrollbar } from '../lib/useDoodleScrollbar'
import { DoodleBox } from './doodle/DoodleBox'
import { ModalScrim } from './ModalScrim'

/**
 * The shared modal shell for the ☰-menu dialogs (设置 / 截屏翻译 / 截屏分析). A Q-bouncy DoodleBox
 * card whose TITLE is a fixed header and whose BODY scrolls when the window is too small to fit it —
 * so the title never scrolls away. The body uses the hand-drawn scrollbar (thin, thickens on hover,
 * drag to scroll). A hand-drawn divider separates the fixed title from the scrolling body.
 */
export function DialogShell({
  open,
  onClose,
  title,
  width = 'w-96',
  children
}: {
  open: boolean
  onClose: () => void
  title: string
  width?: string
  children: React.ReactNode
}): JSX.Element {
  // The card mounts ONLY while open. useDoodleScrollbar attaches to the body on mount; a stable
  // bodyRef on an always-mounted shell would never re-run its effect (the body node is recreated on
  // each open), so the scrollbar would never appear. Mounting per-open re-runs it every time.
  return (
    <AnimatePresence>
      {open && (
        <DialogCard key="dialog" onClose={onClose} title={title} width={width}>
          {children}
        </DialogCard>
      )}
    </AnimatePresence>
  )
}

function DialogCard({
  onClose,
  title,
  width,
  children
}: {
  onClose: () => void
  title: string
  width: string
  children: React.ReactNode
}): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)
  useDoodleScrollbar(bodyRef, 'y')
  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <ModalScrim onDismiss={onClose} />
      <motion.div
        className="pointer-events-auto relative"
        initial={{ scale: 0.8, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0, y: 8 }}
        transition={{ type: 'spring', stiffness: 380, damping: 15 }}
      >
        <DoodleBox fill="--card" fillStyle="solid">
          <div className={`flex max-h-[85vh] ${width} flex-col font-doodle`}>
            <div className="shrink-0 px-6 pb-3 pt-6 text-center text-2xl font-bold">{title}</div>
            {/* hand-drawn divider — gives the fixed title a real edge against the scrolling body */}
            <div className="doodle-edge mx-6 shrink-0 border-t-2 border-ink/40" />
            <div ref={bodyRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
              {children}
            </div>
          </div>
        </DoodleBox>
      </motion.div>
    </motion.div>
  )
}
