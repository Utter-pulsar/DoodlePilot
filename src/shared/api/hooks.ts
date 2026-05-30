import type { Alarm, Id, RecordItem } from '../types'

// ===========================================================================
// Lifecycle hook points. Register handlers on the HookBus to extend behaviour
// without touching feature code. This is the seam reserved for future AI /
// harness / OAuth integrations.
//
// Naming convention:
//   *.before*   -> may transform the payload or return VETO to cancel
//   *.after*    -> observe / react (transform allowed but usually side-effects)
//   *.resolve*  -> produce/override a derived value (e.g. banner text)
// ===========================================================================

export type AppHookMap = {
  /** About to create a record — enrich/normalize fields, or VETO. (AI auto-fill goes here.) */
  'record.beforeCreate': {
    input: { collectionId: Id; fields: Record<Id, unknown> }
    output: { collectionId: Id; fields: Record<Id, unknown> }
  }
  /** A task is about to be marked complete — VETO to block (e.g. unmet dependencies). */
  'task.beforeComplete': { input: RecordItem; output: RecordItem }
  /** A task was completed — good place to log, sync, or trigger AI follow-ups. */
  'task.afterComplete': { input: RecordItem; output: RecordItem }
  /** An alarm is about to fire — VETO to suppress this occurrence. */
  'alarm.beforeTrigger': { input: Alarm; output: Alarm }
  /** Produce the banner text for an alarm. AI can rewrite/translate/summarize here. */
  'banner.resolveText': {
    input: { alarm: Alarm; defaultText: string }
    output: { text: string }
  }
}

export type AppHookName = keyof AppHookMap
