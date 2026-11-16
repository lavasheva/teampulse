import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { Avatar, Badge, Brand, Button, Card, EmptyState } from '../components/ui'
import { acceptInvitation, loadInvitation } from '../data/invitations'
import { signIn } from '../data/session'
import { useDemoMutation, useWorkspace } from '../data/workspace'
import { paths } from '../routes'

export function Invite() {
  const { code = '' } = useParams()
  return <Invitation key={code} code={code} />
}

function Invitation({ code }: { code: string }) {
  const [teamId, setTeamId] = useState('')
  const navigate = useNavigate()
  const workspace = useWorkspace()
  const invitation = useQuery({ queryKey: ['demo', 'invite', code], queryFn: () => loadInvitation(code) })
  const login = useDemoMutation(signIn)
  const accept = useDemoMutation(acceptInvitation)
  const student = workspace.data?.user?.role === 'participant' ? workspace.data.user : null
  const project = invitation.data
  const selected = teamId || (project && workspace.data?.assignments[project.id]) || project?.teams[0]?.id || ''

  return (
    <main className="invitation">
      <header className="flex items-center justify-between gap-4 border-b border-line bg-white px-8 py-4">
        <Link to={paths.projects}><Brand /></Link>
        {student && <div className="flex items-center gap-2 text-xs"><Avatar name={student.name} color="#2d8ca8" /><div><strong>{student.name}</strong><p className="muted">Студент</p></div></div>}
      </header>
      <div className="mx-auto w-full max-w-[680px] p-5 sm:py-10">
        {invitation.isPending ? <p role="status">Загружаем приглашение…</p>
          : invitation.isError ? <EmptyState title="Не удалось загрузить приглашение"><Button onClick={() => void invitation.refetch()}>Повторить</Button></EmptyState>
          : !project ? <EmptyState title="Приглашение недоступно"><p>Проверьте ссылку или попросите преподавателя прислать новую.</p><Link to={paths.projects}>Мои проекты</Link></EmptyState>
          : <Card className="space-y-6 p-6 sm:p-10">
            <div>
              <p className="mb-1 text-xs font-semibold text-brand uppercase">Приглашение в проект</p>
              <h1>{project.name}</h1>
              <p className="mt-1 muted">{project.owner} · {project.organization}</p>
            </div>
            <ol className="grid grid-cols-2 gap-2" aria-label="Шаги приглашения">
              <li><Badge tone={student ? 'success' : 'primary'}>{student ? '✓' : '1'} Вход через GitHub</Badge></li>
              <li><Badge tone={student ? 'primary' : 'neutral'}>2 Команда</Badge></li>
            </ol>
            {!student ? <div className="space-y-4">
              <p className="muted">В демо откроется профиль студента Ильи Фёдорова.</p>
              <Button variant="dark" disabled={login.isPending} onClick={() => login.mutate('participant')}>Войти через GitHub</Button>
              {login.isError && <p role="alert">Не удалось войти. Попробуйте ещё раз.</p>}
            </div> : <form className="space-y-5" onSubmit={event => {
              event.preventDefault()
              accept.mutate({ code, teamId: selected }, { onSuccess: result => navigate(paths.team(result.projectId, result.teamId)) })
            }}>
              <fieldset className="space-y-2">
                <legend className="mb-2 font-medium">Ваша команда</legend>
                {project.teams.map(team => <label key={team.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-line p-3 has-checked:border-brand has-checked:bg-canvas">
                  <input type="radio" name="team" value={team.id} checked={selected === team.id} onChange={() => setTeamId(team.id)} />
                  <div className="flex -space-x-1" aria-hidden="true">{team.members.slice(0, 3).map(({ name, color }) => <Avatar key={name} name={name} color={color} />)}</div>
                  <span><strong className="block">{team.name}</strong><span className="text-xs muted">{team.members.map(member => member.name).join(', ') || 'Новая команда'}</span></span>
                </label>)}
                {!project.teams.length && <p className="muted">В проекте пока нет команд. Обратитесь к преподавателю.</p>}
              </fieldset>
              {accept.isError && <p role="alert">{accept.error.message}</p>}
              <div className="flex justify-between gap-3">
                <Button asChild variant="outline"><Link to={paths.projects}>Назад</Link></Button>
                <Button type="submit" disabled={!selected || accept.isPending}>Перейти к команде</Button>
              </div>
            </form>}
          </Card>}
      </div>
    </main>
  )
}
