import { Link } from 'react-router'
import { EmptyState, PageHeader } from '../components/ui'
import { paths } from '../routes'

export { Login } from './login'
export { Invite } from './invite'
export { Projects } from './projects'
export { Overview } from './overview'
export function Participants() { return <PageHeader title="Участники" /> }
export function Summaries() { return <PageHeader title="Сводки" /> }
export function Settings() { return <PageHeader title="Настройки проекта" /> }
export { Team } from './team'
export function Member() { return <PageHeader title="Участник" /> }
export function Report() { return <main className="p-8"><PageHeader title="Итоговый отчёт" /></main> }

export function NotFound() {
  return <EmptyState title="Страница не найдена"><Link to={paths.projects}>Мои проекты</Link></EmptyState>
}
