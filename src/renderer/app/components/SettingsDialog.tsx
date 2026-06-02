import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { AppSettings } from '@shared/types'
import { api } from '../lib/bridge'
import { useStore } from '../store'
import { DoodleBox } from './doodle/DoodleBox'
import { ModalScrim } from './ModalScrim'
import { DoodleToggle } from './doodle/DoodleToggle'

/** One labelled settings row: text + optional hint on the left, a control on the right. */
function SettingRow({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex flex-col">
        <span className="text-base">{label}</span>
        {hint && <span className="text-xs opacity-60">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/**
 * The ⚙️ 设置 dialog. Mirrors the About card's Q-bouncy spring + DoodleBox styling.
 * Reads settings from the main process when opened and writes each toggle through
 * `settings.update` (optimistically updating local state so the switch feels instant).
 */
export function SettingsDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const updateStatus = useStore((s) => s.updateStatus)
  const checkForUpdate = useStore((s) => s.checkForUpdate)

  useEffect(() => {
    if (open) void api.query('settings.get', undefined).then(setSettings)
  }, [open])

  const updateBusy =
    updateStatus.phase === 'checking' ||
    updateStatus.phase === 'downloading' ||
    updateStatus.phase === 'installing'
  const updateLabel =
    updateStatus.phase === 'checking'
      ? '检查中…'
      : updateStatus.phase === 'downloading'
        ? `下载中 ${updateStatus.percent}%`
        : updateStatus.phase === 'installing'
          ? '即将重启安装…'
          : '检查更新'
  const updateHint =
    updateStatus.phase === 'none'
      ? '已是最新版本 ✓'
      : updateStatus.phase === 'error'
        ? `更新失败：${updateStatus.message}`
        : '点击后自动检查、下载、安装并重启（仅安装版）'

  const update = (patch: Partial<AppSettings>): void => {
    setSettings((s) => (s ? { ...s, ...patch } : s)) // optimistic — the switch moves at once
    void api.command('settings.update', { patch }).then(setSettings)
  }

  return (
    <AnimatePresence>
      {open && (
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
              <div className="flex w-80 flex-col gap-1 p-6 font-doodle">
                <div className="mb-2 text-center text-2xl font-bold">设置</div>

                <SettingRow label="关闭后保持后台运行" hint="点关闭只把窗口收进系统托盘，程序继续运行">
                  <DoodleToggle
                    label="关闭后保持后台运行"
                    checked={!!settings?.runInBackground}
                    onChange={(v) => update({ runInBackground: v })}
                  />
                </SettingRow>

                <SettingRow label="开机自动启动" hint="开机时自动在后台启动 DoodlePilot">
                  <DoodleToggle
                    label="开机自动启动"
                    checked={!!settings?.launchAtLogin}
                    onChange={(v) => update({ launchAtLogin: v })}
                  />
                </SettingRow>

                <SettingRow label="检查更新" hint={updateHint}>
                  <button
                    onClick={checkForUpdate}
                    disabled={updateBusy}
                    className="rounded-[8px] border-2 border-ink px-3 py-1 text-sm hover:bg-marker-yellow/40 disabled:opacity-50"
                  >
                    {updateLabel}
                  </button>
                </SettingRow>

                <button
                  onClick={onClose}
                  className="mt-4 self-center rounded-[8px] border-2 border-ink px-5 py-1 text-base hover:bg-marker-yellow/40"
                >
                  好的
                </button>
              </div>
            </DoodleBox>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
