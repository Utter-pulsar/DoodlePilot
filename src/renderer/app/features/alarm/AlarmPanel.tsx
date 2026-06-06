import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { newId } from '@shared/types'
import type { Alarm, Id } from '@shared/types'
import { useStore } from '../../store'
import { api } from '../../lib/bridge'
import { DoodleBox } from '../../components/doodle/DoodleBox'
import { DoodleButton } from '../../components/doodle/DoodleButton'
import { DoodleTimePicker } from '../../components/doodle/DoodleTimePicker'
import { DoodleWheel } from '../../components/doodle/DoodleWheel'
import { DoodleNumber } from '../../components/doodle/DoodleNumber'
import { useElasticDrag } from '../../lib/useElasticDrag'
import { useDoodleScrollbar } from '../../lib/useDoodleScrollbar'
import type { AlarmTrigger } from '@shared/types/alarm'
import logoUrl from '@assets/logo.png'

// soft, slightly-wobbly "tofu-pudding" springs — matched to the board column-resize feel
const HEIGHT_SPRING = { type: 'spring', stiffness: 260, damping: 17 } as const
const POP_SPRING = { type: 'spring', stiffness: 340, damping: 12 } as const
// form: height + a gentle scale wobble (clipped while animating, so it never overlaps rows)
const CREATE_TRANSITION = {
  height: HEIGHT_SPRING,
  scale: HEIGHT_SPRING,
  opacity: { duration: 0.16 }
} as const
// collapsed button: same soft height spring + a bouncier scale "pop"
const BUTTON_TRANSITION = {
  height: HEIGHT_SPRING,
  scale: POP_SPRING,
  opacity: { duration: 0.16 }
} as const
// recurrence sub-rows (weekday picker) expanding/collapsing — a Q-bouncy height spring
const SECTION_TRANSITION = {
  height: { type: 'spring', stiffness: 300, damping: 16 },
  opacity: { duration: 0.14 }
} as const

type Mode = 'daily' | 'weekly' | 'once'
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const pad = (n: number): string => String(n).padStart(2, '0')
/** Days in a 1-based month for a given year (handles Feb / leap years). */
const daysInMonth = (year: number, month1: number): number => new Date(year, month1, 0).getDate()

interface AlarmPayload {
  label: string
  trigger: AlarmTrigger
  leadMinutes: number
  repeatEveryMinutes: number
}

/** Human-readable recurrence label for an alarm row. */
function describeTrigger(t: AlarmTrigger): string {
  if (t.kind === 'daily') return `每天 ${t.time}`
  if (t.kind === 'weekly') {
    const days = [...t.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d]).join('')
    return days ? `每周${days} ${t.time}` : `每周 ${t.time}`
  }
  const d = new Date(t.at)
  return `仅一次 · ${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Month + day scroll wheels (no calendar) for a one-shot alarm's date. */
function OnceDateWheel({
  month,
  day,
  onChange
}: {
  month: number
  day: number
  onChange: (month: number, day: number) => void
}): JSX.Element {
  const year = new Date().getFullYear()
  const dim = daysInMonth(year, month)
  const days = Array.from({ length: dim }, (_, i) => i + 1)
  return (
    <div className="flex items-center justify-center gap-2">
      <DoodleWheel
        values={MONTHS}
        value={month}
        onChange={(m) => onChange(m, Math.min(day, daysInMonth(year, m)))}
        format={(n) => `${n}月`}
      />
      <DoodleWheel
        values={days}
        value={Math.min(day, dim)}
        onChange={(d) => onChange(month, d)}
        format={(n) => `${n}日`}
      />
    </div>
  )
}

/** Initial form field values, from an existing alarm (edit) or sensible defaults (create). */
function initialFields(a?: Alarm): {
  label: string
  time: string
  lead: number
  repeat: number
  mode: Mode
  weekdays: number[]
  onceMonth: number
  onceDay: number
} {
  const now = new Date()
  const base = {
    weekdays: [1, 2, 3, 4, 5],
    onceMonth: now.getMonth() + 1,
    onceDay: now.getDate()
  }
  if (!a) {
    return { label: '', time: '09:00', lead: 0, repeat: 5, mode: 'daily', ...base }
  }
  const common = { label: a.label, lead: a.leadMinutes, repeat: a.repeatEveryMinutes }
  const t = a.trigger
  if (t.kind === 'daily') return { ...base, ...common, time: t.time, mode: 'daily' }
  if (t.kind === 'weekly')
    return {
      ...base,
      ...common,
      time: t.time,
      mode: 'weekly',
      weekdays: t.weekdays.length ? [...t.weekdays] : [now.getDay()]
    }
  const d = new Date(t.at)
  return {
    ...base,
    ...common,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    mode: 'once',
    onceMonth: d.getMonth() + 1,
    onceDay: d.getDate()
  }
}

/**
 * The new/edit alarm form. Self-contained: holds its own field state (seeded from
 * `initialAlarm` when editing) and reports the result via `onSubmit`. Used both at the top
 * of the panel (create) and inline inside a row (edit).
 */
function AlarmForm({
  initialAlarm,
  onSubmit,
  onCancel
}: {
  initialAlarm?: Alarm
  onSubmit: (payload: AlarmPayload) => void
  onCancel: () => void
}): JSX.Element {
  const editing = !!initialAlarm
  const init = initialFields(initialAlarm)
  const [label, setLabel] = useState(init.label)
  const [time, setTime] = useState(init.time)
  const [lead, setLead] = useState(init.lead)
  const [repeat, setRepeat] = useState(init.repeat)
  const [mode, setMode] = useState<Mode>(init.mode)
  const [weekdays, setWeekdays] = useState<number[]>(init.weekdays)
  const [onceMonth, setOnceMonth] = useState(init.onceMonth)
  const [onceDay, setOnceDay] = useState(init.onceDay)

  const buildTrigger = (): AlarmTrigger => {
    if (mode === 'weekly') {
      const days = weekdays.length ? [...weekdays].sort((a, b) => a - b) : [new Date().getDay()]
      return { kind: 'weekly', time, weekdays: days }
    }
    if (mode === 'once') {
      const [h, m] = time.split(':').map(Number)
      const y = new Date().getFullYear()
      const day = Math.min(onceDay, daysInMonth(y, onceMonth))
      let at = new Date(y, onceMonth - 1, day, h, m, 0, 0)
      if (at.getTime() <= Date.now()) at = new Date(y + 1, onceMonth - 1, day, h, m, 0, 0) // roll to next year
      return { kind: 'once', at: at.toISOString() }
    }
    return { kind: 'daily', time }
  }

  const submit = (): void => {
    onSubmit({
      label: label.trim() || '该休息啦~',
      trigger: buildTrigger(),
      leadMinutes: lead,
      repeatEveryMinutes: repeat
    })
  }

  const previewBanner = (): void => {
    void api.command('banner.show', {
      id: newId('ban'),
      text: label.trim() || 'DoodlePilot 横幅预览 ~ 内容越长横幅越宽',
      color: 'marker-coral',
      brand: true
    })
  }

  return (
    <DoodleBox>
      <div className="space-y-3 p-4 font-doodle">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">{editing ? '编辑闹钟' : '新建闹钟'}</h2>
          <button onClick={onCancel} className="text-xl opacity-50 hover:opacity-100">
            ✕
          </button>
        </div>
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="提醒内容（会写在横幅上）"
          className="w-full rounded-[8px] border-2 border-ink bg-card px-3 py-1.5 outline-none"
        />
        <div className="flex flex-col items-center gap-1 py-1">
          <span className="self-start text-sm opacity-60">提醒时间（转表针 / 拖转轮 / 直接输入）</span>
          <DoodleTimePicker value={time} onChange={setTime} />
        </div>

        {/* recurrence: daily / weekly (pick days) / once (pick a date, auto-deletes after firing) */}
        <div className="space-y-2">
          <div className="flex gap-2">
            {(
              [
                ['daily', '每天'],
                ['weekly', '每周'],
                ['once', '仅一次']
              ] as [Mode, string][]
            ).map(([m, lbl]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-[8px] border-2 border-ink px-2 py-1 text-sm ${
                  mode === m ? 'bg-marker-yellow text-[#2B2B2B]' : 'bg-card hover:bg-marker-yellow/30'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          {/* weekday picker springs open/closed when entering/leaving 每周 */}
          <AnimatePresence initial={false}>
            {mode === 'weekly' && (
              <motion.div
                key="weekdays"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={SECTION_TRANSITION}
                style={{ overflow: 'hidden' }}
              >
                <div className="flex gap-1 pt-1">
                  {WEEKDAY_LABELS.map((lbl, i) => (
                    <button
                      key={i}
                      onClick={() =>
                        setWeekdays((ws) => (ws.includes(i) ? ws.filter((x) => x !== i) : [...ws, i]))
                      }
                      className={`h-8 flex-1 rounded-[8px] border-2 border-ink text-sm ${
                        weekdays.includes(i)
                          ? 'bg-marker-yellow text-[#2B2B2B]'
                          : 'bg-card hover:bg-marker-yellow/30'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* lead/repeat keeps its original spot; the 仅一次 date wheel pops in to the RIGHT of it
            (so turning on 仅一次 doesn't make the whole form much taller) */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2">
              提前
              <DoodleNumber value={lead} onChange={(n) => setLead(n ?? 0)} min={0} />
              分钟开始提醒
            </label>
            <label className="flex items-center gap-2">
              每
              <DoodleNumber value={repeat} onChange={(n) => setRepeat(n ?? 1)} min={1} />
              分钟飞一次
            </label>
          </div>
          <AnimatePresence initial={false}>
            {mode === 'once' && (
              // animate HEIGHT (not scale): the wheel's height drives the row height, so the
              // "提前…/每…" line springs up/down smoothly as the wheel collapses/expands — and
              // it settles fast (no scale-spring tail keeping the row tall for seconds).
              <motion.div
                key="once-wheel"
                className="shrink-0 overflow-hidden"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={SECTION_TRANSITION}
              >
                <OnceDateWheel
                  month={onceMonth}
                  day={onceDay}
                  onChange={(m, d) => {
                    setOnceMonth(m)
                    setOnceDay(d)
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex gap-2">
          <DoodleButton variant="primary" onClick={submit}>
            {editing ? '✓ 保存修改' : '＋ 添加闹钟'}
          </DoodleButton>
          <DoodleButton onClick={previewBanner}>
            <img src={logoUrl} alt="" className="h-5 w-5" />
            预览横幅
          </DoodleButton>
          <DoodleButton variant="ghost" onClick={onCancel}>
            取消
          </DoodleButton>
        </div>
      </div>
    </DoodleBox>
  )
}

export function AlarmPanel(): JSX.Element {
  const alarms = useStore((s) => s.alarms)
  // form open-state lives in the store so leaving the tab can collapse it first (see App.tsx)
  const creating = useStore((s) => s.alarmCreating)
  const editingId = useStore((s) => s.alarmEditingId)
  const setCreating = useStore((s) => s.setAlarmCreating)
  const setEditingId = useStore((s) => s.setAlarmEditingId)
  const [bump, setBump] = useState(0) // increments to trigger the collision-squash cascade
  const [animating, setAnimating] = useState(false) // clip only while morphing, so resting edges aren't cut
  const firstRun = useRef(true)

  // grab empty space and drag up/down to scroll (with Q-bouncy momentum)
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  useElasticDrag(scrollRef, innerRef, 'y')
  useDoodleScrollbar(scrollRef, 'y')

  // a collision ripple when the create form opens/closes or rows are added/removed. NOT on
  // edit open/close — that's a smooth in-place row↔form morph (below), so squashing the whole
  // stack on top of it just read as jank.
  useEffect(() => setBump((b) => b + 1), [creating, alarms.length])

  // clip overflow only during an open/close morph (skip the initial mount)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    setAnimating(true)
    const t = setTimeout(() => setAnimating(false), 450)
    return () => clearTimeout(t)
  }, [creating, editingId])

  const closeForm = (): void => {
    setCreating(false)
    setEditingId(null)
  }
  const openCreate = (): void => {
    setEditingId(null)
    setCreating(true)
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const openEdit = (id: Id): void => {
    setCreating(false)
    setEditingId(id) // the form expands inline at this alarm's own row
  }

  const clip = animating ? 'hidden' : 'visible'

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-6">
      <div ref={innerRef} className="mx-auto max-w-2xl">
        {/* create area: the button and the form are the two states of ONE height-springing
            slot, so neither pops in/out — the row stack below just follows the spring. */}
        <AnimatePresence initial={false} mode="sync">
          {!creating ? (
            <motion.div
              key="btn"
              className="relative z-30"
              initial={{ height: 0, opacity: 0, scale: 0.8 }}
              animate={{ height: 'auto', opacity: 1, scale: 1 }}
              exit={{ height: 0, opacity: 0, scale: 0.8 }}
              transition={BUTTON_TRANSITION}
              style={{ overflow: clip, transformOrigin: 'center' }}
            >
              <div className="pb-4 pt-0.5">
                <DoodleButton variant="primary" className="w-full text-lg" onClick={openCreate}>
                  ＋ 新建闹钟
                </DoodleButton>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              className="relative z-30"
              initial={{ height: 0, opacity: 0, scale: 0.97 }}
              animate={{ height: 'auto', opacity: 1, scale: 1 }}
              exit={{ height: 0, opacity: 0, scale: 0.97 }}
              transition={CREATE_TRANSITION}
              style={{ overflow: clip, transformOrigin: 'top' }}
            >
              <div className="px-1 pb-4 pt-0.5">
                <AlarmForm
                  onSubmit={(p) => {
                    void api.command('alarms.create', p)
                    closeForm()
                  }}
                  onCancel={closeForm}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* click any blank space to collapse the open form */}
        {(creating || editingId) && <div className="fixed inset-0 z-20" onClick={closeForm} />}

        <div className="space-y-3">
          {alarms.length === 0 && !creating && (
            <p className="text-center font-doodle opacity-50">还没有闹钟，点上面"新建闹钟"加一个吧～</p>
          )}
          {alarms.map((a, i) => (
            // row ↔ edit-form are the two states of ONE height-springing slot (same pattern as
            // the top create button↔form), so they morph in place instead of one vanishing
            // before the other appears.
            <AnimatePresence key={a.id} initial={false}>
              {editingId === a.id ? (
                <motion.div
                  key="edit"
                  className="relative z-30"
                  initial={{ height: 0, opacity: 0, scale: 0.97 }}
                  animate={{ height: 'auto', opacity: 1, scale: 1 }}
                  exit={{ height: 0, opacity: 0, scale: 0.97 }}
                  transition={CREATE_TRANSITION}
                  style={{ overflow: clip, transformOrigin: 'top' }}
                >
                  <AlarmForm
                    initialAlarm={a}
                    onSubmit={(p) => {
                      void api.command('alarms.update', { id: a.id, patch: p })
                      closeForm()
                    }}
                    onCancel={closeForm}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="row"
                  className="relative z-30"
                  initial={{ height: 0, opacity: 0, scale: 0.8 }}
                  animate={{ height: 'auto', opacity: 1, scale: 1 }}
                  exit={{ height: 0, opacity: 0, scale: 0.8 }}
                  transition={BUTTON_TRANSITION}
                  style={{ overflow: clip, transformOrigin: 'center' }}
                >
                  <SoftAlarm alarm={a} bump={bump} index={i} onEdit={() => openEdit(a.id)} />
                </motion.div>
              )}
            </AnimatePresence>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * An alarm row. Position is handled purely by document flow (so rows can never overlap);
 * the only animation is a springy vertical squash on a "bump" — a soft edge-squeeze
 * cascade that reads as a collision instead of an overlap.
 */
function SoftAlarm({
  alarm,
  bump,
  index,
  onEdit
}: {
  alarm: Alarm
  bump: number
  index: number
  onEdit: (a: Alarm) => void
}): JSX.Element {
  const controls = useAnimationControls()
  useEffect(() => {
    if (bump === 0) return
    // negative initial velocity → compress first, then spring back past 1 → Q弹
    void controls.start(
      { scaleY: 1 },
      { type: 'spring', stiffness: 340, damping: 11, velocity: -7, delay: index * 0.04 }
    )
  }, [bump]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div animate={controls} style={{ transformOrigin: 'top center' }}>
      <AlarmRow alarm={alarm} onEdit={onEdit} />
    </motion.div>
  )
}

function AlarmRow({ alarm, onEdit }: { alarm: Alarm; onEdit: (a: Alarm) => void }): JSX.Element {
  const when = describeTrigger(alarm.trigger)
  return (
    <DoodleBox fill={alarm.enabled ? '--card' : '--card-muted'}>
      <div className="flex items-center gap-3 p-3 font-doodle">
        <span className="text-lg">⏰</span>
        <button
          onClick={() => onEdit(alarm)}
          className="flex-1 cursor-pointer text-left"
          title="点击编辑这个闹钟"
        >
          <div className="text-base font-bold">{alarm.label}</div>
          <div className="text-sm opacity-70">
            {when} · 提前 {alarm.leadMinutes} 分钟 · 每 {alarm.repeatEveryMinutes} 分钟
          </div>
        </button>
        <DoodleButton onClick={() => void api.command('alarms.test', { id: alarm.id })}>▶ 测试</DoodleButton>
        <DoodleButton
          variant={alarm.enabled ? 'primary' : 'default'}
          onClick={() => void api.command('alarms.update', { id: alarm.id, patch: { enabled: !alarm.enabled } })}
        >
          {alarm.enabled ? '已开启' : '已关闭'}
        </DoodleButton>
        <button
          onClick={() => void api.command('alarms.delete', { id: alarm.id })}
          className="opacity-50 hover:opacity-100"
          title="删除"
        >
          🗑️
        </button>
      </div>
    </DoodleBox>
  )
}
