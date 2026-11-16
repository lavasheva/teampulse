import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { Brand, Button, Card } from '../components/ui'
import { signIn } from '../data/session'
import { useDemoMutation, useWorkspace } from '../data/workspace'
import { paths } from '../routes'

export function Login() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const session = useWorkspace()
  const login = useDemoMutation(signIn)
  const target = typeof state?.from === 'string' && /^\/projects(?:\/|\?|$)/.test(state.from) ? state.from : paths.projects
  if (session.data?.user) return <Navigate to={target} replace />

  return (
    <main className="login-screen">
      <div className="login-intro">
        <Brand inverse />
        <div>
          <h1>Видно, кто тянет проект,<br /> — ещё до защиты</h1>
          <ul>
            <li>✓ Метрики вклада прямо из GitHub — без ручных отчётов</li>
            <li>✓ Флаги «тишина», «перекос», «накрутка» — с объяснением</li>
            <li>✓ ИИ-сводка по каждой команде раз в неделю</li>
          </ul>
        </div>
        <p>Для вузов, онлайн-школ и стажировок</p>
      </div>
      <div className="login-main">
        <Card className="login-card">
          <h2>Вход в TeamPulse</h2>
          <p>Войдите через аккаунт GitHub, чтобы видеть вклад и активность ваших команд.</p>
          <Button variant="dark" className="w-full" disabled={login.isPending} onClick={() => login.mutate('manager', { onSuccess: () => navigate(target, { replace: true }) })}>
            {login.isPending ? 'Входим…' : 'Войти через GitHub'}
          </Button>
          {login.isError && <p role="alert">Не удалось войти. Попробуйте ещё раз.</p>}
          <div className="login-note">
            <p>В демо откроется профиль преподавателя Елены Викторовны.</p>
            <p>Есть приглашение от преподавателя? <Link to={paths.exampleInvite}>Перейти по ссылке</Link></p>
          </div>
        </Card>
      </div>
    </main>
  )
}
