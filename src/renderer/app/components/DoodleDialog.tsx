import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'
import { DoodleBox } from './doodle/DoodleBox'
import { DoodleButton } from './doodle/DoodleButton'

/**
 * In-app prompt / confirm modal — replaces window.prompt (unsupported in Electron) and
 * window.confirm (a jarring native dialog). Driven by the store's `dialog` + askPrompt/askConfirm.
 */
export function DoodleDialog(): JSX.Element {
  const dialog = useStore((s) => s.dialog)
  const [text, setText] = useState('')

  useEffect(() => {
    if (dialog?.kind === 'prompt') setText(dialog.defaultValue)
  }, [dialog])

  const close = (value: string | boolean | null): void => {
    dialog?.resolve(value)
    useStore.setState({ dialog: null })
  }
  const cancelValue = dialog?.kind === 'prompt' ? null : false

  return (
    <AnimatePresence>
      {dialog && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center font-doodle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/50" onClick={() => close(cancelValue)} />
          <motion.div
            className="relative"
            initial={{ scale: 0.85, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 18 }}
          >
            <DoodleBox fill="--card" fillStyle="solid">
              <div className="flex w-80 flex-col gap-3 p-5">
                <p className="text-base">{dialog.title}</p>
                {dialog.kind === 'prompt' && (
                  <input
                    autoFocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') close(text)
                      else if (e.key === 'Escape') close(null)
                    }}
                    className="w-full rounded-[8px] border-2 border-ink bg-card px-3 py-1.5 outline-none"
                  />
                )}
                <div className="flex justify-end gap-2">
                  <DoodleButton variant="ghost" onClick={() => close(cancelValue)}>
                    取消
                  </DoodleButton>
                  <DoodleButton
                    variant="primary"
                    onClick={() => close(dialog.kind === 'prompt' ? text : true)}
                  >
                    确定
                  </DoodleButton>
                </div>
              </div>
            </DoodleBox>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
