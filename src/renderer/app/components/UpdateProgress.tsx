import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'

/**
 * The self-update status line, tucked under the "DoodlePilot" home title. It narrates the manual
 * 检查更新 flow (checking → downloading X% → installing) and briefly flashes "已是最新版本" / an
 * error before fading. Driven entirely by the store's `updateStatus` (pushed from main).
 */
export function UpdateProgress(): JSX.Element {
  const status = useStore((s) => s.updateStatus)
  const [show, setShow] = useState(true)

  // terminal states (none / error) auto-dismiss after a few seconds; live states stay put
  useEffect(() => {
    setShow(true)
    if (status.phase === 'none' || status.phase === 'error') {
      const t = setTimeout(() => setShow(false), 5000)
      return () => clearTimeout(t)
    }
    return undefined
  }, [status])

  const visible = show && status.phase !== 'idle'

  const text =
    status.phase === 'checking'
      ? '检查更新中…'
      : status.phase === 'downloading'
        ? `下载中 ${status.percent}%`
        : status.phase === 'installing'
          ? '即将重启安装…'
          : status.phase === 'none'
            ? '已是最新版本 ✓'
            : status.phase === 'error'
              ? '更新失败'
              : ''

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="flex items-center gap-2 font-doodle text-xs opacity-70"
          initial={{ opacity: 0, y: -4, height: 0 }}
          animate={{ opacity: 0.7, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.2 }}
          title={status.phase === 'error' ? status.message : undefined}
        >
          <span>{text}</span>
          {status.phase === 'downloading' && (
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-ink/15">
              <span
                className="block h-full rounded-full bg-marker-blue transition-[width] duration-150"
                style={{ width: `${status.percent}%` }}
              />
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
