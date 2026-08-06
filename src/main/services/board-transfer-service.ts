import { app, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BOARD_EXPORT_APP,
  BOARD_EXPORT_FORMAT_VERSION,
  BOARD_EXPORT_KIND,
  assertBoardExportFile,
  type BoardExportFile
} from '@shared/types'
import type { AppCore } from './context'

function exportFileName(): string {
  return `DoodlePilot-board-${new Date().toISOString().slice(0, 10)}.doodlepilot-board.json`
}

function cloneBoard<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Import / export for the project board only: lanes + cards (including history lanes and links).
 * Alarms, settings and model/API keys deliberately stay outside this portable file.
 */
export function registerBoardTransferService(core: AppCore): void {
  const { store, commands, events } = core

  commands.register('board.exportData', async () => {
    const payload: BoardExportFile = {
      app: BOARD_EXPORT_APP,
      kind: BOARD_EXPORT_KIND,
      formatVersion: BOARD_EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      schemaVersion: store.data.version,
      data: {
        collections: cloneBoard(store.data.collections),
        records: cloneBoard(store.data.records)
      }
    }

    const result = await dialog.showSaveDialog({
      title: '导出项目看板数据',
      defaultPath: join(app.getPath('documents'), exportFileName()),
      filters: [
        { name: 'DoodlePilot 项目看板 JSON', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return {
        ok: false,
        canceled: true,
        collections: payload.data.collections.length,
        records: payload.data.records.length
      }
    }

    await writeFile(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    return {
      ok: true,
      filePath: result.filePath,
      collections: payload.data.collections.length,
      records: payload.data.records.length
    }
  })

  commands.register('board.importData', ({ payload }) => {
    assertBoardExportFile(payload)

    const collections = cloneBoard(payload.data.collections)
    const records = cloneBoard(payload.data.records)
    store.mutate((db) => {
      db.collections = collections
      db.records = records
    })

    events.emit('collections.changed', store.data.collections)
    return { ok: true, collections: collections.length, records: records.length }
  })
}
