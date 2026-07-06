import { randomBytes, randomUUID } from 'node:crypto'
import type { VisionProtocol } from '@shared/types'
import { detectVisionProtocol } from '@shared/types'

/** A friendly, user-facing failure for the vision call (message is shown as-is in the capture UI). */
export class VisionError extends Error {}

interface ChatVisionArgs {
  baseUrl: string
  apiKey: string
  model: string
  /** wire format; when omitted it's inferred from the endpoint shape (key / model / url) */
  protocol?: VisionProtocol
  dataUri: string // data:image/png;base64,...
  system: string
  user: string
  maxTokens?: number
  /** keep the model's reasoning ON (so the caller can show it). Default/false = actively disable it. */
  thinking?: boolean
  /** caller-owned cancellation — aborting it stops the request (a superseded/closed capture box). */
  signal?: AbortSignal
}

/** Answer + reasoning, separated. `reasoning` is the model's chain-of-thought (from a separate
 *  `reasoning_content` field and/or inline `<think>…</think>`); it is empty unless thinking ran. */
export interface VisionResult {
  answer: string
  reasoning: string
}

// ---- timeouts. A hung remote (the reported flaky self-hosted vLLM) must surface as a retryable
// error, never a forever-spinner. Non-stream: one overall cap. Stream: an INACTIVITY cap reset on
// every chunk, so a long-but-progressing analysis is fine but a silent stall aborts. ----
const REQUEST_TIMEOUT_MS = 60_000 // non-streaming overall cap
// streaming: a generous window for the FIRST byte (connect + self-heal retries + the model's whole
// time-to-first-token — a loaded vLLM or a reasoning model can be slow and silent here), then a
// tighter cap on the GAP between subsequent chunks once tokens are flowing.
const STREAM_FIRST_TIMEOUT_MS = 120_000
const STREAM_IDLE_TIMEOUT_MS = 45_000

/** True when this error is (only) the result of an abort — the caller cancelled or a timeout fired.
 *  Callers use it to tell "user cancelled" (swallow) from a real failure (show). */
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof VisionError === false &&
    (err instanceof Error ? err.name === 'AbortError' : false)
  )
}

/** Combine the caller's signal with a timeout into one signal, and return a disposer that clears the
 *  timer + a helper to check whether WE (timeout) aborted (→ a friendly "timed out" message). */
function withTimeout(
  signal: AbortSignal | undefined,
  ms: number
): { signal: AbortSignal; timedOut: () => boolean; clear: () => void; arm: (ms?: number) => void } {
  const ctrl = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const onAbort = (): void => ctrl.abort()
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  // arm(nextMs) resets the deadline; callers pass a shorter window once streaming is underway so the
  // first-token wait and the inter-chunk gap can have different budgets.
  const arm = (nextMs: number = ms): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      ctrl.abort()
    }, nextMs)
  }
  const clear = (): void => {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
  arm()
  return { signal: ctrl.signal, timedOut: () => timedOut, clear, arm }
}

// ===========================================================================
// OpenAI chat-completions path
// ===========================================================================

/** Build the chat-completions URL, tolerating a trailing slash, a pasted full endpoint, or a host
 *  without the /v1 version segment. */
function chatCompletionsUrl(baseUrl: string): string {
  let b = baseUrl.trim().replace(/\/+$/, '')
  b = b.replace(/\/chat\/completions$/, '')
  if (!/\/v\d+$/.test(b)) b += '/v1'
  return `${b}/chat/completions`
}

interface MessageNode {
  content?: string
  // separate reasoning channel — providers disagree on the name: DeepSeek/Qwen/GLM use
  // `reasoning_content`, OpenRouter (and some others) use `reasoning`. Read either.
  reasoning_content?: string
  reasoning?: string
}

/** The reasoning text from a message/delta, regardless of which field the provider used. */
function nodeReasoning(node: MessageNode | undefined): string {
  if (typeof node?.reasoning_content === 'string') return node.reasoning_content
  if (typeof node?.reasoning === 'string') return node.reasoning
  return ''
}
interface ChatResponse {
  choices?: Array<{ message?: MessageNode }>
  error?: { message?: string }
}
interface StreamChunk {
  choices?: Array<{ delta?: MessageNode; message?: MessageNode }>
}

/**
 * Per-family request fields that turn the model's "thinking"/reasoning OFF. Every endpoint speaks the
 * same OpenAI chat format, but each family disables thinking with a DIFFERENT field — so we pick by
 * the model id (the one reliable cross-vendor signal) instead of hard-coding a single vendor. Anything
 * a given server doesn't know is either ignored or caught by the 400-retry in sendChat, and
 * splitThinking() cleans the output regardless — so this is best-effort, never fatal.
 */
function noThinkingFields(model: string): Record<string, unknown> {
  const m = model.toLowerCase()
  // OpenAI o-series / GPT-5: reasoning can only be turned DOWN, not fully off.
  if (isReasoningModel(m)) {
    return { reasoning_effort: /gpt-?5/.test(m) ? 'minimal' : 'low' }
  }
  // Zhipu GLM, ByteDance Doubao, Tencent Hunyuan, MiniMax, Baidu Ernie/Wenxin: a `thinking` object.
  if (/glm|doubao|hunyuan|minimax|ernie|wenxin/.test(m)) return { thinking: { type: 'disabled' } }
  // DeepSeek: no runtime switch — deepseek-reasoner always thinks; use deepseek-chat to avoid it.
  if (/deepseek/.test(m)) return {}
  // Default — Qwen3 and virtually all self-hosted OpenAI servers (vLLM / SGLang / Ollama) gate
  // thinking through the chat template; `chat_template_kwargs.enable_thinking=false` is the
  // vLLM/Qwen3 standard and is harmlessly ignored by models that don't think.
  return { chat_template_kwargs: { enable_thinking: false } }
}

/** OpenAI o-series / GPT-5 reasoning family: they reject a custom `temperature` (only the default is
 *  allowed) and always reason. Detecting them lets us omit `temperature` up front (no wasted 400). */
function isReasoningModel(model: string): boolean {
  const m = model.toLowerCase()
  return /^o[134](-|$|\b)/.test(m) || /gpt-?5/.test(m)
}

/**
 * The reasoning ON/OFF request fields. OFF = noThinkingFields (above). ON must ACTIVELY enable it —
 * just omitting the disable field would only fall back to the model's default, which for many vision
 * models is OFF, so 截屏分析「思考」 produced no reasoning at all. The 400-retry in sendChat drops it
 * if a server rejects the field; a model with no thinking support simply ignores it.
 */
function thinkingFields(model: string, on: boolean): Record<string, unknown> {
  if (!on) return noThinkingFields(model)
  const m = model.toLowerCase()
  // OpenAI o-series / GPT-5 always reason; the API doesn't expose the trace, so nothing to add.
  if (isReasoningModel(m)) return {}
  if (/glm|doubao|hunyuan|minimax|ernie|wenxin/.test(m)) return { thinking: { type: 'enabled' } }
  if (/deepseek/.test(m)) return {} // model-selected (deepseek-reasoner always thinks)
  return { chat_template_kwargs: { enable_thinking: true } } // Qwen3 / vLLM standard
}

/**
 * Split a content string into reasoning (inline `<think>…</think>`) and answer (everything else).
 * Live-safe: an UNCLOSED `<think>` at the tail (still streaming) is treated as reasoning-in-progress,
 * and a lone closing tag (content that started mid-reasoning) is handled too. Does NOT trim, so it can
 * be called on the growing buffer; callers trim the final values.
 */
function splitThinking(content: string): VisionResult {
  let reasoning = ''
  let answer = content.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (_m, r: string) => {
    reasoning += r
    return ''
  })
  const open = answer.search(/<think(?:ing)?>/i)
  if (open !== -1) {
    reasoning += answer.slice(open).replace(/<think(?:ing)?>/i, '')
    answer = answer.slice(0, open)
  } else {
    const close = answer.search(/<\/think(?:ing)?>/i)
    if (close !== -1) {
      reasoning += answer.slice(0, close)
      answer = answer.slice(close).replace(/<\/think(?:ing)?>/i, '')
    }
  }
  return { reasoning, answer }
}

/** Merge a message's reasoning channel with any inline `<think>` in its content. */
function extractResult(msg: MessageNode | undefined): VisionResult {
  const split = splitThinking(typeof msg?.content === 'string' ? msg.content : '')
  return { answer: split.answer.trim(), reasoning: (nodeReasoning(msg) + split.reasoning).trim() }
}

/** Build the OpenAI chat body. `stream` switches on SSE token streaming. `temperature` is omitted for
 *  the reasoning families that reject it (GPT-5 / o-series); other servers get the low temperature. */
function chatPayload(args: ChatVisionArgs, stream: boolean): Record<string, unknown> {
  return {
    model: args.model,
    messages: [
      { role: 'system', content: args.system },
      {
        role: 'user',
        content: [
          { type: 'text', text: args.user },
          { type: 'image_url', image_url: { url: args.dataUri } }
        ]
      }
    ],
    max_tokens: args.maxTokens ?? 1500,
    ...(isReasoningModel(args.model) ? {} : { temperature: 0.2 }),
    ...(stream ? { stream: true } : {})
  }
}

/** Pull the offending parameter name out of a provider's 400 body, so we can strip JUST that field
 *  and retry — covers "Unsupported parameter: temperature", "unknown field top_p", vLLM's "unexpected
 *  keyword argument 'x'", etc. Returns the lower-cased param name or null. */
function unsupportedParam(body: string): string | null {
  const pats = [
    /unsupported parameter[:\s]+["'`]?([a-z_][\w.]*)/i,
    /unknown (?:field|parameter|argument|key)[:\s]+["'`]?([a-z_][\w.]*)/i,
    /unexpected keyword argument ['"`]?([a-z_]\w*)/i,
    /(?:parameter|property|field) ['"`]?([a-z_][\w.]*)['"`]? (?:is )?(?:not supported|unknown|unexpected|not permitted)/i,
    /['"`]([a-z_][\w.]*)['"`] is not (?:a )?(?:supported|permitted|allowed|recognized)/i
  ]
  for (const re of pats) {
    const m = re.exec(body)
    if (m) return m[1].toLowerCase()
  }
  return null
}

/** Does the 400 body look like a rejected thinking / reasoning enable-disable field? (Older detector,
 *  kept because those field names are nested and not always surfaced as a clean "param" token.) */
function looksLikeThinkingReject(body: string): boolean {
  return /enable_thinking|chat_template|thinking|reasoning|extra (?:field|input)|not permitted|additional|unexpected|unknown/i.test(
    body
  )
}

/** Remove a top-level key from the OpenAI payload by its (lower-cased) name. Also maps the common
 *  `max_tokens` → `max_completion_tokens` rename some newer endpoints require. Returns true if it
 *  actually changed the body. */
function stripParam(body: Record<string, unknown>, name: string): boolean {
  if (name === 'max_tokens' && 'max_tokens' in body) {
    body.max_completion_tokens = body.max_tokens
    delete body.max_tokens
    return true
  }
  for (const key of Object.keys(body)) {
    if (key.toLowerCase() === name) {
      delete body[key]
      return true
    }
  }
  return false
}

/**
 * POST the (optionally streaming) OpenAI chat request and return an OK Response. Self-heals a strict
 * server: on a 400 that names an unsupported parameter (temperature on GPT-5, an unknown thinking
 * field, …) it strips that field and retries, a few times, until the request is accepted or the 400
 * is about something else. Enforces a timeout via `signal` so a hung remote fails fast + retryable.
 */
async function sendChatOpenAI(args: ChatVisionArgs, stream: boolean, signal: AbortSignal): Promise<Response> {
  if (!args.model) throw new VisionError('未填写模型名称')
  const url = chatCompletionsUrl(args.baseUrl)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (args.apiKey) headers.Authorization = `Bearer ${args.apiKey}`
  const tweak = thinkingFields(args.model, !!args.thinking)
  const body: Record<string, unknown> = { ...chatPayload(args, stream), ...tweak }

  const post = async (): Promise<Response> => {
    try {
      return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    } catch (e) {
      if (isAbortError(e)) throw e // cancelled / timed out — let the caller classify
      throw new VisionError('网络连接失败，请检查网络或 API 地址')
    }
  }

  let res = await post()
  // Self-heal loop: keep dropping one rejected field per 400 (bounded — every payload has a finite
  // number of removable keys, and the guard set prevents re-removing the same one forever).
  const removed = new Set<string>()
  for (let attempt = 0; !res.ok && res.status === 400 && attempt < 5; attempt++) {
    const peek = await res.text().catch(() => '')
    const param = unsupportedParam(peek)
    let changed = false
    if (param && !removed.has(param)) {
      removed.add(param)
      changed = stripParam(body, param)
    }
    // fall back to the thinking-field heuristic when the body didn't name a clean param token
    if (!changed && Object.keys(tweak).length > 0 && looksLikeThinkingReject(peek)) {
      for (const k of Object.keys(tweak)) changed = stripParam(body, k) || changed
    }
    if (!changed) {
      // a 400 we can't fix by dropping a field — surface it (trimmed) as-is
      throw new VisionError(`请求失败（400）：${peek.slice(0, 200)}`)
    }
    res = await post()
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) throw new VisionError('API Key 无效或缺失')
    if (res.status === 404) throw new VisionError('接口或模型不存在，请检查 API 地址与模型名')
    // a non-vision model commonly 400s on the image_url part
    throw new VisionError(`请求失败（${res.status}）：${errBody.slice(0, 200)}`)
  }
  return res
}

async function openaiChatOnce(args: ChatVisionArgs): Promise<VisionResult> {
  const t = withTimeout(args.signal, REQUEST_TIMEOUT_MS)
  try {
    const res = await sendChatOpenAI(args, false, t.signal)
    let data: ChatResponse
    try {
      data = (await res.json()) as ChatResponse
    } catch {
      throw new VisionError('模型返回解析失败')
    }
    const r = extractResult(data.choices?.[0]?.message)
    if (!r.answer && !r.reasoning) {
      throw new VisionError(data.error?.message || '模型未返回内容（可能不支持图片输入）')
    }
    return r
  } catch (e) {
    throw mapTimeout(e, t.timedOut())
  } finally {
    t.clear()
  }
}

async function openaiChatStream(
  args: ChatVisionArgs & { onDelta: (answer: string, reasoning: string) => void }
): Promise<VisionResult> {
  const t = withTimeout(args.signal, STREAM_FIRST_TIMEOUT_MS)
  try {
    const res = await sendChatOpenAI(args, true, t.signal)
    const decoder = new TextDecoder()
    let contentRaw = ''
    let reasoningRaw = ''
    let full = '' // every decoded char (for the non-SSE single-JSON fallback)
    let buffer = ''
    let lastA = ''
    let lastR = ''
    // hold the generous first-token window until real content arrives, so an SSE keep-alive / role
    // preamble can't collapse it to the short idle window before the model has emitted anything.
    let sawContent = false
    const emit = (): void => {
      const split = splitThinking(contentRaw)
      const answer = split.answer
      const reasoning = reasoningRaw + split.reasoning
      if (answer !== lastA || reasoning !== lastR) {
        lastA = answer
        lastR = reasoning
        args.onDelta(answer, reasoning)
      }
    }
    const processLine = (line: string): void => {
      const s = line.trim()
      if (!s.startsWith('data:')) return // skip SSE comments / keep-alives / non-SSE lines
      const data = s.slice(5).trim()
      if (!data || data === '[DONE]') return
      try {
        const j = JSON.parse(data) as StreamChunk
        const node = j.choices?.[0]?.delta ?? j.choices?.[0]?.message
        let changed = false
        if (typeof node?.content === 'string' && node.content) {
          contentRaw += node.content
          changed = true
        }
        const rc = nodeReasoning(node)
        if (rc) {
          reasoningRaw += rc
          changed = true
        }
        if (changed) {
          sawContent = true
          emit()
        }
      } catch {
        // a split-across-reads partial line slipped through — ignore; the next read completes it
      }
    }

    if (res.body) {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        t.arm(sawContent ? STREAM_IDLE_TIMEOUT_MS : STREAM_FIRST_TIMEOUT_MS)
        const chunk = decoder.decode(value, { stream: true })
        full += chunk
        buffer += chunk
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          processLine(buffer.slice(0, nl))
          buffer = buffer.slice(nl + 1)
        }
      }
      const tail = decoder.decode()
      full += tail
      buffer += tail
      if (buffer.trim()) processLine(buffer)
    } else {
      full = await res.text().catch(() => '')
    }

    const split = splitThinking(contentRaw)
    let answer = split.answer.trim()
    let reasoning = (reasoningRaw + split.reasoning).trim()
    if (!answer && !reasoning && full.trim()) {
      try {
        const data = JSON.parse(full) as ChatResponse
        const r = extractResult(data.choices?.[0]?.message)
        answer = r.answer
        reasoning = r.reasoning
      } catch {
        // not JSON either — fall through to the empty-answer error
      }
    }
    if (!answer && !reasoning) throw new VisionError('模型未返回内容（可能不支持图片输入）')
    if (answer !== lastA || reasoning !== lastR) args.onDelta(answer, reasoning)
    return { answer, reasoning }
  } catch (e) {
    throw mapTimeout(e, t.timedOut())
  } finally {
    t.clear()
  }
}

// ===========================================================================
// Anthropic messages path (/v1/messages) — Claude models + relays
// ===========================================================================

// A stable-per-process device id shaped like the real Claude Code CLI's (64 hex chars). Some relays
// (claude-relay-service and friends) reject a plain SDK request from an account group locked to
// "Claude Code clients"; a Claude-Code-shaped fingerprint (UA + betas + metadata.user_id + a system
// block that matches the CLI identity template) makes them accept it. Harmless against the real API.
const CLIENT_DEVICE_ID = randomBytes(32).toString('hex')
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."
const CLAUDE_CODE_VERSION = '2.1.198'
const CLAUDE_CODE_BETAS = 'claude-code-20250219,interleaved-thinking-2025-05-14'

/** Build the /v1/messages URL, tolerating a trailing slash, a pasted full endpoint, or a host
 *  without the /v1 version segment. */
function messagesUrl(baseUrl: string): string {
  let b = baseUrl.trim().replace(/\/+$/, '')
  b = b.replace(/\/v\d+\/messages$/, '').replace(/\/messages$/, '')
  if (!/\/v\d+$/.test(b)) b += '/v1'
  return `${b}/messages`
}

/** Split a data URI into the media type + raw base64 for an Anthropic image block. */
function parseDataUri(dataUri: string): { mediaType: string; data: string } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUri)
  if (!m) throw new VisionError('图片编码异常')
  return { mediaType: m[1], data: m[2] }
}

interface AnthropicContentBlock {
  type: string
  text?: string
  thinking?: string
}
interface AnthropicResponse {
  content?: AnthropicContentBlock[]
  error?: { message?: string; type?: string }
  type?: string
}

/** The Claude-Code-client disguise headers + Anthropic auth. Auth goes on BOTH `x-api-key` and
 *  `Authorization: Bearer` so it works whether the endpoint expects the API-key or the bearer form. */
function anthropicHeaders(apiKey: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': CLAUDE_CODE_BETAS,
    'anthropic-dangerous-direct-browser-access': 'true',
    'User-Agent': `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
    'x-app': 'cli'
  }
  if (apiKey) {
    h['x-api-key'] = apiKey
    h.Authorization = `Bearer ${apiKey}`
  }
  return h
}

/** Build the Anthropic request body. The `system` array holds ONLY the CLI identity block (strict
 *  relays require every system block to match a known template), so our real instructions ride at the
 *  front of the user text instead. Thinking, when on, uses adaptive reasoning. */
function anthropicBody(args: ChatVisionArgs, stream: boolean): Record<string, unknown> {
  const { mediaType, data } = parseDataUri(args.dataUri)
  const instructions = args.system ? `${args.system}\n\n${args.user}` : args.user
  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: args.maxTokens ?? 1500,
    metadata: {
      user_id: JSON.stringify({
        device_id: CLIENT_DEVICE_ID,
        account_uuid: '',
        session_id: randomUUID()
      })
    },
    system: [{ type: 'text', text: CLAUDE_CODE_IDENTITY, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: instructions },
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } }
        ]
      }
    ],
    ...(stream ? { stream: true } : {}),
    ...(args.thinking ? { thinking: { type: 'adaptive', display: 'summarized' } } : {})
  }
  return body
}

/** POST the Anthropic request, self-healing a 400 that rejects `thinking` (drop it and retry) and
 *  mapping auth/other failures to friendly messages. Enforces the timeout `signal`. */
async function sendAnthropic(args: ChatVisionArgs, stream: boolean, signal: AbortSignal): Promise<Response> {
  if (!args.model) throw new VisionError('未填写模型名称')
  const url = messagesUrl(args.baseUrl)
  const headers = anthropicHeaders(args.apiKey)
  const body = anthropicBody(args, stream)

  const post = async (): Promise<Response> => {
    try {
      return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    } catch (e) {
      if (isAbortError(e)) throw e
      throw new VisionError('网络连接失败，请检查网络或 API 地址')
    }
  }

  let res = await post()
  if (!res.ok && res.status === 400 && 'thinking' in body) {
    const peek = await res.text().catch(() => '')
    if (/thinking|budget|reasoning|unsupported|unknown|unexpected/i.test(peek)) {
      delete body.thinking
      res = await post()
    } else {
      throw new VisionError(`请求失败（400）：${peek.slice(0, 200)}`)
    }
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) throw new VisionError('API Key 无效或缺失')
    if (res.status === 404) throw new VisionError('接口或模型不存在，请检查 API 地址与模型名')
    throw new VisionError(`请求失败（${res.status}）：${errBody.slice(0, 200)}`)
  }
  return res
}

async function anthropicOnce(args: ChatVisionArgs): Promise<VisionResult> {
  const t = withTimeout(args.signal, REQUEST_TIMEOUT_MS)
  try {
    const res = await sendAnthropic(args, false, t.signal)
    let data: AnthropicResponse
    try {
      data = (await res.json()) as AnthropicResponse
    } catch {
      throw new VisionError('模型返回解析失败')
    }
    let answer = ''
    let reasoning = ''
    for (const block of data.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') answer += block.text
      else if (block.type === 'thinking' && typeof block.thinking === 'string') reasoning += block.thinking
    }
    answer = answer.trim()
    reasoning = reasoning.trim()
    if (!answer && !reasoning) {
      throw new VisionError(data.error?.message || '模型未返回内容（可能不支持图片输入）')
    }
    return { answer, reasoning }
  } catch (e) {
    throw mapTimeout(e, t.timedOut())
  } finally {
    t.clear()
  }
}

interface AnthropicStreamEvent {
  type?: string
  delta?: { type?: string; text?: string; thinking?: string }
  content_block?: { type?: string; text?: string; thinking?: string }
  error?: { message?: string; type?: string }
  message?: { content?: AnthropicContentBlock[] }
}

async function anthropicStream(
  args: ChatVisionArgs & { onDelta: (answer: string, reasoning: string) => void }
): Promise<VisionResult> {
  const t = withTimeout(args.signal, STREAM_FIRST_TIMEOUT_MS)
  try {
    const res = await sendAnthropic(args, true, t.signal)
    const decoder = new TextDecoder()
    let answer = ''
    let reasoning = ''
    let full = '' // every decoded char (for the non-SSE single-JSON fallback)
    let buffer = ''
    let streamErr: string | null = null
    // hold the first-token window until real content arrives — Anthropic sends message_start / ping
    // early, which must not collapse the timeout before the model has produced any text/thinking.
    let sawContent = false
    const emit = (): void => args.onDelta(answer, reasoning)
    const processLine = (line: string): void => {
      const s = line.trim()
      if (!s.startsWith('data:')) return // Anthropic SSE also has `event:` lines — the data line suffices
      const data = s.slice(5).trim()
      if (!data) return
      try {
        const ev = JSON.parse(data) as AnthropicStreamEvent
        if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) {
            answer += ev.delta.text
            sawContent = true
            emit()
          } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
            reasoning += ev.delta.thinking
            sawContent = true
            emit()
          }
        } else if (ev.type === 'error') {
          streamErr = ev.error?.message || '模型返回错误'
        }
      } catch {
        // partial line across reads — the next read completes it
      }
    }

    if (res.body) {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        t.arm(sawContent ? STREAM_IDLE_TIMEOUT_MS : STREAM_FIRST_TIMEOUT_MS)
        const chunk = decoder.decode(value, { stream: true })
        full += chunk
        buffer += chunk
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          processLine(buffer.slice(0, nl))
          buffer = buffer.slice(nl + 1)
        }
      }
      const tail = decoder.decode()
      full += tail
      buffer += tail
      if (buffer.trim()) processLine(buffer)
    } else {
      full = await res.text().catch(() => '')
    }

    answer = answer.trim()
    reasoning = reasoning.trim()
    // server ignored stream:true (no SSE events parsed) → parse the whole body as one messages JSON
    if (!answer && !reasoning && full.trim()) {
      try {
        const data = JSON.parse(full) as AnthropicResponse
        for (const block of data.content ?? []) {
          if (block.type === 'text' && typeof block.text === 'string') answer += block.text
          else if (block.type === 'thinking' && typeof block.thinking === 'string') reasoning += block.thinking
        }
        answer = answer.trim()
        reasoning = reasoning.trim()
        if (data.error?.message && !answer && !reasoning) streamErr = data.error.message
      } catch {
        // not JSON either — fall through to the empty-answer error
      }
    }
    if (!answer && !reasoning) {
      throw new VisionError(streamErr || '模型未返回内容（可能不支持图片输入）')
    }
    args.onDelta(answer, reasoning)
    return { answer, reasoning }
  } catch (e) {
    throw mapTimeout(e, t.timedOut())
  } finally {
    t.clear()
  }
}

// ===========================================================================
// OpenAI Responses path (/v1/responses) — Codex / GPT-5 proxies
// Some Codex-backed proxies expose vision ONLY through the Responses API and silently DROP images
// sent to chat-completions (the model then hallucinates or replies "please upload an image"). This
// path speaks Responses instead: image as an `input_image` part, and it ALWAYS streams (a common
// proxy requirement) — the non-stream callers just aggregate the stream.
// ===========================================================================

/** Build the /v1/responses URL, tolerating a trailing slash, a pasted full endpoint, or a host
 *  without the /v1 version segment. */
function responsesUrl(baseUrl: string): string {
  let b = baseUrl.trim().replace(/\/+$/, '')
  b = b.replace(/\/v\d+\/responses$/, '').replace(/\/responses$/, '')
  if (!/\/v\d+$/.test(b)) b += '/v1'
  return `${b}/responses`
}

/** Responses API body. The system prompt rides at the front of the user text (Responses has an
 *  `instructions` field, but folding it in avoids a proxy that doesn't support it). Kept MINIMAL —
 *  strict Codex proxies 400 on max_output_tokens / reasoning.effort:minimal — and self-heals any
 *  parameter a server still rejects (sendResponses). */
function responsesBody(args: ChatVisionArgs): Record<string, unknown> {
  const instructions = args.system ? `${args.system}\n\n${args.user}` : args.user
  return {
    model: args.model,
    store: false,
    stream: true,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: instructions },
          { type: 'input_image', image_url: args.dataUri }
        ]
      }
    ]
  }
}

interface ResponsesOutputPart {
  type?: string
  text?: string
}
interface ResponsesOutputItem {
  type?: string
  content?: ResponsesOutputPart[]
  summary?: ResponsesOutputPart[]
}
interface ResponsesJson {
  output_text?: string
  output?: ResponsesOutputItem[]
  error?: { message?: string }
}
interface ResponsesEvent {
  type?: string
  delta?: string
  text?: string
  // a streamed error event carries its message at the TOP level (ev.message); some proxies nest it
  message?: string
  error?: { message?: string }
  response?: ResponsesJson & { error?: { message?: string } }
}

/** Pull answer + reasoning out of a full (non-stream) Responses JSON body. Uses the structured
 *  `output[]` parts when present and only falls back to the `output_text` convenience field otherwise
 *  — many proxies send BOTH, so summing them would double the text. */
function extractResponses(data: ResponsesJson): VisionResult {
  let answer = ''
  let reasoning = ''
  for (const item of data.output ?? []) {
    if (item.type === 'message') {
      for (const c of item.content ?? []) {
        if (c.type === 'output_text' && typeof c.text === 'string') answer += c.text
      }
    } else if (item.type === 'reasoning') {
      for (const c of item.summary ?? []) {
        if (typeof c.text === 'string') reasoning += c.text
      }
    }
  }
  if (!answer && typeof data.output_text === 'string') answer = data.output_text
  return { answer: answer.trim(), reasoning: reasoning.trim() }
}

/** POST the (always-streaming) Responses request, self-healing a 400 that names an unsupported
 *  parameter (Codex proxies reject max_output_tokens etc.) by stripping it and retrying. */
async function sendResponses(args: ChatVisionArgs, signal: AbortSignal): Promise<Response> {
  if (!args.model) throw new VisionError('未填写模型名称')
  const url = responsesUrl(args.baseUrl)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (args.apiKey) headers.Authorization = `Bearer ${args.apiKey}`
  const body = responsesBody(args)

  const post = async (): Promise<Response> => {
    try {
      return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    } catch (e) {
      if (isAbortError(e)) throw e
      throw new VisionError('网络连接失败，请检查网络或 API 地址')
    }
  }

  let res = await post()
  const removed = new Set<string>()
  for (let attempt = 0; !res.ok && res.status === 400 && attempt < 5; attempt++) {
    const peek = await res.text().catch(() => '')
    const param = unsupportedParam(peek)
    let changed = false
    if (param && !removed.has(param)) {
      removed.add(param)
      changed = stripParam(body, param)
    }
    if (!changed) throw new VisionError(`请求失败（400）：${peek.slice(0, 200)}`)
    res = await post()
  }

  if (!res.ok) {
    const b = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) throw new VisionError('API Key 无效或缺失')
    if (res.status === 404) throw new VisionError('接口或模型不存在，请检查 API 地址与模型名')
    throw new VisionError(`请求失败（${res.status}）：${b.slice(0, 200)}`)
  }
  return res
}

/** Stream a Responses call. `onDelta` (when given) receives the growing answer + reasoning; the
 *  non-stream callers pass none and just take the returned final pair. Parses Responses SSE
 *  (`response.output_text.delta`, `.done`, reasoning summary deltas) with a whole-body JSON fallback
 *  for a server that ignored stream:true. */
async function responsesStreamCore(
  args: ChatVisionArgs,
  onDelta?: (answer: string, reasoning: string) => void
): Promise<VisionResult> {
  const t = withTimeout(args.signal, STREAM_FIRST_TIMEOUT_MS)
  try {
    const res = await sendResponses(args, t.signal)
    const decoder = new TextDecoder()
    let answer = ''
    let reasoning = ''
    let full = ''
    let buffer = ''
    let streamErr: string | null = null
    let lastA = ''
    let lastR = ''
    // keep the generous first-token window until real CONTENT arrives — a GPT-5/Codex model reasons
    // silently and the Responses API emits response.created / .in_progress within ~1s; collapsing to
    // the short idle window on those lifecycle events would abort a healthy but slow-to-first-token run.
    let sawContent = false
    const emit = (): void => {
      if (onDelta && (answer !== lastA || reasoning !== lastR)) {
        lastA = answer
        lastR = reasoning
        onDelta(answer, reasoning)
      }
    }
    const processLine = (line: string): void => {
      const s = line.trim()
      if (!s.startsWith('data:')) return
      const data = s.slice(5).trim()
      if (!data || data === '[DONE]') return
      try {
        const ev = JSON.parse(data) as ResponsesEvent
        const ty = ev.type ?? ''
        if (ty === 'response.output_text.delta' && typeof ev.delta === 'string') {
          answer += ev.delta
          sawContent = true
          emit()
        } else if (ty === 'response.reasoning_summary_text.delta' && typeof ev.delta === 'string') {
          reasoning += ev.delta
          sawContent = true
          emit()
        } else if (ty === 'response.output_text.done' && !answer && typeof ev.text === 'string') {
          answer = ev.text
          sawContent = true
          emit()
        } else if (ty === 'response.failed' || ty === 'error' || ty === 'response.error') {
          streamErr = ev.message || ev.error?.message || ev.response?.error?.message || '模型返回错误'
        }
      } catch {
        // partial line across reads — the next read completes it
      }
    }

    if (res.body) {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        t.arm(sawContent ? STREAM_IDLE_TIMEOUT_MS : STREAM_FIRST_TIMEOUT_MS)
        const chunk = decoder.decode(value, { stream: true })
        full += chunk
        buffer += chunk
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          processLine(buffer.slice(0, nl))
          buffer = buffer.slice(nl + 1)
        }
      }
      const tail = decoder.decode()
      full += tail
      buffer += tail
      if (buffer.trim()) processLine(buffer)
    } else {
      full = await res.text().catch(() => '')
    }

    answer = answer.trim()
    reasoning = reasoning.trim()
    // server ignored stream:true → parse the whole body as one Responses JSON
    if (!answer && !reasoning && full.trim()) {
      try {
        const r = extractResponses(JSON.parse(full) as ResponsesJson)
        answer = r.answer
        reasoning = r.reasoning
      } catch {
        // not JSON either — fall through to the empty-answer error
      }
    }
    if (!answer && !reasoning) throw new VisionError(streamErr || '模型未返回内容（可能不支持图片输入）')
    if (onDelta) onDelta(answer, reasoning)
    return { answer, reasoning }
  } catch (e) {
    throw mapTimeout(e, t.timedOut())
  } finally {
    t.clear()
  }
}

// ===========================================================================
// Public API — protocol-dispatched
// ===========================================================================

/** Convert a timeout-induced abort into a friendly VisionError; leave a caller cancel as the raw
 *  AbortError (the caller swallows it) and pass VisionErrors through unchanged. */
function mapTimeout(err: unknown, timedOut: boolean): unknown {
  if (err instanceof VisionError) return err
  if (isAbortError(err)) {
    return timedOut ? new VisionError('请求超时，请重试') : err
  }
  return err
}

function resolveProtocol(args: ChatVisionArgs): VisionProtocol {
  return detectVisionProtocol(args)
}

/** One non-streaming vision call → separated answer + reasoning. (The Responses path always streams
 *  internally — a proxy requirement — but aggregates to a single result here.) */
export async function chatVisionOnce(args: ChatVisionArgs): Promise<VisionResult> {
  const protocol = resolveProtocol(args)
  if (protocol === 'anthropic') return anthropicOnce(args)
  if (protocol === 'openai-responses') return responsesStreamCore(args)
  return openaiChatOnce(args)
}

/**
 * Plain non-streaming call that returns ONLY the answer (used by 提取文本/公式 and the capability
 * test, where thinking is disabled and reasoning is irrelevant). Throws VisionError with a friendly
 * Chinese message the capture window shows as-is.
 */
export async function chatVision(args: ChatVisionArgs): Promise<string> {
  const { answer } = await chatVisionOnce(args)
  if (!answer) throw new VisionError('模型只返回了思考过程，请重试（或调大输出长度）')
  return answer
}

/**
 * Streaming vision chat (used by 翻译 + 分析): emits the answer + reasoning so far to `onDelta` as
 * tokens arrive (for live rendering), and returns the final pair. Dispatches to the OpenAI SSE or
 * Anthropic SSE parser by protocol. If the server ignores `stream:true` and returns one JSON body,
 * it falls back to a single emit — callers get one code path either way.
 */
export async function chatVisionStream(
  args: ChatVisionArgs & { onDelta: (answer: string, reasoning: string) => void }
): Promise<VisionResult> {
  const protocol = resolveProtocol(args)
  if (protocol === 'anthropic') return anthropicStream(args)
  if (protocol === 'openai-responses') return responsesStreamCore(args, args.onDelta)
  return openaiChatStream(args)
}
