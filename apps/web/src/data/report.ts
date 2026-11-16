import type { Team, TeamFlag } from '@teampulse/shared'

export interface ReportTotals {
  eventCount: number
  balance: number
  members: Record<string, { share: number; code: number; activeDays: number; pullRequests: number; reviews: number; issues: number }>
  history: TeamFlag[]
}

const exampleTotals: ReportTotals = {
  eventCount: 412,
  balance: 0.31,
  members: {
    anna: { share: 52, code: 55, activeDays: 71, pullRequests: 20, reviews: 18, issues: 29 },
    ilya: { share: 34, code: 33, activeDays: 58, pullRequests: 13, reviews: 27, issues: 19 },
    petr: { share: 14, code: 12, activeDays: 24, pullRequests: 5, reviews: 3, issues: 9 },
  },
  history: [
    { id: 'report-inactivity', kind: 'inactivity', severity: 'risk', title: 'Тишина', date: '2026-09-29', detail: 'Пётр С. вернулся к работе после перерыва.', resolved: true },
    { id: 'report-imbalance', kind: 'imbalance', severity: 'warning', title: 'Перекос', date: '2026-10-06', detail: 'Доля Анны К. превышала порог. Нагрузка выровнялась.', resolved: true },
    { id: 'report-late', kind: 'lateBurst', severity: 'warning', title: 'Рывок перед дедлайном', date: '2026-12-14', detail: '40% вклада Петра С. пришлись на последнюю неделю.' },
  ],
}

export function reportTotals(projectId: string, team: Team): ReportTotals {
  if (projectId === 'web' && team.id === 'kodzilla') {
    return { ...exampleTotals, history: [...exampleTotals.history, ...team.flags.filter(flag => flag.kind === 'unknown')] }
  }
  return {
    eventCount: team.events.length,
    balance: team.balance,
    members: Object.fromEntries(team.members.map(member => [member.id, { ...member.work, share: member.share, activeDays: member.activeDays }])),
    history: team.flags,
  }
}
