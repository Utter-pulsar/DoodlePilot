import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppCore } from './context'

let wired = false

/**
 * Auto-update via electron-updater against the GitHub Releases feed configured in
 * electron-builder.yml (`publish: github`). Only meaningful in a PACKAGED build — a dev
 * run has no `app-update.yml` feed, so this no-ops. Also gated by the `autoUpdate` setting.
 *
 * Behaviour (electron-updater defaults): the newer version downloads in the background and
 * installs the next time the app quits (autoInstallOnAppQuit), and `...AndNotify` shows a
 * native "update ready" notification. Nothing is force-restarted mid-session.
 */
export function checkForUpdatesIfEnabled(core: AppCore): void {
  if (!app.isPackaged) return // dev has no update feed
  // Unsigned macOS builds cannot self-update — Squirrel.Mac refuses to swap in an app whose
  // code signature it can't validate — so skip darwin until signing + notarization is set up
  // (CSC_LINK / APPLE_ID in electron-builder.yml + build.yml). This avoids a misleading
  // "update ready" notification that could never install. Win (NSIS) / Linux (AppImage) are fine.
  if (process.platform === 'darwin') return
  if (!core.store.data.settings.autoUpdate) return

  if (!wired) {
    wired = true
    autoUpdater.on('error', (e) => console.warn('[updater] error:', e?.message ?? e))
    autoUpdater.on('update-available', (i) => console.log('[updater] update available:', i.version))
    autoUpdater.on('update-downloaded', (i) => console.log('[updater] downloaded:', i.version))
  }

  autoUpdater.checkForUpdatesAndNotify().catch((e) => console.warn('[updater] check failed:', e?.message ?? e))
}
