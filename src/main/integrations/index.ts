import type { AppCore } from '../services/context'

/**
 * Integration registration point. This is where future AI / harness / OAuth
 * plugins plug in WITHOUT modifying feature code. Everything you need is on `core`:
 *
 *   core.commands.execute('task.complete', { recordId })   // drive any action
 *   core.queries.execute('records.list', { collectionId }) // read any data
 *   core.events.onAny((name, payload) => ...)              // observe everything
 *   core.hooks.register('banner.resolveText', handler)     // transform/veto
 *
 * Example (commented) — let an LLM rewrite banner text:
 *
 *   core.hooks.register('banner.resolveText', async ({ alarm, defaultText }) => {
 *     const text = await myLlm.summarize(defaultText)   // your API call
 *     return { text }
 *   }, { owner: 'llm-banner' })
 *
 * Example — auto-enrich new tasks:
 *
 *   core.hooks.register('record.beforeCreate', async (input) => {
 *     // input.fields can be augmented here; return the new value
 *     return input
 *   }, { owner: 'llm-autofill' })
 */
export function registerIntegrations(_core: AppCore): void {
  // No integrations yet. Register them here as the project grows.
}
