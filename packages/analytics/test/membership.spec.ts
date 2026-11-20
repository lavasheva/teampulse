import { calculateWeek } from '../src'
import { activity, lines, week } from './fixtures'

test('does not flag a newcomer for inactivity before their membership date', () => {
  const input = week([activity('active', 'commit', 'a', '2026-11-22T12:00:00Z', lines(20))])
  input.memberJoinedOn = { b: '2026-11-20' }
  const result = calculateWeek(input)
  expect(result.flags.some(flag => flag.kind === 'inactivity' && flag.userId === 'b')).toBe(false)
  expect(result.flags.some(flag => flag.kind === 'inactivity' && flag.userId === 'c')).toBe(true)
})
test('keeps work done before joining and bounds observed regularity', () => {
  const input = week([activity('prior', 'commit', 'a', '2026-11-16T12:00:00Z', lines(20)), activity('later', 'commit', 'a', '2026-11-22T12:00:00Z', lines(20))])
  input.memberJoinedOn = { a: '2026-11-20' }
  const member = calculateWeek(input).members.find(item => item.userId === 'a')!
  expect(member.work.code).toBe(2); expect(member.activeDays).toBe(2)
  expect(member.activeDaysPercent).toBeLessThanOrEqual(100)
})
