import { calculateWeek } from '../src'
import { activity, lines, week } from './fixtures'

test('flags seven full days of team silence but leaves a partial week unflagged', () => {
  expect(calculateWeek(week()).flags).toEqual([expect.objectContaining({
    kind: 'teamInactivity', actual: 7, threshold: 7, unit: 'days', evidenceEventIds: [],
  })])
  expect(calculateWeek({ ...week(), asOf: '2026-11-22T23:59:59Z' }).flags).toEqual([])
  const unknown = activity('unmatched', 'review', 'outsider', '2026-11-22T20:00:00Z')
  expect(calculateWeek(week([unknown])).flags).toEqual([expect.objectContaining({
    kind: 'unknown', actual: 1, threshold: 0, evidenceEventIds: ['unmatched'],
  })])
})

test('uses optional history for inactivity without adding old contribution to current results', () => {
  const input = {
    ...week([
      activity('old', 'review', 'a', '2026-11-09T10:00:00Z'),
      activity('ongoing', 'review', 'b', '2026-11-20T10:00:00Z'),
    ], ['a', 'b']),
    historyStartsOn: '2026-11-09',
  }
  input.settings.thresholds.inactivity = 13
  const result = calculateWeek(input)
  expect(result.members[0].activeDays).toBe(0)
  expect(result.flags.find(flag => flag.kind === 'inactivity')).toMatchObject({
    userId: 'a', actual: 13, threshold: 13, evidenceEventIds: ['old', 'ongoing'],
    period: { startsAt: '2026-11-10T00:00:00.000Z', endsBefore: '2026-11-23T00:00:00.000Z' },
  })
  expect(calculateWeek({ ...input, historyStartsOn: undefined }).flags.some(flag => flag.kind === 'inactivity')).toBe(false)
})

test('requires three members and strictly more than 60% weighted credit for imbalance', () => {
  const result = (a: number, ids?: string[]) => calculateWeek(week([
    activity('a-code', 'commit', 'a', undefined, lines(a)),
    activity('b-code', 'commit', 'b', undefined, lines(40)),
  ], ids)).flags.find(flag => flag.kind === 'imbalance')
  expect(result(60)).toBeUndefined()
  expect(result(61, ['a', 'b'])).toBeUndefined()
  expect(result(61)).toMatchObject({ userId: 'a', actual: 6100 / 101, threshold: 60, evidenceEventIds: ['a-code'] })
})

test('measures late contribution through the checkpoint, requires a baseline, and excludes events after it', () => {
  const judge = (late: number) => {
    const input = week([
      activity('early', 'commit', 'a', '2026-11-16T00:00:00Z', lines(20)),
      activity('late', 'commit', 'a', '2026-11-18T00:00:00Z', lines(late)),
      activity('after', 'commit', 'a', '2026-11-21T00:00:00Z', lines(100)),
    ], ['a'])
    input.settings.milestones = [{ id: 'checkpoint', title: 'MVP', date: '2026-11-20' }]
    return input
  }
  expect(calculateWeek(judge(20)).flags).toEqual([])
  const input = judge(21)
  const result = calculateWeek(input).flags
  expect(result).toEqual([expect.objectContaining({
    kind: 'lateBurst', userId: 'a', actual: 2100 / 41, threshold: 50, evidenceEventIds: ['late'],
    period: { startsAt: '2026-11-16T00:00:00.000Z', endsBefore: '2026-11-21T00:00:00.000Z' },
  })])
  expect(calculateWeek({ ...input, asOf: '2026-11-20T12:00:00Z' }).flags).toEqual([])
})

test('requires strictly more than half of measured changes to be excluded', () => {
  const result = (excluded: number) => calculateWeek(week([
    activity('mixed', 'commit', 'a', undefined, {
      files: [...lines(20).files!, { filename: 'yarn.lock', status: 'modified', changes: excluded, additions: excluded, deletions: 0 }],
    }),
  ], ['a'])).flags.find(flag => flag.kind === 'excluded')
  expect(result(20)).toBeUndefined()
  expect(result(21)).toMatchObject({ userId: 'a', actual: 2100 / 41, threshold: 50, evidenceEventIds: ['mixed'] })
})
