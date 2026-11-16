// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'
import { demoProjects } from '../data/fixtures'
import { ActivityChart } from './activity-chart'
import { Contributions } from './contributions'

afterEach(cleanup)

test('shows participant contributions in descending order and links to their details', () => {
  const project = demoProjects[0]
  const team = { ...project.teams[0], members: [...project.teams[0].members].reverse() }
  render(<MemoryRouter><Contributions projectId={project.id} team={team} /></MemoryRouter>)
  const row = screen.getAllByRole('row')[1]
  expect(within(row).getByText('61%')).toBeTruthy()
  expect(within(row).getByRole('link', { name: /Анна Котова/ }).getAttribute('href')).toBe('/projects/web/teams/kodzilla/members/anna')
})

test('shows an empty-state message when no week has events', () => {
  render(<ActivityChart members={demoProjects[0].teams[0].members} weeks={[]} />)
  expect(screen.getByText('Пока нет активности для графика.')).toBeTruthy()
})
