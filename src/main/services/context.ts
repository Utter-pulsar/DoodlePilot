import { TypedEmitter } from '@shared/bus/event-bus'
import { HookBus } from '@shared/bus/hook-bus'
import { Registry } from '@shared/bus/registry'
import type { CommandMap, EventMap, QueryMap } from '@shared/api/contract'
import type { AppHookMap } from '@shared/api/hooks'
import type { Store } from './store'

/**
 * The application core wires together the four substrates every feature uses:
 *   store     — persistence
 *   events    — business events (also forwarded to renderer windows)
 *   hooks     — extension points for AI/harness (transform / veto)
 *   queries   — read API surface
 *   commands  — write/action API surface
 *
 * Services register handlers on `queries`/`commands` and publish on `events`.
 * The same registries are callable in-process by integrations — no IPC needed.
 */
export interface AppCore {
  store: Store
  events: TypedEmitter<EventMap>
  hooks: HookBus<AppHookMap>
  queries: Registry<QueryMap>
  commands: Registry<CommandMap>
  /** Send an event to all renderer windows. Wired by the WindowManager at startup. */
  broadcast<K extends keyof EventMap>(name: K, payload: EventMap[K]): void
}

export function createAppCore(store: Store): AppCore {
  const events = new TypedEmitter<EventMap>()
  const core: AppCore = {
    store,
    events,
    hooks: new HookBus<AppHookMap>(),
    queries: new Registry<QueryMap>(),
    commands: new Registry<CommandMap>(),
    broadcast: () => {} // replaced once windows exist
  }
  // Every emitted business event is mirrored to the renderer windows.
  events.onAny((name, payload) => core.broadcast(name as keyof EventMap, payload as never))
  return core
}
