export const paths = {
  login: '/login',
  projects: '/projects',
  exampleInvite: '/invite/web-2026',
  invite: (code: string) => '/invite/' + encodeURIComponent(code),
  project: (id: string) => '/projects/' + encodeURIComponent(id),
  participants: (id: string) => paths.project(id) + '/participants',
  summaries: (id: string) => paths.project(id) + '/summaries',
  settings: (id: string) => paths.project(id) + '/settings',
  team: (projectId: string, teamId: string) => paths.project(projectId) + '/teams/' + encodeURIComponent(teamId),
  member: (projectId: string, teamId: string, memberId: string) => paths.team(projectId, teamId) + '/members/' + encodeURIComponent(memberId),
  report: (projectId: string, teamId: string) => paths.team(projectId, teamId) + '/report',
}
