import { Cron } from 'croner'
import type { Alarm } from '@shared/types'
import type { AppCore } from './context'
import { fireAlarm } from './alarm-service'

const TICK_TOLERANCE_MS = 30_000 // a fire time within this window of "now" counts as due

/** Compute the trigger time for an alarm relative to `now` (the upcoming/!current occurrence). */
function triggerTimeFor(alarm: Alarm, now: Date): Date | null {
  const t = alarm.trigger
  if (t.kind === 'once') return new Date(t.at)

  const [h, m] = t.time.split(':').map(Number)
  const fire = new Date(now)
  fire.setHours(h, m, 0, 0)

  if (t.kind === 'weekly' && !t.weekdays.includes(fire.getDay())) return null
  return fire
}

/**
 * The exact instants this alarm should fly a banner: starting `leadMinutes` before
 * the trigger, every `repeatEveryMinutes` until the trigger itself.
 */
function fireInstants(alarm: Alarm, now: Date): { time: Date; key: string }[] {
  const trigger = triggerTimeFor(alarm, now)
  if (!trigger) return []
  const out: { time: Date; key: string }[] = []
  const step = Math.max(1, alarm.repeatEveryMinutes || 0)
  const dayKey = trigger.toISOString().slice(0, 10)
  if (alarm.repeatEveryMinutes > 0 && alarm.leadMinutes > 0) {
    for (let offset = alarm.leadMinutes; offset >= 0; offset -= step) {
      const time = new Date(trigger.getTime() - offset * 60_000)
      out.push({ time, key: `${alarm.id}:${dayKey}:${offset}` })
    }
  } else {
    out.push({ time: trigger, key: `${alarm.id}:${dayKey}:0` })
  }
  return out
}

export class Scheduler {
  private cron: Cron | null = null
  // instant key -> the instant's fire time (ms). A Map (not a Set) so we can age entries out by
  // time instead of wiping the whole thing — wiping mid-window could un-dedup an instant that's
  // still inside its ±tolerance window and fire it twice.
  private readonly fired = new Map<string, number>()

  constructor(private readonly core: AppCore) {}

  start(): void {
    // tick twice a minute; dedupe firing by instant key
    this.cron = new Cron('*/30 * * * * *', () => void this.tick())
    void this.tick()
  }

  stop(): void {
    this.cron?.stop()
    this.cron = null
  }

  private async tick(): Promise<void> {
    const now = new Date()
    // Always fire on time, whether or not anyone's watching — an alarm is an alarm. If the display
    // is asleep the overlay simply can't paint, so banners pile up motionless; the overlay discards
    // that backlog the moment it wakes (see OverlayApp) instead of letting it stampede out at once.
    for (const alarm of this.core.store.data.alarms) {
      if (!alarm.enabled) continue
      for (const { time, key } of fireInstants(alarm, now)) {
        if (this.fired.has(key)) continue
        if (Math.abs(time.getTime() - now.getTime()) <= TICK_TOLERANCE_MS) {
          this.fired.set(key, time.getTime())
          await fireAlarm(this.core, alarm, 'scheduler')
        }
      }
    }
    this.cleanupExpiredOnce(now)
    // forget only instants whose ±tolerance window has fully closed, so an in-flight instant is
    // never un-deduped (which would double-fire it); keeps the map bounded without a wholesale wipe
    const cutoff = now.getTime() - TICK_TOLERANCE_MS * 2
    for (const [k, t] of this.fired) if (t < cutoff) this.fired.delete(k)
  }

  /** One-shot ('once') alarms self-destruct ~a minute after their time, so they never linger. */
  private cleanupExpiredOnce(now: Date): void {
    const expired = new Set<string>()
    for (const a of this.core.store.data.alarms) {
      if (a.trigger.kind === 'once' && new Date(a.trigger.at).getTime() < now.getTime() - 60_000) {
        expired.add(a.id)
      }
    }
    if (expired.size === 0) return
    this.core.store.mutate((db) => {
      db.alarms = db.alarms.filter((a) => !expired.has(a.id))
    })
    this.core.events.emit('alarms.changed', this.core.store.data.alarms)
  }
}
