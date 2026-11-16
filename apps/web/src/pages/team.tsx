import { Link, useSearchParams } from 'react-router'
import { Badge, Button, EmptyState, PageHeader } from '../components/ui'
import { ActivityChart } from '../components/activity-chart'
import { Contributions } from '../components/contributions'
import { healthLabels, teamHealth } from '../data/presentation'
import { useTeam, useWorkspace } from '../data/workspace'
import { paths } from '../routes'

export function Team() {
  const { project, team } = useTeam()
  const manager = useWorkspace().data?.user?.role === 'manager'
  const [params, setParams] = useSearchParams()
  if (!project || !team) return <EmptyState title="Команда недоступна"><Link to={paths.projects}>Мои проекты</Link></EmptyState>

  const overview = params.get('tab') !== 'members'
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
      <button type="button" aria-pressed={overview} onClick={() => setParams({})}>Обзор</button>
      <button type="button" aria-pressed={!overview} onClick={() => setParams({ tab: 'members' })}>Участники</button>
    </div>
    <div className="space-y-4">
      <Contributions projectId={project.id} team={team} />
      {overview && <ActivityChart members={team.members} weeks={team.weeks} />}
    </div>
  </>
}
