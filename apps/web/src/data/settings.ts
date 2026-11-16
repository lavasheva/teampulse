import type { ProjectSettings } from '@teampulse/shared'
import { getDemoUser, mutateDemoState } from './mock'
import { validateProjectDates } from './projects'

export async function saveProjectSettings({ projectId, settings }: { projectId: string; settings: ProjectSettings }) {
  const name = settings.name.trim()
  if (!name) throw new Error('Введите название проекта.')
  validateProjectDates(settings)
  const milestones = settings.milestones.map(point => ({ ...point, title: point.title.trim() }))
  if (milestones.some(point => !point.title || point.date < settings.startsOn || point.date > settings.endsOn)) {
    throw new Error('У каждой контрольной точки должны быть название и дата в пределах проекта.')
  }

  mutateDemoState(state => {
    const project = state.projects.find(item => item.id === projectId)
    if (getDemoUser(state)?.role !== 'manager' || !project) throw new Error('Настройки доступны преподавателю проекта.')
    project.settings = { ...settings, name, milestones }
  })
}
