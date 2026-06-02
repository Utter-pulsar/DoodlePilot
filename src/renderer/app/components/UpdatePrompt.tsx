import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'
import { DoodleBox } from './doodle/DoodleBox'
import { DoodleButton } from './doodle/DoodleButton'

/**
 * A non-blocking, Q-bouncy card pinned bottom-right that appears once a new version has finished
 * downloading. The user must accept (立即更新 → quit + install + relaunch); 稍后 just hides it and
 * it re-appears on the next launch. Driven entirely by the store's `updateVersion`.
 */
export function UpdatePrompt(): JSX.Element {
  const version = useStore((s) => s.updateVersion)
  const install = useStore((s) => s.installUpdate)
  const dismiss = useStore((s) => s.dismissUpdate)

  return (
    <AnimatePresence>
      {version && (
        <motion.div
          className="pointer-events-auto fixed bottom-5 right-5 z-[55] font-doodle"
          initial={{ opacity: 0, y: 24, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 380, damping: 18 }}
        >
          <DoodleBox fill="--card" fillStyle="solid">
            <div className="flex w-64 flex-col gap-2 p-4">
              <div className="text-base font-bold">✨ 有新版本啦</div>
              <div className="text-sm opacity-70">
                版本 {version} 已下载，点「立即更新」会重启 DoodlePilot 完成安装。
              </div>
              <div className="mt-1 flex justify-end gap-2">
                <DoodleButton variant="ghost" onClick={dismiss}>
                  稍后
                </DoodleButton>
                <DoodleButton variant="primary" onClick={install}>
                  立即更新
                </DoodleButton>
              </div>
            </div>
          </DoodleBox>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
