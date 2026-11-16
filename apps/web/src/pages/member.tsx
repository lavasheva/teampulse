import { Link, useParams } from 'react-router'
import { MemberActivity } from '../components/member-activity'
import { FlagList } from '../components/team-activity'
import { Avatar, Badge, Card, EmptyState, Meter, PageHeader, Panel } from '../components/ui'
import { workLabels } from '../data/fixtures'
import { formatDay, formatNumber } from '../data/presentation'
import { useTeam } from '../data/workspace'
import { paths } from '../routes'

export function Member() {
  const { project, team } = useTeam()
  const { memberId } = useParams()
  const member = team?.members.find(item => item.id === memberId)
  if (!project || !team || !member) return <EmptyState title="Участник недоступен"><Link to={paths.projects}>Мои проекты</Link></EmptyState>
  const flags = team.flags.filter(flag => flag.memberId === member.id)
  const flagged = flags.find(flag => !flag.resolved)
  const excluded = member.exclusions.reduce((total, item) => total + item.lines, 0)
  const stats = [
    { label: 'Общая доля', value: member.share + '%' },
    { label: 'Активных дней', value: member.activeDays },
    { label: 'Последнее действие', value: formatDay(member.lastActive) },
    { label: 'Исключено из вклада', value: formatNumber(excluded) + ' строк' },
  ]

  return <>
    <PageHeader title={<span className="flex flex-wrap items-center gap-3"><Avatar name={member.name} color={member.color} />{member.name}{flagged && <Badge tone="danger">{flagged.title}</Badge>}</span>}
      eyebrow={<Link to={paths.team(project.id, team.id) + '?tab=members'}>← {team.name} / Участники</Link>}
      description={'@' + member.handle + ' · Команда «' + team.name + '»'} />
    <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {stats.map(stat => <Card className="p-4" key={stat.label}><p className="text-xs muted">{stat.label}</p><strong className="mt-1 block text-2xl">{stat.value}</strong></Card>)}
    </div>
    <div className="detail-grid">
      <div className="space-y-4">
        <Panel title="Вклад по видам работы">
          <dl className="grid gap-3">{Object.entries(member.work).map(([kind, value]) => {
            const key = kind as keyof typeof workLabels
            const total = team.members.reduce((sum, item) => sum + item.work[key], 0)
            const share = total ? Math.round(value * 100 / total) : 0
            return <div key={key} className="grid grid-cols-[minmax(90px,1fr)_2fr_90px] items-center gap-3">
              <dt>{workLabels[key]}</dt><dd><Meter value={share} color={member.color} label={workLabels[key]} /></dd><dd className="text-right">{key === 'code' ? value + '%' : value + ' из ' + total}</dd>
            </div>
          })}</dl>
        </Panel>
        <MemberActivity member={member} events={team.events} />
        <Panel title="Работы участника">{member.highlights.length ? <ul className="list-disc space-y-2 pl-5">{member.highlights.map(item => <li key={item}>{item}</li>)}</ul> : <p className="muted">Работ пока нет.</p>}</Panel>
      </div>
      <aside className="space-y-4">
        <FlagList flags={flags} />
        <Panel title="Исключённые изменения">
          {member.exclusions.length ? <ul className="space-y-2">{member.exclusions.map(item => <li className="flex justify-between gap-3" key={item.title}><span>{item.title}</span><strong className="shrink-0">{formatNumber(item.lines)} строк</strong></li>)}</ul>
            : <p className="muted">Исключённых изменений нет.</p>}
        </Panel>
        <Panel title="Аккаунты"><dl className="flex justify-between gap-3"><dt className="muted">GitHub</dt><dd>@{member.handle}</dd></dl></Panel>
      </aside>
    </div>
  </>
}
