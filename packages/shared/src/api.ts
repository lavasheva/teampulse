// Stage 2 HTTP DTOs. Dates are ISO strings; demo presentation models stay separate.
export interface ApiUser {
  id: string
  githubLogin: string
  name: string | null
  avatarUrl: string | null
}

export interface AuthSessionResponse { user: ApiUser; csrfToken: string }
export interface CreateOrganizationInput { name: string; kind: 'university' | 'school' | 'company' }
export interface OrganizationResponse extends CreateOrganizationInput { id: string }
export interface OrganizationListItem extends OrganizationResponse { memberships: { role: 'owner' | 'manager' }[] }
export interface CreateProjectInput { name: string; startsOn: string; endsOn: string; teamName: string }
export interface TeamListItem { id: string; name: string }
export interface CreatedProjectResponse {
  id: string; name: string; startsOn: string; endsOn: string; teams: TeamListItem[]
}
export interface ProjectListItem extends CreatedProjectResponse { organizationId: string }
export interface TeamResponse extends TeamListItem {
  projectId: string
  memberships: { role: 'participant' | 'observer'; user: ApiUser }[]
  repository: { fullName: string; syncStatus: 'pending' | 'running' | 'complete' | 'failed' | 'disconnected' } | null
}
export interface CreatedInvitationResponse { id: string; token: string; expiresAt: string }
export interface InvitationResponse {
  expiresAt: string
  project: { id: string; name: string; organization: { name: string }
    teams: (TeamListItem & { _count: { memberships: number } })[] }
}
export interface AcceptedInvitationResponse { projectId: string; teamId: string }

export type RepositorySyncStatus = 'pending' | 'running' | 'complete' | 'failed' | 'disconnected'
export interface RepositorySyncResponse {
  syncStatus: RepositorySyncStatus
  syncProcessed: number
  syncRetryAt: string | null
  syncError: string | null
  syncedAt: string | null
  nextReconcileAt: string | null
  stage: 'repository' | 'branches' | 'commits' | 'commitBatch' | 'commit' | 'pulls' | 'reviews' | 'issues' | null
  _count: { events: number }
}
export interface UnmatchedIdentity {
  id: string; email: string | null; login: string | null; githubId: string | null
  canClaim: boolean; _count: { events: number }
}
export interface UnmatchedIdentitiesResponse { identities: UnmatchedIdentity[]; nextCursor: string | null }
export interface IdentityClaimResponse { id: string; userId: string }
export interface CollectedEventResponse {
  id: string
  kind: 'commit' | 'pr_opened' | 'pr_merged' | 'pr_closed' | 'review' | 'issue_opened' | 'issue_closed'
  occurredAt: string
  payload: { title: string; url: string; files?: { added: string[]; modified: string[]; removed: string[] } }
  details: {
    stats?: { additions: number; deletions: number; total: number }
    files?: { filename: string; status: string; additions: number; deletions: number; changes: number; previousFilename?: string }[]
    filesTruncated?: boolean; reviewState?: string; hasBody?: boolean; pullNumber?: number; assigneeGithubIds?: string[]
  } | null
  author: { id: string; userId: string | null; login: string | null; resolution: string } | null
}
export interface CollectedEventsResponse { events: CollectedEventResponse[]; nextCursor: string | null }
