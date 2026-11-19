import type { ReactNode } from 'react'
import { Link, NavLink, useMatch } from 'react-router'
import { Avatar, Brand } from './ui'
import { paths } from '../routes'

export interface NavigationProject { id: string; name: string; canManage: boolean; firstTeamId?: string; visible: boolean }
export function WorkspaceFrame({ projects, user, onLogout, loggingOut, allowCreate, children }: {
  projects: NavigationProject[]; user: { name: string; label: string }; onLogout: () => void
  loggingOut: boolean; allowCreate: boolean; children: ReactNode
}) {
  const projectId = useMatch('/projects/:projectId/*')?.params.projectId
  const project = projects.find(item => item.id === projectId)
  return <div className="workspace">
    <aside className="sidebar">
      <Link className="sidebar-brand" to={paths.projects}><Brand /></Link>
      <nav aria-label="Навигация" className="sidebar-nav">
        <p>Проекты</p>
        <NavLink end to={paths.projects}>Все проекты</NavLink>
        {projects.filter(item => item.visible || item.id === projectId).map(item =>
          <NavLink className={item.id === projectId ? 'nav-current' : undefined} key={item.id}
            to={item.canManage || !item.firstTeamId ? paths.project(item.id) : paths.team(item.id, item.firstTeamId)}>{item.name}</NavLink>)}
        {allowCreate && <Link to={paths.projects + '?new=1'}>+ Новый проект</Link>}
        {project && <>
          <p>Проект</p>
          <NavLink end to={paths.project(project.id)}>Обзор проекта</NavLink>
          <NavLink to={paths.summaries(project.id)}>Сводки</NavLink>
          <NavLink to={paths.participants(project.id)}>Участники</NavLink>
          {project.canManage && <NavLink to={paths.settings(project.id)}>Настройки</NavLink>}
        </>}
      </nav>
      <div className="sidebar-profile">
        <Avatar name={user.name} />
        <div className="min-w-0 flex-1 break-words"><strong>{user.name}</strong><small>{user.label}</small></div>
        <button type="button" title="Выйти" aria-label="Выйти" className="text-link" disabled={loggingOut} onClick={onLogout}>↪</button>
      </div>
    </aside>
    <main className="workspace-content" id="main">{children}</main>
  </div>
}
