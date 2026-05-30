import type { Id, Timestamped, ISODate } from './common'

export type AlarmTrigger =
  | { kind: 'once'; at: ISODate }
  | { kind: 'daily'; time: string } // "HH:mm"
  | { kind: 'weekly'; time: string; weekdays: number[] } // 0 = Sunday .. 6 = Saturday

export interface Alarm extends Timestamped {
  id: Id
  label: string
  enabled: boolean
  trigger: AlarmTrigger
  /** start reminding this many minutes BEFORE the trigger time (0 = exactly at time) */
  leadMinutes: number
  /** once reminding has started, fly the banner again every N minutes (0 = only once) */
  repeatEveryMinutes: number
  /** explicit banner text; when empty, `label` is used. Banner width auto-fits the text. */
  bannerText?: string
}

export const DEFAULT_ALARM: Omit<Alarm, 'id' | 'createdAt' | 'updatedAt' | 'label'> = {
  enabled: true,
  trigger: { kind: 'daily', time: '09:00' },
  leadMinutes: 0,
  repeatEveryMinutes: 5
}
