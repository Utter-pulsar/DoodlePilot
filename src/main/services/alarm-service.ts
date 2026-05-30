import { newId, nowISO } from '@shared/types'
import type { Alarm } from '@shared/types'
import { DEFAULT_ALARM } from '@shared/types/alarm'
import type { AppCore } from './context'

/** ms until this alarm's (today's) trigger time; null if not computable. */
function msUntilTrigger(alarm: Alarm, now: Date): number | null {
  const t = alarm.trigger
  let trig: Date
  if (t.kind === 'once') {
    trig = new Date(t.at)
  } else {
    const [h, m] = t.time.split(':').map(Number)
    trig = new Date(now)
    trig.setHours(h, m, 0, 0)
  }
  return trig.getTime() - now.getTime()
}

/** "还剩 8 分钟" / "还剩 1 小时 5 分" / "时间到啦！" — appended to the banner. */
function remainingSuffix(alarm: Alarm, now: Date): string {
  const ms = msUntilTrigger(alarm, now)
  if (ms === null) return ''
  const mins = Math.round(ms / 60000)
  if (mins <= 0) return mins > -2 ? ' · 时间到啦！' : ''
  if (mins > 24 * 60) return '' // too far out to be meaningful
  const body = mins >= 60 ? `${Math.floor(mins / 60)} 小时 ${mins % 60} 分` : `${mins} 分钟`
  return ` · 还剩 ${body}`
}

/**
 * Fire an alarm: fly the banner across the top of the screen, and ask the renderer to
 * play a sound. (No OS notification — the plane/banner IS the reminder.)
 * Shared by the scheduler and the `alarms.test` command.
 */
export async function fireAlarm(core: AppCore, alarm: Alarm, source = 'scheduler'): Promise<void> {
  const gate = await core.hooks.run('alarm.beforeTrigger', alarm, { source })
  if (gate.vetoed) return

  const defaultText = (alarm.bannerText || alarm.label || '叮咚~').trim()
  const resolved = await core.hooks.run('banner.resolveText', { alarm, defaultText }, { source })
  const text = (resolved.value.text || defaultText) + remainingSuffix(alarm, new Date())

  await core.commands.execute('banner.show', { id: newId('ban'), text, color: 'marker-coral' })
  core.events.emit('alarm.ring', { alarmId: alarm.id, label: text })
  // one-shot ('once') alarms are auto-deleted by the scheduler once their time has passed
}

export function registerAlarmService(core: AppCore): void {
  const { store, queries, commands, events } = core

  queries.register('alarms.list', () => [...store.data.alarms])

  commands.register('alarms.create', (input) => {
    const alarm: Alarm = {
      ...DEFAULT_ALARM,
      ...input,
      id: newId('alm'),
      createdAt: nowISO(),
      updatedAt: nowISO()
    }
    store.mutate((db) => db.alarms.push(alarm))
    events.emit('alarms.changed', store.data.alarms)
    return alarm
  })

  commands.register('alarms.update', ({ id, patch }) => {
    const alarm = store.data.alarms.find((a) => a.id === id)
    if (!alarm) throw new Error(`alarm ${id} not found`)
    store.mutate(() => Object.assign(alarm, patch, { updatedAt: nowISO() }))
    events.emit('alarms.changed', store.data.alarms)
    return alarm
  })

  commands.register('alarms.delete', ({ id }) => {
    store.mutate((db) => {
      db.alarms = db.alarms.filter((a) => a.id !== id)
    })
    events.emit('alarms.changed', store.data.alarms)
  })

  commands.register('alarms.test', async ({ id }) => {
    const alarm = store.data.alarms.find((a) => a.id === id)
    if (alarm) await fireAlarm(core, alarm, 'user')
  })

  // the plane-towed banner is the alarm's on-screen reminder (the overlay listens for
  // 'overlay.banner'); fireAlarm calls this command.
  commands.register('banner.show', (banner) => events.emit('overlay.banner', banner))
}
