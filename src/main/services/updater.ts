import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppCore } from './context'

/**
 * Auto-update via electron-updater against the GitHub Releases feed configured in
 * electron-builder.yml (`publish: github`). Only meaningful in a PACKAGED build — a dev
 * run has no `app-update.yml` feed, so the check no-ops. Also gated by the `autoUpdate` setting.
 *
 * POLICY (DoodlePilot): a newer version downloads in the background, and when the download
 * finishes we surface an in-app prompt — we do NOT install silently. Install happens ONLY when
 * the user explicitly accepts (`update.install` → quitAndInstall). `autoInstallOnAppQuit` is
 * therefore turned OFF, so:
 *   • a normal quit (tray「退出」/ shutdown) never sneaks the update in;
 *   • "稍后" just hides the prompt — the cached download is re-detected on the NEXT launch and
 *     re-prompts (the `dismissed` flag resets every process start);
 *   • turning the autoUpdate setting OFF drops the pending prompt and never surfaces/installs it
 *     again until it's turned back on.
 * macOS is skipped entirely (unsigned builds can't self-update).
 */

// the version electron-updater has finished downloading and cached on disk, awaiting the user's
// OK. Survives a "稍后" (we just stop surfacing it); cleared when autoUpdate is turned off.
let pendingVersion: string | null = null
// "稍后" suppresses the prompt for THIS process only — a real relaunch resets it to false, which
// is what makes "remind me next launch" work.
let dismissed = false
let wired = false

function isEligible(core: AppCore): boolean {
  if (!app.isPackaged) return false // dev has no update feed
  // Unsigned macOS builds cannot self-update — Squirrel.Mac refuses to swap in an app whose
  // signature it can't validate — so skip darwin until signing + notarization is set up.
  if (process.platform === 'darwin') return false
  return core.store.data.settings.autoUpdate
}

/** Register the self-update query/commands and lock in the "install only on accept" policy. */
export function registerUpdater(core: AppCore): void {
  // never install silently on quit — only on an explicit user accept (see POLICY above)
  autoUpdater.autoInstallOnAppQuit = false

  // the renderer pulls current state on mount (covers an update that finished downloading before
  // the window subscribed, or a window reopened from the tray)
  core.queries.register('update.pending', () =>
    pendingVersion && !dismissed && core.store.data.settings.autoUpdate
      ? { version: pendingVersion }
      : null
  )

  // user accepted → quit every window, run the installer, relaunch into the new version
  core.commands.register('update.install', () => {
    if (!pendingVersion || !core.store.data.settings.autoUpdate) return // guard: nothing/disabled
    // let the IPC reply flush before we tear the app down to run the installer
    setImmediate(() => autoUpdater.quitAndInstall())
  })

  // "稍后" → suppress for this session; the cached download re-prompts on the next launch
  core.commands.register('update.dismiss', () => {
    dismissed = true
    core.broadcast('update.changed', null)
  })
}

/** Drop any pending update prompt — called when the user turns autoUpdate OFF. */
export function clearPendingUpdate(core: AppCore): void {
  pendingVersion = null
  core.broadcast('update.changed', null)
}

/**
 * Check GitHub for a newer release (and auto-download it). Called at startup and whenever the
 * user turns the autoUpdate setting on. No-ops unless packaged + non-mac + setting enabled.
 */
export function checkForUpdatesIfEnabled(core: AppCore): void {
  if (!isEligible(core)) return
  dismissed = false // a fresh check (startup, or the user re-enabling) re-arms the prompt
  // already downloaded earlier this session? re-surface it right away (e.g. just re-enabled)
  if (pendingVersion) core.broadcast('update.changed', { version: pendingVersion })

  if (!wired) {
    wired = true
    autoUpdater.on('error', (e) => console.warn('[updater] error:', e?.message ?? e))
    autoUpdater.on('update-available', (i) => console.log('[updater] update available:', i.version))
    autoUpdater.on('update-downloaded', (i) => {
      pendingVersion = i.version
      console.log('[updater] downloaded:', i.version)
      // surface the in-app prompt (unless dismissed this session or autoUpdate was turned off)
      if (!dismissed && core.store.data.settings.autoUpdate) {
        core.broadcast('update.changed', { version: i.version })
      }
    })
  }

  // checkForUpdates (not ...AndNotify): auto-downloads but shows NO native notification — our own
  // in-app prompt fires on 'update-downloaded' instead.
  autoUpdater.checkForUpdates().catch((e) => console.warn('[updater] check failed:', e?.message ?? e))
}
