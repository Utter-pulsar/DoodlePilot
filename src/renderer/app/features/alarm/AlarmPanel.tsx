import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { newId } from '@shared/types'
import type { Alarm } from '@shared/types'
import { useStore } from '../../store'
import { api } from '../../lib/bridge'
import { DoodleBox } from '../../components/doodle/DoodleBox'
import { DoodleButton } from '../../components/doodle/DoodleButton'
import { DoodleTimePicker } from '../../components/doodle/DoodleTimePicker'
import { DoodleNumber } from '../../components/doodle/DoodleNumber'
import { useElasticDrag } from '../../lib/useElasticDrag'
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

type Mode = 'daily' | 'weekly' | 'once'
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** Human-readable recurrence label for an alarm row. */
function describeTrigger(t: AlarmTrigger): string {
  if (t.kind === 'daily') return `每天 ${t.time}`
  if (t.kind === 'weekly') {
    const days = [...t.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d]).join('')
    return days ? `每周${days} ${t.time}` : `每周 ${t.time}`
  }
  const d = new Date(t.at)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `仅一次 · ${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

export function AlarmPanel(): JSX.Element {
  const alarms = useStore((s) => s.alarms)
  const [creating, setCreating] = useState(false)
  const [label, setLabel] = useState('')
  const [time, setTime] = useState('09:00')
  const [lead, setLead] = useState(0)
  const [repeat, setRepeat] = useState(5)
  const [mode, setMode] = useState<Mode>('daily')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [bump, setBump] = useState(0) // increments to trigger the collision-squash cascade
  const [animating, setAnimating] = useState(false) // clip only while morphing, so resting edges aren't cut
  const firstRun = useRef(true)

  // a collision ripple whenever the layout changes (open/close, add/remove)
  useEffect(() => setBump((b) => b + 1), [creating, alarms.length])

  // clip overflow only during the open/close morph (skip the initial mount)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    setAnimating(true)
    const t = setTimeout(() => setAnimating(false), 450)
    return () => clearTimeout(t)
  }, [creating])

  const create = (): void => {
    const text = label.trim() || '该休息啦~'
    let trigger: AlarmTrigger
    if (mode === 'weekly') {
      const days = weekdays.length ? [...weekdays].sort((a, b) => a - b) : [new Date().getDay()]
      trigger = { kind: 'weekly', time, weekdays: days }
    } else if (mode === 'once') {
      const [h, m] = time.split(':').map(Number)
      const at = new Date()
      at.setHours(h, m, 0, 0)
      if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1) // roll to the next occurrence
      trigger = { kind: 'once', at: at.toISOString() }
    } else {
      trigger = { kind: 'daily', time }
    }
    void api.command('alarms.create', {
      label: text,
      trigger,
      leadMinutes: lead,
      repeatEveryMinutes: repeat
    })
    setLabel('')
    setCreating(false)
  }

  const previewBanner = (): void => {
    void api.command('banner.show', {
      id: newId('ban'),
      text: label.trim() || 'DoodlePilot 横幅预览 ~ 内容越长横幅越宽',
      color: 'marker-coral',
      brand: true // only the preview shows the spiral logo on the cloth
    })
  }

  const clip = animating ? 'hidden' : 'visible'

  // grab empty space and drag up/down to scroll (with Q-bouncy momentum)
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  useElasticDrag(scrollRef, innerRef, 'y')

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-6">
      <div ref={innerRef} className="mx-auto max-w-2xl">
        {/* create area: the button and the form are the two states of ONE height-springing
            slot, so neither pops in/out — the row stack below just follows the spring. */}
        <AnimatePresence initial={false} mode="sync">
          {!creating ? (
            <motion.div
              key="btn"
              initial={{ height: 0, opacity: 0, scale: 0.8 }}
              animate={{ height: 'auto', opacity: 1, scale: 1 }}
              exit={{ height: 0, opacity: 0, scale: 0.8 }}
              transition={BUTTON_TRANSITION}
              style={{ overflow: clip, transformOrigin: 'center' }}
            >
              <div className="pb-4 pt-0.5">
                <DoodleButton
                  variant="primary"
                  className="w-full text-lg"
                  onClick={() => setCreating(true)}
                >
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
                <DoodleBox>
                  <div className="space-y-3 p-4 font-doodle">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-bold">新建闹钟</h2>
                      <button
                        onClick={() => setCreating(false)}
                        className="text-xl opacity-50 hover:opacity-100"
                      >
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

                    {/* recurrence: daily / weekly (pick days) / once (auto-deletes after firing) */}
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
                              mode === m
                                ? 'bg-marker-yellow text-[#2B2B2B]'
                                : 'bg-card hover:bg-marker-yellow/30'
                            }`}
                          >
                            {lbl}
                          </button>
                        ))}
                      </div>
                      {mode === 'weekly' && (
                        <div className="flex gap-1">
                          {WEEKDAY_LABELS.map((lbl, i) => (
                            <button
                              key={i}
                              onClick={() =>
                                setWeekdays((ws) =>
                                  ws.includes(i) ? ws.filter((x) => x !== i) : [...ws, i]
                                )
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
                      )}
                      {mode === 'once' && (
                        <p className="text-xs opacity-60">仅在所选时间提醒一次，提醒后自动删除。</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
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
                    <div className="flex gap-2">
                      <DoodleButton variant="primary" onClick={create}>
                        ＋ 添加闹钟
                      </DoodleButton>
                      <DoodleButton onClick={previewBanner}>
                        <img src={logoUrl} alt="" className="h-5 w-5" />
                        预览横幅
                      </DoodleButton>
                      <DoodleButton variant="ghost" onClick={() => setCreating(false)}>
                        取消
                      </DoodleButton>
                    </div>
                  </div>
                </DoodleBox>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* click any blank space to collapse */}
        {creating && <div className="fixed inset-0 z-20" onClick={() => setCreating(false)} />}

        <div className="space-y-3">
          {alarms.length === 0 && !creating && (
            <p className="text-center font-doodle opacity-50">还没有闹钟，点上面"新建闹钟"加一个吧～</p>
          )}
          {alarms.map((a, i) => (
            <SoftAlarm key={a.id} alarm={a} bump={bump} index={i} />
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
function SoftAlarm({ alarm, bump, index }: { alarm: Alarm; bump: number; index: number }): JSX.Element {
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
      <AlarmRow alarm={alarm} />
    </motion.div>
  )
}

function AlarmRow({ alarm }: { alarm: Alarm }): JSX.Element {
  const when = describeTrigger(alarm.trigger)
  return (
    <DoodleBox fill={alarm.enabled ? '--card' : '--card-muted'}>
      <div className="flex items-center gap-3 p-3 font-doodle">
        <span className="text-lg">⏰</span>
        <div className="flex-1">
          <div className="text-base font-bold">{alarm.label}</div>
          <div className="text-sm opacity-70">
            {when} · 提前 {alarm.leadMinutes} 分钟 · 每 {alarm.repeatEveryMinutes} 分钟
          </div>
        </div>
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
