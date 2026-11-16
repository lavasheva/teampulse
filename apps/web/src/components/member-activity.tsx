import type { Member, TeamEvent } from '@teampulse/shared'
import { formatDate } from '../data/presentation'
import { Panel } from './ui'

const daysOfWeek = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const dayMs = 86_400_000

export function MemberActivity({ member, events }: { member: Member; events: TeamEvent[] }) {
  const activity = events.filter(event => event.actorId === member.id)
  const latest = member.lastActive ? Date.parse(member.lastActive) : NaN
  const totals = new Map<string, number>()
  for (const event of activity) {
    const day = event.date.slice(0, 10)
    totals.set(day, (totals.get(day) ?? 0) + 1)
  }

  const end = Math.max(latest || 0, ...[...totals.keys()].map(day => Date.parse(day)))
  const lastDay = new Date(end)
  const untilSunday = (7 - lastDay.getUTCDay()) % 7
  const firstDay = end + (untilSunday - 41) * dayMs
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstDay + index * dayMs).toISOString().slice(0, 10)
    return { date, count: totals.get(date) ?? 0 }
  })

  return <Panel title="Активность по дням" aside={<span className="text-xs muted">События из ленты</span>}>
    {end ? <div className="member-heatmap">
      <div className="heatmap-labels" aria-hidden="true">{daysOfWeek.map(day => <span key={day}>{day}</span>)}</div>
      <ul className="heatmap-days" aria-label="События за шесть недель">
        {days.map(({ date, count }) => <li key={date} title={formatDate(date) + ' · Событий: ' + count} data-count={Math.min(count, 3)}>
          <span className="sr-only">{formatDate(date)}. Событий: {count}</span>
        </li>)}
      </ul>
    </div> : <p className="muted">Пока нет активности.</p>}
  </Panel>
}
