import { lazy, Suspense } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui'
import { ActivityFeed, FlagList } from '../components/team-activity'
import { UnmatchedCommits } from '../components/unmatched-commits'
import { Contributions } from '../components/contributions'
import { healthLabels, teamHealth } from '../data/presentation'
import { useDemoMutation, useTeam, useWorkspace } from '../data/workspace'
import { paths } from '../routes'
import { confirmCommitAuthor } from '../data/commit-authors'

const ActivityChart = lazy(async () => ({ default: (await import('../components/activity-chart')).ActivityChart }))

export function Team() {
  const { project, team } = useTeam()
  const manager = useWorkspace().data?.user?.role === 'manager'
  const confirm = useDemoMutation(confirmCommitAuthor)
  const [params, setParams] = useSearchParams()
  if (!project || !team) return <EmptyState title="Команда недоступна"><Link to={paths.projects}>Мои проекты</Link></EmptyState>

  const tab = params.get('tab') ?? 'overview'
  const health = healthLabels[teamHealth(team)]
  const weekly = project.summaries[0]
  const excluded = team.members.flatMap(member => member.exclusions).reduce((total, item) => total + item.lines, 0)
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
      <Link to={paths.summaries(project.id) + '?team=' + encodeURIComponent(team.id)}>Сводки</Link>
      <button type="button" aria-pressed={tab === 'events'} onClick={() => setParams({ tab: 'events' })}>Лента событий</button>
    </div>
    <div className="detail-grid">
      <div className="space-y-4">
      {tab === 'members' ? <Contributions projectId={project.id} team={team} />
        : tab === 'events' ? <><UnmatchedCommits events={team.events} action={manager ? undefined : event =>
            <Button variant="outline" disabled={confirm.isPending} onClick={() => confirm.mutate({ projectId: project.id, teamId: team.id, eventId: event.id })}>Это мой коммит</Button>
          } />
          {confirm.isError && <p role="alert">{confirm.error.message}</p>}<ActivityFeed projectId={project.id} team={team} /></>
        : <>
          <Contributions projectId={project.id} team={team} />
          <Suspense fallback={<p role="status">Загружаем график…</p>}><ActivityChart members={team.members} weeks={team.weeks} /></Suspense>
          <ActivityFeed projectId={project.id} team={team} limit={4} />
        </>}
      </div>
      <aside className="space-y-4">
        <FlagList flags={team.flags} />
        {weekly?.teamTexts[team.id] && <Panel title="Сводка за неделю" aside={<Badge tone="primary">{weekly.label}</Badge>}>
          <p className="text-sm muted">{weekly.teamTexts[team.id]}</p>
          <Link className="mt-3 inline-block text-xs" to={paths.summaries(project.id) + '?team=' + encodeURIComponent(team.id)}>Все сводки →</Link>
        </Panel>}
        <Panel title="Защита от накрутки"><p className="text-sm muted">Строк исключено из вклада: {excluded.toLocaleString('ru-RU')}. Подробности в карточках участников.</p></Panel>
      </aside>
    </div>
  </>
}
