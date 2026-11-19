import type { ApiUser, CollectedEventResponse, LiveProjectSettings } from './api'
import type { WorkValues } from './index'

export type AnalyticsEvent = Pick<CollectedEventResponse, 'id' | 'kind' | 'occurredAt' | 'payload' | 'details'>
  & { actorId: string | null }

export interface ProjectAnalyticsInput {
  teamId: string
  projectId: string
  sourceVersion: number
  settings: LiveProjectSettings
  members: ApiUser[]
  events: AnalyticsEvent[]
  /** Exclusive observation cutoff for an in-progress report. Omit for a completed period. */
  asOf?: string
}

/** UTC weeks start on Monday. */
export interface WeeklyAnalyticsInput extends ProjectAnalyticsInput {
  weekStartsOn: string
  weekEndsBefore: string
  /** Include events from this UTC date for inactivity lookback. */
  historyStartsOn?: string
}

export interface AnalyticsPeriod { startsAt: string; endsBefore: string }

export interface AnalyticsFlag {
  kind: 'inactivity' | 'imbalance' | 'lateBurst' | 'excluded' | 'unknown' | 'teamInactivity'
  userId?: string
  severity: 'warning' | 'risk'
  explanation: string
  evidenceEventIds: string[]
}

export interface AnalyticsMember {
  userId: string
  work: WorkValues
  sharePercent: number
  activeDays: number
  /** Number of known excluded changed lines. */
  excludedChanges: number
}

export interface WeeklyAnalyticsResult {
  engineVersion: string
  teamId: string
  weekStartsOn: string
  sourceVersion: number
  members: AnalyticsMember[]
  flags: AnalyticsFlag[]
}

export interface ContributionMetrics extends AnalyticsMember {
  totalPoints: number
  categoryShares: WorkValues
  activeDaysPercent: number
  averageGapDays: number | null
  lastActiveOn: string | null
  measuredChanges: number
}

export interface ChangeAdjustment {
  eventIds: string[]
  userId: string | null
  reason: 'lockFile' | 'generated' | 'dependency' | 'buildArtifact' | 'binaryPath'
    | 'pureRename' | 'largeCommit' | 'microCommits'
  explanation: string
  path?: string
  /** Null when the collector provides paths only. */
  lines: number | null
}

export interface ContributionFlag extends AnalyticsFlag {
  teamId: string
  period: AnalyticsPeriod
  actual: number
  threshold: number
  unit: 'days' | 'percent' | 'events'
}

export interface ProjectContributionResult {
  engineVersion: string
  sourceVersion: number
  teamId: string
  projectId: string
  period: AnalyticsPeriod | null
  members: ContributionMetrics[]
  flags: ContributionFlag[]
  totalPoints: number
  gini: number
  eventCounts: Record<AnalyticsEvent['kind'], number>
  unknownAuthors: { count: number; eventIds: string[] }
  adjustments: ChangeAdjustment[]
  commitsWithIncompleteStats: string[]
}

export interface WeeklyContributionResult extends ProjectContributionResult, WeeklyAnalyticsResult {
  members: ContributionMetrics[]
  flags: ContributionFlag[]
}

export interface AnalyticsEngine {
  readonly version: string
  calculate(input: WeeklyAnalyticsInput): Promise<WeeklyAnalyticsResult>
}
