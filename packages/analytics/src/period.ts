import type { AnalyticsPeriod, ProjectAnalyticsInput } from '@teampulse/shared'

export const DAY = 86_400_000

export function utcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function dateStart(date: string): number {
  const value = Date.parse(date + 'T00:00:00.000Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value) || utcDate(value) !== date) {
    throw new RangeError('Expected a UTC calendar date')
  }
  return value
}

export function projectBounds(input: ProjectAnalyticsInput): [number, number] {
  const start = dateStart(input.settings.startsOn)
  const end = dateStart(input.settings.endsOn) + DAY
  if (start >= end) throw new RangeError('Project end precedes project start')
  return [start, end]
}

export function asPeriod(start: number, end: number): AnalyticsPeriod {
  return { startsAt: new Date(start).toISOString(), endsBefore: new Date(end).toISOString() }
}
