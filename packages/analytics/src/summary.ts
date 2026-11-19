import type { AnalyticsWeeklySummary, ApiUser, ContributionFlag, WeeklyContributionResult } from '@teampulse/shared'

export interface SummaryMessage {
  role: 'system' | 'user'
  content: string
}

export interface SummaryProvider {
  readonly name: string
  generate(messages: SummaryMessage[]): Promise<string>
}

const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const lowerFirst = (text: string) => text[0].toLowerCase() + text.slice(1)
const flagTitles: Record<ContributionFlag['kind'], string> = {
  inactivity: 'пауза в активности участника',
  teamInactivity: 'пауза в активности команды',
  imbalance: 'неравномерное распределение вклада',
  lateBurst: 'концентрация вклада к концу периода',
  excluded: 'высокая доля исключённых строк',
  unknown: 'несопоставленное авторство',
}

type ActionKind = keyof WeeklyContributionResult['eventCounts']
const actionTitles: Record<ActionKind, string> = {
  commit: 'Коммиты',
  pr_opened: 'Открытые PR',
  pr_merged: 'Принятые PR',
  pr_closed: 'PR, закрытые без слияния',
  review: 'Ревью',
  issue_opened: 'Созданные задачи',
  issue_closed: 'Закрытые задачи',
}
const highlightPriority: ActionKind[] = ['pr_merged', 'issue_closed', 'review', 'commit', 'pr_opened', 'issue_opened', 'pr_closed']

const priority: Record<ContributionFlag['kind'], string> = {
  inactivity: 'Уточните, нужна ли участнику помощь.',
  teamInactivity: 'Проверьте полноту синхронизации репозитория и прогресс команды.',
  imbalance: 'Обсудите с командой распределение работы.',
  lateBurst: 'Посмотрите, когда команда начала работу к контрольной точке.',
  excluded: 'Посмотрите причины исключения изменений.',
  unknown: 'Проверьте сопоставление авторов с участниками.',
}

function parseSelection(answer: string, highlights: number, flags: number) {
  let data: unknown
  try { data = JSON.parse(answer) } catch { return null }
  if (!data || typeof data !== 'object' || !('highlight' in data) || !('attention' in data)) return null
  const { highlight, attention } = data
  const index = (value: unknown, length: number): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < length
  if (!index(highlight, highlights)) return null
  if (flags === 0 && attention === null) return { highlight, attention }
  return index(attention, flags) ? { highlight, attention } : null
}

export async function generateWeeklySummary(
  result: WeeklyContributionResult,
  members: Pick<ApiUser, 'id' | 'name' | 'githubLogin'>[],
  provider?: SummaryProvider,
): Promise<AnalyticsWeeklySummary> {
  const people = new Map(members.map(member => [member.id, member]))
  const label = (id: string) => {
    const person = people.get(id)
    return (person?.name?.trim() || person?.githubLogin || 'Участник').replace(/\s+/g, ' ').slice(0, 100)
  }
  const ranked = [...result.members].sort((a, b) => b.sharePercent - a.sharePercent)
  const active = ranked.filter(member => member.activeDays > 0)
  const counts = result.eventCounts
  const highlights = highlightPriority.filter(kind => counts[kind] > 0).map(kind => ({ kind, count: counts[kind] }))
  const flags = [...result.flags].sort((a, b) => Number(b.severity === 'risk') - Number(a.severity === 'risk'))
  const categories = [...new Set(flags.map(flag => flagTitles[flag.kind]))]
  const flagText = categories.length ? `Сигналы за период — ${categories.join(', ')}.` : 'Пороговые сигналы за период не сработали.'
  const confirmed = result.totalPoints > 0
    ? `наибольшие доли вклада — ${ranked.filter(member => member.sharePercent > 0).slice(0, 3)
      .map(member => `${label(member.userId)} — ${format.format(member.sharePercent)}%`).join(', ')}.`
    : 'общий взвешенный вклад за неделю равен нулю.'
  const metadata = {
    teamId: result.teamId, weekStartsOn: result.weekStartsOn, sourceVersion: result.sourceVersion, engineVersion: result.engineVersion,
  }

  if (highlights.length === 0) {
    const note = flags.length ? priority[flags[0].kind] : 'Проверьте, полностью ли загружена история репозитория.'
    return { ...metadata, source: 'template', fallbackReason: 'empty', evidenceEventIds: flags[0]?.evidenceEventIds ?? [],
      text: `За наблюдаемую неделю события GitHub не зарегистрированы. ${flagText} ${note}` }
  }

  let selection: { highlight: number; attention: number | null } = { highlight: 0, attention: flags.length ? 0 : null }
  let fallbackReason: AnalyticsWeeklySummary['fallbackReason']
  let source: AnalyticsWeeklySummary['source'] = 'template'
  if (provider) {
    const messages: SummaryMessage[] = [
      { role: 'system', content: 'Собери нейтральную русскоязычную недельную сводку по готовым данным. '
        + 'Выбери один наиболее содержательный результат работы и один сигнал для внимания руководителя. '
        + 'Не пересчитывай показатели и не добавляй фактов или оценок людей. '
        + 'Приложение сформирует предложения. Верни только JSON {"highlight":0,"attention":0} '
        + 'с индексами из списков, начиная с нуля. Если signals пуст, attention должен быть null.' },
      { role: 'user', content: JSON.stringify({
        actions: highlights, activeMembers: active.length, teamSize: ranked.length, gini: result.gini,
        leadingShares: ranked.slice(0, 3).map(member => member.sharePercent),
        signals: flags.slice(0, 12).map(({ kind, severity, actual, threshold, unit }) => ({ kind, severity, actual, threshold, unit })),
      }) },
    ]
    try {
      const response = parseSelection(await provider.generate(messages), highlights.length, Math.min(12, flags.length))
      if (response) {
        selection = response
        source = 'ai'
      } else {
        fallbackReason = 'invalid_response'
      }
    } catch {
      fallbackReason = 'provider_error'
    }
  }

  const chosen = highlights[selection.highlight]
  const focus = selection.attention === null ? undefined : flags[selection.attention]
  const workText = highlights.map(({ kind, count }) => `${actionTitles[kind]} — ${count}`).join(', ')
  const work = lowerFirst(workText)
  const focusLabel = focus?.userId ? ` (${label(focus.userId)})` : ''
  const focusText = focus ? `Фокус руководителя — ${flagTitles[focus.kind]}${focusLabel}. ${priority[focus.kind]}` : ''
  const text = [
    `Активность GitHub за неделю — ${work}.`,
    `Учитываемые действия есть у ${active.length} из ${ranked.length} участников, при этом ${confirmed}`,
    `Заметный результат недели — ${lowerFirst(actionTitles[chosen.kind])} (${chosen.count}).`,
    flagText, focusText,
  ].filter(Boolean).join(' ')
  return { ...metadata, text, source, evidenceEventIds: focus?.evidenceEventIds ?? [],
    ...(source === 'ai' && provider ? { provider: provider.name } : {}),
    ...(fallbackReason ? { fallbackReason } : {}) }
}
