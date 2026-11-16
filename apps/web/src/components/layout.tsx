import { Link, NavLink, Outlet, useMatch } from 'react-router'
import { Avatar, Brand } from './ui'
import { paths } from '../routes'

export function WorkspaceLayout() {
  const projectId = useMatch('/projects/:projectId/*')?.params.projectId

  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link className="sidebar-brand" to={paths.projects}><Brand /></Link>
        <nav aria-label="Навигация" className="sidebar-nav">
          <p>Проекты</p>
          <NavLink end to={paths.projects}>Мои проекты</NavLink>
          {projectId && <>
            <NavLink end to={paths.project(projectId)}>Обзор проекта</NavLink>
            <p>Проект</p>
            <NavLink to={paths.summaries(projectId)}>Сводки</NavLink>
            <NavLink to={paths.participants(projectId)}>Участники</NavLink>
            <NavLink to={paths.settings(projectId)}>Настройки</NavLink>
          </>}
        </nav>
        <div className="sidebar-profile"><Avatar name="Елена Викторовна" /><div><strong>Елена Викторовна</strong><small>Преподаватель</small></div></div>
      </aside>
      <main className="workspace-content" id="main"><Outlet /></main>
    </div>
  )
}
