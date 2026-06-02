import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppCore } from './context'

/**
 * Manual, fully-automatic self-update via electron-updater against the GitHub Releases feed
 * configured in electron-builder.yml (`publish: github`).
 *
 * POLICY (DoodlePilot): there is NO auto-check and NO confirm prompt. The user presses 检查更新
 * in Settings, which runs the whole flow on its own: check → download (progress shown under the
 * home "DoodlePilot" title via the `update.status` event) → quit (closing any tray-hidden window)
 * → install silently → relaunch. Every step is broadcast as `update.status` so the renderer can
 * narrate it. Only meaningful in a PACKAGED build (dev has no `app-update.yml` feed); macOS is
 * skipped (unsigned builds can't self-update).
 */

function canUpdate(): boolean {
  if (!app.isPackaged) return false // dev has no update feed
  // unsigned macOS builds can't self-update (Squirrel.Mac refuses an app it can't verify)
  if (process.platform === 'darwin') return false
  return true
}

let wired = false
function wireOnce(core: AppCore): void {
  if (wired) return
  wired = true
  // never sneak an install in on a normal quit — installs happen only via our explicit flow below
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => core.broadcast('update.status', { phase: 'checking' }))
  autoUpdater.on('update-not-available', () => core.broadcast('update.status', { phase: 'none' }))
  // a newer version exists → download starts immediately (autoDownload); show 0% right away
  autoUpdater.on('update-available', (i) =>
    core.broadcast('update.status', { phase: 'downloading', percent: 0, version: i.version })
  )
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.max(0, Math.min(100, Math.round(p.percent)))
    core.broadcast('update.status', { phase: 'downloading', percent })
  })
  autoUpdater.on('update-downloaded', (i) => {
    core.broadcast('update.status', { phase: 'installing', version: i.version })
    // let the IPC/event flush, then quit → install silently → relaunch. quitAndInstall(true, true)
    // = silent install + force-run-after; before-quit fires, so the run-in-background close
    // interceptor relents and any tray-hidden window actually closes.
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
  })
  autoUpdater.on('error', (e) =>
    core.broadcast('update.status', { phase: 'error', message: e?.message ?? String(e) })
  )
}

/** Register the manual `update.check` command. The whole download/install/relaunch flow runs off
 *  electron-updater's events (see wireOnce). */
export function registerUpdater(core: AppCore): void {
  core.commands.register('update.check', () => {
    if (!canUpdate()) {
      core.broadcast('update.status', {
        phase: 'error',
        message: app.isPackaged ? '当前平台暂不支持自动更新' : '开发模式下不检查更新'
      })
      return
    }
    wireOnce(core)
    core.broadcast('update.status', { phase: 'checking' })
    autoUpdater
      .checkForUpdates()
      .catch((e) => core.broadcast('update.status', { phase: 'error', message: e?.message ?? String(e) }))
  })
}
