import { Link } from 'react-router'
import { Contributions } from '../components/contributions'
import { EmptyState, PageHeader } from '../components/ui'
import { useProject } from '../data/workspace'
import { paths } from '../routes'

export function Participants() {
  const project = useProject()
  if (!project) return <EmptyState title="Проект недоступен"><Link to={paths.projects}>Мои проекты</Link></EmptyState>
  return <>
    <PageHeader title="Участники" eyebrow={project.settings.name} />
    <div className="space-y-5">{project.teams.length ? project.teams.map(team => <section className="space-y-2" key={team.id}>
      <h2><Link to={paths.team(project.id, team.id)}>{team.name}</Link></h2><Contributions projectId={project.id} team={team} />
    </section>) : <EmptyState title="В проекте пока нет участников" />}</div>
  </>
}
