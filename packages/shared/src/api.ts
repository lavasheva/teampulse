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
