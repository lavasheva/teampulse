import { Outlet, useNavigate } from 'react-router'
import { WorkspaceFrame } from './workspace-frame'
import { signOut } from '../data/session'
import { useDemoMutation, useWorkspace } from '../data/workspace'
import { paths } from '../routes'

export function WorkspaceLayout() {
  const workspace = useWorkspace().data
  const navigate = useNavigate()
  const logout = useDemoMutation(signOut)
  const manager = workspace?.user?.role === 'manager'

  return workspace?.user ? <WorkspaceFrame
    projects={workspace.projects.map(project => ({ id: project.id, name: project.settings.name,
      canManage: manager, firstTeamId: project.teams[0]?.id, visible: project.status === 'active' }))}
    user={{ name: workspace.user.name, label: manager ? 'Преподаватель' : 'Студент' }} allowCreate={manager}
    loggingOut={logout.isPending} onLogout={() => logout.mutate(undefined, { onSuccess: () => navigate(paths.login, { replace: true }) })}
  ><Outlet /></WorkspaceFrame> : <Outlet />
}
