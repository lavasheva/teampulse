import { calculateWeek, createGigaChatProvider, createYandexGptProvider, generateWeeklySummary } from '../src'
import { activity, week } from './fixtures'

function snapshot() {
  const input = week([
    activity('internal-pr-id', 'pr_merged', 'a'),
    activity('unknown-review', 'review', null),
  ], ['a', 'b'])
  input.members[0].name = 'Варя'
  input.events[0].payload.title = 'secret-shaped text never sent'
  return { input, result: calculateWeek(input) }
}

const choice = (content: string, reason = 'stop') =>
  Response.json({ choices: [{ message: { content }, finish_reason: reason }] })

test('renders a stable Russian template and skips external providers on an empty week', async () => {
  const input = week()
  const result = calculateWeek(input)
  const generate = jest.fn()
  const summary = await generateWeeklySummary(result, input.members, { name: 'mock', generate })
  expect(generate).not.toHaveBeenCalled()
  expect(summary).toMatchObject({ source: 'template', fallbackReason: 'empty', weekStartsOn: '2026-11-16',
    engineVersion: '1.1.0', sourceVersion: 1, text: expect.stringContaining('события GitHub не зарегистрированы') })
  expect(await generateWeeklySummary(result, input.members)).toEqual(summary)
})

test('validates AI selections, shares only numeric facts and keeps local names in output', async () => {
  const { input, result } = snapshot()
  const generate = jest.fn().mockResolvedValue('{"highlight":1,"attention":0}')
  const summary = await generateWeeklySummary(result, input.members, { name: 'mock', generate })
  expect(summary).toMatchObject({
    source: 'ai', provider: 'mock', evidenceEventIds: ['unknown-review'],
    text: expect.stringContaining('Заметный результат недели — ревью (1).'),
  })
  expect(summary.text).toContain('Варя — 100%')
  const prompt = JSON.stringify(generate.mock.calls)
  for (const privateValue of ['secret-shaped text', 'internal-pr-id', 'unknown-review', 'Варя', 'github.com']) {
    expect(prompt).not.toContain(privateValue)
  }
  const data = JSON.parse(generate.mock.calls[0][0][1].content)
  expect(data).toMatchObject({ activeMembers: 1, leadingShares: [100, 0],
    actions: [{ kind: 'pr_merged', count: 1 }, { kind: 'review', count: 1 }] })
})

test('invalid AI output or provider failure retains the same factual template', async () => {
  const { input, result } = snapshot()
  const fallback = await generateWeeklySummary(result, input.members)
  expect(fallback.text).toContain('принятые PR (1)')
  const invalid = { name: 'mock', generate: async () => '{"highlight":900,"attention":0}' }
  const failed = { name: 'mock', generate: async () => { throw new Error('timeout') } }
  await expect(generateWeeklySummary(result, input.members, invalid)).resolves.toEqual({ ...fallback, fallbackReason: 'invalid_response' })
  await expect(generateWeeklySummary(result, input.members, failed)).resolves.toEqual({ ...fallback, fallbackReason: 'provider_error' })
})

test('Yandex adapter sends a completion request and falls back on truncation', async () => {
  const { input, result } = snapshot()
  const request = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
    .mockResolvedValueOnce(choice('{"highlight":0,"attention":0}'))
    .mockResolvedValueOnce(choice('{"highlight":0,"attention":0}', 'length'))
  const provider = createYandexGptProvider({ apiKey: 'test-key', folderId: 'test-folder' }, request)
  await expect(generateWeeklySummary(result, input.members, provider)).resolves.toMatchObject({ source: 'ai', provider: 'yandexgpt' })
  const [url, options] = request.mock.calls[0]
  expect(url).toBe('https://ai.api.cloud.yandex.net/v1/chat/completions')
  expect(options).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer test-key', 'x-folder-id': 'test-folder' } })
  expect(options?.signal).toBeInstanceOf(AbortSignal)
  expect(JSON.parse(String(options?.body))).toMatchObject({ model: 'gpt://test-folder/yandexgpt/latest', stream: false })
  await expect(generateWeeklySummary(result, input.members, provider)).resolves.toMatchObject({ fallbackReason: 'provider_error' })
})

test('GigaChat exchanges a key for a token and sends it only to the completion endpoint', async () => {
  const { input, result } = snapshot()
  const request = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
    .mockResolvedValueOnce(Response.json({ access_token: 'test-token' }))
    .mockResolvedValueOnce(choice('{"highlight":0,"attention":0}'))
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
  const provider = createGigaChatProvider({ authorizationKey: 'test-basic', scope: 'GIGACHAT_API_CORP' }, request)
  await expect(generateWeeklySummary(result, input.members, provider)).resolves.toMatchObject({ source: 'ai', provider: 'gigachat' })
  const [[tokenUrl, auth], [chatUrl, chat]] = request.mock.calls
  expect(tokenUrl).toBe('https://ngw.devices.sberbank.ru:9443/api/v2/oauth')
  expect(auth?.headers).toMatchObject({ Authorization: 'Basic test-basic', RqUID: expect.stringMatching(/^[a-f0-9-]{36}$/) })
  expect(String(auth?.body)).toBe('scope=GIGACHAT_API_CORP')
  expect(chatUrl).toBe('https://api.giga.chat/v1/chat/completions')
  expect(chat?.headers).toMatchObject({ Authorization: 'Bearer test-token' })
  expect(auth?.signal).toBe(chat?.signal)
  await expect(generateWeeklySummary(result, input.members, provider)).resolves.toMatchObject({ fallbackReason: 'provider_error' })
  expect(request).toHaveBeenCalledTimes(3)
})
