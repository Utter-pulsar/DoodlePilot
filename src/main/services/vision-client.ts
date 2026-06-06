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
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

/**
 * One OpenAI-compatible vision chat call (used by translate, extract, and the capability test).
 * Sends the image as a data-URI `image_url`. Throws VisionError with a friendly Chinese message so
 * the capture window can surface it directly.
 */
export async function chatVision(args: ChatVisionArgs): Promise<string> {
  if (!args.model) throw new VisionError('未填写模型名称')
  const url = chatCompletionsUrl(args.baseUrl)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (args.apiKey) headers.Authorization = `Bearer ${args.apiKey}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
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
      })
    })
  } catch {
    throw new VisionError('网络连接失败，请检查网络或 API 地址')
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
  return content.trim()
}
