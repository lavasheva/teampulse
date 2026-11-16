import type { Project, ProjectSettings } from '@teampulse/shared'
import { projectDefaults } from './fixtures'
import { getDemoUser, mutateDemoState } from './mock'

export function validateProjectDates({ startsOn, endsOn }: Pick<ProjectSettings, 'startsOn' | 'endsOn'>) {
  if (!startsOn || !endsOn || startsOn > endsOn) throw new Error('Дата защиты должна быть не раньше начала проекта.')
}

export async function createProject(input: { name: string; startsOn: string; endsOn: string; teamName: string }) {
  const name = input.name.trim()
  const teamName = input.teamName.trim()
  if (!name || !teamName) throw new Error('Укажите название проекта и команды.')
  validateProjectDates(input)
  return mutateDemoState(state => {
    const user = getDemoUser(state)
    if (user?.role !== 'manager') throw new Error('Создавать проекты может преподаватель.')
    const project: Project = {
      id: crypto.randomUUID(),
      inviteCode: crypto.randomUUID(),
      organization: 'Кафедра программной инженерии',
      owner: user.name,
      status: 'active',
      settings: projectDefaults(name, input.startsOn, input.endsOn),
      teams: [{ id: 'team-1', name: teamName, repository: '', balance: 0, members: [], weeks: [], events: [], flags: [] }],
      summaries: [],
      sendTeamSummaries: true,
    }
    state.projects.unshift(project)
    return project
  })
}
