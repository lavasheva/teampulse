import { Link } from 'react-router'
import { EmptyState, PageHeader } from '../components/ui'
import { paths } from '../routes'

export function Login() { return <main className="p-8"><PageHeader title="Вход в TeamPulse" /><Link to={paths.projects}>К проектам</Link></main> }
export function Invite() { return <main className="p-8"><PageHeader title="Приглашение в проект" /></main> }
export function Projects() { return <><PageHeader title="Мои проекты" /><Link to={paths.project('web')}>Веб-разработка, осень 2026</Link></> }
export function Overview() { return <PageHeader title="Обзор проекта" /> }
export function Participants() { return <PageHeader title="Участники" /> }
export function Summaries() { return <PageHeader title="Сводки" /> }
export function Settings() { return <PageHeader title="Настройки проекта" /> }
export function Team() { return <PageHeader title="Команда" /> }
export function Member() { return <PageHeader title="Участник" /> }
export function Report() { return <main className="p-8"><PageHeader title="Итоговый отчёт" /></main> }

export function NotFound() {
  return <EmptyState title="Страница не найдена"><Link to={paths.projects}>Мои проекты</Link></EmptyState>
}
