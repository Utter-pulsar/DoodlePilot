import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_NAME } from '@shared/constants'
import { Store } from './services/store'
import { createAppCore } from './services/context'
import { registerCollectionService } from './services/collection-service'
import { registerAlarmService } from './services/alarm-service'
import { Scheduler } from './services/scheduler'
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

  store = await Store.open()
  const core = createAppCore(store)

  // services register their query/command handlers on the core registries
  registerCollectionService(core)
  registerAlarmService(core)

  // windows must exist before events are emitted so broadcast can deliver them
  const windows = new WindowManager(core)
  core.broadcast = windows.broadcast.bind(windows)

  registerIpc(core)
  registerIntegrations(core)

  scheduler = new Scheduler(core)
  scheduler.start()

  windows.createAll()

  app.on('browser-window-created', (_e, win) => optimizer.watchWindowShortcuts(win))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.createAll()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  scheduler?.stop()
  store?.flush()
})
