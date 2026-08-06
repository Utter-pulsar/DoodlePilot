import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_NAME } from '@shared/constants'
import { Store } from './services/store'
import { createAppCore } from './services/context'
import { registerCollectionService } from './services/collection-service'
import { registerAlarmService } from './services/alarm-service'
import { registerScreenshotTranslate } from './services/screenshot-translate'
import { Scheduler } from './services/scheduler'
import { registerUpdater } from './services/updater'
import { registerBoardTransferService } from './services/board-transfer-service'
import { WindowManager } from './windows/window-manager'
import { registerIpc } from './ipc/register-ipc'
import { registerIntegrations } from './integrations'

// single instance — a desktop widget should never run twice
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let store: Store | null = null
let scheduler: Scheduler | null = null

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.doodlepilot.app')
  app.setName(APP_NAME)
  // dev (`npm run dev`) gets its OWN data folder, so hacking on the app never reads or clobbers
  // the real database of an installed copy on the same machine. Packaged builds are unaffected,
  // so end users are not impacted. Must run before Store.open() reads app.getPath('userData').
  if (!app.isPackaged) {
    const devData = join(app.getPath('appData'), `${APP_NAME}-dev`)
    mkdirSync(devData, { recursive: true })
    app.setPath('userData', devData)
  }

  store = await Store.open()
  // keep the OS "launch at login" registration in sync with the persisted setting
  // (packaged only — a dev run must never register the throwaway electron-dev binary)
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: store.data.settings.launchAtLogin })
  }
  const core = createAppCore(store)

  // services register their query/command handlers on the core registries
  registerCollectionService(core)
  registerAlarmService(core)
  registerBoardTransferService(core)
  registerUpdater(core) // self-update query/commands + "install only on accept" policy

  // windows must exist before events are emitted so broadcast can deliver them
  const windows = new WindowManager(core)
  core.broadcast = windows.broadcast.bind(windows)

  registerIpc(core)
  registerIntegrations(core)
  registerScreenshotTranslate(core, windows) // 截屏翻译 config + global hotkey + region capture

  scheduler = new Scheduler(core)
  scheduler.start()

  windows.createAll()

  app.on('browser-window-created', (_e, win) => optimizer.watchWindowShortcuts(win))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.createAll()
    else windows.showMain() // macOS dock re-click: un-hide a window parked in the tray
  })

  // re-launching the exe while we're hidden in the tray surfaces the existing window
  // (the single-instance lock above quits the 2nd process, so this fires in the 1st)
  app.on('second-instance', () => windows.showMain())
})

app.on('window-all-closed', () => {
  // while running in background the windows stay alive (hidden), so this normally won't
  // fire; the guard is defensive in case only the click-through overlay remains.
  if (process.platform !== 'darwin' && !store?.data.settings.runInBackground) app.quit()
})

app.on('before-quit', () => {
  scheduler?.stop()
  store?.flush()
})
