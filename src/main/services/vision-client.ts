/** A friendly, user-facing failure for the vision call (message is shown as-is in the capture UI). */
export class VisionError extends Error {}

interface ChatVisionArgs {
  baseUrl: string
  apiKey: string
  model: string
  dataUri: string // data:image/png;base64,...
  system: string
  user: string
  maxTokens?: number
  /** keep the model's reasoning ON (so the caller can show it). Default/false = actively disable it. */
  thinking?: boolean
}

/** Answer + reasoning, separated. `reasoning` is the model's chain-of-thought (from a separate
 *  `reasoning_content` field and/or inline `<think>…</think>`); it is empty unless thinking ran. */
export interface VisionResult {
  answer: string
  reasoning: string
}

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
  if (/^o[134](-|$|\b)/.test(m) || /gpt-?5/.test(m)) {
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
  if (/^o[134](-|$|\b)/.test(m) || /gpt-?5/.test(m)) return {}
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

/** Build the OpenAI chat body. `stream` switches on SSE token streaming. */
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
    temperature: 0.2,
    ...(stream ? { stream: true } : {})
  }
}

/**
 * POST the (optionally streaming) chat request and return an OK Response. When thinking is OFF
 * (default) it applies the per-family thinking-disable field with a single 400-retry if the server
 * rejects it; when thinking is ON it sends nothing extra (let the model reason). Maps common HTTP
 * failures to friendly VisionError messages. Shared by chatVisionOnce + chatVisionStream.
 */
async function sendChat(args: ChatVisionArgs, stream: boolean): Promise<Response> {
  if (!args.model) throw new VisionError('未填写模型名称')
  const url = chatCompletionsUrl(args.baseUrl)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (args.apiKey) headers.Authorization = `Bearer ${args.apiKey}`
  const payload = chatPayload(args, stream)
  const tweak = thinkingFields(args.model, !!args.thinking)
  if (args.thinking) {
    console.log(`[vision] thinking ON model=${args.model} stream=${stream} enableFields=${JSON.stringify(tweak)}`)
  }

  const post = async (body: object): Promise<Response> => {
    try {
      return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    } catch {
      throw new VisionError('网络连接失败，请检查网络或 API 地址')
    }
  }

  let res = await post({ ...payload, ...tweak })
  // A strict server can 400 on a thinking enable/disable field it doesn't recognise. If the error
  // body looks like that, retry ONCE without it — splitThinking() still keeps the output clean. A 400
  // for any OTHER reason is surfaced as-is (no pointless second call).
  if (!res.ok && res.status === 400 && Object.keys(tweak).length > 0) {
    const peek = await res.text().catch(() => '')
    if (/enable_thinking|chat_template|thinking|reasoning|extra (?:field|input)|not permitted|additional|unexpected|unknown/i.test(peek)) {
      res = await post(payload)
    } else {
      throw new VisionError(`请求失败（400）：${peek.slice(0, 160)}`)
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) throw new VisionError('API Key 无效或缺失')
    if (res.status === 404) throw new VisionError('接口或模型不存在，请检查 API 地址与模型名')
    // a non-vision model commonly 400s on the image_url part
    throw new VisionError(`请求失败（${res.status}）：${body.slice(0, 160)}`)
  }
  return res
}

/** One non-streaming vision call → separated answer + reasoning. */
export async function chatVisionOnce(args: ChatVisionArgs): Promise<VisionResult> {
  const res = await sendChat(args, false)
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
  if (args.thinking && !r.reasoning) {
    let sample = '(unserializable)'
    try {
      sample = JSON.stringify(data.choices?.[0]?.message ?? data).slice(0, 600)
    } catch {
      /* circular / too large — keep the fallback */
    }
    console.warn(`[vision] thinking ON but NO reasoning parsed (non-stream). model=${args.model} message=${sample}`)
  }
  return r
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
 * tokens arrive (for live rendering), and returns the final pair. Parses OpenAI SSE (`data: {…}`
 * lines), accumulating both `delta.content` (answer, minus any inline `<think>`) and
 * `delta.reasoning_content` (reasoning). If the server ignores `stream:true` and returns one JSON
 * body, it falls back to a single emit — callers get one code path either way.
 */
export async function chatVisionStream(
  args: ChatVisionArgs & { onDelta: (answer: string, reasoning: string) => void }
): Promise<VisionResult> {
  const res = await sendChat(args, true)
  const decoder = new TextDecoder()
  let contentRaw = ''
  let reasoningRaw = ''
  let full = '' // every decoded char (for the non-SSE single-JSON fallback)
  let buffer = ''
  let lastA = ''
  let lastR = ''
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
    const t = line.trim()
    if (!t.startsWith('data:')) return // skip SSE comments / keep-alives / non-SSE lines
    const data = t.slice(5).trim()
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
      if (changed) emit()
    } catch {
      // a split-across-reads partial line slipped through — ignore; the next read completes it
    }
  }

  if (res.body) {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      full += chunk
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        processLine(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
      }
    }
    // a stream can end WITHOUT a trailing newline — flush the decoder + the last buffered line
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
  // server ignored stream:true (no SSE tokens parsed) → parse the whole accumulated body as one JSON
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
  if (args.thinking && !reasoning) {
    console.warn(
      `[vision] thinking ON but NO reasoning parsed. model=${args.model} rawSample=${full.slice(0, 600)}`
    )
  }
  if (answer !== lastA || reasoning !== lastR) args.onDelta(answer, reasoning)
  return { answer, reasoning }
}
