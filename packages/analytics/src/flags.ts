import type {
  AnalyticsPeriod, ContributionFlag, LiveProjectSettings, ProjectContributionResult, WorkValues,
} from '@teampulse/shared'
import type { Credit, PeriodEvent } from './events'
import { asPeriod, DAY, dateStart } from './period'

interface FlagContext {
  coverageStart: number
  start: number
  end: number
  knownCredits: Map<string, Credit[]>
  latestUnknown: PeriodEvent | undefined
  useWeekEnd: boolean
  memberJoinedOn?: Record<string, string>
}

const weighted = (credit: Credit, weights: WorkValues) => credit.units * weights[credit.category]
const fullDayStart = (timestamp: number) => Math.floor(timestamp / DAY) * DAY
const chronological = (a: Credit, b: Credit) => a.timestamp - b.timestamp
const eventIds = (credits: Credit[]) => [...new Set(credits.flatMap(credit => credit.eventIds))]

function deadlineEnds(settings: LiveProjectSettings, { start, end, useWeekEnd }: FlagContext): number[] {
  const dates = [...settings.milestones.map(point => point.date), settings.endsOn]
  const checkpoints = [...new Set(dates.map(date => dateStart(date) + DAY))]
    .filter(checkpoint => checkpoint > start && checkpoint <= end).sort((a, b) => a - b)
  if (checkpoints.length === 0 && useWeekEnd) return [end]
  return checkpoints
}

export function contributionFlags(
  result: ProjectContributionResult, settings: LiveProjectSettings, context: FlagContext,
): ContributionFlag[] {
  const reportPeriod = result.period
  if (!reportPeriod) return []
  const flags: ContributionFlag[] = []
  const { start, end, coverageStart, knownCredits, latestUnknown } = context
  const { thresholds, weights } = settings
  const add = (flag: Omit<ContributionFlag, 'teamId' | 'period'>, period: AnalyticsPeriod = reportPeriod) => {
    flags.push({ ...flag, teamId: result.teamId, period })
  }

  const allKnown = [...knownCredits.values()].flat().sort(chronological)
  const teammate = allKnown.at(-1)
  const latestTeam = Math.max(teammate?.timestamp ?? -Infinity, latestUnknown?.timestamp ?? -Infinity)
  const observedEnd = fullDayStart(end)
  const silenceStart = Number.isFinite(latestTeam) ? fullDayStart(latestTeam) + DAY : coverageStart
  const silentDays = (observedEnd - silenceStart) / DAY
  if (silentDays >= thresholds.inactivity) {
    add({ kind: 'teamInactivity', severity: 'risk', actual: silentDays, threshold: thresholds.inactivity, unit: 'days',
      explanation: 'В наблюдаемом периоде у команды нет учитываемой активности.',
      evidenceEventIds: latestUnknown && latestTeam === latestUnknown.timestamp
        ? [latestUnknown.event.id] : teammate?.eventIds ?? [] }, asPeriod(silenceStart, observedEnd))
  }

  if (result.unknownAuthors.count > 0) {
    add({ kind: 'unknown', severity: 'warning', actual: result.unknownAuthors.count, threshold: 0, unit: 'events',
      explanation: 'Часть событий пока не связана с участниками команды.',
      evidenceEventIds: result.unknownAuthors.eventIds })
  }

  const checkpoints = deadlineEnds(settings, context)
  for (const member of result.members) {
    const { userId } = member
    const credits = knownCredits.get(userId) ?? []
    const last = credits.at(-1)
    const joined = context.memberJoinedOn?.[userId]
    const memberSilenceStart = Math.max(last ? fullDayStart(last.timestamp) + DAY : coverageStart, joined ? dateStart(joined) : coverageStart)
    const inactiveDays = (observedEnd - memberSilenceStart) / DAY
    if (inactiveDays >= thresholds.inactivity && teammate && teammate.timestamp >= memberSilenceStart) {
      add({ kind: 'inactivity', userId, severity: 'warning', actual: inactiveDays, threshold: thresholds.inactivity, unit: 'days',
        explanation: 'У участника нет учитываемых действий, пока в команде есть активность.',
        evidenceEventIds: [...(last?.eventIds ?? []), ...teammate.eventIds] }, asPeriod(memberSilenceStart, observedEnd))
    }

    const current = credits.filter(credit => credit.timestamp >= start)
    if (result.members.length >= 3 && member.sharePercent > thresholds.imbalance) {
      add({ kind: 'imbalance', userId, severity: 'risk', actual: member.sharePercent, threshold: thresholds.imbalance, unit: 'percent',
        explanation: 'Доля участника в общем взвешенном вкладе превышает заданный порог.',
        evidenceEventIds: eventIds(current.filter(credit => weighted(credit, weights) > 0)) })
    }

    const excludedPercent = member.measuredChanges ? member.excludedChanges * 100 / member.measuredChanges : 0
    if (excludedPercent > thresholds.excluded) {
      const evidence = result.adjustments.filter(item => item.userId === userId && (item.lines ?? 0) > 0)
      add({ kind: 'excluded', userId, severity: 'warning', actual: excludedPercent, threshold: thresholds.excluded, unit: 'percent',
        explanation: 'Доля исключённых строк среди измеренных изменений превышает порог.',
        evidenceEventIds: [...new Set(evidence.flatMap(item => item.eventIds))] })
    }

    for (const checkpoint of checkpoints) {
      const lateStart = checkpoint - 3 * DAY
      if (lateStart <= start) continue
      const untilCheckpoint = current.filter(credit => credit.timestamp < checkpoint && weighted(credit, weights) > 0)
      const late = untilCheckpoint.filter(credit => credit.timestamp >= lateStart)
      const total = untilCheckpoint.reduce((sum, credit) => sum + weighted(credit, weights), 0)
      const latePercent = total > 0 ? late.reduce((sum, credit) => sum + weighted(credit, weights), 0) * 100 / total : 0
      if (latePercent > thresholds.lateBurst) {
        add({ kind: 'lateBurst', userId, severity: 'warning', actual: latePercent, threshold: thresholds.lateBurst, unit: 'percent',
          explanation: 'Доля взвешенного вклада за последние три дня наблюдаемого периода превышает порог.',
          evidenceEventIds: eventIds(late) }, asPeriod(start, checkpoint))
      }
    }
  }
  return flags
}
