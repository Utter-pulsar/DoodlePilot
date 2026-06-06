import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ScreenshotTranslateConfig } from '@shared/types'
import { api } from '../lib/bridge'
import { DoodleBox } from './doodle/DoodleBox'
import { ModalScrim } from './ModalScrim'
import { DoodleToggle } from './doodle/DoodleToggle'
import { DoodleButton } from './doodle/DoodleButton'
import { ShortcutRecorder } from './ShortcutRecorder'

const fieldCls =
  'w-full rounded-[8px] border-2 border-ink bg-card px-2 py-1 text-sm outline-none disabled:opacity-40'

/**
 * The 截屏翻译 config dialog (separate from the ⚙️ 设置 dialog). Reads the feature config on open
 * and writes each change through `screenshotTranslate.updateConfig` (a DEEP merge — not
 * `settings.update`, which would clobber the nested object). The model fields are only editable
 * when the master toggle is ON; "测试模型能力" probes whether the model accepts images.
 */
export function ScreenshotTranslateDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element {
  const [cfg, setCfg] = useState<ScreenshotTranslateConfig | null>(null)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    if (open) {
      setTestMsg(null)
      void api.query('screenshotTranslate.config', undefined).then(setCfg)
    }
  }, [open])

  // optimistic local update + persist; the returned (authoritative) config replaces local state
  const update = (patch: Partial<ScreenshotTranslateConfig>): void => {
    setCfg((c) => (c ? { ...c, ...patch } : c))
    void api.command('screenshotTranslate.updateConfig', { patch }).then(setCfg)
  }
  const setLocal = (patch: Partial<ScreenshotTranslateConfig>): void =>
    setCfg((c) => (c ? { ...c, ...patch } : c))

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestMsg(null)
    try {
      const r = await api.command('screenshotTranslate.testModel', undefined)
      setTestMsg(r)
      setCfg(await api.query('screenshotTranslate.config', undefined)) // refresh validated flag
    } finally {
      setTesting(false)
    }
  }

  const on = !!cfg?.enabled
  const canTest = on && !testing && !!cfg?.baseUrl && !!cfg?.model

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
              <div className="flex w-96 flex-col gap-3 p-6 font-doodle">
                <div className="text-center text-2xl font-bold">截屏翻译</div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-base">启用截屏翻译</span>
                    <span className="text-xs opacity-60">开启后才能填写模型与快捷键</span>
                  </div>
                  <DoodleToggle
                    label="启用截屏翻译"
                    checked={on}
                    onChange={(v) => update({ enabled: v })}
                  />
                </div>

                <div className="flex flex-col gap-1.5 rounded-[10px] border-2 border-ink/30 p-3">
                  <span className="text-sm opacity-70">模型 API 地址（OpenAI 格式）</span>
                  <input
                    className={fieldCls}
                    disabled={!on}
                    value={cfg?.baseUrl ?? ''}
                    placeholder="https://api.openai.com/v1"
                    onChange={(e) => setLocal({ baseUrl: e.target.value })}
                    onBlur={(e) => update({ baseUrl: e.target.value.trim() })}
                  />
                  <span className="mt-1 text-sm opacity-70">API Key（可选）</span>
                  <input
                    className={fieldCls}
                    disabled={!on}
                    type="password"
                    value={cfg?.apiKey ?? ''}
                    placeholder="sk-…"
                    onChange={(e) => setLocal({ apiKey: e.target.value })}
                    onBlur={(e) => update({ apiKey: e.target.value.trim() })}
                  />
                  <span className="mt-1 text-sm opacity-70">多模态模型名称</span>
                  <input
                    className={fieldCls}
                    disabled={!on}
                    value={cfg?.model ?? ''}
                    placeholder="gpt-4o-mini"
                    onChange={(e) => setLocal({ model: e.target.value })}
                    onBlur={(e) => update({ model: e.target.value.trim() })}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <DoodleButton variant="primary" disabled={!canTest} onClick={() => void test()}>
                      {testing ? '测试中…' : '测试模型能力'}
                    </DoodleButton>
                    {cfg?.validated && <span className="text-sm text-marker-green">已验证 ✓</span>}
                  </div>
                  {testMsg && (
                    <span className={`text-sm ${testMsg.ok ? 'text-marker-green' : 'text-marker-coral'}`}>
                      {testMsg.message}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-base">截屏翻译快捷键</span>
                    <span className="text-xs opacity-60">点击后按下组合键录入</span>
                  </div>
                  <ShortcutRecorder
                    value={cfg?.shortcut ?? ''}
                    disabled={!on}
                    onChange={(s) => update({ shortcut: s })}
                  />
                </div>

                <button
                  onClick={onClose}
                  className="mt-2 self-center rounded-[8px] border-2 border-ink px-5 py-1 text-base hover:bg-marker-yellow/40"
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
