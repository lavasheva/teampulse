import type { Team, TeamEvent, TeamFlag } from '@teampulse/shared'
import { Link } from 'react-router'
import { formatDay } from '../data/presentation'
import { paths } from '../routes'
import { Avatar, Badge, Panel } from './ui'

const eventLabels: Record<TeamEvent['kind'], string> = {
  commit: 'Коммит', pullRequest: 'Pull request', review: 'Ревью', issue: 'Задача',
}

export function ActivityFeed({ projectId, team, limit }: { projectId: string; team: Team; limit?: number }) {
  const events = [...team.events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
  return <Panel title={limit ? 'Последние события' : 'Лента событий'} aside={limit && team.events.length > 0 ? <Link className="text-xs" to={paths.team(projectId, team.id) + '?tab=events'}>Вся лента →</Link> : undefined}>
    {events.length ? <ul className="divide-y divide-line">
      {events.map(event => {
        const member = team.members.find(item => item.id === event.actorId)
        return <li key={event.id} className="grid grid-cols-[70px_minmax(0,1fr)] items-center gap-3 py-2.5">
          <time dateTime={event.date} className="text-xs muted">{formatDay(event.date)}</time>
          <div className="flex items-center gap-2.5">
            <Avatar name={member?.name ?? '?'} color={member?.color ?? '#7a8190'} />
            <div className="min-w-0">
              <p><strong className="font-medium">{member?.name ?? 'Неопознанный автор'}</strong> · {event.title}</p>
              <span className="text-xs muted">{eventLabels[event.kind]}</span>
            </div>
          </div>
        </li>
      })}
    </ul> : <p className="muted">Событий пока нет.</p>}
  </Panel>
}

export function FlagList({ flags }: { flags: TeamFlag[] }) {
  const active = flags.filter(flag => !flag.resolved)
  return <Panel title="Флаги" aside={active.length ? <Badge tone="danger">Активных: {active.length}</Badge> : undefined}>
    {flags.length ? <ul className="space-y-2">{flags.map(flag => (
      <li key={flag.id} className={'rounded-lg p-3 text-xs leading-relaxed ' + (flag.resolved ? 'badge-success' : flag.severity === 'risk' ? 'badge-danger' : 'badge-warning')}>
        <strong>{flag.resolved ? 'Снят · ' : ''}{flag.title}.</strong> {flag.detail}
      </li>
    ))}</ul> : <p className="muted">Флагов нет.</p>}
  </Panel>
}
