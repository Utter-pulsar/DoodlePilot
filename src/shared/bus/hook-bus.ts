// The HookBus is DoodlePilot's primary extension point. Every meaningful moment in
// a feature's lifecycle runs through a named hook (see src/shared/api/hooks.ts).
//
// A future AI/harness/OAuth integration registers handlers here to:
//   - transform a payload (e.g. rewrite banner text, enrich a new task), or
//   - veto an action (return VETO from a `before*` hook).
//
// Handlers run as a waterfall: each receives the previous handler's output.

export const VETO = Symbol('doodle.hook.veto')

export interface HookContext {
  /** who triggered the action: 'user' | 'scheduler' | 'ai' | plugin name */
  source: string
}

export type HookHandler<I, O> = (
  input: I,
  ctx: HookContext
) => O | typeof VETO | void | Promise<O | typeof VETO | void>

interface Registered<I, O> {
  handler: HookHandler<I, O>
  priority: number
  owner: string
}

export interface HookRunResult<O> {
  vetoed: boolean
  vetoedBy?: string
  value: O
}

export type HookShape = Record<string, { input: unknown; output: unknown }>

export class HookBus<HookMap extends HookShape> {
  private map = new Map<keyof HookMap, Registered<unknown, unknown>[]>()

  /**
   * @param owner  identifies the plugin/integration (for debugging + teardown)
   * @param priority lower runs first (default 100)
   */
  register<K extends keyof HookMap>(
    point: K,
    handler: HookHandler<HookMap[K]['input'], HookMap[K]['output']>,
    opts: { owner?: string; priority?: number } = {}
  ): () => void {
    const entry: Registered<unknown, unknown> = {
      handler: handler as HookHandler<unknown, unknown>,
      priority: opts.priority ?? 100,
      owner: opts.owner ?? 'anonymous'
    }
    const list = this.map.get(point) ?? []
    list.push(entry)
    list.sort((a, b) => a.priority - b.priority)
    this.map.set(point, list)
    return () => {
      const arr = this.map.get(point)
      if (arr) this.map.set(point, arr.filter((e) => e !== entry))
    }
  }

  removeOwner(owner: string): void {
    for (const [k, list] of this.map) {
      this.map.set(k, list.filter((e) => e.owner !== owner))
    }
  }

  /** Run a hook point as a waterfall. Returns the (possibly transformed) value + veto state. */
  async run<K extends keyof HookMap>(
    point: K,
    input: HookMap[K]['input'],
    ctx: HookContext = { source: 'user' }
  ): Promise<HookRunResult<HookMap[K]['output']>> {
    let value: unknown = input
    const list = this.map.get(point) ?? []
    for (const entry of list) {
      const out = await entry.handler(value, ctx)
      if (out === VETO) {
        return { vetoed: true, vetoedBy: entry.owner, value: value as HookMap[K]['output'] }
      }
      if (out !== undefined) value = out
    }
    return { vetoed: false, value: value as HookMap[K]['output'] }
  }
}
