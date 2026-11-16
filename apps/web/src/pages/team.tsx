import { lazy, Suspense } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Badge, Button, EmptyState, PageHeader } from '../components/ui'
import { ActivityFeed } from '../components/team-activity'
import { Contributions } from '../components/contributions'
import { healthLabels, teamHealth } from '../data/presentation'
import { useTeam, useWorkspace } from '../data/workspace'
import { paths } from '../routes'

const ActivityChart = lazy(async () => ({ default: (await import('../components/activity-chart')).ActivityChart }))

export function Team() {
  const { project, team } = useTeam()
  const manager = useWorkspace().data?.user?.role === 'manager'
  const [params, setParams] = useSearchParams()
  if (!project || !team) return <EmptyState title="Команда недоступна"><Link to={paths.projects}>Мои проекты</Link></EmptyState>

  const tab = params.get('tab') ?? 'overview'
  const health = healthLabels[teamHealth(team)]
  return <>
    <PageHeader
      eyebrow={<Link to={manager ? paths.project(project.id) : paths.projects}>← {project.settings.name}</Link>}
      title={<span className="flex flex-wrap items-center gap-3">{team.name} <Badge tone={health.tone}>{health.label}</Badge></span>}
      description={[team.repository, 'Участники: ' + team.members.length, 'События: ' + team.events.length].filter(Boolean).join(' · ')}
      actions={<>
        {team.repositoryUrl && <Button asChild variant="outline"><a href={team.repositoryUrl} target="_blank" rel="noreferrer">Открыть на GitHub</a></Button>}
        <Button asChild><Link to={paths.report(project.id, team.id)}>Итоговый отчёт</Link></Button>
      </>}
    />
    <div className="page-tabs" aria-label="Раздел команды">
      <button type="button" aria-pressed={tab === 'overview'} onClick={() => setParams({})}>Обзор</button>
      <button type="button" aria-pressed={tab === 'members'} onClick={() => setParams({ tab: 'members' })}>Участники</button>
      <button type="button" aria-pressed={tab === 'events'} onClick={() => setParams({ tab: 'events' })}>Лента событий</button>
    </div>
    <div className="space-y-4">
      {tab === 'members' ? <Contributions projectId={project.id} team={team} />
        : tab === 'events' ? <ActivityFeed projectId={project.id} team={team} />
        : <>
          <Contributions projectId={project.id} team={team} />
          <Suspense fallback={<p role="status">Загружаем график…</p>}><ActivityChart members={team.members} weeks={team.weeks} /></Suspense>
          <ActivityFeed projectId={project.id} team={team} limit={4} />
        </>}
    </div>
  </>
}
