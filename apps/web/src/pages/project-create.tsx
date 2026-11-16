import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../components/ui'
import { createProject } from '../data/projects'
import { useDemoMutation } from '../data/workspace'
import { paths } from '../routes'

export function ProjectCreate({ onDismiss }: { onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const create = useDemoMutation(createProject)
  const navigate = useNavigate()
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  return <dialog ref={dialog} className="project-dialog" aria-labelledby="create-title" onCancel={event => { event.preventDefault(); onDismiss() }}>
    <form className="space-y-4" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      create.mutate({
        name: String(data.get('name')), teamName: String(data.get('team')),
        startsOn: String(data.get('starts')), endsOn: String(data.get('ends')),
      }, { onSuccess: project => navigate(paths.project(project.id)) })
    }}>
      <h2 id="create-title" className="text-xl">Новый проект</h2>
      <label className="field">Название проекта<input required name="name" maxLength={100} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">Начало<input required type="date" name="starts" /></label>
        <label className="field">Защита<input required type="date" name="ends" /></label>
      </div>
      <label className="field">Первая команда<input required name="team" defaultValue="Команда 1" maxLength={80} /></label>
      {create.isError && <p role="alert">{create.error.message}</p>}
      <div className="actions justify-end">
        <Button variant="outline" onClick={onDismiss}>Отмена</Button>
        <Button type="submit" disabled={create.isPending}>Создать проект</Button>
      </div>
    </form>
  </dialog>
}
