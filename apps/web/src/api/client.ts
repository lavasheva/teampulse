import type { AuthSessionResponse, CollectedEventsResponse, CreateOrganizationInput, CreateProjectInput,
  CreatedInvitationResponse, CreatedProjectResponse, InvitationResponse, LiveProjectSettings, LiveWorkspaceResponse,
  MemberActivityResponse, OrganizationResponse, ProjectAccessResponse, RepositorySyncResponse, UnmatchedIdentitiesResponse } from '@teampulse/shared'
import type { EventFilters, ProjectAuditResponse } from '@teampulse/shared'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
let csrf: string | undefined
async function request<Result>(path: string, method = 'GET', input?: unknown): Promise<Result> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (method !== 'GET') {
    if (!csrf) await api.session()
    if (!csrf) throw new ApiError(401, 'Войдите через GitHub.')
    headers['X-CSRF-Token'] = csrf
  }
  if (input !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch('/api' + path, { method, credentials: 'include', headers,
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}) })
  if (!response.ok) {
    if (response.status === 401) csrf = undefined
    const data = await response.json().catch(() => null) as { message?: string | string[] } | null
    const message = Array.isArray(data?.message) ? data.message.join('. ') : data?.message
    throw new ApiError(response.status, message || `Не удалось выполнить запрос (${response.status}).`)
  }
  return response.status === 204 ? undefined as Result : response.json() as Promise<Result>
}
const id = encodeURIComponent
export const api = {
  async session(): Promise<AuthSessionResponse | null> {
    try { const result = await request<AuthSessionResponse>('/auth/me'); csrf = result.csrfToken; return result }
    catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error }
  },
  async logout() { await request<void>('/auth/logout', 'POST'); csrf = undefined },
  workspace: () => request<LiveWorkspaceResponse>('/workspace'),
  createOrganization: (input: CreateOrganizationInput) => request<OrganizationResponse>('/organizations', 'POST', input),
  createProject: (organizationId: string, input: CreateProjectInput) => request<CreatedProjectResponse>(`/organizations/${id(organizationId)}/projects`, 'POST', input),
  createTeam: (projectId: string, name: string) => request(`/projects/${id(projectId)}/teams`, 'POST', { name }),
  saveSettings: (projectId: string, input: LiveProjectSettings) => request<LiveProjectSettings>(`/projects/${id(projectId)}/settings`, 'PUT', input),
  invite: (projectId: string) => request<CreatedInvitationResponse>(`/projects/${id(projectId)}/invitations`, 'POST'),
  inviteObserver: (projectId: string) => request<CreatedInvitationResponse>(`/projects/${id(projectId)}/invitations`, 'POST', { role: 'observer' }),
  access: (projectId: string) => request<ProjectAccessResponse>(`/projects/${id(projectId)}/access`),
  revokeInvitation: (projectId: string, invitationId: string) => request<void>(`/projects/${id(projectId)}/invitations/${id(invitationId)}`, 'DELETE'),
  addManager: (projectId: string, githubLogin: string) => request(`/projects/${id(projectId)}/managers`, 'POST', { githubLogin }),
  removeManager: (projectId: string, userId: string) => request<void>(`/projects/${id(projectId)}/managers/${id(userId)}`, 'DELETE'),
  memberRole: (projectId: string, teamId: string, userId: string, role: 'participant' | 'observer') =>
    request<void>(`/projects/${id(projectId)}/teams/${id(teamId)}/members/${id(userId)}`, 'PUT', { role }),
  removeMember: (projectId: string, teamId: string, userId: string) =>
    request<void>(`/projects/${id(projectId)}/teams/${id(teamId)}/members/${id(userId)}`, 'DELETE'),
  invitation: (token: string) => request<InvitationResponse>(`/invitations/${id(token)}`),
  accept: (token: string, teamId: string) => request<{ projectId: string; teamId: string }>(`/invitations/${id(token)}/accept`, 'POST', { teamId }),
  app: () => request<{ installationUrl: string | null }>('/github/app'),
  connect: (teamId: string, input: { fullName: string }) => request(`/teams/${id(teamId)}/repository`, 'POST', input),
  disconnect: (teamId: string) => request<void>(`/teams/${id(teamId)}/repository`, 'DELETE'),
  syncStatus: (teamId: string) => request<RepositorySyncResponse>(`/teams/${id(teamId)}/repository/sync`),
  sync: (teamId: string) => request(`/teams/${id(teamId)}/repository/sync`, 'POST'),
  events: (teamId: string, cursor?: string, filters: EventFilters = {}) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries({ ...filters, cursor })) if (value) params.set(key, value)
    return request<CollectedEventsResponse>(`/teams/${id(teamId)}/activity?${params}`)
  },
  audit: (projectId: string, cursor?: string) => request<ProjectAuditResponse>(`/projects/${id(projectId)}/audit${cursor ? '?cursor=' + id(cursor) : ''}`),
  unmatched: (teamId: string, cursor?: string) => request<UnmatchedIdentitiesResponse>(`/teams/${id(teamId)}/identities/unmatched${cursor ? '?cursor=' + id(cursor) : ''}`),
  claim: (teamId: string, identityId: string) => request(`/teams/${id(teamId)}/identities/${id(identityId)}/claim`, 'POST'),
  member: (teamId: string, memberId: string) => request<MemberActivityResponse>(`/teams/${id(teamId)}/members/${id(memberId)}`),
}
