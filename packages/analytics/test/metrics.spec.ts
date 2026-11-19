import { analyticsEngine, calculateProject, calculateWeek } from '../src'
import { activity, lines, week } from './fixtures'

test('counts each PR action once, uses category weights, and includes zero contributors in Gini', async () => {
  const pr = 'https://github.com/team/repo/pull/12'
  const events = [
    activity('commit', 'commit', 'a', undefined, lines(40)),
    activity('open', 'pr_opened', 'a', undefined, null, pr),
    activity('duplicate-open', 'pr_opened', 'a', undefined, null, pr),
    activity('merged', 'pr_merged', 'a', '2026-11-18T13:00:00Z', null, pr),
    activity('review', 'review', 'b', undefined, { hasBody: true }),
    activity('issue', 'issue_opened', 'b'),
  ]
  const input = week(events)
  const result = await analyticsEngine.calculate(input)
  expect(result.members[0]).toMatchObject({
    userId: 'a', work: { code: 2, pullRequests: 3, reviews: 0, issues: 0 },
    totalPoints: 1.6, activeDays: 2, averageGapDays: 2,
    categoryShares: { code: 100, pullRequests: 100, reviews: 0, issues: 0 },
  })
  expect(result.members[0].sharePercent).toBeCloseTo(100 * 1.6 / 2.05)
  expect(result.members[1].totalPoints).toBe(0.45)
  expect(result.members[2].sharePercent).toBe(0)
  expect(result.gini).toBeCloseTo(1.6 / 2.05)
  expect(result).toEqual(calculateWeek(week([...events, events[0]].reverse(), ['c', 'a', 'b'])))
  expect(input.events).toEqual(events)
})

test('keeps unknown authors separate and recomputes after a claim', () => {
  const event = activity('unknown', 'commit', null, undefined, lines(20))
  const unresolved = calculateWeek(week([event], ['a']))
  expect(unresolved.totalPoints).toBe(0)
  expect(unresolved.unknownAuthors.eventIds).toEqual(['unknown'])
  const matched = calculateWeek(week([{ ...event, actorId: 'a' }], ['a']))
  expect(matched.totalPoints).toBe(0.5)
  expect(matched.members[0].sharePercent).toBe(100)
  expect(matched.unknownAuthors.eventIds).toEqual([])
  expect(matched.gini).toBe(0)
})

test('zero weights give zero overall scores while activity and category shares remain', () => {
  const input = week([activity('review', 'review')])
  input.settings.weights = { code: 0, pullRequests: 0, reviews: 0, issues: 100 }
  const result = calculateWeek(input)
  expect(result.members[0]).toMatchObject({ totalPoints: 0, sharePercent: 0, activeDays: 1, categoryShares: { reviews: 100 } })
  expect(result.gini).toBe(0)
  expect(calculateWeek(week()).totalPoints).toBe(0)
  expect(calculateWeek(week([], [])).members).toEqual([])
})

test('uses UTC week and inclusive project date boundaries, with an explicit observation cutoff', () => {
  const input = week([
    activity('outside-start', 'review', 'a', '2026-11-17T02:59:59+03:00'),
    activity('start', 'review', 'a', '2026-11-17T03:00:00+03:00'),
    activity('end', 'review', 'b', '2026-11-20T23:59:59.999Z'),
    activity('outside-end', 'review', 'b', '2026-11-21T00:00:00Z'),
  ])
  input.settings.startsOn = '2026-11-17'
  input.settings.endsOn = '2026-11-20'
  const result = calculateWeek(input)
  expect(result.period).toEqual({ startsAt: '2026-11-17T00:00:00.000Z', endsBefore: '2026-11-21T00:00:00.000Z' })
  expect(result.members.map(member => member.sharePercent)).toEqual([50, 50, 0])
  expect(result.members[0].activeDaysPercent).toBe(25)
  expect(calculateWeek({ ...input, asOf: '2026-11-20T23:59:59.999Z' }).eventCounts.review).toBe(1)
  expect(calculateWeek({ ...input, weekStartsOn: '2026-11-23', weekEndsBefore: '2026-11-30' }).period).toBeNull()
  expect(() => calculateWeek({ ...input, weekStartsOn: '2026-11-17' })).toThrow(RangeError)
})

test('uses accumulated points and includes only merge credit in the second week', () => {
  const pr = 'https://github.com/team/repo/pull/8'
  const input = week([
    activity('open', 'pr_opened', 'a', '2026-11-15T23:59:59.999Z', null, pr),
    activity('merged', 'pr_merged', 'a', '2026-11-16T00:00:00Z', null, pr),
    activity('code', 'commit', 'b', '2026-11-22T23:59:59.999Z', lines(96)),
    activity('next-week', 'commit', 'b', '2026-11-23T00:00:00Z', lines(24)),
    activity('after-project', 'commit', 'b', '2026-11-30T00:00:00Z', lines(100)),
  ])
  expect(calculateWeek(input).members[0].work.pullRequests).toBe(2)
  expect(calculateWeek(input).eventCounts.commit).toBe(1)
  expect(calculateProject(input).members[0].sharePercent).toBeCloseTo(100 / 6)
})
