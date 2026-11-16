import { useState } from 'react'
import type { Project, ProjectSettings } from '@teampulse/shared'
import { Link } from 'react-router'
import { WorkRules } from '../components/work-rules'
import { InviteLink } from '../components/invite-link'
import { Avatar, Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui'
import { saveProjectSettings } from '../data/settings'
import { useDemoMutation, useProject, useWorkspace } from '../data/workspace'
import { paths } from '../routes'

export function Settings() {
  const project = useProject()
  const manager = useWorkspace().data?.user?.role === 'manager'
  if (!project || !manager) return <EmptyState title="Настройки недоступны"><Link to={paths.projects}>Мои проекты</Link></EmptyState>
  return <SettingsForm key={project.id} project={project} />
}

function SettingsForm({ project }: { project: Project }) {
  const [settings, setSettings] = useState(project.settings)
  const save = useDemoMutation(saveProjectSettings)
  const update = (changes: Partial<ProjectSettings>) => {
    save.reset()
    setSettings(current => ({ ...current, ...changes }))
  }

  return <form onSubmit={event => { event.preventDefault(); save.mutate({ projectId: project.id, settings }) }}>
    <PageHeader title="Настройки проекта" eyebrow={project.settings.name} description="Основные данные и правила оценки вклада"
      actions={<>
        <Button variant="outline" asChild><Link to={paths.project(project.id)}>Отмена</Link></Button>
        <Button type="submit" disabled={save.isPending}>Сохранить</Button>
      </>} />
    {save.isError && <p className="mb-4 rounded-lg badge-danger p-3" role="alert">{save.error.message}</p>}
    {save.isSuccess && <p className="mb-4 rounded-lg badge-success p-3" role="status">Настройки сохранены</p>}
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Panel title="Основное">
          <div className="space-y-4">
            <label className="field">Название<input required maxLength={100} value={settings.name} onChange={event => update({ name: event.currentTarget.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field">Начало<input type="date" required value={settings.startsOn} onChange={event => update({ startsOn: event.currentTarget.value })} /></label>
              <label className="field">Защита<input type="date" required min={settings.startsOn} value={settings.endsOn} onChange={event => update({ endsOn: event.currentTarget.value })} /></label>
            </div>
            <div><p className="mb-2 text-xs muted">Руководитель</p><div className="flex items-center gap-2"><Avatar name={project.owner} /><strong>{project.owner}</strong><Badge>Владелец</Badge></div></div>
          </div>
        </Panel>
        <Panel title="Контрольные точки">
          <div className="grid gap-2">{settings.milestones.map((point, index) => {
            const edit = (changes: Partial<typeof point>) => update({ milestones: settings.milestones.map(item => item.id === point.id ? { ...item, ...changes } : item) })
            return <div className="grid grid-cols-[minmax(0,1fr)_minmax(110px,0.7fr)_auto] items-end gap-2" key={point.id}>
              <label className="field"><span className="sr-only">Название точки {index + 1}</span><input value={point.title} maxLength={80} required onChange={event => edit({ title: event.currentTarget.value })} /></label>
              <label className="field"><span className="sr-only">Дата точки {index + 1}</span><input type="date" value={point.date} min={settings.startsOn} max={settings.endsOn} required onChange={event => edit({ date: event.currentTarget.value })} /></label>
              <Button variant="ghost" aria-label={'Удалить точку ' + (index + 1)} onClick={() => update({ milestones: settings.milestones.filter(item => item.id !== point.id) })}>×</Button>
            </div>
          })}</div>
          <Button variant="ghost" className="mt-2" onClick={() => update({ milestones: [...settings.milestones, { id: crypto.randomUUID(), title: '', date: settings.endsOn }] })}>+ Добавить точку</Button>
        </Panel>
        {project.status === 'active' && <Panel title="Приглашение"><InviteLink code={project.inviteCode} /></Panel>}
      </div>
      <WorkRules settings={settings} update={update} />
    </div>
  </form>
}
