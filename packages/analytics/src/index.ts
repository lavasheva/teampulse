import type {
  ContributionMetrics, ProjectAnalyticsInput, ProjectContributionResult, WeeklyAnalyticsInput,
  WeeklyContributionResult, WorkKind, WorkValues,
} from '@teampulse/shared'
import { assessCommit, codeCredits } from './commits'
import { actionCredit, periodEvents, type Credit, type PeriodEvent } from './events'
import { contributionFlags } from './flags'
import { asPeriod, dateStart, DAY, projectBounds } from './period'

const version = '1.0.0'
export { generateWeeklySummary, type SummaryProvider, type SummaryMessage } from './summary'
export { createGigaChatProvider, createYandexGptProvider } from './providers'
const categories: WorkKind[] = ['code', 'pullRequests', 'reviews', 'issues']
const workValues = (calculate: (kind: WorkKind) => number): WorkValues => ({
  code: calculate('code'), pullRequests: calculate('pullRequests'), reviews: calculate('reviews'), issues: calculate('issues'),
})
const percent = (value: number, total: number) => total > 0 ? value * 100 / total : 0
const sum = (numbers: number[]) => numbers.reduce((total, value) => total + value, 0)
const utcDay = (timestamp: number) => Math.floor(timestamp / DAY)

function gini(scores: number[], total: number): number {
  if (scores.length < 2 || total === 0) return 0
  const sorted = [...scores].sort((a, b) => a - b)
  const numerator = sum(sorted.map((value, i) => (2 * i + 1 - sorted.length) * value))
  return numerator / ((sorted.length - 1) * total)
}

function scoreEvents(rows: PeriodEvent[]) {
  const commits = rows.filter(row => row.event.kind === 'commit').map(row => ({ row, assessment: assessCommit(row) }))
  const credits = [...rows.map(actionCredit).filter(credit => credit !== null), ...codeCredits(commits)]
  return { commits, credits }
}

function calculate(input: ProjectAnalyticsInput, bounds: [number, number],
  requestedStart: number, requestedEnd: number, historyStart?: number,
  weekly = false,
): ProjectContributionResult {
  const [projectStart, projectEnd] = bounds
  const cutoff = input.asOf === undefined ? requestedEnd : Date.parse(input.asOf)
  if (!Number.isFinite(cutoff) || (input.asOf !== undefined && !/(Z|[+-]\d{2}:\d{2})$/i.test(input.asOf))) {
    throw new RangeError('Expected an ISO timestamp with timezone for asOf')
  }
  const start = Math.max(requestedStart, projectStart)
  const end = Math.min(requestedEnd, projectEnd, cutoff)
  const period = start < end ? asPeriod(start, end) : null
  const userIds = [...new Set(input.members.map(member => member.id))].sort()
  const roster = new Set(userIds)
  const rows = periodEvents(input.events, roster, start, end)
  const { commits, credits } = scoreEvents(rows)
  const creditsByUser = new Map(userIds.map(id => [id, [] as Credit[]]))
  for (const credit of credits) creditsByUser.get(credit.userId)!.push(credit)

  const changeCounts = new Map(userIds.map(id => [id, { measuredChanges: 0, excludedChanges: 0 }]))
  for (const { row, assessment } of commits) {
    if (row.userId === null) continue
    const counts = changeCounts.get(row.userId)!
    counts.measuredChanges += assessment.measured
    counts.excludedChanges += assessment.excluded
  }
  const perMember = userIds.map(userId => {
    const memberCredits = creditsByUser.get(userId)!
    const units = workValues(kind => sum(memberCredits.filter(credit => credit.category === kind).map(credit => credit.units)))
    const weighted = sum(categories.map(kind => units[kind] * input.settings.weights[kind]))
    const days = [...new Set(memberCredits.map(credit => utcDay(credit.timestamp)))].sort((a, b) => a - b)
    return { userId, units, weighted, days }
  })

  const teamUnits = workValues(kind => sum(perMember.map(member => member.units[kind])))
  const weightedTotal = sum(perMember.map(member => member.weighted))
  const observedDays = period ? Math.ceil(end / DAY) - utcDay(start) : 0
  const members: ContributionMetrics[] = perMember.map(({ userId, units, weighted, days }) => {
    const first = days[0]
    const last = days.at(-1)
    return {
      userId,
      work: workValues(kind => units[kind] / 20),
      totalPoints: weighted / 2000,
      sharePercent: percent(weighted, weightedTotal),
      categoryShares: workValues(kind => percent(units[kind], teamUnits[kind])),
      activeDays: days.length,
      activeDaysPercent: percent(days.length, observedDays),
      averageGapDays: days.length > 1 ? (last! - first) / (days.length - 1) : null,
      lastActiveOn: last === undefined ? null : new Date(last * DAY).toISOString().slice(0, 10),
      ...changeCounts.get(userId)!,
    }
  })
  const eventCounts: ProjectContributionResult['eventCounts'] = {
    commit: 0, pr_opened: 0, pr_merged: 0, pr_closed: 0, review: 0, issue_opened: 0, issue_closed: 0,
  }
  for (const { event } of rows) eventCounts[event.kind]++
  const unknown = rows.filter(row => row.userId === null)
  const result: ProjectContributionResult = {
    engineVersion: version, teamId: input.teamId, projectId: input.projectId, sourceVersion: input.sourceVersion,
    period, members, flags: [], totalPoints: weightedTotal / 2000, gini: gini(perMember.map(member => member.weighted), weightedTotal),
    eventCounts, unknownAuthors: { count: unknown.length, eventIds: unknown.map(row => row.event.id) },
    adjustments: commits.flatMap(commit => commit.assessment.adjustments),
    commitsWithIncompleteStats: commits.filter(commit => commit.assessment.incomplete).map(commit => commit.row.event.id),
  }
  const coverageStart = Math.max(projectStart, Math.min(historyStart ?? start, start))
  const prior = period && coverageStart < start ? periodEvents(input.events, roster, coverageStart, start) : []
  for (const credit of scoreEvents(prior).credits) creditsByUser.get(credit.userId)!.push(credit)
  for (const memberCredits of creditsByUser.values()) memberCredits.sort((a, b) => a.timestamp - b.timestamp)
  result.flags = contributionFlags(result, input.settings, {
    coverageStart, start, end, knownCredits: creditsByUser,
    latestUnknown: unknown.at(-1) ?? prior.findLast(row => row.userId === null),
    useWeekEnd: weekly && end === requestedEnd,
  })
  return result
}

export function calculateWeek(input: WeeklyAnalyticsInput): WeeklyContributionResult {
  const start = dateStart(input.weekStartsOn)
  const end = dateStart(input.weekEndsBefore)
  if (new Date(start).getUTCDay() !== 1 || end !== start + 7 * DAY) {
    throw new RangeError('Expected Monday to Monday UTC dates')
  }
  const history = input.historyStartsOn === undefined ? undefined : dateStart(input.historyStartsOn)
  return { ...calculate(input, projectBounds(input), start, end, history, true), weekStartsOn: input.weekStartsOn }
}

export function calculateProject(input: ProjectAnalyticsInput): ProjectContributionResult {
  const bounds = projectBounds(input)
  return calculate(input, bounds, ...bounds)
}

export const analyticsEngine = {
  version,
  async calculate(input: WeeklyAnalyticsInput): Promise<WeeklyContributionResult> {
    return calculateWeek(input)
  },
}
