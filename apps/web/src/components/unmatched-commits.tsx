import type { ReactNode } from 'react'
import type { Team, TeamEvent } from '@teampulse/shared'
import { formatDay } from '../data/presentation'
import { Badge, Panel } from './ui'

export function UnmatchedCommits({ events, action }: { events: Team['events']; action?: (event: TeamEvent) => ReactNode }) {
  const unresolved = events.filter(event => event.kind === 'commit' && event.actorId === null)
  return <Panel title="Неопознанные коммиты" aside={unresolved.length > 0 && <Badge tone="warning">{unresolved.length}</Badge>}>
    {unresolved.length ? <ul className="divide-y divide-line">{unresolved.map(event => (
      <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
        <div><p className="font-medium">{event.title}</p><time className="text-xs muted" dateTime={event.date}>{formatDay(event.date)}</time></div>
        {action?.(event)}
      </li>
    ))}</ul> : <p className="muted">Все коммиты привязаны к авторам.</p>}
  </Panel>
}
