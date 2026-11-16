import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Badge, Button, Card, EmptyState, Meter, PageHeader } from '../components/ui'
import { formatDate, formatNumber, teamHealth } from '../data/presentation'
import { useWorkspace } from '../data/workspace'
import { paths } from '../routes'
import { ProjectCreate } from './project-create'

const filters = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'complete', label: 'Завершённые' },
] as const

export function Projects() {
  const [filter, setFilter] = useState<(typeof filters)[number]['value']>('all')
  const [params, setParams] = useSearchParams()
  const workspace = useWorkspace().data
  const projects = workspace?.projects ?? []
  const manager = workspace?.user?.role === 'manager'
  const visible = projects.filter(project => filter === 'all' || project.status === filter)
  const attention = projects.filter(project => project.teams.some(team => teamHealth(team) !== 'normal')).length

  return <>
    <PageHeader title="Мои проекты" eyebrow={workspace?.user?.name}
      description={attention ? 'Проекты и команды, которым нужно внимание' : 'Ваши проекты и команды'}
      actions={manager && <Button onClick={() => setParams({ new: '1' })}>+ Новый проект</Button>} />
    <div className="tabs mb-5" aria-label="Состояние проекта">
      {filters.map(item => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>
        {item.label} · {projects.filter(project => item.value === 'all' || project.status === item.value).length}
      </button>)}
    </div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {visible.map(project => {
        const count = project.teams.filter(team => teamHealth(team) !== 'normal').length
        const team = project.teams[0]
        const destination = manager || !team ? paths.project(project.id) : paths.team(project.id, team.id)
        const eventCount = project.summaries[0]?.eventCount ?? project.teams.reduce((total, item) => total + item.events.length, 0)
        return <Link key={project.id} to={destination} className="block text-ink no-underline hover:no-underline">
          <Card className="project-card h-full">
            <div className="flex items-start justify-between gap-2"><h2 className="text-base leading-tight">{project.settings.name}</h2><Badge>{manager ? 'Преподаватель' : 'Студент'}</Badge></div>
            <p className="mb-4 text-xs muted">{project.organization}</p>
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div><dd>{project.teams.length}</dd><dt>команд</dt></div>
              <div><dd>{project.teams.reduce((total, item) => total + item.members.length, 0)}</dd><dt>участников</dt></div>
              <div><dd>{formatNumber(eventCount)}</dd><dt>событий за неделю</dt></div>
            </dl>
            <div className="mt-4 mb-2 flex justify-between gap-3 text-xs"><span>{project.status === 'complete' ? 'Завершён' : 'В работе'}</span><span className="muted">{formatDate(project.settings.endsOn)}</span></div>
            <Meter label="Прогресс проекта" value={project.status === 'complete' ? 100 : project.summaries.length ? 37.5 : 0} color={project.status === 'complete' ? '#3e9770' : undefined} />
            <p className={'project-health ' + (count ? 'badge-warning' : 'badge-success')}>{count ? 'Требуют внимания: ' + count : project.status === 'complete' ? 'Итоговые отчёты готовы' : 'Активных предупреждений нет'}</p>
          </Card>
        </Link>
      })}
      {manager && filter !== 'complete' && <button className="project-new" type="button" onClick={() => setParams({ new: '1' })}><span aria-hidden="true">+</span>Новый проект<small>Курс, поток, стажировка или хакатон</small></button>}
    </div>
    {!visible.length && <div className="mt-4"><EmptyState title="Пока нет проектов">{!manager && <Link to={paths.exampleInvite}>Открыть приглашение</Link>}</EmptyState></div>}
    {params.has('new') && manager && <ProjectCreate onDismiss={() => setParams({})} />}
    {params.has('new') && !manager && <p role="alert" className="mt-4">Создавать проекты может преподаватель.</p>}
  </>
}
