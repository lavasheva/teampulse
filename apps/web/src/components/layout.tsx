import { Link, NavLink, Outlet, useMatch, useNavigate } from 'react-router'
import { Avatar, Brand } from './ui'
import { signOut } from '../data/session'
import { useDemoMutation, useWorkspace } from '../data/workspace'
import { paths } from '../routes'

export function WorkspaceLayout() {
  const projectId = useMatch('/projects/:projectId/*')?.params.projectId
  const workspace = useWorkspace().data
  const navigate = useNavigate()
  const logout = useDemoMutation(signOut)
  const project = workspace?.projects.find(item => item.id === projectId)
  const manager = workspace?.user?.role === 'manager'

  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link className="sidebar-brand" to={paths.projects}><Brand /></Link>
        <nav aria-label="Навигация" className="sidebar-nav">
          <p>Проекты</p>
          {workspace?.projects.filter(item => item.status === 'active' || projectId === item.id).map(item => (
            <NavLink className={item.id === projectId ? 'nav-current' : undefined} key={item.id} to={manager || !item.teams[0] ? paths.project(item.id) : paths.team(item.id, item.teams[0].id)}>{item.settings.name}</NavLink>
          ))}
          {manager && <Link to={paths.projects + '?new=1'}>+ Новый проект</Link>}
          {project && <>
            <p>Проект</p>
            <NavLink to={paths.summaries(project.id)}>Сводки</NavLink>
            <NavLink to={paths.participants(project.id)}>Участники</NavLink>
            {manager && <NavLink to={paths.settings(project.id)}>Настройки</NavLink>}
          </>}
        </nav>
        {workspace?.user && <div className="sidebar-profile">
          <Avatar name={workspace.user.name} color={manager ? undefined : '#2d8ca8'} />
          <div className="min-w-0 flex-1"><strong>{workspace.user.name}</strong><small>{manager ? 'Преподаватель' : 'Студент'}</small></div>
          <button type="button" title="Выйти" className="text-link" disabled={logout.isPending} aria-label="Выйти" onClick={() => logout.mutate(undefined, { onSuccess: () => navigate(paths.login, { replace: true }) })}>↪</button>
        </div>}
      </aside>
      <main className="workspace-content" id="main"><Outlet /></main>
    </div>
  )
}
