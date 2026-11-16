import type { Project } from '@teampulse/shared'
import { getDemoUser, mutateDemoState } from './mock'

function updateAsManager(projectId: string, update: (project: Project) => void) {
  mutateDemoState(state => {
    const project = state.projects.find(item => item.id === projectId)
    if (getDemoUser(state)?.role !== 'manager' || !project) throw new Error('Сводки может настраивать преподаватель проекта.')
    update(project)
  })
}

export async function refreshSummary(projectId: string) {
  updateAsManager(projectId, project => {
    const summary = project.summaries[0]
    if (!summary) throw new Error('Для обновления нужна первая недельная сводка.')
    const teamsWithFlags = project.teams.filter(team => team.flags.some(flag => !flag.resolved))
    summary.teamTexts = Object.fromEntries(project.teams.map(team => {
      const flags = team.flags.filter(flag => !flag.resolved)
      return [team.id, flags.length ? flags.map(flag => flag.title + '. ' + flag.detail).join(' ') : 'Активных флагов на текущей неделе нет.']
    }))
    summary.text = teamsWithFlags.length
      ? 'На этой неделе требуют внимания: ' + teamsWithFlags.map(team => '«' + team.name + '»').join(', ') + '.'
      : 'На этой неделе нет команд с активными флагами.'
    summary.refreshedAt = new Date().toISOString()
  })
}

export async function updateSummaryMailing({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  updateAsManager(projectId, project => { project.sendTeamSummaries = enabled })
}
