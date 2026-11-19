import { useState, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import type { EventFilters, LiveProject, LiveProjectSettings } from '@teampulse/shared'
import { Badge, Brand, Button, Card, EmptyState, PageHeader, Panel } from '../components/ui'
import { api } from './client'
import { sessionKey, useApiMutation, useLiveWorkspace, useSession } from './hooks'
import { WorkspaceFrame } from '../components/workspace-frame'
import { CollectedTeamCard } from '../components/project-team-card'
import { CollectedMembers } from '../components/contributions'
import { auditLabels, eventLabels, roleLabel } from './labels'

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
  const workspace = useLiveWorkspace()
  const logout = useMutation({ mutationFn: async () => {
    await api.logout()
    await queries.cancelQueries({ queryKey: ['api'] })
    queries.setQueryData(sessionKey, null)
    queries.removeQueries({ predicate: query => query.queryKey[0] === 'api' && query.queryKey[1] !== 'session' })
  } })
  return session.data ? <WorkspaceFrame
    projects={(workspace.data?.projects ?? []).map(project => ({ id: project.id, name: project.settings.name,
      canManage: project.canManage, firstTeamId: project.teams[0]?.id, visible: true, auditAvailable: true }))}
    user={{ name: session.data.user.name ?? session.data.user.githubLogin, label: 'Аккаунт GitHub' }}
    allowCreate={Boolean(workspace.data?.organizations.length)} loggingOut={logout.isPending} onLogout={() => logout.mutate()}
  >{children}<ErrorText error={logout.error} /></WorkspaceFrame> : <>{children}</>
}
function Login({ invitation = false, error }: { invitation?: boolean; error?: unknown }) {
  return <div className="login-screen">
    <div className="login-intro"><Brand inverse /><div><h1>Активность команды —<br />из вашего GitHub</h1>
      <ul><li>✓ Проекты, команды и приглашения</li><li>✓ История коммитов, PR, ревью и задач</li><li>✓ Сопоставление авторов и доступ по ролям</li></ul>
    </div><p>Расчёты вклада и ИИ-сводки — следующий этап</p></div>
    <main className="login-main"><Card className="login-card"><h2>{invitation ? 'Приглашение в команду' : 'Вход в TeamPulse'}</h2>
      <p>{invitation ? 'Войдите через GitHub, чтобы выбрать команду.' : 'Войдите через GitHub, чтобы открыть свои проекты и команды.'}</p><LoginButton /><ErrorText error={error} />
      <div className="login-note"><p>Доступ определяется вашими правами в проекте.</p></div>
    </Card></main>
  </div>
}
function Protected({ children }: { children: ReactNode }) {
  const session = useSession()
  if (session.isPending) return <Loading />
  if (session.isError) return <EmptyState title="Не удалось проверить вход"><ErrorText error={session.error} /><Button onClick={() => void session.refetch()}>Повторить</Button></EmptyState>
  if (!session.data) return <Login />
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
    <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{[
      { label: 'Команды', value: project.teams.length },
      { label: 'Участники', value: project.teams.reduce((sum, team) => sum + team.memberships.filter(member => member.role === 'participant').length, 0) },
      { label: 'Собрано событий', value: project.teams.reduce((sum, team) => sum + (team.repository?._count.events ?? 0), 0) },
      { label: 'Равномерность вклада', value: '—' },
    ].map(stat => <Card key={stat.label} className="p-4"><p className="text-xs muted">{stat.label}</p><strong className="block py-1 text-[27px]">{stat.value}</strong></Card>)}</div>
    <div className="grid gap-3 lg:grid-cols-2" aria-label="Команды проекта">{project.teams.map(team => <CollectedTeamCard key={team.id} projectId={project.id} team={team} />)}</div>
    <Card className="mt-5 p-5"><h2>Вклад ещё не рассчитан</h2><p className="mt-2 text-sm muted">Собранные события доступны на странице команды. Доли вклада, флаги и сводки появятся после расчёта.</p></Card>
    {project.canManage && <>
      <Panel title="Добавить команду" className="mt-5"><form className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget
        createTeam.mutate(String(new FormData(form).get('name')), { onSuccess: () => form.reset() })
      }}><label className="field">Название команды<input name="name" required maxLength={120} /></label><Button type="submit" disabled={createTeam.isPending}>Добавить команду</Button><ErrorText error={createTeam.error} /></form></Panel>
    </>}
  </>
}
function ProjectSection({ section }: { section: 'participants' | 'settings' | 'summaries' | 'report' | 'audit' }) {
  const { projectId, teamId } = useParams(), workspace = useLiveWorkspace()
  if (workspace.isPending) return <Loading />
  if (workspace.isError) return <ErrorText error={workspace.error} />
  const project = workspace.data.projects.find(item => item.id === projectId)
  if (!project || (teamId && !project.teams.some(team => team.id === teamId))) return <EmptyState title="Проект недоступен"><Link to="/projects">Мои проекты</Link></EmptyState>
  if (section === 'settings' && !project.canManage) return <EmptyState title="Настройки недоступны"><p>Изменять настройки может руководитель проекта.</p></EmptyState>
  if (section === 'audit' && !project.canManage) return <EmptyState title="Журнал недоступен"><p>Журнал доступен руководителю и владельцу проекта.</p></EmptyState>
  const title = { participants: 'Участники', settings: 'Настройки', summaries: 'Сводки', report: 'Итоговый отчёт', audit: 'Журнал действий' }[section]
  return <><PageHeader title={title} eyebrow={<Link to={`/projects/${project.id}`}>{project.settings.name}</Link>} />
    {section === 'audit' ? <Audit project={project} /> : section === 'settings' ? <Settings key={project.id} project={project} />
      : section === 'participants' ? <div className="space-y-5">
        {project.teams.map(team => <section key={team.id}><h2 className="mb-3"><Link to={`/projects/${project.id}/teams/${team.id}`}>{team.name}</Link></h2><CollectedMembers projectId={project.id} team={team} /></section>)}
        {project.canManage && <Access project={project} />}
      </div> : <EmptyState title={section === 'report' ? 'Отчёт ещё не сформирован' : 'Сводки ещё не рассчитаны'}>
        <p className="my-3 muted">События GitHub уже доступны. Метрики вклада, флаги и текстовые сводки появятся после подключения аналитического модуля.</p>
        <Link to={`/projects/${project.id}`}>Перейти к командам и событиям</Link>
      </EmptyState>}
  </>
}
function Audit({ project }: { project: LiveProject }) {
  const entries = useInfiniteQuery({ queryKey: ['api', 'audit', project.id], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.audit(project.id, pageParam), getNextPageParam: page => page.nextCursor ?? undefined, refetchInterval: 15000 })
  return <Panel title="Изменения проекта">
    <p className="mb-4 text-sm muted">Действия записываются с момента подключения журнала. Ранее выполненные изменения не восстанавливаются задним числом.</p>
    {entries.isPending && <Loading />}<ErrorText error={entries.error} />
    {entries.data?.pages.flatMap(page => page.entries).map(entry => <article key={entry.id} className="border-b border-line py-3">
      <p className="break-words text-sm font-semibold">{auditLabels[entry.action]}{entry.subject ? ` · ${entry.subject}` : ''}</p>
      {(entry.beforeRole || entry.afterRole) && <p className="mt-1 text-sm muted">{entry.beforeRole ? roleLabel(entry.beforeRole) : '—'} → {entry.afterRole ? roleLabel(entry.afterRole) : '—'}</p>}
      <p className="mt-1 text-xs muted">{entry.actorLogin ? `@${entry.actorLogin}` : 'Пользователь удалён'} · {new Date(entry.createdAt).toLocaleString('ru-RU')}{entry.teamId ? ` · ${project.teams.find(team => team.id === entry.teamId)?.name ?? 'Команда'}` : ''}</p>
    </article>)}
    {entries.data?.pages[0]?.entries.length === 0 && <p>Действий пока нет.</p>}
    {entries.hasNextPage && <Button variant="outline" disabled={entries.isFetchingNextPage} onClick={() => void entries.fetchNextPage()}>Ещё действия</Button>}
  </Panel>
}
function Access({ project }: { project: LiveProject }) {
  const access = useQuery({ queryKey: ['api', 'access', project.id], queryFn: () => api.access(project.id), refetchInterval: 15000 })
  const [observerLink, setObserverLink] = useState('')
  const [removal, setRemoval] = useState<{ teamId: string; userId: string; name: string } | null>(null)
  const observer = useApiMutation(() => api.inviteObserver(project.id))
  const revoke = useApiMutation((id: string) => api.revokeInvitation(project.id, id))
  const add = useApiMutation((login: string) => api.addManager(project.id, login))
  const removeManager = useApiMutation((id: string) => api.removeManager(project.id, id))
  const role = useApiMutation((input: { teamId: string; userId: string; role: 'participant' | 'observer' }) => api.memberRole(project.id, input.teamId, input.userId, input.role))
  const remove = useApiMutation((input: { teamId: string; userId: string }) => api.removeMember(project.id, input.teamId, input.userId))
  return <Panel title="Участники и доступ" className="mt-5">
    <ErrorText error={access.error} />
    {access.data && <div className="space-y-6">
      <section><h3 className="font-semibold">Руководители проекта</h3>
        <p className="my-2 text-sm muted">Владельцы организации сохраняют доступ ко всем её проектам.</p>
        {access.data.managers.map(user => <div key={user.id} className="my-2 flex flex-wrap items-center justify-between gap-3">
          <span>{user.name ?? user.githubLogin} (@{user.githubLogin})</span>
          {access.data.canManageManagers && !access.data.owners.some(owner => owner.id === user.id) &&
            <Button variant="outline" disabled={removeManager.isPending} onClick={() => removeManager.mutate(user.id)}>Снять права: {user.githubLogin}</Button>}
        </div>)}
        {access.data.canManageManagers && <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={event => {
          event.preventDefault(); const form = event.currentTarget
          add.mutate(String(new FormData(form).get('login')), { onSuccess: () => form.reset() })
        }}><label className="field">GitHub-логин руководителя<input name="login" required maxLength={39} /></label>
          <Button type="submit" disabled={add.isPending}>Назначить руководителя</Button>
          <p className="w-full text-sm muted">Пользователь должен сначала войти в TeamPulse.</p></form>}
        <ErrorText error={add.error} /><ErrorText error={removeManager.error} />
      </section>
      <section><h3 className="font-semibold">Участники команд</h3>
        {project.teams.map(team => <div key={team.id} className="mt-4"><h4>{team.name}</h4>
          {!team.memberships.length && <p className="text-sm muted">Участников пока нет.</p>}
          {team.memberships.map(member => <div key={member.user.id} className="my-3 flex flex-wrap items-center gap-3">
            <span>{member.user.name ?? member.user.githubLogin}</span>
            <select className="rounded border border-line p-2" aria-label={`Роль ${member.user.githubLogin}`} value={member.role} disabled={role.isPending}
              onChange={event => role.mutate({ teamId: team.id, userId: member.user.id, role: event.target.value as 'participant' | 'observer' })}>
              <option value="participant">Участник</option><option value="observer">Наблюдатель</option></select>
            <Button variant="outline" onClick={() => setRemoval({ teamId: team.id, userId: member.user.id, name: member.user.name ?? member.user.githubLogin })}>Удалить из команды: {member.user.githubLogin}</Button>
          </div>)}</div>)}
        <p className="mt-2 text-sm muted">Наблюдатель читает данные своей команды, но не подключает репозиторий и не подтверждает авторство.</p>
        {removal && <Card className="mt-3 p-4" role="alert"><p>Удалить {removal.name} из команды? Доступ через эту команду закроется. История GitHub сохранится. Другие права пользователя сохраняются. По действующему приглашению можно вступить снова — при необходимости отзовите ссылки.</p>
          <div className="mt-3 flex gap-3"><Button disabled={remove.isPending} onClick={() => remove.mutate(removal, { onSuccess: () => setRemoval(null) })}>Подтвердить удаление</Button>
            <Button variant="outline" onClick={() => setRemoval(null)}>Отмена</Button></div></Card>}
        <ErrorText error={role.error} /><ErrorText error={remove.error} />
      </section>
      <section><h3 className="mb-3 font-semibold">Приглашения</h3>
        <Button variant="outline" disabled={observer.isPending} onClick={() => observer.mutate(undefined, { onSuccess: result => setObserverLink(`${window.location.origin}/invite/${result.token}`) })}>Пригласить наблюдателя</Button>
        {observerLink && <label className="field mt-3">Ссылка для наблюдателя<input readOnly value={observerLink} onFocus={event => event.currentTarget.select()} /></label>}
        <p className="my-3 text-sm muted">Скопируйте ссылку после создания. Отзыв запрещает новые вступления; уже вступивших пользователей удаляют отдельно.</p>
        {!access.data.invitations.length && <p className="text-sm muted">Активных приглашений нет.</p>}
        {access.data.invitations.map(invitation => <div key={invitation.id} className="my-3 flex flex-wrap items-center justify-between gap-3">
          <span>{invitation.role === 'observer' ? 'Наблюдатель' : 'Участник'} · создано {new Date(invitation.createdAt).toLocaleString('ru-RU')} · до {new Date(invitation.expiresAt).toLocaleString('ru-RU')}</span>
          <Button variant="outline" disabled={revoke.isPending} onClick={() => { revoke.mutate(invitation.id); setObserverLink('') }}>Отозвать приглашение</Button>
        </div>)}<ErrorText error={observer.error} /><ErrorText error={revoke.error} />
      </section>
    </div>}
  </Panel>
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
    <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2">Пороги флагов</legend>{Object.entries({ inactivity: 'Неактивность, дней', imbalance: 'Дисбаланс, %', lateBurst: 'Поздний всплеск, %', excluded: 'Исключённые изменения, %' }).map(([key, label]) =>
      <label className="field" key={key}>{label}<input type="number" min={1} max={key === 'inactivity' ? 365 : 100} required value={settings.thresholds[key as keyof typeof settings.thresholds]}
        onChange={event => setSettings({ ...settings, thresholds: { ...settings.thresholds, [key]: Number(event.target.value) } })} /></label>)}</fieldset>
    <fieldset className="space-y-3"><legend>Контрольные точки</legend>{settings.milestones.map((point, index) => <div key={point.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <label className="field">Название точки {index + 1}<input required maxLength={120} value={point.title} onChange={event => setSettings({ ...settings, milestones: settings.milestones.map(item => item.id === point.id ? { ...item, title: event.target.value } : item) })} /></label>
      <label className="field">Дата точки {index + 1}<input type="date" required min={settings.startsOn} max={settings.endsOn} value={point.date} onChange={event => setSettings({ ...settings, milestones: settings.milestones.map(item => item.id === point.id ? { ...item, date: event.target.value } : item) })} /></label>
      <Button variant="ghost" aria-label={`Удалить точку ${index + 1}`} onClick={() => setSettings({ ...settings, milestones: settings.milestones.filter(item => item.id !== point.id) })}>×</Button>
    </div>)}<Button variant="outline" disabled={settings.milestones.length >= 50} onClick={() => setSettings({ ...settings, milestones: [...settings.milestones, { id: crypto.randomUUID(), title: '', date: settings.endsOn }] })}>+ Добавить точку</Button></fieldset>
    <Button type="submit" disabled={save.isPending}>Сохранить настройки</Button><ErrorText error={save.error} />
    {save.isSuccess && <p role="status" className="text-sm">Настройки сохранены.</p>}
  </form></Panel>
}
function Team() {
  const { projectId, teamId = '' } = useParams(), workspace = useLiveWorkspace()
  const [params, setParams] = useSearchParams()
  const tab = ['overview', 'members', 'events'].includes(params.get('tab') ?? '') ? params.get('tab')! : 'overview'
  const filters: EventFilters = { kind: (params.get('kind') || undefined) as EventFilters['kind'], author: params.get('author') || undefined,
    from: params.get('from') || undefined, to: params.get('to') || undefined }
  const project = workspace.data?.projects.find(p => p.id === projectId), team = project?.teams.find(t => t.id === teamId)
  const status = useQuery({ queryKey: ['api', 'sync', teamId], queryFn: () => api.syncStatus(teamId), enabled: Boolean(team?.repository), refetchInterval: 5000 })
  const events = useInfiniteQuery({ queryKey: ['api', 'events', teamId, filters], queryFn: ({ pageParam }) => api.events(teamId, pageParam, filters),
    initialPageParam: undefined as string | undefined, getNextPageParam: page => page.nextCursor ?? undefined, enabled: Boolean(team), refetchInterval: 15000 })
  const unmatched = useInfiniteQuery({ queryKey: ['api', 'unmatched', teamId], queryFn: ({ pageParam }) => api.unmatched(teamId, pageParam),
    initialPageParam: undefined as string | undefined, getNextPageParam: page => page.nextCursor ?? undefined, enabled: Boolean(team), refetchInterval: 15000 })
  const app = useQuery({ queryKey: ['api', 'app'], queryFn: api.app, enabled: Boolean(team?.canConnect) })
  const connect = useApiMutation((input: { fullName: string }) => api.connect(teamId, input))
  const disconnect = useApiMutation(() => api.disconnect(teamId))
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const sync = useApiMutation(() => api.sync(teamId)), claim = useApiMutation((id: string) => api.claim(teamId, id))
  if (workspace.isPending) return <Loading />
  if (workspace.isError) return <ErrorText error={workspace.error} />
  if (!project || !team) return <EmptyState title="Команда недоступна"><Link to="/projects">Мои проекты</Link></EmptyState>
  const names = new Map(team.memberships.map(member => [member.user.id, member.user.name ?? member.user.githubLogin]))
  return <>
    <PageHeader title={team.name} eyebrow={<Link to={`/projects/${project.id}`}>← {project.settings.name}</Link>}
      description={team.repository?.fullName ?? 'Подключите репозиторий команды'}
      actions={team.repository && team.repository.syncStatus !== 'disconnected' && team.canConnect && <Button disabled={sync.isPending} onClick={() => sync.mutate()}>Обновить историю</Button>} />
    <ErrorText error={sync.error} />
    <div className="page-tabs" aria-label="Раздел команды">
      <button type="button" aria-pressed={tab === 'overview'} onClick={() => { const next = new URLSearchParams(params); next.delete('tab'); setParams(next) }}>Обзор</button>
      <button type="button" aria-pressed={tab === 'members'} onClick={() => { const next = new URLSearchParams(params); next.set('tab', 'members'); setParams(next) }}>Участники</button>
      <Link to={`/projects/${project.id}/summaries?team=${encodeURIComponent(team.id)}`}>Сводки</Link>
      <button type="button" aria-pressed={tab === 'events'} onClick={() => { const next = new URLSearchParams(params); next.set('tab', 'events'); setParams(next) }}>Лента событий</button>
      <Link to={`/projects/${project.id}/teams/${team.id}/report`}>Итоговый отчёт</Link>
    </div>
    {team.repository && <Card className="mb-5 p-4"><h2>Загрузка истории</h2>
      <p className="mt-2 text-sm" role="status">{status.data ? `Статус: ${{ pending: 'в очереди', running: 'загружается', complete: 'завершена', failed: 'ошибка', disconnected: 'отключён' }[status.data.syncStatus]}. Событий: ${status.data._count.events}` : 'Проверяем состояние…'}</p>
      {status.data?.syncError && <p className="mt-2 text-sm">{({ USER_DISCONNECTED: 'Сбор событий остановлен пользователем. Сохранённая история доступна ниже.',
        GITHUB_ACCESS_REVOKED: 'GitHub отозвал доступ приложения. Восстановите установку и подключите репозиторий повторно.',
        GITHUB_ACCESS_DENIED: 'Нет доступа к данным GitHub. Проверьте права и установку приложения, затем подключите репозиторий повторно.',
        GITHUB_RATE_LIMIT: 'GitHub ограничил частоту запросов. Загрузка продолжится автоматически после паузы.',
        HISTORY_REQUEST_FAILED: status.data.syncStatus === 'failed' ? 'Не удалось загрузить историю после нескольких попыток. Нажмите «Обновить историю», чтобы повторить.' : 'Временная ошибка загрузки. Повторим запрос автоматически.',
      } as Record<string, string>)[status.data.syncError] ?? 'Не удалось обновить данные GitHub. Проверьте доступ к репозиторию.'}</p>}
      {status.data?.syncRetryAt && <p className="text-sm muted">Следующая попытка: {new Date(status.data.syncRetryAt).toLocaleString('ru-RU')}</p>}<ErrorText error={status.error} /></Card>}
    {team.repository && team.repository.syncStatus !== 'disconnected' && project.canManage && <Card className="mb-5 p-4">
      {!confirmDisconnect ? <Button variant="outline" onClick={() => setConfirmDisconnect(true)}>Отключить репозиторий</Button> : <>
        <p>Остановить сбор событий? История сохранится. Установка приложения на GitHub останется; здесь можно подключить тот же репозиторий повторно.</p>
        <div className="mt-3 flex gap-3"><Button disabled={disconnect.isPending} onClick={() => disconnect.mutate(undefined, { onSuccess: () => setConfirmDisconnect(false) })}>Подтвердить отключение</Button>
          <Button variant="outline" onClick={() => setConfirmDisconnect(false)}>Отмена</Button></div></>}
      <ErrorText error={disconnect.error} /></Card>}
    {(!team.repository || team.repository.syncStatus === 'disconnected') && team.canConnect && <Panel title={team.repository ? 'Восстановить подключение GitHub' : 'Подключить GitHub'} className="mb-5">
      {app.data?.installationUrl && <p className="mb-4"><a href={app.data.installationUrl} target="_blank" rel="noreferrer">Установить TeamPulse Insights на репозиторий →</a></p>}
      <form className="space-y-3" onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget)
        connect.mutate({ fullName: String(data.get('repo')) })
      }}><label className="field">Репозиторий (владелец/название)<input name="repo" placeholder="lavasheva/teampulse" defaultValue={team.repository?.fullName} required /></label>
        {team.repository && <p className="text-sm muted">Если репозиторий переименован, укажите новое название. Восстановить можно только тот же репозиторий — история не смешивается с другим источником.</p>}
        <p className="text-sm muted">Сначала установите приложение на выбранный репозиторий. Подключение подтверждает его администратор.</p>
        <Button type="submit" disabled={connect.isPending}>{team.repository ? 'Подключить повторно' : 'Подключить репозиторий'}</Button><ErrorText error={connect.error} /></form>
    </Panel>}
    <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
      {tab === 'members' ? <CollectedMembers projectId={project.id} team={team} /> : <div className="space-y-5"><Panel title="События из GitHub">
        <form key={JSON.stringify(filters)} aria-label="Фильтры событий" className="mb-4 grid gap-3 sm:grid-cols-2" onSubmit={event => {
          event.preventDefault(); const data = new FormData(event.currentTarget), next = new URLSearchParams(params)
          next.set('tab', 'events')
          for (const key of ['kind', 'author', 'from', 'to']) { const value = String(data.get(key) ?? ''); if (value) next.set(key, value); else next.delete(key) }
          setParams(next)
        }}>
          <label className="field">Тип события<select name="kind" defaultValue={filters.kind ?? ''}><option value="">Все типы</option>{Object.entries(eventLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="field">Автор события<select name="author" defaultValue={filters.author ?? ''}><option value="">Все авторы</option><option value="unmatched">Неопознанные авторы</option>
            {filters.author && filters.author !== 'unmatched' && !team.memberships.some(member => member.user.id === filters.author) && <option value={filters.author}>Выбранный автор вне текущего состава</option>}
            {team.memberships.map(member => <option key={member.user.id} value={member.user.id}>{member.user.name ?? member.user.githubLogin}</option>)}</select></label>
          <label className="field">С даты (UTC)<input name="from" type="date" defaultValue={filters.from ?? ''} /></label>
          <label className="field">По дату (UTC)<input name="to" type="date" defaultValue={filters.to ?? ''} /></label>
          <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit">Применить фильтры</Button><Button variant="outline" onClick={() => setParams({ tab: 'events' })}>Сбросить фильтры</Button></div>
        </form>
        <p className="mb-3 text-xs muted">Сначала новые события. Период включает выбранные даты по UTC.</p>
        {events.isPending && <Loading />}<ErrorText error={events.error} />
        {events.data?.pages.flatMap(page => page.events).map(event => <article key={event.id} className="border-b border-line py-3">
          <div className="flex items-start justify-between gap-3"><a className="min-w-0 break-words" href={event.payload.url} target="_blank" rel="noreferrer">{event.payload.title}</a><Badge>{eventLabels[event.kind]}</Badge></div>
          <p className="mt-1 text-xs muted">{event.author?.userId ? names.get(event.author.userId) ?? event.author.login : 'Автор не сопоставлен'} · {new Date(event.occurredAt).toLocaleString('ru-RU')}</p>
          {event.details?.stats && <p className="mt-1 text-xs">Изменено строк: +{event.details.stats.additions} / −{event.details.stats.deletions}</p>}
        </article>)}
        {events.data?.pages[0]?.events.length === 0 && <p className="muted">По выбранным условиям событий нет. Измените фильтры или дождитесь загрузки истории.</p>}
        {events.hasNextPage && <Button variant="outline" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>Ещё события</Button>}
      </Panel><Panel title="Неопознанные авторы">
        <ErrorText error={unmatched.error} /><ErrorText error={claim.error} />
        {unmatched.data?.pages.flatMap(page => page.identities).map(identity => <div key={identity.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
          <span className="text-sm">{identity.login ?? identity.email ?? 'Неизвестный автор'} · событий: {identity._count.events}</span>
          {identity.canClaim && <Button variant="outline" disabled={claim.isPending} onClick={() => claim.mutate(identity.id)}>Это мой автор</Button>}
        </div>)}
        {unmatched.data?.pages[0]?.identities.length === 0 && <p className="muted">Неопознанных авторов нет.</p>}
        {unmatched.hasNextPage && <Button variant="outline" onClick={() => void unmatched.fetchNextPage()}>Ещё авторы</Button>}
      </Panel></div>}
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
    <Panel title="Собранная активность">{member.data.rawActivity.map(item => <p key={item.kind}>{eventLabels[item.kind]}: {item.count}</p>)}
      {!member.data.rawActivity.length && <p>Сопоставленных событий пока нет.</p>}<p className="mt-4 text-sm muted">Это число событий GitHub. Взвешенный вклад ещё не рассчитан.</p></Panel></>
}
function Invitation() {
  const { code = '' } = useParams(), session = useSession(), navigate = useNavigate()
  const [team, setTeam] = useState('')
  const invitation = useQuery({ queryKey: ['api', 'invitation', code], queryFn: () => api.invitation(code), enabled: Boolean(session.data), retry: false })
  const accept = useApiMutation((teamId: string) => api.accept(code, teamId))
  if (session.isPending) return <Loading />
  if (!session.data) return <Login invitation error={session.error} />
  if (invitation.isPending) return <Loading />
  if (invitation.isError) return <EmptyState title="Приглашение недоступно"><ErrorText error={invitation.error} /><Link to="/projects">Мои проекты</Link></EmptyState>
  return <Panel title={`Приглашение: ${invitation.data.project.name}`}><form className="space-y-4" onSubmit={event => {
    event.preventDefault(); accept.mutate(team || invitation.data.project.teams[0]?.id || '', { onSuccess: result => navigate(`/projects/${result.projectId}/teams/${result.teamId}`) })
  }}><p>{invitation.data.project.organization.name}</p><p>Роль: {invitation.data.role === 'observer' ? 'наблюдатель (только чтение)' : 'участник'}</p><label className="field">Команда<select value={team || invitation.data.project.teams[0]?.id || ''} onChange={e => setTeam(e.target.value)}>
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
    <Route path="projects/:projectId/participants" element={<Protected><ProjectSection section="participants" /></Protected>} />
    <Route path="projects/:projectId/settings" element={<Protected><ProjectSection section="settings" /></Protected>} />
    <Route path="projects/:projectId/summaries" element={<Protected><ProjectSection section="summaries" /></Protected>} />
    <Route path="projects/:projectId/audit" element={<Protected><ProjectSection section="audit" /></Protected>} />
    <Route path="projects/:projectId/teams/:teamId/report" element={<Protected><ProjectSection section="report" /></Protected>} />
    <Route path="projects/:projectId/teams/:teamId" element={<Protected><Team /></Protected>} />
    <Route path="projects/:projectId/teams/:teamId/members/:memberId" element={<Protected><Member /></Protected>} />
    <Route path="*" element={<EmptyState title="Страница не найдена"><Link to="/projects">Мои проекты</Link></EmptyState>} />
  </Routes></Shell></BrowserRouter>
}
