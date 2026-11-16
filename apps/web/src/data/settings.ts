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

  const weights = Object.values(settings.weights)
  if (weights.some(value => !Number.isInteger(value) || value < 0) || weights.reduce((sum, value) => sum + value, 0) !== 100) {
    throw new Error('Сумма весов видов работы должна быть 100%.')
  }
  const { inactivity, imbalance, lateBurst, excluded } = settings.thresholds
  if (!Number.isInteger(inactivity) || inactivity < 1 || inactivity > 365 ||
    [imbalance, lateBurst, excluded].some(value => !Number.isInteger(value) || value < 1 || value > 100)) {
    throw new Error('Проверьте пороги флагов.')
  }

  mutateDemoState(state => {
    const project = state.projects.find(item => item.id === projectId)
    if (getDemoUser(state)?.role !== 'manager' || !project) throw new Error('Настройки доступны преподавателю проекта.')
    project.settings = { ...settings, name, milestones }
  })
}
