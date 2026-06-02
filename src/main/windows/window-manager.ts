import { join } from 'node:path'
import { BrowserWindow, Menu, Tray, app, nativeImage, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { EventMap } from '@shared/api/contract'
import { IPC } from '@shared/api/channels'
import type { AppCore } from '../services/context'

const PRELOAD = join(__dirname, '../preload/index.js')

/** Resolve a renderer entry to a dev-server URL or a packaged file path. */
function loadEntry(win: BrowserWindow, entry: 'app' | 'overlay'): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${entry}/index.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${entry}/index.html`))
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

  /** Send a business event to every renderer window. */
  broadcast<K extends keyof EventMap>(name: K, payload: EventMap[K]): void {
    for (const win of [this.main, this.overlay]) {
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
    this.overlay.setAlwaysOnTop(true, 'floating')
    this.overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // start fully click-through; forward:true still delivers mousemove for hit-testing
    this.overlay.setIgnoreMouseEvents(true, { forward: true })
    this.overlay.on('closed', () => {
      this.overlay = null
    })
    loadEntry(this.overlay, 'overlay')
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
