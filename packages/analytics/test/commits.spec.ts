import type { AnalyticsEvent } from '@teampulse/shared'
import { calculateWeek } from '../src'
import { activity, lines, week } from './fixtures'

const file = (filename: string, changes: number, status = 'modified') => ({
  filename, changes, status, additions: changes, deletions: 0,
})

test('explains file exclusions and caps only the remaining attributable lines', () => {
  const files = [
    file('src/main.ts', 600), file('apps/web/pnpm-lock.yaml', 200),
    file('build/widget.js', 100), file('src/types.generated.ts', 50),
    file('node_modules/lib/a.js', 20), file('assets/logo.png', 0),
    file('moved.ts', 0, 'renamed'), file('renamed.ts', 20, 'renamed'),
  ]
  const result = calculateWeek(week([activity('large', 'commit', 'a', undefined, { files })]))
  expect(result.members[0]).toMatchObject({ work: { code: 25 }, measuredChanges: 990, excludedChanges: 490 })
  expect(result.adjustments.map(({ reason, lines }) => [reason, lines])).toEqual([
    ['lockFile', 200], ['buildArtifact', 100], ['generated', 50], ['dependency', 20],
    ['binaryPath', 0], ['pureRename', 0], ['largeCommit', 120],
  ])
})

test('uses only observed file lines for incomplete data and marks path-only decisions', () => {
  const push: AnalyticsEvent = activity('push', 'commit', 'a', '2026-11-17T00:00:00Z')
  push.payload.files = { added: ['package-lock.json'], modified: ['script.ts'], removed: [] }
  const lock: AnalyticsEvent = activity('lock', 'commit', 'b')
  lock.payload.files = { added: [], modified: ['yarn.lock'], removed: [] }
  const partial = activity('partial', 'commit', 'a', undefined, {
    files: [file('src/script.ts', 20), file('yarn.lock', 20)],
    stats: { total: 900, additions: 900, deletions: 0 }, filesTruncated: true,
  })
  const result = calculateWeek(week([push, lock, partial]))
  expect(result.members[0]).toMatchObject({ work: { code: 1.25 }, measuredChanges: 900, excludedChanges: 20 })
  expect(result.members[1]).toMatchObject({ work: { code: 0 }, excludedChanges: 0, activeDays: 0 })
  expect(result.commitsWithIncompleteStats).toEqual(['lock', 'partial', 'push'])
  expect(result.adjustments.find(item => item.eventIds[0] === 'lock')).toMatchObject({ reason: 'lockFile', lines: null })
})

test('groups small commits across up to ten minutes, with an independent window for each author and UTC day', () => {
  const events = Array.from({ length: 20 }, (_, i) =>
    activity(`micro-${i}`, 'commit', 'a', new Date(Date.UTC(2026, 10, 16, 12, 0, i * 30)).toISOString(), lines(2)))
  events.push(activity('next', 'commit', 'a', '2026-11-16T12:10:00.001Z', lines(5)))
  events.push(activity('other-author', 'commit', 'b', '2026-11-16T12:04:00Z', lines(2)))
  events.push(activity('next-day', 'commit', 'a', '2026-11-17T00:00:00Z', lines(5)))
  const result = calculateWeek(week(events))
  expect(result.members[0]).toMatchObject({ work: { code: 1.5 }, measuredChanges: 50, excludedChanges: 20, activeDays: 2 })
  expect(result.members[1].work.code).toBe(0.1)
  expect(result.adjustments).toEqual([expect.objectContaining({ reason: 'microCommits', lines: 20,
    eventIds: events.slice(0, 20).map(event => event.id) })])
})

test('caps provisional credit for a series and uses measured lines when a series has both', () => {
  const events = ['p1', 'p2', 'p3'].map((id, i) => {
    const event = activity(id, 'commit', 'a', `2026-11-16T12:0${i}:00Z`)
    event.payload.files = { added: [], modified: ['script.ts'], removed: [] }
    return event
  })
  expect(calculateWeek(week(events)).members[0].work.code).toBe(0.25)
  const measured = activity('actual', 'commit', 'a', '2026-11-16T12:03:00Z', lines(4))
  const result = calculateWeek(week([...events, measured]))
  expect(result.members[0].work.code).toBe(0.2)
  expect(result.adjustments[0]).toMatchObject({ reason: 'microCommits', lines: null })
})
