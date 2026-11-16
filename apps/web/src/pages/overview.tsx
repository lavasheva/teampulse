import { Link, Navigate } from 'react-router'
import { InviteLink } from '../components/invite-link'
import { ProjectTeamCard, teamsByHealth } from '../components/project-team-card'
import { Badge, Button, Card, EmptyState, PageHeader, Panel } from '../components/ui'
import { formatDate, formatNumber, teamHealth } from '../data/presentation'
import { useProject, useWorkspace } from '../data/workspace'
import { paths } from '../routes'

export function Overview() {
  const project = useProject()
  const manager = useWorkspace().data?.user?.role === 'manager'
  if (!project) return <EmptyState title="Проект недоступен"><Link to={paths.projects}>Мои проекты</Link></EmptyState>
  if (!manager && project.teams[0]) return <Navigate replace to={paths.team(project.id, project.teams[0].id)} />

  const teams = teamsByHealth(project.teams)
  const atRisk = teams.filter(team => teamHealth(team) === 'risk').length
  const attention = teams.filter(team => teamHealth(team) !== 'normal').length
  const weekly = project.summaries[0]
  const average = teams.length ? teams.reduce((total, team) => total + team.balance, 0) / teams.length : 0
  const stats = [
    { label: 'Команды', value: teams.length, hint: 'Участников: ' + teams.reduce((total, team) => total + team.members.length, 0) },
    { label: 'Требуют внимания', value: attention, hint: 'Риск: ' + atRisk + ' · Внимание: ' + (attention - atRisk) },
    { label: 'События за неделю', value: weekly?.eventCount ?? 0, hint: 'Коммиты, pull requests, ревью и задачи' },
    { label: 'Средняя равномерность', value: formatNumber(Math.round(average * 100) / 100), hint: '0 — поровну, 1 — весь вклад у одного' },
  ]

  return <>
    <PageHeader title={project.settings.name} eyebrow={project.organization}
      description={'Защита ' + formatDate(project.settings.endsOn)}
      actions={<>
        {project.status === 'active' && <details className="invite-popover">
          <summary className="button button-outline">Ссылка-приглашение</summary>
          <Card className="invite-popover-content"><InviteLink code={project.inviteCode} /></Card>
        </details>}
        <Button asChild><Link to={paths.summaries(project.id)}>Сводка за неделю</Link></Button>
      </>} />
    <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {stats.map(stat => <Card key={stat.label} className="p-4">
        <p className="text-xs muted">{stat.label}</p><strong className="block py-1 text-[27px]">{stat.value}</strong><p className="text-xs muted">{stat.hint}</p>
      </Card>)}
    </div>
    <div className="detail-grid">
      {teams.length ? <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Команды проекта">
        {teams.map(team => <ProjectTeamCard key={team.id} projectId={project.id} team={team} />)}
      </div> : <EmptyState title="В проекте пока нет команд" />}
      <Panel title="Сводка за неделю" aside={weekly && <Badge tone="primary">{weekly.label}</Badge>}>
        {weekly ? <div className="space-y-4">
          <p className="text-sm muted">{weekly.text}</p>
          {teams.filter(team => weekly.teamTexts[team.id]).slice(0, 3).map(team => <p className="text-xs leading-relaxed muted" key={team.id}><strong className="text-ink">{team.name}.</strong> {weekly.teamTexts[team.id]}</p>)}
        </div> : <p className="muted">Сводок пока нет.</p>}
      </Panel>
    </div>
  </>
}
