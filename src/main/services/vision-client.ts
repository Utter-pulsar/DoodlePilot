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
}

/** Build the chat-completions URL, tolerating a trailing slash, a pasted full endpoint, or a host
 *  without the /v1 version segment. */
function chatCompletionsUrl(baseUrl: string): string {
  let b = baseUrl.trim().replace(/\/+$/, '')
  b = b.replace(/\/chat\/completions$/, '')
  if (!/\/v\d+$/.test(b)) b += '/v1'
  return `${b}/chat/completions`
}

interface ChatResponse {
  // we read ONLY `content` — reasoning returned in a separate `reasoning_content` field is ignored
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

/**
 * Per-family request fields that turn the model's "thinking"/reasoning OFF. Every endpoint speaks the
 * same OpenAI chat format, but each family disables thinking with a DIFFERENT field — so we pick by
 * the model id (the one reliable cross-vendor signal) instead of hard-coding a single vendor. Anything
 * a given server doesn't know is either ignored or caught by the 400-retry in chatVision, and
 * stripThinking() cleans the output regardless — so this is best-effort, never fatal.
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

/** Strip any leaked chain-of-thought from the answer. A model that ignores the disable flag often
 *  inlines its reasoning as <think>…</think> in `content`; drop it so it never pollutes the result. */
function stripThinking(text: string): string {
  let t = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  // some chat templates emit the OPENING tag themselves, so `content` starts mid-reasoning and only a
  // lone closing tag survives — treat everything up to that first close as reasoning and drop it.
  if (!/<think(?:ing)?>/i.test(t)) {
    const close = t.search(/<\/think(?:ing)?>/i)
    if (close !== -1) t = t.slice(close).replace(/<\/think(?:ing)?>/i, '')
  }
  return t.trim()
}

/**
 * One OpenAI-compatible vision chat call (used by translate, extract, and the capability test).
 * Sends the image as a data-URI `image_url`, with thinking/reasoning DISABLED per model family (see
 * noThinkingFields). Throws VisionError with a friendly Chinese message the capture window shows as-is.
 */
export async function chatVision(args: ChatVisionArgs): Promise<string> {
  if (!args.model) throw new VisionError('未填写模型名称')
  const url = chatCompletionsUrl(args.baseUrl)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (args.apiKey) headers.Authorization = `Bearer ${args.apiKey}`

  const payload = {
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
    temperature: 0.2
  }
  const noThink = noThinkingFields(args.model)

  const post = async (body: object): Promise<Response> => {
    try {
      return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    } catch {
      throw new VisionError('网络连接失败，请检查网络或 API 地址')
    }
  }

  let res = await post({ ...payload, ...noThink })
  // A strict server can 400 on a thinking-disable field it doesn't recognise. If the error body looks
  // like that, retry ONCE without it — stripThinking() still keeps the output clean if the model then
  // chooses to think. A 400 for any OTHER reason is surfaced as-is (no pointless second call).
  if (!res.ok && res.status === 400 && Object.keys(noThink).length > 0) {
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

  let data: ChatResponse
  try {
    data = (await res.json()) as ChatResponse
  } catch {
    throw new VisionError('模型返回解析失败')
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new VisionError(data.error?.message || '模型未返回内容（可能不支持图片输入）')
  }
  const answer = stripThinking(content)
  if (!answer) throw new VisionError('模型只返回了思考过程，请重试（或调大输出长度）')
  return answer
}
