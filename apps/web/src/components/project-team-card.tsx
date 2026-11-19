import type { LiveProject, Team } from '@teampulse/shared'
import { Link } from 'react-router'
import { formatDay, formatNumber, healthLabels, teamHealth } from '../data/presentation'
import { paths } from '../routes'
import { Badge, Card } from './ui'

export function CollectedTeamCard({ projectId, team }: { projectId: string; team: LiveProject['teams'][number] }) {
  return <Link aria-label={team.name} className="block text-ink no-underline hover:no-underline" to={paths.team(projectId, team.id)}>
    <Card className="team-card h-full">
      <div className="flex flex-wrap justify-between gap-2"><h2>{team.name}</h2><Badge>Ожидает расчёта</Badge></div>
      <p className="mb-3 break-words text-xs muted">{team.repository?.fullName ?? 'Репозиторий не подключён'}</p>
      <p className="text-sm">Участников: {team.memberships.filter(member => member.role === 'participant').length}</p>
      <p className="text-sm muted">Наблюдателей: {team.memberships.filter(member => member.role === 'observer').length}</p>
      <div className="mt-3 border-t border-line pt-2 text-xs muted">Собрано событий: {team.repository?._count.events ?? 0}</div>
    </Card>
  </Link>
}

export function ProjectTeamCard({ projectId, team }: { projectId: string; team: Team }) {
  const health = healthLabels[teamHealth(team)]
  const flags = team.flags.filter(flag => !flag.resolved)
  const lastEvent = [...team.events].sort((a, b) => b.date.localeCompare(a.date))[0]

  return <Link className="block text-ink no-underline hover:no-underline" to={paths.team(projectId, team.id)}>
    <Card className={'team-card h-full ' + (health.tone === 'danger' ? 'border-[#e9b9b6]' : '')}>
      <div className="flex justify-between gap-2"><h2>{team.name}</h2><Badge tone={health.tone}>{health.label}</Badge></div>
      <p className="mb-3 text-xs muted">{team.repository || 'Новая команда'}</p>
      {team.members.length > 0 && <div className="space-y-2">
        <div className="flex h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
          {team.members.map(member => <span key={member.id} style={{ width: member.share + '%', background: member.color }} />)}
        </div>
        <ul className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] muted">
          {team.members.map(member => <li className="inline-flex items-center gap-1" key={member.id}><span className="size-2 rounded-full" style={{ background: member.color }} />{member.name.split(' ')[0]} · {member.share}%</li>)}
        </ul>
      </div>}
      <div className="my-3 grid gap-1">
        {flags.length ? flags.slice(0, 2).map(flag => <p key={flag.id} className={'rounded-md px-2 py-1 text-xs ' + (flag.severity === 'risk' ? 'badge-danger' : 'badge-warning')}>{flag.title}: {flag.detail}</p>)
          : <p className="text-xs text-[#20633b]">Флагов нет</p>}
      </div>
      <div className="mt-auto flex flex-wrap justify-between gap-2 border-t border-line pt-2 text-xs muted"><span>Равномерность {formatNumber(team.balance)}</span><span>{lastEvent ? 'Активность ' + formatDay(lastEvent.date) : 'Событий пока нет'}</span></div>
    </Card>
  </Link>
}
