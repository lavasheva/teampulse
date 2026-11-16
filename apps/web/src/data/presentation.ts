import type { Team } from '@teampulse/shared'

export const healthLabels = {
  risk: { label: 'Риск', tone: 'danger' },
  warning: { label: 'Внимание', tone: 'warning' },
  normal: { label: 'Норма', tone: 'success' },
} as const

const day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' })
const fullDay = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })
export const formatDay = (date: string) => date ? day.format(new Date(date)) : '—'
export const formatDate = (date: string) => date ? fullDay.format(new Date(date)) : '—'
export const formatNumber = new Intl.NumberFormat('ru-RU').format

export function teamHealth(team: Team) {
  const flags = team.flags.filter(flag => !flag.resolved)
  if (flags.some(flag => flag.severity === 'risk')) return 'risk'
  return flags.length ? 'warning' : 'normal'
}
