import { Navigate, Outlet, useLocation } from 'react-router'
import { useWorkspace } from '../data/workspace'
import { paths } from '../routes'
import { Button, EmptyState } from './ui'

export function RequireSession() {
  const query = useWorkspace()
  const location = useLocation()
  if (query.isPending) return <main className="p-8" role="status">Загружаем TeamPulse…</main>
  if (query.isError) return <main className="p-8"><EmptyState title="Не удалось открыть TeamPulse"><Button onClick={() => void query.refetch()}>Повторить</Button></EmptyState></main>
  if (!query.data.user) return <Navigate to={paths.login} replace state={{ from: location.pathname + location.search }} />
  return <Outlet />
}
