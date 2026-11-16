export type Role = 'manager' | 'participant'

export interface DemoUser {
  id: string
  name: string
  role: Role
}

export type WorkKind = 'code' | 'pullRequests' | 'reviews' | 'issues'
export type WorkValues = Record<WorkKind, number>
export type Health = 'risk' | 'warning' | 'normal'
export type Severity = Exclude<Health, 'normal'>

export interface ProjectSettings {
  name: string
  startsOn: string
  endsOn: string
  milestones: { id: string; title: string; date: string }[]
  weights: WorkValues
  thresholds: { inactivity: number; imbalance: number; lateBurst: number; excluded: number }
}

export interface Member {
  id: string
  name: string
  handle: string
  color: string
  share: number
  work: WorkValues
  activeDays: number
  lastActive: string
  highlights: string[]
  exclusions: { title: string; lines: number }[]
}

export interface TeamEvent {
  id: string
  actorId: string | null
  kind: 'commit' | 'pullRequest' | 'review' | 'issue'
  title: string
  date: string
}

export interface TeamFlag {
  id: string
  kind: 'inactivity' | 'imbalance' | 'lateBurst' | 'excluded' | 'unknown'
  title: string
  detail: string
  severity: Severity
  memberId?: string
  date: string
  resolved?: boolean
}

export interface Team {
  id: string
  name: string
  repository: string
  repositoryUrl?: string
  balance: number
  members: Member[]
  weeks: { label: string; values: Record<string, number> }[]
  events: TeamEvent[]
  flags: TeamFlag[]
}

export interface WeeklySummary {
  id: string
  label: string
  text: string
  teamTexts: Record<string, string>
  eventCount: number
  activeMembers: number
  merged: number
  refreshedAt?: string
}

export interface Project {
  id: string
  inviteCode: string
  organization: string
  owner: string
  status: 'active' | 'complete'
  settings: ProjectSettings
  teams: Team[]
  summaries: WeeklySummary[]
  sendTeamSummaries: boolean
}
