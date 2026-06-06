import { join } from 'node:path'
import { BrowserWindow, Menu, Tray, app, nativeImage, screen, type Display } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { EventMap } from '@shared/api/contract'
import { IPC } from '@shared/api/channels'
import type { AppCore } from '../services/context'

const PRELOAD = join(__dirname, '../preload/index.js')

/** Resolve a renderer entry to a dev-server URL or a packaged file path. A `displayId` (used by the
 *  per-display capture windows) is passed through as a `?d=<id>` query so each window knows which
 *  screen it covers (the generic IPC drops the event sender, so we can't derive it server-side). */
function loadEntry(
  win: BrowserWindow,
  entry: 'app' | 'overlay' | 'capture',
  displayId?: number
): void {
  const qs = displayId !== undefined ? `?d=${displayId}` : ''
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${entry}/index.html${qs}`)
  } else {
    void win.loadFile(
      join(__dirname, `../renderer/${entry}/index.html`),
      displayId !== undefined ? { query: { d: String(displayId) } } : undefined
    )
  }
}

interface DisplayLayout {
  unionX: number
  unionY: number
  width: number
  height: number
  primary: { x: number; y: number; width: number; height: number }
}

export class WindowManager {
  private main: BrowserWindow | null = null
  private overlay: BrowserWindow | null = null
  private tray: Tray | null = null
  // one transparent, focusable window per display during a 截屏翻译 region capture (keyed by display id)
  private captureWins = new Map<number, BrowserWindow>()
  private focusBeforeCapture: BrowserWindow | null = null
  /** fired when ALL capture windows vanish UNEXPECTEDLY (Alt+F4 / crash / load fail, not our own
   *  close) — the screenshot service uses it to reset its capturing session so the hotkey recovers */
  onCaptureGone: (() => void) | null = null
  private layout: DisplayLayout
  private readonly core: AppCore
  // flipped on ANY quit path (tray "退出", Cmd+Q, OS shutdown) so the main-window 'close'
  // handler lets the window actually close instead of re-hiding it to the tray.
  private quitting = false

  constructor(core: AppCore) {
    this.core = core
    this.layout = WindowManager.computeLayout()

    // a real quit fires before-quit BEFORE the windows receive 'close', so flagging here
    // guarantees the close handler sees it and does not intercept the close.
    app.on('before-quit', () => {
      this.quitting = true
    })

    // the overlay toggles its own click-through as the cursor enters/leaves sprites
    core.commands.register('overlay.setInteractive', ({ interactive }) => {
      if (!this.overlay || this.overlay.isDestroyed()) return
      this.overlay.setIgnoreMouseEvents(!interactive, { forward: true })
    })

    // renderer asks for the multi-display geometry (overlay spans all screens)
    core.queries.register('overlay.layout', () => ({
      width: this.layout.width,
      height: this.layout.height,
      primary: this.layout.primary
    }))

    // app metadata for the title-bar "版本" popup (also queryable by a future AI/harness)
    core.queries.register('app.info', () => ({
      name: 'DoodlePilot',
      version: app.getVersion(),
      author: 'Utter_pulsar'
    }))

    // custom (renderer-drawn) window controls for the frameless Win/Linux window
    core.commands.register('window.minimize', () => this.main?.minimize())
    core.commands.register('window.toggleMaximize', () => {
      const w = this.main
      if (!w || w.isDestroyed()) return
      if (w.isMaximized()) w.unmaximize()
      else w.maximize()
    })
    core.commands.register('window.close', () => this.main?.close())
    core.queries.register('window.isMaximized', () => this.main?.isMaximized() ?? false)

    // ---- app settings: read + write (the write applies tray / login-item side effects) ----
    core.queries.register('settings.get', () => ({ ...core.store.data.settings }))
    core.commands.register('settings.update', ({ patch }) => {
      core.store.mutate((db) => {
        db.settings = { ...db.settings, ...patch }
      })
      // launch-at-login is a real OS registration; only touch it in a packaged build so a
      // dev run never registers the throwaway electron-dev binary as a startup item.
      if (patch.launchAtLogin !== undefined && app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin })
      }
      // create/destroy the tray to match the new run-in-background state
      if (patch.runInBackground !== undefined) this.syncTray()
      return { ...core.store.data.settings }
    })

    // every time a banner launches, re-stake the overlay's place on top so the plane can't end up
    // flying behind a window that grabbed topmost since (always-on-top can get bumped on Windows)
    core.events.on('overlay.banner', () => this.assertOverlayTop())
  }

  /**
   * Primary display only. A single transparent always-on-top window spanning multiple
   * monitors fails to composite reliably on Windows (renders blank/partial), so we keep
   * the overlay on the primary display. Multi-screen would need one window per display.
   */
  private static computeLayout(): DisplayLayout {
    const b = screen.getPrimaryDisplay().bounds
    return {
      unionX: b.x,
      unionY: b.y,
      width: b.width,
      height: b.height,
      primary: { x: 0, y: 0, width: b.width, height: b.height }
    }
  }

  createAll(): void {
    this.createMainWindow()
    this.createOverlayWindow()
    // restore the tray if a previous session left run-in-background enabled
    this.syncTray()
  }

  /** Send a business event to every renderer window — including any live capture windows (they
   *  receive their frozen frame via the `capture.frame` event). */
  broadcast<K extends keyof EventMap>(name: K, payload: EventMap[K]): void {
    for (const win of [this.main, this.overlay, ...this.captureWins.values()]) {
      if (win && !win.isDestroyed()) win.webContents.send(IPC.EVENT, { name, payload })
    }
  }

  private createMainWindow(): void {
    this.main = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 900,
      minHeight: 600,
      title: 'DoodlePilot',
      backgroundColor: '#FBF7EF',
      autoHideMenuBar: true,
      // hide the OS title bar. On Win/Linux the window is frameless and the renderer draws its
      // own min/max/close (so they dim with the page — no native-overlay colour flash); on
      // macOS 'hidden' keeps the native traffic lights top-left.
      titleBarStyle: 'hidden',
      ...(is.dev ? { icon: join(process.cwd(), 'build', 'icon.png') } : {}),
      show: false,
      webPreferences: { preload: PRELOAD, sandbox: false }
    })
    // Reveal as soon as ready. Prefer ready-to-show (no white flash), but also show on
    // did-finish-load and finally a timeout, so the window can never get stuck hidden.
    const reveal = (): void => {
      if (this.main && !this.main.isDestroyed() && !this.main.isVisible()) this.main.show()
    }
    this.main.on('ready-to-show', reveal)
    this.main.webContents.on('did-finish-load', reveal)
    this.main.webContents.on('did-fail-load', (_e, code, desc, url) =>
      console.log(`[main] app did-fail-load code=${code} "${desc}" url=${url}`)
    )
    setTimeout(reveal, 2500)
    // Windows shutdown/logout does NOT fire app 'before-quit', so flag the quit here too
    // (otherwise the close handler would pointlessly hide a window the OS is destroying) and
    // flush state synchronously, since the normal before-quit cleanup won't run on session-end.
    this.main.on('session-end', () => {
      this.quitting = true
      this.core.store.flush()
    })
    // run-in-background: intercept the close and hide to the tray instead of quitting.
    // 'close' fires before 'closed' (which destroys the window), so we preventDefault here.
    this.main.on('close', (e) => {
      if (!this.quitting && this.core.store.data.settings.runInBackground) {
        e.preventDefault()
        this.main?.hide()
        if (process.platform === 'darwin') app.dock?.hide()
      }
    })
    this.main.on('closed', () => {
      this.main = null
      // when NOT running in background, closing the main window exits the whole app
      // (overlay included). On a real quit the app is already on its way out.
      if (!this.quitting) app.quit()
    })
    // keep the renderer's maximize/restore icon in sync with the real window state
    const emitMaximized = (): void =>
      this.core.events.emit('window.maximized', this.main?.isMaximized() ?? false)
    this.main.on('maximize', emitMaximized)
    this.main.on('unmaximize', emitMaximized)
    // In dev, surface renderer console warnings/errors in the terminal so we never
    // have to guess why the window is blank. Press F12 for full DevTools.
    if (is.dev) {
      this.main.webContents.on('console-message', (_e, level, message, line, source) => {
        if (level >= 2) console.log(`[renderer] ${message} (${source}:${line})`)
      })
    }
    loadEntry(this.main, 'app')
  }

  private createOverlayWindow(): void {
    const L = this.layout // primary display
    this.overlay = new BrowserWindow({
      x: L.unionX,
      y: L.unionY,
      width: L.width,
      height: L.height,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      fullscreenable: false,
      alwaysOnTop: true,
      webPreferences: { preload: PRELOAD, sandbox: false }
    })
    if (is.dev) {
      this.overlay.webContents.on('console-message', (_e, _level, message, line, source) => {
        console.log(`[overlay] ${message} (${source}:${line})`)
      })
    }
    // 'screen-saver' is the highest always-on-top band: a reminder plane must fly OVER other apps.
    // A plain 'floating' overlay was occasionally getting covered (e.g. by another topmost window).
    this.overlay.setAlwaysOnTop(true, 'screen-saver')
    this.overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // start fully click-through; forward:true still delivers mousemove for hit-testing
    this.overlay.setIgnoreMouseEvents(true, { forward: true })
    this.overlay.on('closed', () => {
      this.overlay = null
    })
    loadEntry(this.overlay, 'overlay')
  }

  /** Re-assert the overlay as the topmost window. Always-on-top windows on Windows can get shoved
   *  under a newly-created topmost window (another app, a fullscreen toggle) — exactly when a
   *  banner would otherwise fly behind it — so we re-claim the top each time one launches. */
  private assertOverlayTop(): void {
    const o = this.overlay
    if (!o || o.isDestroyed()) return
    o.setAlwaysOnTop(true, 'screen-saver')
    o.moveTop()
  }

  /**
   * Open ONE transparent, focusable capture window per display (a single transparent window can't
   * span monitors reliably on Windows — same reason the overlay is primary-only). Each window gets
   * `?d=<id>` so it can pull its own frozen frame via `capture.context`. The user drags a selection
   * over the frozen image; ESC / mouse-up route back through the service.
   */
  openCaptureWindows(displays: Display[]): void {
    this.closeCaptureWindows()
    this.focusBeforeCapture = BrowserWindow.getFocusedWindow()
    for (const d of displays) {
      const win = new BrowserWindow({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        // NOT transparent: a transparent window can't render past the PRIMARY display's height on
        // Windows, so a taller secondary monitor got clipped (only the top ~2/3 was usable). The
        // frozen-frame image fills the whole window, so we don't need see-through; a dark backdrop
        // just covers the brief load-in.
        transparent: false,
        backgroundColor: '#0a0a0a',
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        hasShadow: false,
        fullscreenable: false,
        alwaysOnTop: true,
        focusable: true, // UNLIKE the overlay — the user interacts (drag-select, ESC)
        // start FULLY TRANSPARENT (not show:false): the window is already shown, so revealing it is
        // just setOpacity(1) — no Windows window-open zoom/fade animation. And at opacity 0 it's
        // invisible to the desktop screenshot taken right now (DWM composites it as fully clear).
        opacity: 0,
        webPreferences: { preload: PRELOAD, sandbox: false }
      })
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height })
      if (is.dev) {
        win.webContents.on('console-message', (_e, _level, message) => console.log(`[capture] ${message}`))
      }
      win.on('closed', () => {
        // Only an UNEXPECTED close fires onCaptureGone: deliberate closes (closeCaptureWindows /
        // keepOnlyCaptureWindow) remove the window from the map BEFORE calling close(), so by the
        // time their 'closed' fires it's no longer tracked here.
        if (this.captureWins.get(d.id) === win) {
          this.captureWins.delete(d.id)
          if (this.captureWins.size === 0) this.onCaptureGone?.()
        }
      })
      loadEntry(win, 'capture', d.id)
      this.captureWins.set(d.id, win)
    }
  }

  /** Close every capture window and hand focus back to whatever held it before the capture. */
  closeCaptureWindows(): void {
    const wins = [...this.captureWins.values()]
    this.captureWins.clear() // remove first → the 'closed' handlers treat this as a deliberate close
    for (const w of wins) if (!w.isDestroyed()) w.close()
    const back = this.focusBeforeCapture
    this.focusBeforeCapture = null
    if (back && !back.isDestroyed()) back.focus()
  }

  /** Reveal the transparent capture windows once their frozen frames are ready (just fade opacity
   *  to 1 — no window-open animation); focus the first so it receives the ESC keydown. */
  showCaptureWindows(): void {
    let first = true
    for (const w of this.captureWins.values()) {
      if (w.isDestroyed()) continue
      w.setOpacity(1)
      if (first) {
        w.focus()
        first = false
      }
    }
  }

  /** Close every capture window EXCEPT the one on `displayId` — it stays to show the result. */
  keepOnlyCaptureWindow(displayId: number): void {
    for (const [id, w] of [...this.captureWins]) {
      if (id !== displayId) {
        this.captureWins.delete(id) // remove first → deliberate close, won't trip onCaptureGone
        if (!w.isDestroyed()) w.close()
      }
    }
  }

  getMain(): BrowserWindow | null {
    return this.main
  }

  /** Restore (or recreate) the main window and bring it to the front — used by the tray. */
  showMain(): void {
    if (this.main && !this.main.isDestroyed()) {
      if (this.main.isMinimized()) this.main.restore()
      this.main.show()
      this.main.focus()
    } else {
      this.createMainWindow()
    }
    if (process.platform === 'darwin') app.dock?.show()
  }

  /** Create the tray when running in background, destroy it otherwise. Safe to call anytime. */
  private syncTray(): void {
    const enabled = this.core.store.data.settings.runInBackground
    if (enabled && !this.tray) this.createTray()
    else if (!enabled && this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }

  private createTray(): void {
    // assets/ ships to resources/assets in production (see electron-builder.yml); in dev it's
    // read from the project root. The 128px logo is downscaled to a tray-appropriate size.
    const iconPath = is.dev
      ? join(process.cwd(), 'assets', 'logo.png')
      : join(process.resourcesPath, 'assets', 'logo.png')
    const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    // createFromPath returns an EMPTY image (it does not throw) if the file is missing, which
    // yields a blank tray icon — surface it so a packaging regression is visible in the logs.
    if (image.isEmpty()) console.warn(`[tray] icon failed to load from ${iconPath}`)
    const tray = new Tray(image)
    tray.setToolTip('DoodlePilot')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示 DoodlePilot', click: () => this.showMain() },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() }
      ])
    )
    // Windows: a single left-click on the tray icon restores the window
    tray.on('click', () => this.showMain())
    this.tray = tray
  }
}
