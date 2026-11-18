import { useState, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router'
import type { LiveProject, LiveProjectSettings } from '@teampulse/shared'
import { Badge, Brand, Button, Card, EmptyState, PageHeader, Panel } from '../components/ui'
import { api } from './client'
import { sessionKey, useApiMutation, useLiveWorkspace, useSession } from './hooks'

function ErrorText({ error }: { error: unknown }) {
  return error ? <p role="alert" className="mt-3 text-sm">{error instanceof Error ? error.message : 'Не удалось выполнить запрос.'}</p> : null
}
function Loading() { return <p role="status" className="p-6">Загружаем TeamPulse…</p> }
function LoginButton() {
  const location = useLocation()
  return <Button variant="dark" onClick={() => {
    sessionStorage.setItem('teampulse.returnTo', location.pathname)
    window.location.assign('/api/auth/github')
  }}>Войти через GitHub</Button>
}
function Home() {
  const [target] = useState(() => {
    const value = sessionStorage.getItem('teampulse.returnTo')
    sessionStorage.removeItem('teampulse.returnTo')
    return value && /^\/invite\/[A-Za-z0-9_-]{43}$/.test(value) ? value : '/projects'
  })
  return <Navigate to={target} replace />
}
function Shell({ children }: { children: ReactNode }) {
  const session = useSession(), queries = useQueryClient()
  const logout = useMutation({ mutationFn: async () => {
    await api.logout()
    await queries.cancelQueries({ queryKey: ['api'] })
    queries.setQueryData(sessionKey, null)
    queries.removeQueries({ predicate: query => query.queryKey[0] === 'api' && query.queryKey[1] !== 'session' })
  } })
  return <div className="min-h-screen bg-canvas">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-white px-6 py-4">
      <Link to="/projects"><Brand /></Link>
      <div className="flex items-center gap-4 text-sm"><span>{session.data?.user.name ?? session.data?.user.githubLogin}</span>
        {session.data && <Button variant="outline" disabled={logout.isPending} onClick={() => logout.mutate()}>Выйти</Button>}</div>
    </header>
    <main className="mx-auto max-w-6xl p-5 md:p-8">{children}<ErrorText error={logout.error} /></main>
  </div>
}
function Protected({ children }: { children: ReactNode }) {
  const session = useSession()
  if (session.isPending) return <Loading />
  if (session.isError) return <EmptyState title="Не удалось проверить вход"><ErrorText error={session.error} /><Button onClick={() => void session.refetch()}>Повторить</Button></EmptyState>
  if (!session.data) return <EmptyState title="Вход в TeamPulse"><p className="mb-4">Войдите через GitHub, чтобы открыть свои проекты и команды.</p><LoginButton /></EmptyState>
  return children
}
function Projects() {
  const workspace = useLiveWorkspace()
  const organization = useApiMutation(api.createOrganization)
  const create = useApiMutation(({ org, ...input }: { org: string; name: string; startsOn: string; endsOn: string; teamName: string }) => api.createProject(org, input))
  const navigate = useNavigate()
  if (workspace.isPending) return <Loading />
  if (workspace.isError) return <EmptyState title="Не удалось загрузить проекты"><ErrorText error={workspace.error} /><Button onClick={() => void workspace.refetch()}>Повторить</Button></EmptyState>
  return <>
    <PageHeader title="Мои проекты" description="Проекты и команды из вашего рабочего пространства" />
    <div className="grid gap-4 md:grid-cols-2">
      {workspace.data.projects.map(project => <Card key={project.id} className="p-5">
        <div className="mb-2 flex items-start justify-between gap-3"><Link to={`/projects/${project.id}`} className="font-semibold">{project.settings.name}</Link>
          <Badge>{project.canManage ? 'Руководитель' : 'Участник / наблюдатель'}</Badge></div>
        <p className="text-sm muted">{project.organization.name} · Команд: {project.teams.length}</p>
        <p className="mt-2 text-sm">Собрано событий: {project.teams.reduce((n, team) => n + (team.repository?._count.events ?? 0), 0)}</p>
      </Card>)}
    </div>
    {!workspace.data.projects.length && <EmptyState title="Пока нет проектов"><p>Вступите по приглашению или создайте организацию и свой проект.</p></EmptyState>}
    <div className="mt-6 grid gap-5 md:grid-cols-2">
      <Panel title="Создать организацию"><form className="space-y-3" onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget, data = new FormData(form)
        organization.mutate({ name: String(data.get('name')), kind: 'university' }, { onSuccess: () => form.reset() })
      }}><label className="field">Название организации<input name="name" required maxLength={120} /></label>
        <Button type="submit" disabled={organization.isPending}>Создать организацию</Button><ErrorText error={organization.error} /></form></Panel>
      {workspace.data.organizations.length > 0 && <Panel title="Новый проект"><form className="space-y-3" onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget)
        create.mutate({ org: String(data.get('org')), name: String(data.get('name')), startsOn: String(data.get('starts')),
          endsOn: String(data.get('ends')), teamName: String(data.get('team')) }, { onSuccess: project => navigate(`/projects/${project.id}`) })
      }}>
        <label className="field">Организация<select name="org">{workspace.data.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
        <label className="field">Название проекта<input name="name" required maxLength={120} /></label>
        <div className="grid grid-cols-2 gap-3"><label className="field">Начало<input name="starts" type="date" required /></label>
          <label className="field">Защита<input name="ends" type="date" required /></label></div>
        <label className="field">Первая команда<input name="team" required defaultValue="Команда 1" maxLength={120} /></label>
        <Button type="submit" disabled={create.isPending}>Создать проект</Button><ErrorText error={create.error} />
      </form></Panel>}
    </div>
  </>
}
function Project() {
  const { projectId } = useParams(), workspace = useLiveWorkspace()
  const [invitation, setInvitation] = useState('')
  const invite = useApiMutation(api.invite), createTeam = useApiMutation((name: string) => api.createTeam(projectId!, name))
  if (workspace.isPending) return <Loading />
  if (workspace.isError) return <ErrorText error={workspace.error} />
  const project = workspace.data.projects.find(p => p.id === projectId)
  if (!project) return <EmptyState title="Проект недоступен"><Link to="/projects">Мои проекты</Link></EmptyState>
  return <>
    <PageHeader title={project.settings.name} eyebrow={<Link to="/projects">← Мои проекты</Link>} description={project.organization.name}
      actions={project.canManage && <Button disabled={invite.isPending} onClick={() => invite.mutate(project.id, { onSuccess: result =>
        setInvitation(`${window.location.origin}/invite/${result.token}`) })}>Создать приглашение</Button>} />
    {invitation && <Card className="mb-4 p-4"><label className="field">Ссылка приглашения (действует 7 дней)<input readOnly value={invitation} onFocus={e => e.currentTarget.select()} /></label></Card>}
    <ErrorText error={invite.error} />
    <div className="grid gap-4 md:grid-cols-2">{project.teams.map(team => <Card key={team.id} className="p-5">
      <Link className="font-semibold" to={`/projects/${project.id}/teams/${team.id}`}>{team.name}</Link>
      <p className="mt-2 text-sm muted">Участников: {team.memberships.length} · {team.repository?.fullName ?? 'Репозиторий не подключён'}</p>
      <p className="text-sm">Собрано событий: {team.repository?._count.events ?? 0}</p>
    </Card>)}</div>
    <Card className="mt-5 p-5"><h2>Вклад ещё не рассчитан</h2><p className="mt-2 text-sm muted">Собранные события доступны на странице команды. Доли вклада, флаги и сводки появятся после расчёта.</p></Card>
    {project.canManage && <>
      <Panel title="Добавить команду" className="mt-5"><form className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget
        createTeam.mutate(String(new FormData(form).get('name')), { onSuccess: () => form.reset() })
      }}><label className="field">Название команды<input name="name" required maxLength={120} /></label><Button type="submit" disabled={createTeam.isPending}>Добавить команду</Button><ErrorText error={createTeam.error} /></form></Panel>
      <Settings key={project.id} project={project} />
    </>}
  </>
}
function Settings({ project }: { project: LiveProject }) {
  const [settings, setSettings] = useState<LiveProjectSettings>(project.settings)
  const save = useApiMutation((input: LiveProjectSettings) => api.saveSettings(project.id, input))
  return <Panel title="Настройки проекта" className="mt-5"><form className="space-y-4" onSubmit={event => {
    event.preventDefault(); save.mutate(settings)
  }}>
    <label className="field">Название проекта<input required maxLength={120} value={settings.name} onChange={e => setSettings({ ...settings, name: e.target.value })} /></label>
    <div className="grid grid-cols-2 gap-3"><label className="field">Дата начала<input type="date" required value={settings.startsOn} onChange={e => setSettings({ ...settings, startsOn: e.target.value })} /></label>
      <label className="field">Дата защиты<input type="date" required value={settings.endsOn} onChange={e => setSettings({ ...settings, endsOn: e.target.value })} /></label></div>
    <fieldset className="grid grid-cols-2 gap-3 md:grid-cols-4"><legend>Веса видов работы, %</legend>{Object.entries({ code: 'Код', pullRequests: 'Pull requests', reviews: 'Ревью', issues: 'Задачи' }).map(([key, label]) => <label className="field" key={key}>{label}
      <input type="number" min={0} max={100} required value={settings.weights[key as keyof typeof settings.weights]} onChange={e => setSettings({ ...settings, weights: { ...settings.weights, [key]: Number(e.target.value) } })} /></label>)}</fieldset>
    <p className="text-sm muted">Сумма весов должна быть 100%. Настройки применятся при следующем расчёте вкладов.</p>
    <Button type="submit" disabled={save.isPending}>Сохранить настройки</Button><ErrorText error={save.error} />
    {save.isSuccess && <p role="status" className="text-sm">Настройки сохранены.</p>}
  </form></Panel>
}
function Team() {
  const { projectId, teamId = '' } = useParams(), workspace = useLiveWorkspace()
  const project = workspace.data?.projects.find(p => p.id === projectId), team = project?.teams.find(t => t.id === teamId)
  const status = useQuery({ queryKey: ['api', 'sync', teamId], queryFn: () => api.syncStatus(teamId), enabled: Boolean(team?.repository), refetchInterval: 5000 })
  const events = useInfiniteQuery({ queryKey: ['api', 'events', teamId], queryFn: ({ pageParam }) => api.events(teamId, pageParam),
    initialPageParam: undefined as string | undefined, getNextPageParam: page => page.nextCursor ?? undefined, enabled: Boolean(team), refetchInterval: 15000 })
  const unmatched = useInfiniteQuery({ queryKey: ['api', 'unmatched', teamId], queryFn: ({ pageParam }) => api.unmatched(teamId, pageParam),
    initialPageParam: undefined as string | undefined, getNextPageParam: page => page.nextCursor ?? undefined, enabled: Boolean(team), refetchInterval: 15000 })
  const app = useQuery({ queryKey: ['api', 'app'], queryFn: api.app, enabled: Boolean(team?.canConnect) })
  const connect = useApiMutation((input: { fullName: string }) => api.connect(teamId, input))
  const sync = useApiMutation(() => api.sync(teamId)), claim = useApiMutation((id: string) => api.claim(teamId, id))
  if (workspace.isPending) return <Loading />
  if (workspace.isError) return <ErrorText error={workspace.error} />
  if (!project || !team) return <EmptyState title="Команда недоступна"><Link to="/projects">Мои проекты</Link></EmptyState>
  const names = new Map(team.memberships.map(member => [member.user.id, member.user.name ?? member.user.githubLogin]))
  return <>
    <PageHeader title={team.name} eyebrow={<Link to={`/projects/${project.id}`}>← {project.settings.name}</Link>}
      description={team.repository?.fullName ?? 'Подключите репозиторий команды'}
      actions={team.repository && team.canConnect && <Button disabled={sync.isPending} onClick={() => sync.mutate()}>Обновить историю</Button>} />
    <ErrorText error={sync.error} />
    {team.repository && <Card className="mb-5 p-4"><h2>Загрузка истории</h2>
      <p className="mt-2 text-sm" role="status">{status.data ? `Статус: ${{ pending: 'в очереди', running: 'загружается', complete: 'завершена', failed: 'ошибка', disconnected: 'нет доступа GitHub' }[status.data.syncStatus]}. Событий: ${status.data._count.events}` : 'Проверяем состояние…'}</p>
      {status.data?.syncRetryAt && <p className="text-sm muted">Следующая попытка: {new Date(status.data.syncRetryAt).toLocaleString('ru-RU')}</p>}<ErrorText error={status.error} /></Card>}
    {!team.repository && team.canConnect && <Panel title="Подключить GitHub" className="mb-5">
      {app.data?.installationUrl && <p className="mb-4"><a href={app.data.installationUrl} target="_blank" rel="noreferrer">Установить TeamPulse Insights на репозиторий →</a></p>}
      <form className="space-y-3" onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget)
        connect.mutate({ fullName: String(data.get('repo')) })
      }}><label className="field">Репозиторий (владелец/название)<input name="repo" placeholder="lavasheva/teampulse" required /></label>
        <p className="text-sm muted">Сначала установите приложение на выбранный репозиторий. Подключение подтверждает его администратор.</p>
        <Button type="submit" disabled={connect.isPending}>Подключить репозиторий</Button><ErrorText error={connect.error} /></form>
    </Panel>}
    <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-5"><Panel title="События из GitHub">
        {events.isPending && <Loading />}<ErrorText error={events.error} />
        {events.data?.pages.flatMap(page => page.events).map(event => <article key={event.id} className="border-b border-line py-3">
          <div className="flex items-start justify-between gap-3"><a href={event.payload.url} target="_blank" rel="noreferrer">{event.payload.title}</a><Badge>{event.kind}</Badge></div>
          <p className="mt-1 text-xs muted">{event.author?.userId ? names.get(event.author.userId) ?? event.author.login : 'Автор не сопоставлен'} · {new Date(event.occurredAt).toLocaleString('ru-RU')}</p>
          {event.details?.stats && <p className="mt-1 text-xs">Изменено строк: +{event.details.stats.additions} / −{event.details.stats.deletions}</p>}
        </article>)}
        {events.data?.pages[0]?.events.length === 0 && <p className="muted">Событий пока нет. Подключите репозиторий или дождитесь загрузки истории.</p>}
        {events.hasNextPage && <Button variant="outline" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>Ещё события</Button>}
      </Panel><Panel title="Неопознанные авторы">
        <ErrorText error={unmatched.error} /><ErrorText error={claim.error} />
        {unmatched.data?.pages.flatMap(page => page.identities).map(identity => <div key={identity.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
          <span className="text-sm">{identity.login ?? identity.email ?? 'Неизвестный автор'} · событий: {identity._count.events}</span>
          {identity.canClaim && <Button variant="outline" disabled={claim.isPending} onClick={() => claim.mutate(identity.id)}>Это мой автор</Button>}
        </div>)}
        {unmatched.data?.pages[0]?.identities.length === 0 && <p className="muted">Неопознанных авторов нет.</p>}
        {unmatched.hasNextPage && <Button variant="outline" onClick={() => void unmatched.fetchNextPage()}>Ещё авторы</Button>}
      </Panel></div>
      <aside className="space-y-5"><Panel title="Участники">{team.memberships.map(member => <p key={member.user.id} className="mb-3 text-sm"><Link to={`/projects/${project.id}/teams/${team.id}/members/${member.user.id}`}>{member.user.name ?? member.user.githubLogin}</Link><br /><span className="muted">{member.role === 'observer' ? 'Наблюдатель' : 'Участник'}</span></p>)}
        {!team.memberships.length && <p className="muted">Пригласите участников в команду.</p>}
      </Panel><Panel title="Вклад ещё не рассчитан"><p className="text-sm muted">Здесь пока показаны собранные события и статистика GitHub. Доли вклада, флаги и сводки появятся после расчёта.</p></Panel></aside>
    </div>
  </>
}
function Member() {
  const { projectId, teamId = '', memberId = '' } = useParams()
  const member = useQuery({ queryKey: ['api', 'member', teamId, memberId], queryFn: () => api.member(teamId, memberId) })
  if (member.isPending) return <Loading />
  if (member.isError) return <ErrorText error={member.error} />
  return <><PageHeader title={member.data.user.name ?? member.data.user.githubLogin} eyebrow={<Link to={`/projects/${projectId}/teams/${teamId}`}>← Команда</Link>} />
    <Panel title="Собранная активность">{member.data.rawActivity.map(item => <p key={item.kind}>{item.kind}: {item.count}</p>)}
      {!member.data.rawActivity.length && <p>Сопоставленных событий пока нет.</p>}<p className="mt-4 text-sm muted">Это число событий GitHub. Взвешенный вклад ещё не рассчитан.</p></Panel></>
}
function Invitation() {
  const { code = '' } = useParams(), session = useSession(), navigate = useNavigate()
  const [team, setTeam] = useState('')
  const invitation = useQuery({ queryKey: ['api', 'invitation', code], queryFn: () => api.invitation(code), enabled: Boolean(session.data), retry: false })
  const accept = useApiMutation((teamId: string) => api.accept(code, teamId))
  if (session.isPending) return <Loading />
  if (!session.data) return <EmptyState title="Приглашение в команду"><p className="mb-4">Войдите через GitHub, чтобы выбрать команду.</p><LoginButton /><ErrorText error={session.error} /></EmptyState>
  if (invitation.isPending) return <Loading />
  if (invitation.isError) return <EmptyState title="Приглашение недоступно"><ErrorText error={invitation.error} /><Link to="/projects">Мои проекты</Link></EmptyState>
  return <Panel title={`Приглашение: ${invitation.data.project.name}`}><form className="space-y-4" onSubmit={event => {
    event.preventDefault(); accept.mutate(team || invitation.data.project.teams[0]?.id || '', { onSuccess: result => navigate(`/projects/${result.projectId}/teams/${result.teamId}`) })
  }}><p>{invitation.data.project.organization.name}</p><label className="field">Команда<select value={team || invitation.data.project.teams[0]?.id || ''} onChange={e => setTeam(e.target.value)}>
    {invitation.data.project.teams.map(item => <option key={item.id} value={item.id}>{item.name} · участников: {item._count.memberships}</option>)}</select></label>
    <Button type="submit" disabled={accept.isPending || !invitation.data.project.teams.length}>Вступить в команду</Button><ErrorText error={accept.error} /></form></Panel>
}

export default function ApiApp() {
  return <BrowserRouter><Shell><Routes>
    <Route index element={<Home />} />
    <Route path="login" element={<Protected><Navigate to="/projects" replace /></Protected>} />
    <Route path="invite/:code" element={<Invitation />} />
    <Route path="projects" element={<Protected><Projects /></Protected>} />
    <Route path="projects/:projectId" element={<Protected><Project /></Protected>} />
    <Route path="projects/:projectId/teams/:teamId" element={<Protected><Team /></Protected>} />
    <Route path="projects/:projectId/teams/:teamId/members/:memberId" element={<Protected><Member /></Protected>} />
    <Route path="*" element={<EmptyState title="Страница не найдена"><Link to="/projects">Мои проекты</Link></EmptyState>} />
  </Routes></Shell></BrowserRouter>
}
