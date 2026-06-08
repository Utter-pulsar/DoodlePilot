import { useEffect, useState } from 'react'
import type { AppSettings, VisionModelConfig } from '@shared/types'
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
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    void api.query('visionModel.config', undefined).then(setCfg)
  }, [])

  const setLocal = (patch: Partial<VisionModelConfig>): void =>
    setCfg((c) => (c ? { ...c, ...patch } : c))
  const update = (patch: Partial<VisionModelConfig>): void => {
    setLocal(patch) // optimistic
    void api.command('visionModel.updateConfig', { patch }).then(setCfg)
  }
  const test = async (): Promise<void> => {
    setTesting(true)
    setTestMsg(null)
    try {
      setTestMsg(await api.command('visionModel.testModel', undefined))
      setCfg(await api.query('visionModel.config', undefined)) // refresh validated flag
    } finally {
      setTesting(false)
    }
  }
  const canTest = !testing && !!cfg?.baseUrl && !!cfg?.model

  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border-2 border-ink/30 p-3">
      <span className="text-base">多模态模型</span>
      <span className="-mt-1 text-xs opacity-60">截屏翻译 / 截屏分析 共用，验证通过后才能启用相应功能</span>
      <span className="mt-1 text-sm opacity-70">模型 API 地址（OpenAI 格式）</span>
      <input
        className={fieldCls}
        value={cfg?.baseUrl ?? ''}
        placeholder="https://api.openai.com/v1"
        onChange={(e) => setLocal({ baseUrl: e.target.value })}
        onBlur={(e) => update({ baseUrl: e.target.value.trim() })}
      />
      <span className="mt-1 text-sm opacity-70">API Key（可选）</span>
      <input
        className={fieldCls}
        type="password"
        value={cfg?.apiKey ?? ''}
        placeholder="sk-…"
        onChange={(e) => setLocal({ apiKey: e.target.value })}
        onBlur={(e) => update({ apiKey: e.target.value.trim() })}
      />
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
