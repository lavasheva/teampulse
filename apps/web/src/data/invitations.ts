import { demoUsers } from './fixtures'
import { getDemoUser, mutateDemoState, readDemoState } from './mock'

export async function loadInvitation(code: string) {
  const project = readDemoState().projects.find(item => item.inviteCode === code && item.status === 'active')
  if (!project) return null
  return {
    id: project.id, name: project.settings.name, owner: project.owner, organization: project.organization,
    teams: project.teams.map(team => ({ id: team.id, name: team.name, members: team.members.map(({ name, color }) => ({ name, color })) })),
  }
}

export async function acceptInvitation({ code, teamId }: { code: string; teamId: string }) {
  return mutateDemoState(state => {
    const user = getDemoUser(state)
    if (user?.role !== 'participant') throw new Error('Войдите как участник')
    const project = state.projects.find(item => item.inviteCode === code && item.status === 'active')
    const team = project?.teams.find(item => item.id === teamId)
    if (!project || !team) throw new Error('Эта команда больше недоступна')
    if (!team.members.some(member => member.id === user.id)) {
      team.members.push({
        id: user.id, name: demoUsers[1].name, handle: 'ilya-fed', color: '#2d8ca8', share: 0,
        work: { code: 0, pullRequests: 0, reviews: 0, issues: 0 }, activeDays: 0,
        lastActive: '', highlights: [], exclusions: [],
      })
    }
    state.assignments[project.id] = team.id
    return { projectId: project.id, teamId: team.id }
  })
}
