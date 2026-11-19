// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { WorkspaceFrame } from './workspace-frame'

afterEach(cleanup)
const projects = [
  { id: 'managed', name: 'Мой проект', canManage: true, visible: true },
  { id: 'observed', name: 'Наблюдаемый проект', canManage: false, firstTeamId: 'my-team', visible: true },
]
function show(projectId: string) {
  render(<MemoryRouter initialEntries={[`/projects/${projectId}/participants`]}><WorkspaceFrame projects={projects}
    user={{ name: 'Смешанные права', label: 'Аккаунт GitHub' }} allowCreate loggingOut={false} onLogout={() => {}}>
    <h1>Участники</h1>
  </WorkspaceFrame></MemoryRouter>)
}
describe('project-scoped navigation', () => {
  it('does not grant settings in an observed project just because another project is managed', () => {
    show('observed')
    expect(screen.queryByRole('link', { name: 'Настройки', exact: true })).toBeNull()
    expect(screen.getByRole('link', { name: 'Наблюдаемый проект', exact: true }).getAttribute('href')).toBe('/projects/observed/teams/my-team')
    expect(screen.getByRole('link', { name: 'Участники', exact: true }).getAttribute('href')).toBe('/projects/observed/participants')
  })
  it('offers settings for the current managed project and preserves its route', () => {
    show('managed')
    expect(screen.getByRole('link', { name: 'Настройки', exact: true }).getAttribute('href')).toBe('/projects/managed/settings')
    expect(screen.getByRole('link', { name: 'Сводки', exact: true }).getAttribute('href')).toBe('/projects/managed/summaries')
  })
})
