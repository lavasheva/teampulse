import { randomUUID } from 'node:crypto'
import type { SummaryMessage, SummaryProvider } from './summary'

async function completion(
  request: typeof fetch, url: string, authorization: string, model: string,
  messages: SummaryMessage[], signal: AbortSignal, headers: Record<string, string> = {},
): Promise<string> {
  const response = await request(url, {
    method: 'POST', signal, redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: authorization, ...headers },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 128, stream: false }),
  })
  if (!response.ok) throw new Error(`Summary completion failed (${response.status})`)
  const body = await response.json() as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] } | null
  const choice = body?.choices?.[0]
  const content = choice?.message?.content
  if (choice?.finish_reason !== 'stop' || typeof content !== 'string' || !content.trim()) {
    throw new Error('Summary completion was empty or incomplete')
  }
  return content
}

export function createYandexGptProvider(
  options: { apiKey: string; folderId: string; model?: string; timeoutMs?: number },
  request: typeof fetch = fetch,
): SummaryProvider {
  return {
    name: 'yandexgpt',
    generate(messages) {
      return completion(request, 'https://ai.api.cloud.yandex.net/v1/chat/completions', `Bearer ${options.apiKey}`,
        `gpt://${options.folderId}/${options.model ?? 'yandexgpt/latest'}`, messages,
        AbortSignal.timeout(options.timeoutMs ?? 10_000),
        { 'x-folder-id': options.folderId, 'x-data-logging-enabled': 'false' })
    },
  }
}

export function createGigaChatProvider(
  options: { authorizationKey: string; scope?: 'GIGACHAT_API_PERS' | 'GIGACHAT_API_B2B' | 'GIGACHAT_API_CORP';
    model?: string; timeoutMs?: number },
  request: typeof fetch = fetch,
): SummaryProvider {
  return {
    name: 'gigachat',
    async generate(messages) {
      const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000)
      const response = await request('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
        method: 'POST', signal, redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
          RqUID: randomUUID(), Authorization: `Basic ${options.authorizationKey}` },
        body: new URLSearchParams({ scope: options.scope ?? 'GIGACHAT_API_PERS' }),
      })
      if (!response.ok) throw new Error(`GigaChat authorization failed (${response.status})`)
      const token = (await response.json() as { access_token?: unknown } | null)?.access_token
      if (typeof token !== 'string' || !token.trim()) throw new Error('GigaChat returned no access token')
      return completion(request, 'https://api.giga.chat/v1/chat/completions', `Bearer ${token}`,
        options.model ?? 'GigaChat-2-Lite', messages, signal)
    },
  }
}
