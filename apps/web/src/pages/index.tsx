import { Link } from 'react-router'
import { EmptyState } from '../components/ui'
import { paths } from '../routes'

export { Login } from './login'
export { Invite } from './invite'
export { Projects } from './projects'
export { Overview } from './overview'
export { Participants } from './participants'
export { Summaries } from './summaries'
export { Settings } from './settings'
export { Team } from './team'
export { Member } from './member'
export { Report } from './report'

export function NotFound() {
  return <EmptyState title="Страница не найдена"><Link to={paths.projects}>Мои проекты</Link></EmptyState>
}
