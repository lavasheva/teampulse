import type { AnalyticsEvent, WeeklyAnalyticsInput } from '@teampulse/shared'

export function activity(
  id: string,
  kind: AnalyticsEvent['kind'] = 'commit',
  actorId: string | null = 'a',
  occurredAt = '2026-11-16T12:00:00Z',
  details: AnalyticsEvent['details'] = null,
  url = `https://github.com/team/repo/events/${id}`,
): AnalyticsEvent {
  return { id, kind, actorId, occurredAt, details, payload: { title: id, url } }
}

export function lines(total: number): NonNullable<AnalyticsEvent['details']> {
  return { files: [{ filename: 'src/index.ts', status: 'modified', additions: total, deletions: 0, changes: total }],
    stats: { total, additions: total, deletions: 0 } }
}

export function week(events: AnalyticsEvent[] = [], ids = ['a', 'b', 'c']): WeeklyAnalyticsInput {
  return {
    teamId: 'team', projectId: 'project', weekStartsOn: '2026-11-16', weekEndsBefore: '2026-11-23',
    sourceVersion: 1, events,
    members: ids.map(id => ({ id, name: id, githubLogin: id, avatarUrl: null })),
    settings: {
      name: 'Проект', startsOn: '2026-11-09', endsOn: '2026-11-29', milestones: [],
      weights: { code: 50, pullRequests: 20, reviews: 20, issues: 10 },
      thresholds: { inactivity: 7, imbalance: 60, lateBurst: 50, excluded: 50 },
    },
  }
}
