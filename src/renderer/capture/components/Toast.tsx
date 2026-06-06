import { AnimatePresence, motion } from 'framer-motion'

/**
 * A small hand-drawn toast pinned to the bottom of the capture window (e.g. "已复制到剪贴板"). The
 * global `'toast'` event has no renderer anywhere, and the result lives in this separate window, so
 * it carries its own. Controlled: pass `message` (null hides it); the parent clears it on a timer.
 */
export function Toast({ message }: { message: string | null }): JSX.Element {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="pointer-events-none fixed inset-x-0 bottom-12 z-50 flex justify-center"
          initial={{ opacity: 0, y: 10, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 24 }}
        >
          <div className="doodle-edge rounded-full border-2 border-ink bg-card px-4 py-1.5 text-sm text-ink shadow-md">
            {message}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
