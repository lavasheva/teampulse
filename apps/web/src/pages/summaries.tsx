import { Link, useSearchParams } from 'react-router'
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui'
import { formatDate, healthLabels, teamHealth, teamsByHealth } from '../data/presentation'
import { refreshSummary, updateSummaryMailing } from '../data/summaries'
import { useDemoMutation, useProject, useWorkspace } from '../data/workspace'
import { paths } from '../routes'

export function Summaries() {
  const project = useProject()
  const manager = useWorkspace().data?.user?.role === 'manager'
  const [params, setParams] = useSearchParams()
  const refresh = useDemoMutation(refreshSummary)
  const mailing = useDemoMutation(updateSummaryMailing)
  if (!project) return <EmptyState title="Проект недоступен"><Link to={paths.projects}>Мои проекты</Link></EmptyState>

  const teamId = params.get('team')
  const filteredTeam = project.teams.find(team => team.id === teamId)
  const summary = project.summaries.find(item => item.id === params.get('week')) ?? project.summaries[0]
  const teams = filteredTeam ? [filteredTeam] : teamsByHealth(project.teams)
  const latest = summary?.id === project.summaries[0]?.id

  return <>
    <PageHeader title="Сводки" eyebrow={project.settings.name} description={filteredTeam ? 'Команда «' + filteredTeam.name + '»' : 'Еженедельные сводки по проекту и командам'}
      actions={manager && <>
        <Button asChild variant="outline"><a href="#mailing">Настроить рассылку</a></Button>
        <Button disabled={!summary || !latest || refresh.isPending} onClick={() => refresh.mutate(project.id)}>Обновить сводку</Button>
      </>} />
    {refresh.isError && <p className="mb-4" role="alert">{refresh.error.message}</p>}
    {project.summaries.length > 0 && <div className="tabs mb-5" aria-label="Неделя сводки">
      {project.summaries.map(item => <button key={item.id} type="button" aria-pressed={summary?.id === item.id} onClick={() => {
        setParams(current => {
          const next = new URLSearchParams(current)
          next.set('week', item.id)
          return next
        })
      }}>{item.label}</button>)}
    </div>}
    {filteredTeam && manager && <Link className="mb-4 inline-block" to={paths.summaries(project.id)}>← Все команды</Link>}
    <div className="detail-grid">
      <div className="space-y-4">
        {!summary ? <EmptyState title="Сводок пока нет"><p>Сводки появятся после первой недели работы.</p></EmptyState> : <>
          {manager && !filteredTeam && <Panel title="Проект за неделю" aside={<Badge tone="primary">Демо · {summary.label}</Badge>}><p className="leading-relaxed muted">{summary.text}</p></Panel>}
          {teams.filter(team => summary.teamTexts[team.id]).map(team => {
            const health = healthLabels[teamHealth(team)]
            return <Panel key={team.id} title={team.name} aside={<Badge tone={health.tone}>{health.label}</Badge>}>
              <p className="leading-relaxed muted">{summary.teamTexts[team.id]}</p>
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs">
                <span className="muted">{summary.refreshedAt && latest ? 'Обновлено ' + formatDate(summary.refreshedAt) : summary.label}</span>
                <Link to={paths.team(project.id, team.id)}>Открыть команду →</Link>
              </div>
            </Panel>
          })}
        </>}
      </div>
      <aside className="space-y-4">
        {summary && !filteredTeam && <Panel title="Неделя в цифрах"><dl className="divide-y divide-line">
          <div className="flex justify-between py-2"><dt>События</dt><dd>{summary.eventCount}</dd></div>
          <div className="flex justify-between py-2"><dt>Активные участники</dt><dd>{summary.activeMembers}</dd></div>
          <div className="flex justify-between py-2"><dt>Принятые pull requests</dt><dd>{summary.merged}</dd></div>
        </dl></Panel>}
        {manager && <div id="mailing" className="scroll-mt-5"><Panel title="Рассылка">
          <p className="text-xs muted">По понедельникам в 9:00 · {project.sendTeamSummaries ? 'преподавателю и командам' : 'преподавателю'}</p>
          <label className="mt-4 flex items-center justify-between gap-3 text-xs">
            Отправлять командам их сводку
            <input type="checkbox" role="switch" checked={project.sendTeamSummaries} disabled={mailing.isPending}
              onChange={event => mailing.mutate({ projectId: project.id, enabled: event.currentTarget.checked })} />
          </label>
          {mailing.isError && <p role="alert" className="mt-2 text-xs">{mailing.error.message}</p>}
        </Panel></div>}
      </aside>
    </div>
  </>
}
