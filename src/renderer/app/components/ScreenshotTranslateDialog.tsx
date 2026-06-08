import { useEffect, useState } from 'react'
import type { ScreenshotTranslateConfig } from '@shared/types'
import { api } from '../lib/bridge'
import { DialogShell } from './DialogShell'
import { DoodleToggle } from './doodle/DoodleToggle'
import { ShortcutRecorder } from './ShortcutRecorder'

/**
 * The 截屏翻译 config dialog. The MODEL now lives in ⚙️ 设置 (shared by every vision feature); this
 * dialog only holds 启用 / 流式输出 / 快捷键. 启用 is gated on the shared model being 已验证 — until
 * then the toggles are disabled and the feature stays off.
 */
export function ScreenshotTranslateDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element {
  const [cfg, setCfg] = useState<ScreenshotTranslateConfig | null>(null)
  const [validated, setValidated] = useState(false)

  useEffect(() => {
    if (open) {
      void api.query('screenshotTranslate.config', undefined).then(setCfg)
      void api.query('visionModel.config', undefined).then((m) => setValidated(m.validated))
    }
  }, [open])

  // optimistic local update + persist; the returned (authoritative) config replaces local state
  const update = (patch: Partial<ScreenshotTranslateConfig>): void => {
    setCfg((c) => (c ? { ...c, ...patch } : c))
    void api.command('screenshotTranslate.updateConfig', { patch }).then(setCfg)
  }

  const enabled = !!cfg?.enabled
  const on = enabled && validated // effective: needs both the toggle AND a validated model

  return (
    <DialogShell open={open} onClose={onClose} title="截屏翻译">
      {!validated && (
        <div className="rounded-[8px] border-2 border-dashed border-ink/40 px-3 py-2 text-xs opacity-70">
          请先在「设置」里配置并验证多模态模型，才能启用截屏翻译。
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-base">启用截屏翻译</span>
          <span className="text-xs opacity-60">用快捷键框选屏幕区域即可翻译</span>
        </div>
        <DoodleToggle
          label="启用截屏翻译"
          checked={on}
          disabled={!validated}
          onChange={(v) => update({ enabled: v })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-base">流式输出</span>
          <span className="text-xs opacity-60">
            开启：边生成边显示（公式实时渲染）。关闭：等全部生成完再一起显示
          </span>
        </div>
        <DoodleToggle
          label="流式输出"
          checked={cfg?.stream ?? true}
          disabled={!on}
          onChange={(v) => update({ stream: v })}
        />
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
        className="mx-auto mt-2 block rounded-[8px] border-2 border-ink px-5 py-1 text-base hover:bg-marker-yellow/40"
      >
        好的
      </button>
    </DialogShell>
  )
}
