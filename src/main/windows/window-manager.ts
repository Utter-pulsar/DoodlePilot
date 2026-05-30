import { join } from 'node:path'
import { BrowserWindow, app, screen } from 'electron'
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
  private layout: DisplayLayout

  constructor(core: AppCore) {
    this.layout = WindowManager.computeLayout()

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
    core.queries.register('app.info', () => ({ name: 'DoodlePilot', version: app.getVersion() }))

    // recolor the native window-controls overlay (Win/Linux only) when the theme flips
    core.commands.register('window.applyTheme', ({ dark }) => {
      if (process.platform === 'darwin' || !this.main || this.main.isDestroyed()) return
      this.main.setTitleBarOverlay({
        color: dark ? '#1A1612' : '#FBF7EF',
        symbolColor: dark ? '#E8E4DB' : '#2B2B2B'
      })
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
      // blend the OS title bar into the app: hide it but keep the native window
      // controls — overlaid top-right on Win/Linux, traffic lights top-left on macOS
      titleBarStyle: 'hidden',
      ...(process.platform !== 'darwin'
        ? { titleBarOverlay: { color: '#FBF7EF', symbolColor: '#2B2B2B', height: 44 } }
        : {}),
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
    this.main.on('closed', () => {
      this.main = null
      app.quit() // closing the main window exits the whole app (overlay included)
    })
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
}
