import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { AppSettings, SavedVisionModel, VisionModelConfig } from '@shared/types'
import { api } from '../lib/bridge'
import { DialogShell } from './DialogShell'
import { DoodleToggle } from './doodle/DoodleToggle'
import { DoodleButton } from './doodle/DoodleButton'

const fieldCls =
  'w-full rounded-[8px] border-2 border-ink bg-card px-2 py-1 text-sm outline-none'

/**
 * The shared multimodal-model config: API 地址 / Key / 模型名 + 测试模型能力 + a persistent 已验证
 * badge. One model powers every vision feature (截屏翻译 / 截屏分析); a feature can only be enabled
 * once this is validated, and changing any field here clears 已验证 (re-test required).
 */
function ModelSection(): JSX.Element {
  const [cfg, setCfg] = useState<VisionModelConfig | null>(null)
  const [presets, setPresets] = useState<SavedVisionModel[]>([])
  const [activeId, setActiveId] = useState('')
  const [showKey, setShowKey] = useState(false) // reveal the API key
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null)

  // collapse/expand: hover expands; clicking inside the body PINS it open; clicking the title
  // collapses (and suppresses re-hover until the mouse leaves and comes back).
  const [hovering, setHovering] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [suppress, setSuppress] = useState(false)
  const expanded = pinned || (hovering && !suppress)
  // the model-preset dropdown: pure hover (no pin) — open on enter, close on leave
  const [dropOpen, setDropOpen] = useState(false)

  const refreshPresets = async (): Promise<void> => {
    const r = await api.query('visionModel.presets', undefined)
    setPresets(r.presets)
    setActiveId(r.activeId)
  }
  useEffect(() => {
    void api.query('visionModel.config', undefined).then(setCfg)
    void refreshPresets()
  }, [])

  const setLocal = (patch: Partial<VisionModelConfig>): void =>
    setCfg((c) => (c ? { ...c, ...patch } : c))
  const update = (patch: Partial<VisionModelConfig>): void => {
    setLocal(patch) // optimistic
    void api.command('visionModel.updateConfig', { patch }).then((c) => {
      setCfg(c)
      void refreshPresets() // the edited model's label in the dropdown follows
    })
  }
  const test = async (): Promise<void> => {
    setTesting(true)
    setTestMsg(null)
    try {
      setTestMsg(await api.command('visionModel.testModel', undefined))
      setCfg(await api.query('visionModel.config', undefined)) // refresh validated flag
      void refreshPresets()
    } finally {
      setTesting(false)
    }
  }
  const canTest = !testing && !!cfg?.baseUrl && !!cfg?.model

  // ---- presets: selecting shows that model's fields; 添加 makes a fresh blank model ----
  const applyPresetResult = async (r: {
    presets: SavedVisionModel[]
    activeId: string
  }): Promise<void> => {
    setPresets(r.presets)
    setActiveId(r.activeId)
    setCfg(await api.query('visionModel.config', undefined)) // refresh the form to the new selection
  }
  const selectPreset = (id: string): void => {
    setDropOpen(false)
    void api.command('visionModel.selectPreset', { id }).then(applyPresetResult)
  }
  const addModel = (): void => {
    setDropOpen(false)
    setShowKey(false)
    void api.command('visionModel.addPreset', undefined).then(applyPresetResult)
  }
  const deletePreset = (id: string): void => {
    void api.command('visionModel.deletePreset', { id }).then(applyPresetResult)
  }

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => {
        setHovering(false)
        setSuppress(false)
        setDropOpen(false)
      }}
      className="rounded-[10px] border-2 border-ink/30"
    >
      {/* title row — always visible; click collapses (the body pins via its own handler) */}
      <button
        type="button"
        onClick={() => {
          setPinned(false)
          setSuppress(true)
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-base"
      >
        <span>多模态模型</span>
        {cfg?.validated && <span className="text-xs text-marker-green">已验证 ✓</span>}
        <motion.span className="ml-auto text-sm opacity-50" animate={{ rotate: expanded ? 90 : 0 }}>
          ▸
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { type: 'spring', stiffness: 320, damping: 26 },
              opacity: { duration: 0.15 }
            }}
            style={{ overflow: 'hidden' }}
            // any interaction inside the body keeps it pinned open
            onPointerDownCapture={() => setPinned(true)}
          >
            <div className="flex flex-col gap-1.5 px-3 pb-3">
              {/* description on the LEFT, the model picker dropdown on the RIGHT */}
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs opacity-60">
                  截屏翻译 / 截屏分析 共用，验证通过后才能启用相应功能
                </span>
                <div
                  className="relative shrink-0"
                  onMouseEnter={() => setDropOpen(true)}
                  onMouseLeave={() => setDropOpen(false)}
                >
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-[8px] border-2 border-ink bg-card px-2 py-0.5 text-xs"
                    title="选择 / 管理已保存的模型"
                  >
                    <span className="max-w-[120px] truncate">{cfg?.model || '选择模型'}</span>
                    <span className="opacity-50">▾</span>
                  </button>
                  <AnimatePresence>
                    {dropOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.96 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                        className="absolute right-0 z-20 mt-1 w-52 origin-top-right"
                      >
                        <div className="max-h-56 overflow-y-auto rounded-[10px] border-2 border-ink bg-paper p-1 shadow-doodle">
                          {presets.length === 0 && (
                            <div className="px-2 py-1 text-xs opacity-50">还没有保存的模型</div>
                          )}
                          {presets.map((p) => (
                            <div
                              key={p.id}
                              className={`flex items-center gap-1 rounded px-1 ${
                                p.id === activeId ? 'bg-marker-yellow/30' : 'hover:bg-ink/5'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => selectPreset(p.id)}
                                className="min-w-0 flex-1 truncate py-1 text-left text-sm"
                                title={`${p.model || '（未命名）'}\n${p.baseUrl}`}
                              >
                                {p.model || '未命名'}
                                {p.validated && <span className="text-marker-green"> ✓</span>}
                              </button>
                              <button
                                type="button"
                                onClick={() => deletePreset(p.id)}
                                title="删除这个模型"
                                className="shrink-0 px-1 opacity-40 hover:opacity-100"
                              >
                                🗑️
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={addModel}
                            className="mt-1 block w-full rounded-[8px] border-2 border-dashed border-ink/40 px-2 py-1 text-xs hover:bg-ink/5"
                          >
                            ＋ 添加新模型
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <span className="mt-1 text-sm opacity-70">模型 API 地址（OpenAI 格式）</span>
              <input
                className={fieldCls}
                value={cfg?.baseUrl ?? ''}
                placeholder="https://api.openai.com/v1"
                onChange={(e) => setLocal({ baseUrl: e.target.value })}
                onBlur={(e) => update({ baseUrl: e.target.value.trim() })}
              />
              <span className="mt-1 text-sm opacity-70">API Key（可选）</span>
              <div className="relative">
                <input
                  className={`${fieldCls} pr-9`}
                  type={showKey ? 'text' : 'password'}
                  value={cfg?.apiKey ?? ''}
                  placeholder="sk-…"
                  onChange={(e) => setLocal({ apiKey: e.target.value })}
                  onBlur={(e) => update({ apiKey: e.target.value.trim() })}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  title={showKey ? '隐藏' : '显示'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-sm opacity-50 hover:opacity-100"
                >
                  {showKey ? '🙈' : '👁'}
                </button>
              </div>
              <span className="mt-1 text-sm opacity-70">多模态模型名称</span>
              <input
                className={fieldCls}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

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

  useEffect(() => {
    if (open) void api.query('settings.get', undefined).then(setSettings)
  }, [open])

  const update = (patch: Partial<AppSettings>): void => {
    setSettings((s) => (s ? { ...s, ...patch } : s)) // optimistic — the switch moves at once
    void api.command('settings.update', { patch }).then(setSettings)
  }

  return (
    <DialogShell open={open} onClose={onClose} title="设置">
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

      <ModelSection />

      <button
        onClick={onClose}
        className="mx-auto mt-2 block rounded-[8px] border-2 border-ink px-5 py-1 text-base hover:bg-marker-yellow/40"
      >
        好的
      </button>
    </DialogShell>
  )
}
