import type { LiveProject, Team } from '@teampulse/shared'
import { Link } from 'react-router'
import { paths } from '../routes'
import { Avatar, Meter, Panel } from './ui'

export function CollectedMembers({ projectId, team }: { projectId: string; team: LiveProject['teams'][number] }) {
  return <Panel title="Участники команды">
    {team.memberships.length ? <div className="table-scroll"><table className="w-full min-w-[400px]">
      <thead><tr><th scope="col">Участник</th><th scope="col">Роль</th><th scope="col">Доля вклада</th></tr></thead>
      <tbody>{team.memberships.map(member => <tr key={member.user.id}>
        <td><Link aria-label={member.user.name ?? member.user.githubLogin} className="flex items-center gap-2 text-ink" to={paths.member(projectId, team.id, member.user.id)}>
          <Avatar name={member.user.name ?? member.user.githubLogin} /><span><strong className="block">{member.user.name ?? member.user.githubLogin}</strong><small className="muted">@{member.user.githubLogin}</small></span></Link></td>
        <td>{member.role === 'observer' ? 'Наблюдатель' : 'Участник'}</td><td>{team.analytics?.status === 'ready' && member.role === 'participant'
          ? `${(team.analytics.members.find(item => item.userId === member.user.id)?.sharePercent ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%` : '—'}</td>
      </tr>)}</tbody>
    </table></div> : <p className="muted">В команде пока нет участников.</p>}
    <p className="mt-3 text-sm muted">{team.analytics?.status === 'ready' ? 'Доли за весь проект.' : 'Доли вклада появятся после расчёта аналитики.'} Наблюдатели в расчёте не участвуют.</p>
  </Panel>
}

export function Contributions({ projectId, team }: { projectId: string; team: Team }) {
  const members = [...team.members].sort((a, b) => b.share - a.share)
  return <Panel title="Вклад по видам работы">
    {members.length ? <div className="table-scroll">
      <table className="min-w-[620px]">
        <thead><tr><th scope="col">Участник</th><th scope="col">Общая доля</th><th scope="col">Код</th><th scope="col">Pull requests</th><th scope="col">Ревью</th><th scope="col">Задачи</th><th scope="col">Активных дней</th></tr></thead>
        <tbody>{members.map(member => <tr key={member.id}>
          <td><Link className="flex items-center gap-2 text-ink" to={paths.member(projectId, team.id, member.id)}><Avatar name={member.name} color={member.color} /><span><strong className="block whitespace-nowrap">{member.name}</strong><small className="muted">@{member.handle}</small></span></Link></td>
          <td><strong>{member.share}%</strong></td>
          <td><span>{member.work.code}%</span><Meter value={member.work.code} label={'Доля кода: ' + member.name} /></td>
          <td>{member.work.pullRequests}</td><td>{member.work.reviews}</td><td>{member.work.issues}</td><td>{member.activeDays}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p className="muted">В команде пока нет участников.</p>}
  </Panel>
}
